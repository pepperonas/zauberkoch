/** The colophon genie.
 *
 * A quiet dust of dots always drifts behind the footer. Hovering a card pulls
 * that dust together — plus a column of new dots rising out of the card's icon —
 * into a figure: the Octocat, an espresso cup, five stars. Moving to a
 * neighbouring card does not swap figures, the dots fly across and re-form.
 * Leaving lets the figure disperse back into drifting dust, the surplus flowing
 * home into the icon it came from.
 *
 * The dot-silhouette idea and the idle character come from the Octocat field on
 * celox.io — breathing drift, a brightness wave travelling across the figure,
 * and a cursor that shoves nearby dots aside while they flare up. Two things
 * are deliberately different:
 *
 *  - **No Three.js.** A footer flourish must not cost 150 kB and a WebGL
 *    context. 2D canvas draws a few thousand quads per frame without noticing.
 *  - **A genie leaving a bottle, not a cloud settling.** Particles bound for a
 *    figure fly a quadratic Bézier whose control point sits high above the icon
 *    and is almost the SAME for all of them: they leave as one narrow column and
 *    only fan out near the end. That shared control point is the whole trick — a
 *    straight origin→target path with a bit of swirl (the first attempt) just
 *    looks like dots appearing.
 *
 * ONE mechanism drives every transition, which is what makes switching cards
 * mid-flight behave: each particle has a from-point, a control point and a
 * target, and a single progress moves it along that curve. Gathering, changing
 * figure and dispersing are all "fly to a new address"; a particle retargeted
 * mid-flight simply starts its next curve where it currently is.
 *
 * Mounted only where hover exists and motion is welcome. The loop pauses when
 * the footer scrolls out of view or the tab goes to the background — a drifting
 * field is worth a few hundred quads a frame, but not while nobody can see it.
 */

import { useEffect, useRef } from 'react';

import { fieldPoints, SHAPE_FILL, type GenieShapeKey } from './genieShapes';

// -- transitions ------------------------------------------------------------
/** Gathering out of the dust (and out of the bottle). Long enough that the
 *  climb is a movement you watch, not a state you find already finished. */
const DUR_IN_MS = 1150;
/** Figure → figure. Shorter than the entrance: the dots are already on stage,
 *  and the eye is following a change, not waiting for an arrival. */
const DUR_MORPH_MS = 780;
/** Figure → dust. */
const DUR_OUT_MS = 700;
/** First appearance of the dust itself: no travel, just a soft fade-in. */
const DUR_DUST_MS = 900;
/** How far above the icon the column climbs before unfurling (px). */
const RISE = 165;
/** Spread of the shared control point, so the column is a plume, not a wire. */
const CTRL_JITTER_X = 22;
const CTRL_JITTER_Y = 34;
/** Sideways bow and lift of a flight between two arrangements. Signed per
 *  particle, so the swarm swings both ways and crosses itself. */
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

// -- the resting dust -------------------------------------------------------
/** Sparse on purpose: this is a background texture, not a second figure. */
const DUST_COUNT = 380;
/** Dust is dimmer than a figure — it must never compete with the legal links. */
const DUST_DIM = 0.5;
/** Dust wanders far and slowly; figure dots only breathe. */
const DUST_DRIFT_MIN = 16;
const DUST_DRIFT_MAX = 54;
const DUST_SPEED_MIN = 0.3;
const DUST_SPEED_MAX = 0.7;

// -- idle motion (ported from the celox octocat field) ----------------------
const DRIFT_MIN = 1.2;
const DRIFT_MAX = 3.4;
const DRIFT_SPEED_X = 0.0008;
const DRIFT_SPEED_Y = 0.0007;
/** Brightness wave sweeping across the field — it reads the particle's own x,
 *  so the shimmer travels instead of twinkling at random. Deeper on a figure:
 *  that is where the eye is, and where the glitter should live. */
const WAVE_SPEED = 0.0009;
const WAVE_ACROSS = 0.012;
const WAVE_DEPTH_FIGURE = 0.42;
const WAVE_DEPTH_DUST = 0.24;
/** Sparkle: each dot glints briefly and rarely. `sin^8` is almost always ~0
 *  with a short sharp peak, so the field twinkles like glitter instead of
 *  pulsing as a whole — a plain sine would just make everything breathe. */
