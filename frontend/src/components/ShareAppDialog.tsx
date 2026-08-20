/** "App teilen" — one dialog, reachable from the profile sheet and the footer.
 *
 * Two ways to hand the app on, because the situation decides which one works:
 * a link when the other person is elsewhere, a QR code when they are sitting
 * across the table. Both are offered as full-width rows rather than hidden
 * behind a menu — the whole point is that nobody has to look for them.
 *
 * The native share sheet is offered FIRST where the browser has one (phones,
 * essentially): it is one tap to WhatsApp, Signal or Mail, and it beats
 * copy-then-switch-apps every time. On desktop it simply is not rendered
 * instead of being shown disabled — an inert control is worse than no control.
 *
 * The QR expands in place instead of replacing the dialog: after scanning
 * fails (bad light, cracked lens) the link row is still right there, and
 * nobody has to find their way back.
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';

import { t } from '../i18n';
import { effectsDefault, fastSpatial } from '../motion/tokens';
import { Icon, type IconName } from './icons';
import { Button } from './ui';
import { Dialog } from './ui/Dialog';
import { useSnackbar } from './ui/Snackbar';
import './shareApp.css';

/** The QR encoder (~7 kB) has no business in the entry chunk — it is needed
 *  only if someone opens this dialog AND picks the QR. */
const QrCode = lazy(() => import('./QrCode').then((m) => ({ default: m.QrCode })));

export const APP_URL = 'https://zauberkoch.de';
/** What the link row shows: the URL without its scheme reads as a place, not
 *  as a string to be parsed. The scheme is still what gets copied. */
const APP_URL_LABEL = 'zauberkoch.de';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShareAppDialog({ open, onClose }: Props) {
  const { show } = useSnackbar();
  const reduced = useReducedMotion();
  const [showQr, setShowQr] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // Read once the dialog opens rather than at module scope: navigator.share
  // exists per browser, but checking it during render would also run in the
  // hidden prewarm mount and in tests without a navigator.
  useEffect(() => {
    if (open) setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    else setShowQr(false); // next opening starts from the choice, not mid-flow
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      show(t('shareApp.copied'));
    } catch {
      // Clipboard access can be refused (permissions, insecure context, an
      // iOS quirk). Saying so beats a silent no-op that looks like success.
      show(t('shareApp.copyFailed'));
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: 'Zauberkoch', text: t('shareApp.intro'), url: APP_URL });
    } catch {
      /* cancelled by the user — not an error */
    }
  };

  const rows: { key: string; icon: IconName; label: string; hint: string; onClick: () => void; primary?: boolean }[] = [
    ...(canShare
      ? [{ key: 'native', icon: 'share' as IconName, label: t('shareApp.native'), hint: t('shareApp.nativeHint'), onClick: () => void nativeShare(), primary: true }]
      : []),
    { key: 'copy', icon: 'link', label: t('shareApp.copy'), hint: APP_URL_LABEL, onClick: () => void copy() },
    {
      key: 'qr',
      icon: 'qr',
      label: showQr ? t('shareApp.qrHide') : t('shareApp.qr'),
      hint: t('shareApp.qrHint'),
      onClick: () => setShowQr((v) => !v),
    },
  ];

  return (
    <Dialog open={open} onClose={onClose} label={t('shareApp.title')}>
      <div className="stack shareapp">
        <h3>{t('shareApp.title')}</h3>
        <p className="muted">{t('shareApp.intro')}</p>

        <div className="shareapp__rows">
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`shareapp__row${r.primary ? ' shareapp__row--primary' : ''}${r.key === 'qr' && showQr ? ' shareapp__row--on' : ''}`}
              onClick={r.onClick}
              aria-expanded={r.key === 'qr' ? showQr : undefined}
            >
              <span className="shareapp__mark" aria-hidden>
                <Icon name={r.icon} size={20} />
              </span>
              <span className="shareapp__text">
                <strong>{r.label}</strong>
                <span>{r.hint}</span>
              </span>
              <Icon name={r.key === 'qr' ? 'chevronDown' : 'chevronRight'} size={18} className="shareapp__chevron" />
            </button>
          ))}
        </div>

        <AnimatePresence initial={false}>
          {showQr && (
            <motion.div
              className="shareapp__qrwrap"
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={reduced ? effectsDefault : fastSpatial}
            >
              {/* The plate is white in BOTH themes on purpose: a QR on a dark
                  surface is invisible to a good number of cameras, and this
                  app is dark by default. */}
              <div className="shareapp__plate">
                <Suspense fallback={<div className="shareapp__qrskeleton" aria-hidden />}>
                  <QrCode text={APP_URL} label={t('shareApp.qrAlt')} />
                </Suspense>
              </div>
              <p className="muted shareapp__caption">{t('shareApp.qrCaption')}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Always selectable, always visible: the fallback for every case the
            buttons cannot serve — reading it out, typing it over, a browser
            that refuses clipboard access. */}
        <input
          className="input shareapp__url"
          readOnly
          value={APP_URL}
          aria-label={t('shareApp.linkLabel')}
          onFocus={(e) => e.target.select()}
        />

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="text" onClick={onClose}>{t('shareApp.close')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
