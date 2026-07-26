/** Landing for logged-out users: TRY the magic first (one free generation,
 * hard-capped server-side), then examples + login CTA (open self-service signup). */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Icon, type IconName } from '../components/icons';
import { ConjureStage } from '../components/recipe/ConjureStage';
import { motifForRecipe, RecipeMotif } from '../components/recipe/RecipeMotif';
import { RecipeView, type RecipeViewData } from '../components/recipe/RecipeView';
import { Button, Chip } from '../components/ui';
import { AuthPanel } from '../features/auth/AuthPanel';
import { strings, t } from '../i18n';
import { api } from '../lib/api';
import { tryRecipe } from '../lib/sse';
import type { GalleryItem } from '../lib/types';
import { fmtMin } from '../components/recipe/RecipeView';
import { riseIn, spring, stagger } from '../motion/springs';
import type { GenEvent } from '../state/generation';

const EMPTY: RecipeViewData = { meta: null, zutaten: [], schritte: [], tipps: [] };

const EXAMPLES = [
  {
    href: '/r/47Gob2qNH2un',
    kueche: 'Italienisch',
    mode: 'kochen' as const,
    titel: 'Spaghetti alle Vongole',
    teaser: 'Klassiker aus Neapel: Muscheln, Weißwein, Knoblauch und Petersilie treffen auf perfekt al dente Spaghetti — frisch, salzig, in 25 Minuten fertig.',
    stats: [{ icon: 'clock', text: '30 Min.' }, { icon: 'gauge', text: 'mittel' }] as { icon: IconName; text: string }[],
  },
  {
    href: '/r/_LCP3L_O-LuV',
    kueche: 'Thailändisch',
    mode: 'kochen' as const,
    titel: 'Massaman-Curry mit Rindfleisch',
    teaser: 'Mildscharf und cremig: geröstete Gewürze, zart geschmortes Rind und ein Hauch Tamarinde — die Klassik aus dem Süden Thailands.',
    stats: [{ icon: 'clock', text: '1,5 h' }, { icon: 'gauge', text: 'mittel' }] as { icon: IconName; text: string }[],
  },
  {
    href: '/r/BWyqyP7jL0lI',
    kueche: 'Klassiker',
    mode: 'cocktail' as const,
    titel: 'Gin Sour Royal',
    glas: 'Coupette',
    teaser: 'Feiner Eiweiß-Schaum, spritzige Zitrusnote, ein Hauch Wacholder — frisch, sauer, perfekt austariert.',
    stats: [{ icon: 'cocktail', text: '2 Drinks' }, { icon: 'glass', text: 'Coupette' }] as { icon: IconName; text: string }[],
  },
];