const SPARK_SPEED_MIN = 0.0011;
const SPARK_SPEED_MAX = 0.0034;
/** How much brighter and fatter a dot gets at the peak of its glint. Size gain
 *  stays small on purpose: a square grown to 4 px reads as a BLOCK, not as a
 *  sparkle (it did). The glitter comes from the cross below instead. */
const SPARK_GAIN = 1.9;
const SPARK_SIZE = 0.45;
/** Above this the glint is drawn as a four-armed flash rather than a square —
 *  that shape is what the eye reads as "sparkle". Rare by construction (sin^8),
 *  so only a handful of crosses exist in any one frame. */
const SPARK_CROSS_MIN = 0.3;
const SPARK_ARM = 3.0;
const SPARK_ARM_THICK = 0.5;
/** The dust glints too, but faintly — it is texture, not the subject. */
const SPARK_DUST_SCALE = 0.3;
/** Only a minority of dots sparkle at all. Without this the maths betrays the
 *  eye: even sin^8 sits near its peak ~17 % of the time, so with every dot
 *  eligible the cat turned into a field of plus signs. A tenth of them glinting
 *  is glitter; all of them is a pattern. */
const SPARKLER_SHARE_FIGURE = 0.12;
const SPARKLER_SHARE_DUST = 0.06;
/** Slow sway of the whole field. */
const SWAY_PX = 3.5;
const SWAY_SPEED = 0.00025;
/** Cursor repel: dots are shoved aside and flare up while displaced.
 *  Two strengths on purpose. Sweeping the footer should visibly stir the dust,
 *  but a figure is summoned by parking the pointer ON its card — so the same
 *  push would carve a permanent hole through the middle of it (it did). For a
 *  figure the cursor only parts the dots a little. */
const REPEL_R_DUST = 105;
const REPEL_STRENGTH_DUST = 34;
const REPEL_R_FIGURE = 62;
const REPEL_STRENGTH_FIGURE = 9;
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
  /** Idle wander: amplitude in px and a speed multiplier. */
  drift: number;
  speed: number;
  /** Glint timing — its own phase so sparkles never line up with the drift.
   *  `sparkler` is false for most dots: only a minority twinkle. */
  sparkler: boolean;
  sparkSpeed: number;
  sparkPhase: number;
  /** Static brightness spread, so the field has depth at rest. */
  bright: number;
  /** Colour and dimness before/after the current transition (crossfaded). */
  accentA: boolean;
  accentB: boolean;
  dustA: boolean;
  dustB: boolean;
  /** Came out of the bottle in this transition — invisible until it launches. */
  born: boolean;
  /** Going back into the bottle; fades out on arrival and is then dropped. */
  dying: boolean;
  /** Live repel displacement, eased toward the desired push and back to 0. */
  ox: number;
  oy: number;
}

interface Props {
  /** Figure to gather into; null lets the field fall back to drifting dust. */
  shape: GenieShapeKey | null;
  /** Emitter — the last hovered card's icon centre, in viewport coordinates.
   *  Kept after the pointer leaves so the surplus knows where to go home. */
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

/** Fisher–Yates. Pairing old particles to new addresses at random spreads the
 *  survivors of a shrinking field evenly and makes the swarm cross itself. */
function shuffled<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

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
    duration: DUR_DUST_MS,
    /** Is a figure currently addressed? Drives the choice of duration. */
    figure: false,
    ink: '#000',
    accentA: '#000',
    accentB: '#000',
    raf: 0,
    last: 0,
    /** Painting is pointless when the footer is off-screen or the tab hidden. */
    onScreen: false,
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

  // The loop and its gating live on their own: rebuilding an observer on every
  // hover would be churn, and cancelling the rAF mid-transition would stutter.
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = state.current;

    const draw = (now: number) => {
      const dt = Math.min(now - s.last, 64);
      s.last = now;

      // Linear in time so a transition has a readable duration; the easing that
      // matters is per particle (smoothstep: soft launch, soft arrival).
      s.morph = Math.min(1, s.morph + dt / s.duration);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.box.w, s.box.h);

