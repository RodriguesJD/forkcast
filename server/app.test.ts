import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app';
import { LoginLimiter, verifyPassword, hashPassword } from './auth';
import { openMemoryDatabase } from './db';
import { SEED_RECIPES } from '../src/data/seedRecipes';
import { defaultSettings } from '../src/domain/defaults';

const JSON_HEADERS = { 'content-type': 'application/json' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();

function cookieFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const m = /forkcast_session=([^;]*)/.exec(header);
  if (!m) throw new Error(`no session cookie in: ${header}`);
  return `forkcast_session=${m[1]}`;
}

interface Client {
  app: Hono<any>;
  cookie: string;
  get(path: string): Promise<Response>;
  send(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<Response>;
}

function client(app: Hono<any>, cookie = ''): Client {
  const c: Client = {
    app,
    cookie,
    get: async (path) => app.request(path, { headers: c.cookie ? { cookie: c.cookie } : {} }),
    send: async (method, path, body, extraHeaders = {}) =>
      app.request(path, {
        method,
        headers: { ...(body !== undefined ? JSON_HEADERS : {}), ...(c.cookie ? { cookie: c.cookie } : {}), ...extraHeaders },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
  };
  return c;
}

async function signup(app: Hono<any>, username = 'christy', password = 'correct horse'): Promise<Client> {
  const res = await app.request('/api/auth/signup', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(201);
  return client(app, cookieFrom(res));
}

const newRecipe = {
  name: 'Toast',
  baseServings: 1,
  activeMinutes: 2,
  totalMinutes: 5,
  ingredients: [{ name: 'bread', quantity: { amount: 2, unit: 'slice' }, section: 'bakery' }],
  advancePrep: [],
};

describe('auth', () => {
  let app: Hono<any>;
  beforeEach(() => {
    app = createApp({ db: openMemoryDatabase() });
  });

  it('starts signed out', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('signs up, sets an httpOnly lax cookie and seeds the sample recipes', async () => {
    const res = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'Christy', password: 'correct horse' }),
    });
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ user: { id: 1, username: 'Christy' } });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i);

    const me = client(app, cookieFrom(res));
    expect((await json(await me.get('/api/auth/me'))).user.username).toBe('Christy');
    const recipes = (await json(await me.get('/api/recipes'))).recipes;
    expect(recipes).toHaveLength(SEED_RECIPES.length);
    expect(recipes.map((r: { id: string }) => r.id).sort()).toEqual(SEED_RECIPES.map((r) => r.id).sort());
  });

  it('validates sign-up input', async () => {
    const bad = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'c', password: 'short' }),
    });
    expect(bad.status).toBe(400);
    expect((await json(bad)).errors).toHaveLength(2);
  });

  it('rejects a taken username case-insensitively', async () => {
    await signup(app, 'christy');
    const dup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'CHRISTY', password: 'another pass' }),
    });
    expect(dup.status).toBe(409);
  });

  it('logs in with the right password, case-insensitive username, and not the wrong one', async () => {
    await signup(app, 'christy', 'correct horse');
    const bad = await app.request('/api/auth/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'christy', password: 'wrong' }),
    });
    expect(bad.status).toBe(401);
    const ok = await app.request('/api/auth/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'Christy', password: 'correct horse' }),
    });
    expect(ok.status).toBe(200);
    const me = client(app, cookieFrom(ok));
    expect((await me.get('/api/auth/me')).status).toBe(200);
  });

  it('logs out and the cookie stops working', async () => {
    const me = await signup(app);
    const out = await me.send('POST', '/api/auth/logout', {});
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect((await me.get('/api/auth/me')).status).toBe(401);
  });

  it('ignores garbage cookies', async () => {
    const res = await app.request('/api/auth/me', { headers: { cookie: 'forkcast_session=nope' } });
    expect(res.status).toBe(401);
  });

  it('locks out after repeated failures', async () => {
    const limited = createApp({ db: openMemoryDatabase(), limiter: new LoginLimiter(3) });
    await signup(limited);
    const attempt = () =>
      limited.request('/api/auth/login', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ username: 'christy', password: 'nope' }),
      });
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const locked = await attempt();
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toMatch(/^\d+$/);
    // Even the right password is refused while locked.
    const right = await limited.request('/api/auth/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'christy', password: 'correct horse' }),
    });
    expect(right.status).toBe(429);
  });

  it('requires JSON on writes', async () => {
    const res = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'username=christy&password=correct+horse',
    });
    expect(res.status).toBe(415);
  });

  it('answers unknown API paths with JSON, not the app shell', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'Not found' });
  });

  it('health check works without a session', async () => {
    expect(await json(await app.request('/api/health'))).toEqual({ ok: true });
  });
});

