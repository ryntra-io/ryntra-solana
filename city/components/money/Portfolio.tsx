'use client';

import { useEffect, useState } from 'react';
import { openTradeCard } from '@/city/lib/coin/open';
import { openBots } from '@/city/lib/bots/open';
import { useDollar } from '@/city/lib/earn/dollar-store';
import { openEarn } from '@/city/lib/earn/open';
import { usePier } from '@/city/lib/earn/pier-store';
import { useEarnData } from '@/city/lib/earn/store';
import { DEFAULT_SYMBOL, useExchange } from '@/city/lib/exchange/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { formatUsd, readAge } from '@/city/lib/money/assets';
import { useMoney } from '@/city/lib/money/open';
import { PLACE_ORDER, type Action, type Place, type PlaceKind, type Row } from '@/city/lib/money/portfolio';
import { useRewards } from '@/city/lib/money/rewards';
import { useMoneyStore } from '@/city/lib/money/store';
import { useSpot } from '@/city/lib/trade/spot-store';
import { useWallet } from '@/city/lib/trade/wallet';
import { CoinIcon, More, Refresh } from './bits';
import { usePortfolio } from './usePortfolio';
import { MONEY, PORTFOLIO, REWARDS } from './words';
import s from './money.module.css';
import p from './portfolio.module.css';

/** Read the balances again when the last read is older than this. */
const STALE_MS = 60_000;

/** Each place's colour on the bar and its dot: the brand's amber first, then the city's own tones. */
const TONE: Readonly<Record<PlaceKind, string>> = {
  wallet: 'var(--amber, #ff681c)',
  savings: '#3ddc97',
  pools: '#6c8cff',
  agents: '#b57bff',
  orders: '#f2c94c',
  phoenix: '#8a93a6',
};

function percent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  return digits(`${sign}${abs < 0.05 && abs > 0 ? '<0.1' : abs.toFixed(1)}%`);
}

