import { Hono } from 'hono';
import { draftFromSchemaRecipe, draftFromText, extractJsonLdRecipe, htmlToText, type RecipeDraft } from '../src/domain/importRecipe';
import { isHttpUrl } from '../src/domain/recipeInput';
import { claudeAvailable, ExtractionError, extractRecipeWithClaude, fetchPageTextWithClaude, type ImageMediaType } from './claude';

/**
 * Recipe import: a web page, pasted text, or a photo, each to a RecipeDraft the
 * form shows for review. Web pages use their structured data (schema.org
 * Recipe) when present, so most big recipe sites never need the API; Claude
 * handles the rest and all photos.
 */

export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TEXT_CHARS = 100_000;
export const MAX_IMAGE_BASE64 = 7 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const IMAGE_TYPES: ImageMediaType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** True for addresses the server may fetch: public http(s) hosts only, nothing on the LAN or the box itself. */
export function isFetchableUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home')) return false;
  if (host.includes(':')) return false; // IPv6 literal: not a recipe site
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224) return false;
  }
  return host.includes('.');
}

export interface ImportDeps {
  /** Injectable for tests. */
  fetchPage?: (url: string) => Promise<{ status: number; contentType: string; body: string }>;
  extract?: typeof extractRecipeWithClaude;
  /** Reads a page through Claude's web fetch tool when the site refuses the box. */
  fetchViaClaude?: typeof fetchPageTextWithClaude;
  claudeOn?: () => boolean;
}

/** Looks like a browser: some recipe sites answer 402/403 to anything that does not. */
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

async function defaultFetchPage(url: string): Promise<{ status: number; contentType: string; body: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: BROWSER_HEADERS,
  });
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_PAGE_BYTES) throw new ExtractionError(422, 'That page is too large to read.');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_PAGE_BYTES) throw new ExtractionError(422, 'That page is too large to read.');
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: new TextDecoder().decode(buf) };
}

export function createImportRoutes(deps: ImportDeps = {}): Hono {
  const fetchPage = deps.fetchPage ?? defaultFetchPage;
  const extract = deps.extract ?? extractRecipeWithClaude;
  const fetchViaClaude = deps.fetchViaClaude ?? fetchPageTextWithClaude;
  const claudeOn = deps.claudeOn ?? claudeAvailable;
  const routes = new Hono();

  routes.get('/status', (c) => c.json({ claude: claudeOn() }));

  routes.post('/url', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { url?: unknown } | undefined;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!isFetchableUrl(url)) return c.json({ errors: ['Enter a full web address, like https://example.com/recipe.'] }, 400);
    let page: { status: number; contentType: string; body: string } | undefined;
    try {
      page = await fetchPage(url);
    } catch (err) {
      if (err instanceof ExtractionError) return c.json({ errors: [err.message] }, err.status as 422);
      if (!claudeOn()) return c.json({ errors: ['Could not load that page. Check the address and that the box has internet access.'] }, 502);
    }
    // The site refused the box (bot blocking: 401/402/403/429) or never answered: let Claude's
    // own fetcher try, then extract from whatever text it read.
    const refused = page === undefined || page.status === 401 || page.status === 402 || page.status === 403 || page.status === 429;
    if (refused && claudeOn()) {
      try {
        const text = await fetchViaClaude(url);
        return c.json({ draft: await extract({ text, sourceUrl: url }) });
      } catch (err) {
        if (err instanceof ExtractionError) return c.json({ errors: [err.message] }, err.status as 422);
        throw err;
      }
    }
    if (page === undefined || page.status >= 400) {
      const code = page?.status ?? 'no answer';
      return c.json({ errors: [`That site would not give us the page (${code}). Copy the recipe text and paste it instead.`] }, 502);
    }
    if (!/html|xml|text\/plain/i.test(page.contentType) && page.contentType !== '') {
      return c.json({ errors: ['That address is not a web page.'] }, 422);
    }
    const structured = extractJsonLdRecipe(page.body);
    if (structured) {
      const draft = draftFromSchemaRecipe(structured, url);
      if (draft.ingredients.length > 0) return c.json({ draft });
    }
    if (claudeOn()) {
      try {
        return c.json({ draft: await extract({ text: htmlToText(page.body), sourceUrl: url }) });
      } catch (err) {
        if (err instanceof ExtractionError) return c.json({ errors: [err.message] }, err.status as 422);
        throw err;
      }
    }
    return c.json({ errors: ['That page does not publish recipe data. Copy the recipe text and paste it instead.'] }, 422);
  });

  routes.post('/text', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { text?: unknown } | undefined;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (text.length === 0) return c.json({ errors: ['Paste the recipe text first.'] }, 400);
    if (text.length > MAX_TEXT_CHARS) return c.json({ errors: ['That is too much text for one recipe.'] }, 400);
    if (claudeOn()) {
      try {
        return c.json({ draft: await extract({ text }) });
      } catch (err) {
        if (err instanceof ExtractionError) return c.json({ errors: [err.message] }, err.status as 422);
        throw err;
      }
    }
    const draft: RecipeDraft = draftFromText(text);
    return c.json({ draft });
  });

  routes.post('/photo', async (c) => {
    if (!claudeOn()) return c.json({ errors: ['Photo import is off: the server has no ANTHROPIC_API_KEY.'] }, 503);
    const body = (await c.req.json().catch(() => undefined)) as { image?: unknown; mediaType?: unknown; notes?: unknown } | undefined;
    const image = typeof body?.image === 'string' ? body.image : '';
    const mediaType = typeof body?.mediaType === 'string' ? body.mediaType : '';
    if (!image || !/^[A-Za-z0-9+/=]+$/.test(image)) return c.json({ errors: ['No photo received.'] }, 400);
    if (image.length > MAX_IMAGE_BASE64) return c.json({ errors: ['That photo is too large. Try a smaller one.'] }, 400);
    if (!(IMAGE_TYPES as string[]).includes(mediaType)) return c.json({ errors: ['Use a JPEG, PNG, WebP or GIF photo.'] }, 400);
    try {
      const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : undefined;
      return c.json({ draft: await extract({ image: { data: image, mediaType: mediaType as ImageMediaType }, text: notes }) });
    } catch (err) {
      if (err instanceof ExtractionError) return c.json({ errors: [err.message] }, err.status as 422);
      throw err;
    }
  });

  return routes;
}
