/** Full-screen intro for shared-recipe links (/r/:token).
 *
 * Two admin-selectable modes (app_settings.share_intro, delivered with the
 * public share payload):
 *   'motif' — a large, present cauldron / shaker matching the recipe mode,
 *             ~3s, with orbiting ingredient emojis and a title reveal
 *   'crt'   — the CRT power-on used after login
 *   'off'   — no intro (the page renders straight away; handled by the caller)
 *
 * Robustness rules (mobile is the primary target):
 *  • the timer is the ONLY source of truth for "done" — never an animation
 *    callback, so a throttled/backgrounded tab can't strand the visitor;
 *  • the overlay is `position: fixed` and sized in dvh so a mobile URL-bar
 *    toggle can't shift it;
 *  • tap / Escape skips it instantly;
 *  • prefers-reduced-motion shows a brief static frame instead of motion.
 */

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { CauldronSvg, ShakerSvg } from '../../components/recipe/ConjureStage';
import { CrtOn } from '../../components/CrtOff';
import { t } from '../../i18n';
import type { Modus } from '../../lib/types';
import { ORBIT_EMOJIS } from '../../lib/zutatEmoji';
import './shareIntro.css';

export type ShareIntroMode = 'motif' | 'crt' | 'off';

/** Visible duration of the motif intro (ms). Reduced motion cuts it short. */
const MOTIF_MS = 3000;
const REDUCED_MS = 600;

interface Props {
  mode: Modus;
  /** Recipe title — revealed under the vessel once it has settled. */
  title?: string;
  variant: Exclude<ShareIntroMode, 'off'>;
  onDone: () => void;
}

export function ShareIntro({ mode, title, variant, onDone }: Props) {
  const reduced = useReducedMotion();

  // Single timer owns completion (see robustness note above).
  useEffect(() => {
    if (variant !== 'motif') return;
    const id = window.setTimeout(onDone, reduced ? REDUCED_MS : MOTIF_MS);
    return () => window.clearTimeout(id);
  }, [variant, reduced, onDone]);

  // Skip on tap or Escape — never trap someone behind an intro.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  if (variant === 'crt') return <CrtOn ready onDone={onDone} />;

  const emojis = ORBIT_EMOJIS[mode];

  return (
    <motion.div
      className="sintro"
      role="status"
      aria-label={t('shared.introLabel')}
      onClick={onDone}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="sintro__stage">
        {!reduced && (
          <>
            <Orbit emojis={emojis.slice(0, 4)} radius={140} duration={9} />
            <Orbit emojis={emojis.slice(4)} radius={96} duration={7} reverse />
          </>
        )}

        <motion.div
          className="sintro__glow"
          aria-hidden
          animate={reduced ? undefined : { opacity: [0.5, 0.9, 0.5], scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
        />

        <motion.div
          className="sintro__vessel"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 24 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          transition={reduced ? { duration: 0.2 } : { type: 'spring', visualDuration: 0.62, bounce: 0.45 }}
        >
          <motion.div
            className="sintro__vessel-inner"
            animate={reduced ? undefined : { scale: [1, 1.05, 1] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut', delay: 0.5 }}
          >
            {mode === 'cocktail' ? <ShakerSvg reduced={!!reduced} /> : <CauldronSvg reduced={!!reduced} stirKey={0} />}
          </motion.div>
        </motion.div>
      </div>

      <motion.p
        className="sintro__label"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduced ? 0 : 0.45, type: 'spring', visualDuration: 0.5, bounce: 0 }}
      >
        {t(mode === 'cocktail' ? 'shared.introDrink' : 'shared.introDish')}
      </motion.p>

      {title && (
        <motion.h2
          className="sintro__title"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : 0.75, type: 'spring', visualDuration: 0.55, bounce: 0.2 }}
        >
          {title}
        </motion.h2>
      )}

      <motion.span
        className="sintro__skip"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduced ? 0 : 1.4 }}
      >
        {t('shared.introSkip')}
      </motion.span>
    </motion.div>
  );
}

/** Ring of upright emojis (parent spins, children counter-spin). */
function Orbit({ emojis, radius, duration, reverse = false }: { emojis: string[]; radius: number; duration: number; reverse?: boolean }) {
  if (emojis.length === 0) return null;
  return (
    <motion.div
      className="sintro__orbit"
      aria-hidden
      animate={{ rotate: reverse ? -360 : 360 }}
      transition={{ repeat: Infinity, ease: 'linear', duration }}
    >
      {emojis.map((emoji, i) => {
        const angle = (i * 360) / emojis.length;
        return (
          <span key={i} className="sintro__orbiter" style={{ transform: `rotate(${angle}deg) translateX(${radius}px)` }}>
            <motion.span
              className="sintro__orbiter-emoji"
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

/** Session-independent helper so callers stay declarative. */
export function useShareIntroState(intro: ShareIntroMode | undefined, ready: boolean) {
  const [done, setDone] = useState(false);
  const active = ready && intro !== undefined && intro !== 'off' && !done;
  return { active, finish: () => setDone(true) };
}
