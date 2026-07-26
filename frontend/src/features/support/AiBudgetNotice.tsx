/** "AI budget exhausted" notice — shown when the PROJECT's daily AI budget is
 * used up (global/anon), never for a personal daily limit. Explains the cause,
 * names the concrete time it comes back, and asks — gently, once — for support.
 *
 * Four tone variants live in i18n under `budget`; switch via VARIANT:
 *   'short'    1–2 sentences, for inline placement
 *   'standard' recommended dialog copy
 *   'warm'     more emotional, still professional
 *   'fun'      a pinch of humour
 */

import { motion, useReducedMotion } from 'motion/react';

import { Icon } from '../../components/icons';
import { GithubMark } from '../../components/icons/GithubMark';
import { Button } from '../../components/ui';
import { t } from '../../i18n';
import { heroEnter, reducedFade, slowSpatial, staggerIn } from '../../motion/tokens';
import './budget.css';

export type BudgetVariant = 'short' | 'standard' | 'warm' | 'fun';

/** Active copy. 'standard' is the recommended default. */
export const VARIANT: BudgetVariant = 'standard';

const DONATE_URL = 'https://www.paypal.com/donate/?business=martin.pfeffer%40celox.io&currency_code=EUR';
const REPO_URL = 'https://github.com/pepperonas/zauberkoch-pwa';

const COPY: Record<BudgetVariant, { title: string; body: string }> = {
  short: { title: 'budget.shortTitle', body: 'budget.shortBody' },
  standard: { title: 'budget.title', body: 'budget.body' },
  warm: { title: 'budget.warmTitle', body: 'budget.warmBody' },
  fun: { title: 'budget.funTitle', body: 'budget.funBody' },
};

/** Local time the budget resets, from the server's `retry_after` seconds. */
export function resetTimeLabel(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return '';
  const when = new Date(Date.now() + retryAfterSeconds * 1000);
  return `ab ${when.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
}

interface Props {
  /** Seconds until the budget resets (server-provided). */
  retryAfter?: number;
  /** Back to the wizard / previous view. */
  onRetry: () => void;
  variant?: BudgetVariant;
}

export function AiBudgetNotice({ retryAfter, onRetry, variant = VARIANT }: Props) {
  const reduced = useReducedMotion();
  const time = resetTimeLabel(retryAfter);
  const copy = COPY[variant];
  // Without a known reset time the standard variant has a dedicated sentence;
  // the others degrade to "morgen" so no empty gap is left in the text.
  const bodyKey = !time && variant === 'standard' ? 'budget.bodyNoTime' : copy.body;
  const body = t(bodyKey).replace('{time}', time || 'morgen');

  const item = (i: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: reduced ? reducedFade : staggerIn(i, 0.06),
  });

  return (
    <section className="budget" aria-labelledby="budget-title">
      <motion.div
        className="budget__icon"
        aria-hidden
        initial={reduced ? { opacity: 0 } : heroEnter.initial}
        animate={reduced ? { opacity: 1 } : heroEnter.animate}
        transition={reduced ? reducedFade : slowSpatial}
      >
        <Icon name="snooze" size={48} />
      </motion.div>

      <motion.h2 id="budget-title" className="budget__title" {...item(1)}>
        {t(copy.title)}
      </motion.h2>

      <motion.p className="budget__body" {...item(2)}>
        {body}
      </motion.p>

      {time && (
        <motion.p className="budget__eta" {...item(3)}>
          <Icon name="clock" size={15} /> {t('budget.backAvailable').replace('{time}', time)}
        </motion.p>
      )}

      <motion.p className="budget__ask muted" {...item(4)}>
        {t('budget.ask')}
      </motion.p>

      <motion.div className="budget__actions" {...item(5)}>
        <a className="btn btn--filled budget__donate" href={DONATE_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="heart" size={18} /> {t('budget.donate')}
        </a>
        <span className="budget__donate-hint muted">{t('budget.donateHint')}</span>
      </motion.div>

      <motion.a
        className="budget__github"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        {...item(6)}
        whileTap={reduced ? undefined : { scale: 0.98 }}
      >
        <span className="budget__github-mark" aria-hidden>
          <GithubMark />
        </span>
        <span className="budget__github-text">
          <strong>{t('budget.githubTitle')}</strong>
          <span className="muted">{t('budget.githubBody')}</span>
        </span>
        <Icon name="link" size={18} />
      </motion.a>

      <motion.div className="budget__foot" {...item(7)}>
        <Button variant="tonal" onClick={onRetry}>
          <Icon name="history" size={18} /> {t('budget.retry')}
        </Button>
        <a className="budget__more" href="/nutzungsbedingungen">
          {t('budget.more')}
        </a>
      </motion.div>
    </section>
  );
}

