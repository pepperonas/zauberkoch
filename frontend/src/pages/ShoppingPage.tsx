/** Shopping list: check with elastic animation, drag reorder, export/share.
 * Two views: the aggregated check-off list, and a per-recipe planning view
 * (expand a dish -> read its ingredients -> add them to the list). */

import { AnimatePresence, motion, useReducedMotion, Reorder, useDragControls } from 'motion/react';
import { Fragment, useEffect, useState } from 'react';
import { useLocation, useNavigate, useViewTransitionState } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Icon } from '../components/icons';
import { motifForRecipe, RecipeMotif } from '../components/recipe/RecipeMotif';
import { Button, IconButton, Segmented } from '../components/ui';
import { StateNote } from '../components/ui/StateNote';
import { t } from '../i18n';
import { api } from '../lib/api';
import { formatZutatMenge } from '../lib/units';
import type { RecipeListItem, ShoppingItem } from '../lib/types';
import { clearTabTransition } from '../lib/tabTransition';
import { riseIn, spring, springBouncy, stagger } from '../motion/springs';
import { useLocalStorageState } from '../state/useLocalStorageState';
import { SHARED_MOTIF, SHARED_TITLE } from '../state/viewTransition';
import { useShoppingUndo } from '../state/useShoppingUndo';

function itemLabel(item: ShoppingItem): string {
  const menge = item.menge != null ? `${new Intl.NumberFormat('de-DE').format(item.menge)} ${item.einheit}`.trim() : '';
  return menge ? `${menge} ${item.name}` : item.name;
}

/** One shopping row. Drag is bound to the ⋮⋮ HANDLE only (dragListener=false +
 * dragControls) so the row body scrolls normally on touch — otherwise the whole
 * draggable item swallowed vertical scroll on mobile. */
