/** The four figures the colophon genie can form, as dot fields.
 *
 * Technique borrowed from the Octocat field on celox.io: rasterize the shape
 * into an offscreen canvas, then sample the alpha channel on a jittered grid.
 * A silhouette stays a single source of truth that way — no hand-placed dots,
 * and changing the drawing changes the figure.
 *
 * The shapes DRAW themselves instead of shipping path strings: a cup with a
 * handle, steam and a saucer is far easier to get right (and to tweak) with
 * primitives than as one hand-written `d` attribute.
 */

export type GenieShapeKey = 'github' | 'donate' | 'review' | 'share';

/** Draws the figure in white, filling a `size`×`size` context. */
type ShapeDraw = (ctx: CanvasRenderingContext2D, size: number) => void;

/** A sampled point in [-0.5, 0.5] around the figure's centre. */
export type FieldPoint = { x: number; y: number };

/** The Octocat OUTLINE — the cat itself, not the mark in a disc.
 *
 * The 16×16 mark used by the icon fills the circle and knocks the cat out of
 * it: sampled as dots, that reads as a ring, not as a cat. This is the same
 * silhouette the octocat field on celox.io uses, for the same reason.
 */
const OCTOCAT_PATH =
  'M255.8,95.6l0.2-0.9c-21.1-4.2-42.7-4.3-55.8-3.7c2.1-7.7,2.8-16.7,2.8-26.6c0-14.3-5.4-25.7-14-34.3c1.5-4.9,3.5-15.8-2-29.7c0,0-9.8-3.1-32.1,11.8c-8.7-2.2-18-3.3-27.3-3.3c-10.2,0-20.5,1.3-30.2,3.9C74.4-2.9,64.3,0.3,64.3,0.3c-6.6,16.5-2.5,28.8-1.3,31.8c-7.8,8.4-12.5,19.1-12.5,32.2c0,9.9,1.1,18.8,3.9,26.5c-13.2-0.5-34-0.3-54.4,3.8l0.2,0.9c20.4-4.1,41.4-4.2,54.5-3.7c0.6,1.6,1.3,3.2,2,4.7c-13,0.4-35.1,2.1-56.3,8.1l0.3,0.9c21.4-6,43.7-7.6,56.6-8c7.8,14.4,23,23.8,50.2,26.7c-3.9,2.6-7.8,7-9.4,14.5c-5.3,2.5-21.9,8.7-31.9-8.5c0,0-5.6-10.2-16.3-11c0,0-10.4-0.2-0.7,6.5c0,0,6.9,3.3,11.7,15.6c0,0,6.3,21,36.4,14.2V177c0,0-0.6,7.7-7.7,10.2c0,0-4.2,2.9,0.3,4.5c0,0,19.5,1.6,19.5-14.4v-23.6c0,0-0.8-9.4,3.8-12.6v38.8c0,0-0.3,9.3-5.1,12.8c0,0-3.2,5.7,3.8,4.2c0,0,13.4-1.9,14-17.6l0.3-39.3h3.2l0.3,39.3c0.6,15.6,14,17.6,14,17.6c7,1.6,3.8-4.2,3.8-4.2c-4.8-3.5-5.1-12.8-5.1-12.8v-38.5c4.6,3.6,3.8,12.3,3.8,12.3v23.6c0,16,19.5,14.4,19.5,14.4c4.5-1.6,0.3-4.5,0.3-4.5c-7-2.6-7.7-10.2-7.7-10.2v-31c0-12.1-5.1-18.5-10.1-21.8c29-2.9,42.9-12.2,49.3-26.8c12.7,0.3,35.6,1.9,57.4,8.1l0.3-0.9c-21.7-6.1-44.4-7.7-57.3-8.1c0.6-1.5,1.1-3,1.6-4.6C212.9,91.4,234.6,91.4,255.8,95.6L255.8,95.6z';
const OCTOCAT_VB_W = 256;
const OCTOCAT_VB_H = 259.3;

const drawOctocat: ShapeDraw = (ctx, size) => {
  const s = size / Math.max(OCTOCAT_VB_W, OCTOCAT_VB_H);
  ctx.save();
  ctx.translate((size - OCTOCAT_VB_W * s) / 2, (size - OCTOCAT_VB_H * s) / 2);
  ctx.scale(s, s);
  ctx.fill(new Path2D(OCTOCAT_PATH));
  ctx.restore();
};

/** Espresso cup on a saucer, with two curls of steam — the steam doubles as
 *  the genie's own smoke, which is why it is worth the extra strokes. */
