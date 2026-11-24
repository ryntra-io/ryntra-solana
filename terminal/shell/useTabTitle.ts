'use client';

import { useEffect } from 'react';
import { useLang } from '@/city/lib/i18n/lang';
import { useWhere } from './frame';
import { tabKeyAt, tabTitle } from './tab-title';

/**
 * The browser's tab in the person's language: the server names a page in English, before it knows the
 * language the person keeps; once the frame knows it, the tab says the page's name in it — and again whenever the
 * person turns the language, or the router writes the page's English name back on a move. The page that is not there
 * names its own tab (`lost/Lost.tsx`) and is left to it.
 */
export function useTabTitle(): void {
  const { pathname } = useWhere();
  const lang = useLang();
  useEffect(() => {
    const key = tabKeyAt(pathname);
    if (!key) return;
    const want = tabTitle(key, lang);
    const put = () => {
      if (document.title === want || document.querySelector('[data-terminal="lost"]')) return;
      document.title = want;
    };
    put();
    // The router writes a page's title after the screen has drawn (a streamed one later still): it is put back.
    const watch = new MutationObserver(put);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [pathname, lang]);
}