export function LandingPage() {
  const reduced = useReducedMotion();
  const location = useLocation();
  const loginError = new URLSearchParams(location.search).get('login_error');

  const login = () => {
    // Arm the CRT power-ON reveal for after the OAuth round-trip (full page
    // navigation — sessionStorage survives it; Shell reads + clears the flag).
    sessionStorage.setItem('zk-crt-on', '1');
    window.location.href = '/api/v1/auth/login';
  };

  return (
    <div>
      <motion.section
        className="hero"
        style={{ marginTop: 'var(--space-4)' }}
        {...(reduced ? {} : riseIn)}
        transition={spring}
      >
        <div className="hero__content">
          <span className="hero__kueche">{t('app.tagline')}</span>
          <h1 className="hero__title">{t('landing.heroTitle')}</h1>
          <p className="hero__teaser">{t('landing.heroText')}</p>
          <div style={{ marginTop: 'var(--space-5)' }}>
            <AuthPanel onGoogle={login} />
            {import.meta.env.DEV && (
              <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--space-3)' }}>
                <Button
                  variant="text"
                  onClick={() => {
                    sessionStorage.setItem('zk-crt-on', '1');
                    window.location.href = '/api/v1/auth/dev-login';
                  }}
                >
                  <Icon name="tools" size={18} /> {t('auth.devLogin')}
                </Button>
              </div>
            )}
          </div>
          <p className="muted" style={{ marginTop: 'var(--space-3)', font: 'var(--type-label-sm)', maxWidth: '46ch' }}>
            {t('legal.consentHint')}{' '}
            (<a href="/nutzungsbedingungen" style={{ textDecoration: 'underline' }}>{t('legal.terms')}</a>
            {' · '}
            <a href="/datenschutz" style={{ textDecoration: 'underline' }}>{t('legal.privacy')}</a>)
          </p>
          {loginError && (
            <p style={{ marginTop: 'var(--space-4)', color: 'var(--c-error)' }} role="alert">
              {loginError === 'not_allowed' ? t('auth.notAllowed') : t('auth.loginFailed')}
            </p>
          )}
        </div>
      </motion.section>

      <TryWizard onLogin={login} />

      <Discover />

      <section className="section">
        <h2>{t('landing.exampleTitle')}</h2>
        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          {EXAMPLES.map((ex, i) => (
            <motion.a
              key={ex.titel}
              href={ex.href}
              className="card card--outlined recipecard"
              {...(reduced ? {} : riseIn)}
              transition={stagger(i, 0.12)}
              whileTap={reduced ? undefined : { scale: 0.98 }}
            >
              <span className="hero__kueche">{ex.kueche}</span>
              <div className="recipecard__body">
                <div className="recipecard__text">
                  <h3 style={{ margin: 'var(--space-2) 0' }}>{ex.titel}</h3>
                  <p className="muted">{ex.teaser}</p>
                  <div className="hero__stats">
                    {ex.stats.map((s) => (
                      <span key={s.text} className="stat"><Icon name={s.icon} size={15} /> {s.text}</span>
                    ))}
                  </div>
                </div>
                <RecipeMotif
                  motif={motifForRecipe({
                    mode: ex.mode,
                    titel: ex.titel,
                    kueche: ex.kueche,
                    glas: 'glas' in ex ? ex.glas : null,
                  })}
                  seed={ex.titel}
                  className="recipecard__motif"
                />
              </div>
            </motion.a>
          ))}
        </div>
      </section>

      <div style={{ textAlign: 'center', marginTop: 'var(--space-8)' }}>
        <Button big variant="tonal" onClick={login}>
          <Icon name="wand" size={20} /> {t('landing.cta')}
        </Button>
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 'var(--space-4)', font: 'var(--type-label)' }}>
        {strings.auth.loginRequired}
      </p>
    </div>
  );
}

/* ---------- recipe of the day + community gallery ---------- */

function GalleryCard({ item, index, highlight }: { item: GalleryItem; index: number; highlight?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <motion.a
      href={`/r/${item.token}`}
      className={`card ${highlight ? '' : 'card--outlined'} recipecard`}
      style={highlight ? { background: 'var(--c-surface-container)' } : undefined}
      {...(reduced ? {} : riseIn)}
      transition={stagger(index, 0.08)}
      whileTap={reduced ? undefined : { scale: 0.98 }}
    >
      <span className="hero__kueche">
        {highlight ? <><Icon name="star" size={13} /> {t('landing.dailyTitle')} · </> : null}
        {item.mode === 'cocktail' ? <><Icon name="cocktail" size={13} />{' '}</> : null}
        {item.kueche}
      </span>
      <div className="recipecard__body">
        <div className="recipecard__text">
          <h3 style={{ margin: 'var(--space-2) 0' }}>{item.titel}</h3>
          <p className="muted" style={{ font: 'var(--type-body)' }}>{item.teaser}</p>
          <div className="hero__stats">
            {item.zeit_gesamt != null && <span className="stat"><Icon name="clock" size={15} /> {fmtMin(item.zeit_gesamt)}</span>}
            {item.schwierigkeit && <span className="stat"><Icon name="gauge" size={15} /> {item.schwierigkeit}</span>}
          </div>
        </div>
        <RecipeMotif motif={motifForRecipe({ ...item, tags: item.tags })} seed={item.titel} className="recipecard__motif" />
      </div>
    </motion.a>
  );
}

function Discover() {
  const daily = useQuery({ queryKey: ['daily'], queryFn: () => api.daily(), staleTime: 10 * 60_000 });
  const gallery = useQuery({ queryKey: ['discover'], queryFn: () => api.discover(), staleTime: 10 * 60_000 });
  const dailyItem = daily.data?.item ?? null;
  const rest = (gallery.data?.items ?? []).filter((i) => i.token !== dailyItem?.token).slice(0, 8);
  if (!dailyItem && rest.length === 0) return null;
  return (
    <section className="section">
      <h2><Icon name="globe" size={20} /> {t('landing.discoverTitle')}</h2>
      <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
        {dailyItem && <GalleryCard item={dailyItem} index={0} highlight />}
        {rest.map((item, i) => (
          <GalleryCard key={item.token} item={item} index={i + 1} />
        ))}
      </div>
    </section>
  );
}

