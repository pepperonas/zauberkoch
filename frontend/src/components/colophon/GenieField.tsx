/** The colophon genie: hovering a card releases a swirling column of dots from
 * its icon, which climbs, unfurls and settles into a figure behind the footer.
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
 * Runs only where hover exists and motion is welcome, and the rAF loop stops
 * dead once the field is empty — an idle page must not paint.
 */

import { useEffect, useRef } from 'react';

import { fieldPoints, SHAPE_FILL, type GenieShapeKey } from './genieShapes';

// -- entrance ---------------------------------------------------------------
/** Time to full assembly. Long enough that the climb is a movement you watch,
 *  not a state you find already finished — the first version took ~600 ms and
 *  read as "the dots are simply there". */
const DUR_IN_MS = 1150;
const DUR_OUT_MS = 520;
/** How far above the icon the column climbs before unfurling (px). */
const RISE = 165;
/** Spread of the shared control point, so the column is a plume, not a wire. */
const CTRL_JITTER_X = 22;
const CTRL_JITTER_Y = 34;
/** Latest a particle may start, as a fraction of progress — the stagger is what
 *  turns a moving cloud into a stream. */
const MAX_DELAY = 0.5;
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

interface Particle {
  tx: number;
  ty: number;
  cx: number;
  cy: number;
  delay: number;
  swirl: number;
  turns: number;
  phase: number;
  drift: number;
  /** Static brightness spread, so the field has depth at rest. */
  bright: number;
  accent: boolean;
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

export function GenieField({ shape, origin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Everything the loop needs lives in refs: re-rendering React 60×/s to move
  // dots would be absurd.
  const state = useRef({
    particles: [] as Particle[],
    origin: { x: 0, y: 0 },
    box: { w: 0, h: 0 },
    /** Pointer in canvas coordinates, or null when it is elsewhere. */
    pointer: null as { x: number; y: number } | null,
    progress: 0,
    target: 0,
    ink: '#000',
    accent: '#000',
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

    if (shape && origin) {
      const { w, h } = s.box;
      const span = Math.min(w, h) * SHAPE_FILL[shape];
      const fx = w / 2;
      // Centred on the card block, not on the canvas: the field reaches far
      // above the cards so the plume has somewhere to rise from. The star row
      // is the exception — flat and wide, it reads far better in the open
      // space below the cards than hidden behind their text.
      const fy = h * (shape === 'review' ? 0.64 : 0.5);
      const share = ACCENT_SHARE[shape];
      const rect = canvas.getBoundingClientRect();
      // The emitter arrives in viewport coordinates — only the canvas knows
      // where its own box sits.
      const ox = origin.x - rect.left;
      const oy = origin.y - rect.top;

      s.particles = fieldPoints(shape).map((p) => {
        const tx = fx + p.x * span;
        const ty = fy + p.y * span;
        return {
          tx,
          ty,
          // Nearly shared control point high above the icon: this is what makes
          // them leave as one column instead of scattering straight to target.
          cx: ox + (tx - ox) * 0.18 + (Math.random() - 0.5) * CTRL_JITTER_X,
          cy: oy - RISE + (Math.random() - 0.5) * CTRL_JITTER_Y,
          delay: Math.random() * MAX_DELAY,
          swirl: SWIRL_MIN + Math.random() * (SWIRL_MAX - SWIRL_MIN),
          turns: TURNS_MIN + Math.random() * (TURNS_MAX - TURNS_MIN),
          phase: Math.random() * Math.PI * 2,
          drift: DRIFT_MIN + Math.random() * (DRIFT_MAX - DRIFT_MIN),
          bright: 0.5 + Math.random() * 0.5,
          accent: Math.random() < share,
          ox: 0,
          oy: 0,
        };
      });
      s.origin = { x: ox, y: oy };
      s.ink = readColor('--c-on-surface', '#1a1c19');
      s.accent = readColor(ACCENT_VAR[shape], s.ink);
      s.target = 1;
    } else {
      s.target = 0;
    }

    if (s.raf) return; // loop already running — it will pick up the new target
    s.last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(now - s.last, 64);
      s.last = now;

      // Linear in time so the climb has a readable duration; the easing that
      // matters is per particle (smoothstep: soft launch, soft arrival).
      const step = dt / (s.target ? DUR_IN_MS : DUR_OUT_MS);
      s.progress = Math.max(0, Math.min(1, s.progress + (s.target ? step : -step)));

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.box.w, s.box.h);

      if (s.progress <= 0 && s.target === 0) {
        s.raf = 0;
        s.particles = [];
        return; // idle: stop painting entirely
      }

      const sway = Math.sin(now * SWAY_SPEED) * SWAY_PX;
      const ptr = s.pointer;

      for (const pass of [false, true]) {
        ctx.fillStyle = pass ? s.accent : s.ink;
        for (const p of s.particles) {
          if (p.accent !== pass) continue;
          const u = (s.progress - p.delay) / (1 - p.delay);
          if (u <= 0) continue; // still in the bottle
          const e = u >= 1 ? 1 : u * u * (3 - 2 * u); // smoothstep

          let x: number;
          let y: number;
          let size: number;
          let alpha: number;

          if (e >= 1) {
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
            // --- in flight: one column out of the bottle, then unfurling -----
            const mt = 1 - e;
            const px = mt * mt * s.origin.x + 2 * mt * e * p.cx + e * e * p.tx;
            const py = mt * mt * s.origin.y + 2 * mt * e * p.cy + e * e * p.ty;
            // Swirl perpendicular to the path's tangent.
            const dxT = 2 * mt * (p.cx - s.origin.x) + 2 * e * (p.tx - p.cx);
            const dyT = 2 * mt * (p.cy - s.origin.y) + 2 * e * (p.ty - p.cy);
            const len = Math.hypot(dxT, dyT) || 1;
            const bulge = Math.sin(Math.PI * e);
            const angle = p.phase + p.turns * Math.PI * 2 * e;
            const swing = Math.cos(angle) * p.swirl * bulge;
            x = px + (-dyT / len) * swing;
            y = py + (dxT / len) * swing;
            // Fade in as they leave, and read the near side of the swirl as
            // larger — the cheap trick that sells a rotating column.
            alpha = p.bright * Math.min(1, u * 3);
            size = DOT_PX * (0.6 + 0.4 * e) * (0.8 + 0.4 * (0.5 + 0.5 * Math.sin(angle)));
          }

          ctx.globalAlpha = FIELD_ALPHA * s.progress * alpha;
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
