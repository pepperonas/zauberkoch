/** "Magic cauldron" conjuring stage for the streaming phase.
 * Full scene while waiting for the first event, then morphs into a compact
 * brewing banner above the incoming recipe. Every real SSE ingredient drops
 * into the vessel with a spark burst; phase text follows the stream.
 * Ambient loops are linear/tween by design (orbits, bubbles); one-shot
 * movement uses the shared springs. prefers-reduced-motion -> static vessel.
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { strings, t } from '../../i18n';
import type { Modus, Zutat } from '../../lib/types';
import { emojiForZutat, ORBIT_EMOJIS } from '../../lib/zutatEmoji';
import { spring, springSoft } from '../../motion/springs';
import { defaultSpatial } from '../../motion/tokens';
import type { GenEvent } from '../../state/generation';
import type { RecipeViewData } from './RecipeView';
import './conjure.css';

interface Props {
  mode: Modus;
  data: RecipeViewData;
  lastEvent: GenEvent;
}

/* Full-scene edge length in px — keep in sync with .conjure__scene(box) in
   conjure.css. The compact banner morphs the scene down to COMPACT_SIZE. */
const SCENE_SIZE = 320;
const COMPACT_SIZE = 72;

/* Deterministic spark-burst directions (transform-only). */
const BURST = Array.from({ length: 6 }, (_, i) => {
  const angle = (i / 6) * Math.PI * 2 + 0.4;
  return { x: Math.cos(angle) * 56, y: Math.sin(angle) * 42 - 16 };
});

function phaseText(lastEvent: GenEvent, data: RecipeViewData): string {
  switch (lastEvent) {
    case 'start':
      return t('stream.phaseStart');
    case 'meta':
      return strings.stream.phaseMeta(data.meta?.titel ?? '');
    case 'zutat':
      return strings.stream.phaseZutaten(data.zutaten.length);
    case 'schritt':
      return strings.stream.phaseSchritte(data.schritte.length);
    case 'tipp':
      return t('stream.phaseTipps');
    default:
      return t('stream.phaseFinish');
  }
}

export function ConjureStage({ mode, data, lastEvent }: Props) {
  const reduced = useReducedMotion();
  const compact = data.meta != null;
  const zutaten = data.zutaten;

  // Rotating status lines during the initial wait (before the first event),
  // so a slow first token doesn't feel frozen. Once events flow, the phase
  // text takes over. Seamless: the AnimatePresence below cross-fades each line.
  const [cycle, setCycle] = useState(0);
  const waiting = lastEvent === 'start';
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(
      () => setCycle((c) => (c + 1) % strings.stream.conjuringCycle.length),
      2400,
    );
    return () => window.clearInterval(id);
  }, [waiting]);
  const text = waiting ? strings.stream.conjuringCycle[cycle] : phaseText(lastEvent, data);
  const orbitEmojis = zutaten.length > 0 ? zutaten.slice(-6).map((z) => emojiForZutat(z.name)) : ORBIT_EMOJIS[mode];

  return (
    <motion.div
      layout={!reduced}
      className={`conjure ${compact ? 'conjure--compact' : ''}`}
      transition={spring}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -12 }}
      aria-label={t('stream.stageLabel')}
    >
      <motion.div layout={!reduced} className="conjure__scenebox" transition={spring}>
        <motion.div
          className="conjure__scene"
          animate={{ scale: compact ? COMPACT_SIZE / SCENE_SIZE : 1 }}
          transition={spring}
        >
          {!reduced && (
            <>
              <Orbit emojis={orbitEmojis.slice(0, 4)} radius={126} duration={17} />
              <Orbit emojis={orbitEmojis.slice(4)} radius={86} duration={11} reverse />
            </>
          )}
          <motion.div
            className="conjure__glow"
            aria-hidden
            animate={reduced ? undefined : { opacity: [0.45, 0.8, 0.45], scale: [1, 1.08, 1] }}
            transition={{ repeat: Infinity, duration: 2.6, ease: 'easeInOut' }}
          />
          {/* physics-based breathing while waiting (ambient loop; settles via token when compact) */}
          <motion.div
            className="conjure__vessel"
            animate={!reduced && !compact ? { scale: [1, 1.05, 1] } : { scale: 1 }}
            transition={
              !reduced && !compact
                ? { repeat: Infinity, duration: 3, ease: 'easeInOut' }
                : defaultSpatial
            }
          >
            {mode === 'cocktail' ? (
              <ShakerSvg reduced={!!reduced} />
            ) : (
              <CauldronSvg reduced={!!reduced} stirKey={data.schritte.length} />
            )}
          </motion.div>
          {!reduced && <ZutatDrop zutaten={zutaten} active={lastEvent === 'zutat'} />}
        </motion.div>
      </motion.div>

      <motion.div layout={!reduced} className="conjure__info" transition={spring}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={text}
            className="conjure__text"
            role="status"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={springSoft}
          >
            {text}
          </motion.p>
        </AnimatePresence>
        {compact && zutaten.length > 0 && (
          <p className="conjure__meta">{strings.stream.pillProgress(zutaten.length, data.schritte.length)}</p>
        )}
        {!compact && <p className="conjure__hint">{t('stream.cancelHint')}</p>}
      </motion.div>
    </motion.div>
  );
}

