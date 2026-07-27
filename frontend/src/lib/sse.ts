/** Recipe generation stream: fetch + ReadableStream SSE parsing.
 * (EventSource can't POST or send the CSRF header, so we parse manually.)
 */

import { getCsrfToken } from './api';
import type { ApiError, GenerateParams, Recipe, RecipeMeta, Schritt, Zutat } from './types';

export interface StreamCallbacks {
  onMeta?: (meta: RecipeMeta) => void;
  onZutat?: (zutat: Zutat) => void;
  onSchritt?: (schritt: Schritt) => void;
  onTipp?: (tipp: string) => void;
  onDone?: (recipe: Recipe) => void;
  onSaved?: (info: { recipe_id: number; cached: boolean; remaining: number | null; unlimited?: boolean }) => void;
  onError?: (error: ApiError) => void;
}

/** Start a generation stream. Returns an abort function. */
export function streamRecipe(params: GenerateParams, callbacks: StreamCallbacks): () => void {
  return streamSSE('/api/v1/recipes/generate', params, callbacks);
}

/** Logged-out taster generation (landing page) — no auth, no persistence. */
export function tryRecipe(params: GenerateParams, callbacks: StreamCallbacks): () => void {
  return streamSSE('/api/v1/recipes/try', params, callbacks);
}

/** Adapt an existing recipe ("schärfer", "ohne Ofen" …) — same event stream. */
export function adaptRecipe(recipeId: number, anweisung: string, callbacks: StreamCallbacks): () => void {
  return streamSSE(`/api/v1/recipes/${recipeId}/adapt`, { anweisung }, callbacks);
}

function streamSSE(url: string, body: unknown, callbacks: StreamCallbacks): () => void {
  const controller = new AbortController();

  void (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify(body),
        credentials: 'same-origin',
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let error: ApiError = { code: 'stream_failed', message: 'Stream fehlgeschlagen' };
        try {
          error = (await res.json()).error ?? error;
        } catch {
          /* ignore */
        }
        callbacks.onError?.(error);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const dispatch = (block: string) => {
        let event = '';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (!event || !data) return;
        const payload: unknown = JSON.parse(data);
        switch (event) {
          case 'meta':
            callbacks.onMeta?.(payload as RecipeMeta);
            break;
          case 'zutat':
            callbacks.onZutat?.(payload as Zutat);
            break;
          case 'schritt':
            callbacks.onSchritt?.(payload as Schritt);
            break;
          case 'tipp':
            callbacks.onTipp?.(payload as string);
            break;
          case 'done':
            callbacks.onDone?.(payload as Recipe);
            break;
          case 'saved':
            callbacks.onSaved?.(payload as { recipe_id: number; cached: boolean; remaining: number | null; unlimited?: boolean });
            break;
          case 'error':
            callbacks.onError?.(payload as ApiError);
            break;
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          dispatch(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        callbacks.onError?.({ code: 'network', message: 'Verbindung unterbrochen' });
      }
    }
  })();

  return () => controller.abort();
}
