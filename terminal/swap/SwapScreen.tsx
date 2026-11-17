'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';
import { readAsk } from '@/city/lib/autopilot/read';
import { bookOf } from '@/city/lib/command/parse';
import { sayCoin } from '@/city/lib/crew/say';
import { run } from '@/city/lib/command/run';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { flowLive } from '@/city/lib/money/flag';
import { useMoneyStore } from '@/city/lib/money/store';
import { SPOT_OPEN } from '@/city/lib/trade/gates';
import { choiceOf, payKey, useTrade } from '@/city/lib/trade/store';
import { isBase, SOL, USDC, type PayAsset, type Side } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { TICKET_OPEN, iconOf } from '@/terminal/coin/Ticket';
import { ExplainButton, bare } from '@/terminal/coin/parts';
import { gatesFor } from '@/terminal/shell/ask-route';
import { engineGates } from '@/terminal/shell/engine';
import { useSay } from '@/terminal/shell/say';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { CoinLogo, Icon, Panel, Quiet, Tabs, changeText, changeTone, priceText, type TabItem } from '@/terminal/ui';
import { BridgePanel } from './Bridge';
import { swapDoors } from './doors';
import { Recent } from './Recent';
import { LimitTab } from './LimitTab';
import { SendPanel } from './Send';
import { arrivalOf, cardBusy, showLimit, showMoney, showSwap, useSwapScreen, type Tab } from './state';
import { limitCoin } from './swap-view';
import { SwapTicket, pickInto } from './SwapTicket';
import { BRIDGE, SWAP } from './words';
import s from './swap.module.css';

/** The market's coins under the card: this many, the busiest of the day. */
const POPULAR = 5;

/**
 * The Swap screen as the owner asked for it on 17.11: a swap is a swap. One card in the middle
 * of the screen — the screen's one action panel — and its tabs on it: Swap · Limit · Bridge · Send. Every tab turns in
 * place; none leads to another screen, and none draws a chart: the chart is the coin's own page, a tap away under the
 * card. Under it, the pair's two coins and the market's popular ones, the wallet's own history once a wallet is here,
 * and the agent who would do it every day.
 *
 * Everything under it is the city's logic as it stands — the trade card for the swap and the limit (`city/lib/trade/**`),
 * the money window's bridge, deposit and transfer (`city/lib/money/**`). A path the engine keeps shut is not drawn. A
 * sentence for the agent that leads here fills the card's own fields; the person confirms there.
 */
