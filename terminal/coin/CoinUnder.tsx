'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MINE, TRADE } from '@/city/components/trade/words';
import { useEntry } from '@/city/lib/chart/use-chart';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { formatUnits } from '@/city/lib/trade/format';
import { SPOT_OPEN } from '@/city/lib/trade/gates';
import type { LimitOrderView } from '@/city/lib/trade/limits';
import type { Market } from '@/city/lib/trade/pro-ladder';
import { formatPct } from '@/city/lib/trade/mine';
import { OPEN_ORDER_STATES, orderRow, sortOrders, stopRow } from '@/city/lib/trade/orders-view';
import { proveWallet } from '@/city/lib/trade/proof';
import { ownOrders, useSpot } from '@/city/lib/trade/spot-store';
import type { Stop } from '@/city/lib/trade/stops';
import { balanceOf } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { useLadder } from '@/city/lib/trade/pro-store';
import { Cell, CoinCell, Quiet, Table, TableHead, TableRow, Tabs, changeTone, coinIcon, priceText } from '@/terminal/ui';
import { coinName } from '@/terminal/market/market-view';
import { positionOf, signedUsd, tradesOf, type OwnTrade } from './coin-view';
import { LadderOrders, useLadderCount } from './ladder/LadderOrders';
import { CoinPools, CoinPositions } from './earn-here/EarnHere';
import { EARN_HERE } from './earn-here/words';
import { TapeBox } from './MarketTabs';
import { bare } from './parts';
import { DESK } from './desk-words';
import { COIN } from './words';
import u from './coin.module.css';

/**
 * What the bottom panel shows: the person's own — the position, the orders, the history of their trades through Ryntra —
 * and the market's — its trades, its holders, its traders. With a wallet the panel opens on the person's own,
 * without one on the market's; a desk too narrow for the trades column has the column's two tabs here too.
 */
export type UnderTab = 'position' | 'orders' | 'trades' | 'market' | 'holders' | 'traders' | 'depth' | EarnTab | MoreTab;

/**
 * Liquidity under the chart — the coin's pools, and with a wallet the person's own positions in them («My
 * pools»). `earn` says which the panel offers: both on a desk; on a phone only «My pools», the pools being a view of
 * their own there.
 */
export type EarnTab = 'pools' | 'lp';

/** The tabs a screen brings with what they draw — the coin's creator and its largest holders' links. */
export type MoreTab = 'creator' | 'links';
export type MoreTabSpec = Readonly<{ id: MoreTab; label: string; draw: () => ReactNode }>;

const NO_STOPS: readonly Stop[] = [];
const POSITION_COLUMNS = 'minmax(150px, 1.4fr) repeat(4, minmax(84px, 1fr)) 96px';
const ORDER_COLUMNS = 'minmax(150px, 1.3fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(96px, auto)';
const TRADE_COLUMNS = 'minmax(110px, 1fr) minmax(130px, 1.2fr) repeat(3, minmax(90px, 1fr))';
/*
 * Under the chart of a tablet the panel is narrow: each table lets its quieter columns go a step at a time —
 * the position its entry and price, then its amount; an order its amount, then its price; a trade its date, then its
 * amount — and the row's action stays whole inside the panel.
 */
const POSITION_FOLD = ['minmax(150px, 1.4fr) repeat(2, minmax(84px, 1fr)) 96px', 'minmax(96px, 1fr) minmax(72px, 1fr) auto'] as const;
const ORDER_FOLD = ['minmax(150px, 1.3fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(96px, auto)', 'minmax(88px, 1fr) minmax(80px, 1fr) auto'] as const;
const TRADE_FOLD = ['minmax(110px, 1fr) repeat(3, minmax(90px, 1fr))', 'minmax(80px, 1fr) repeat(2, minmax(72px, 1fr))'] as const;

/** The stops that still wait or have just been reached: what «Orders» counts beside the open limit orders. */
const liveStop = (view: string) => view === 'watching' || view === 'reached';

/**
 * Under the chart: what the engine says of the person's own in this coin — the position the wallet holds, its limit
 * orders and stops (where the engine keeps them open), and its trades through Ryntra — and of the market: the coin's
 * trades as they come, its largest holders and who traded it most. Each tab says one calm line when it has
 * nothing to show. Nothing here is drawn that the engine does not give.
 *
 * `market`, `holders`, `traders` and `depth` are drawn by the screen (`render`): the tables of the market's own read.
 */
