'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { LANG_LABEL, LANGS, setLang, useLang } from '@/city/lib/i18n/lang';
import { Icon, Segment, type IconName } from '@/terminal/ui';
import { SHELL } from './words';
import s from './shell.module.css';

/** The site's own pages a person may want from anywhere: they open whole, outside the terminal's frame. */
const DOORS: readonly Readonly<{ href: string; icon: IconName; word: 'docs' | 'help' | 'about' }>[] = [
  { href: '/docs', icon: 'book', word: 'docs' },
  { href: '/support', icon: 'help', word: 'help' },
  { href: '/about', icon: 'globe', word: 'about' },
];

/** The legal documents: quieter than the doors, one row under them. */
const LEGAL: readonly Readonly<{ href: string; word: 'terms' | 'privacy' }>[] = [
  { href: '/legal/terms', word: 'terms' },
  { href: '/legal/privacy', word: 'privacy' },
];

/**
 * «More»: the language — English or Ukrainian, the same choice the city keeps on this device, every word repainted in
 * place — the site's documentation, help and «About», and under them the Terms and the Privacy Policy.
 */
export function More() {
  const w = useWords(SHELL);
  const lang = useLang();
  return (
    <>
      <div className={s.popHead}>
        <span>{w.language}</span>
      </div>
      <Segment label={w.language} value={lang} onChange={setLang} items={LANGS.map((code) => ({ id: code, label: LANG_LABEL[code] }))} />
      {DOORS.map((door) => (
        <a key={door.href} className={s.door} href={door.href}>
          <Icon name={door.icon} />
          <span>{w[door.word]}</span>
          <Icon name="arrow" size="s" />
        </a>
      ))}
      <nav className={s.legalRow} aria-label={w.legal}>
        {LEGAL.map((doc) => (
          <a key={doc.href} href={doc.href}>
            {w[doc.word]}
          </a>
        ))}
      </nav>
    </>
  );
}