export function SwapScreen() {
  const w = useWords(SWAP);
  const b = useWords(BRIDGE);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const tab = useSwapScreen((st) => st.tab);
  const moves = flowLive('bridge') || flowLive('deposit');
  const sends = flowLive('send');
  const limits = TICKET_OPEN && SPOT_OPEN;
  // A tab the engine keeps shut leaves the swap in its place.
  const shown: Tab = tab === 'send' && sends ? 'send' : tab === 'bridge' && moves ? 'bridge' : tab === 'limit' && limits ? 'limit' : 'swap';
  // The swap and the limit share one trade card: under a signature, the card keeps its tab.
  const tradeBusy = useTrade(cardBusy);
  const [how, setHow] = useState(false);
  const howId = useId();

  // The money logic follows the wallet: another wallet, or none, and the last one's state goes.
  useEffect(() => useMoneyStore.getState().follow(owner), [owner]);
  // A transfer out still on its way is followed again whenever the screen opens.
  useEffect(() => {
    if (owner) void useMoneyStore.getState().followOrder();
  }, [owner]);
  // What ends on this screen — a swap, a transfer, a bridge — shows in «Recent» at once.
  useEffect(() => {
    const read = () => void useMoneyStore.getState().readActivity();
    const offTrade = useTrade.subscribe((card, before) => {
      if (card.phase !== before.phase && (card.phase === 'done' || card.phase === 'failed')) read();
    });
    const offMoney = useMoneyStore.subscribe((now, before) => {
      if ((now.send.settled && !before.send.settled) || (now.bridge.receipt && !before.bridge.receipt)) read();
    });
    return () => {
      offTrade();
      offMoney();
    };
  }, []);

  // A sentence handed to this screen fills its own fields; nothing is ordered or signed.
  useAskHere((ask) => run(ask.command, swapDoors()));
  useTabInAddress(shown);

  const tabs: TabItem<Tab>[] = [
    { id: 'swap', label: w.tabSwap },
    ...(limits ? [{ id: 'limit' as const, label: w.tabLimit }] : []),
    ...(moves ? [{ id: 'bridge' as const, label: w.tabBridge }] : []),
    ...(sends ? [{ id: 'send' as const, label: w.tabSend }] : []),
  ];
  const pick = (id: Tab) => {
    if (id === shown) return;
    if (tradeBusy && (id === 'limit' || shown === 'limit')) return;
    setHow(false);
    if (id === 'swap') return showSwap();
    if (id === 'limit') return limitNow();
    showMoney(id, id === 'bridge' ? useSwapScreen.getState().way : undefined);
  };
  const topUp = moves && flowLive('deposit') ? () => showMoney('bridge', 'in') : undefined;

  return (
    <div className={s.stage}>
      <h1 className={s.screenName}>{w.title}</h1>
      <Panel tone="hi" pad="l" gap={12} edge label={w.title} className={s.card}>
        <div className={s.cardHead}>
          {tabs.length > 1 ? <Tabs items={tabs} value={shown} onChange={pick} label={w.tabs} className={s.cardTabs} /> : <span className={s.cardName}>{w.swap}</span>}
          {shown === 'bridge' ? <ExplainButton label={b.how} open={how} controls={howId} onToggle={() => setHow((was) => !was)} /> : null}
        </div>
        <div role="tabpanel" aria-label={tabs.find((item) => item.id === shown)?.label ?? w.swap} className={s.cardBody}>
          {/* The swap keeps its place while the bridge or a transfer is in front; the limit takes the trade card itself. */}
          {TICKET_OPEN && shown !== 'limit' ? (
            <div className={s.slot} hidden={shown !== 'swap'}>
              <SwapTicket onTopUp={topUp} />
            </div>
          ) : null}
          {shown === 'limit' ? <LimitTab onTopUp={topUp} /> : null}
          {shown === 'bridge' ? <BridgePanel bare how={how} howId={howId} /> : null}
          {shown === 'send' ? <SendPanel bare /> : null}
        </div>
      </Panel>
      {shown === 'swap' || shown === 'limit' ? <Under tab={shown} /> : null}
      {owner ? <Recent edge /> : null}
      <AgentCard tab={shown} />
    </div>
  );
}

/**
 * The Limit tab on the pair the person was looking at, as the trade card holds it now: the swap's coin that is not a
 * dollar (`limitCoin`), on the swap's own side of it — selling SOL for USDC is a limit to sell SOL.
 */
function limitNow(): void {
  const card = useTrade.getState();
  const subject = useSwapScreen.getState().subject;
  const tower = card.view === 'swap' && card.tower ? card.tower : { mint: subject.id, symbol: subject.symbol, name: subject.name, icon: subject.icon };
  const side: Side = card.view === 'swap' ? card.side : useSwapScreen.getState().side;
  const choice = choiceOf(tower, side, useWallet.getState().holdings, { pay: card.pay, typed: card.typed, other: card.other });
  const coin = limitCoin({ mint: tower.mint, symbol: bare(tower.symbol), decimals: null, name: tower.name, icon: tower.icon }, choice.pay);
  // The limit's coin is the swap's own, or the coin it was paid with: then buying the one is selling the other, and
  // what pays on the limit is the swap's own coin (a dollar — `limitCoin` takes the counter only for one).
  const own = coin.mint === tower.mint;
  const limitSide: Side = own ? side : side === 'buy' ? 'sell' : 'buy';
  const pay = own ? payKey(choice.pay) : payKey(USDC);
  showLimit({ id: coin.mint, symbol: coin.symbol, name: coin.name ?? coin.symbol, icon: coin.icon ?? null }, limitSide, pay);
}

/**
 * The tab in the address: `/swap?tab=limit` opens the card on it, and every turn writes it back in place — no step in the
 * history, so «Back» leaves the screen as it always did.
 */
