import type { Recipe, RecipeDraft, RecipeInput, ShoppingEdits, WeekPlan } from '../domain';

/**
 * The browser's only way to the server. Every call is same-origin JSON with the
 * session cookie. Failures become `ApiError`s: `status` 0 means the request
 * never got an answer (server down, Wi-Fi gone), 4xx carries the server's
 * `errors` list ready to show.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];

  constructor(status: number, errors: string[]) {
    super(errors[0] ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }

  /** True when retrying the same request later could succeed. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface User {
  id: number;
  username: string;
}

export interface UserState {
  plan: WeekPlan;
  checked: Record<string, boolean>;
  shoppingEdits: ShoppingEdits;
}

export type PhotoMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, ['Cannot reach the server.']);
  }
  if (res.status === 204) return undefined as T;
  let payload: unknown = undefined;
  try {
    payload = await res.json();
  } catch {
    // non-JSON body (proxy error page); handled below
  }
  if (!res.ok) {
    const p = payload as { errors?: unknown; error?: unknown } | undefined;
    const errors = Array.isArray(p?.errors)
      ? (p.errors as unknown[]).filter((e): e is string => typeof e === 'string')
      : typeof p?.error === 'string'
        ? [p.error]
        : [`Request failed (${res.status})`];
    throw new ApiError(res.status, errors);
  }
  return payload as T;
}

export const api = {
  me: () => request<{ user: User }>('GET', '/api/auth/me').then((r) => r.user),
  signup: (username: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/signup', { username, password }).then((r) => r.user),
  login: (username: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/login', { username, password }).then((r) => r.user),
  logout: () => request<void>('POST', '/api/auth/logout', {}),

  listRecipes: () => request<{ recipes: Recipe[] }>('GET', '/api/recipes').then((r) => r.recipes),
  createRecipe: (input: RecipeInput) =>
    request<{ recipe: Recipe }>('POST', '/api/recipes', input).then((r) => r.recipe),
  updateRecipe: (id: string, input: RecipeInput) =>
    request<{ recipe: Recipe }>('PUT', `/api/recipes/${encodeURIComponent(id)}`, input).then((r) => r.recipe),
  deleteRecipe: (id: string) => request<void>('DELETE', `/api/recipes/${encodeURIComponent(id)}`),

  state: () => request<UserState>('GET', '/api/state'),
  savePlan: (plan: WeekPlan) => request<{ ok: true }>('PUT', '/api/plan', plan).then(() => undefined),
  saveChecked: (checked: Record<string, boolean>) =>
    request<{ ok: true }>('PUT', '/api/checked', checked).then(() => undefined),
  saveShoppingEdits: (edits: ShoppingEdits) =>
    request<{ ok: true }>('PUT', '/api/shopping-edits', edits).then(() => undefined),

  importStatus: () => request<{ claude: boolean }>('GET', '/api/import/status'),
  importUrl: (url: string) => request<{ draft: RecipeDraft }>('POST', '/api/import/url', { url }).then((r) => r.draft),
  importText: (text: string) => request<{ draft: RecipeDraft }>('POST', '/api/import/text', { text }).then((r) => r.draft),
  importPhoto: (image: string, mediaType: PhotoMediaType, notes?: string) =>
    request<{ draft: RecipeDraft }>('POST', '/api/import/photo', { image, mediaType, notes }).then((r) => r.draft),
};
