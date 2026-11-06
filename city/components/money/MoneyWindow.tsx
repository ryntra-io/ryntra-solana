'use client';

import { useEffect, useMemo } from 'react';
import { formatUsd, portfolioOf } from '@/city/lib/money/assets';
import { useWords } from '@/city/lib/i18n/dict';
import { MONEY_TABS, tabLive } from '@/city/lib/money/flag';
import { useMoney } from '@/city/lib/money/open';
import { short } from '@/city/lib/money/recipient';
import { useMoneyStore } from '@/city/lib/money/store';
import { colourOf } from '@/city/lib/trade/colour';
import { useWallet } from '@/city/lib/trade/wallet';
import { Activity } from './Activity';
import { Connect, TabGlyph } from './bits';
import { PayLink } from './PayLink';
import { Portfolio } from './Portfolio';
import { SendWays } from './SendWays';
import { TopUp } from './TopUp';
import { MONEY } from './words';
import { TAB_WORDS } from '@/city/lib/money/words';
import s from './money.module.css';

/**
 * The Money window's contents: Top up, Send, Pay link, Activity and Portfolio in one place in the city, on Ryntra's own
 * money engine. The city's one window frame (CITY-65) brings the head, the moving, the sticking and the whole screen on
 * a computer and the bottom sheet on a phone; while a signature is out the frame holds the window, on that transfer.
 */
export default function MoneyWindow() {
  const w = useWords(MONEY);
  const tabs = useWords(TAB_WORDS);
  const tab = useMoney((st) => st.tab);
  const busy = useMoney((st) => st.busy);
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const wallet = useMoneyStore((st) => st.wallet);
  const total = useMemo(() => (wallet && wallet.owner === owner ? portfolioOf(wallet.assets).totalUsd : null), [wallet, owner]);

  // The window's money follows the wallet: another wallet, or none, and the last one's state goes.
  useEffect(() => useMoneyStore.getState().follow(owner), [owner]);
  // A transfer between networks still on its way is followed again whenever the window opens.
  useEffect(() => {
    if (owner) void useMoneyStore.getState().followOrder();
  }, [owner]);

  return (
    <div className={s.framed} aria-label={w.money}>
      {owner ? (
        <div className={s.head}>
          <span className={s.who} style={{ ['--player' as string]: colourOf(owner) }}>
            <span className={s.dot} aria-hidden="true" />
            <span translate="no">{short(owner)}</span>
            {total !== null && tab !== 'portfolio' ? <b>{formatUsd(total)}</b> : null}
          </span>
        </div>
      ) : null}
      <nav className={s.tabs} role="tablist" aria-label={w.money}>
        {MONEY_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`${s.tab} ${tab === id ? s.tabOn : ''}`}
            onClick={() => useMoney.getState().setTab(id)}
            disabled={busy && tab !== id}
          >
            <TabGlyph tab={id} />
            <span>{tabs[id]}</span>
            {tabLive(id) ? null : <i className={s.soonDot} aria-label={w.opensSoon} />}
          </button>
        ))}
      </nav>
      <div className={s.body}>
        {!owner ? (
          <Connect />
        ) : tab === 'topup' ? (
          <TopUp owner={owner} />
        ) : tab === 'send' ? (
          <SendWays owner={owner} />
        ) : tab === 'paylink' ? (
          <PayLink owner={owner} />
        ) : tab === 'activity' ? (
          <Activity owner={owner} />
        ) : (
          <Portfolio />
        )}
      </div>
    </div>
  );
}
