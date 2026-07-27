/** Stored recipe detail: full RecipeView + actions (favorite, shopping, share, copy, cook mode). */

import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Icon } from '../components/icons';
import { FeedbackBar } from '../components/recipe/FeedbackBar';
import { RecipeView } from '../components/recipe/RecipeView';

// Heavy, only-when-opened surfaces stay lazy so the eager detail page (needed
// for the shared-element morph) doesn't drag them into the entry chunk.
const CookMode = lazy(() => import('../components/recipe/CookMode').then((m) => ({ default: m.CookMode })));
const ShareDialog = lazy(() => import('../components/recipe/ShareDialog').then((m) => ({ default: m.ShareDialog })));
import { Dialog } from '../components/ui/Dialog';
import { Button } from '../components/ui';
import { Tooltip } from '../components/ui/Tooltip';
import { useSnackbar } from '../components/ui/Snackbar';
import { strings, t } from '../i18n';
import { api } from '../lib/api';
import { recipeToText } from '../lib/units';
import { useShoppingUndo } from '../state/useShoppingUndo';
export function RecipeDetailPage() {
  const { id } = useParams();
  const recipeId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  const { withUndo } = useShoppingUndo();
  const [cookOpen, setCookOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [substTarget, setSubstTarget] = useState<string | null>(null);
  const [notiz, setNotiz] = useState<string | null>(null);
  const [gekocht, setGekocht] = useState<number | null>(null);
  const [portionen, setPortionen] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['recipes', recipeId],
    queryFn: () => api.recipe(recipeId),
    enabled: Number.isFinite(recipeId),
  });

  const favorite = useMutation({
    mutationFn: (on: boolean) => api.favorite(recipeId, on),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteRecipe(recipeId),
    onSuccess: () => {
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.removeQueries({ queryKey: ['recipes', recipeId] });
      show(t('recipe.deleted'));
      // Replace so the browser back button doesn't return to the gone recipe.
      navigate('/verlauf', { replace: true });
    },
  });

  if (detail.isLoading) return <p className="muted page__title">{t('common.loading')}</p>;
  if (!detail.data) return <p className="muted page__title">{t('stream.failed')}</p>;

  const { recipe, mode, is_favorite } = detail.data;
  const isFav = favorite.data?.is_favorite ?? is_favorite;
  const factor = portionen != null && recipe.portionen > 0 ? portionen / recipe.portionen : 1;

  const flash = (msg: string) => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(''), 2200);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(recipeToText(recipe, factor));
    flash(t('recipe.copied'));
  };

  const toShopping = () =>
    withUndo(t('shopping.recipeAdded'), () => api.shoppingFromRecipe(recipeId, portionen ?? undefined));

  const toggleFavorite = () => {
    const next = !isFav;
    favorite.mutate(next);
    if (!next) {
      show(t('recipe.favoriteRemoved'), {
        actionLabel: t('undo'),
        onAction: async () => {
          favorite.mutate(true);
        },
      });
    }
  };

  return (
    <div>
      <div className="stream__toolbar">
        {/* POP → react-router re-applies the recorded view transition (the
            recipe motif/title morph back to the list card). */}
        <Button variant="text" onClick={() => navigate(-1)}>← {t('wizard.back')}</Button>
        <AnimatePresence>
          {feedback && (
            <motion.span
              className="muted"
              role="status"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Icon name="check" size={14} /> {feedback}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <RecipeView
        sharedId={recipeId}
        onSubstitute={(name) => setSubstTarget(name)}
        data={{
          meta: recipe,
          zutaten: recipe.zutaten,
          schritte: recipe.schritte,
          tipps: recipe.tipps,
          naehrwerte: recipe.naehrwerte,
          glas: recipe.glas,
          garnitur: recipe.garnitur,
        }}
        mode={mode}
        onPortionenChange={setPortionen}
        actions={
          <>
            <Tooltip text={t('tips.favorite')}>
              <Button variant={isFav ? 'tonal' : 'outlined'} onClick={toggleFavorite} aria-pressed={isFav}>
                <Icon name={isFav ? 'star' : 'starOff'} size={18} /> {t('recipe.favorite')}
              </Button>
            </Tooltip>
            <Tooltip text={t('tips.shopping')}>
              <Button variant="outlined" onClick={() => void toShopping()}><Icon name="cart" size={18} /> {t('recipe.toShoppingList')}</Button>
            </Tooltip>
            <Tooltip text={t('tips.share')}>
              <Button variant="outlined" onClick={() => setShareOpen(true)}><Icon name="share" size={18} /> {t('recipe.share')}</Button>
            </Tooltip>
            <Tooltip text={t('tips.copy')}>
              <Button variant="outlined" onClick={() => void copy()}><Icon name="copy" size={18} /> {t('recipe.copy')}</Button>
            </Tooltip>
            <Tooltip text={t('tips.print')}>
              {/* No dialog, no PDF library: the browser's own print sheet turns
                  the page into paper or a PDF — the print stylesheet does the
                  work (base.css, @media print). */}
              <Button variant="outlined" onClick={() => window.print()}>
                <Icon name="print" size={18} /> {t('recipe.print')}
              </Button>
            </Tooltip>
            {recipe.schritte.length > 0 && (
              <Tooltip text={t('tips.cook')}>
                <Button onClick={() => setCookOpen(true)}><Icon name="chefhat" size={18} /> {t('recipe.cookMode')}</Button>
              </Tooltip>
            )}
            <Tooltip text={t('tips.adapt')}>
              <Button
                variant="tonal"
                onClick={() => navigate('/', { state: { adaptId: recipeId, openAdapt: true } })}
              >
                <Icon name="sparkles" size={18} /> {t('adapt.button')}
              </Button>
            </Tooltip>
            <Tooltip text={t('tips.cooked')}>
              <Button
                variant="outlined"
                onClick={() => void api.markCooked(recipeId).then((r) => { setGekocht(r.gekocht_count); show(t('notes.cooked')); })}
              >
                <Icon name="checkCircle" size={18} /> {(gekocht ?? detail.data.gekocht_count) > 0
                  ? strings.notes.cookedCount(gekocht ?? detail.data.gekocht_count)
                  : t('notes.cooked')}
              </Button>
            </Tooltip>
          </>
        }
      />

      <section className="section detail__notiz">
        <label className="muted" htmlFor="notiz" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
          <Icon name="note" size={15} /> {t('notes.label')}
        </label>
        <textarea
          id="notiz"
          className="input"
          style={{ minHeight: 88, padding: 'var(--space-3) var(--space-4)', resize: 'vertical' }}
          defaultValue={detail.data.notiz}
          placeholder={t('notes.placeholder')}
          maxLength={2000}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value !== (notiz ?? detail.data.notiz)) {
              setNotiz(value);
              void api.setNotiz(recipeId, value).then(() => show(t('notes.saved')));
            }
          }}
        />
      </section>

      <FeedbackBar recipeId={recipeId} initial={detail.data.feedback ?? null} />

      {/* Destructive action, kept away from the primary action row. */}
      <section className="section detail__danger">
        <Tooltip text={t('tips.delete')}>
          <Button variant="text" className="btn--danger-text" onClick={() => setDeleteOpen(true)}>
            <Icon name="trash" size={18} /> {t('recipe.delete')}
          </Button>
        </Tooltip>
      </section>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} label={t('recipe.deleteTitle')}>
        <div className="stack">
          <h3>{t('recipe.deleteTitle')}</h3>
          <p className="muted">{t('recipe.deleteText')}</p>
          <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="text" onClick={() => setDeleteOpen(false)} disabled={del.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => del.mutate()} disabled={del.isPending}>
              <Icon name="trash" size={18} /> {del.isPending ? t('common.loading') : t('recipe.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>

      <SubstituteDialog recipeId={recipeId} zutat={substTarget} onClose={() => setSubstTarget(null)} />

      <Suspense fallback={null}>
        <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} recipeId={recipeId} titel={recipe.titel} publicListed={detail.data?.public_listed ?? false} />
      </Suspense>
      <AnimatePresence>
        {cookOpen && (
          <Suspense fallback={null}>
            <CookMode schritte={recipe.schritte} mode={mode} onClose={() => setCookOpen(false)} />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  );
}


function SubstituteDialog({ recipeId, zutat, onClose }: { recipeId: number; zutat: string | null; onClose: () => void }) {
  const options = useQuery({
    queryKey: ['substitute', recipeId, zutat],
    queryFn: () => api.substitute(recipeId, zutat as string),
    enabled: zutat != null,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <Dialog open={zutat != null} onClose={onClose} label={zutat ? strings.subst.title(zutat) : ''}>
      <div className="stack">
        <h3>⇄ {zutat ? strings.subst.title(zutat) : ''}</h3>
        {options.isLoading && <p className="muted">{t('subst.loading')}</p>}
        {options.isError && <p className="muted">{t('subst.failed')}</p>}
        {(options.data?.alternativen ?? []).map((alt) => (
          <div key={alt.name}>
            <strong>{alt.name}</strong>
            <p className="muted" style={{ font: 'var(--type-body)' }}>{alt.hinweis}</p>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
