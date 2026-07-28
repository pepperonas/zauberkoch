/** The colophon genie: hovering a card releases a swirling column of dots from
 * its icon, which climbs, unfurls and settles into a figure behind the footer.
 * Moving to a neighbouring card does NOT swap figures — the dots fly across and
 * re-form into the new one.
 *
 * The dot-silhouette idea and the idle character come from the Octocat field on
 * celox.io — breathing drift, a brightness wave travelling across the figure,
 * and a cursor that shoves nearby dots aside while they flare up. Two things
 * are deliberately different:
 *
 *  - **No Three.js.** A footer flourish must not cost 150 kB and a WebGL
 *    context. 2D canvas draws a few thousand quads per frame without noticing.
 *  - **A genie leaving a bottle, not a cloud settling.** Every particle flies a
 *    quadratic Bézier whose control point sits high above the icon and is
 *    almost the SAME for all of them: they leave as one narrow column and only
 *    fan out into the figure near the end. That shared control point is the
 *    whole trick — a straight origin→target path with a bit of swirl (the first
 *    attempt) just looks like dots appearing.
 *
 * ONE mechanism drives all three transitions, which is what makes switching
 * cards mid-flight behave: every particle has a from-point, a control point and
 * a target, and a single progress moves it along that curve. Appearing is "all
 * particles come from the bottle", leaving is "all of them go back into it",
 * and a figure change is "each keeps flying, to a new address". A particle that
 * is retargeted mid-flight simply starts its next curve where it currently is.
 *
 * Runs only where hover exists and motion is welcome, and the rAF loop stops
 * dead once the field is empty — an idle page must not paint.
 */

import { useEffect, useRef } from 'react';

import { fieldPoints, SHAPE_FILL, type GenieShapeKey } from './genieShapes';

// -- transitions ------------------------------------------------------------
/** Rising out of the bottle. Long enough that the climb is a movement you
 *  watch, not a state you find already finished. */
const DUR_IN_MS = 1150;
/** Figure → figure. Shorter than the entrance: the dots are already on stage,
 *  and the eye is following a change, not waiting for an arrival. */
const DUR_MORPH_MS = 780;
const DUR_OUT_MS = 520;
/** How far above the icon the column climbs before unfurling (px). */
const RISE = 165;
/** Spread of the shared control point, so the column is a plume, not a wire. */
const CTRL_JITTER_X = 22;
const CTRL_JITTER_Y = 34;
/** Sideways bow and lift of a figure→figure flight. Signed per particle, so the
 *  swarm swings both ways and crosses itself instead of sliding as a block. */
const MORPH_ARC = 62;
const MORPH_LIFT = 46;
/** Latest a particle may start, as a fraction of progress — the stagger is what
 *  turns a moving cloud into a stream (and a morph into a ripple). */
const MAX_DELAY_IN = 0.5;
const MAX_DELAY_MORPH = 0.34;
/** Sideways swirl around the flight path, widest at half flight. */
const SWIRL_MIN = 10;
const SWIRL_MAX = 34;
const TURNS_MIN = 0.4;
const TURNS_MAX = 1.3;

// -- idle (ported from the celox octocat field) -----------------------------
/** Breathing drift, px. */
const DRIFT_MIN = 1.2;
const DRIFT_MAX = 3.4;
const DRIFT_SPEED_X = 0.0008;
const DRIFT_SPEED_Y = 0.0007;
/** Brightness wave sweeping across the figure — it reads the particle's own x,
 *  so the shimmer travels instead of twinkling at random. */
const WAVE_SPEED = 0.0009;
const WAVE_ACROSS = 0.012;
const WAVE_DEPTH = 0.28;
/** Slow sway of the whole figure. */
const SWAY_PX = 3.5;
const SWAY_SPEED = 0.00025;
/** Cursor repel: dots are shoved aside and flare up while displaced. */
const REPEL_R = 105;
const REPEL_STRENGTH = 34;
/** Per-frame easing of the displacement — also how fast it heals. */
const REPEL_EASE = 0.16;
const FLARE_MAX = 1.3;

