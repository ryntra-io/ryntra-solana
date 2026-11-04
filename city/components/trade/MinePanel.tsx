'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { isNamed } from '@/city/lib/market/types';
import { openMoney } from '@/city/lib/money/open';
import type { MoneyTab } from '@/city/lib/money/flag';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { openScouts } from '@/city/lib/scouts/store';
import { colourOf } from '@/city/lib/trade/colour';
import { formatUnits, ticker } from '@/city/lib/trade/format';
import { SPOT_OPEN, TRADE_OPEN } from '@/city/lib/trade/gates';
import { formatPct, formatUsd, mineOf, readAge, type CashRow, type MineRow } from '@/city/lib/trade/mine';
import { useMine } from '@/city/lib/trade/mine-store';
import { useSpot } from '@/city/lib/trade/spot-store';
import { stopView } from '@/city/lib/trade/stops';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { FlagGlyph } from '../scouts/glyphs';
import { AgentMine } from '../autopilot/AgentMine';
import { MyOrders } from './MyOrders';
import { MINE } from './words';
import s from './mine.module.css';

/** Balances older than this are read again when the panel opens. */
const STALE_HOLDINGS_MS = 60_000;
/** The ages on the panel move on this often. */
const TICK_MS = 15_000;

/** Topping up and sending open the city's Money window in place of this panel. */
function toMoney(tab: MoneyTab): void {
  useMine.getState().close();
  openMoney(tab);
}

/**
 * «Mine»: the connected wallet's towers in one small panel. Each coin says how much, what it is worth at the city's
 * price, and how it moved — since it was bought when the engine knows what the holding cost, otherwise over 24 hours,
 * said so. One tap sells through the trade card; topping up and sending open the city's Money window. Every figure
 * carries the time it was read. Behind the spot switch, a second list: «My orders» — limit orders and stops.
 */
