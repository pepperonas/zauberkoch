/** Weekly meal planner: assign recipes to days, push the whole week to the
 * shopping list. Deliberately simple — one week visible, ‹ › to move. */

import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { useLocation, useNavigate, useViewTransitionState } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Icon } from '../components/icons';
import { motifForRecipe, RecipeMotif } from '../components/recipe/RecipeMotif';
import '../components/recipe/recipe.css';
import './plan.css';
import { Button, IconButton } from '../components/ui';
import { Sheet } from '../components/ui/Sheet';
import { useSnackbar } from '../components/ui/Snackbar';
import { useShoppingUndo } from '../state/useShoppingUndo';
import { strings, t } from '../i18n';
import { api } from '../lib/api';
import type { PlanEntry } from '../lib/types';
import { riseIn, spring, stagger } from '../motion/springs';
import { SHARED_MOTIF, SHARED_TITLE } from '../state/viewTransition';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
}

export function PlanPage() {
  const reduced = useReducedMotion();
  const location = useLocation();
  // Suppress the staggered day-card entrance while a route morph involving
  // this page runs — otherwise back-navigation captures cards mid-riseIn
  // (opacity 0) in the VT's new snapshot (same guard as RecipeCard).
  const listTransitioning = useViewTransitionState(location.pathname);
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  const { withUndo } = useShoppingUndo();
  const [start, setStart] = useState<string | undefined>(undefined);
  const [pickerDay, setPickerDay] = useState<string | null>(null);

  const week = useQuery({ queryKey: ['plan', start ?? 'current'], queryFn: () => api.planWeek(start) });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['plan'] });

  const today = new Date().toISOString().slice(0, 10);
  const monday = week.data?.start;
  const hasEntries = (week.data?.days ?? []).some((d) => d.entries.length > 0);

  // A view-transition-name must be unique per snapshot — if the same recipe is
  // planned twice this week, only its FIRST row carries the shared names
  // (deterministic across remounts, so the back-morph pairs with that row).
  const firstEntryForRecipe = new Map<number, number>();
  for (const d of week.data?.days ?? [])
    for (const e of d.entries)
      if (!firstEntryForRecipe.has(e.recipe_id)) firstEntryForRecipe.set(e.recipe_id, e.id);

  const remove = async (entry: PlanEntry) => {
    await api.planRemove(entry.id);
    invalidate();
    show(t('plan.entryRemoved'), {
      actionLabel: t('undo'),
      onAction: async () => {
        const day = week.data?.days.find((d) => d.entries.some((e) => e.id === entry.id));
        if (day) await api.planAdd(day.datum, entry.recipe_id);
        invalidate();
      },
    });
  };

  const weekToShopping = () => {
    if (!monday) return;
    void withUndo(t('plan.weekAdded'), () => api.planToShopping(monday));
  };

  return (
    <div className="page--rows plan">
      <h1 className="page__title"><Icon name="calendar" size={22} /> {t('plan.title')}</h1>

      <div className="row row--between" style={{ marginBottom: 'var(--space-4)' }}>
        <IconButton label="‹" onClick={() => monday && setStart(addDays(monday, -7))}>‹</IconButton>
        <button className="muted" onClick={() => setStart(undefined)} style={{ font: 'var(--type-title)' }}>
          {monday && start === undefined ? t('plan.thisWeek') : monday ? strings.plan.weekOf(fmtDay(monday)) : '…'}
        </button>
        <IconButton label="›" onClick={() => monday && setStart(addDays(monday, 7))}>›</IconButton>
      </div>

      <div className="stack plan__week">
        {(week.data?.days ?? []).map((day, i) => (
          <motion.div
            key={day.datum}
            className={`card card--outlined plan__day ${day.datum === today ? 'plan__today' : ''}`}
            {...(reduced || listTransitioning ? {} : riseIn)}
            transition={stagger(i, 0.04)}
          >
            <div className="row row--between plan__dayhead">
              <span style={{ font: 'var(--type-title)' }}>
                {strings.plan.dayNames[i]}{' '}
                <span className="muted" style={{ font: 'var(--type-label-sm)' }}>{fmtDay(day.datum)}</span>
              </span>
              <IconButton label={t('plan.addRecipe')} onClick={() => setPickerDay(day.datum)}>＋</IconButton>
            </div>
            {day.entries.map((entry) => (
              <PlanEntryRow
                key={entry.id}
                entry={entry}
                canShare={firstEntryForRecipe.get(entry.recipe_id) === entry.id}
                onRemove={() => void remove(entry)}
              />
            ))}
          </motion.div>
        ))}
      </div>

      {hasEntries && (
        <div className="actions" style={{ marginTop: 'var(--space-5)' }}>
          <Button big onClick={weekToShopping}>
            <Icon name="cart" size={20} /> {t('plan.toShopping')}
          </Button>
        </div>
      )}

      <RecipePicker
        day={pickerDay}
        onClose={() => setPickerDay(null)}
        onPicked={() => {
          setPickerDay(null);
          invalidate();
          show(t('plan.entryAdded'));
        }}
      />
    </div>
  );
}

