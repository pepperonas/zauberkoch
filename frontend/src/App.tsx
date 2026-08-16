import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import {
  createBrowserRouter,
  Link,
  NavLink,
  Outlet,
  ScrollRestoration,
  useLocation,
} from 'react-router-dom';

import { CrtOff, CrtOn } from './components/CrtOff';
import { Icon, type IconName } from './components/icons';
import { ProfileSheet } from './components/ProfileSheet';
import { Colophon } from './components/Colophon';
import { SupportPrompt } from './components/SupportPrompt';
import { IconButton } from './components/ui';
import { strings, t } from './i18n';
import { api } from './lib/api';
import { clearApiCache, LAST_ACCOUNT_KEY, shouldClearApiCache } from './lib/apiCache';
import { spring } from './motion/springs';
import { clearTabTransition, markTabTransition, TAB_DIR_TTL_MS, TAB_ORDER } from './lib/tabTransition';
import { cancelGeneration, getGeneration } from './state/generation';
import { useApp } from './state/app';
import { useOnline } from './state/useOnline';
import './App.css';

// Route-based code splitting: each page loads on demand.
// lazyPage self-heals stale sessions: after a deploy the old hashed chunks
// are eventually pruned -> dynamic import 404s -> reload ONCE to pick up the
// fresh shell (guarded per chunk so a real outage can't reload-loop).
function lazyPage<T extends React.ComponentType>(name: string, factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    const guard = `zk-chunk-reload-${name}`;
    try {
      const mod = await factory();
      sessionStorage.removeItem(guard);
      return mod;
    } catch (err) {
      if (!sessionStorage.getItem(guard)) {
        sessionStorage.setItem(guard, '1');
        window.location.reload();
        return { default: (() => null) as unknown as T };
      }
      throw err;
    }
  });
}

