'use client';

import Link from 'next/link';
import { useWords } from '@/city/lib/i18n/dict';
import { Icon } from '@/terminal/ui';
import { useWhere } from './frame';
import { walletPage } from './menu';
import { BOTS_ALSO, PHONE_CENTER, PHONE_TABS, shelfHref, shelfOn } from './shelves';
import { SHELF_WORDS, SHELL } from './words';
import s from './shell.module.css';

/**
 * The phone's tab bar: Market · Swap · Agent · Earn · Portfolio, the agent in the middle on its amber diamond. A tab
 * stands once its shelf is on (on the kit page, all five); with none on, there is no bar. A bot is not the agent
 * (decision 109): the bots' pages stand on the Agents shelf, but light no tab here (QA 19.11 ніч, m14).
 */
export function PhoneBar() {
  const { view, shelf, pathname } = useWhere();
  const onBots = BOTS_ALSO.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  // A wallet's own pages (`/watch`, `/wallet/…`) stand in the Portfolio, as the rail lights them.
  const lit = shelf ?? (walletPage(pathname) ? 'portfolio' : null);
  const names = useWords(SHELF_WORDS);
  const w = useWords(SHELL);
  const tabs = PHONE_TABS.filter((id) => view === 'preview' || shelfOn(id));
  if (!tabs.length) return null;
  return (
    <nav className={s.tabbar} data-terminal="tabs" aria-label={w.sections}>
      {tabs.map((id) => (
        <Link key={id} className={s.tab} href={shelfHref(id, view)} aria-current={id === lit && !(id === PHONE_CENTER && onBots) ? 'page' : undefined}>
          {id === PHONE_CENTER ? (
            <span className={s.gem}>
              <Icon name={id} size="l" />
            </span>
          ) : (
            <Icon name={id} size="l" />
          )}
          {id === PHONE_CENTER ? w.agent : names[id]}
        </Link>
      ))}
    </nav>
  );
}
