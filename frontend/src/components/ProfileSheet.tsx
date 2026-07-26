/** Profile & preferences: persistent diet flags, no-go ingredients,
 * default servings — merged into every generation server-side. */

import { useEffect, useState } from 'react';

import { t } from '../i18n';
import { api } from '../lib/api';
import type { Preferences } from '../lib/types';
import { useApp } from '../state/app';
import { Icon } from './icons';
import { Button, Chip, Switch } from './ui';
import { Sheet } from './ui/Sheet';
import { ZutatInput } from './ui/ZutatInput';
import { useSnackbar } from './ui/Snackbar';
import '../pages/wizard.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Delegates logout to the shell (CRT power-off flow); falls back to a plain logout. */
  onLogout?: () => void;
}

export function ProfileSheet({ open, onClose, onLogout }: Props) {
  const { me, refreshMe } = useApp();
  const { show } = useSnackbar();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (open && me) setPrefs({ ...me.preferences });
  }, [open, me]);

  if (!prefs) return <Sheet open={false} onClose={onClose} label={t('profile.title')}>{null}</Sheet>;

  const set = (patch: Partial<Preferences>) => setPrefs({ ...prefs, ...patch });

  const addAvoid = () => {
    const item = input.trim();
    if (item && !prefs.vermeiden.includes(item) && prefs.vermeiden.length < 20) {
      set({ vermeiden: [...prefs.vermeiden, item] });
    }
    setInput('');
  };

  const pantry = prefs.vorraete ?? [];
  const save = async () => {
    await api.putPreferences(prefs);
    refreshMe();
    onClose();
    show(t('profile.saved'));
  };

  // On narrow screens the header logout is hidden — this is the fallback.
  const logout = async () => {
    if (onLogout) {
      onClose();
      onLogout(); // shell plays the CRT power-off and logs out after it
      return;
    }
    await api.logout();
    refreshMe();
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} label={t('profile.title')}>
      <div className="stack">
        <h3>{t('profile.title')}</h3>

        <span className="muted">{t('profile.diet')}</span>
        {(
          [
            ['vegetarisch', t('wizard.vegetarian')],
            ['vegan', t('wizard.vegan')],
            ['glutenfrei', t('wizard.glutenFree')],
            ['laktosefrei', t('wizard.lactoseFree')],
            ['proteinreich', t('wizard.highProtein')],
            ['ketogen', t('wizard.keto')],
          ] as const
        ).map(([key, label]) => (
          <div className="wiz__row" key={key}>
            <span className="wiz__row-label">{label}</span>
            <Switch
              checked={!!prefs[key]}
              onChange={(v) => set({ [key]: v, ...(key === 'vegan' && v ? { vegetarisch: true } : {}) })}
              label={label}
            />
          </div>
        ))}

        <div>
          <span className="wiz__row-label">{t('profile.avoid')}</span>
          <input
            className="input"
            style={{ marginTop: 'var(--space-2)' }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAvoid()}
            placeholder={t('profile.avoidPlaceholder')}
            maxLength={60}
          />
          {prefs.vermeiden.length > 0 && (
            <div className="chips" style={{ marginTop: 'var(--space-3)' }}>
              {prefs.vermeiden.map((item) => (
                <Chip key={item} selected onToggle={() => set({ vermeiden: prefs.vermeiden.filter((x) => x !== item) })}>
                  {item} <Icon name="close" size={13} />
                </Chip>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className="wiz__row-label">{t('profile.pantry')}</span>
          <p className="muted" style={{ font: 'var(--type-label-sm)', margin: 'var(--space-1) 0 0' }}>
            {t('profile.pantryHint')}
          </p>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <ZutatInput
              items={pantry}
              onChange={(next) => set({ vorraete: next })}
              placeholder={t('profile.pantryPlaceholder')}
              label={t('profile.pantry')}
              max={40}
            />
          </div>
        </div>

        <div className="wiz__row">
          <span className="wiz__row-label">{t('profile.defaultServings')}</span>
          <div className="stepper">
            <button
              className="stepper__btn"
              onClick={() => set({ standard_personen: Math.max(1, prefs.standard_personen - 1) })}
              aria-label="−"
            >
              −
            </button>
            <span className="stepper__value" style={{ height: 'auto' }}>{prefs.standard_personen}</span>
            <button
              className="stepper__btn"
              onClick={() => set({ standard_personen: Math.min(12, prefs.standard_personen + 1) })}
              aria-label="+"
            >
              +
            </button>
          </div>
        </div>

        <Button onClick={() => void save()}>{t('common.save')}</Button>
        <Button variant="text" onClick={() => void logout()}><Icon name="power" size={18} /> {t('auth.logout')}</Button>
      </div>
    </Sheet>
  );
}