/** One planned recipe: tapping motif/title opens the recipe with the
 * shared-element morph (tile → detail hero); delete stays a separate button.
 *
 * `title` carries the full dish name: in the week grid the label clamps after
 * three lines, and the tooltip is the only way a mouse user reads the rest
 * (screen readers get it from aria-label).
 *
 * ⚠️ Do NOT annotate individual attributes with a `/* … *\/` comment between
 * them. It type-checks, it builds without a warning — and the attribute that
 * follows the comment silently disappears from the output. Cost an E2E failure
 * to find; keep prose up here. */
function PlanEntryRow({ entry, canShare, onRemove }: { entry: PlanEntry; canShare: boolean; onRemove: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Source of the morph while a transition to/from this recipe runs (forward
  // AND back) — gated on canShare so duplicate plan entries never produce
  // duplicate view-transition-names (which would abort the whole transition).
  const isSource = useViewTransitionState(`/rezept/${entry.recipe_id}`) && canShare;

  const queryOpts = { queryKey: ['recipes', entry.recipe_id], queryFn: () => api.recipe(entry.recipe_id) };
  const open = async () => {
    // Detail data must be cached BEFORE navigating: react-router snapshots the
    // destination synchronously, and a hero-less loading state kills the morph.
    await queryClient.ensureQueryData(queryOpts);
    navigate(`/rezept/${entry.recipe_id}`, { viewTransition: true });
  };

  return (
    <div className="row row--between plan-entry">
      <button
        className="row plan-entry__open"
        onPointerDown={() => void queryClient.prefetchQuery(queryOpts)}
        onClick={() => void open()}
        aria-label={`${entry.titel} — ${t('common.openRecipe')}`}
        title={entry.titel}
      >
        <span className="motif-tile">
          <RecipeMotif
            motif={motifForRecipe(entry)}
            seed={entry.titel}
            size={48}
            fit
            style={isSource ? { viewTransitionName: SHARED_MOTIF } : undefined}
          />
        </span>
        <span
          className="plan-entry__title"
          style={{ viewTransitionName: isSource ? SHARED_TITLE : undefined }}
        >
          {entry.titel}
        </span>
      </button>
      <span className="plan-entry__remove">
        <IconButton label={t('common.delete')} onClick={onRemove}><Icon name="close" size={18} /></IconButton>
      </span>
    </div>
  );
}

function RecipePicker({ day, onClose, onPicked }: { day: string | null; onClose: () => void; onPicked: () => void }) {
  const [q, setQ] = useState('');
  const recipes = useQuery({ queryKey: ['recipes', 'plan-picker'], queryFn: () => api.recipes(), enabled: day != null });
  const query = q.trim().toLowerCase();
  const items = (recipes.data?.items ?? []).filter(
    (r) => !query || r.titel.toLowerCase().includes(query) || r.kueche.toLowerCase().includes(query),
  );

  return (
    <Sheet open={day != null} onClose={onClose} label={t('plan.pickerTitle')}>
      <div className="stack">
        <h3>{t('plan.pickerTitle')}</h3>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('plan.pickerSearch')}
          aria-label={t('plan.pickerSearch')}
        />
        {items.length === 0 && <p className="muted">{t('shopping.noRecipes')}</p>}
        {items.map((item) => (
          <motion.button
            key={item.id}
            className="picker-row"
            whileTap={{ scale: 0.98 }}
            transition={spring}
            onClick={() => {
              if (day) void api.planAdd(day, item.id).then(onPicked);
            }}
          >
            <span className="motif-tile">
              <RecipeMotif motif={motifForRecipe(item)} seed={item.titel} size={48} fit />
            </span>
            <span className="picker-row__text">
              <span className="picker-row__title">{item.titel}</span>
              <span className="picker-row__sub">
                {item.mode === 'cocktail' ? <Icon name="cocktail" size={13} /> : null}
                {item.kueche}
              </span>
            </span>
          </motion.button>
        ))}
      </div>
    </Sheet>
  );
}
