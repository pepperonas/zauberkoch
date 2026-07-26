/** Email/password auth UI (login · register · forgot) alongside the existing
 * Google button. Consistent with the app's M3 look + motion; the Google flow
 * is untouched. On a successful login the CRT power-on plays (same mechanism
 * as Google): we set the flag and do a full navigation to '/'. Registration
 * ends on a celebratory "check your email" state (no session yet). */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';

import { SparkBurst } from '../../components/recipe/ConjureStage';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui';
import { t } from '../../i18n';
import { api, ApiRequestError } from '../../lib/api';
import { MIN_PASSWORD_LENGTH, passwordStrength } from '../../lib/passwordStrength';
import { riseIn, spring } from '../../motion/springs';
import { StrengthMeter } from './StrengthMeter';
import './auth.css';

type View = 'login' | 'register' | 'forgot';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function armCrtAndEnter(): void {
  // Same as the Google path: arm the CRT reveal, then full-navigate so /me is
  // fresh and the shell plays the power-on into the app.
  sessionStorage.setItem('zk-crt-on', '1');
  window.location.href = '/';
}

function mapError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const code = err.error.code;
    if (code === 'email_unverified') return t('auth.errUnverified');
    if (code === 'invalid_credentials') return t('auth.errInvalidCredentials');
    if (code === 'rate_limited') return t('auth.errRateLimited');
    if (code === 'weak_password' || code === 'validation_error') return err.error.message || t('auth.errGeneric');
    return err.error.message || t('auth.errGeneric');
  }
  return t('auth.errGeneric');
}

export function AuthPanel({ onGoogle }: { onGoogle: () => void }) {
  const reduced = useReducedMotion();
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'register' | 'forgot' | null>(null);

  const strength = passwordStrength(password);

  const switchView = (v: View) => {
    setView(v);
    setError('');
    setConfirm('');
    setDone(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const mail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) return setError(t('auth.invalidEmail'));

    if (view !== 'forgot') {
      if (password.length < MIN_PASSWORD_LENGTH) return setError(t('auth.passwordTooShort'));
      if (view === 'register') {
        if (!strength.acceptable) return setError(t('auth.passwordWeak'));
        if (password !== confirm) return setError(t('auth.passwordMismatch'));
      }
    }

    setBusy(true);
    try {
      if (view === 'login') {
        await api.loginPassword(mail, password);
        armCrtAndEnter();
        return; // navigating away
      }
      if (view === 'register') {
        await api.register(mail, password, confirm);
        setDone('register');
      } else {
        await api.forgotPassword(mail);
        setDone('forgot');
      }
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <motion.div className="auth authcard" {...(reduced ? {} : riseIn)} transition={spring}>
        {!reduced && <SparkBurst />}
        <div className="auth__done">
          <span className="auth__done-icon" aria-hidden>
            <Icon name={done === 'register' ? 'mail' : 'check'} size={44} />
          </span>
          <h3>{done === 'register' ? t('auth.registerDoneTitle') : t('auth.forgotTitle')}</h3>
          <p className="muted">{done === 'register' ? t('auth.registerDoneBody') : t('auth.forgotDone')}</p>
          {done === 'register' && <p className="muted auth__hint">{t('auth.registerCheckSpam')}</p>}
          <Button variant="text" onClick={() => switchView('login')}>{t('auth.backToLogin')}</Button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="auth authcard">
      <Button className="auth__google" big onClick={onGoogle}>
        <Icon name="globe" size={18} /> {t('auth.login')}
      </Button>

      <div className="auth__divider" aria-hidden><span>{t('auth.orDivider')}</span></div>

      {view !== 'forgot' && (
        <div className="auth__tabs" role="tablist">
          {(['login', 'register'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`auth__tab ${view === v ? 'auth__tab--active' : ''}`}
              onClick={() => switchView(v)}
            >
              {v === 'login' ? t('auth.tabLogin') : t('auth.tabRegister')}
            </button>
          ))}
        </div>
      )}

      {view === 'forgot' && (
        <div className="auth__forgot-head">
          <h3>{t('auth.forgotTitle')}</h3>
          <p className="muted">{t('auth.forgotBody')}</p>
        </div>
      )}

      <form className="auth__form" onSubmit={submit} noValidate>
        <label className="auth__label">
          {t('auth.email')}
          <input
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPlaceholder')}
            aria-label={t('auth.email')}
          />
        </label>

        {view !== 'forgot' && (
          <label className="auth__label">
            {t('auth.password')}
            <input
              className="input"
              type="password"
              autoComplete={view === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label={t('auth.password')}
            />
          </label>
        )}

        {view === 'register' && (
          <>
            <StrengthMeter level={strength.level} />
            <label className="auth__label">
              {t('auth.passwordConfirm')}
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-label={t('auth.passwordConfirm')}
              />
            </label>
          </>
        )}

        <AnimatePresence>
          {error && (
            <motion.p
              className="auth__error"
              role="alert"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <Button type="submit" big disabled={busy}>
          {busy
            ? t('auth.working')
            : view === 'login'
              ? t('auth.signIn')
              : view === 'register'
                ? t('auth.createAccount')
                : t('auth.forgotSubmit')}
        </Button>
      </form>

      <div className="auth__links">
        {view === 'login' && (
          <button className="auth__textlink" onClick={() => switchView('forgot')}>{t('auth.forgotLink')}</button>
        )}
        {view === 'forgot' && (
          <button className="auth__textlink" onClick={() => switchView('login')}>{t('auth.backToLogin')}</button>
        )}
      </div>
    </div>
  );
}