export function CoinUnder({ coin, logo, price, tab, onTab, onSell, market, extra = [], more = [], earn = 'all', onPools }: { coin: Tower; logo: string | null; price: number | null; tab: UnderTab; onTab: (tab: UnderTab) => void; onSell: () => void; market: (tab: 'market' | 'holders' | 'traders' | 'depth') => ReactNode; extra?: readonly ('market' | 'depth')[]; more?: readonly MoreTabSpec[]; earn?: 'all' | 'mine'; onPools?: () => void }) {
  const w = useWords(COIN);
  const d = useWords(DESK);
  const lw = useWords(EARN_HERE);
  const address = useWallet((st) => st.connection?.address ?? null);
  const orders = useSpot((st) => ownOrders(st.orders, address));
  const stops = useSpot((st) => (st.stopsOwner === address ? st.stops : NO_STOPS));
  const [now, setNow] = useState(() => Date.now());

  // The orders of this wallet: read when the screen opens on it, and again for another wallet.
  useEffect(() => {
    if (!SPOT_OPEN || !address) return;
    void useSpot.getState().readOrders();
    useSpot.getState().loadStops();
    setNow(Date.now());
  }, [address]);

  const mine = useMemo(() => (orders?.list ?? []).filter((order) => order.baseMint === coin.id), [orders, coin.id]);
  const mineStops = useMemo(() => stops.filter((stop) => stop.base.mint === coin.id), [stops, coin.id]);
  // `w` stands for the language: a switch writes the rows again in it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stopRows = useMemo(() => mineStops.map((stop) => stopRow(stop, now)), [mineStops, now, w]);
  // The coin's ladders in its DLMM Pro pool, where the ticket offers them (`ladder/LadderOrders.tsx`).
  const ladder = useLadder((st) => (st.mint === coin.id && st.market.status === 'ready' ? st.market.value : null));
  const ladders = useLadderCount(coin.id);
  const live = mine.filter((order) => OPEN_ORDER_STATES.has(order.state) || order.canClaim).length + stopRows.filter((row) => liveStop(row.view)).length + ladders;
  const ordersHere = SPOT_OPEN || ladder !== null;

  const own = address
    ? [
        { id: 'position' as const, label: w.position },
        { id: 'lp' as const, label: lw.myPools },
        ...(ordersHere ? [{ id: 'orders' as const, label: w.orders, ...(live ? { count: String(live) } : {}) }] : []),
        { id: 'trades' as const, label: d.history },
      ]
    : [];
  const marketTabs = [
    ...(extra.includes('market') || !address ? [{ id: 'market' as const, label: d.marketTrades }] : []),
    ...(extra.includes('depth') ? [{ id: 'depth' as const, label: d.tapeDepth }] : []),
    ...(earn === 'all' ? [{ id: 'pools' as const, label: lw.pools }] : []),
    { id: 'holders' as const, label: d.holdersTab },
    { id: 'traders' as const, label: d.tradersTab },
    ...more.map(({ id, label }) => ({ id, label })),
  ];
  const tabs = [...own, ...marketTabs];
  // A tab that is not on the panel now (the wallet left, the orders shut) gives way to the panel's first.
  const shown: UnderTab = tabs.some((item) => item.id === tab) && !(tab === 'orders' && !ordersHere) ? tab : tabs[0]!.id;

  return (
    <>
      <div className={u.underHead}>
        <Tabs bare label={w.under} value={shown} onChange={onTab} items={tabs} />
      </div>
      <TapeBox className={u.underBody}>
        {shown === 'position' ? (
          <PositionTab coin={coin} logo={logo} price={price} onSell={onSell} />
        ) : shown === 'orders' ? (
          <OrdersTab coin={coin} ladder={ladder} ladders={ladders} orders={mine} stops={mineStops} stopRows={stopRows} reading={Boolean(address) && (!orders || (orders.status === 'reading' && orders.at === null))} failed={orders?.status === 'failed'} tokens={orders?.tokens ?? {}} />
        ) : shown === 'trades' ? (
          <TradesTab coin={coin} />
        ) : shown === 'pools' ? (
          <CoinPools mint={coin.id} sym={bare(coin.symbol)} />
        ) : shown === 'lp' ? (
          <CoinPositions mint={coin.id} sym={bare(coin.symbol)} onPools={onPools ?? (() => onTab('pools'))} phone={earn === 'mine'} />
        ) : shown === 'creator' || shown === 'links' ? (
          more.find((item) => item.id === shown)?.draw()
        ) : (
          market(shown)
        )}
      </TapeBox>
    </>
  );
}

