/** The Google profile picture in the header.
 *
 * Google hands us a URL whose LAST path segment carries display options, e.g.
 * `…/a/ACg8ocJzIP…=s96-c` — `s96` is the pixel size it will render, `c` crops
 * to a square. The size is baked into the URL, so asking for the right one is
 * the only way to get a sharp picture: the slot is 34 CSS px, which on a
 * phone at devicePixelRatio 3 is 102 device pixels — more than the 96 Google
 * sends by default. The stock URL is therefore always slightly upscaled, and
 * measurably softer than a size-matched one (A/B at DPR 3, 2026-09-24).
 */

/** Largest size we will ever ask Google for — a header avatar that needs more
 *  than this is a layout bug, and an unbounded number in a URL we hand to a
 *  third party is not something to leave open. */
const MAX_PX = 512;

/**
 * Rewrite a Google avatar URL to the size the slot actually needs.
 *
 * Anything that is not a googleusercontent.com URL is returned untouched — we
 * only understand THIS provider's option syntax, and rewriting a stranger's
 * URL on a guess would corrupt it. A URL without a size token is also left
 * alone: appending options to an unknown option block is how you get a 404.
 *
 * @param cssPx  the rendered box in CSS pixels
 * @param dpr    device pixel ratio; defaults to the current screen
 */
export function avatarSrc(url: string, cssPx: number, dpr?: number): string {
  if (!url) return url;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return url; // not a URL we can reason about
  }
  if (!/(^|\.)googleusercontent\.com$/i.test(hostname)) return url;

  const ratio = dpr ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const want = Math.min(MAX_PX, Math.max(1, Math.ceil(cssPx * ratio)));

  // Only the `sNNN` option, and only where it stands as its own segment —
  // `=s96-c` keeps its `-c`, so the picture stays cropped to a square.
  return url.replace(/=s\d+(?=-|$)/, `=s${want}`);
}
