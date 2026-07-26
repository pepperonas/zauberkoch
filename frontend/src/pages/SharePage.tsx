/** Public shared-recipe page (/r/:token) — readable without login,
 * adoptable into the own collection when logged in.
 */

import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Icon } from '../components/icons';
import { RecipeView } from '../components/recipe/RecipeView';
import { Button } from '../components/ui';
import { useSnackbar } from '../components/ui/Snackbar';
import { t } from '../i18n';
import { api } from '../lib/api';
import { ShareIntro } from '../features/share/ShareIntro';
import { useApp } from '../state/app';

export function SharePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { me } = useApp();
  const { show } = useSnackbar();

  const shared = useQuery({
    queryKey: ['shared', token],
    queryFn: () => api.sharedGet(token ?? ''),
    enabled: Boolean(token),
    retry: false,
  });

  // Admin-configured entrance animation (server-provided with the payload).
  // Plays on every shared link, then reveals the recipe underneath.
  const [introDone, setIntroDone] = useState(false);
  const intro = shared.data?.intro ?? 'off';
  const introActive = Boolean(shared.data) && intro !== 'off' && !introDone;

  if (shared.isLoading) return <p className="muted page__title">{t('common.loading')}</p>;
  if (!shared.data) {
    return (
      <div className="limitbox">
        <div className="limitbox__emoji" aria-hidden><Icon name="link" size={52} /></div>
        <h2>{t('shared.notFound')}</h2>
        <div style={{ marginTop: 'var(--space-6)' }}>
          <Button variant="tonal" onClick={() => navigate('/')}><Icon name="logo" size={18} /> Zauberkoch</Button>
        </div>
      </div>
    );
  }

  const { recipe, mode } = shared.data;

  const adopt = async () => {
    const res = await api.shareAdopt(token ?? '');
    void queryClient.invalidateQueries({ queryKey: ['recipes'] });
    show(t('shared.adopted'));
    navigate(`/rezept/${res.recipe_id}`);
  };

  return (
    <div>
      {/* Entrance animation over the (already rendered) recipe, so the content
          is fully painted the moment the intro lifts — no second load. */}
      <AnimatePresence>
        {introActive && (
          <ShareIntro
            mode={mode}
            title={recipe.titel}
            variant={intro === 'crt' ? 'crt' : 'motif'}
            onDone={() => setIntroDone(true)}
          />
        )}
      </AnimatePresence>
      <p className="hero__kueche" style={{ margin: 'var(--space-4) 0' }}><Icon name="link" size={14} /> {t('shared.badge')}</p>
      <RecipeView
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
        actions={
          me ? (
            <Button big onClick={() => void adopt()}><Icon name="plus" size={20} /> {t('shared.adopt')}</Button>
          ) : (
            <Button big onClick={() => (window.location.href = '/api/v1/auth/login')}>
              <Icon name="wand" size={20} /> {t('shared.loginCta')}
            </Button>
          )
        }
      />
    </div>
  );
}
