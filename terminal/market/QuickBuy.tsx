'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { create } from 'zustand';
import { TRADE } from '@/city/components/trade/words';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import { decimalsOf, figuresOf, friendDiscountOf, type Figures } from '@/city/lib/trade/figures';
import { choiceOf, useTrade, type CoinRef } from '@/city/lib/trade/store';
import { SOL, USDC } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { ExplainBox, ExplainButton, bare, connectOrPick } from '@/terminal/coin/parts';
import { Details, Done, Failed, TICKET_OPEN, Unknown } from '@/terminal/coin/Ticket';
import { actionOf, ticketFree, type ActionLabel } from '@/terminal/coin/ticket-rules';
import { useTicket } from '@/terminal/coin/useTicket';
import { WalletPick } from '@/terminal/coin/WalletPick';
import { coinHref } from '@/terminal/shell/shelves';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { CoinLogo, Icon, Quiet } from '@/terminal/ui';
import { FEE } from '@/terminal/ui/words';
import { setQuick, useDepth } from './depth';
import { QUICK_SOL, logoChain } from './depth-view';
import { DEPTH } from './depth-words';
import { Zap } from './glyphs';
import d from './depth.module.css';

/**
 * One-tap buy: «⚡ 0.1» beside a card of the Pulse or a row of the table opens a small panel
 * right there — what you pay, what you get, the fee in one line, one «Buy». Everything in it is the trade card's own
 * logic, as it is (`useTicket`, `useTrade`): the price, the route, Ryntra's fee, the exact order, the wallet's signature
 * and the reading of the outcome; the panel only stands the card on the coin with the screen's one sum in SOL. The sum is
 * picked once for the whole screen («One-tap buy: 0.1 SOL»).
 */

export type QuickCoin = Readonly<{ id: string; symbol: string; name: string; icon: string | null; logo: string | null }>;

type Open = Readonly<{ coin: QuickCoin; anchor: HTMLElement }>;

export const useQuick = create<{ open: Open | null }>(() => ({ open: null }));

/**
 * A trade on its way (asked to be built, in the wallet, sent, being read): the panel stays on its coin until it settles.
 * An order the card builds by itself after a price is not one — the person can still leave it.
 */
const underWay = () => {
  const st = useTrade.getState();
  if (ticketFree(st) || ['done', 'failed', 'unknown'].includes(st.phase)) return false;
  return !(st.phase === 'preparing' && st.auto && !st.held);
};

/** The coins a quick buy is paid with are never bought by one: SOL and USDC are what the sum is in. */
const PAID_WITH: ReadonlySet<string> = new Set([SOL.mint, USDC.mint]);

const closeQuick = () => {
  // Never under a trade on its way: the card keeps its signature in front of the person.
  if (underWay()) return;
  useQuick.setState({ open: null });
};

/** The ⚡ beside a coin: the screen's one sum in SOL. */
export function ZapButton({ coin, wide = true }: { coin: QuickCoin; wide?: boolean }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const quick = useDepth((st) => st.quick);
  const on = useQuick((st) => st.open?.coin.id === coin.id);
  if (!TICKET_OPEN || PAID_WITH.has(coin.id)) return null;
  return (
    <button
      type="button"
      className={d.zap}
      data-zap=""
      data-wide={wide ? '' : undefined}
      aria-expanded={on}
      aria-label={w.quickBuy(fieldText(quick, lang), bare(coin.symbol))}
      onClick={(event) => {
        event.stopPropagation();
        const anchor = event.currentTarget;
        if (useQuick.getState().open?.coin.id === coin.id) closeQuick();
        // Another coin's ⚡ waits while a trade is on its way: the panel never names one coin over another's trade.
        else if (!underWay()) useQuick.setState({ open: { coin, anchor } });
      }}
    >
      <Zap />
      {wide ? <span>{fieldText(quick, lang)}</span> : null}
    </button>
  );
}

