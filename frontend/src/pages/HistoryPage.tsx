/** History: everything the user ever generated, with search + mode filter. */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Icon } from '../components/icons';
import { RecipeCard } from '../components/recipe/RecipeCard';
import { Chip } from '../components/ui';
import { StateNote } from '../components/ui/StateNote';
import { strings, t } from '../i18n';
import { api } from '../lib/api';

export function HistoryPage() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('');
  const [gtyp, setGtyp] = useState('');

  const recipes = useQuery({
    queryKey: ['recipes', 'history', q, mode],
    queryFn: () => api.recipes({ q, mode }),
  });

  const all = recipes.data?.items ?? [];
  const typen = useMemo(
    () => strings.gerichtTypen.filter((g) => all.some((i) => i.gericht_typ === g.toLowerCase())),
    [all],
  );
  const items = gtyp ? all.filter((i) => i.gericht_typ === gtyp) : all;

  return (
    <div>
      <h1 className="page__title">{t('history.title')}</h1>
      <div className="stack">
        <input
          className="input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('history.searchPlaceholder')}
          aria-label={t('history.searchPlaceholder')}
        />
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
        </div>
        {recipes.isLoading ? (
          <StateNote>{t('common.loading')}</StateNote>
        ) : items.length === 0 ? (
          <StateNote icon="history">{t('history.empty')}</StateNote>
        ) : (
          <div className="cardgrid">
            {items.map((item, i) => <RecipeCard key={item.id} item={item} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
}