function ShoppingRow({
  item, reduced, onCheck, onDelete, onReorderEnd,
}: {
  item: ShoppingItem;
  reduced: boolean;
  onCheck: (checked: boolean) => void;
  onDelete: () => void;
  onReorderEnd: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      as="div"
      dragListener={false}
      dragControls={controls}
      onDragEnd={onReorderEnd}
      transition={spring}
      exit={reduced ? undefined : { opacity: 0, x: -40 }}
      whileDrag={{ scale: 1.03, boxShadow: 'var(--elev-2)' }}
      // pan-y keeps vertical scrolling on the row; only the handle grabs the drag.
      style={{ borderRadius: 'var(--shape-md)', background: 'var(--c-surface)', touchAction: 'pan-y' }}
    >
      <div className={`zutat ${item.checked ? 'zutat--checked' : ''}`}>
        <motion.button
          className="zutat__check"
          aria-pressed={item.checked}
          aria-label={itemLabel(item)}
          onClick={() => onCheck(!item.checked)}
          whileTap={reduced ? undefined : { scale: 0.8 }}
          transition={springBouncy}
          style={item.checked ? { background: 'var(--c-primary)', borderColor: 'var(--c-primary)' } : undefined}
        >
          {item.checked && (
            <motion.svg width="16" height="16" viewBox="0 0 16 16">
              <motion.path
                d="M3 8.5 L6.5 12 L13 4.5"
                stroke="var(--c-on-primary)"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
                initial={reduced ? undefined : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              />
            </motion.svg>
          )}
        </motion.button>
        <span className="zutat__label">
          {item.menge != null && (
            <span className="zutat__menge">
              {new Intl.NumberFormat('de-DE').format(item.menge)} {item.einheit}
            </span>
          )}
          {item.name}
          {item.checked && !reduced && (
            <motion.span
              className="zutat__strike"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={spring}
            />
          )}
        </span>
        <IconButton label={t('common.delete')} onClick={onDelete}>
          <Icon name="close" size={18} />
        </IconButton>
        <span
          className="zutat__drag"
          aria-label={t('shopping.dragHandle')}
          role="button"
          tabIndex={-1}
          onPointerDown={(e) => controls.start(e)}
        >
          ⋮⋮
        </span>
      </div>
    </Reorder.Item>
  );
}

type View = 'liste' | 'gerichte';

export function ShoppingPage() {
  const reduced = useReducedMotion();
  const queryClient = useQueryClient();
  const [view, setView] = useLocalStorageState<View>('zk-shopping-view', () => 'liste');
  const [input, setInput] = useState('');
  const [order, setOrder] = useState<ShoppingItem[]>([]);

  const list = useQuery({ queryKey: ['shopping'], queryFn: () => api.shopping() });

  useEffect(() => {
    if (list.data) setOrder(list.data.items);
  }, [list.data]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['shopping'] });

  const { withUndo } = useShoppingUndo();

  const check = useMutation({
    mutationFn: ({ id, checked }: { id: number; checked: boolean }) => api.shoppingCheck(id, checked),
    onSuccess: invalidate,
  });
  const add = useMutation({ mutationFn: (name: string) => api.shoppingAdd(name), onSuccess: invalidate });
  const reorder = useMutation({ mutationFn: (ids: number[]) => api.shoppingReorder(ids) });

  const deleteItem = (item: ShoppingItem) => void withUndo(t('shopping.itemDeleted'), () => api.shoppingDelete(item.id));
  const clearChecked = () => void withUndo(t('shopping.checkedCleared'), () => api.shoppingClearChecked());
  const clearAll = () => void withUndo(t('shopping.listCleared'), () => api.shoppingClearAll());

  const submit = () => {
    const name = input.trim();
    if (name) add.mutate(name);
    setInput('');
  };

  const onReorderEnd = () => reorder.mutate(order.map((i) => i.id));

  const exportList = async () => {
    const text = `${t('shopping.exportTitle')}:\n${order.filter((i) => !i.checked).map((i) => `- ${itemLabel(i)}`).join('\n')}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: t('shopping.exportTitle'), text });
      } catch {
        /* cancelled */
      }
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  const anyChecked = order.some((i) => i.checked);

  if (view === 'gerichte') {
    return (
      <div className="page--rows">
        <h1 className="page__title">{t('shopping.title')}</h1>
        <div className="stack">
          <Segmented<View>
            className="page-tools"
            options={[
              { value: 'liste', label: <><Icon name="cart" size={15} /> {t('shopping.viewList')}</> },
              { value: 'gerichte', label: <><Icon name="plate" size={15} /> {t('shopping.viewByRecipe')}</> },
            ]}
            value={view}
            onChange={setView}
          />
          <ByRecipeView />
        </div>
      </div>
    );
  }

  return (
    <div className="page--rows">
      <h1 className="page__title">{t('shopping.title')}</h1>
      <div className="stack">
        <Segmented<View>
            className="page-tools"
          options={[
            { value: 'liste', label: t('shopping.viewList') },
            { value: 'gerichte', label: t('shopping.viewByRecipe') },
          ]}
          value={view}
          onChange={setView}
        />
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('shopping.addPlaceholder')}
          aria-label={t('shopping.addPlaceholder')}
        />

        {list.isLoading ? (
          <StateNote>{t('common.loading')}</StateNote>
        ) : order.length === 0 ? (
          <StateNote icon="cart">{t('shopping.empty')}</StateNote>
        ) : (
          <Reorder.Group axis="y" values={order} onReorder={setOrder} as="div" style={{ listStyle: 'none' }}>
            <AnimatePresence>
              {order.map((item) => (
                <ShoppingRow
                  key={item.id}
                  item={item}
                  reduced={Boolean(reduced)}
                  onCheck={(checked) => check.mutate({ id: item.id, checked })}
                  onDelete={() => deleteItem(item)}
                  onReorderEnd={onReorderEnd}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        )}

        {order.length > 0 && (
          <div className="actions" style={{ marginTop: 0 }}>
            <Button variant="outlined" onClick={() => void exportList()}><Icon name="share" size={18} /> {t('shopping.export')}</Button>
            {anyChecked && (
              <Button variant="tonal" onClick={clearChecked}>
                <Icon name="broom" size={18} /> {t('shopping.clearChecked')}
              </Button>
            )}
            <Button variant="danger" onClick={clearAll}>
              <Icon name="trash" size={18} /> {t('shopping.clearAll')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- per-recipe planning view ---------- */

function ByRecipeView() {
  const reduced = useReducedMotion();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const recipes = useQuery({ queryKey: ['recipes', 'shopping-picker'], queryFn: () => api.recipes() });

  const query = q.trim().toLowerCase();
  const items = (recipes.data?.items ?? []).filter(
    (r) => !query || r.titel.toLowerCase().includes(query) || r.kueche.toLowerCase().includes(query),
  );

  return (
    <>
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('shopping.filterPlaceholder')}
        aria-label={t('shopping.filterPlaceholder')}
      />
      {recipes.isLoading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : (recipes.data?.items ?? []).length === 0 ? (
        <p className="muted">{t('shopping.noRecipes')}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t('shopping.noMatches')}</p>
      ) : (
        items.map((item, i) => (
          <RecipeRow
            key={item.id}
            item={item}
            index={i}
            open={openId === item.id}
            onToggle={() => setOpenId(openId === item.id ? null : item.id)}
            reduced={!!reduced}
          />
        ))
      )}
    </>
  );
}

function RecipeRow({
  item,
  index,
  open,
  onToggle,
  reduced,
}: {
  item: RecipeListItem;
  index: number;
  open: boolean;
  onToggle: () => void;
  reduced: boolean;
}) {
  const { withUndo } = useShoppingUndo();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['recipes', 'detail', item.id],
    queryFn: () => api.recipe(item.id),
    enabled: open,
  });

  // Shared-element morph to the recipe detail (same pattern as RecipeCard):
  // this row is the source while a transition to/from its recipe runs, and the
  // staggered entrance is suppressed during any route morph on this page.
  const isSource = useViewTransitionState(`/rezept/${item.id}`);
  // Separate const — `isSource || useHook()` would skip the hook call when
  // isSource is true (conditional hook = React #300 mid-morph).
  const listTransitioning = useViewTransitionState(location.pathname);
  const morphing = isSource || listTransitioning;
  const queryOpts = { queryKey: ['recipes', item.id], queryFn: () => api.recipe(item.id) };
  const openRecipe = async () => {
    await queryClient.ensureQueryData(queryOpts); // hero must render synchronously
    clearTabTransition(); // a detail morph must never inherit a tab slide
    navigate(`/rezept/${item.id}`, { viewTransition: true });
  };

  return (
    <motion.div
      className="card card--outlined"
      {...(reduced || morphing ? {} : riseIn)}
      transition={stagger(Math.min(index, 8))}
    >
      <div className="row" style={{ width: '100%' }}>
        <button
          className="row row--between"
          onClick={onToggle}
          aria-expanded={open}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', minHeight: 'var(--touch-target)' }}
        >
          <span className="row" style={{ minWidth: 0 }}>
            <RecipeMotif
              motif={motifForRecipe(item)}
              seed={item.titel}
              size={44}
              style={isSource ? { viewTransitionName: SHARED_MOTIF } : undefined}
            />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', font: 'var(--type-title)', viewTransitionName: isSource ? SHARED_TITLE : undefined }}>
                {item.titel}
              </span>
              <span className="muted" style={{ font: 'var(--type-label-sm)' }}>
                {item.mode === 'cocktail' ? <><Icon name="cocktail" size={12} />{' '}</> : null}{item.kueche}
              </span>
            </span>
          </span>
          <motion.span aria-hidden animate={{ rotate: open ? 180 : 0 }} transition={spring} className="muted">
            ▾
          </motion.span>
        </button>
        <IconButton
          label={t('common.openRecipe')}
          onPointerDown={() => void queryClient.prefetchQuery(queryOpts)}
          onClick={() => void openRecipe()}
        >
          <Icon name="plate" size={20} />
        </IconButton>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {detail.isLoading ? (
              <p className="muted">{t('common.loading')}</p>
            ) : detail.data ? (
              <>
                <div className="ingr-grid">
                  {detail.data.recipe.zutaten.map((z, zi) => (
                    <Fragment key={zi}>
                      <span className="ingr-grid__menge">{formatZutatMenge(z, 1)}</span>
                      <span className="ingr-grid__name">{z.name}</span>
                    </Fragment>
                  ))}
                </div>
                <div className="actions" style={{ marginTop: 'var(--space-3)' }}>
                  <Button
                    variant="tonal"
                    onClick={() => void withUndo(t('shopping.recipeAdded'), () => api.shoppingFromRecipe(item.id))}
                  >
                    <Icon name="cart" size={18} /> {t('shopping.addRecipeToList')}
                  </Button>
                </div>
              </>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
