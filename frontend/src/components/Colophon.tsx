/** Footer colophon: four cards (open source · support · review · share) above
 * the legal line, with a small origin note between.
 *
 * Owns the genie hover state, because the effect needs one thing the cards
 * cannot supply on their own: where the plume starts. The emitter is the
 * hovered card's icon, measured against the field's box the moment the pointer
 * arrives — so the dots really do leave *that* icon.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { t } from '../i18n';
import { Icon } from './icons';
import { GithubMark } from './icons/GithubMark';
import type { GenieShapeKey } from './colophon/genieShapes';

// Canvas + sampler stay out of the entry chunk; nothing here is needed until a
// pointer that can hover actually hovers.
const GenieField = lazy(() =>
  import('./colophon/GenieField').then((m) => ({ default: m.GenieField })),
);
// Same reasoning: the dialog carries the QR encoder behind it, and neither is
// needed until someone actually wants to pass the app on.
const ShareAppDialog = lazy(() =>
  import('./ShareAppDialog').then((m) => ({ default: m.ShareAppDialog })),
);

const GITHUB_URL = 'https://github.com/pepperonas/zauberkoch';
const DONATE_URL = 'https://www.paypal.com/donate/?business=martin.pfeffer%40celox.io&currency_code=EUR';
const REVIEW_URL = 'https://g.page/r/CXgdRV3QysvxEBM/review';

/** Hover effects belong to pointers that hover. Checked in JS as well as CSS
 *  so the canvas never even mounts on a phone. */
function canHover(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function Colophon() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<GenieShapeKey | null>(null);
  // The emitter OUTLIVES the hover: when the figure disperses, its surplus dots
  // fly home into the icon they came from, so the field still needs to know
  // which one that was.
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Arm as soon as the footer comes into view, not on hover: the field is a
  // lazy chunk and the silhouettes have to be rasterized, and doing both at
  // hover time means the plume only starts a few hundred ms in — the first
  // hover looked broken. By the time a pointer can reach a card, it is ready.
  const arm = useCallback(() => {
    if (!canHover()) return;
    setArmed((was) => {
      if (was) return was;
      const warm = () => void import('./colophon/genieShapes').then((m) => m.prewarmFields());
      // `'requestIdleCallback' in window` would narrow the else branch to
      // `never` (the lib declares it) — the build catches that, --noEmit does not.
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(warm, { timeout: 1200 });
      } else {
        window.setTimeout(warm, 300);
      }
      return true;
    });
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || armed || !canHover()) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          arm();
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(box);
    return () => io.disconnect();
  }, [arm, armed]);

  // Typed on HTMLElement, not HTMLAnchorElement: the share card is a button.
  const enter = useCallback((next: GenieShapeKey) => (e: React.PointerEvent<HTMLElement>) => {
    if (!canHover()) return;
    const mark = e.currentTarget.querySelector('.colophon__mark')?.getBoundingClientRect();
    if (!mark) return;
    // Viewport coordinates — the field converts them against its own box,
    // which overhangs this element.
    setOrigin({ x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 });
    setShape(next);
  }, []);

  // Leaving is handled by the CONTAINER, not by each card: card-level
  // pointerleave would fire on the way to a neighbour and start a retract that
  // the following enter has to undo — the figure would flinch on every switch.
  // From here, moving between cards (or across the gap between them) is a plain
  // retarget, and only leaving the colophon puts the genie away.
  const leave = useCallback(() => setShape(null), []);

  // `href` opens a page, `onClick` opens the dialog — the card renders as a
  // link or a button accordingly. A link that does not navigate would lie to
  // the middle mouse button, to "open in new tab" and to screen readers.
  const cards: {
    key: GenieShapeKey;
    href?: string;
    onClick?: () => void;
    className: string;
    mark: React.ReactNode;
    title: string;
    body: string;
  }[] = [
    {
      key: 'github' as const,
      href: GITHUB_URL,
      className: '',
      mark: <span className="colophon__mark colophon__mark--gh" aria-hidden><GithubMark size={22} /></span>,
      title: t('colophon.githubTitle'),
      body: t('colophon.githubBody'),
    },
    {
      key: 'donate' as const,
      href: DONATE_URL,
      className: ' colophon__card--donate',
      mark: <span className="colophon__mark colophon__mark--pp" aria-hidden><Icon name="heart" size={20} /></span>,
      title: t('colophon.donateTitle'),
      body: t('colophon.donateBody'),
    },
    {
      // Also offered in the support dialog — but that appears once and can be
      // dismissed for good, so the one permanent place is here.
      key: 'review' as const,
      href: REVIEW_URL,
      className: ' colophon__card--review',
      mark: <span className="colophon__mark colophon__mark--star" aria-hidden><Icon name="star" size={20} /></span>,
      title: t('colophon.reviewTitle'),
      body: t('colophon.reviewBody'),
    },
    {
      key: 'share' as const,
      onClick: () => setShareOpen(true),
      className: ' colophon__card--share',
      mark: <span className="colophon__mark colophon__mark--share" aria-hidden><Icon name="share" size={20} /></span>,
      title: t('colophon.shareTitle'),
      body: t('colophon.shareBody'),
    },
  ];

  return (
    <div
      className={`colophon${shape ? ' colophon--genie' : ''}`}
      ref={boxRef}
      onPointerEnter={arm}
      onPointerLeave={leave}
    >
      {armed && (
        <Suspense fallback={null}>
          <GenieField shape={shape} origin={origin} />
        </Suspense>
      )}

      {cards.map((c) => {
        const inner = (
          <>
            {c.mark}
            <span className="colophon__text">
              <strong>{c.title}</strong>
              <span>{c.body}</span>
            </span>
          </>
        );
        return c.href ? (
          <a
            key={c.key}
            className={`colophon__card${c.className}`}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            onPointerEnter={enter(c.key)}
          >
            {inner}
          </a>
        ) : (
          <button
            key={c.key}
            type="button"
            className={`colophon__card${c.className}`}
            onClick={c.onClick}
            onPointerEnter={enter(c.key)}
          >
            {inner}
          </button>
        );
      })}

      {shareOpen && (
        <Suspense fallback={null}>
          <ShareAppDialog open onClose={() => setShareOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
