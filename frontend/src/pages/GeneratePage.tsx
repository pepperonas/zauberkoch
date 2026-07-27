/** Home: 3-step wizard (skippable) -> live conjuring stage + streaming recipe.
 * The stream itself lives in the global generation store (state/generation.ts)
 * so it keeps running when the user navigates elsewhere. */

import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { CuisineSheet } from '../components/CuisineSheet';
import { Icon } from '../components/icons';
import { FavoriteButton } from '../components/recipe/FavoriteButton';
import { AdaptSheet } from '../components/recipe/AdaptSheet';
import { ConjureStage, SparkBurst } from '../components/recipe/ConjureStage';
import { CookMode } from '../components/recipe/CookMode';
import { FeedbackBar } from '../components/recipe/FeedbackBar';
import { RecipeView } from '../components/recipe/RecipeView';
import { ShareDialog } from '../components/recipe/ShareDialog';
import { Button, Chip, Segmented, Switch } from '../components/ui';
import { ZutatInput } from '../components/ui/ZutatInput';
import { Tooltip } from '../components/ui/Tooltip';
import { Dialog } from '../components/ui/Dialog';
import { Sheet } from '../components/ui/Sheet';
import { useSnackbar } from '../components/ui/Snackbar';
import { useShoppingUndo } from '../state/useShoppingUndo';
import { strings, t } from '../i18n';
import { downscaleToJpegBase64 } from '../lib/imageScale';
import { cuisineAllowsMeal } from '../lib/mealCompat';
import { api } from '../lib/api';
import type { GenerateParams, Me, Modus, Preferences, Schwierigkeit } from '../lib/types';
import { spring, springSnappy } from '../motion/springs';
import { errorIn, fastSpatial, heroEnter, reducedFade, shuffleWiggle, slowSpatial, staggerIn } from '../motion/tokens';
import { AiBudgetNotice, resetTimeLabel } from '../features/support/AiBudgetNotice';
import { noteSupportAskedElsewhere } from '../state/supportPrompt';
import { useApp } from '../state/app';
import { useLocalStorageState } from '../state/useLocalStorageState';
import {
  cancelGeneration,
  markGenerationSeen,
  regenerateGeneration,
  retryGeneration,
  setGenerationFavorite,
  startAdaptGeneration,
  startRecipeGeneration,
  useGeneration,
} from '../state/generation';
import './wizard.css';