const DOT_PX = 1.75;
const FIELD_ALPHA = 0.62;
/** Below this a layer is not worth a fillRect. */
const ALPHA_EPS = 0.02;

interface Particle {
  /** Where this leg of the journey starts (the position it had when the last
   *  transition began — that is what makes an interruption seamless). */
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  /** Live position, kept so a retarget can start from exactly here. */
  px: number;
  py: number;
  delay: number;
  swirl: number;
  turns: number;
  phase: number;
  drift: number;
  /** Static brightness spread, so the field has depth at rest. */
  bright: number;
  /** Colour before and after the current transition (crossfaded between). */
  accentA: boolean;
  accentB: boolean;
  /** Came out of the bottle in this transition — invisible until it launches. */
  born: boolean;
  /** Going back into the bottle; fades out on arrival and is then dropped. */
  dying: boolean;
  /** Live repel displacement, eased toward the desired push and back to 0. */
  ox: number;
  oy: number;
}

interface Props {
  /** Figure to show; null retracts whatever is up. */
  shape: GenieShapeKey | null;
  /** Emitter — the hovered card's icon centre, in viewport coordinates. */
  origin: { x: number; y: number } | null;
}

/** Share of particles drawn in the accent colour, per figure. Stars are mostly
 *  gold (that is the point of a rating), the cat is ink with a hint. */
const ACCENT_SHARE: Record<GenieShapeKey, number> = {
  github: 0.08,
  donate: 0.3,
  review: 0.72,
};

const ACCENT_VAR: Record<GenieShapeKey, string> = {
  github: '--c-primary',
  donate: '--c-primary',
  review: '--icon-gold',
};

function readColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const smoothstep = (u: number) => u * u * (3 - 2 * u);
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function GenieField({ shape, origin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Everything the loop needs lives in refs: re-rendering React 60×/s to move
  // dots would be absurd.
  const state = useRef({
    particles: [] as Particle[],
    box: { w: 0, h: 0 },
    /** Pointer in canvas coordinates, or null when it is elsewhere. */
    pointer: null as { x: number; y: number } | null,
    /** Progress of the CURRENT transition, 0→1. */
    morph: 1,
    duration: DUR_IN_MS,
    /** Is a figure currently addressed? Drives whether the loop may stop. */
    live: false,
    ink: '#000',
    accentA: '#000',
    accentB: '#000',
    raf: 0,
    last: 0,
  });

  // Keep the backing store in step with the box (and the device pixel ratio).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Measure the canvas itself: it overhangs its parent on purpose, so the
    // parent's box would size the field far too small (and put the figure in
    // the wrong place).
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      state.current.box = { w: width, h: height };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // The canvas is pointer-events:none, so the pointer is tracked on the window
  // and mapped into the box — same approach as the celox field.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const inside =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      state.current.pointer = inside ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
    };
    const onLeave = () => {
      state.current.pointer = null;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = state.current;

    // ---- retarget: one code path for appear, morph and retract -------------
    const rect = canvas.getBoundingClientRect();
    const ox = origin ? origin.x - rect.left : 0;
    const oy = origin ? origin.y - rect.top : 0;
    const hadFigure = s.live;

    // Whatever is on screen right now is where the next leg starts.
    const carried = s.particles.filter((p) => !(p.dying && s.morph >= 1));
    const targets = shape ? fieldPoints(shape) : [];

    const { w, h } = s.box;
    const span = Math.min(w, h) * (shape ? SHAPE_FILL[shape] : 1);
    const fx = w / 2;
    // Centred on the card block, not on the canvas: the field reaches far above
    // the cards so the plume has somewhere to rise from. The star row is the
    // exception — flat and wide, it reads far better in the open space below
    // the cards than hidden behind their text.
    const fy = h * (shape === 'review' ? 0.64 : 0.5);
    const share = shape ? ACCENT_SHARE[shape] : 0;
    const maxDelay = hadFigure && shape ? MAX_DELAY_MORPH : MAX_DELAY_IN;

    s.duration = !shape ? DUR_OUT_MS : hadFigure ? DUR_MORPH_MS : DUR_IN_MS;
    s.ink = readColor('--c-on-surface', '#1a1c19');
    s.accentA = s.live ? s.accentB : s.ink;
    s.accentB = shape ? readColor(ACCENT_VAR[shape], s.ink) : s.accentA;

    const next: Particle[] = [];
    const count = Math.max(carried.length, targets.length);
    for (let i = 0; i < count; i++) {
      const old = carried[i];
      const point = targets[i];
      const born = !old;
      const dying = !point;

      // Where it flies to: its place in the new figure, or back into the bottle.
      const tx = point ? fx + point.x * span : ox;
      const ty = point ? fy + point.y * span : oy;
      // Where it starts: exactly where it is, or out of the bottle.
      const sx = old ? old.px : ox;
      const sy = old ? old.py : oy;

      let cx: number;
      let cy: number;
      if (born || dying) {
        // Nearly shared control point high above the icon: this is what makes
        // them leave (or return) as one column instead of scattering.
        const far = born ? tx : sx;
        cx = ox + (far - ox) * 0.18 + (Math.random() - 0.5) * CTRL_JITTER_X;
        cy = oy - RISE * (born ? 1 : 0.75) + (Math.random() - 0.5) * CTRL_JITTER_Y;
      } else {
        // Figure → figure: bow the path sideways and lift it a little, signed
        // per particle so the swarm crosses itself instead of sliding across.
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.hypot(dx, dy) || 1;
        const bow = rand(-MORPH_ARC, MORPH_ARC);
        cx = (sx + tx) / 2 + (-dy / len) * bow;
        cy = (sy + ty) / 2 + (dx / len) * bow - Math.random() * MORPH_LIFT;
      }

      next.push({
        fx: sx,
        fy: sy,
        cx,
        cy,
        tx,
        ty,
        px: sx,
        py: sy,
        delay: Math.random() * maxDelay,
        swirl: rand(SWIRL_MIN, SWIRL_MAX),
        turns: rand(TURNS_MIN, TURNS_MAX),
        phase: old ? old.phase : Math.random() * Math.PI * 2,
        drift: old ? old.drift : rand(DRIFT_MIN, DRIFT_MAX),
        bright: old ? old.bright : 0.5 + Math.random() * 0.5,
        accentA: old ? old.accentB : false,
        accentB: point ? Math.random() < share : (old?.accentB ?? false),
        born,
        dying,
        ox: old ? old.ox : 0,
        oy: old ? old.oy : 0,
      });
    }

    s.particles = next;
    s.morph = 0;
    s.live = Boolean(shape);

    if (s.raf) return; // loop already running — it will pick up the new state
    s.last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(now - s.last, 64);
      s.last = now;

      // Linear in time so a transition has a readable duration; the easing that
      // matters is per particle (smoothstep: soft launch, soft arrival).
      s.morph = Math.min(1, s.morph + dt / s.duration);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.box.w, s.box.h);

      if (s.morph >= 1) {
        // Arrivals into the bottle are done — drop them.
        if (s.particles.some((p) => p.dying)) s.particles = s.particles.filter((p) => !p.dying);
        if (!s.live) {
          s.raf = 0;
          s.particles = [];
          return; // idle: stop painting entirely
        }
      }

      const sway = Math.sin(now * SWAY_SPEED) * SWAY_PX;
      const ptr = s.pointer;
      const m = s.morph;
      // At most three colours are in play (ink, the old accent, the new one);
      // grouping by colour keeps fillStyle changes to three per frame instead
      // of one per particle.
      const palette = [...new Set([s.ink, s.accentA, s.accentB])];

      for (const colour of palette) {
        ctx.fillStyle = colour;
        for (const p of s.particles) {
          // Colour crossfade: each particle contributes to its old colour on
          // the way out and to its new one on the way in.
          const colA = p.accentA ? s.accentA : s.ink;
          const colB = p.accentB ? s.accentB : s.ink;
          let weight = 0;
          if (colA === colour) weight += 1 - m;
          if (colB === colour) weight += m;
          if (weight < ALPHA_EPS) continue;

          const u = Math.min(1, (m - p.delay) / (1 - p.delay));
          if (u <= 0 && p.born) continue; // still in the bottle

          let x: number;
          let y: number;
          let size: number;
          let alpha: number;

          if (u >= 1 && !p.dying) {
            // --- settled: breathe, shimmer, and get out of the cursor's way --
            let pushX = 0;
            let pushY = 0;
            if (ptr) {
              const rx = p.tx - ptr.x;
              const ry = p.ty - ptr.y;
              const r2 = rx * rx + ry * ry;
              if (r2 < REPEL_R * REPEL_R) {
                const rd = Math.sqrt(r2) || 0.0001;
                const f = 1 - rd / REPEL_R;
                const push = f * f * REPEL_STRENGTH;
                pushX = (rx / rd) * push;
                pushY = (ry / rd) * push;
              }
            }
            p.ox += (pushX - p.ox) * REPEL_EASE;
            p.oy += (pushY - p.oy) * REPEL_EASE;

            const bx = Math.sin(now * DRIFT_SPEED_X + p.phase) * p.drift;
            const by = Math.cos(now * DRIFT_SPEED_Y + p.phase * 1.3) * p.drift;
            x = p.tx + bx + p.ox + sway;
            y = p.ty + by + p.oy;

            // Brightness wave travelling across the figure, plus a flare on the
            // dots the cursor has just shoved: a glowing wake follows it.
            const wave =
              1 - WAVE_DEPTH + WAVE_DEPTH * Math.sin(now * WAVE_SPEED + p.tx * WAVE_ACROSS + p.phase);
            const disp = Math.abs(p.ox) + Math.abs(p.oy);
            alpha = p.bright * wave * (1 + Math.min(FLARE_MAX, disp * 0.05));
            size = DOT_PX * (0.85 + 0.35 * wave);
          } else {
            // --- in flight along this leg's curve ---------------------------
            const e = u <= 0 ? 0 : smoothstep(u);
            const mt = 1 - e;
            x = mt * mt * p.fx + 2 * mt * e * p.cx + e * e * p.tx;
            y = mt * mt * p.fy + 2 * mt * e * p.cy + e * e * p.ty;
            // Swirl perpendicular to the path's tangent.
            const dxT = 2 * mt * (p.cx - p.fx) + 2 * e * (p.tx - p.cx);
            const dyT = 2 * mt * (p.cy - p.fy) + 2 * e * (p.ty - p.cy);
            const len = Math.hypot(dxT, dyT) || 1;
            const bulge = Math.sin(Math.PI * e);
            const angle = p.phase + p.turns * Math.PI * 2 * e;
            const swing = Math.cos(angle) * p.swirl * bulge;
            x += (-dyT / len) * swing;
            y += (dxT / len) * swing;

            alpha = p.bright;
            if (p.born) alpha *= Math.min(1, u * 3); // fade in as it leaves
            // Going home: stay visible for the flight, wink out at the bottle.
            if (p.dying) alpha *= 1 - Math.max(0, (u - 0.6) / 0.4);
            size = DOT_PX * (0.6 + 0.4 * e) * (0.8 + 0.4 * (0.5 + 0.5 * Math.sin(angle)));
          }

          p.px = x;
          p.py = y;
          ctx.globalAlpha = FIELD_ALPHA * weight * alpha;
          ctx.fillRect(x, y, size, size);
        }
      }
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  }, [shape, origin]);

  useEffect(() => {
    const s = state.current;
    return () => {
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, []);

  // The canvas sits in a stretched wrapper rather than carrying the insets
  // itself: a canvas is a REPLACED element, so `left/right + width:auto` does
  // not stretch it — it silently keeps its intrinsic 300×150 and the whole
  // figure ends up tiny in the corner.
  return (
    <div className="colophon__genie" aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  );
}