export function MinePanel() {
  const w = useWords(MINE);
  const connection = useWallet((st) => st.connection);
  const address = connection?.address ?? null;
  const holdings = useWallet((st) => (st.connection && st.holdings?.owner === st.connection.address ? st.holdings : null));
  const holdingsRead = useWallet((st) => st.holdingsRead);
  const snapshot = useCity((st) => st.snapshot);
  const open = useMine((st) => st.open);
  const tab = useMine((st) => (SPOT_OPEN ? st.tab : 'coins'));
  const reachedStops = useSpot((st) => (SPOT_OPEN ? st.stops.filter((stop) => stopView(stop, Date.now()) === 'reached').length : 0));
  const bases = useMine((st) => (st.owner === address ? st.bases : null));
  const status = useMine((st) => (st.owner === address ? st.status : 'none'));
  const message = useMine((st) => st.message);
  const basesAt = useMine((st) => (st.owner === address ? st.at : null));
  const tradeOpen = useTrade((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const wrap = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [about, setAbout] = useState(false);

  const mine = useMemo(() => mineOf(holdings, snapshot.towers, bases ?? undefined), [holdings, snapshot.towers, bases]);
  const held = useMemo(() => mine.rows.map((row) => ({ mint: row.tower.id, balanceRaw: row.amountRaw })), [mine.rows]);
  const heldKey = held.map((coin) => `${coin.mint}:${coin.balanceRaw}`).join(',');

  // Another wallet, or none: what the last one cost goes with it.
  useEffect(() => {
    useMine.getState().reset();
    if (!address) useMine.getState().close();
  }, [address]);

  // Opening the panel reads fresh balances when the last ones are old, and what the coins cost.
  useEffect(() => {
    if (!open || !address) return;
    const wallet = useWallet.getState();
    if (wallet.holdings && Date.now() - wallet.holdings.at > STALE_HOLDINGS_MS) wallet.refreshHoldings();
  }, [open, address]);
  useEffect(() => {
    if (!open || !address || !holdings) return;
    void useMine.getState().readBases(address, held);
    // `heldKey` stands for `held`: a trade that changes a balance asks again, a re-render does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, address, Boolean(holdings), heldKey]);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    const outside = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) useMine.getState().close();
    };
    const key = (event: KeyboardEvent) => event.key === 'Escape' && useMine.getState().close();
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  // The trade card takes the corner: the panel steps aside while it is open.
  useEffect(() => {
    if (tradeOpen) useMine.getState().close();
  }, [tradeOpen]);

  if (!connection || running || filming) return null;
  const colour = colourOf(connection.address);
  const count = mine.rows.length;

  const sell = (row: MineRow) => {
    useMine.getState().close();
    useCity.getState().select(row.tower.id);
    useTrade.getState().openFor(row.tower, 'sell');
  };
  const fly = (row: MineRow) => {
    useMine.getState().close();
    useCity.getState().select(row.tower.id);
  };

  const notes = [
    count > 0 && !holdings?.complete ? w.someMissing : null,
    mine.elsewhere > 0 ? w.elsewhere(mine.elsewhere) : null,
    mine.unvalued > 0 ? w.unvalued(mine.unvalued) : null,
  ].filter((note): note is string => note !== null);
  const pricesLive = snapshot.source === 'live';
  const pricesAt = new Date(snapshot.fetchedAt);
  const anyDay = mine.rows.some((row) => row.change?.since === 'day');
  const anyBought = mine.rows.some((row) => row.change?.since === 'bought');

  return (
    <div className={s.wrap} ref={wrap} style={{ ['--player' as string]: colour }}>
      {open && (
        <section id="city-mine" className={s.panel} role="dialog" aria-label={w.myCoins}>
          <header className={s.head}>
            <div className={s.title}>
              <span className={s.display}>{w.mine}</span>
              {tab === 'coins' && holdings && mine.totalUsd !== null ? <b className={s.total}>{formatUsd(mine.totalUsd)}</b> : null}
            </div>
            <button
              className={`${s.close} ${s.scouts}`}
              onClick={() => {
                useMine.getState().close();
                openScouts();
              }}
              aria-label={w.scouts}
              aria-haspopup="dialog"
            >
              <FlagGlyph />
            </button>
            <button className={s.close} onClick={() => useMine.getState().close()} aria-label={w.close}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          {SPOT_OPEN && (
            <div className={s.tabs} role="tablist" aria-label={w.mine}>
              {(['coins', 'orders'] as const).map((id) => (
                <button key={id} role="tab" aria-selected={tab === id} className={`${s.tab} ${tab === id ? s.tabOn : ''}`} onClick={() => useMine.getState().setTab(id)}>
                  {id === 'coins' ? w.coins : w.myOrders}
                  {id === 'orders' && reachedStops ? <span className={s.alert} aria-label={w.reachedCount(reachedStops)} /> : null}
                </button>
              ))}
            </div>
          )}

          {tab === 'coins' ? <AgentMine onOpen={() => useMine.getState().close()} /> : null}

          {tab === 'orders' ? (
            <MyOrders now={now} />
          ) : !holdings ? (
            holdingsRead === 'failed' ? (
              <div className={s.empty}>
                {w.balancesUnavailable}{' '}
                <button className={s.link} onClick={() => useWallet.getState().refreshHoldings()}>
                  {w.tryAgain}
                </button>
              </div>
            ) : (
              <div className={s.empty}>{w.readingWallet}</div>
            )
          ) : (
            <>
              {count === 0 && mine.cash.length === 0 ? (
                <div className={s.empty}>
                  {holdings.complete ? w.noCoinsYet : w.notAllRead}
                </div>
              ) : (
                <ul className={s.rows}>
                  {mine.cash.map((row) => (
                    <Cash key={row.mint} row={row} />
                  ))}
                  {mine.rows.map((row) => (
                    <Row key={row.tower.id} row={row} onFly={() => fly(row)} onSell={TRADE_OPEN ? () => sell(row) : null} />
                  ))}
                </ul>
              )}
              {/* Where the figures come from, and what is left out of them, behind one quiet «i» (CITY-150). */}
              <button className={`${s.about} ${about ? s.aboutOn : ''}`} aria-expanded={about} aria-label={w.aboutFigures} onClick={() => setAbout((v) => !v)}>
                i
              </button>
              {about ? (
                <div className={s.aboutBody}>
                  <div className={s.meta}>
                    {w.walletBalances(readAge(holdings.at, now))} · {pricesLive ? w.jupiterPrices(readAge(pricesAt.getTime(), now)) : w.savedPrices(dateText(pricesAt, { day: 'numeric', month: 'short' }))}
                  </div>
                  {notes.map((note) => (
                    <div key={note} className={s.note}>
                      {note}
                    </div>
                  ))}
                  {count > 0 ? <Since status={status} message={message} anyDay={anyDay} onProve={() => void useMine.getState().prove(connection, held)} /> : null}
                  {anyBought && basesAt !== null ? <div className={s.note}>{w.sinceBoughtNote(readAge(basesAt, now))}</div> : null}
                </div>
              ) : null}
            </>
          )}

          <footer className={s.foot}>
            <span className={s.cash} />
            <button type="button" className={s.go} onClick={() => toMoney('topup')}>
              {w.topUp}
            </button>
            <button type="button" className={s.go} onClick={() => toMoney('send')}>
              {w.send}
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}

/** SOL and a dollar coin: money of the wallet, how much and what it is worth; topping up and sending are below. */
function Cash({ row }: { row: CashRow }) {
  return (
    <li className={`${s.row} ${s.cashRow}`}>
      <span className={s.coin}>
        <Icon mint={row.mint} shown />
        <span className={s.names}>
          <b className={s.symbol}>{row.symbol}</b>
          <span className={s.amount}>{digits(formatUnits(row.amountRaw, row.decimals, 'down'))}</span>
        </span>
      </span>
      <span className={s.figures}>
        <b className={s.value}>{formatUsd(row.valueUsd)}</b>
      </span>
    </li>
  );
}

function Row({ row, onFly, onSell }: { row: MineRow; onFly: () => void; onSell: (() => void) | null }) {
  const w = useWords(MINE);
  const named = isNamed(row.tower);
  const change = row.change;
  return (
    <li className={s.row}>
      <button className={s.coin} onClick={onFly} aria-label={w.flyTo(ticker(row.tower.symbol))}>
        <Icon mint={row.tower.id} shown={named && Boolean(row.tower.icon)} />
        <span className={s.names}>
          <b className={s.symbol}>{ticker(row.tower.symbol)}</b>
          <span className={s.amount}>{digits(formatUnits(row.amountRaw, row.decimals))}</span>
        </span>
      </button>
      <span className={s.figures}>
        <b className={s.value}>{formatUsd(row.valueUsd)}</b>
        {change ? (
          <span className={`${s.change} ${change.pct > 0 ? s.up : change.pct < 0 ? s.down : ''}`}>
            {formatPct(change.pct)} <span className={s.since}>{change.since === 'bought' ? w.sinceBought : w.h24}</span>
          </span>
        ) : (
          <span className={s.change}>—</span>
        )}
      </span>
      {onSell ? (
        <button className={`${s.display} ${s.sell}`} onClick={onSell} aria-label={w.sellOf(ticker(row.tower.symbol))}>
          {w.sell}
        </button>
      ) : (
        <button className={`${s.display} ${s.sell}`} disabled aria-label={w.sellingSoon(ticker(row.tower.symbol))}>
          {w.soon}
        </button>
      )}
    </li>
  );
}

/** The coin's logo through Ryntra's icon route, as the trade card draws it; an unnamed coin gets a blank disc. */
function Icon({ mint, shown }: { mint: string; shown: boolean }) {
  // The tower's logo first; a coin that is no tower (USDC) through the engine's catalogue (CITY-150: no empty circles).
  const sources = [`/api/icon/${mint}`, `/api/spot/icon?mint=${encodeURIComponent(mint)}`];
  const [tried, setTried] = useState(0);
  if (!shown || tried >= sources.length) return <span className={s.icon} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={sources[tried]} className={s.icon} src={sources[tried]} alt="" draggable={false} onError={() => setTried((n) => n + 1)} />;
}

/** Where «since bought» comes from, and the one tap that unlocks it. */
function Since({ status, message, anyDay, onProve }: { status: string; message: string | null; anyDay: boolean; onProve: () => void }) {
  const w = useWords(MINE);
  if (status === 'proof' || status === 'proving') {
    return (
      <div className={s.since2}>
        <span>{w.dayMove}</span>
        <button className={s.link} onClick={onProve} disabled={status === 'proving'} aria-busy={status === 'proving'}>
          {status === 'proving' ? w.checkWallet : w.seeSince}
        </button>
        <span className={s.fine}>{w.oneSigned}</span>
        {message ? <span className={s.error}>{message}</span> : null}
      </div>
    );
  }
  if (status === 'reading') return <div className={s.note}>{w.readingPaid}</div>;
  if (status === 'failed') return <div className={s.note}>
        {message ?? w.historyUnavailable} {w.dayMove}
      </div>;
  if (anyDay) return <div className={s.note}>{w.dayNoRecord}</div>;
  return null;
}
