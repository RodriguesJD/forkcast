import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { parseRecipeInput } from '../src/domain/recipeInput';
import { parseCheckedInput, parsePlanInput, parseShoppingEditsInput } from '../src/domain/planInput';
import { createImportRoutes, type ImportDeps } from './importRoutes';
import { SEED_RECIPES } from '../src/data/seedRecipes';
import * as q from './db';
import {
  createSession,
  destroySession,
  hashPassword,
  LoginLimiter,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  resolveSession,
  SESSION_TTL_MS,
  USERNAME_RE,
  verifyPassword,
} from './auth';

export const SESSION_COOKIE = 'forkcast_session';

export interface AppOptions {
  db: DatabaseSync;
  /** Directory with the built client (index.html + assets/). Omit to serve the API only (tests). */
  distDir?: string;
  limiter?: LoginLimiter;
  log?: (line: string) => void;
  /** Overrides for the recipe import routes (tests inject a fake page fetcher / extractor). */
  importDeps?: ImportDeps;
}

type Env = { Variables: { user: q.UserRow } };

function clientKey(c: Context): string {
  try {
    const addr = getConnInfo(c).remote.address;
    if (addr) return addr;
  } catch {
    // no socket (tests); fall through
  }
  return 'unknown';
}

function isJsonRequest(c: Context): boolean {
  const type = c.req.header('content-type') ?? '';
  return /^application\/json\b/i.test(type);
}

