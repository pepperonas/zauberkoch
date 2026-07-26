/** API types — mirror backend/app/schemas/recipe.py */

export type Modus = 'kochen' | 'cocktail';
export type Schwierigkeit = 'einfach' | 'mittel' | 'anspruchsvoll';

export interface Zutat {
  menge: number | string | null;
  einheit: string;
  name: string;
  gruppe: string;
}

export interface Schritt {
  nr: number;
  titel: string;
  text: string;
  dauer_sek: number | null;
}

export interface Naehrwerte {
  kalorien_kcal: number | null;
  eiweiss_g: number | null;
  fett_g: number | null;
  kohlenhydrate_g: number | null;
}

export interface Recipe {
  titel: string;
  teaser: string;
  kueche: string;
  tags: string[];
  portionen: number;
  zeit_aktiv: number;
  zeit_gesamt: number;
  schwierigkeit: Schwierigkeit;
  zutaten: Zutat[];
  schritte: Schritt[];
  tipps: string[];
  naehrwerte: Naehrwerte | null;
  glas: string | null;
  garnitur: string | null;
}

export interface RecipeMeta {
  titel: string;
  teaser: string;
  kueche: string;
  tags: string[];
  portionen: number;
  zeit_aktiv: number;
  zeit_gesamt: number;
  schwierigkeit: Schwierigkeit;
}

export interface GenerateParams {
  modus: Modus;
  kueche?: string;
  kueche_freitext?: string;
  gericht_typ?: string;
  geschmack?: string[];
  vegetarisch?: boolean;
  vegan?: boolean;
  glutenfrei?: boolean;
  laktosefrei?: boolean;
  proteinreich?: boolean;
  ketogen?: boolean;
  max_zeit_min?: number | null;
  schwierigkeit?: Schwierigkeit | null;
  personen?: number;
  vorhandene_zutaten?: string[];
  drink_typ?: string;
  basis_spirituose?: string;
  alkoholfrei?: boolean;
  glas_vorgabe?: string;
  ueberrasch_mich?: boolean;
  regenerate?: boolean;
}

export interface Preferences {
  vegetarisch: boolean;
  vegan: boolean;
  glutenfrei: boolean;
  laktosefrei: boolean;
  proteinreich?: boolean;
  ketogen?: boolean;
  vermeiden: string[];
  standard_personen: number;
  /** Personalized wizard cuisine chips (empty = app defaults). */
  kuechen?: string[];
  /** Pantry staples — pre-selected chips in the wizard's fridge step. */
  vorraete?: string[];
}

export interface Me {
  is_admin: boolean;
  id: number;
  email: string;
  name: string;
  picture_url: string;
  adult_confirmed: boolean;
  csrf_token: string;
  preferences: Preferences;
}

export interface RecipeListItem {
  id: number;
  mode: Modus;
  titel: string;
  teaser: string;
  kueche: string;
  gericht_typ?: string;
  tags: string[];
  zeit_gesamt: number | null;
  schwierigkeit: Schwierigkeit | null;
  glas?: string | null;
  is_favorite: boolean;
  created_at: string;
}

export interface RecipeDetail {
  id: number;
  mode: Modus;
  recipe: Recipe;
  is_favorite: boolean;
  public_listed?: boolean;
  shared?: boolean;
  feedback: number | null;
  notiz: string;
  gekocht_count: number;
  created_at: string;
}

export interface ShoppingItem {
  id: number;
  name: string;
  menge: number | null;
  einheit: string;
  checked: boolean;
  position: number;
}

export interface ApiError {
  code: string;
  message: string;
  retry_after?: number;
}

export interface AdminStats {
  days: number;
  generations: { total: number; live: number; cached: number; errors: number };
  tokens: { in: number; out: number; cache_read: number; cache_write: number };
  cache_hit_rate: number;
  cost_usd: number;
  median_duration_ms: number;
  daily: { day: string; gens: number; cost_usd: number }[];
  per_user: { email: string; count: number; series: number[] }[];
  feedback: Record<string, { up: number; down: number }>;
  limits: { per_user: number; global: number };
}

export interface AllowlistItem {
  email: string;
  registered: boolean;
  created_at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  daily_limit: number | null; // null = uses the global default
  effective_limit: number;
  used_today: number;
  is_admin: boolean;
  created_at: string;
}

export interface SystemLimits {
  /** Intro animation on shared-recipe links: motif | crt | off */
  share_intro: 'motif' | 'crt' | 'off';
  default_user_limit: number;
  global_daily_limit: number;
  registration_daily_limit: number;
  anon_ip_limit: number;
  anon_global_limit: number;
  open_signup: boolean;
  registrations_today: number;
}

export interface GalleryItem {
  token: string;
  titel: string;
  teaser: string;
  kueche: string;
  mode: Modus;
  glas?: string | null;
  zeit_gesamt?: number | null;
  schwierigkeit?: string | null;
  tags: string[];
}

export interface PlanEntry {
  id: number;
  recipe_id: number;
  titel: string;
  kueche: string;
  mode: Modus;
  glas?: string | null;
  tags: string[];
  zeit_gesamt?: number | null;
}

export interface PlanWeek {
  start: string;
  days: { datum: string; entries: PlanEntry[] }[];
}

export interface SubstituteResult {
  alternativen: { name: string; hinweis: string }[];
}