/* ---------- one free taster generation, streaming inline ---------- */

function TryWizard({ onLogin }: { onLogin: () => void }) {
  const reduced = useReducedMotion();
  const [kueche, setKueche] = useState('Italienisch');
  const [geschmack, setGeschmack] = useState<string[]>([]);
  const [phase, setPhase] = useState<'idle' | 'streaming' | 'done' | 'limit'>('idle');
  const [data, setData] = useState<RecipeViewData>(EMPTY);
  const [lastEvent, setLastEvent] = useState<GenEvent>('start');
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => () => abortRef.current?.(), []);

  const start = () => {
    abortRef.current?.();
    setData(EMPTY);
    setLastEvent('start');
    setPhase('streaming');
    abortRef.current = tryRecipe(
      { modus: 'kochen', kueche, geschmack, personen: 2 },
      {
        onMeta: (meta) => {
          setData((d) => ({ ...d, meta }));
          setLastEvent('meta');
        },
        onZutat: (z) => {
          setData((d) => ({ ...d, zutaten: [...d.zutaten, z] }));
          setLastEvent('zutat');
        },
        onSchritt: (s) => {
          setData((d) => ({ ...d, schritte: [...d.schritte, s] }));
          setLastEvent('schritt');
        },
        onTipp: (tip) => {
          setData((d) => ({ ...d, tipps: [...d.tipps, tip] }));
          setLastEvent('tipp');
        },
        onDone: (recipe) => {
          setData({
            meta: recipe,
            zutaten: recipe.zutaten,
            schritte: recipe.schritte,
            tipps: recipe.tipps,
            naehrwerte: recipe.naehrwerte,
            glas: recipe.glas,
            garnitur: recipe.garnitur,
          });
          setLastEvent('done');
          setPhase('done');
        },
        onError: () => setPhase('limit'),
      },
    );
  };

  return (
    <section className="section">
      <h2><Icon name="sparkles" size={20} /> {t('landing.tryTitle')}</h2>
      <p className="muted" style={{ marginTop: 'var(--space-2)' }}>{t('landing.tryHint')}</p>
      <p className="muted" style={{ marginTop: 'var(--space-2)', font: 'var(--type-label-sm)' }}>
        {t('landing.freeNote')}{' '}
        <a
          href="https://github.com/pepperonas/zauberkoch-pwa"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'underline' }}
        >
          <Icon name="link" size={13} /> {t('landing.sourceLink')}
        </a>
      </p>

      {phase === 'idle' && (
        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          <div className="chips">
            {strings.cuisines.map((c) => (
              <Chip key={c} selected={kueche === c} onToggle={() => setKueche(c)}>
                {c}
              </Chip>
            ))}
          </div>
          <div className="chips">
            {strings.tastes.map((taste) => (
              <Chip
                key={taste}
                selected={geschmack.includes(taste)}
                onToggle={() => setGeschmack((g) => (g.includes(taste) ? g.filter((x) => x !== taste) : [...g, taste]))}
              >
                {taste}
              </Chip>
            ))}
          </div>
          <div>
            <Button big onClick={start}><Icon name="wand" size={20} /> {t('landing.tryButton')}</Button>
          </div>
        </div>
      )}

      {phase === 'limit' && (
        <div className="card card--outlined" style={{ marginTop: 'var(--space-4)' }}>
          <p>{t('landing.tryLimit')}</p>
          <div className="actions">
            <Button onClick={onLogin}>{t('auth.login')}</Button>
          </div>
        </div>
      )}

      {(phase === 'streaming' || phase === 'done') && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <AnimatePresence>
            {phase === 'streaming' && <ConjureStage mode="kochen" data={data} lastEvent={lastEvent} />}
          </AnimatePresence>
          <RecipeView data={data} mode="kochen" streaming={phase === 'streaming'} />
          {phase === 'done' && (
            <motion.div
              className="card card--outlined"
              style={{ marginTop: 'var(--space-5)' }}
              {...(reduced ? {} : riseIn)}
              transition={spring}
            >
              <h3>{t('landing.tryCtaTitle')}</h3>
              <p className="muted" style={{ marginTop: 'var(--space-2)' }}>{t('landing.tryCtaText')}</p>
              <div className="actions">
                <Button big onClick={onLogin}>{t('auth.login')}</Button>
                <Button variant="text" onClick={() => setPhase('idle')}>← {t('stream.newRecipe')}</Button>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </section>
  );
}
