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
  if (dir) document.documentElement.dataset.tabDir = dir;
  else delete document.documentElement.dataset.tabDir;
}

/** Remove the stamp — called by the shell after the transition and by every
 *  card→detail navigation before it starts. Safe to call when absent. */
export function clearTabTransition(): void {
  delete document.documentElement.dataset.tabDir;
}

/** How long the stamp may outlive its navigation. Longer than the longest
 *  tab animation (300 ms + 70 ms stagger), short enough to be gone before a
 *  human plausibly starts the next unrelated navigation. */
export const TAB_DIR_TTL_MS = 650;