describe('password hashing', () => {
  it('verifies and rejects', () => {
    const h = hashPassword('secret stuff');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('secret stuff', h)).toBe(true);
    expect(verifyPassword('secret stuf', h)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('recipes', () => {
  let me: Client;
  beforeEach(async () => {
    me = await signup(createApp({ db: openMemoryDatabase() }));
  });

  it('requires a session', async () => {
    const anon = client(me.app);
    expect((await anon.get('/api/recipes')).status).toBe(401);
    expect((await anon.send('POST', '/api/recipes', newRecipe)).status).toBe(401);
  });

  it('creates, lists, updates and deletes', async () => {
    const created = await me.send('POST', '/api/recipes', { ...newRecipe, id: 'client-chosen' });
    expect(created.status).toBe(201);
    const { recipe } = await json(created);
    expect(recipe.id).not.toBe('client-chosen');
    expect(recipe).toMatchObject({ name: 'Toast', advancePrep: [] });

    let list = (await json(await me.get('/api/recipes'))).recipes;
    expect(list.find((r: { id: string }) => r.id === recipe.id)).toEqual(recipe);
    expect(list).toHaveLength(SEED_RECIPES.length + 1);

    const updated = await me.send('PUT', `/api/recipes/${recipe.id}`, { ...newRecipe, name: 'Buttered toast' });
    expect(updated.status).toBe(200);
    expect((await json(updated)).recipe).toEqual({ ...recipe, name: 'Buttered toast' });

    expect((await me.send('DELETE', `/api/recipes/${recipe.id}`)).status).toBe(204);
    expect((await me.send('DELETE', `/api/recipes/${recipe.id}`)).status).toBe(404);
    list = (await json(await me.get('/api/recipes'))).recipes;
    expect(list).toHaveLength(SEED_RECIPES.length);
  });

  it('seeded recipes are editable and deletable', async () => {
    const res = await me.send('PUT', '/api/recipes/weeknight-chili', { ...newRecipe, name: 'My chili' });
    expect(res.status).toBe(200);
    expect((await me.send('DELETE', '/api/recipes/weeknight-chili')).status).toBe(204);
  });

  it('rejects invalid recipes with field errors', async () => {
    const res = await me.send('POST', '/api/recipes', { ...newRecipe, ingredients: [] });
    expect(res.status).toBe(400);
    expect((await json(res)).errors).toEqual(['Add at least one ingredient.']);
    expect((await me.send('PUT', '/api/recipes/weeknight-chili', { nope: true })).status).toBe(400);
    expect((await me.send('PUT', '/api/recipes/unknown-id', newRecipe)).status).toBe(404);
  });

  it('keeps users apart', async () => {
    const other = await signup(me.app, 'guest', 'guest password');
    const mine = await json(await me.send('POST', '/api/recipes', newRecipe));
    expect((await other.send('DELETE', `/api/recipes/${mine.recipe.id}`)).status).toBe(404);
    expect((await other.send('PUT', `/api/recipes/${mine.recipe.id}`, newRecipe)).status).toBe(404);
    const theirs = (await json(await other.get('/api/recipes'))).recipes;
    expect(theirs.map((r: { id: string }) => r.id)).not.toContain(mine.recipe.id);
  });
});

describe('plan and shopping state', () => {
  let me: Client;
  beforeEach(async () => {
    me = await signup(createApp({ db: openMemoryDatabase() }));
  });

  it('starts with default settings and nothing checked', async () => {
    expect(await json(await me.get('/api/state'))).toEqual({
      plan: { settings: defaultSettings(), entries: [] },
      checked: {},
    });
  });

  it('round-trips the plan and checkbox state independently', async () => {
    const plan = {
      settings: { ...defaultSettings(), householdSize: 3 },
      entries: [{ kind: 'cook', id: 'e1', slot: { dayIndex: 2, slot: 'dinner' }, recipeId: 'weeknight-chili', servings: 6 }],
    };
    expect((await me.send('PUT', '/api/plan', plan)).status).toBe(200);
    expect((await me.send('PUT', '/api/checked', { 'ground beef|mass': true, 'garlic|clove': false })).status).toBe(200);
    expect(await json(await me.get('/api/state'))).toEqual({ plan, checked: { 'ground beef|mass': true } });

    // Saving one does not clobber the other.
    expect((await me.send('PUT', '/api/plan', { ...plan, entries: [] })).status).toBe(200);
    expect((await json(await me.get('/api/state'))).checked).toEqual({ 'ground beef|mass': true });
  });

  it('rejects malformed plans and checked maps', async () => {
    expect((await me.send('PUT', '/api/plan', { settings: {}, entries: [{ kind: 'cook' }] })).status).toBe(400);
    expect((await me.send('PUT', '/api/plan', 'nope')).status).toBe(400);
    expect((await me.send('PUT', '/api/checked', { a: 'yes' })).status).toBe(400);
    expect((await me.send('PUT', '/api/checked', [])).status).toBe(400);
  });

  it('requires a session', async () => {
    const anon = client(me.app);
    expect((await anon.get('/api/state')).status).toBe(401);
    expect((await anon.send('PUT', '/api/plan', { settings: {}, entries: [] })).status).toBe(401);
  });
});
