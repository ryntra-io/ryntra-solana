'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { run } from '@/city/lib/command/run';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { flowLive } from '@/city/lib/money/flag';
import { useMoneyStore } from '@/city/lib/money/store';
import { choiceOf, useTrade, type CoinRef } from '@/city/lib/trade/store';
import { SOL, USDC, type PayAsset } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { spotIcon } from '@/city/lib/search/rank';
import { readCoinFacts } from '@/city/lib/search/sources';
import { TICKET_OPEN, iconOf } from '@/terminal/coin/Ticket';
import { MONEY, payLogo } from '@/terminal/coin/staples';
import { bare } from '@/terminal/coin/parts';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { ActionBody, CoinLogo, Icon, Page, PageHead, Panel, changeText, changeTone, priceText } from '@/terminal/ui';
import { swapDoors, type Place } from './doors';
import { lookalikeOf } from '@/lib/world/text-safety/lookalike';
import { BRIDGE_PATH, FILL_LIFE_MS, SOL_REF, addFill, sayTrade, showMoney, useSwapScreen } from './state';
import { leaveOf, pairOfLink } from './swap-view';
import { Recent } from './Recent';
import { SwapTicket } from './SwapTicket';
import { useDepthCoins } from './useDepthCoins';
import { useLeave } from './useLeave';
import { SWAP } from './words';
import s from './swap.module.css';

/**
 * The Swap screen as the owner asked for it on 17.11 at night, on the one page every section shares: the section's name at the head, the big form — the
 * screen's one action panel, any coin for any coin — in the page's action column, and beside it the pair's two coins
 * and the recent swaps. No tabs: a limit is the coin's own page (the spot), the bridge has its page (`/bridge`), a
 * transfer stands in the Portfolio. No chart: that is the coin's page too, a tap away on the pair's two tiles.
 *
 * Everything under it is the city's logic as it stands — the trade card (`city/lib/trade/**`). A sentence for the agent
 * that leads here fills the form's own fields; the person confirms there. A sentence about the bridge or a transfer
 * leads on to its page in one step.
 */
export function SwapScreen() {
  const w = useWords(SWAP);
  const go = useLeave();
  const router = useRouter();
  const deposit = flowLive('deposit');
  // A sentence handed to this screen fills its own fields; nothing is ordered or signed.
  useAskHere((ask) => run(ask.command, swapDoors(Date.now, go)));
  useOldTab(go);
  useLinkPair();
  // No USDC to pay with: the bridge into Solana, a step the person takes — «Back» returns to the swap.
  const topUp = deposit
    ? () => {
        showMoney('bridge', 'in');
        router.push(BRIDGE_PATH);
      }
    : undefined;

  // «Recent» reads this wallet's own ledger: the money logic follows the wallet that is connected.
  const owner = useWallet((st) => st.connection?.address ?? null);
  useEffect(() => useMoneyStore.getState().follow(owner), [owner]);
  // What ends on this screen — a swap, or the top-up's bridge — shows in «Recent» at once.
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

  // One page for every section: the section's name at the head, the form in the action column — the panel
  // says no name of its own —, and beside it the pair's two coins and the recent swaps.
  return (
    <Page>
      <PageHead title={w.title} />
      <ActionBody
        sideLabel={w.side}
        side={
          <>
            <Pair />
            {owner ? <Recent title={w.recent} edge /> : null}
          </>
        }
      >
        <Panel tone="hi" pad="l" gap={16} edge label={w.title} className={s.card}>
          {TICKET_OPEN ? <SwapTicket onTopUp={topUp} /> : null}
        </Panel>
      </ActionBody>
    </Page>
  );
}

/**
 * The old tabs' addresses: `/swap?tab=limit` and `/swap?tab=bridge` are led on by the page itself before
 * anything is drawn; `/swap?tab=send` opens the Portfolio's transfer from here, its panel being the Portfolio's own
 * state. Any other `tab` leaves the address as the plain swap's.
 */
function useOldTab(go: (place: Place) => void): void {
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get('tab');
    if (tab === null) return;
    const leave = leaveOf(tab);
    if (leave === 'send' && flowLive('send')) return go('send');
    if (leave === 'bridge' && (flowLive('bridge') || flowLive('deposit'))) return go('bridge');
    if (leave === 'coin' && shelfOn('market')) return router.replace(coinHref(SOL.mint, 'live'));
    url.searchParams.delete('tab');
    window.history.replaceState(null, '', url);
  }, [go, router]);
}

/** A coin a link names, as the screen opens on it: SOL, USDC and USDT by heart, any other coin as the engine names it. */
async function coinOfMint(mint: string): Promise<CoinRef | null> {
  if (mint === SOL.mint) return SOL_REF;
  const money = MONEY.find((asset) => asset.mint === mint);
  if (money) return { id: mint, symbol: money.symbol, name: money.name ?? money.symbol, icon: payLogo(money) };
  const facts = await readCoinFacts(mint);
  // A coin whose ticker passes for a known coin's on another mint is not opened by a link: the search would not offer it.
  if (!facts || lookalikeOf(facts.symbol, mint)) return null;
  return { id: mint, symbol: facts.symbol, name: facts.name, icon: facts.icon };
}

