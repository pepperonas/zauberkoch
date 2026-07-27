/** Thumbs-up/-down feedback per recipe — the data behind prompt iteration.
 * Thumbs down opens quick reason chips; everything lands in the backend log. */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';

import { strings, t } from '../../i18n';
import { api } from '../../lib/api';
import { springBouncy } from '../../motion/springs';
import { Icon } from '../icons';
import { IconButton } from '../ui';
import { useSnackbar } from '../ui/Snackbar';

interface Props {
  recipeId: number;
  initial?: number | null;
}

export function FeedbackBar({ recipeId, initial = null }: Props) {
  const reduced = useReducedMotion();
  const { show } = useSnackbar();
  const [value, setValue] = useState<number | null>(initial);
  const [askReason, setAskReason] = useState(false);

  const send = async (wert: 1 | -1, grund = '') => {
    setValue(wert);
    setAskReason(false);
    await api.feedback(recipeId, wert, grund);
    show(t('feedback.thanks'));
  };

  return (
    <div className="row detail__feedback" style={{ flexWrap: 'wrap', marginTop: 'var(--space-5)' }}>
      <span className="muted">{t('feedback.question')}</span>
      <IconButton label={t('feedback.up')} active={value === 1} onClick={() => void send(1)}>
        <Icon name="thumbUp" size={20} />
      </IconButton>
      <IconButton
        label={t('feedback.down')}
        active={value === -1}
        onClick={() => {
          setAskReason(true);
        }}
      >
        <Icon name="thumbDown" size={20} />
      </IconButton>
      <AnimatePresence>
        {askReason && (
          <motion.div
            className="chips"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={springBouncy}
          >
            {strings.feedback.reasons.map((reason) => (
              <button key={reason} className="chip" onClick={() => void send(-1, reason)}>
                {reason}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