/** «One-tap buy: 0.1 SOL ▾» — the sum every ⚡ of the screen buys with. */
export function QuickSum() {
  const w = useWords(DEPTH);
  const lang = useLang();
  const quick = useDepth((st) => st.quick);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  if (!TICKET_OPEN) return null;
  return (
    <div className={d.pop} ref={box}>
      <Quiet size="s" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((was) => !was)} className={d.quickSum}>
        <Zap />
        {w.quickLine(fieldText(quick, lang))}
        <Icon name="chevron" size="s" />
      </Quiet>
      {open ? (
        <div className={d.menu} role="menu" aria-label={w.quickSums}>
          {QUICK_SOL.map((sum) => (
            <button
              key={sum}
              type="button"
              role="menuitemradio"
              aria-checked={sum === quick}
              className={d.menuItem}
              onClick={() => {
                setQuick(sum);
                setOpen(false);
              }}
            >
              {fieldText(sum, lang)} SOL
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The one panel of a quick buy, beside the ⚡ that opened it; on a phone, a sheet over the tab bar. */
export function QuickPop() {
  const open = useQuick((st) => st.open);
  // The panel belongs to this screen: leaving it, by any way, lets it go.
  useEffect(() => () => useQuick.setState({ open: null }), []);
  if (!open || !TICKET_OPEN) return null;
  return <PopBody key={open.coin.id} coin={open.coin} anchor={open.anchor} />;
}

const POP_W = 340;
const GAP = 8;

function PopBody({ coin, anchor }: { coin: QuickCoin; anchor: HTMLElement }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const narrow = useNarrow();
  const quick = useDepth((st) => st.quick);
  const ref = useMemo<CoinRef>(() => ({ id: coin.id, symbol: coin.symbol, name: coin.name, icon: coin.icon }), [coin]);
  const press = useTicket(ref, 'spot', 'buy');
  const phase = useTrade((st) => st.phase);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });

  // The card stands on the coin, buying with the screen's sum in SOL — once it opens, and again when the sum changes.
  const set = useRef<string | null>(null);
  useEffect(() => {
    const apply = () => {
      const st = useTrade.getState();
      if (set.current === quick || !st.open || st.tower?.mint !== coin.id || st.phase !== 'idle' || st.held || PAID_WITH.has(coin.id)) return;
      set.current = quick;
      if (st.side !== 'buy') st.setSide('buy');
      useTrade.getState().setPay(SOL.symbol);
      useTrade.getState().setTyped(quick);
    };
    apply();
    return useTrade.subscribe(apply);
  }, [coin.id, quick]);

  // Beside the ⚡: under it, or over it where the window ends; it follows the page as it scrolls.
  useLayoutEffect(() => {
    if (narrow) return;
    const put = () => {
      // A row that left the list (a fresh read) leaves the panel where it stood.
      if (!anchor.isConnected) return;
      const at = anchor.getBoundingClientRect();
      const h = box.current?.offsetHeight ?? 260;
      const left = Math.max(16, Math.min(at.right - POP_W, window.innerWidth - POP_W - 16));
      const below = at.bottom + GAP + h <= window.innerHeight - 8 || at.top - GAP - h < 76;
      setPlace({ left, top: below ? at.bottom + GAP : at.top - GAP - h, width: POP_W });
    };
    put();
    const seen = new ResizeObserver(put);
    if (box.current) seen.observe(box.current);
    window.addEventListener('scroll', put, { passive: true });
    window.addEventListener('resize', put);
    return () => {
      seen.disconnect();
      window.removeEventListener('scroll', put);
      window.removeEventListener('resize', put);
    };
  }, [anchor, narrow]);

  // A tap outside — not on another ⚡, which moves the panel — or Escape closes it, never under a signature.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (box.current?.contains(target) || target?.closest?.('[data-zap]')) return;
      closeQuick();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeQuick();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key);
    };
  }, []);

  const result = phase === 'done' ? <Done /> : phase === 'failed' ? <Failed /> : phase === 'unknown' ? <Unknown press={press} /> : null;
  return (
    <div ref={box} className={d.quickPop} data-sheet={narrow ? '' : undefined} style={narrow ? undefined : place} role="dialog" aria-label={w.quickBuy(fieldText(quick, lang), bare(coin.symbol))} data-terminal="quick-pop">
      <div className={d.popHead}>
        <CoinLogo {...logoChain(coin.id, coin.icon, coin.logo)} symbol={coin.symbol} size="m" />
        <Link
          className={d.popName}
          href={coinHref(coin.id, 'live')}
          onClick={(event) => {
            if (underWay()) event.preventDefault();
            else useQuick.setState({ open: null });
          }}
        >
          <b>{bare(coin.symbol)}</b>
          <span>{coin.name}</span>
        </Link>
        <button type="button" className={d.popClose} aria-label={w.close} onClick={closeQuick}>
          <Icon name="close" size="s" />
        </button>
      </div>
      {result ?? <PopTrade coin={coin} quick={quick} press={press} />}
    </div>
  );
}

