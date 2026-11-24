import type { Lang } from '../../city/lib/i18n/langs.ts';
import { TAB_WORDS } from './words.ts';

/** A page's name in the browser's tab (`TAB_WORDS`). */
export type TabKey = keyof (typeof TAB_WORDS)['en'];

/**
 * The terminal's pages and the name of each in the tab, the longest address first. The Market, a coin's own screen and
 * the home page carry the terminal's own line; an address that is none of these (the page that is not there) keeps the
 * name its own page gives the tab.
 */
const PAGES: readonly (readonly [path: string, key: TabKey])[] = [
  ['/bots/recurring', 'recurring'],
  ['/bots/grid', 'grid'],
  ['/bots/ladder', 'ladder'],
  ['/bots/copy', 'copy'],
  ['/bots/signals', 'signals'],
  ['/bots/autopilot', 'autopilot'],
  ['/private/pay', 'pay'],
  ['/private/claim', 'claim'],
  ['/private/check', 'check'],
  ['/swap', 'swap'],
  ['/bridge', 'bridge'],
  ['/launch', 'launch'],
  ['/earn', 'earn'],
  ['/pro', 'pro'],
  ['/pool', 'pool'],
  ['/agent/pulse', 'pulse'],
  ['/agent', 'agents'],
  ['/bots', 'bots'],
  ['/portfolio', 'portfolio'],
  ['/money', 'money'],
  ['/rewards', 'rewards'],
  ['/watch', 'watch'],
  ['/wallet', 'wallet'],
  ['/market', 'home'],
  ['/coin', 'home'],
  // A trade's card is a page shared on X: its preview carries its own line, the tab the terminal's.
  ['/x', 'home'],
];

/** The tab's name for an address of the terminal, or null for one that is none of its pages. */
export function tabKeyAt(pathname: string): TabKey | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
  if (path === '/' || path === '') return 'home';
  return PAGES.find(([own]) => path === own || path.startsWith(`${own}/`))?.[1] ?? null;
}

/** The tab as the person reads it: «Обмін · Ryntra», «Swap · Ryntra»; the home page's own line in full. */
export function tabTitle(key: TabKey, lang: Lang): string {
  const name = TAB_WORDS[lang][key];
  return key === 'home' ? name : `${name} · Ryntra`;
}
