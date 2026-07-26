/** Password strength meter — shared by the register form and the reset page. */

import { t } from '../../i18n';
import './auth.css';

const LABELS = ['', 'auth.strength.weak', 'auth.strength.ok', 'auth.strength.good', 'auth.strength.strong'] as const;

export function StrengthMeter({ level }: { level: number }) {
  return (
    <div className="auth__strength" aria-hidden>
      <div className="auth__strength-bars">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`auth__strength-bar ${level >= i ? `is-${level}` : ''}`} />
        ))}
      </div>
      {level > 0 && <span className={`auth__strength-label is-${level}`}>{t(LABELS[level] as Parameters<typeof t>[0])}</span>}
    </div>
  );
}
