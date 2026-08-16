/** Recipe list card — shared element (layoutId) expands into the detail page.
 * Root is a div (not button): the favorite star is its own nested button. */

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useViewTransitionState } from 'react-router-dom';

import { t } from '../../i18n';
import { api } from '../../lib/api';
import type { RecipeListItem } from '../../lib/types';
import { CARD_MORPH_CAP, clearTabTransition, TAB_DIR_TTL_MS } from '../../lib/tabTransition';
import { riseIn, spring, stagger } from '../../motion/springs';
import { SHARED_MOTIF, SHARED_TITLE } from '../../state/viewTransition';
import { Icon } from '../icons';
import { useSnackbar } from '../ui/Snackbar';
import { motifForRecipe, RecipeMotif } from './RecipeMotif';
import { fmtMin } from './RecipeView';
import './recipe.css';

export function RecipeCard({ item, index = 0 }: { item: RecipeListItem; index?: number }) {
  const reduced = useReducedMotion();
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  const navigate = useNavigate();
  const location = useLocation();
  // This card is the transition source only while ITS recipe is morphing (true
  // during the transition TO or FROM /rezept/<id> — so it pairs with the detail
  // hero for both forward navigation AND browser/in-app back).
  const isSource = useViewTransitionState(`/rezept/${item.id}`);
  // While ANY route morph involving this list is running, skip the staggered
  // entrance: on back-navigation the list re-mounts, and a card mid-`riseIn`
  // (opacity 0 / y-offset) would be captured by the view transition's "new"
  // snapshot at the wrong place — the morph target (and the whole list
  // crossfade) would look empty / hard-cut. useViewTransitionState matches
  // either side, so the list path is "transitioning" during forward + back.
  const listTransitioning = useViewTransitionState(location.pathname);
  const morphing = isSource || listTransitioning;

  // Cross-tab card morph, NEW side. During a tab switch (data-tab-dir is
  // stamped before react-router's synchronous view-transition render, so this
  // read is deterministic) the first cards name themselves `zk-card-<id>` —
  // pairing with the old page's identically named cards makes shared recipes
  // fly to their new position (Favoriten ↔ Verlauf). The name must NOT
  // outlive the transition: a later card→detail morph carrying eight named
  // card layers is the documented mobile perf trap, so an effect strips the
  // inline name once the stamp's lifetime is over.
  const rootRef = useRef<HTMLDivElement>(null);
  const tabMorph =
    index < CARD_MORPH_CAP && document.documentElement.dataset.tabDir != null;
  useEffect(() => {
    if (!tabMorph) return;
    const timer = window.setTimeout(
      () => rootRef.current?.style.removeProperty('view-transition-name'),
      TAB_DIR_TTL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [tabMorph]);

  const queryOpts = { queryKey: ['recipes', item.id], queryFn: () => api.recipe(item.id) };
  // Warm the detail query on press so the navigate below is usually instant.
  const prefetch = () => void queryClient.prefetchQuery(queryOpts);
  // react-router snapshots the destination synchronously inside its view
  // transition, so the detail must render with its hero immediately. The page is
  // warmed (see App.tsx); we only need its query data cached first — otherwise it
  // renders a hero-less loading state and the morph has no target.
  const open = async () => {
    await queryClient.ensureQueryData(queryOpts);
    clearTabTransition(); // a detail morph must never inherit a tab slide
    navigate(`/rezept/${item.id}`, { viewTransition: true });
  };

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['recipes'] });

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !item.is_favorite;
    await api.favorite(item.id, next);
    invalidate();
    if (!next) {
      show(t('recipe.favoriteRemoved'), {
        actionLabel: t('undo'),
        onAction: async () => {
          await api.favorite(item.id, true);
          invalidate();
        },
      });
    }
  };

  return (
    <motion.div
      ref={rootRef}
      className="card card--outlined recipecard"
      data-card-id={item.id}
      style={tabMorph ? { viewTransitionName: `zk-card-${item.id}` } : undefined}
      role="button"
      tabIndex={0}
      onPointerDown={prefetch}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      {...(reduced || morphing ? {} : riseIn)}
      transition={stagger(Math.min(index, 8))}
      whileTap={reduced ? undefined : { scale: 0.98 }}
    >
      <div className="row row--between">
        <span className="hero__kueche">
          {item.mode === 'cocktail' ? <><Icon name="cocktail" size={14} />{' '}</> : null}
          {item.kueche}
        </span>
        <motion.button
          className="recipecard__star"
          aria-label={item.is_favorite ? t('recipe.unfavorite') : t('recipe.favorite')}
          aria-pressed={item.is_favorite}
          onClick={(e) => void toggleFavorite(e)}
          whileTap={reduced ? undefined : { scale: 1.25, rotate: 12 }}
          transition={spring}
        >
          <Icon name={item.is_favorite ? 'star' : 'starOff'} size={22} />
        </motion.button>
      </div>
      <div className="recipecard__body">
        <div className="recipecard__text">
          <h3
            style={{ margin: 'var(--space-2) 0', viewTransitionName: isSource ? SHARED_TITLE : undefined }}
          >
            {item.titel}
          </h3>
          <p className="muted" style={{ font: 'var(--type-body)' }}>{item.teaser}</p>
          <div className="hero__stats">
            {item.zeit_gesamt != null && <span className="stat"><Icon name="clock" size={15} /> {fmtMin(item.zeit_gesamt)}</span>}
            {item.schwierigkeit && <span className="stat"><Icon name="gauge" size={15} /> {item.schwierigkeit}</span>}
          </div>
        </div>
        <RecipeMotif
          motif={motifForRecipe(item)}
          seed={item.titel}
          className="recipecard__motif"
          style={{ viewTransitionName: isSource ? SHARED_MOTIF : undefined }}
        />
      </div>
    </motion.div>
  );
}

export { spring };