/**
 * The pair a link names: `/swap?from=USDC&to=<mint>` opens the form on it — through the screen's own
 * fill, as a sentence for the agent would; nothing is ordered. A coin that pays beyond SOL and USDC is picked once the
 * card stands on the pair's coin. A link that names no pair leaves the form as it was.
 */
function useLinkPair(): void {
  useEffect(() => {
    const url = new URL(window.location.href);
    const pair = pairOfLink(url.searchParams.get('from'), url.searchParams.get('to'));
    if (!pair) return;
    let live = true;
    let off: (() => void) | null = null;
    let expire: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      const [coin, counter] = await Promise.all([coinOfMint(pair.subject), pair.counter ? coinOfMint(pair.counter) : Promise.resolve(null)]);
      if (!live || !coin) return;
      sayTrade(coin, pair.side, Date.now());
      if (!counter) return;
      if (counter.id === SOL.mint || counter.id === USDC.mint) return addFill({ pay: counter.id === SOL.mint ? 'SOL' : 'USDC' });
      const asset: PayAsset = { mint: counter.id, symbol: bare(counter.symbol), decimals: MONEY.find((money) => money.mint === counter.id)?.decimals ?? null, name: counter.name, icon: counter.icon };
      let done = false;
      const put = () => {
        if (done) return true;
        const card = useTrade.getState();
        if (!card.open || card.view !== 'swap' || card.tower?.mint !== coin.id || card.phase !== 'idle') return false;
        done = true;
        card.pickCoin(asset);
        return true;
      };
      if (put()) return;
      off = useTrade.subscribe(() => {
        if (put()) off?.();
      });
      // The coin that pays waits for the card a minute at most, as a sentence's fill does.
      expire = setTimeout(() => off?.(), FILL_LIFE_MS);
    })();
    return () => {
      live = false;
      off?.();
      if (expire) clearTimeout(expire);
    };
  }, []);
}

/** The form's two coins as it stands now: what pays and what comes. */
function usePair(): readonly string[] {
  const subject = useSwapScreen((st) => st.subject);
  const tower = useTrade((st) => (st.view === 'swap' ? st.tower : null));
  const side = useTrade((st) => st.side);
  const pay = useTrade((st) => st.pay);
  const other = useTrade((st) => st.other);
  const holdings = useWallet((st) => st.holdings);
  return useMemo(() => {
    const coin = tower ?? { mint: subject.id, symbol: subject.symbol, name: subject.name, icon: subject.icon };
    const counter: PayAsset = choiceOf(coin, side, holdings, { pay, typed: '', other }).pay;
    const pair = side === 'buy' ? [counter.mint, coin.mint] : [coin.mint, counter.mint];
    return pair[0] === pair[1] ? [coin.mint] : pair;
  }, [tower, subject, side, pay, other, holdings]);
}

/** One tile of the pair: the coin, its price and the day's move — all as the engine read them. */
type PairTile = Readonly<{ mint: string; symbol: string; name: string; logo: string | null; price: number; change: number | null }>;

/**
 * Beside the form: the pair's two coins, whatever the pair — the logo, the price and the day's move, a tap away from
 * the coin's own page (the spot), where its chart and its limit are. The figures are the engine's market read by mint
 * (`/api/v1/market/depth`), the city's towers until it answers. A coin nobody priced has no tile.
 */
function Pair() {
  const w = useWords(SWAP);
  const lang = useLang();
  const towers = useMarket().towers;
  const pair = usePair();
  const depth = useDepthCoins(pair, true);
  const byMint = useMemo(() => new Map(towers.map((tower) => [tower.id, tower])), [towers]);
  const tiles = pair.flatMap((mint): PairTile[] => {
    const coin = depth.get(mint);
    if (coin && coin.price !== null) {
      const symbol = bare(coin.symbol);
      return [{ mint, symbol, name: mint === SOL.mint ? 'Solana' : coin.name, logo: logoOf(mint, spotIcon(mint, coin.icon)), price: coin.price, change: coin.stats['24h']?.change ?? null }];
    }
    const tower = byMint.get(mint);
    if (!tower || tower.unread?.includes('price')) return [];
    return [{ mint, symbol: bare(tower.symbol), name: mint === SOL.mint ? 'Solana' : tower.name, logo: logoOf(mint, spotIcon(mint, tower.icon)), price: tower.price, change: tower.unread?.includes('change24h') ? null : tower.change24h }];
  });
  if (!tiles.length) return null;
  return (
    <div className={s.tiles} data-side="">
      {tiles.map((tile) => (
        <Link key={tile.mint} href={coinHref(tile.mint, 'live')} className={s.tile} aria-label={w.openCoin(tile.symbol)} data-swap-pair={tile.symbol}>
          <CoinLogo src={tile.logo} symbol={tile.symbol} size="m" />
          <span className={s.tileName}>
            <b>
              {tile.symbol}
              <Icon name="arrow" size="s" className={s.tileGo} />
            </b>
            <span>{tile.name}</span>
          </span>
          <span className={s.tileFigures}>
            <b>{priceText(tile.price, lang)}</b>
            {tile.change === null ? null : (
              <span data-tone={changeTone(tile.change)}>
                {changeText(tile.change, lang)} <i>{w.day}</i>
              </span>
            )}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** A coin's logo: USDC its own; any other the engine's picture through the logo proxy. */
function logoOf(mint: string, proxied: string | null): string | null {
  return mint === USDC.mint ? iconOf(USDC) : proxied;
}
