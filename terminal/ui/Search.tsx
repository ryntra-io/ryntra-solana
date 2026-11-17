import { Icon } from './icons';
import s from './ui.module.css';

/** The search field of a list: a magnifier and the words. The list filters as the person types. */
export function Search({ value, onChange, placeholder }: { value: string; onChange: (text: string) => void; placeholder: string }) {
  return (
    <label className={s.search}>
      <Icon name="search" size="s" />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} autoComplete="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
