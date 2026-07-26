/** Ingredient input with autocomplete + removable badges.
 *
 * Used for the wizard's fridge field and the profile's pantry list, so both
 * behave identically. Free text always stays allowed — the catalogue only
 * makes the common cases fast.
 *
 * Deliberately a hand-rolled listbox rather than <datalist>: the native
 * control can't be styled with our tokens, renders differently per browser and
 * is unreliable on iOS. This one follows the ARIA combobox pattern
 * (↑/↓/Enter/Escape/Tab) and works with mouse + touch.
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useRef, useState } from 'react';

import { t } from '../../i18n';
import { foldZutat, matchZutaten } from '../../lib/zutatKatalog';
import { fastSpatial, reducedFade } from '../../motion/tokens';
import { Icon } from '../icons';
import './zutatInput.css';

interface Props {
  /** Currently selected ingredients (rendered as badges). */
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Hard cap; the input is disabled once reached. */
  max?: number;
  /** aria-label for the text field. */
  label?: string;
}

export function ZutatInput({ items, onChange, placeholder, max = 30, label }: Props) {
  const reduced = useReducedMotion();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // highlighted suggestion
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | undefined>(undefined);
  const listId = useId();

  const full = items.length >= max;
  const suggestions = full ? [] : matchZutaten(query, items);
  const showList = open && suggestions.length > 0;

  const add = (raw: string) => {
    const value = raw.trim();
    if (!value || full) return;
    // fold-insensitive dedupe: "tomate" must not land next to "Tomate"
    if (!items.some((i) => foldZutat(i) === foldZutat(value))) onChange([...items, value]);
    setQuery('');
    setActive(-1);
    inputRef.current?.focus(); // keep the flow going for the next ingredient
  };

  const remove = (item: string) => onChange(items.filter((i) => i !== item));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!showList) {
        setOpen(true);
        return;
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + dir + suggestions.length) % suggestions.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      add(active >= 0 && suggestions[active] ? suggestions[active] : query);
      return;
    }
    if (e.key === 'Escape' && showList) {
      e.preventDefault(); // close the list first, don't bubble to a sheet/dialog
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'Backspace' && !query && items.length > 0) {
      remove(items[items.length - 1]); // quick correction, like a tag field
    }
  };

  return (
    // Badges ABOVE the field on purpose: the suggestion list drops *below* the
    // input, so badges underneath would sit behind it and their X becomes
    // unreachable while typing (same "selection on top" order as CuisineSheet).
    <div className="zin">
      {items.length > 0 && (
        <ul className="zin__badges">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item}
                className="zin__badge"
                layout={!reduced}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                transition={reduced ? reducedFade : fastSpatial}
              >
                <span className="zin__badge-text">{item}</span>
                <button
                  type="button"
                  className="zin__badge-x"
                  aria-label={`${item} ${t('zutat.remove')}`}
                  onClick={() => remove(item)}
                >
                  <Icon name="close" size={14} />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <div className="zin__field">
        <input
          ref={inputRef}
          className="input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label={label ?? placeholder}
          autoComplete="off"
          value={query}
          disabled={full}
          placeholder={full ? t('zutat.maxReached') : placeholder}
          maxLength={60}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // let a click on a suggestion land before the list unmounts
            blurTimer.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
        />

        <AnimatePresence>
          {showList && (
            <motion.ul
              className="zin__list"
              id={listId}
              role="listbox"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={reduced ? reducedFade : fastSpatial}
            >
              {suggestions.map((s, i) => (
                <li key={s} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={`zin__option ${i === active ? 'zin__option--active' : ''}`}
                    // pointerdown fires before blur -> the click always registers
                    onPointerDown={(e) => {
                      e.preventDefault();
                      window.clearTimeout(blurTimer.current);
                      add(s);
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <Icon name="plus" size={14} />
                    <Highlight text={s} query={query} />
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}

/** Bold the matched part so the user sees why a suggestion is offered. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = foldZutat(query.trim());
  if (!q) return <span>{text}</span>;
  // fold() is 1:1 per character except ä/ö/ü/ß, which expand — so index maths
  // on the folded string can drift. Match on the raw string case-insensitively
  // first; fall back to no highlight rather than showing a wrong slice.
  const idx = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (idx < 0) return <span>{text}</span>;
  const end = idx + query.trim().length;
  return (
    <span>
      {text.slice(0, idx)}
      <strong>{text.slice(idx, end)}</strong>
      {text.slice(end)}
    </span>
  );
}