function useTabInAddress(shown: Tab): void {
  useEffect(() => {
    const named = arrivalOf(new URLSearchParams(window.location.search).get('tab'), useSwapScreen.getState().tab);
    if (!named) return;
    if (named === 'swap') showSwap();
    else if (named === 'limit') limitNow();
    else showMoney(named, named === 'bridge' ? useSwapScreen.getState().way : undefined);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (shown === 'swap') url.searchParams.delete('tab');
    else url.searchParams.set('tab', shown);
    // `null` lets the router take the address in as its own (Next's own advice for `replaceState`).
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  }, [shown]);
}

/** The ticket's two coins as the card stands now: what pays and what comes — of the swap, or of the limit's coin. */
function usePair(tab: 'swap' | 'limit'): readonly string[] {
  const subject = useSwapScreen((st) => st.subject);
  const limit = useSwapScreen((st) => st.limit);
  const tower = useTrade((st) => st.tower);
  const view = useTrade((st) => st.view);
  const side = useTrade((st) => st.side);
  const pay = useTrade((st) => st.pay);
  const other = useTrade((st) => st.other);
  const holdings = useWallet((st) => st.holdings);
  return useMemo(() => {
    const onCard = tower && (tab === 'swap' ? view === 'swap' : view !== 'swap') ? tower : null;
    const named = tab === 'swap' ? subject : limit;
    const coin = onCard ?? { mint: named.id, symbol: named.symbol, name: named.name, icon: named.icon };
    const counter: PayAsset = choiceOf(coin, side, holdings, { pay, typed: '', other }).pay;
    const pair = side === 'buy' ? [counter.mint, coin.mint] : [coin.mint, counter.mint];
    return pair[0] === pair[1] ? [coin.mint] : pair;
  }, [tab, tower, view, subject, limit, side, pay, other, holdings]);
}

/**
 * Under the card: the pair's two coins with the price and the day's move — a tap opens the coin's own page, where its
 * chart is — and the market's popular coins, a tap putting one on the card. Only what the engine read is drawn: a coin
 * the market does not list has no tile.
 */
