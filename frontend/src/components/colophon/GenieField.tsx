/** The colophon genie: hovering a card releases a swirling stream of dots from
 * its icon, which unfurls and settles into a figure behind the footer.
 *
 * Two deliberate departures from the Octocat field on celox.io, which does the
 * same dot-silhouette trick:
 *
 *  - **No Three.js.** A footer flourish must not cost 150 kB and a WebGL
 *    context. 2D canvas draws a few hundred quads per frame without noticing.
 *  - **Genie entrance instead of a settling cloud.** Particles do not fade in
 *    from a scattered shell; they leave the icon like smoke from a bottle,
 *    spiralling along the path to their target with the swirl widest in the
 *    middle of the flight. Leaving the card runs the same motion backwards, so
 *    the figure is drawn back into the icon.
 *
 * Runs only where hover exists and motion is welcome, and the rAF loop stops
 * dead once the field is empty — an idle page must not paint.
 */

import { useEffect, useRef } from 'react';

import { fieldPoints, SHAPE_FILL, type GenieShapeKey } from './genieShapes';

// -- motion constants (a particle system has physics, not tokens) ------------
/** Exponential approach to the target progress: smaller = snappier. Interrupts
 *  gracefully, which a fixed tween would not — hover in, out, in again. */
const TAU_IN_MS = 260;
const TAU_OUT_MS = 170;
/** Latest a particle may start, as a fraction of progress — this stagger is
 *  what turns a moving cloud into a stream. */
const MAX_DELAY = 0.55;
/** Sideways swirl of the plume, in px, widest at half flight. */
const SWIRL_MIN = 14;
const SWIRL_MAX = 46;
/** Turns around the flight axis on the way out. */
const TURNS_MIN = 0.5;
const TURNS_MAX = 1.5;
/** How far the plume bows upward before settling (px). Smoke rises. */
const RISE = 26;
/** Idle breathing once assembled. */
const BREATH_PX = 1.1;
const BREATH_SPEED = 0.0011;
const DOT_PX = 1.7;
const FIELD_ALPHA = 0.62;
/** Progress below which the field counts as gone and the loop may stop. */
const DONE_EPS = 0.004;

interface Particle {
  tx: number;
  ty: number;
  delay: number;
  swirl: number;
  turns: number;
  phase: number;
  accent: boolean;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = state.current;

    if (shape && origin) {
      const { w, h } = s.box;
      const span = Math.min(w, h) * SHAPE_FILL[shape];
      const cx = w / 2;
      // Centred on the card block, not on the canvas: the field reaches far
      // above the cards so the plume has somewhere to rise from. The star row
      // is the exception — flat and wide, it reads far better in the open
      // space below the cards than hidden behind their text.
      const cy = h * (shape === 'review' ? 0.64 : 0.5);
      const share = ACCENT_SHARE[shape];
      s.particles = fieldPoints(shape).map((p) => ({
        tx: cx + p.x * span,
        ty: cy + p.y * span,
        delay: Math.random() * MAX_DELAY,
        swirl: SWIRL_MIN + Math.random() * (SWIRL_MAX - SWIRL_MIN),
        turns: TURNS_MIN + Math.random() * (TURNS_MAX - TURNS_MIN),
        phase: Math.random() * Math.PI * 2,
        accent: Math.random() < share,
      }));
      // The emitter arrives in viewport coordinates — only the canvas knows
      // where its own box sits.
      const rect = canvas.getBoundingClientRect();
      s.origin = { x: origin.x - rect.left, y: origin.y - rect.top };
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

      const tau = s.target > s.progress ? TAU_IN_MS : TAU_OUT_MS;
      s.progress += (s.target - s.progress) * (1 - Math.exp(-dt / tau));
      if (Math.abs(s.target - s.progress) < DONE_EPS) s.progress = s.target;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.box.w, s.box.h);

      if (s.progress <= DONE_EPS && s.target === 0) {
        s.raf = 0;
        s.progress = 0;
        s.particles = [];
        return; // idle: stop painting entirely
      }

      ctx.globalAlpha = FIELD_ALPHA * s.progress;
      for (const pass of [false, true]) {
        ctx.fillStyle = pass ? s.accent : s.ink;
        for (const p of s.particles) {
          if (p.accent !== pass) continue;
          const u = (s.progress - p.delay) / (1 - p.delay);
          if (u <= 0) continue; // still in the bottle
          const e = u >= 1 ? 1 : 1 - (1 - u) * (1 - u) * (1 - u); // easeOutCubic

          const dx = p.tx - s.origin.x;
          const dy = p.ty - s.origin.y;
          const len = Math.hypot(dx, dy) || 1;
          // Perpendicular to the flight axis — the plume swirls around it.
          const nx = -dy / len;
          const ny = dx / len;
          const bulge = Math.sin(Math.PI * Math.min(e, 1));
          const angle = p.phase + p.turns * Math.PI * 2 * e;
          const swing = Math.cos(angle) * p.swirl * bulge;

          const breath =
            e >= 1 ? Math.sin(now * BREATH_SPEED + p.phase) * BREATH_PX : 0;
          const x = s.origin.x + dx * e + nx * swing + breath;
          const y = s.origin.y + dy * e + ny * swing - RISE * bulge + breath;

          // Dots on the near side of the swirl read larger — the cheap trick
          // that makes a flat canvas look like a rotating column.
          const size = DOT_PX * (0.72 + 0.5 * (0.5 + 0.5 * Math.sin(angle)));
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
