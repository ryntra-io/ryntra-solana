'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { hydrateLang, useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { LOST_MARK } from '@/city/lib/open/lost';
import { ActionBody, changeText, changeTone, coinIcon, Icon, ListRow, Page, PageHead, Panel, priceText, QuietLink, Search } from '@/terminal/ui';
import ui from '@/terminal/ui/ui.module.css';
import { HOME_PATH, shelfHref, shelfOn, shelvesShown } from '../shelves';
import { useMarket } from '../useMarket';
import { SHELF_WORDS, SHELL } from '../words';
import { findCoins } from './find';
import { LOST_WORDS } from './words';
import s from './lost.module.css';

/** The site's own pages a person may have been looking for, beside the sections. */
const SITE_PAGES = [
  { href: '/docs', word: 'docs' },
  { href: '/support', word: 'help' },
] as const;

/**
 * The page where there is none (an address that never was, or one a page answers with «not found»), in the terminal's
 * frame and language: its name, a coin search over the market the frame already reads, one amber way back to the
 * Market, and the sections as quiet doors. No code, no address, nothing of the city. With the terminal shut the frame is
 * the plain one and the page keeps only its name and the way home.
 */
export function Lost() {
  // The person's language before the first paint: the plain frame, where the terminal is shut, has no shell to do it.
  useLayoutEffect(() => void hydrateLang(), []);
  const w = useWords(LOST_WORDS);
  const lang = useLang();
  const open = shelfOn('market');

  // The tab says it in the person's language, also where a section had given the tab a name of its own.
  useEffect(() => {
    document.title = w.tab;
  }, [w.tab]);

  const marked = { [LOST_MARK]: 'missing' };
  const side = open ? <LostDoors /> : undefined;

  return (
    <Page {...marked} data-terminal="lost">
      <PageHead title={w.title} />
      <ActionBody side={side} sideLabel={w.sections}>
        <Panel tone="hi" pad="l" className={s.act}>
          {open ? <CoinSearch lang={lang} /> : null}
          <Link href={HOME_PATH} className={ui.act} prefetch={false}>
            {open ? w.toMarket : w.home}
          </Link>
        </Panel>
      </ActionBody>
    </Page>
  );
}

/**
 * The sections as quiet doors, and the site's own pages beside them. Also the side of a coin's screen that could not be
 * read or names no coin (the coin's flaw 64): the same ways on from a page with nothing to show.
 */
export function LostDoors() {
  const w = useWords(LOST_WORDS);
  const shelf = useWords(SHELF_WORDS);
  const shell = useWords(SHELL);
  const doors = shelvesShown('live').filter((id) => id !== 'market');
  return (
    <Panel pad="m" label={w.sections}>
      <nav className={s.doors} aria-label={w.sections}>
        {doors.map((id) => (
          <QuietLink key={id} href={shelfHref(id, 'live')} size="s">
            {shelf[id]}
          </QuietLink>
        ))}
        {SITE_PAGES.map((page) => (
          <QuietLink key={page.href} href={page.href} size="s">
            {shell[page.word]}
          </QuietLink>
        ))}
      </nav>
    </Panel>
  );
}

/** The coin search: up to five coins of the market as the person types, each a row that opens its screen. */
export function CoinSearch({ lang }: { lang: Lang }) {
  const w = useWords(LOST_WORDS);
  const market = useMarket();
  const [query, setQuery] = useState('');
  const found = useMemo(() => findCoins(market.towers, query), [market.towers, query]);
  const typed = query.trim().length > 0;
  return (
    <div className={s.find}>
      <Search value={query} onChange={setQuery} placeholder={w.find} />
      {typed ? (
        <div className={s.found} aria-live="polite">
          {found.coins.map((coin) => (
            <ListRow
              key={coin.id}
              icon={coinIcon(coin)}
              symbol={coin.symbol}
              name={coin.name}
              value={priceText(coin.price, lang)}
              change={changeText(coin.change24h, lang)}
              tone={changeTone(coin.change24h)}
              href={`/coin/${encodeURIComponent(coin.id)}`}
            />
          ))}
          {found.mint ? (
            <Link href={`/coin/${found.mint}`} className={s.mint} prefetch={false}>
              <span>{w.openCoin}</span>
              <span className={s.mintText}>{`${found.mint.slice(0, 4)}…${found.mint.slice(-4)}`}</span>
              <Icon name="arrow" size="s" />
            </Link>
          ) : null}
          {!found.coins.length && !found.mint ? <p className={s.none}>{w.none}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
