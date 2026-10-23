import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app';
import { openMemoryDatabase } from './db';
import { isFetchableUrl } from './importRoutes';
import { ExtractionError } from './claude';
import type { RecipeDraft } from '../src/domain/importRecipe';

const JSON_HEADERS = { 'content-type': 'application/json' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();

const structuredPage = `<html><script type="application/ld+json">{"@type":"Recipe","name":"Site Chili","recipeYield":"6","totalTime":"PT1H","recipeIngredient":["1 lb ground beef","2 cans kidney beans"],"recipeInstructions":"Brown the beef. Add beans."}</script></html>`;
const plainPage = `<html><body><h1>Nana's soup</h1><p>Some prose without any structured data.</p></body></html>`;

const claudeDraft: RecipeDraft = {
  name: 'Claude Soup',
  baseServings: 4,
  ingredients: [{ name: 'carrot', amount: 2, unit: 'each', section: 'produce', original: '2 carrots' }],
  advancePrep: [],
  instructions: ['Simmer.'],
  source: 'claude',
  warnings: [],
};

describe('isFetchableUrl', () => {
  it('allows public http(s) hosts and blocks the LAN, the box and odd schemes', () => {
    expect(isFetchableUrl('https://www.seriouseats.com/chili')).toBe(true);
    expect(isFetchableUrl('http://example.com/x')).toBe(true);
    for (const bad of [
      'ftp://example.com/x',
      'javascript:alert(1)',
      'http://localhost:3000/api/state',
      'http://127.0.0.1:3000/',
      'http://10.0.0.5/',
      'http://192.168.1.20:5002/',
      'http://172.20.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://aut-macbookpro181.local:5002/',
      'http://[::1]/',
      'http://intranet/',
      'not a url',
    ]) {
      expect(isFetchableUrl(bad), bad).toBe(false);
    }
  });
});

describe('import routes', () => {
  let app: Hono<any>;
  let cookie: string;
  const fetchPage = vi.fn();
  const extract = vi.fn();
  let claudeOn = false;

  beforeEach(async () => {
    fetchPage.mockReset();
    extract.mockReset();
    claudeOn = false;
    app = createApp({ db: openMemoryDatabase(), importDeps: { fetchPage, extract, claudeOn: () => claudeOn } });
    const res = await app.request('/api/auth/signup', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username: 'christy', password: 'correct horse' }) });
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  });

  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify(body) });

  it('requires a session', async () => {
    const res = await app.request('/api/import/url', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url: 'https://example.com' }) });
    expect(res.status).toBe(401);
  });

  it('reports whether Claude is configured', async () => {
    expect(await json(await app.request('/api/import/status', { headers: { cookie } }))).toEqual({ claude: false });
    claudeOn = true;
    expect(await json(await app.request('/api/import/status', { headers: { cookie } }))).toEqual({ claude: true });
  });

  it('imports a page with structured data without touching Claude', async () => {
    fetchPage.mockResolvedValue({ status: 200, contentType: 'text/html; charset=utf-8', body: structuredPage });
    const res = await post('/api/import/url', { url: 'https://example.com/chili' });
    expect(res.status).toBe(200);
    const { draft } = await json(res);
    expect(draft.source).toBe('structured');
    expect(draft.name).toBe('Site Chili');
    expect(draft.baseServings).toBe(6);
    expect(draft.totalMinutes).toBe(60);
    expect(draft.ingredients.map((i: { name: string }) => i.name)).toEqual(['ground beef', 'kidney beans']);
    expect(draft.sourceUrl).toBe('https://example.com/chili');
    expect(extract).not.toHaveBeenCalled();
  });

  it('refuses LAN addresses before fetching', async () => {
    const res = await post('/api/import/url', { url: 'http://192.168.1.10:5002/api/state' });
    expect(res.status).toBe(400);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('falls back to Claude for pages without structured data when a key is set', async () => {
    claudeOn = true;
    fetchPage.mockResolvedValue({ status: 200, contentType: 'text/html', body: plainPage });
    extract.mockResolvedValue(claudeDraft);
    const res = await post('/api/import/url', { url: 'https://example.com/soup' });
    expect(res.status).toBe(200);
    expect((await json(res)).draft.name).toBe('Claude Soup');
    expect(extract).toHaveBeenCalledWith({ text: "Nana's soup\nSome prose without any structured data.", sourceUrl: 'https://example.com/soup' });
  });

  it('explains what to do for such pages when there is no key', async () => {
    fetchPage.mockResolvedValue({ status: 200, contentType: 'text/html', body: plainPage });
    const res = await post('/api/import/url', { url: 'https://example.com/soup' });
    expect(res.status).toBe(422);
    expect((await json(res)).errors[0]).toMatch(/paste/i);
  });

  it('reports unreachable pages and HTTP errors', async () => {
    fetchPage.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await post('/api/import/url', { url: 'https://example.com/x' })).status).toBe(502);
    fetchPage.mockResolvedValue({ status: 404, contentType: 'text/html', body: '' });
    expect((await post('/api/import/url', { url: 'https://example.com/x' })).status).toBe(502);
  });

  it('parses pasted text by rule without a key and with Claude when available', async () => {
    const text = 'Toast\n2 slices bread\nToast the bread until golden brown, then butter it generously.';
    let res = await post('/api/import/text', { text });
    expect(res.status).toBe(200);
    let { draft } = await json(res);
    expect(draft.source).toBe('text');
    expect(draft.ingredients[0].name).toBe('bread');

    claudeOn = true;
    extract.mockResolvedValue(claudeDraft);
    res = await post('/api/import/text', { text });
    ({ draft } = await json(res));
    expect(draft.source).toBe('claude');
    expect((await post('/api/import/text', { text: '' })).status).toBe(400);
  });

  it('photo import needs a key, validates the upload, and passes Claude errors through', async () => {
    const image = Buffer.from('not really a jpeg').toString('base64');
    expect((await post('/api/import/photo', { image, mediaType: 'image/jpeg' })).status).toBe(503);
    claudeOn = true;
    expect((await post('/api/import/photo', { image, mediaType: 'image/tiff' })).status).toBe(400);
    expect((await post('/api/import/photo', { image: 'not base64!!', mediaType: 'image/jpeg' })).status).toBe(400);
    extract.mockResolvedValue(claudeDraft);
    const ok = await post('/api/import/photo', { image, mediaType: 'image/jpeg' });
    expect(ok.status).toBe(200);
    expect(extract).toHaveBeenCalledWith({ image: { data: image, mediaType: 'image/jpeg' }, text: undefined });
    extract.mockRejectedValue(new ExtractionError(422, 'No recipe was found in that input.'));
    const none = await post('/api/import/photo', { image, mediaType: 'image/jpeg' });
    expect(none.status).toBe(422);
    expect((await json(none)).errors).toEqual(['No recipe was found in that input.']);
  });
});

describe('shopping edits', () => {
  it('round-trips through state', async () => {
    const app = createApp({ db: openMemoryDatabase() });
    const res = await app.request('/api/auth/signup', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username: 'christy', password: 'correct horse' }) });
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    const edits = { extras: [{ id: 'x', name: 'Paper towels', quantity: { amount: 1, unit: 'each' }, section: 'other' }], removed: ['garlic|clove'] };
    const put = await app.request('/api/shopping-edits', { method: 'PUT', headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify(edits) });
    expect(put.status).toBe(200);
    const state = await json(await app.request('/api/state', { headers: { cookie } }));
    expect(state.shoppingEdits).toEqual(edits);
    expect(state.checked).toEqual({});
    const bad = await app.request('/api/shopping-edits', { method: 'PUT', headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify({ extras: 'no', removed: [] }) });
    expect(bad.status).toBe(400);
  });
});
