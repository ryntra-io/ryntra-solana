'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { MenuIcon } from '@/terminal/shell/menu-icons';
import { Action } from '@/terminal/ui';
import type { MoneyTab } from './money-view';
import { MONEY_WORDS } from './words';
import m from './money.module.css';

/**
 * A tab of «Money» with no wallet yet: the tab's own sign, what it does in a few words and one line, in the
 * middle of the panel — and the panel's one amber press, «Connect wallet», where the tab's own press stands once a
 * wallet is here. Nothing is read, drawn or asked before that.
 */
export function NoWallet({ tab, onConnect }: { tab: MoneyTab; onConnect: () => void }) {
  const w = useWords(MONEY_WORDS);
  const said = {
    send: [w.sendBlankTitle, w.sendBlankLine],
    receive: [w.receiveBlankTitle, w.receiveBlankLine],
    invoices: [w.invoicesBlankTitle, w.invoicesBlankLine],
  } as const;
  const [title, line] = said[tab];
  return (
    <>
      <div className={m.blank} data-money-blank={tab}>
        <span className={m.blankSign} aria-hidden="true">
          <MenuIcon name={tab} />
        </span>
        <h2 className={m.blankTitle}>{title}</h2>
        <p className={m.blankLine}>{line}</p>
      </div>
      <Action onClick={onConnect}>{w.connect}</Action>
    </>
  );
}
