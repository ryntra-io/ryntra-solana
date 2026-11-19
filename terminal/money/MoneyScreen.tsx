'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { flowLive } from '@/city/lib/money/flag';
import { useMoneyStore } from '@/city/lib/money/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { useTabInAddress } from '@/terminal/shell/address';
import { openPanel } from '@/terminal/shell/frame';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { SendPanel } from '@/terminal/swap/Send';
import { ActionBody, Page, PageHead, Panel, Tabs } from '@/terminal/ui';
import { InvoiceForm, MyLinks } from './Invoices';
import { firstTab, tabsShown, type MoneyTab } from './money-view';
import { NoWallet } from './NoWallet';
import { Receive } from './Receive';
import { Transfers } from './Transfers';
import { useInvoices } from './useInvoices';
import { MONEY_WORDS } from './words';
import m from './money.module.css';

/** After a transfer lands, the ledger is read again — and once more for a network that lags. */
const AFTER_MS = [1_500, 7_000] as const;

/**
 * «Money»: everything a person sends and
 * receives, on the one page every section shares — the name and its tabs at the head, the tab's one panel in
 * the action column, «Recent transfers» beside it.
 *
 * - «Send» — a coin of the wallet to a Solana address or a `.skr` name: the transfer the Portfolio's panel was, on the
 *   money logic as it stands (`city/lib/money/**`, `terminal/swap/Send.tsx`); it stands only where money may move.
 * - «Receive» — the wallet's own address and its QR; from another network, the bridge.
 * - «Invoices» — a payment link on the engine (`lib/pay/**`) and the wallet's own links with who paid; the payer's page
 *   `/pay/<id>` as it is.
 *
 * «Private», «Contacts» and «Autopay» come with their screens. Nothing here changes how money
 * moves: the engines, their fees and their signatures are the money logic's own.
 */
export function MoneyScreen() {
  const w = useWords(MONEY_WORDS);
  const sends = flowLive('send');
  const bridge = flowLive('bridge') || flowLive('deposit');
  const tabs = tabsShown(sends);
  const first = firstTab(sends);
  const [tab, setTab] = useState<MoneyTab>(first);
  useTabInAddress(tab, setTab, tabs, first);
  const owner = useWallet((st) => st.connection?.address ?? null);

  // The money logic follows the connected wallet: its coins for «Send», its ledger for «Recent transfers».
  useEffect(() => useMoneyStore.getState().follow(owner), [owner]);
  // A transfer that ends here shows in «Recent transfers» at once, and the wallet's coins are read again.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const off = useMoneyStore.subscribe((now, before) => {
      if (!now.send.settled || before.send.settled) return;
      void useMoneyStore.getState().readActivity();
      useWallet.getState().refreshHoldings(AFTER_MS);
      for (const ms of AFTER_MS) timers.push(setTimeout(() => useMoneyStore.getState().readWallet(), ms));
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, []);

  // The links are asked for once the person opens «Invoices» — never on another tab.
  const [invoicesSeen, setInvoicesSeen] = useState(tab === 'invoices');
  useEffect(() => {
    if (tab === 'invoices') setInvoicesSeen(true);
  }, [tab]);
  const invoices = useInvoices(invoicesSeen ? owner : null);

  const connect = useCallback(() => {
    // A phone's wallet lives in the frame's own sheet.
    if (window.matchMedia(NARROW).matches) openPanel('sheet');
    connectWallet();
  }, []);

  const names: Readonly<Record<MoneyTab, string>> = { send: w.send, receive: w.receive, invoices: w.invoices };
  return (
    <Page data-money-screen={tab}>
      <PageHead title={w.title} tabs={<Tabs bare label={w.tabs} value={tab} onChange={setTab} items={tabs.map((id) => ({ id, label: names[id] }))} />} />
      <ActionBody side={<Transfers />} sideLabel={w.recent}>
        <Panel tone="hi" pad="l" gap={16} edge label={names[tab]} className={m.form}>
          {!owner ? (
            // No wallet yet: each tab says what it does, and the one press connects one.
            <NoWallet tab={tab} onConnect={connect} />
          ) : tab === 'send' ? (
            <SendPanel bare />
          ) : tab === 'receive' ? (
            <Receive owner={owner} bridge={bridge} />
          ) : (
            <InvoiceForm key={owner} create={invoices.create} />
          )}
        </Panel>
        {tab === 'invoices' && owner ? <MyLinks links={invoices.links} onUnlock={invoices.unlock} onRead={() => void invoices.read()} /> : null}
      </ActionBody>
    </Page>
  );
}