/** One calm line where a tab has nothing to show. */
function Line({ children }: { children: ReactNode }) {
  return (
    <p className={u.underLine} role="status">
      {children}
    </p>
  );
}

function PositionTab({ coin, logo, price, onSell }: { coin: Tower; logo: string | null; price: number | null; onSell: () => void }) {
  const w = useWords(COIN);
  const lang = useLang();
  const connected = useWallet((st) => Boolean(st.connection));
  const holdings = useWallet((st) => st.holdings);
  const entry = useEntry(coin);
  const sym = bare(coin.symbol);
  if (!connected) return <Line>{w.connectForPosition}</Line>;
  if (!holdings) return <Line>{w.readingWallet}</Line>;
  const position = positionOf(balanceOf(holdings, coin.id), price, entry);
  if (!position) return <Line>{w.noPosition(sym)}</Line>;
  return (
    <Table columns={POSITION_COLUMNS} fold={POSITION_FOLD} minWidth={640} label={w.position}>
      <TableHead>
        <Cell head>{w.colCoin}</Cell>
        <Cell head end fold={2}>
          {w.colAmount}
        </Cell>
        <Cell head end fold={1}>
          {w.colEntry}
        </Cell>
        <Cell head end fold={1}>
          {w.colNow}
        </Cell>
        <Cell head end>
          {w.colResult}
        </Cell>
        <Cell head />
      </TableHead>
      <TableRow>
        <CoinCell icon={logo ?? coinIcon(coin)} symbol={sym} name={coinName(coin)} />
        <Cell end fold={2}>
          {digits(formatUnits(position.amountRaw, position.decimals, 'down'), lang)}
        </Cell>
        <Cell end fold={1}>
          {position.entry !== null ? priceText(position.entry, lang) : '—'}
        </Cell>
        <Cell end fold={1}>
          {price !== null ? priceText(price, lang) : '—'}
        </Cell>
        <Cell end tone={position.resultUsd !== null ? changeTone(position.resultUsd) : undefined}>
          {position.resultUsd !== null ? digits(signedUsd(position.resultUsd), lang) : '—'}
        </Cell>
        <Cell end className={u.act}>
          <Quiet size="s" aria-label={w.sellCoin(sym)} onClick={onSell}>
            {w.sell}
          </Quiet>
        </Cell>
      </TableRow>
    </Table>
  );
}