function signedUsd(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatUsd(Math.abs(value))}`;
}

/** The one action of a row: each opens the card that already signs it, or cancels in place. */
function act(action: Action, row: Row): void {
  const leave = () => useMoney.getState().close();
  switch (action.kind) {
    case 'trade': {
      const asset = useMoneyStore.getState().wallet?.assets.find((a) => (a.mint ?? 'So11111111111111111111111111111111111111112') === action.mint);
      leave();
      openTradeCard({ mint: action.mint, symbol: asset?.symbol ?? row.title, name: asset?.name ?? asset?.symbol ?? row.title, icon: asset?.icon ?? null });
      return;
    }
    case 'lendWithdraw':
      leave();
      openEarn('shelf', 'dollar');
      useDollar.getState().setSide('withdraw');
      return;
    case 'pier': {
      const positions = useEarnData.getState().positions;
      const view = positions?.value.status === 'ready' ? positions.value.value.find((v) => v.address === action.address) : undefined;
      leave();
      openEarn('piers');
      if (view) usePier.getState().openBoat(view);
      return;
    }
    case 'care':
      leave();
      openEarn('mine');
      return;
    case 'agentStop':
      leave();
      openBots('launch');
      return;
    case 'cancelOrder':
      void useSpot.getState().cancelOrder({ key: action.key, venue: action.venue as never, order: action.order });
      return;
    case 'cancelPoolOrder':
      leave();
      openEarn('shelf', 'sell');
      return;
    case 'phoenix':
      leave();
      useExchange.getState().show(DEFAULT_SYMBOL);
      return;
  }
}

function actionWord(action: Action, pw: (typeof PORTFOLIO)['en']): string {
  switch (action.kind) {
    case 'trade':
      return pw.trade;
    case 'lendWithdraw':
      return pw.withdraw;
    case 'pier':
      return pw.manage;
    case 'care':
    case 'agentStop':
      return pw.stopReturn;
    case 'cancelOrder':
    case 'cancelPoolOrder':
      return pw.cancel;
    case 'phoenix':
      return pw.closeOut;
  }
}

function RowLine({ row, place }: { row: Row; place: PlaceKind }) {
  const pw = useWords(PORTFOLIO);
  const cancelling = useSpot((st) => st.cancelling);
  const busy = row.action?.kind === 'cancelOrder' && cancelling?.key === row.action.key;
  const coin = place === 'wallet' || place === 'savings' || place === 'orders';
  return (
    <li className={p.row}>
      {coin ? (
        <CoinIcon mint={row.mint} symbol={row.title} icon={useMoneyStore.getState().wallet?.assets.find((a) => a.mint === row.mint)?.icon ?? null} size={34} />
      ) : (
        <span className={p.glyph} style={{ ['--tone' as string]: TONE[place] }} data-on={row.tone === 'on' ? '' : undefined} aria-hidden="true" />
      )}
      <span className={s.names}>
        <b>{row.title}</b>
        {row.line ? <span>{row.line}</span> : null}
      </span>
      <span className={s.figures}>
        <b className={row.usd === null ? p.quiet : undefined}>{row.usd === null ? '—' : formatUsd(row.usd)}</b>
        {row.gainUsd !== null && row.gainUsd > 0 ? (
          <span className={p.gain}>+{formatUsd(row.gainUsd)} {place === 'pools' ? pw.gain : pw.earnedLine}</span>
        ) : row.dayPct !== null ? (
          <span className={row.dayPct > 0 ? p.up : row.dayPct < 0 ? p.down : undefined}>{percent(row.dayPct)}</span>
        ) : row.usd === null && place !== 'pools' && place !== 'agents' ? (
          <span>{pw.noPrice}</span>
        ) : null}
      </span>
      {row.action ? (
        <button type="button" className={`${s.display} ${p.act}`} disabled={busy} onClick={() => act(row.action as Action, row)}>
          {busy ? pw.cancelling : actionWord(row.action, pw)}
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

function PlaceSection({ place }: { place: Place }) {
  const pw = useWords(PORTFOLIO);
  if (place.state === 'off' && place.rows.length === 0) return null;
  if (place.rows.length === 0 && place.state === 'ready') return null;
  return (
    <section className={p.place} aria-label={pw[place.kind]}>
      <h4 className={p.placeHead}>
        <span className={p.dot} style={{ ['--tone' as string]: TONE[place.kind] }} aria-hidden="true" />
        <span className={`${s.display} ${p.placeName}`}>{pw[place.kind]}</span>
        <b className={p.placeUsd}>{place.usd === null ? '—' : formatUsd(place.usd)}</b>
      </h4>
      {place.rows.length ? (
        <ul className={p.rows}>
          {place.rows.map((row) => (
            <RowLine key={row.id} row={row} place={place.kind} />
          ))}
        </ul>
      ) : (
        <p className={p.quietLine}>{place.state === 'loading' ? pw.reading : pw.unread}</p>
      )}
    </section>
  );
}

function Rewards({ owner }: { owner: string }) {
  const pw = useWords(PORTFOLIO);
  const r = useWords(REWARDS);
  const status = useRewards((st) => (st.owner === owner ? st.status : 'none'));
  const view = useRewards((st) => (st.owner === owner ? st.view : null));
  const message = useRewards((st) => (st.owner === owner ? st.message : null));
  const connection = useWallet((st) => st.connection);

  useEffect(() => {
    void useRewards.getState().read(owner);
  }, [owner]);

  const tiles: { label: string; value: string; line?: string }[] = [];
  if (view?.points) tiles.push({ label: r.points, value: digits(view.points.points), line: r.level(view.points.level) });
  if (view?.scouts?.rank || view?.points?.rank) {
    tiles.push({ label: r.rank, value: view?.scouts?.rank ?? '—', line: view?.points?.rank ? r.place(view.points.rank, view.points.ranked) : undefined });
  }
  if (view?.scouts) {
    tiles.push({ label: r.referral, value: digits(`$${view.scouts.fromFriends}`), line: r.friends(view.scouts.friends) });
    tiles.push({ label: r.cashback, value: digits(`$${view.scouts.cashback}`), line: view.scouts.pending !== '0.00' ? `${r.pending} $${view.scouts.pending}` : undefined });
  }
  if (view?.credits) tiles.push({ label: r.credits, value: digits(String(view.credits.balance)), line: view.credits.freeLeft > 0 ? r.creditsLine(view.credits.freeLeft) : undefined });

  return (
    <section className={p.rewards} aria-label={r.title}>
      <h4 className={p.placeHead}>
        <span className={p.star} aria-hidden="true" />
        <span className={`${s.display} ${p.placeName}`}>{r.title}</span>
      </h4>
      {status === 'proof' || status === 'proving' ? (
        <>
          <button
            type="button"
            className={`${s.display} ${s.secondary} ${p.wide}`}
            disabled={status === 'proving' || !connection}
            onClick={() => connection && void useRewards.getState().prove({ wallet: connection.wallet, address: connection.address })}
          >
            {status === 'proving' ? r.opening : r.open}
          </button>
          {message ? <p className={p.quietLine}>{message}</p> : null}
        </>
      ) : tiles.length ? (
        <div className={p.tiles}>
          {tiles.map((tile) => (
            <div key={tile.label} className={p.tile}>
              <span>{tile.label}</span>
              <b>{tile.value}</b>
              {tile.line ? <small>{tile.line}</small> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className={p.quietLine}>{status === 'reading' || status === 'none' ? pw.reading : r.unavailable}</p>
      )}
    </section>
  );
}

/**
 * Portfolio (CITY-206): where every dollar of the wallet is — the wallet's coins, savings, pools, agents, orders and
 * what is left on Phoenix — with the total, the day's move and one bar of where it sits; each row carries the one action
 * that takes the money out, through the card that already signs it. Below, the rewards. Every figure is the engine's;
 * what was not read is «—», never zero, and «Details» says why.
 */
export function Portfolio() {
  const w = useWords(MONEY);
  const pw = useWords(PORTFOLIO);
  const { owner, view } = usePortfolio();
  const wallet = useMoneyStore((st) => st.wallet);
  const walletRead = useMoneyStore((st) => st.walletRead);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const at = useMoneyStore.getState().wallet?.at;
    if (at && Date.now() - at > STALE_MS) useMoneyStore.getState().readWallet();
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (!owner || !view || !wallet) {
    return walletRead === 'failed' ? (
      <p className={s.empty}>
        {w.balancesUnavailableNow}{' '}
        <button type="button" className={s.link} onClick={() => useMoneyStore.getState().readWallet()}>
          {w.tryAgain}
        </button>
      </p>
    ) : (
      <div className={s.bones} aria-label={w.readingWallet}>
        <span />
        <span />
        <span />
      </div>
    );
  }

  const refresh = () => {
    useMoneyStore.getState().readWallet();
    void useEarnData.getState().loadPositions(owner);
    void useSpot.getState().readOrders(true);
    void useRewards.getState().read(owner, true);
  };
  const unpriced = view.places.reduce((sum, place) => sum + (place.kind === 'pools' || place.kind === 'agents' ? 0 : place.unpriced), 0);

  return (
    <section className={`${s.tabBody} ${p.body}`} aria-label={w.portfolio}>
      <div className={p.hero}>
        <div className={p.heroText}>
          <span className={`${s.display} ${s.kicker}`}>{pw.total}</span>
          <b className={`${s.display} ${p.big}`}>{formatUsd(view.totalUsd)}</b>
          {view.dayUsd !== null && view.dayPct !== null ? (
            <span className={`${p.day} ${view.dayUsd > 0 ? p.up : view.dayUsd < 0 ? p.down : ''}`}>
              {signedUsd(view.dayUsd)} · {percent(view.dayPct)} <small>{pw.today}</small>
            </span>
          ) : null}
        </div>
        <Refresh onClick={refresh} title={w.readAt(readAge(wallet.at, now))} />
      </div>

      {view.bar.length ? (
        <div className={p.split}>
          <div className={p.bar} role="img" aria-label={view.bar.map((seg) => `${pw[seg.kind]} ${Math.round(seg.share * 100)}%`).join(', ')}>
            {view.bar.map((seg) => (
              <span key={seg.kind} style={{ flexGrow: Math.max(seg.share, 0.015), background: TONE[seg.kind] }} />
            ))}
          </div>
          <ul className={p.legend}>
            {PLACE_ORDER.filter((kind) => view.bar.some((seg) => seg.kind === kind)).map((kind) => {
              const seg = view.bar.find((b) => b.kind === kind)!;
              return (
                <li key={kind}>
                  <span className={p.dot} style={{ ['--tone' as string]: TONE[kind] }} aria-hidden="true" />
                  <span>{pw[kind]}</span>
                  <b>{Math.round(seg.share * 100)}%</b>
                </li>
              );
            })}
            {[...view.reading, ...view.unread].map((kind) => (
              <li key={`${kind}:open`} className={p.legendOpen} title={view.reading.includes(kind) ? pw.reading : pw.unread}>
                <span className={`${p.dot} ${view.reading.includes(kind) ? p.dotReading : p.dotOpen}`} style={{ ['--tone' as string]: TONE[kind] }} aria-hidden="true" />
                <span>{pw[kind]}</span>
                <b>—</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={s.quick}>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('topup')}>
          {w.topUp}
        </button>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('send')}>
          {w.send}
        </button>
      </div>

      {view.places.map((place) => (
        <PlaceSection key={place.kind} place={place} />
      ))}

      <Rewards owner={owner} />

      <More label={pw.details}>
        <p className={s.fine}>{pw.priced}</p>
        <p className={s.fine}>{pw.day}</p>
        {unpriced > 0 ? <p className={s.fine}>{pw.unpriced(unpriced)}</p> : null}
        {view.unread.length ? <p className={s.fine}>{pw.unreadLine(view.unread.map((k) => pw[k]).join(', '))}</p> : null}
        {!wallet.complete ? <p className={s.fine}>{w.someCoins}</p> : null}
        <p className={s.fine}>{pw.safe}</p>
      </More>
    </section>
  );
}
