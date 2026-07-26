/** Email-confirmation landing (/bestaetigen?token=…). Confirms the address,
 * which auto-logs the user in server-side, then plays the CRT power-on into
 * the app. Invalid/expired tokens show a clear recovery message. */

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { SparkBurst } from '../components/recipe/ConjureStage';
import { Icon } from '../components/icons';
import { Button } from '../components/ui';
import { t } from '../i18n';
import { api } from '../lib/api';
import { riseIn, spring } from '../motion/springs';
import '../features/auth/auth.css';

export function VerifyEmailPage() {
  const reduced = useReducedMotion();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'checking' | 'ok' | 'failed'>('checking');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode / re-render guard: verify once
    ran.current = true;
    if (!token) {
      setState('failed');
      return;
    }
    api
      .verifyEmail(token)
      .then(() => {
        setState('ok');
        // Confirmed + session set → arm the CRT reveal and enter the app.
        sessionStorage.setItem('zk-crt-on', '1');
        setTimeout(() => (window.location.href = '/'), 900);
      })
      .catch(() => setState('failed'));
  }, [token]);

  return (
    <div className="authcard" style={{ marginTop: 'var(--space-8)' }}>
      {state === 'checking' && (
        <div className="auth__done">
          <motion.span
            aria-hidden
            style={{ display: 'inline-flex', color: 'var(--c-primary)' }}
            animate={reduced ? undefined : { rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
          >
            <Icon name="wand" size={40} />
          </motion.span>
          <p className="muted">{t('auth.verifyChecking')}</p>
        </div>
      )}
      {state === 'ok' && (
        <motion.div className="auth__done" {...(reduced ? {} : riseIn)} transition={spring}>
          {!reduced && <SparkBurst />}
          <span className="auth__done-icon" aria-hidden><Icon name="checkCircle" size={44} /></span>
          <h3>{t('auth.loggingIn')}</h3>
        </motion.div>
      )}
      {state === 'failed' && (
        <div className="auth__done">
          <span className="auth__done-icon" aria-hidden style={{ background: 'color-mix(in srgb, var(--c-error) 18%, transparent)', color: 'var(--c-error)' }}>
            <Icon name="warning" size={44} />
          </span>
          <h3>{t('auth.verifyFailedTitle')}</h3>
          <p className="muted">{t('auth.verifyFailedBody')}</p>
          <Button variant="tonal" onClick={() => (window.location.href = '/')}>{t('auth.toLogin')}</Button>
        </div>
      )}
    </div>
  );
}