export function createApp({ db, distDir, limiter = new LoginLimiter(), log = () => {}, importDeps }: AppOptions): Hono<Env> {
  const app = new Hono<Env>();

  // ---------- API ----------
  const api = new Hono<Env>();
  const smallBody = bodyLimit({ maxSize: 1024 * 1024 });
  const photoBody = bodyLimit({ maxSize: 8 * 1024 * 1024 });
  api.use('*', (c, next) => (c.req.path.endsWith('/import/photo') ? photoBody(c, next) : smallBody(c, next)));
  api.use('*', async (c, next) => {
    // CSRF defence: writes with a body must be JSON. A browser cannot send that content
    // type cross-origin without a CORS preflight (nor a DELETE at all), and this server
    // answers no preflight, so a form or script on another site cannot act as Christy.
    if ((c.req.method === 'POST' || c.req.method === 'PUT') && !isJsonRequest(c)) {
      return c.json({ error: 'Expected application/json' }, 415);
    }
    await next();
  });

  async function readJson(c: Context): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      return undefined;
    }
  }

  function issueCookie(c: Context, token: string): void {
    // Not `secure`: the site is plain http on the LAN and on tailscale serve's http port.
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }

  api.get('/health', (c) => {
    db.prepare('SELECT 1').get();
    return c.json({ ok: true });
  });

  api.get('/auth/me', (c) => {
    const user = resolveSession(db, getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: 'Not signed in' }, 401);
    return c.json({ user: { id: user.id, username: user.username } });
  });

  api.post('/auth/signup', async (c) => {
    const body = (await readJson(c)) as { username?: unknown; password?: unknown } | undefined;
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const errors: string[] = [];
    if (!USERNAME_RE.test(username)) {
      errors.push('Username must be 2–40 characters: letters, numbers, dots, dashes or underscores.');
    }
    if (password.length < PASSWORD_MIN_LENGTH) errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (password.length > PASSWORD_MAX_LENGTH) errors.push('Password is too long.');
    if (errors.length) return c.json({ errors }, 400);

    const user = q.insertUser(db, username, hashPassword(password));
    if (!user) return c.json({ errors: ['That username is taken.'] }, 409);
    q.insertRecipes(db, user.id, SEED_RECIPES);
    issueCookie(c, createSession(db, user.id));
    log(`signup ${user.username}`);
    return c.json({ user: { id: user.id, username: user.username } }, 201);
  });

  api.post('/auth/login', async (c) => {
    const key = clientKey(c);
    const wait = limiter.retryAfterMs(key);
    if (wait > 0) {
      c.header('Retry-After', String(Math.ceil(wait / 1000)));
      return c.json({ errors: [`Too many attempts. Try again in ${Math.ceil(wait / 60000)} min.`] }, 429);
    }
    const body = (await readJson(c)) as { username?: unknown; password?: unknown } | undefined;
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const user = username && password.length <= PASSWORD_MAX_LENGTH ? q.findUserByName(db, username) : undefined;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      limiter.recordFailure(key);
      log(`login failed for "${username}" from ${key}`);
      return c.json({ errors: ['Wrong username or password.'] }, 401);
    }
    limiter.recordSuccess(key);
    issueCookie(c, createSession(db, user.id));
    return c.json({ user: { id: user.id, username: user.username } });
  });

  api.post('/auth/logout', (c) => {
    destroySession(db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  // Everything below needs a session.
  api.use('/recipes', requireUser);
  api.use('/recipes/*', requireUser);
  api.use('/state', requireUser);
  api.use('/plan', requireUser);
  api.use('/checked', requireUser);
  api.use('/shopping-edits', requireUser);
  api.use('/import/*', requireUser);
  async function requireUser(c: Context<Env>, next: () => Promise<void>) {
    const user = resolveSession(db, getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: 'Not signed in' }, 401);
    c.set('user', user);
    await next();
  }

  api.get('/recipes', (c) => c.json({ recipes: q.listRecipes(db, c.get('user').id) }));

  api.post('/recipes', async (c) => {
    const parsed = parseRecipeInput(await readJson(c));
    if (!parsed.ok) return c.json({ errors: parsed.errors }, 400);
    const recipe = { id: randomUUID(), ...parsed.recipe };
    q.insertRecipe(db, c.get('user').id, recipe);
    return c.json({ recipe }, 201);
  });

  api.put('/recipes/:id', async (c) => {
    const parsed = parseRecipeInput(await readJson(c));
    if (!parsed.ok) return c.json({ errors: parsed.errors }, 400);
    const recipe = { id: c.req.param('id'), ...parsed.recipe };
    if (!q.updateRecipe(db, c.get('user').id, recipe)) return c.json({ error: 'No such recipe' }, 404);
    return c.json({ recipe });
  });

  api.delete('/recipes/:id', (c) => {
    if (!q.deleteRecipe(db, c.get('user').id, c.req.param('id'))) return c.json({ error: 'No such recipe' }, 404);
    return c.body(null, 204);
  });

  api.get('/state', (c) => c.json(q.getUserState(db, c.get('user').id)));

  api.put('/plan', async (c) => {
    const parsed = parsePlanInput(await readJson(c));
    if (!parsed.ok) return c.json({ errors: parsed.errors }, 400);
    q.savePlan(db, c.get('user').id, parsed.plan);
    return c.json({ ok: true });
  });

  api.put('/checked', async (c) => {
    const checked = parseCheckedInput(await readJson(c));
    if (!checked) return c.json({ errors: ['checked must be an object of booleans.'] }, 400);
    q.saveChecked(db, c.get('user').id, checked);
    return c.json({ ok: true });
  });

  api.put('/shopping-edits', async (c) => {
    const parsed = parseShoppingEditsInput(await readJson(c));
    if (!parsed.ok) return c.json({ errors: parsed.errors }, 400);
    q.saveShoppingEdits(db, c.get('user').id, parsed.edits);
    return c.json({ ok: true });
  });

  api.route('/import', createImportRoutes(importDeps));

  api.all('*', (c) => c.json({ error: 'Not found' }, 404));
  api.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log(`error ${c.req.method} ${c.req.path}: ${err.stack ?? err.message}`);
    return c.json({ error: 'Server error' }, 500);
  });

  app.route('/api', api);

  // ---------- static client ----------
  if (distDir) {
    // Same policy nginx had: hashed assets are immutable, everything else must revalidate.
    const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');
    app.use(
      '*',
      serveStatic({
        root: distDir,
        onFound: (path, c) => {
          c.header(
            'Cache-Control',
            path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
    app.get('*', (c) => {
      c.header('Cache-Control', 'no-cache');
      return c.html(indexHtml);
    });
  }

  return app;
}