/** Rotating ring of upright emojis (parent spins, children counter-spin). */
function Orbit({ emojis, radius, duration, reverse = false }: { emojis: string[]; radius: number; duration: number; reverse?: boolean }) {
  if (emojis.length === 0) return null;
  return (
    <motion.div
      className="conjure__orbit"
      aria-hidden
      animate={{ rotate: reverse ? -360 : 360 }}
      transition={{ repeat: Infinity, ease: 'linear', duration }}
    >
      {emojis.map((emoji, i) => {
        const angle = (i * 360) / emojis.length;
        return (
          <span
            key={i}
            className="conjure__orbiter"
            style={{ transform: `rotate(${angle}deg) translateX(${radius}px)` }}
          >
            <motion.span
              className="conjure__orbiter-emoji"
              animate={{ rotate: reverse ? [-angle, -angle + 360] : [-angle, -angle - 360] }}
              transition={{ repeat: Infinity, ease: 'linear', duration }}
            >
              {emoji}
            </motion.span>
          </span>
        );
      })}
    </motion.div>
  );
}

/** The most recent ingredient falls into the vessel + spark burst. */
function ZutatDrop({ zutaten, active }: { zutaten: Zutat[]; active: boolean }) {
  const index = zutaten.length - 1;
  if (!active || index < 0) return null;
  return (
    <AnimatePresence>
      <motion.span
        key={`drop-${index}`}
        className="conjure__drop"
        aria-hidden
        initial={{ y: -112, opacity: 0, scale: 1.15, rotate: -25 }}
        animate={{ y: -4, opacity: [0, 1, 1, 0], scale: 0.45, rotate: 20 }}
        transition={{ duration: 0.7, ease: 'easeIn' }}
      >
        {emojiForZutat(zutaten[index].name)}
      </motion.span>
      <span key={`burst-${index}`} className="conjure__burst" aria-hidden>
        {BURST.map((p, i) => (
          <motion.span
            key={i}
            className="conjure__spark"
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.5 }}
            animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], scale: 1.2 }}
            transition={{ duration: 0.55, delay: 0.42, ease: 'easeOut' }}
          >
            ✦
          </motion.span>
        ))}
      </span>
    </AnimatePresence>
  );
}

/** One-shot celebratory spark burst (used when the recipe is saved). */
export function SparkBurst() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <div className="sparkburst" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const r = 90 + (i % 3) * 34;
        return (
          <motion.span
            key={i}
            className="sparkburst__p"
            initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
            animate={{
              x: Math.cos(angle) * r,
              y: Math.sin(angle) * r * 0.7,
              opacity: 0,
              scale: 1.3,
              rotate: i % 2 ? 120 : -120,
            }}
            transition={{ duration: 0.9, delay: (i % 4) * 0.05, ease: 'easeOut' }}
          >
            {['✨', '⭐', '✦'][i % 3]}
          </motion.span>
        );
      })}
    </div>
  );
}

export function CauldronSvg({ reduced, stirKey }: { reduced: boolean; stirKey: number }) {
  return (
    <motion.svg
      key={reduced ? 'static' : stirKey}
      className="conjure__svg"
      viewBox="0 0 120 120"
      animate={reduced ? undefined : { rotate: [0, -4, 4, -2, 0] }}
      transition={{ duration: 0.6, ease: 'easeInOut' }}
      aria-hidden
    >
      {/* rising bubbles */}
      {!reduced &&
        [46, 60, 74].map((cx, i) => (
          <motion.circle
            key={i}
            cx={cx}
            cy={46}
            r={i === 1 ? 4 : 3}
            fill="var(--c-primary-container)"
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: -30, opacity: [0, 0.9, 0] }}
            transition={{ repeat: Infinity, duration: 1.9, delay: i * 0.55, ease: 'easeOut' }}
          />
        ))}
      {/* legs */}
      <path d="M40 102 L33 114 M80 102 L87 114" stroke="var(--c-outline)" strokeWidth="5" strokeLinecap="round" />
      {/* body */}
      <path
        d="M21 52 C21 88 38 102 60 102 C82 102 99 88 99 52 Z"
        fill="var(--c-surface-container-highest)"
        stroke="var(--c-outline-variant)"
        strokeWidth="2.5"
      />
      {/* rim */}
      <rect x="14" y="42" width="92" height="13" rx="6.5" fill="var(--c-surface-container-high)" stroke="var(--c-outline-variant)" strokeWidth="2.5" />
      {/* liquid */}
      <ellipse cx="60" cy="48.5" rx="39" ry="5" fill="var(--c-primary)" />
      <ellipse cx="48" cy="47.5" rx="12" ry="2" fill="var(--c-primary-container)" opacity="0.8" />
    </motion.svg>
  );
}

export function ShakerSvg({ reduced }: { reduced: boolean }) {
  return (
    <motion.svg
      className="conjure__svg conjure__svg--shaker"
      viewBox="0 0 120 120"
      animate={reduced ? undefined : { rotate: [0, -9, 9, -6, 6, 0] }}
      transition={{ repeat: Infinity, duration: 1.25, repeatDelay: 0.55, ease: 'easeInOut' }}
      aria-hidden
    >
      {/* knob + cap */}
      <rect x="51" y="16" width="18" height="11" rx="5" fill="var(--c-surface-container-high)" stroke="var(--c-outline-variant)" strokeWidth="2.5" />
      <path d="M41 27 L79 27 L76.5 45 L43.5 45 Z" fill="var(--c-surface-container-high)" stroke="var(--c-outline-variant)" strokeWidth="2.5" strokeLinejoin="round" />
      {/* body */}
      <path d="M38 45 L82 45 L74 104 L46 104 Z" fill="var(--c-surface-container-highest)" stroke="var(--c-outline-variant)" strokeWidth="2.5" strokeLinejoin="round" />
      {/* accent band */}
      <path d="M40.2 56 L79.8 56 L78.9 63 L41.1 63 Z" fill="var(--c-primary)" />
      {/* condensation drops */}
      <circle cx="52" cy="80" r="2.2" fill="var(--c-primary-container)" />
      <circle cx="66" cy="90" r="1.8" fill="var(--c-primary-container)" />
    </motion.svg>
  );
}
