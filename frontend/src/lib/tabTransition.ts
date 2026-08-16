/** Direction-aware tab transitions.
 *
 * The bottom nav has an order, and moving through it should feel like moving:
 * a switch to a tab further right slides the content leftwards, and back
 * again the other way. The browser's view transition does the animating —
 * this module only answers "which way?" and stamps the answer onto <html> as
 * `data-tab-dir`, where the CSS in base.css picks it up.
 *
 * The stamp must be on the element BEFORE react-router calls
 * startViewTransition (the old snapshot is taken with the attribute already
 * present), which is why the nav's onClick calls markTabTransition() rather
 * than an effect doing it after the route change. Same pre-snapshot pattern
 * as `data-theme` in the theme reveal.
 *
 * The attribute must also never leak into a different transition: a stale
 * `data-tab-dir` would make the card→detail morph slide sideways, and it
 * scopes the view-transition-names of title/tools (see base.css), which are
 * not allowed to exist during a detail morph. Three guards:
 *   1. it is only ever set by a bottom-nav click,
 *   2. the shell clears it once the transition is over (location effect),
 *   3. every card→detail entry point calls clearTabTransition() first.
 */

export type TabDir = 'fwd' | 'back';

/** Bottom-nav destinations in visual order. Must match NAV_ITEMS in App.tsx —
 *  pinned against it by a unit test, not by discipline. */
export const TAB_ORDER = ['/', '/favoriten', '/verlauf', '/einkauf', '/plan'];

/**
 * Which way does a navigation move through the tab bar?
 * `null` when there is no spatial answer: same tab, or coming from a route
 * that is not a tab (e.g. the recipe detail) — those keep the plain fade.
 */
export function tabDirection(from: string, to: string): TabDir | null {
  const a = TAB_ORDER.indexOf(from);
  const b = TAB_ORDER.indexOf(to);
  if (a === -1 || b === -1 || a === b) return null;
  return b > a ? 'fwd' : 'back';
}

/** Stamp the direction for the upcoming navigation (or clear, if there is none). */
export function markTabTransition(from: string, to: string): void {
  const dir = tabDirection(from, to);
  if (dir) {
    document.documentElement.dataset.tabDir = dir;
    nameVisibleCards(); // the OLD side of the cross-tab card morph
  } else {
    clearTabTransition();
  }
}

/** Remove the stamp — called by the shell after the transition and by every
 *  card→detail navigation before it starts. Safe to call when absent.
 *  Also strips the cross-tab card names: a card→detail morph that inherits
 *  eight named card layers is exactly the perf trap the "only the clicked
 *  card is named" rule exists for. */
export function clearTabTransition(): void {
  delete document.documentElement.dataset.tabDir;
  clearCardNames();
}

/* ── Cross-tab card morphs (Favoriten ↔ Verlauf) ─────────────────────────
   The one place where tabs genuinely share elements: the same recipes appear
   in both lists. During a tab switch the visible cards get per-recipe names
   (`zk-card-<id>`), so a recipe present on both sides FLIES to its new
   position while unshared cards fade — the list re-sorting itself.

   Only the OLD side can be named here: the new page does not exist yet at
   click time. It names itself at render (RecipeCard reads the stamp during
   react-router's synchronous view-transition render) — pairing needs both.

   Capped and viewport-filtered: every named element is its own snapshot
   layer, and an unbounded list is the documented mobile perf trap. */
export const CARD_MORPH_CAP = 8;

function nameVisibleCards(): void {
  const vh = window.innerHeight;
  let named = 0;
  for (const el of document.querySelectorAll<HTMLElement>('.recipecard[data-card-id]')) {
    if (named >= CARD_MORPH_CAP) break;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) continue; // off-screen cards ride the root
    el.style.viewTransitionName = `zk-card-${el.dataset.cardId}`;
    named += 1;
  }
  // Self-cleaning: if the click never becomes a navigation (or the shell's
  // cleanup never fires), the names must not survive into the next morph.
  if (named) window.setTimeout(clearCardNames, TAB_DIR_TTL_MS);
}

export function clearCardNames(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.recipecard[data-card-id]'))
    el.style.removeProperty('view-transition-name');
}

/** How long the stamp may outlive its navigation. Longer than the longest
 *  tab animation (300 ms + 70 ms stagger), short enough to be gone before a
 *  human plausibly starts the next unrelated navigation. */
export const TAB_DIR_TTL_MS = 650;
