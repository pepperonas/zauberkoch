/** Favorites with cuisine/mode filter chips. */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Icon } from '../components/icons';
import { RecipeCard } from '../components/recipe/RecipeCard';
import { Chip } from '../components/ui';
import { StateNote } from '../components/ui/StateNote';
import { strings, t } from '../i18n';
import { api } from '../lib/api';

export function FavoritesPage() {
  const [mode, setMode] = useState('');
  const [kueche, setKueche] = useState('');
  const [gtyp, setGtyp] = useState('');

  const recipes = useQuery({
    queryKey: ['recipes', 'favorites', mode],
    queryFn: () => api.recipes({ mode, favorites_only: true }),
  });

  const items = recipes.data?.items ?? [];
  const kuechen = useMemo(() => [...new Set(items.map((i) => i.kueche).filter(Boolean))], [items]);
  // Meal-type chips in canonical order, only those actually present (stored lowercased).
  const typen = useMemo(
    () => strings.gerichtTypen.filter((g) => items.some((i) => i.gericht_typ === g.toLowerCase())),
    [items],
  );
  const filtered = items
    .filter((i) => !kueche || i.kueche === kueche)
    .filter((i) => !gtyp || i.gericht_typ === gtyp);

  return (
    <div>
      <h1 className="page__title">{t('favorites.title')}</h1>
      <div className="stack">
        <div className="chips page-tools">
          <Chip selected={mode === ''} onToggle={() => setMode('')}>{t('favorites.filterAll')}</Chip>
          <Chip selected={mode === 'kochen'} onToggle={() => setMode(mode === 'kochen' ? '' : 'kochen')}>
            <Icon name="pan" size={13} /> {t('wizard.modeKochen')}
          </Chip>
          <Chip selected={mode === 'cocktail'} onToggle={() => setMode(mode === 'cocktail' ? '' : 'cocktail')}>
            <Icon name="cocktail" size={13} /> {t('wizard.modeCocktail')}
          </Chip>
          {typen.map((g) => (
            <Chip key={g} selected={gtyp === g.toLowerCase()} onToggle={() => setGtyp(gtyp === g.toLowerCase() ? '' : g.toLowerCase())}>
              {g}
            </Chip>
          ))}
          {kuechen.map((k) => (
            <Chip key={k} selected={kueche === k} onToggle={() => setKueche(kueche === k ? '' : k)}>
              {k}
            </Chip>
          ))}
        </div>
        {recipes.isLoading ? (
          <StateNote>{t('common.loading')}</StateNote>
        ) : filtered.length === 0 ? (
          <StateNote icon="star">{t('favorites.empty')}</StateNote>
        ) : (
          <div className="cardgrid">
            {filtered.map((item, i) => <RecipeCard key={item.id} item={item} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
}
