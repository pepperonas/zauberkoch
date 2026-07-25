/** Global generation store — the SSE stream lives OUTSIDE React so a running
 * generation survives SPA navigation. Pages subscribe via useGeneration();
 * the floating GenerationPill lets the user jump back to a running/finished run.
 */

import { useSyncExternalStore } from 'react';

import type { RecipeViewData } from '../components/recipe/RecipeView';
import { adaptRecipe, streamRecipe, type StreamCallbacks } from '../lib/sse';
import type { ApiError, GenerateParams, Modus } from '../lib/types';
import { recordGeneration } from './supportPrompt';

export type GenPhase = 'idle' | 'streaming' | 'done' | 'limit';
export type GenEvent = 'start' | 'meta' | 'zutat' | 'schritt' | 'tipp' | 'done' | 'saved' | 'error';

export interface GenerationState {
  phase: GenPhase;
  /** Mode the generation was started with (global mode may change meanwhile). */
  mode: Modus;
  data: RecipeViewData;
  recipeId: number | null;
  isFavorite: boolean;
  remaining: number | null;
  error: ApiError | null;
  lastEvent: GenEvent;
  /** False until the user has looked at the finished result (drives the pill). */
  seen: boolean;
  /** True when the last run came from wizard params (enables "Neu zaubern"). */
  canRegenerate: boolean;
}

export type Runner = (cb: StreamCallbacks) => () => void;

interface StartOpts {
  params?: GenerateParams;
  onSaved?: () => void;
}

const EMPTY_DATA: RecipeViewData = { meta: null, zutaten: [], schritte: [], tipps: [] };

const IDLE: GenerationState = {
  phase: 'idle',
  mode: 'kochen',
  data: EMPTY_DATA,
  recipeId: null,
  isFavorite: false,
  remaining: null,
  error: null,
  lastEvent: 'start',
  seen: true,
  canRegenerate: false,
};

let state: GenerationState = IDLE;
let abort: (() => void) | null = null;
let lastRunner: Runner | null = null;
let lastMode: Modus = 'kochen';
let lastParams: GenerateParams | null = null;
let lastOnSaved: (() => void) | undefined;
const listeners = new Set<() => void>();

function set(patch: Partial<GenerationState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function startGeneration(runner: Runner, mode: Modus, opts: StartOpts = {}): void {
  abort?.();
  lastRunner = runner;
  lastMode = mode;
  lastParams = opts.params ?? null;
  lastOnSaved = opts.onSaved;
  set({
    phase: 'streaming',
    mode,
    data: EMPTY_DATA,
    recipeId: null,
    isFavorite: false,
    error: null,
    lastEvent: 'start',
    seen: false,
    canRegenerate: lastParams != null,
  });
  abort = runner({
    onMeta: (meta) => set({ data: { ...state.data, meta }, lastEvent: 'meta' }),
    onZutat: (z) => set({ data: { ...state.data, zutaten: [...state.data.zutaten, z] }, lastEvent: 'zutat' }),
    onSchritt: (s) => set({ data: { ...state.data, schritte: [...state.data.schritte, s] }, lastEvent: 'schritt' }),
    onTipp: (tip) => set({ data: { ...state.data, tipps: [...state.data.tipps, tip] }, lastEvent: 'tipp' }),
    onDone: (recipe) =>
      set({
        data: {
          meta: recipe,
          zutaten: recipe.zutaten,
          schritte: recipe.schritte,
          tipps: recipe.tipps,
          naehrwerte: recipe.naehrwerte,
          glas: recipe.glas,
          garnitur: recipe.garnitur,
        },
        lastEvent: 'done',
      }),
    onSaved: (info) => {
      set({ phase: 'done', recipeId: info.recipe_id, remaining: info.remaining, lastEvent: 'saved' });
      recordGeneration(); // feeds the gentle "support Zauberkoch" nudge
      lastOnSaved?.();
    },
    onError: (error) =>
      set(
        error.code.startsWith('daily_limit')
          ? { phase: 'limit', error, lastEvent: 'error' }
          : { phase: 'done', error, lastEvent: 'error' },
      ),
  });
}

/** Wizard-driven generation (remembers params for "Neu zaubern"). */
export function startRecipeGeneration(params: GenerateParams, onSaved?: () => void): void {
  startGeneration((cb) => streamRecipe(params, cb), params.modus, { params, onSaved });
}

/** Adapt an existing recipe — same stream, no regenerate params. */
export function startAdaptGeneration(recipeId: number, anweisung: string, mode: Modus, onSaved?: () => void): void {
  startGeneration((cb) => adaptRecipe(recipeId, anweisung, cb), mode, { onSaved });
}

/** Re-run the exact last runner (retry after an error). */
export function retryGeneration(): void {
  if (lastRunner) startGeneration(lastRunner, lastMode, { params: lastParams ?? undefined, onSaved: lastOnSaved });
}

/** Fresh roll of the dice with the remembered wizard params. */
export function regenerateGeneration(): void {
  if (lastParams) startRecipeGeneration({ ...lastParams, regenerate: true }, lastOnSaved);
}

/** Abort a running stream (or dismiss a finished one) — back to idle. */
export function cancelGeneration(): void {
  abort?.();
  abort = null;
  set({ ...IDLE, remaining: state.remaining });
}

export function markGenerationSeen(): void {
  if (!state.seen) set({ seen: true });
}

export function setGenerationFavorite(value: boolean): void {
  set({ isFavorite: value });
}

export function getGeneration(): GenerationState {
  return state;
}

export function subscribeGeneration(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGeneration(): GenerationState {
  return useSyncExternalStore(subscribeGeneration, getGeneration);
}
