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
import { ActionBody, Page, PageHead, Panel, Tabs, cx } from '@/terminal/ui';
import { AutopayTab } from './autopay/Autopay';
import { autopayNetwork } from './autopay/open';
import { AUTOPAY_WORDS } from './autopay/words';
import { ContactsTab } from './contacts/Contacts';
import { toFromQuery } from './contacts/contacts-view';
import { contactsOpen } from './contacts/open';
import { CONTACTS_WORDS } from './contacts/words';
import { InvoiceForm, MyLinks } from './Invoices';
import { firstTab, moreTabs, tabsShown, type MoneyTab } from './money-view';
import type { PayoutFeeSetting } from '@/lib/privacy/payouts/fee';
import { PayoutHistory, Payouts } from './payouts/Payouts';
import { payoutsOpen } from './payouts/payouts-view';
import { PAYOUTS } from './payouts/words';
import { NoWallet } from './NoWallet';
import { ModeSwitch, useInvoiceMode } from './private/Mode';
import { PrivateInvoiceList, PrivateInvoicePanel } from './private/PrivateInvoices';
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
 * - «Payouts» — a list of people paid from the private balance, with past payouts beside it; only with the
 *   private balance open (`NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`), its own no-wallet and turn-on states inside.
 *
 * - «Contacts» and «Autopay» — the wallet's address book and payments on a schedule, each its own tab with its
 *   own panel and list (`./contacts/**`, `./autopay/**`), only where the release opened their engines. «Send» offers the
 *   contacts under «To» and takes `?to=` from a contact's «Send».
 *
 * Nothing here changes how money moves: the engines, their fees and their signatures are the money logic's own.
 */
export function MoneyScreen({ payoutFee }: { payoutFee?: PayoutFeeSetting } = {}) {
  const w = useWords(MONEY_WORDS);
  const wpay = useWords(PAYOUTS);
  const wcon = useWords(CONTACTS_WORDS);
  const wauto = useWords(AUTOPAY_WORDS);
  const sends = flowLive('send');
  const autopay = autopayNetwork();
  const bridge = flowLive('bridge') || flowLive('deposit');
  // «Payouts» stands only with the private balance open; without it «Money» is as it was.
  const tabs = [...tabsShown(sends, payoutsOpen()), ...moreTabs({ contacts: contactsOpen(), autopay: autopay !== null })];
  const first = firstTab(sends);
  const [tab, setTab] = useState<MoneyTab>(first);
  useTabInAddress(tab, setTab, tabs, first);
  const owner = useWallet((st) => st.connection?.address ?? null);

  // The money logic follows the connected wallet: its coins for «Send», its ledger for «Recent transfers».
  useEffect(() => useMoneyStore.getState().follow(owner), [owner]);
  // A contact's «Send» arrives with `?to=`: the address goes into «To», once, as if typed — only where
  // contacts are open, so a link alone never fills a recipient on a deployment without them.
  useEffect(() => {
    if (!contactsOpen()) return;
    const to = toFromQuery(new URLSearchParams(window.location.search).get('to'));
    if (to && useMoneyStore.getState().send.phase === 'idle') useMoneyStore.getState().setTo(to);
  }, []);
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
  // «Invoices» open or private: the switch stands only with the private balance open; without it, «open».
  const mode = useInvoiceMode();
  const privately = tab === 'invoices' && mode.mode === 'private';

  const connect = useCallback(() => {
    // A phone's wallet lives in the frame's own sheet.
    if (window.matchMedia(NARROW).matches) openPanel('sheet');
    connectWallet();
  }, []);

  const names: Readonly<Record<MoneyTab, string>> = { send: w.send, receive: w.receive, invoices: w.invoices, payouts: wpay.tab, contacts: wcon.tab, autopay: wauto.tab };
  // «Contacts» and «Autopay» draw their own panel and list; «Recent transfers» stays beside them.
  const own =
    tab === 'contacts' ? <ContactsTab owner={owner} onConnect={connect} /> : tab === 'autopay' && autopay ? <AutopayTab owner={owner} network={autopay} onConnect={connect} /> : null;
  return (
    <Page data-money-screen={tab}>
      <PageHead title={w.title} tabs={<Tabs bare label={w.tabs} value={tab} onChange={setTab} items={tabs.map((id) => ({ id, label: names[id] }))} />} mark={tab === 'invoices' && mode.shown ? <ModeSwitch mode={mode.mode} onChange={mode.set} /> : undefined} />
      <ActionBody side={tab === 'payouts' ? <PayoutHistory /> : <Transfers />} sideLabel={tab === 'payouts' ? wpay.history : w.recent}>
        {tab === 'invoices' && mode.shown ? <ModeSwitch phone mode={mode.mode} onChange={mode.set} /> : null}
        {/* No wallet yet: the panel holds only what it says — never the form's height around one sign and a button
            (QA 19.11, eyes 31). Every tab's blank is the same height, so a turn of the tabs moves nothing. */}
        {own ?? (
          <Panel tone="hi" pad="l" gap={16} label={names[tab]} className={cx(m.form, !owner && m.formBlank)}>
            {tab === 'payouts' ? (
              <Payouts onConnect={connect} feeSetting={payoutFee} />
            ) : !owner ? (
              // No wallet yet: each tab says what it does, and the one press connects one.
              <NoWallet tab={tab} onConnect={connect} />
            ) : tab === 'send' ? (
              <SendPanel bare />
            ) : tab === 'receive' ? (
              <Receive owner={owner} bridge={bridge} />
            ) : privately ? (
              <PrivateInvoicePanel key={owner} owner={owner} />
            ) : (
              <InvoiceForm key={owner} create={invoices.create} />
            )}
          </Panel>
        )}
        {tab === 'invoices' && owner ? (
          privately ? <PrivateInvoiceList owner={owner} /> : <MyLinks links={invoices.links} onUnlock={invoices.unlock} onRead={() => void invoices.read()} />
        ) : null}
      </ActionBody>
    </Page>
  );
}
