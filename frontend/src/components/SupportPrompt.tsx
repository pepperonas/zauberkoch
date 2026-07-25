/** Gentle support nudge shown after a handful of generated recipes.
 * Offers three ways to help — donate, email feedback, Google review — plus a
 * soft "later" and a permanent "don't ask again". Acting on any option
 * silences it for good. Visibility is driven by state/supportPrompt.ts. */

import { Dialog } from './ui/Dialog';
import { Button } from './ui';
import { Icon } from './icons';
import { useSnackbar } from './ui/Snackbar';
import { t } from '../i18n';
import { dismissSupport, useSupportPrompt } from '../state/supportPrompt';

const DONATE_URL =
  'https://www.paypal.com/donate/?business=martin.pfeffer%40celox.io&currency_code=EUR';
const REVIEW_URL = 'https://g.page/r/CXgdRV3QysvxEBM/review';
const FEEDBACK_HREF = `mailto:martin.pfeffer@celox.io?subject=${encodeURIComponent(
  t('support.feedbackSubject'),
)}`;

export function SupportPrompt() {
  const open = useSupportPrompt();
  const { show } = useSnackbar();

  // Any concrete action silences the prompt for good + thanks the user.
  const acted = () => {
    dismissSupport(true);
    show(t('support.thanks'));
  };

  return (
    <Dialog open={open} onClose={() => dismissSupport(false)} label={t('support.title')}>
      <div className="stack support">
        <h3 className="support__title">{t('support.title')}</h3>
        <p className="muted">{t('support.body')}</p>

        <a className="btn btn--filled support__action" href={DONATE_URL} target="_blank" rel="noopener noreferrer" onClick={acted}>
          <Icon name="heart" size={18} /> {t('support.donate')}
        </a>
        <a className="btn btn--tonal support__action" href={REVIEW_URL} target="_blank" rel="noopener noreferrer" onClick={acted}>
          <Icon name="star" size={18} /> {t('support.review')}
        </a>
        <a className="btn btn--tonal support__action" href={FEEDBACK_HREF} onClick={acted}>
          <Icon name="mail" size={18} /> {t('support.feedback')}
        </a>

        <div className="support__foot">
          <Button variant="text" onClick={() => dismissSupport(false)}>
            {t('support.later')}
          </Button>
          <Button variant="text" onClick={() => dismissSupport(true)}>
            {t('support.never')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