const drawEspresso: ShapeDraw = (ctx, size) => {
  const u = size / 100; // author in a 100×100 space
  ctx.save();
  ctx.scale(u, u);
  ctx.translate(0, -6); // the drawing's ink sits low in the box; centre it
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // saucer
  ctx.beginPath();
  ctx.ellipse(50, 80, 34, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // cup body — tapered, rounded at the bottom
  ctx.beginPath();
  ctx.moveTo(29, 42);
  ctx.lineTo(69, 42);
  ctx.lineTo(63, 68);
  ctx.quadraticCurveTo(61, 74, 55, 74);
  ctx.lineTo(43, 74);
  ctx.quadraticCurveTo(37, 74, 35, 68);
  ctx.closePath();
  ctx.fill();

  // rim — a flat ellipse reads as the opening
  ctx.beginPath();
  ctx.ellipse(49, 42, 20, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // handle
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(70, 54, 11, -1.15, 1.15);
  ctx.stroke();

  // steam
  ctx.lineWidth = 3.4;
  for (const [x, height] of [
    [42, 20],
    [56, 14],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x, 34);
    ctx.bezierCurveTo(x - 7, 34 - height * 0.45, x + 7, 34 - height * 0.75, x - 2, 34 - height);
    ctx.stroke();
  }
  ctx.restore();
};

/** Five stars in a row — the rating, not a decoration, so they are uniform. */
const drawStars: ShapeDraw = (ctx, size) => {
  const count = 5;
  const outer = size * 0.09;
  const inner = outer * 0.46;
  const gap = size * 0.2;
  const cy = size / 2;
  const firstX = size / 2 - (gap * (count - 1)) / 2;

  for (let s = 0; s < count; s++) {
    const cx = firstX + s * gap;
    ctx.beginPath();
    for (let i = 0; i < count * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / count;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
};

/** Paper plane — the share card's figure, nose up and to the right.
 *
 * ONE dart with a V-notch cut into its tail, not two overlapping wings in a
 * three-quarter view. Two attempts at the prettier 3/4 fold were tried on
 * screen and both read as a shard: a crease is a LINE, and a line drawn in
 * dots against a dot-filled body is not a line, it is a slightly thinner
 * patch. The notch is a HOLE, and a hole survives being dissolved into dots —
 * which is the only thing that matters here.
 *
 * The notch apex sits closer to the nose than either tail corner; that is what
 * separates a dart from an arrowhead.
 */
const drawPlane: ShapeDraw = (ctx, size) => {
  const u = size / 100;
  ctx.save();
  ctx.scale(u, u);

  // Flat rather than steep: a tall dart hangs its tail down behind the cards
  // and into the field's lower mask, where the tip simply dissolves. In flight
  // a dart is a long, low shape anyway.
  ctx.beginPath();
  ctx.moveTo(94, 26);  // nose
  ctx.lineTo(8, 34);   // upper tail corner
  ctx.lineTo(44, 52);  // notch apex — the V bites back toward the nose
  ctx.lineTo(22, 76);  // lower tail corner
  ctx.closePath();
  ctx.fill();

  ctx.restore();
};

const DRAW: Record<GenieShapeKey, ShapeDraw> = {
  github: drawOctocat,
  donate: drawEspresso,
  review: drawStars,
  share: drawPlane,
};

/** How wide the figure sits inside the field box (1 = full width). Stars are a
 *  wide, flat row; the cat is roughly square; the dart is long and low. */
export const SHAPE_FILL: Record<GenieShapeKey, number> = {
  github: 0.78,
  donate: 0.78,
  review: 1.15,
  // The smallest of the four, and deliberately so: a long diagonal reads much
  // larger than its bounding box suggests. At the cat's 0.78 the dart spanned
  // the whole field and its nose ran off the top edge (measured on screen).
  share: 0.58,
};

const RES = 520;
// Dense enough that a silhouette reads as a figure and not as noise —
// 900 dots spread over a ~350px cat is a smudge. A few thousand fillRects
// per frame is nothing for a 2D canvas.
const MAX_POINTS = 4200;
const ALPHA_HIT = 130;

const cache = new Map<GenieShapeKey, FieldPoint[]>();

/**
 * Points for a figure, normalized to [-0.5, 0.5]. Cached: sampling costs a
 * getImageData over 300² pixels, and a hover must not pay that twice.
 */
export function fieldPoints(key: GenieShapeKey): FieldPoint[] {
  const hit = cache.get(key);
  if (hit) return hit;

  const cv = document.createElement('canvas');
  cv.width = cv.height = RES;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  DRAW[key](ctx, RES);

  const { data } = ctx.getImageData(0, 0, RES, RES);
  let step = 2;
  let pts: FieldPoint[] = [];
  // Coarsen until the figure fits the budget: a dense shape (the cat) ends up
  // with a wider grid than a sparse one (the stars), so all three read at a
  // similar weight instead of the cat drowning the others.
  do {
    pts = [];
    for (let y = 0; y < RES; y += step) {
      for (let x = 0; x < RES; x += step) {
        if (data[(y * RES + x) * 4 + 3] > ALPHA_HIT) {
          pts.push({
            x: (x + (Math.random() - 0.5) * step) / RES - 0.5,
            y: (y + (Math.random() - 0.5) * step) / RES - 0.5,
          });
        }
      }
    }
    step++;
  } while (pts.length > MAX_POINTS && step < 16);

  cache.set(key, pts);
  return pts;
}

/** Sample all three ahead of the first hover (idle time), so the plume never
 *  starts with a rasterization hitch. */
export function prewarmFields(): void {
  (Object.keys(DRAW) as GenieShapeKey[]).forEach(fieldPoints);
}