      // Arrivals into the bottle are done — drop them.
      if (s.morph >= 1 && s.particles.some((p) => p.dying)) {
        s.particles = s.particles.filter((p) => !p.dying);
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

          // Dust is dimmer than a figure, and that difference crossfades too.
          const dimA = p.dustA ? DUST_DIM : 1;
          const dim = dimA + ((p.dustB ? DUST_DIM : 1) - dimA) * m;

          const u = Math.min(1, (m - p.delay) / (1 - p.delay));
          if (u <= 0 && p.born) continue; // still in the bottle

          let x: number;
          let y: number;
          let size: number;
          let alpha: number;
          let spark = 0;

          if (u >= 1 && !p.dying) {
            // --- at rest: wander, shimmer, and get out of the cursor's way ---
            const bx = Math.sin(now * DRIFT_SPEED_X * p.speed + p.phase) * p.drift;
            const by = Math.cos(now * DRIFT_SPEED_Y * p.speed + p.phase * 1.3) * p.drift;
            x = p.tx + bx + sway;
            y = p.ty + by;

            // Repel from where the dot ACTUALLY is: dust wanders far from its
            // home, so testing against the home would push the wrong ones.
            let pushX = 0;
            let pushY = 0;
            if (ptr) {
              const radius = p.dustB ? REPEL_R_DUST : REPEL_R_FIGURE;
              const rx = x - ptr.x;
              const ry = y - ptr.y;
              const r2 = rx * rx + ry * ry;
              if (r2 < radius * radius) {
                const rd = Math.sqrt(r2) || 0.0001;
                const f = 1 - rd / radius;
                const push = f * f * (p.dustB ? REPEL_STRENGTH_DUST : REPEL_STRENGTH_FIGURE);
                pushX = (rx / rd) * push;
                pushY = (ry / rd) * push;
              }
            }
            p.ox += (pushX - p.ox) * REPEL_EASE;
            p.oy += (pushY - p.oy) * REPEL_EASE;
            x += p.ox;
            y += p.oy;

            // Brightness wave travelling across the field, plus a flare on the
            // dots the cursor has just shoved: a glowing wake follows it.
            const depth = p.dustB ? WAVE_DEPTH_DUST : WAVE_DEPTH_FIGURE;
            const wave =
              1 - depth + depth * Math.sin(now * WAVE_SPEED + p.tx * WAVE_ACROSS + p.phase);
            // Glint: sin^8, so mostly dark with a brief sharp peak — and only
            // for the dots that were picked as sparklers.
            if (p.sparkler) {
              const g = Math.max(0, Math.sin(now * p.sparkSpeed + p.sparkPhase));
              const g2 = g * g;
              const g4 = g2 * g2;
              spark = g4 * g4 * (p.dustB ? SPARK_DUST_SCALE : 1);
            }
            const disp = Math.abs(p.ox) + Math.abs(p.oy);
            alpha =
              p.bright * wave * (1 + spark * SPARK_GAIN) * (1 + Math.min(FLARE_MAX, disp * 0.05));
            size = DOT_PX * (0.85 + 0.35 * wave) * (1 + spark * SPARK_SIZE);
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
          ctx.globalAlpha = Math.min(1, FIELD_ALPHA * weight * alpha * dim);
          if (spark > SPARK_CROSS_MIN) {
            // A brief four-armed flash — drawn centred on the dot it replaces.
            const arm = DOT_PX * (1.4 + spark * SPARK_ARM);
            const thick = DOT_PX * SPARK_ARM_THICK;
            const cxp = x + size / 2;
            const cyp = y + size / 2;
            ctx.fillRect(cxp - arm / 2, cyp - thick / 2, arm, thick);
            ctx.fillRect(cxp - thick / 2, cyp - arm / 2, thick, arm);
          } else {
            ctx.fillRect(x, y, size, size);
          }
        }
      }
      s.raf = requestAnimationFrame(draw);
    };

    const start = () => {
      if (s.raf || !s.onScreen || document.hidden) return;
      s.last = performance.now();
      s.raf = requestAnimationFrame(draw);
    };
    const stop = () => {
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
    startRef.current = start;

    // Painting a drifting field is worth a few hundred quads a frame — but not
    // while the footer is off-screen or the tab is in the background.
    const io = new IntersectionObserver((entries) => {
      s.onScreen = entries.some((e) => e.isIntersecting);
      if (s.onScreen) start();
      else stop();
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = state.current;

    // ---- retarget: one code path for gathering, morphing and dispersing ----
    const rect = canvas.getBoundingClientRect();
    const hadFigure = s.figure;
    const { w, h } = s.box;
    // Without an origin (nothing hovered yet) the bottle is the dot's own
    // place: it simply fades in where it belongs.
    const ox = origin ? origin.x - rect.left : Number.NaN;
    const oy = origin ? origin.y - rect.top : Number.NaN;
    const hasBottle = Number.isFinite(ox);

    // Whatever is on screen right now is where the next leg starts. Shuffled so
    // a shrinking field keeps survivors from everywhere, not just its top rows.
    const carried = shuffled(s.particles.filter((p) => !(p.dying && s.morph >= 1)));

    const span = Math.min(w, h) * (shape ? SHAPE_FILL[shape] : 1);
    const fx = w / 2;
    // Well above the card block: the figures belong in the open space over the
    // colophon (behind the "Überrasch mich" button on the wizard), where they
    // have room and nothing to hide behind. The star row stays a touch lower
    // than the others — it is flat and wide, and needs less headroom.
    const fy = h * (shape === 'review' ? 0.46 : 0.4);
    const share = shape ? ACCENT_SHARE[shape] : 0;
    const maxDelay = hadFigure && shape ? MAX_DELAY_MORPH : MAX_DELAY_IN;

    // Targets: the figure's silhouette, or fresh homes for the resting dust.
    const targets: { x: number; y: number }[] = shape
      ? fieldPoints(shape).map((p) => ({ x: fx + p.x * span, y: fy + p.y * span }))
      : Array.from({ length: DUST_COUNT }, () => ({
          x: rand(0, w),
          y: rand(h * 0.06, h * 0.94),
        }));

    s.duration = !shape
      ? s.particles.length
        ? DUR_OUT_MS
        : DUR_DUST_MS
      : hadFigure
        ? DUR_MORPH_MS
        : DUR_IN_MS;
    s.ink = readColor('--c-on-surface', '#1a1c19');
    s.accentA = s.accentB === '#000' ? s.ink : s.accentB;
    s.accentB = shape ? readColor(ACCENT_VAR[shape], s.ink) : s.accentA;

    const next: Particle[] = [];
    const count = Math.max(carried.length, targets.length);
    for (let i = 0; i < count; i++) {
      const old = carried[i];
      const point = targets[i];
      // Only a real bottle can spawn or swallow: with none, dots appear in
      // place and never leave.
      const born = !old && hasBottle;
      const dying = !point && hasBottle;
      if (!point && !hasBottle) continue;

      const tx = point ? point.x : ox;
      const ty = point ? point.y : oy;
      const sx = old ? old.px : born ? ox : tx;
      const sy = old ? old.py : born ? oy : ty;

      let cx: number;
      let cy: number;
      if (born || dying) {
        // Nearly shared control point high above the icon: this is what makes
        // them leave (or return) as one column instead of scattering.
        const far = born ? tx : sx;
        cx = ox + (far - ox) * 0.18 + (Math.random() - 0.5) * CTRL_JITTER_X;
        cy = oy - RISE * (born ? 1 : 0.75) + (Math.random() - 0.5) * CTRL_JITTER_Y;
      } else {
        // Arrangement → arrangement: bow the path sideways and lift it, signed
        // per particle so the swarm crosses itself instead of sliding across.
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.hypot(dx, dy) || 1;
        const bow = rand(-MORPH_ARC, MORPH_ARC);
        cx = (sx + tx) / 2 + (-dy / len) * bow;
        cy = (sy + ty) / 2 + (dx / len) * bow - Math.random() * MORPH_LIFT;
      }

      const dust = !shape;
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
        drift: dust ? rand(DUST_DRIFT_MIN, DUST_DRIFT_MAX) : rand(DRIFT_MIN, DRIFT_MAX),
        speed: dust ? rand(DUST_SPEED_MIN, DUST_SPEED_MAX) : 1,
        sparkler:
          Math.random() < (dust ? SPARKLER_SHARE_DUST : SPARKLER_SHARE_FIGURE),
        sparkSpeed: old ? old.sparkSpeed : rand(SPARK_SPEED_MIN, SPARK_SPEED_MAX),
        sparkPhase: old ? old.sparkPhase : Math.random() * Math.PI * 2,
        bright: old ? old.bright : 0.5 + Math.random() * 0.5,
        accentA: old ? old.accentB : false,
        accentB: point && shape ? Math.random() < share : (old?.accentB ?? false),
        dustA: old ? old.dustB : true,
        dustB: dust,
        born,
        dying,
        ox: old ? old.ox : 0,
        oy: old ? old.oy : 0,
      });
    }

    s.particles = next;
    s.morph = 0;
    s.figure = Boolean(shape);
    startRef.current();
  }, [shape, origin]);

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