function Under({ tab }: { tab: 'swap' | 'limit' }) {
  const w = useWords(SWAP);
  const lang = useLang();
  const towers = useMarket().towers;
  const pair = usePair(tab);
  const byMint = useMemo(() => new Map(towers.map((tower) => [tower.id, tower])), [towers]);
  const tiles = pair.flatMap((mint) => {
    const tower = byMint.get(mint);
    return tower && !tower.unread?.includes('price') ? [tower] : [];
  });
  const popular = useMemo(
    () =>
      towers
        .filter((tower) => tower.verified && !isBase({ mint: tower.id }) && tower.id !== USDC.mint && !tower.unread?.includes('price') && !pair.includes(tower.id))
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, POPULAR),
    [towers, pair],
  );
  // A popular coin is one to get: on the swap it goes into «You get» as a pick from that field would put it; on the
  // limit it is the coin to buy at a price.
  const put = (tower: Tower) => {
    const icon = tower.icon ? `/api/icon/${tower.id}` : null;
    if (tab === 'limit') return showLimit({ id: tower.id, symbol: bare(tower.symbol), name: tower.name, icon }, 'buy');
    pickInto('get', { mint: tower.id, symbol: bare(tower.symbol), decimals: null, name: tower.name, verified: tower.verified, icon });
  };
  return (
    <>
      {tiles.length ? (
        <div className={s.tiles} data-count={tiles.length}>
          {tiles.map((tower) => (
            <Link key={tower.id} href={coinHref(tower.id, 'live')} className={s.tile} aria-label={w.openCoin(bare(tower.symbol))}>
              <CoinLogo src={logoOf(tower)} symbol={bare(tower.symbol)} size="m" />
              <span className={s.tileName}>
                <b>
                  {bare(tower.symbol)}
                  <Icon name="arrow" size="s" className={s.tileGo} />
                </b>
                <span>{nameOf(tower)}</span>
              </span>
              <span className={s.tileFigures}>
                <b>{priceText(tower.price, lang)}</b>
                {tower.unread?.includes('change24h') ? null : (
                  <span data-tone={changeTone(tower.change24h)}>
                    {changeText(tower.change24h, lang)} <i>{w.day}</i>
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
      {popular.length ? (
        <section className={s.popular} aria-label={w.popular}>
          <h2 className={s.popularHead}>{w.popular}</h2>
          <ul className={s.popularRows}>
            {popular.map((tower) => (
              <li key={tower.id}>
                <button type="button" className={s.popularRow} onClick={() => put(tower)} aria-label={tab === 'limit' ? w.limitOn(bare(tower.symbol)) : w.swapTo(bare(tower.symbol))}>
                  <CoinLogo src={logoOf(tower)} symbol={bare(tower.symbol)} size="s" />
                  <b>{bare(tower.symbol)}</b>
                  <span className={s.popularPrice}>{priceText(tower.price, lang)}</span>
                  <span className={s.popularChange} data-tone={tower.unread?.includes('change24h') ? undefined : changeTone(tower.change24h)}>
                    {tower.unread?.includes('change24h') ? '—' : changeText(tower.change24h, lang)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** A coin's name as people say it: the market lists SOL by its wrapped mint's name. */
function nameOf(tower: Tower): string {
  return tower.id === SOL.mint ? 'Solana' : tower.name;
}

/** A market coin's logo: the engine's picture through the logo proxy; USDC its own. */
function logoOf(tower: Tower): string | null {
  if (tower.id === USDC.mint) return iconOf(USDC);
  return tower.icon ? `/api/icon/${tower.id}` : null;
}

/** The card's coin that is not a dollar or SOL — the one an agent is about: the swap's, or the limit's on its tab. */
function useTicketCoin(tab: Tab): Readonly<{ mint: string; symbol: string }> | null {
  const subject = useSwapScreen((st) => (tab === 'limit' ? st.limit : st.subject));
  const card = useTrade((st) => (st.view === 'swap' && tab !== 'limit' ? st.tower : null));
  const pay = useTrade((st) => st.pay);
  const side = useTrade((st) => st.side);
  const holdings = useWallet((st) => st.holdings);
  return useMemo(() => {
    const tower = card ?? { mint: subject.id, symbol: subject.symbol, name: subject.name, icon: subject.icon };
    const counter = choiceOf(tower, side, holdings, { pay, typed: '' }).pay;
    const asset = limitCoin({ mint: tower.mint, symbol: bare(tower.symbol), decimals: null, name: tower.name, icon: tower.icon }, counter);
    return { mint: asset.mint, symbol: asset.symbol };
  }, [card, subject, side, holdings, pay]);
}

/**
 * «Hand it to the agent»: the ticket's coin as the agent's own sentence — a budget a day and one signature. Shown only
 * where the agent's trading is open and the agent's reader takes the sentence; a tap says it, it never signs.
 */
function AgentCard({ tab }: { tab: Tab }) {
  const w = useWords(SWAP);
  const say = useSay();
  const towers = useMarket().towers;
  const coin = useTicketCoin(tab);
  const book = useMemo(() => bookOf(towers), [towers]);
  const open = useMemo(() => gatesFor(shelfOn, engineGates()).agentTrade, []);
  // A dollar or SOL on the ticket: the agent's own first coin of the market (the city's first sentence's).
  const symbol = coin && !isBase({ mint: coin.mint }) ? coin.symbol : (sayCoin(book)?.symbol ?? null);
  const sentence = symbol ? w.agentSay(symbol) : null;
  const taken = useMemo(() => open && sentence !== null && readAsk(sentence, book)?.kind === 'trade', [open, sentence, book]);
  if (!taken || !sentence) return null;
  return (
    <Panel pad="m" edge label={w.agentTitle} className={s.agent}>
      <span className={s.agentSign} aria-hidden="true">
        <Icon name="agents" size="m" />
      </span>
      <span className={s.agentWords}>
        <b>{w.agentTitle}</b>
        <span>«{sentence}»</span>
      </span>
      <Quiet onClick={() => void say(sentence)} className={s.agentGo}>
        {w.agentGo}
      </Quiet>
    </Panel>
  );
}