const GeneratePage = lazyPage('generate', () => import('./pages/GeneratePage').then((m) => ({ default: m.GeneratePage })));
const RecipeDetailPage = lazyPage('detail', () => import('./pages/RecipeDetailPage').then((m) => ({ default: m.RecipeDetailPage })));
const FavoritesPage = lazyPage('favorites', () => import('./pages/FavoritesPage').then((m) => ({ default: m.FavoritesPage })));
const HistoryPage = lazyPage('history', () => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const ShoppingPage = lazyPage('shopping', () => import('./pages/ShoppingPage').then((m) => ({ default: m.ShoppingPage })));
const PlanPage = lazyPage('plan', () => import('./pages/PlanPage').then((m) => ({ default: m.PlanPage })));
const SharePage = lazyPage('share', () => import('./pages/SharePage').then((m) => ({ default: m.SharePage })));
const LandingPage = lazyPage('landing', () => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const AdminPage = lazyPage('admin', () => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const ImpressumPage = lazyPage('impressum', () => import('./pages/legal/ImpressumPage').then((m) => ({ default: m.ImpressumPage })));
const DatenschutzPage = lazyPage('datenschutz', () => import('./pages/legal/DatenschutzPage').then((m) => ({ default: m.DatenschutzPage })));
const TermsPage = lazyPage('terms', () => import('./pages/legal/TermsPage').then((m) => ({ default: m.TermsPage })));
const VerifyEmailPage = lazyPage('verify', () => import('./pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })));
const ResetPasswordPage = lazyPage('reset', () => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
// Lazy on purpose: keeps motion-dom's full engine out of the entry chunk
// (a component imported by the entry hoists its whole dep graph there).
const GenerationPill = lazyPage('genpill', () =>
  import('./components/GenerationPill').then((m) => ({ default: m.GenerationPill })),
);
const GenerationBar = lazyPage('genbar', () =>
  import('./components/GenerationPill').then((m) => ({ default: m.GenerationBar })),
);

// Icon + label per tab; the ORDER lives in TAB_ORDER (lib/tabTransition), so
// the slide direction of a tab switch can never disagree with the bar itself.
const NAV_META: Record<string, { icon: IconName; label: string }> = {
  '/': { icon: 'sparkles', label: strings.nav.generate },
  '/favoriten': { icon: 'star', label: strings.nav.favorites },
  '/verlauf': { icon: 'history', label: strings.nav.history },
  '/einkauf': { icon: 'cart', label: strings.nav.shopping },
  '/plan': { icon: 'calendar', label: strings.nav.plan },
};
const NAV_ITEMS = TAB_ORDER.map((to) => ({ to, ...NAV_META[to] }));

/**
 * App shell (layout route). Route changes are animated by react-router's BUILT-IN
 * view transitions — every navigation carries `viewTransition`, so the browser
 * snapshots old→new and morphs shared elements (recipe motif/title, named via
 * useViewTransitionState) while the rest crossfades, for PUSH and POP alike
 * (including the browser/system back button). Scroll is restored by
 * <ScrollRestoration/>. The sticky header's blur is captured in the snapshot.
 */
function Shell() {
  const { me, meLoading, toggleTheme, refreshMe } = useApp();
  const location = useLocation();
  const online = useOnline();
  const reduced = useReducedMotion();
  const [profileOpen, setProfileOpen] = useState(false);

  // Logout runs behind a CRT power-off overlay: 'anim' plays the tube
  // shutdown, 'done' holds full black while the session actually ends, and
  // once `me` is gone (landing page mounted underneath) the overlay exits
  // with a short reveal fade. Reduced motion skips the theatrics entirely.
  const [crtPhase, setCrtPhase] = useState<'idle' | 'anim' | 'done'>('idle');

  // CRT power-ON after a successful login: LandingPage arms a sessionStorage
  // flag before the OAuth full-page redirect; we read it once on boot (and
  // clear it immediately so a reload never replays). The overlay holds the
  // dark tube while /me resolves, then opens onto the app. Login failed or
  // reduced motion → drop it without theatrics.
  const [crtOn, setCrtOn] = useState(() => sessionStorage.getItem('zk-crt-on') === '1');
  useEffect(() => {
    sessionStorage.removeItem('zk-crt-on');
  }, []);
  useEffect(() => {
    if (crtOn && (reduced || (!meLoading && !me))) setCrtOn(false);
  }, [crtOn, reduced, meLoading, me]);

  // The service worker's API cache holds ONE account's recipes under URLs that
  // are the same for everybody. Drop it whenever the signed-in identity really
  // changes (sign-out, or a different account appearing) — but never on a
  // plain page load, which would leave nothing readable offline.
  useEffect(() => {
    if (meLoading) return;
    const current = me ? String(me.id) : '';
    const previous = localStorage.getItem(LAST_ACCOUNT_KEY) ?? '';
    if (previous === current) return;
    if (shouldClearApiCache(previous, current)) clearApiCache();
    localStorage.setItem(LAST_ACCOUNT_KEY, current);
  }, [me, meLoading]);

  const handleLogout = () => {
    if (reduced) {
      void api.logout().finally(refreshMe);
      return;
    }
    setCrtPhase((p) => (p === 'idle' ? 'anim' : p));
  };

  // The actual logout fires only after the tube is dark (task: no redirect
  // mid-animation). finally: even a failed call refreshes /me — and the
  // timeout below guarantees the overlay can never trap the user on black.
  useEffect(() => {
    if (crtPhase !== 'done') return;
    void api.logout().finally(refreshMe);
    const failsafe = window.setTimeout(() => setCrtPhase('idle'), 2500);
    return () => window.clearTimeout(failsafe);
    // deps: crtPhase only — refreshMe changes identity when `me` flips, and
    // re-running here would fire a second logout call.
  }, [crtPhase]);

  useEffect(() => {
    if (crtPhase === 'done' && !me) setCrtPhase('idle'); // landing is there — reveal
  }, [crtPhase, me]);

  // Retire the data-tab-dir stamp once its transition is over. The delay must
  // outlive the animation (the stamp scopes the running CSS), and being gone
  // before the next unrelated navigation is what keeps the card→detail morph
  // from inheriting a sideways slide. Re-clicking a tab within the window is
  // fine: its onClick stamps fresh before this timer would have mattered.
  useEffect(() => {
    if (!('tabDir' in document.documentElement.dataset)) return;
    const timer = window.setTimeout(clearTabTransition, TAB_DIR_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [location]);

  // Warm the route chunks on idle so navigating never hits a blank Suspense
  // fallback (the flash between an instant DOM swap and the entering animation).
  useEffect(() => {
    type IdleWin = Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWin;
    const schedule = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
    const id = schedule(() => {
      void import('./pages/FavoritesPage');
      void import('./pages/HistoryPage');
      void import('./pages/ShoppingPage');
      void import('./pages/PlanPage');
    });
    return () => w.cancelIdleCallback?.(id as number);
  }, []);

  return (
    <div className="shell">
      <header className="shell__header">
        {/* SPA link — a real <a href> would hard-reload and kill a running generation */}
        <Link
          to="/"
          viewTransition
          className="shell__logo"
          onClick={() => {
            // After a finished generation the logo doubles as "Neues Rezept":
            // navigating home alone would just show the old result again.
            // Only for 'done' — clicking the logo must never abort a running
            // (already paid for) generation; that's what Abbrechen is for.
            // Read via getGeneration() instead of the hook so the shell doesn't
            // re-render on every streamed token.
            if (getGeneration().phase === 'done') cancelGeneration();
          }}
        >
          <Icon name="logo" size={28} /> <span className="shell__logo-text">{t('app.name')}</span>
        </Link>
        <div className="row shell__actions">
          <IconButton
            label={t('common.themeToggle')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }}
          >
            {/* Both glyphs are rendered; CSS picks one from :root[data-theme].
                That keeps the toggle's own appearance off React state, so the
                theme switch needs NO re-render while the reveal animates
                (see toggleTheme — React work is deferred past the transition). */}
            <span className="themeicon" aria-hidden>
              <Icon name="moon" size={24} className="themeicon__moon" />
              <Icon name="sun" size={24} className="themeicon__sun" />
            </span>
          </IconButton>
          {me?.is_admin && (
            <NavLink to="/admin" viewTransition className={`iconbtn ${location.pathname.startsWith('/admin') ? 'iconbtn--active' : ''}`} aria-label={t('admin.open')} title={t('admin.open')}>
              <Icon name="shield" size={24} />
            </NavLink>
          )}
          {me && (
            <>
              <IconButton label={t('profile.open')} onClick={() => setProfileOpen(true)}>
                {me.picture_url ? (
                  <img className="avatar" src={me.picture_url} alt={me.name || me.email} width={34} height={34} referrerPolicy="no-referrer" />
                ) : (
                  <Icon name="user" size={24} />
                )}
              </IconButton>
              <IconButton className="shell__logout" label={t('auth.logout')} onClick={handleLogout}>
                <Icon name="power" size={24} />
              </IconButton>
            </>
          )}
        </div>
        {me && (
          <Suspense fallback={null}>
            <GenerationBar />
          </Suspense>
        )}
      </header>

      {/* Network status — the SW still serves the cached shell + favorites/recipes
          offline, so this is an unobtrusive status line, not a blocking error. */}
      <AnimatePresence>
        {!online && (
          <motion.div
            className="offline-bar"
            role="status"
            aria-live="polite"
            initial={{ y: -44, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -44, opacity: 0 }}
            transition={spring}
          >
            <Icon name="wifiOff" size={16} /> {t('common.offline')}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="shell__main">
        <Suspense fallback={<div className="page-tx__spacer" aria-hidden />}>
          <Outlet />
        </Suspense>
      </main>

      {/* Pre-resolve the lazy detail page (off-route) so the shared-element view
          transition renders it synchronously — a lazy component suspends for a
          frame on first render, which cancels the morph. Kept out of the entry
          chunk (loads on demand) but warmed here; renders nothing without a
          recipe id. Skipped on the detail route itself to avoid a double mount. */}
      {me && !location.pathname.startsWith('/rezept/') && (
        <div aria-hidden style={{ display: 'none' }}>
          <Suspense fallback={null}>
            <RecipeDetailPage />
          </Suspense>
        </div>
      )}

      {me && <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} onLogout={handleLogout} />}
      {me && <SupportPrompt />}
      {me && (
        <Suspense fallback={null}>
          <GenerationPill />
        </Suspense>
      )}

      <footer className="shell__footer">
        <Colophon />

        <p className="colophon__origin">
          {t('colophon.madeWith')}
          <span className="colophon__heart" aria-label="Liebe" role="img">
            <Icon name="heart" size={13} />
          </span>
          {t('colophon.madeIn')}
        </p>

        <nav className="shell__legal" aria-label="Rechtliches">
          <Link to="/impressum" viewTransition>{t('legal.impressum')}</Link>
          <span aria-hidden>·</span>
          <Link to="/datenschutz" viewTransition>{t('legal.privacy')}</Link>
          <span aria-hidden>·</span>
          <Link to="/nutzungsbedingungen" viewTransition>{t('legal.terms')}</Link>
        </nav>
        {t('app.footer')} <span className="shell__version">| {__APP_VERSION__}</span>
      </footer>

      {me && (
        <nav className="nav" aria-label="Hauptnavigation">
          <AnimatePresence>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                viewTransition
                // Stamps data-tab-dir on <html> before react-router calls
                // startViewTransition — the old snapshot must already carry it
                // (it scopes the slide direction AND the title/tools names).
                onClick={() => markTabTransition(location.pathname, item.to)}
                className={({ isActive }) => `nav__item ${isActive ? 'nav__item--active' : ''}`}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span className="nav__pill" layoutId="nav-pill" transition={spring} />}
                    <span className="nav__icon" aria-hidden>
                      <Icon name={item.icon} size={24} />
                    </span>
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </AnimatePresence>
        </nav>
      )}

      {/* CRT power-off overlay: exit = reveal fade onto the landing page */}
      <AnimatePresence>
        {crtPhase !== 'idle' && <CrtOff onDone={() => setCrtPhase('done')} />}
      </AnimatePresence>

      {/* CRT power-on after login: ends fully transparent, no exit fade needed */}
      {crtOn && !reduced && <CrtOn ready={!meLoading && !!me} onDone={() => setCrtOn(false)} />}

      {/* react-router restores scroll on POP, resets on PUSH (history.state keyed). */}
      <ScrollRestoration />
    </div>
  );
}

/** Auth gate for the app routes: logged in → the matched route, else the landing
 * page (public routes /r/:token + legal live OUTSIDE this and render regardless). */
function RequireAuth() {
  const { me, meLoading } = useApp();
  if (meLoading) return null;
  return me ? <Outlet /> : <LandingPage />;
}

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      // Public — available whether or not you're signed in.
      { path: '/r/:token', element: <SharePage /> },
      { path: '/impressum', element: <ImpressumPage /> },
      { path: '/datenschutz', element: <DatenschutzPage /> },
      { path: '/nutzungsbedingungen', element: <TermsPage /> },
      // Email/password auth landings — public (no session yet).
      { path: '/bestaetigen', element: <VerifyEmailPage /> },
      { path: '/passwort-zuruecksetzen', element: <ResetPasswordPage /> },
      // Gated — RequireAuth swaps in the landing page when signed out.
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <GeneratePage /> },
          { path: '/rezept/:id', element: <RecipeDetailPage /> },
          { path: '/favoriten', element: <FavoritesPage /> },
          { path: '/verlauf', element: <HistoryPage /> },
          { path: '/einkauf', element: <ShoppingPage /> },
          { path: '/plan', element: <PlanPage /> },
          { path: '/admin', element: <AdminPage /> },
          { path: '*', element: <GeneratePage /> },
        ],
      },
    ],
  },
]);
