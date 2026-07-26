/** Typed API client. Session lives in an httpOnly cookie; CSRF via header. */

import type { AdminStats, AdminUser, AllowlistItem, ApiError, Me, Modus, Preferences, Recipe, RecipeDetail, RecipeListItem, ShoppingItem, GalleryItem, PlanWeek, SubstituteResult, SystemLimits } from './types';

let csrfToken = '';

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function getCsrfToken(): string {
  return csrfToken;
}

export class ApiRequestError extends Error {
  status: number;
  error: ApiError;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.status = status;
    this.error = error;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (init.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    let error: ApiError = { code: 'unknown', message: 'Unbekannter Fehler' };
    try {
      error = (await res.json()).error ?? error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(res.status, error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Admin-configured intro animation for shared links (public setting). */
export type ShareIntroMode = 'motif' | 'crt' | 'off';

export type MeResponse = ({ authenticated: true } & Me) | { authenticated: false };

/** Email/password auth — CSRF-free (no session yet); JSON POST + SameSite=Lax. */
type Ok = { ok: boolean; message?: string };
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  me: () => request<MeResponse>('/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  register: (email: string, password: string, passwordConfirm: string) =>
    post<Ok>('/auth/register', { email, password, password_confirm: passwordConfirm }),
  loginPassword: (email: string, password: string) => post<Ok>('/auth/login', { email, password }),
  verifyEmail: (token: string) => post<{ ok: boolean; first_time: boolean }>('/auth/verify', { token }),
  forgotPassword: (email: string) => post<Ok>('/auth/forgot', { email }),
  resetPassword: (token: string, password: string, passwordConfirm: string) =>
    post<Ok>('/auth/reset', { token, password, password_confirm: passwordConfirm }),
  confirmAdult: () => request<{ adult_confirmed: boolean }>('/me/confirm-adult', { method: 'POST' }),
  putPreferences: (prefs: Preferences) =>
    request<{ preferences: Preferences }>('/me/preferences', { method: 'PUT', body: JSON.stringify(prefs) }),
  setNotiz: (recipeId: number, notiz: string) =>
    request<{ notiz: string }>(`/recipes/${recipeId}/notiz`, { method: 'PATCH', body: JSON.stringify({ notiz }) }),
  markCooked: (recipeId: number) =>
    request<{ gekocht_count: number }>(`/recipes/${recipeId}/gekocht`, { method: 'POST' }),
  deleteRecipe: (recipeId: number) =>
    request<{ deleted: number }>(`/recipes/${recipeId}`, { method: 'DELETE' }),
  feedback: (recipeId: number, wert: 1 | -1, grund = '') =>
    request<{ feedback: number; grund: string }>(`/recipes/${recipeId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ wert, grund }),
    }),

  recipes: (params: { q?: string; mode?: string; gericht_typ?: string; favorites_only?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.mode) qs.set('mode', params.mode);
    if (params.gericht_typ) qs.set('gericht_typ', params.gericht_typ);
    if (params.favorites_only) qs.set('favorites_only', 'true');
    const suffix = qs.size ? `?${qs}` : '';
    return request<{ items: RecipeListItem[] }>(`/recipes${suffix}`);
  },
  recipe: (id: number) => request<RecipeDetail>(`/recipes/${id}`),
  favorite: (id: number, on: boolean) =>
    request<{ is_favorite: boolean }>(`/recipes/${id}/favorite`, { method: on ? 'PUT' : 'DELETE' }),

  shareCreate: (id: number) =>
    request<{ share_token: string; share_url: string }>(`/recipes/${id}/share`, { method: 'POST' }),
  shareRevoke: (id: number) =>
    request<{ share_token: null }>(`/recipes/${id}/share`, { method: 'DELETE' }),
  sharedGet: (token: string) =>
    request<{ mode: Modus; recipe: Recipe; share_token: string; intro: ShareIntroMode }>(`/share/${token}`),
  shareAdopt: (token: string) =>
    request<{ recipe_id: number }>(`/share/${token}/adopt`, { method: 'POST' }),

  shopping: () => request<{ items: ShoppingItem[] }>('/shopping'),
  shoppingFromRecipe: (recipe_id: number, portionen?: number) =>
    request<{ items: ShoppingItem[] }>('/shopping/from-recipe', {
      method: 'POST',
      body: JSON.stringify({ recipe_id, portionen }),
    }),
  shoppingAdd: (name: string) =>
    request<ShoppingItem>('/shopping/items', { method: 'POST', body: JSON.stringify({ name }) }),
  shoppingCheck: (id: number, checked: boolean) =>
    request<ShoppingItem>(`/shopping/items/${id}`, { method: 'PATCH', body: JSON.stringify({ checked }) }),
  shoppingDelete: (id: number) => request<{ deleted: boolean }>(`/shopping/items/${id}`, { method: 'DELETE' }),
  shoppingReorder: (ids: number[]) =>
    request<{ items: ShoppingItem[] }>('/shopping/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
  shoppingClearChecked: () =>
    request<{ items: ShoppingItem[] }>('/shopping/checked', { method: 'DELETE' }),
  shoppingClearAll: () => request<{ items: ShoppingItem[] }>('/shopping', { method: 'DELETE' }),

  adminStats: (days = 30) => request<AdminStats>(`/admin/stats?days=${days}`),
  planWeek: (start?: string) => request<PlanWeek>(`/plan${start ? `?start=${start}` : ''}`),
  planAdd: (datum: string, recipe_id: number) =>
    request<{ id: number }>('/plan', { method: 'POST', body: JSON.stringify({ datum, recipe_id }) }),
  planRemove: (id: number) => request<{ deleted: number }>(`/plan/${id}`, { method: 'DELETE' }),
  planToShopping: (start: string) =>
    request<{ added_recipes: number }>('/plan/to-shopping', { method: 'POST', body: JSON.stringify({ start }) }),
  fridgeScan: (image: string, media_type = 'image/jpeg') =>
    request<{ zutaten: string[] }>('/recipes/fridge-scan', { method: 'POST', body: JSON.stringify({ image, media_type }) }),
  substitute: (recipeId: number, zutat: string) =>
    request<SubstituteResult>(`/recipes/${recipeId}/substitute`, { method: 'POST', body: JSON.stringify({ zutat }) }),
  sharePublic: (id: number, pub: boolean) =>
    request<{ public: boolean }>(`/recipes/${id}/share`, { method: 'PATCH', body: JSON.stringify({ public: pub }) }),
  discover: () => request<{ items: GalleryItem[] }>('/share/discover'),
  daily: () => request<{ item: GalleryItem | null }>('/share/daily'),
  adminAllowlist: () => request<{ items: AllowlistItem[] }>('/admin/allowlist'),
  adminAllowlistAdd: (email: string) =>
    request<{ email: string }>('/admin/allowlist', { method: 'POST', body: JSON.stringify({ email }) }),
  adminAllowlistRemove: (email: string) =>
    request<{ deleted: string }>(`/admin/allowlist/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  adminUsers: () => request<{ default_limit: number; items: AdminUser[] }>('/admin/users'),
  adminSetUserLimit: (id: number, daily_limit: number | null) =>
    request<{ id: number; daily_limit: number | null }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ daily_limit }),
    }),
  adminLimits: () => request<SystemLimits>('/admin/limits'),
  adminSetLimits: (patch: Partial<Omit<SystemLimits, 'registrations_today'>>) =>
    request<SystemLimits>('/admin/limits', { method: 'PATCH', body: JSON.stringify(patch) }),
  shoppingReplace: (items: Pick<ShoppingItem, 'name' | 'menge' | 'einheit' | 'checked'>[]) =>
    request<{ items: ShoppingItem[] }>('/shopping/replace', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
};