/** What you pay and get, the fee in one line with its breakdown behind «i», and the one «Buy». */
function PopTrade({ coin, quick, press }: { coin: QuickCoin; quick: string; press: () => Promise<'connect' | 'ok'> }) {
  const t = useWords(TRADE);
  const w = useWords(DEPTH);
  const fw = useWords(FEE);
  const lang = useLang();
  const tower = useTrade((st) => st.tower);
  const side = useTrade((st) => st.side);
  const pay = useTrade((st) => st.pay);
  const typed = useTrade((st) => st.typed);
  const other = useTrade((st) => st.other);
  const quote = useTrade((st) => st.quote);
  const review = useTrade((st) => st.review);
  const notice = useTrade((st) => st.notice);
  const phase = useTrade((st) => st.phase);
  const autoBuild = useTrade((st) => st.auto);
  const holdings = useWallet((st) => st.holdings);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => Boolean(st.connecting));
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);

  const onCoin = tower?.mint === coin.id;
  const choice = onCoin && tower ? choiceOf(tower, side, holdings, { pay, typed, other }) : null;
  const shown = choice && review && review.key === choice.key ? review : null;
  const priced = choice && quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  const failed = choice && quote.status === 'error' && quote.key === choice.key ? quote.refusal : null;
  const outputDecimals = choice ? (shown ? decimalsOf(shown.order, choice.outputMint) : priced ? decimalsOf(priced, choice.outputMint) : null) : null;
  const figures = useMemo<Figures | null>(() => {
    if (outputDecimals === null) return null;
    if (shown) return figuresOf(shown.order.order, outputDecimals, 'order');
    return priced ? figuresOf(priced.order, outputDecimals, 'quote') : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the dictionary reads the language `figuresOf` writes in
  }, [shown, priced, outputDecimals, lang]);
  const off = shown ? friendDiscountOf(priced?.order ?? null, shown.order.order) : null;
  const symbol = bare(coin.symbol);

  const action = actionOf({
    phase,
    auto: autoBuild,
    side: 'buy',
    connected: Boolean(connection),
    connecting,
    problem: choice?.problem ? (choice.problem.kind === 'balance' ? 'balance' : 'other') : null,
    hasAmount: Boolean(choice?.amountRaw),
    empty: choice?.sizing.max === '0',
    priced: Boolean(priced),
    exact: Boolean(shown),
    canTopUp: false,
  });
  const labels: Readonly<Record<ActionLabel, string>> = {
    verb: t.buyOf(symbol),
    connect: t.connectWallet,
    connecting: t.connecting,
    building: t.gettingOrder,
    wallet: connection?.wallet ? t.confirmIn(connection.wallet) : t.confirmInWallet,
    sending: t.sending,
    checking: t.readingNetwork,
    short: t.notEnough('SOL'),
    nothing: t.nothingToSell,
    topUp: t.addOf('SOL'),
  };
  const tap = async () => {
    if (action.does !== 'press') return;
    if ((await press()) === 'connect') connectOrPick(() => setPicking(true));
  };
  const note = choice?.problem && choice.problem.kind !== 'balance' ? choice.problem.text : (notice?.text ?? (failed ? failed.message : null));

  return (
    <>
      <div className={d.popRows}>
        <span className={d.popRow}>
          <span>{w.youPay}</span>
          <b>
            <CoinLogo src={`/api/icon/${SOL.mint}`} symbol="SOL" size="s" />
            {fieldText(onCoin && typed ? typed : quick, lang)} SOL
          </b>
        </span>
        <span className={d.popRow}>
          <span>{w.youGet}</span>
          <b aria-live="polite">{figures && !choice?.problem ? `≈ ${digits(figures.get)} ${symbol}` : failed || choice?.problem ? '—' : <span className={d.shimmer} />}</b>
        </span>
      </div>
      {figures && !choice?.problem ? (
        <div className={d.popFee}>
          <span>
            {figures.fee ? fw.ryntra(figures.fee) : fw.none}
            {off ? ` · ${off}` : ''}
          </span>
          <ExplainButton label={t.tradeDetails} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
        </div>
      ) : null}
      {details && figures && choice ? (
        <ExplainBox id={detailsId}>
          <Details figures={figures} off={off} review={shown} quoteAt={quote.status === 'ready' ? quote.at : null} getUnit={symbol} />
        </ExplainBox>
      ) : null}
      {note ? (
        <p className={d.popNote} role="status">
          {note}
        </p>
      ) : null}
      {picking && !connection ? (
        <WalletPick onBack={() => setPicking(false)} />
      ) : (
        <button type="button" className={d.buyGo} onClick={() => void tap()} disabled={action.does === 'none'} aria-busy={action.busy || undefined}>
          {action.label === 'verb' ? <Zap /> : null}
          {labels[action.label]}
        </button>
      )}
    </>
  );
}