export function GeneratePage() {
  const { mode, setMode, me, refreshMe } = useApp();
  const reduced = useReducedMotion();
  const queryClient = useQueryClient();

  // Wizard state
  const [step, setStep] = useState(0);
  // Slide direction: forward slides in from the right, back from the left —
  // mirrored offsets keep the steps spatially consistent.
  const [stepDir, setStepDir] = useState(1);
  const goStep = (next: number) => {
    setStepDir(next > step ? 1 : -1);
    setStep(next);
  };
  const [kueche, setKueche] = useState('');
  const [kuecheFrei, setKuecheFrei] = useState('');
  const [gerichtTyp, setGerichtTyp] = useState('');
  const [geschmack, setGeschmack] = useState<string[]>([]);
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  // Diet flags live in the persistent profile (single source of truth, merged
  // into every generation server-side). The Feinschliff switches read them and
  // write them back — so they reflect the profile AND persist everywhere.
  const dietPrefs = me?.preferences;
  const diet = {
    vegetarisch: dietPrefs?.vegetarisch ?? false,
    vegan: dietPrefs?.vegan ?? false,
    glutenfrei: dietPrefs?.glutenfrei ?? false,
    laktosefrei: dietPrefs?.laktosefrei ?? false,
    proteinreich: dietPrefs?.proteinreich ?? false,
    ketogen: dietPrefs?.ketogen ?? false,
  };
  // Time/difficulty have no profile home -> remembered per device (localStorage),
  // so they survive reload + navigation.
  const [maxZeitRaw, setMaxZeitRaw] = useLocalStorageState<string>('zk-wiz-maxzeit', () => '');
  const [schwierigkeitRaw, setSchwierigkeitRaw] = useLocalStorageState<string>('zk-wiz-schwierigkeit', () => '');
  const maxZeit = maxZeitRaw ? Number(maxZeitRaw) : null;
  const schwierigkeit = (schwierigkeitRaw || null) as Schwierigkeit | null;
  const setMaxZeit = (v: number | null) => setMaxZeitRaw(v == null ? '' : String(v));
  const setSchwierigkeit = (v: Schwierigkeit | null) => setSchwierigkeitRaw(v ?? '');
  const [personen, setPersonen] = useState(me?.preferences?.standard_personen ?? 2);
  const [fridge, setFridge] = useState<string[]>([]);
  // Pantry staples arrive pre-selected; tapping deselects them for this run.
  const [pantryOff, setPantryOff] = useState<Set<string>>(new Set());
  const pantry = me?.preferences?.vorraete ?? [];
  const pantrySelected = pantry.filter((p) => !pantryOff.has(p));
  const [spirit, setSpirit] = useState('');
  const [alkoholfrei, setAlkoholfrei] = useState(false);
  const [drinkTyp, setDrinkTyp] = useState('');
  const [drinkTypFrei, setDrinkTypFrei] = useState('');

  // Stream state lives in the global store — survives navigation.
  const gen = useGeneration();
  const [burst, setBurst] = useState(false);
  const [reveal, setReveal] = useState(false);
  const heroControls = useAnimationControls();
  const [cookOpen, setCookOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [adultOpen, setAdultOpen] = useState(false);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptTarget, setAdaptTarget] = useState<number | null>(null);
  const [cuisineEditOpen, setCuisineEditOpen] = useState(false);
  const { show } = useSnackbar();
  const { withUndo } = useShoppingUndo();
  const prevPhase = useRef(gen.phase);
  const location = useLocation();
  const navigate = useNavigate();

  // The user is looking at the result -> pill elsewhere can stand down.
  useEffect(() => {
    if (gen.phase === 'done' || gen.phase === 'limit') markGenerationSeen();
  }, [gen.phase]);

  // Meal-type × cuisine sanity (kochen): the effective cuisine (chip OR
  // free-text) and the meal type gate each other's chips. Chip-vs-chip
  // conflicts can't be created (the bad chip is disabled); the only open path
  // is typing a conflicting free-text after picking a meal type -> drop it.
  const effCuisine = kuecheFrei.trim() || kueche;
  useEffect(() => {
    if (gerichtTyp && effCuisine && !cuisineAllowsMeal(effCuisine, gerichtTyp)) setGerichtTyp('');
  }, [effCuisine, gerichtTyp]);

  // Hero moment: the emotional peak when a live run lands while we're watching.
  // Spark burst + one-shot card settle-pop + reveal glow sweep + haptics.
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = gen.phase;
    if (prev === 'streaming' && gen.phase === 'done' && !gen.error) {
      if (reduced) return;
      setBurst(true);
      setReveal(true);
      void heroControls.start({ scale: [1, 1.025, 1] }, slowSpatial);
      // feature-detected haptic tick (mobile) — gated on reduced-motion too
      navigator.vibrate?.([10, 40, 16]);
      const b = window.setTimeout(() => setBurst(false), 1100);
      const r = window.setTimeout(() => setReveal(false), 1300);
      return () => {
        window.clearTimeout(b);
        window.clearTimeout(r);
      };
    }
  }, [gen.phase, gen.error, reduced, heroControls]);

  const buildParams = useCallback(
    (overrides: Partial<GenerateParams> = {}): GenerateParams => ({
      modus: mode,
      kueche: mode === 'cocktail' ? '' : kueche,
      kueche_freitext: mode === 'cocktail' ? '' : kuecheFrei,
      gericht_typ: mode === 'cocktail' ? '' : gerichtTyp,
      drink_typ: mode === 'cocktail' ? (drinkTypFrei.trim() || drinkTyp) : '',
      geschmack,
      vegetarisch: diet.vegetarisch,
      vegan: diet.vegan,
      glutenfrei: diet.glutenfrei,
      laktosefrei: diet.laktosefrei,
      proteinreich: diet.proteinreich,
      ketogen: diet.ketogen,
      max_zeit_min: maxZeit,
      schwierigkeit,
      personen,
      vorhandene_zutaten: [...pantrySelected, ...fridge],
      basis_spirituose: spirit,
      alkoholfrei,
      ...overrides,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, kueche, kuecheFrei, gerichtTyp, drinkTyp, drinkTypFrei, geschmack, maxZeit, schwierigkeit, personen, fridge, spirit, alkoholfrei, pantryOff, me],
  );

  const invalidateRecipes = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['recipes'] }),
    [queryClient],
  );

  // Persist a diet-flag change to the profile (optimistic cache update + PUT).
  const savePrefs = useCallback(
    (patch: Partial<Preferences>) => {
      const base = me?.preferences;
      if (!base) return;
      const next: Preferences = { ...base, ...patch };
      queryClient.setQueryData<Me | null>(['me'], (old) => (old ? { ...old, preferences: next } : old));
      void api.putPreferences(next).catch(() => refreshMe());
    },
    [me, queryClient, refreshMe],
  );

  const generate = (overrides: Partial<GenerateParams> = {}) => {
    startRecipeGeneration(buildParams(overrides), invalidateRecipes);
  };

  const runAdapt = useCallback(
    (id: number, anweisung: string) => startAdaptGeneration(id, anweisung, mode, invalidateRecipes),
    [mode, invalidateRecipes],
  );

  // Adapt requests handed over from the detail page via router state
  useEffect(() => {
    const state = location.state as { adaptId?: number; openAdapt?: boolean } | null;
    if (state?.adaptId && state.openAdapt) {
      navigate('.', { replace: true, state: null });
      setAdaptTarget(state.adaptId);
      setAdaptOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModeChange = (next: Modus) => {
    if (next === 'cocktail' && me && !me.adult_confirmed) {
      setAdultOpen(true);
      return;
    }
    if (next !== mode) setGeschmack([]);
    setMode(next);
  };

  const confirmAdult = async () => {
    await api.confirmAdult();
    refreshMe();
    setAdultOpen(false);
    setMode('cocktail');
  };

  const toggleFavorite = async () => {
    const recipeId = gen.recipeId;
    if (recipeId == null) return;
    const next = !gen.isFavorite;
    setGenerationFavorite(next);
    await api.favorite(recipeId, next);
    invalidateRecipes();
    if (!next) {
      show(t('recipe.favoriteRemoved'), {
        actionLabel: t('undo'),
        onAction: async () => {
          setGenerationFavorite(true);
          await api.favorite(recipeId, true);
          invalidateRecipes();
        },
      });
    }
  };

  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const onScanFile = async (file: File | undefined) => {
    if (!file) return;
    setScanning(true);
    try {
      const image = await downscaleToJpegBase64(file);
      const res = await api.fridgeScan(image);
      const fresh = res.zutaten.filter((z) => !fridge.some((f) => f.toLowerCase() === z.toLowerCase()));
      if (fresh.length > 0) {
        setFridge((prev) => [...prev, ...fresh].slice(0, 30));
        show(strings.wizard.fridgeScanFound(fresh.length));
      } else {
        show(t('wizard.fridgeScanNothing'));
      }
    } catch {
      show(t('wizard.fridgeScanFailed'));
    } finally {
      setScanning(false);
      if (scanInputRef.current) scanInputRef.current.value = '';
    }
  };

  /* ---------- render: streaming / result ---------- */
  if (gen.phase === 'streaming' || gen.phase === 'done') {
    const { data, recipeId, error } = gen;
    return (
      <div>
        <div className="stream__toolbar">
          {gen.phase === 'streaming' ? (
            <Button variant="text" onClick={cancelGeneration}><Icon name="close" size={18} /> {t('common.cancel')}</Button>
          ) : (
            <Button variant="text" onClick={cancelGeneration}>← {t('stream.newRecipe')}</Button>
          )}
          {gen.unlimited ? (
            <span className="muted">
              <Icon name="key" size={14} /> {t('stream.unlimitedToday')}
            </span>
          ) : (
            gen.remaining != null && (
              <span className="muted">{strings.stream.remainingToday(gen.remaining)}</span>
            )
          )}
        </div>

        {error && gen.phase === 'done' && (
          <motion.div
            className="card card--outlined"
            style={{ marginBottom: 'var(--space-4)' }}
            initial={reduced ? { opacity: 0 } : errorIn.initial}
            animate={reduced ? { opacity: 1 } : errorIn.animate}
            transition={reduced ? reducedFade : fastSpatial}
          >
            <p>{t('stream.failed')}</p>
            <div className="actions">
              <Button onClick={retryGeneration}>{t('common.retry')}</Button>
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {gen.phase === 'streaming' && (
            <ConjureStage mode={gen.mode} data={data} lastEvent={gen.lastEvent} />
          )}
        </AnimatePresence>

        {burst && <SparkBurst />}

        <motion.div animate={heroControls} style={{ transformOrigin: 'top center', position: 'relative' }}>
          {reveal && !reduced && (
            <div className="hero-reveal-clip" aria-hidden>
              <motion.div
                className="hero-reveal"
                initial={{ x: '-110%', opacity: 0 }}
                animate={{ x: '120%', opacity: [0, 0.85, 0] }}
                transition={slowSpatial}
              />
            </div>
          )}
          <RecipeView
            data={data}
            mode={gen.mode}
            streaming={gen.phase === 'streaming'}
            actions={
              gen.phase === 'done' && !error
                ? [
                    <Tooltip key="fav" text={t('tips.favorite')}>
                      <FavoriteButton active={gen.isFavorite} onToggle={() => void toggleFavorite()} label={t('recipe.favorite')} />
                    </Tooltip>,
                    recipeId != null && (
                      <Tooltip key="shop" text={t('tips.shopping')}>
                        <Button
                          variant="outlined"
                          onClick={() => void withUndo(t('shopping.recipeAdded'), () => api.shoppingFromRecipe(recipeId))}
                        >
                          <Icon name="cart" size={18} /> {t('recipe.toShoppingList')}
                        </Button>
                      </Tooltip>
                    ),
                    recipeId != null && (
                      <Tooltip key="share" text={t('tips.share')}>
                        <Button variant="outlined" onClick={() => setShareOpen(true)}>
                          <Icon name="share" size={18} /> {t('recipe.share')}
                        </Button>
                      </Tooltip>
                    ),
                    data.schritte.length > 0 && (
                      <Tooltip key="cook" text={t('tips.cook')}>
                        <Button onClick={() => setCookOpen(true)}>
                          <Icon name="chefhat" size={18} /> {t('recipe.cookMode')}
                        </Button>
                      </Tooltip>
                    ),
                    recipeId != null && (
                      <Tooltip key="adapt" text={t('tips.adapt')}>
                        <Button
                          variant="tonal"
                          onClick={() => {
                            setAdaptTarget(recipeId);
                            setAdaptOpen(true);
                          }}
                        >
                          <Icon name="sparkles" size={18} /> {t('adapt.button')}
                        </Button>
                      </Tooltip>
                    ),
                    gen.canRegenerate && (
                      <Tooltip key="regen" text={t('tips.regenerate')}>
                        <Button variant="text" onClick={regenerateGeneration}>
                          <Icon name="dice" size={18} /> {t('stream.regenerate')}
                        </Button>
                      </Tooltip>
                    ),
                  ]
                    .filter((el): el is React.ReactElement => Boolean(el))
                    .map((el, i) => (
                      <motion.div
                        key={el.key ?? i}
                        className="actions__item"
                        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={reduced ? { duration: 0.12 } : staggerIn(i, 0.05)}
                      >
                        {el}
                      </motion.div>
                    ))
                : null
            }
          />
        </motion.div>

        {gen.phase === 'done' && recipeId != null && !error && <FeedbackBar recipeId={recipeId} />}

        <AdaptSheet
          open={adaptOpen}
          onClose={() => setAdaptOpen(false)}
          onAdapt={(anweisung) => {
            const target = adaptTarget ?? recipeId;
            if (target != null) runAdapt(target, anweisung);
          }}
        />

        {recipeId != null && data.meta && (
          <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} recipeId={recipeId} titel={data.meta.titel} />
        )}
        <AnimatePresence>
          {cookOpen && <CookMode schritte={data.schritte} mode={gen.mode} onClose={() => setCookOpen(false)} />}
        </AnimatePresence>
      </div>
    );
  }

  /* ---------- render: daily limit ---------- */
  if (gen.phase === 'limit') {
    // The PROJECT budget being spent is a different story than the user's own
    // daily allowance: only the former warrants explaining the funding model
    // and asking for support (asking after a personal cap would be pushy).
    const code = gen.error?.code ?? '';
    if (code === 'daily_limit_global' || code === 'daily_limit_anon') {
      return (
        <>
          <AiBudgetNotice retryAfter={gen.error?.retry_after} onRetry={cancelGeneration} />
          <BudgetSeen />
        </>
      );
    }
    return (
      <div className="limitbox">
        <motion.div
          className="limitbox__emoji"
          aria-hidden
          initial={reduced ? { opacity: 0 } : heroEnter.initial}
          animate={reduced ? { opacity: 1 } : heroEnter.animate}
          transition={reduced ? reducedFade : slowSpatial}
        >
          <Icon name="snooze" size={52} />
        </motion.div>
        <h2>{t('stream.limitReached')}</h2>
        <p className="muted" style={{ marginTop: 'var(--space-3)' }}>{gen.error?.message}</p>
        {resetTimeLabel(gen.error?.retry_after) && (
          <p className="muted" style={{ marginTop: 'var(--space-2)', font: 'var(--type-label-sm)' }}>
            {t('budget.backAvailable').replace('{time}', resetTimeLabel(gen.error?.retry_after))}
          </p>
        )}
        <div style={{ marginTop: 'var(--space-6)' }}>
          <Button variant="tonal" onClick={cancelGeneration}>← {t('wizard.back')}</Button>
        </div>
      </div>
    );
  }

  /* ---------- render: wizard ---------- */
  const steps = [mode === 'cocktail' ? t('wizard.stepDrinkType') : t('wizard.stepCuisine'), t('wizard.stepTaste'), t('wizard.stepDetails')];

  return (
    <div>
      <div className="wiz__mode">
        <Segmented<Modus>
          options={[
            { value: 'kochen', label: <><Icon name="pan" size={17} /> {t('wizard.modeKochen')}</> },
            { value: 'cocktail', label: <><Icon name="cocktail" size={17} /> {t('wizard.modeCocktail')}</> },
          ]}
          value={mode}
          onChange={handleModeChange}
        />
      </div>

      <div className="wiz__progress" aria-hidden>
        {steps.map((_, i) => (
          <div key={i} className="wiz__bar">
            <motion.div
              className="wiz__bar-fill"
              initial={false}
              animate={{ scaleX: i <= step ? 1 : 0 }}
              style={{ transformOrigin: 'left' }}
              transition={spring}
            />
          </div>
        ))}
      </div>

      {/* custom carries the direction through AnimatePresence so the EXITING
          step also slides the right way (its own props are stale by then).
          reduced → dir 0 = flat fade. */}
      <AnimatePresence mode="wait" custom={reduced ? 0 : stepDir}>
        <motion.div
          key={step}
          custom={reduced ? 0 : stepDir}
          variants={{
            enter: (d: number) => ({ opacity: 0, x: 40 * d }),
            center: { opacity: 1, x: 0 },
            exit: (d: number) => ({ opacity: 0, x: -40 * d }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={springSnappy}
        >
          {step === 0 && mode === 'cocktail' && (
            <section>
              <h2 className="wiz__step-title">{t('wizard.drinkTypeTitle')}</h2>
              <div className="chips">
                {strings.drinkTypes.map((d) => (
                  <Chip key={d} selected={drinkTyp === d} onToggle={() => setDrinkTyp(drinkTyp === d ? '' : d)}>
                    {d}
                  </Chip>
                ))}
              </div>
              <div className="wiz__free">
                <label htmlFor="drink-frei">{t('wizard.drinkFreeLabel')}</label>
                <input
                  id="drink-frei"
                  className="input"
                  value={drinkTypFrei}
                  onChange={(e) => setDrinkTypFrei(e.target.value)}
                  placeholder={t('wizard.drinkFreePlaceholder')}
                  maxLength={64}
                />
              </div>
            </section>
          )}

          {step === 0 && mode !== 'cocktail' && (
            <section>
              <span className="wiz__row-label">{t('wizard.gerichtTypLabel')}</span>
              <div className="chips" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
                {strings.gerichtTypen.map((g) => {
                  const blocked = !!effCuisine && !cuisineAllowsMeal(effCuisine, g);
                  return (
                    <Chip
                      key={g}
                      selected={gerichtTyp === g}
                      disabled={blocked}
                      title={blocked ? strings.wizard.gerichtTypBlocked(effCuisine) : undefined}
                      onToggle={() => setGerichtTyp(gerichtTyp === g ? '' : g)}
                    >
                      {g}
                    </Chip>
                  );
                })}
              </div>
              <h2 className="wiz__step-title">{t('wizard.cuisineTitle')}</h2>
              <div className="chips">
                {(me?.preferences?.kuechen?.length ? me.preferences.kuechen : strings.cuisines).map((c) => {
                  const blocked = !!gerichtTyp && !cuisineAllowsMeal(c, gerichtTyp);
                  return (
                    <Chip
                      key={c}
                      selected={kueche === c}
                      disabled={blocked}
                      title={blocked ? strings.wizard.cuisineBlocked(gerichtTyp) : undefined}
                      onToggle={() => setKueche(kueche === c ? '' : c)}
                    >
                      {c}
                    </Chip>
                  );
                })}
                <Tooltip text={t('tips.cuisineEdit')}>
                  <Chip selected={false} onToggle={() => setCuisineEditOpen(true)}>
                    <Icon name="edit" size={13} /> {t('wizard.cuisineEdit')}
                  </Chip>
                </Tooltip>
              </div>
              <div className="wiz__free">
                <label htmlFor="kueche-frei">{t('wizard.cuisineFreeLabel')}</label>
                <input
                  id="kueche-frei"
                  className="input"
                  value={kuecheFrei}
                  onChange={(e) => setKuecheFrei(e.target.value)}
                  placeholder={t('wizard.cuisineFreePlaceholder')}
                  maxLength={120}
                />
              </div>
            </section>
          )}

          {step === 1 && (
            <section>
              <h2 className="wiz__step-title">{t('wizard.tasteTitle')}</h2>
              <div className="chips">
                {(mode === 'cocktail' ? strings.tastesCocktail : strings.tastes).map((taste) => (
                  <Chip
                    key={taste}
                    selected={geschmack.includes(taste)}
                    onToggle={() =>
                      setGeschmack((g) => (g.includes(taste) ? g.filter((x) => x !== taste) : [...g, taste]))
                    }
                  >
                    {taste}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="stack">
              <h2 className="wiz__step-title">{t('wizard.detailsTitle')}</h2>

              <div className="wiz__row">
                <span className="wiz__row-label">
                  {mode === 'cocktail' ? t('wizard.drinks') : t('wizard.servings')}
                </span>
                <div className="stepper">
                  <button className="stepper__btn" onClick={() => setPersonen(Math.max(1, personen - 1))} aria-label="−">−</button>
                  <span className="stepper__value" style={{ height: 'auto' }}>{personen}</span>
                  <button className="stepper__btn" onClick={() => setPersonen(Math.min(12, personen + 1))} aria-label="+">+</button>
                </div>
              </div>

              {mode === 'cocktail' ? (
                <>
                  <div className="wiz__row">
                    <span className="wiz__row-label">{t('wizard.alcoholFree')}</span>
                    <Switch checked={alkoholfrei} onChange={setAlkoholfrei} label={t('wizard.alcoholFree')} />
                  </div>
                  {!alkoholfrei && (
                    <div>
                      <span className="wiz__row-label">{t('wizard.baseSpirit')}</span>
                      <div className="chips" style={{ marginTop: 'var(--space-2)' }}>
                        {strings.spirits.map((s) => (
                          <Chip key={s} selected={spirit === s} onToggle={() => setSpirit(spirit === s ? '' : s)}>
                            {s}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Tooltip text={t('tips.constraints')}>
                    <Button variant="tonal" onClick={() => setConstraintsOpen(true)}>
                      <Icon name="settings" size={18} /> {t('wizard.constraints')}
                    </Button>
                  </Tooltip>
                  <div>
                    <span className="wiz__row-label">{t('wizard.fridgeTitle')}</span>
                    {pantry.length > 0 && (
                      <div className="wiz__fridge-list">
                        {pantry.map((item) => (
                          <Chip
                            key={item}
                            selected={!pantryOff.has(item)}
                            onToggle={() =>
                              setPantryOff((prev) => {
                                const next = new Set(prev);
                                if (next.has(item)) next.delete(item);
                                else next.add(item);
                                return next;
                              })
                            }
                          >
                            {item}
                          </Chip>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <ZutatInput
                        items={fridge}
                        onChange={setFridge}
                        placeholder={t('wizard.fridgePlaceholder')}
                        label={t('wizard.fridgeTitle')}
                        max={30}
                      />
                    </div>
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <Tooltip text={t('tips.fridgeScan')}>
                        <Button variant="outlined" onClick={() => scanInputRef.current?.click()} disabled={scanning}>
                          <Icon name="camera" size={18} /> {scanning ? t('wizard.fridgeScanning') : t('wizard.fridgeScan')}
                        </Button>
                      </Tooltip>
                      <input
                        ref={scanInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        hidden
                        onChange={(e) => void onScanFile(e.target.files?.[0])}
                      />
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="wiz__nav">
        {step > 0 ? (
          <Button variant="text" onClick={() => goStep(step - 1)}>← {t('wizard.back')}</Button>
        ) : (
          <span />
        )}
        {step < 2 ? (
          <Button onClick={() => goStep(step + 1)}>{t('wizard.next')} →</Button>
        ) : (
          <Tooltip text={t('tips.generate')}>
            <Button big onClick={() => generate()}><Icon name="wand" size={20} /> {t('wizard.generate')}</Button>
          </Tooltip>
        )}
      </div>

      <div className="wiz__surprise">
        <Tooltip text={t('tips.surprise')}>
          <Button variant="outlined" onClick={() => generate({ ueberrasch_mich: true, kueche: '', kueche_freitext: '', gericht_typ: '', drink_typ: '' })}>
            {/* Playful shuffle: full wiggle on hover, quick tilt while pressed
                (the click swaps to the conjure stage instantly, so a post-click
                animation would never be seen). */}
            <motion.span
              style={{ display: 'inline-flex' }}
              whileHover={reduced ? undefined : shuffleWiggle}
              whileTap={reduced ? undefined : { rotate: 12, scale: 1.18 }}
              transition={fastSpatial}
            >
              <Icon name="gift" size={18} />
            </motion.span>{' '}
            {t('wizard.surpriseMe')}
          </Button>
        </Tooltip>
      </div>

      {/* Constraints bottom sheet */}
      <Sheet open={constraintsOpen} onClose={() => setConstraintsOpen(false)} label={t('wizard.constraints')}>
        <div className="stack">
          <h3>{t('wizard.constraints')}</h3>
          <p className="muted" style={{ font: 'var(--type-label-sm)', marginTop: 'calc(-1 * var(--space-2))' }}>
            {t('wizard.dietPersistHint')}
          </p>
          <div className="wiz__row">
            <span className="wiz__row-label">{t('wizard.vegetarian')}</span>
            <Switch checked={diet.vegetarisch} onChange={(v) => savePrefs({ vegetarisch: v })} label={t('wizard.vegetarian')} />
          </div>
          <div className="wiz__row">
            <span className="wiz__row-label">{t('wizard.vegan')}</span>
            <Switch checked={diet.vegan} onChange={(v) => savePrefs({ vegan: v, ...(v ? { vegetarisch: true } : {}) })} label={t('wizard.vegan')} />
          </div>
          <div className="wiz__row">
            <span className="wiz__row-label">{t('wizard.glutenFree')}</span>
            <Switch checked={diet.glutenfrei} onChange={(v) => savePrefs({ glutenfrei: v })} label={t('wizard.glutenFree')} />
          </div>
          <div className="wiz__row">
            <span className="wiz__row-label">{t('wizard.lactoseFree')}</span>
            <Switch checked={diet.laktosefrei} onChange={(v) => savePrefs({ laktosefrei: v })} label={t('wizard.lactoseFree')} />
          </div>
          <div className="wiz__row">
            <span className="wiz__row-label">{t('wizard.highProtein')}</span>
            <Switch checked={diet.proteinreich} onChange={(v) => savePrefs({ proteinreich: v })} label={t('wizard.highProtein')} />
          </div>
          <div className="wiz__row">
            <span className="wiz__row-label">{t('wizard.keto')}</span>
            <Switch checked={diet.ketogen} onChange={(v) => savePrefs({ ketogen: v })} label={t('wizard.keto')} />
          </div>
          <div>
            <span className="wiz__row-label">{t('wizard.maxTime')}</span>
            <div className="chips" style={{ marginTop: 'var(--space-2)' }}>
              {[15, 30, 45, 60, 90].map((min) => (
                <Chip key={min} selected={maxZeit === min} onToggle={() => setMaxZeit(maxZeit === min ? null : min)}>
                  {min} {t('wizard.minutes')}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <span className="wiz__row-label">{t('wizard.difficulty')}</span>
            <div className="chips" style={{ marginTop: 'var(--space-2)' }}>
              {([['einfach', t('wizard.easy')], ['mittel', t('wizard.medium')], ['anspruchsvoll', t('wizard.hard')]] as const).map(
                ([value, label]) => (
                  <Chip
                    key={value}
                    selected={schwierigkeit === value}
                    onToggle={() => setSchwierigkeit(schwierigkeit === value ? null : value)}
                  >
                    {label}
                  </Chip>
                ),
              )}
            </div>
          </div>
          <Button onClick={() => setConstraintsOpen(false)}>{t('common.save')}</Button>
        </div>
      </Sheet>

      {/* Cuisine chip editor */}
      <CuisineSheet
        open={cuisineEditOpen}
        onClose={() => setCuisineEditOpen(false)}
        onSaved={(list) => {
          if (kueche && !list.some((k) => k.toLowerCase() === kueche.toLowerCase())) setKueche('');
        }}
      />

      {/* Adapt handed over from the detail page (wizard phase) */}
      <AdaptSheet
        open={adaptOpen}
        onClose={() => setAdaptOpen(false)}
        onAdapt={(anweisung) => {
          const target = adaptTarget ?? gen.recipeId;
          if (target != null) runAdapt(target, anweisung);
        }}
      />

      {/* 18+ dialog */}
      <Dialog open={adultOpen} onClose={() => setAdultOpen(false)} label={t('adult.title')}>
        <div className="stack">
          <h3>{t('adult.title')}</h3>
          <p className="muted">{t('adult.text')}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="text" onClick={() => setAdultOpen(false)}>{t('adult.cancel')}</Button>
            <Button onClick={() => void confirmAdult()}>{t('adult.confirm')}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** Marks the generic support prompt as "asked" while the budget notice (which
 * already contains a donation ask) is on screen — prevents a double ask. */
function BudgetSeen() {
  useEffect(() => {
    noteSupportAskedElsewhere();
  }, []);
  return null;
}
