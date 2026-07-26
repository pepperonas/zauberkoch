/** Password-reset landing (/passwort-zuruecksetzen?token=…). Sets a new
 * password from the emailed token; on success shows a celebratory state and a
 * link to sign in. Reuses the auth-panel styling + strength meter. */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { SparkBurst } from '../components/recipe/ConjureStage';
import { Icon } from '../components/icons';
import { Button } from '../components/ui';
import { t } from '../i18n';
import { api, ApiRequestError } from '../lib/api';
import { MIN_PASSWORD_LENGTH, passwordStrength } from '../lib/passwordStrength';
import { riseIn, spring } from '../motion/springs';
import { StrengthMeter } from '../features/auth/StrengthMeter';
import '../features/auth/auth.css';

export function ResetPasswordPage() {
  const reduced = useReducedMotion();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(!token);

  const strength = passwordStrength(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t('auth.passwordTooShort'));
    if (!strength.acceptable) return setError(t('auth.passwordWeak'));
    if (password !== confirm) return setError(t('auth.passwordMismatch'));

    setBusy(true);
    try {
      await api.resetPassword(token, password, confirm);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'invalid_token') setInvalid(true);
      else if (err instanceof ApiRequestError) setError(err.error.message || t('auth.errGeneric'));
      else setError(t('auth.errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <div className="authcard" style={{ marginTop: 'var(--space-8)' }}>
        <div className="auth__done">
          <span className="auth__done-icon" aria-hidden style={{ background: 'color-mix(in srgb, var(--c-error) 18%, transparent)', color: 'var(--c-error)' }}>
            <Icon name="warning" size={44} />
          </span>
          <h3>{t('auth.resetFailedTitle')}</h3>
          <p className="muted">{t('auth.resetFailedBody')}</p>
          <Button variant="tonal" onClick={() => (window.location.href = '/')}>{t('auth.toLogin')}</Button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <motion.div className="authcard" style={{ marginTop: 'var(--space-8)' }} {...(reduced ? {} : riseIn)} transition={spring}>
        {!reduced && <SparkBurst />}
        <div className="auth__done">
          <span className="auth__done-icon" aria-hidden><Icon name="checkCircle" size={44} /></span>
          <h3>{t('auth.resetDoneTitle')}</h3>
          <p className="muted">{t('auth.resetDoneBody')}</p>
          <Button onClick={() => (window.location.href = '/')}>{t('auth.toLogin')}</Button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="authcard" style={{ marginTop: 'var(--space-8)' }}>
      <div className="auth__forgot-head">
        <h3>{t('auth.resetTitle')}</h3>
        <p className="muted">{t('auth.resetBody')}</p>
      </div>
      <form className="auth__form" onSubmit={submit} noValidate>
        <label className="auth__label">
          {t('auth.password')}
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label={t('auth.password')} />
        </label>
        <StrengthMeter level={strength.level} />
        <label className="auth__label">
          {t('auth.passwordConfirm')}
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label={t('auth.passwordConfirm')} />
        </label>
        <AnimatePresence>
          {error && (
            <motion.p className="auth__error" role="alert" initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        <Button type="submit" big disabled={busy}>{busy ? t('auth.working') : t('auth.resetSubmit')}</Button>
      </form>
    </div>
  );
}