function OrdersTab({
  coin,
  ladder,
  ladders,
  orders,
  stops,
  stopRows,
  reading,
  failed,
  tokens,
}: {
  coin: Tower;
  ladder: Market | null;
  ladders: number;
  orders: readonly LimitOrderView[];
  stops: readonly Stop[];
  stopRows: readonly ReturnType<typeof stopRow>[];
  reading: boolean;
  failed: boolean;
  tokens: Parameters<typeof orderRow>[1];
}) {
  const w = useWords(COIN);
  const m = useWords(MINE);
  const t = useWords(TRADE);
  const lang = useLang();
  const connected = useWallet((st) => Boolean(st.connection));
  const cancelling = useSpot((st) => st.cancelling);
  const notice = useSpot((st) => st.ordersNotice);
  const sorted = useMemo(() => sortOrders(orders), [orders]);
  const sym = bare(coin.symbol);
  if (!connected) return <Line>{w.connectForOrders}</Line>;
  const ladderTable = ladder && ladders ? <LadderOrders market={ladder} symbol={coin.symbol} /> : null;
  // Without Jupiter's limits here, the tab is the coin's ladders alone.
  if (!SPOT_OPEN) return ladderTable ?? <Line>{w.noOrders(sym)}</Line>;
  if (reading) return ladderTable ?? <Line>{w.readingOrders}</Line>;
  const rows = [...sorted.open, ...sorted.closed];
  // Only ladders here: Jupiter's last word (a cancel's result, a read that failed) still stands over them.
  if (!rows.length && !stopRows.length && ladderTable) {
    const said = notice ? { tone: notice.tone, text: notice.text } : failed ? { tone: 'error', text: w.ordersUnavailable } : null;
    return (
      <>
        {said ? (
          <p className={u.underNote} data-tone={said.tone} role={said.tone === 'error' ? 'alert' : 'status'}>
            {said.text}
          </p>
        ) : null}
        {ladderTable}
      </>
    );
  }
  if (failed && !rows.length && !stopRows.length) {
    return (
      <Line>
        {w.ordersUnavailable}
        <Quiet size="s" onClick={() => void useSpot.getState().readOrders(true)}>
          {w.again}
        </Quiet>
      </Line>
    );
  }
  if (!rows.length && !stopRows.length) return <Line>{w.noOrders(sym)}</Line>;
  const cancel = (order: LimitOrderView) => void useSpot.getState().cancelOrder({ key: order.key, venue: order.venue, order: order.order });
  return (
    <>
      {ladderTable}
      {notice ? (
        <p className={u.underNote} data-tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : null}
      <Table columns={ORDER_COLUMNS} fold={ORDER_FOLD} minWidth={640} label={w.orders}>
        <TableHead>
          <Cell head>{w.colOrder}</Cell>
          <Cell head end fold={1}>
            {w.colAmount}
          </Cell>
          <Cell head end fold={2}>
            {w.colPrice}
          </Cell>
          <Cell head end>
            {w.colState}
          </Cell>
          <Cell head />
        </TableHead>
        {stopRows.map((row) => {
          const stop = stops.find((item) => item.id === row.id);
          const waiting = liveStop(row.view);
          return (
            <TableRow key={row.id}>
              <Cell tone={row.side === 'buy' ? 'up' : 'down'}>{m.stop}</Cell>
              <Cell end fold={1}>
                {digits(row.spends, lang)}
              </Cell>
              <Cell end fold={2}>{`${row.side === 'sell' ? '≤' : '≥'} ${digits(row.price, lang)} ${bare(row.unit)}`}</Cell>
              <Cell end tone={row.tone === 'done' ? 'up' : row.tone === 'quiet' ? 'dim' : undefined}>
                {row.state}
              </Cell>
              <Cell end className={u.act}>
                {row.view === 'reached' && stop ? (
                  <Quiet size="s" aria-label={m.checkOf(row.side === 'sell', sym)} onClick={() => useSpot.getState().openSale(stop)}>
                    {m.check}
                  </Quiet>
                ) : null}
                <Quiet size="s" aria-label={waiting ? m.cancelStopOn(sym) : m.removeStopOn(sym)} onClick={() => void useSpot.getState().cancelStop(row.id)}>
                  {waiting ? m.cancel : m.remove}
                </Quiet>
              </Cell>
            </TableRow>
          );
        })}
        {rows.map((order) => {
          const row = orderRow(order, tokens);
          const busy = cancelling?.key === order.key ? cancelling.phase : null;
          return (
            <TableRow key={row.key}>
              <Cell tone={row.side === 'buy' ? 'up' : 'down'}>{`${row.side === 'buy' ? m.sideBuy : m.sideSell} · ${t.limit}`}</Cell>
              <Cell end fold={1}>
                {row.amount === null ? '—' : `${digits(row.amount, lang)} ${bare(row.coin)}`}
              </Cell>
              <Cell end fold={2}>
                {row.price === null ? '—' : `${digits(row.price, lang)} ${bare(row.unit)}`}
              </Cell>
              <Cell end tone={row.tone === 'done' ? 'up' : row.tone === 'danger' ? 'down' : row.tone === 'quiet' ? 'dim' : undefined}>
                {row.filledPct !== null ? `${row.state} · ${m.filled(digits(String(row.filledPct), lang))}` : row.state}
              </Cell>
              <Cell end className={u.act}>
                {row.open && (row.canCancel || row.canClaim) ? (
                  <Quiet size="s" disabled={Boolean(cancelling)} aria-label={row.canClaim ? m.takeBackOf(row.side === 'buy', sym) : m.cancelOf(row.side === 'buy', sym)} onClick={() => cancel(order)}>
                    {busy === 'wallet' ? m.sign : busy ? m.wait : row.canClaim ? m.takeBack : m.cancel}
                  </Quiet>
                ) : null}
              </Cell>
            </TableRow>
          );
        })}
      </Table>
    </>
  );
}

type TradesRead =
  | Readonly<{ key: string; status: 'reading' }>
  | Readonly<{ key: string; status: 'proof' }>
  | Readonly<{ key: string; status: 'failed' }>
  | Readonly<{ key: string; status: 'ready'; trades: readonly OwnTrade[] }>;

function TradesTab({ coin }: { coin: Tower }) {
  const w = useWords(COIN);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const address = connection?.address ?? null;
  const key = address ? `${address}|${coin.id}` : null;
  const [read, setRead] = useState<TradesRead | null>(null);
  const [proving, setProving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The wallet's own trades of the coin: the engine's record, readable only behind the wallet's proof. Reading only.
  const latest = useRef(0);
  const load = useCallback(async (owner: string, mint: string) => {
    const at = `${owner}|${mint}`;
    const mine = ++latest.current;
    const land = (next: TradesRead) => {
      if (mine === latest.current) setRead(next);
    };
    land({ key: at, status: 'reading' });
    try {
      const answer = await fetch(`/api/growth/cards?${new URLSearchParams({ address: owner, mint })}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (answer.status === 401) return land({ key: at, status: 'proof' });
      if (!answer.ok) return land({ key: at, status: 'failed' });
      land({ key: at, status: 'ready', trades: tradesOf(await answer.json(), mint) });
    } catch {
      land({ key: at, status: 'failed' });
    }
  }, []);

  useEffect(() => {
    setMessage(null);
    if (address) void load(address, coin.id);
  }, [address, coin.id, load]);

  const sym = bare(coin.symbol);
  if (!connection || !key) return <Line>{w.connectForTrades}</Line>;
  const mine = read && read.key === key ? read : null;
  if (!mine || mine.status === 'reading') return <Line>{w.readingTrades}</Line>;
  if (mine.status === 'proof') {
    // One signed message, no transaction: the wallet proves itself, and the engine shows its trades.
    const prove = async () => {
      setProving(true);
      setMessage(null);
      const proof = await proveWallet(connection);
      setProving(false);
      if (proof.ok) void load(connection.address, coin.id);
      else if (proof.state !== 'declined') setMessage(proof.message);
    };
    return (
      <Line>
        {message ?? w.oneMessage}
        <Quiet size="s" disabled={proving} aria-busy={proving || undefined} onClick={() => void prove()}>
          {w.showTrades}
        </Quiet>
      </Line>
    );
  }
  if (mine.status === 'failed') {
    return (
      <Line>
        {w.tradesUnavailable}
        <Quiet size="s" onClick={() => void load(connection.address, coin.id)}>
          {w.again}
        </Quiet>
      </Line>
    );
  }
  if (!mine.trades.length) return <Line>{w.noTrades(sym)}</Line>;
  return (
    <Table columns={TRADE_COLUMNS} fold={TRADE_FOLD} minWidth={600} label={w.trades}>
      <TableHead>
        <Cell head>{w.colTrade}</Cell>
        <Cell head fold={1}>
          {w.colDate}
        </Cell>
        <Cell head end fold={2}>
          {w.colAmount}
        </Cell>
        <Cell head end>
          {w.colSum}
        </Cell>
        <Cell head end>
          {w.colResult}
        </Cell>
      </TableHead>
      {mine.trades.map((trade) => (
        <TableRow key={trade.key}>
          <Cell tone={trade.side === 'buy' ? 'up' : 'down'}>{trade.side === 'buy' ? w.bought : w.sold}</Cell>
          <Cell tone="dim" fold={1}>
            {dateText(trade.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, lang)}
          </Cell>
          <Cell end fold={2}>{`${digits(formatUnits(trade.quantityRaw, trade.decimals), lang)} ${sym}`}</Cell>
          <Cell end>{trade.usd !== null ? priceText(trade.usd, lang) : '—'}</Cell>
          <Cell end tone={trade.resultPct !== null ? changeTone(trade.resultPct) : undefined}>
            {trade.resultPct !== null ? formatPct(trade.resultPct) : '—'}
          </Cell>
        </TableRow>
      ))}
    </Table>
  );
}
