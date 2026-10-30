'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LaunchMarketResponse, LaunchTradeQuoteResponse } from '@/lib/api/v1/contract';
import { launchTradeEngine, launchWallet, useLaunch } from '@/city/lib/launch/district';
import { cityLaunchOpen } from '@/city/lib/launch/gate';
import {
  BUY_CHIPS,
  DEFAULT_SLIPPAGE_BPS,
  SELL_CHIPS,
  SLIPPAGES,
  chipFits,
  explorerUrl,
  feeNow,
  feeShares,
  heldAfter,
  progressOf,
  rawToNumber,
  reviewOf,
  routeOf,
  shareOfRaw,
  wholeToRaw,
  type Progress,
  type Side,
} from '@/city/lib/launch/trade';
import { awaitReceipt, runLaunchTrade, type TradePhase } from '@/city/lib/launch/trade-flow';
import { earnerText, feeLineText, getText, honestText, pctText, progressText, riskText, tradeFailureText, unitsText } from '@/city/lib/launch/trade-words';
import { LAUNCH_TRADE } from '@/city/lib/launch/words';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import type { WalletOption } from '@/city/lib/launch/wallet';
import s from './launch-trade.module.css';

/** The market is read again this often while the panel is open; the price on screen, as often. */
const MARKET_MS = 15_000;
const QUOTE_MS = 10_000;

export type LaunchTradePanelProps = Readonly<{
  token: string;
  symbol: string;
  /** What the city already knows of the curve, shown until the engine's own market read is here. */
  fallback: Progress;
  /** Told when a trade starts and ends, so the window holding the panel is not closed under a signature. */
  onBusy?: (busy: boolean) => void;
}>;

type Held = Readonly<{ tokenRaw: string; pairRaw: string }>;
type Quote = Readonly<{ key: string; quote: LaunchTradeQuoteResponse }> | Readonly<{ key: string; error: string }>;

/**
 * Buy and Sell for a launch's tower (L1): the way to the DEX, the live fee with its fall, the chips, the price the
 * engine quotes, one honest line, one signature, the receipt and the position at once. Self-contained — it reads the
 * engine and the city's one wallet itself — so the tower's card mounts it today and the tower's one window (CITY-78)
 * can mount it as it is. The button never waits on the 3D city: everything here is the engine's reads.
 */
export function LaunchTradePanel({ token, symbol, fallback, onBusy }: LaunchTradePanelProps) {
  const lang = useLang();
  const w = useWords(LAUNCH_TRADE);
  const now = useNow();
  const network = useLaunch((st) => st.network);
  const open = useLaunch((st) => st.stub || cityLaunchOpen(st.network));
  const connection = useLaunch((st) => st.connection);
  const setConnection = useLaunch((st) => st.setConnection);

  const [market, setMarket] = useState<LaunchMarketResponse | null>(null);
  const [marketFailed, setMarketFailed] = useState(false);
  const [side, setSide] = useState<Side>('buy');
  const [buyChip, setBuyChip] = useState<number>(BUY_CHIPS[1]);
  const [sellChip, setSellChip] = useState<number>(SELL_CHIPS[1]);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [phase, setPhase] = useState<TradePhase | null>(null);
  const [receipt, setReceipt] = useState<'wait' | 'done' | 'failed' | null>(null);
  const [details, setDetails] = useState(false);
  const [options, setOptions] = useState<readonly WalletOption[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const busy = useRef(false);

  const working = phase !== null && (phase.step === 'build' || phase.step === 'sign' || phase.step === 'send');
  useEffect(() => {
    onBusy?.(working);
  }, [working, onBusy]);
  useEffect(() => () => onBusy?.(false), [onBusy]);
  const units = market ? { token: symbol, tokenDecimals: market.tokenDecimals, pair: market.pair.symbol, pairDecimals: market.pair.decimals } : null;

  /* The coin's market, read now and while the panel is open. */
  useEffect(() => {
    let live = true;
    setMarket(null);
    setMarketFailed(false);
    const read = async () => {
      const engine = await launchTradeEngine().catch(() => null);
      const answer = await engine?.market(token);
      if (!live) return;
      if (answer?.ok) setMarket(answer.data);
      /* A market that never came is said once, never an endless «reading»; a later read that answers replaces it. */
      setMarketFailed(!answer?.ok);
    };
    void read();
    const timer = setInterval(() => document.visibilityState === 'visible' && void read(), MARKET_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [token]);

  /* The wallet the city already has comes back without a prompt. */
  useEffect(() => {
    if (connection) return;
    let live = true;
    void launchWallet()
      .then((wallet) => wallet.restore())
      .then((restored) => live && restored && setConnection(restored))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connection, setConnection]);

  /* What the wallet holds of the coin and of its pair, read from the chain. */
  const readHeld = useCallback(async () => {
    if (!connection) return setHeld(null);
    const engine = await launchTradeEngine().catch(() => null);
    const answer = await engine?.wallet(token, connection.address);
    if (answer?.ok) setHeld({ tokenRaw: answer.data.tokenRaw, pairRaw: answer.data.pairRaw });
  }, [connection, token]);
  useEffect(() => {
    void readHeld();
  }, [readHeld]);

  /* The amount the chips stand for, raw. A sale with nothing to sell has none. */
  const amountRaw = useMemo(() => {
    if (!market) return null;
    if (side === 'buy') return wholeToRaw(buyChip, market.pair.decimals);
    if (!held || BigInt(held.tokenRaw) === 0n) return null;
    const raw = shareOfRaw(held.tokenRaw, sellChip);
    return BigInt(raw) > 0n ? raw : null;
  }, [market, side, buyChip, sellChip, held]);
  const quoteKey = amountRaw ? `${token}:${side}:${amountRaw}:${slippageBps}` : null;

  /* The engine's quote for the choice: at once, and again while it stays on screen. */
  useEffect(() => {
    if (!quoteKey || !amountRaw || working) return;
    let live = true;
    const read = async () => {
      const engine = await launchTradeEngine().catch(() => null);
      if (!engine) return;
      const answer = await engine.quote(token, { side, amountRaw, slippageBps });
      if (!live) return;
      setQuote(answer.ok ? { key: quoteKey, quote: answer.data } : { key: quoteKey, error: answer.code });
    };
    void read();
    const timer = setInterval(() => document.visibilityState === 'visible' && void read(), QUOTE_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [quoteKey, amountRaw, side, slippageBps, token, working]);

  const shown = quote && quote.key === quoteKey && 'quote' in quote ? quote.quote : null;
  const review = shown && units ? reviewOf(shown, units) : null;
  const fee = market ? feeNow(market, shown?.feeBps ?? null, now) : null;
  const progress = market ? progressOf(market, fallback.migrated ? null : fallback.graduationUsd) : fallback;

  /* ---------------------------------------------------------------- the wallet */

  const pick = async (name: string) => {
    setConnecting(name);
    const wallet = await launchWallet();
    const answer = await wallet.connect(name);
    setConnecting(null);
    if (answer.ok) {
      setConnection(answer.connection);
      setOptions(null);
    }
  };
  const connect = async () => {
    const wallet = await launchWallet();
    const list = wallet.options();
    if (list.length === 1) return pick(list[0]!.name);
    setOptions(list);
  };

  /* ---------------------------------------------------------------- the trade */

  const trade = async () => {
    if (busy.current || !connection || !amountRaw || !network) return;
    busy.current = true;
    setReceipt(null);
    try {
      const loaded = await Promise.all([launchTradeEngine(), launchWallet()]).catch(() => null);
      if (!loaded) return setPhase({ step: 'failed', failure: { code: 'UNAVAILABLE', stage: 'before', message: '' } });
      const [engine, wallet] = loaded;
      const result = await runLaunchTrade({ engine, signer: wallet.signer(connection), order: { token, side, amountRaw, slippageBps }, network, open, onPhase: setPhase });
      if (result.step !== 'done') return;
      const { done } = result;
      /* The position is on screen at once: the fill moved onto the last read, then the chain read again. */
      if (done.filled) setHeld((before) => (before ? heldAfter(before, done.side, done.filled!) : before));
      setTimeout(() => void readHeld(), 2_500);
      setReceipt(done.receiptHash ? 'done' : 'wait');
      if (!done.receiptHash) {
        const settled = await awaitReceipt({ engine, token, wallet: connection.address, signature: done.signature });
        setReceipt(settled?.state === 'DONE' ? 'done' : settled?.state === 'FAILED' ? 'failed' : 'wait');
      }
    } finally {
      busy.current = false;
    }
  };

  const spendText = side === 'buy' ? `${buyChip} ${market?.pair.symbol ?? 'USDC'}` : pctText(sellChip * 100, lang);
  const tokenHeld = held && units ? rawToNumber(held.tokenRaw, units.tokenDecimals) : null;
  const nothingToSell = side === 'sell' && connection !== null && held !== null && BigInt(held.tokenRaw) === 0n;
  /* A buy over what the wallet holds of the pair is never put before the wallet: the engine would only refuse it. */
  const short = side === 'buy' && connection !== null && market !== null && !chipFits(wholeToRaw(buyChip, market.pair.decimals), held?.pairRaw ?? null);
  /* The engine's risk verdict over this very trade: BLOCKED stops the action, REVIEW_REQUIRED takes the risk line. */
  const verdict = shown?.tradeRisk.verdict ?? null;
  const blocked = verdict === 'BLOCKED';

  return (
    <div className={s.panel}>
      <ProgressBlock progress={progress} lang={lang} />

      {phase?.step === 'done' ? (
        <Done phase={phase} receipt={receipt} symbol={symbol} units={units} lang={lang} onAgain={() => setPhase(null)} />
      ) : (
        <>
          <div className={s.sides} role="tablist" aria-label={w.buyOrSell}>
            {(['buy', 'sell'] as const).map((each) => (
              <button key={each} role="tab" aria-selected={side === each} className={`${s.side} ${side === each ? (each === 'buy' ? s.sideBuy : s.sideSell) : ''}`} onClick={() => setSide(each)} disabled={working}>
                {each === 'buy' ? w.buy : w.sell}
              </button>
            ))}
          </div>

          <div className={s.chips}>
            {side === 'buy'
              ? BUY_CHIPS.map((chip) => {
                  const fits = !market || chipFits(wholeToRaw(chip, market.pair.decimals), held?.pairRaw ?? null);
                  return (
                    <button key={chip} className={`${s.chip} ${buyChip === chip ? s.chipOn : ''}`} onClick={() => setBuyChip(chip)} disabled={working || !fits} aria-pressed={buyChip === chip}>
                      {chip}
                      <small>{market?.pair.symbol ?? 'USDC'}</small>
                    </button>
                  );
                })
              : SELL_CHIPS.map((chip) => (
                  <button key={chip} className={`${s.chip} ${sellChip === chip ? s.chipOn : ''}`} onClick={() => setSellChip(chip)} disabled={working || nothingToSell} aria-pressed={sellChip === chip}>
                    {chip === 100 ? w.max : pctText(chip * 100, lang)}
                  </button>
                ))}
          </div>

          <div className={s.get} aria-live="polite">
            {nothingToSell
              ? w.heldNone(symbol)
              : review
                ? getText(review, lang)
                : quote && 'error' in quote && quote.key === quoteKey
                  ? tradeFailureText({ code: quote.error, stage: 'before', message: '' }, null, lang)
                  : !market && marketFailed
                    ? w.noPrice
                    : side === 'sell' && !connection
                      ? ' '
                      : w.quoting}
          </div>
          {review && review.left > 0 && units && <div className={s.note}>{w.curveFills(`${unitsText(review.left, 'down', lang)} ${units.pair}`)}</div>}

          {details && market && (
            <Details
              lang={lang}
              quote={shown}
              pairSymbol={market.pair.symbol}
              pairDecimals={market.pair.decimals}
              route={ROUTE[routeOf(market)](w)}
              slippageBps={slippageBps}
              onSlippage={setSlippageBps}
              disabled={working}
              network={network}
            />
          )}

          {/* The live fee, the fee and least received, the risk and the one action stand in the pinned dock (the city's
              rule since CITY-79): whatever the window holds above them scrolls under it, never these lines. */}
          <div className={s.dock}>
            <div className={s.feeRow}>
              <span className={`${s.feeLine} ${fee?.endBps !== null && fee?.endBps !== undefined ? s.feeFalling : ''}`} aria-live="polite">
                {fee ? feeLineText(fee, lang) : ' '}
              </span>
              <button className={`${s.info} ${details ? s.infoOn : ''}`} aria-label={details ? w.hide : w.details} aria-expanded={details} onClick={() => setDetails((v) => !v)}>
                i
              </button>
            </div>

            {review && market && (
              <div className={s.honest}>
                {honestText(review, market.pair.symbol, lang)}
                <span className={s.risk}> · {riskText(verdict, lang)}</span>
              </div>
            )}

            {phase?.step === 'failed' && (
              <div className={s.problem} role="alert">
                {tradeFailureText(phase.failure, connection?.wallet ?? null, lang)}
              </div>
            )}

            {working ? (
              <Working phase={phase} wallet={connection?.wallet ?? null} units={units} side={side} lang={lang} />
            ) : !open ? (
              <div className={s.closed}>{w.closed}</div>
            ) : !connection ? (
              options ? (
                <WalletList options={options} connecting={connecting} onPick={pick} empty={w.noWallet} opening={w.opening} />
              ) : (
                <button className={`${s.display} ${s.action}`} onClick={connect}>
                  {w.connect}
                </button>
              )
            ) : (
              <button className={`${s.display} ${s.action} ${side === 'sell' ? s.actionSell : ''}`} onClick={trade} disabled={!review || nothingToSell || short || blocked}>
                {short && market ? w.short(market.pair.symbol) : side === 'buy' ? w.buyAction(symbol, spendText) : w.sellAction(spendText, symbol)}
              </button>
            )}
          </div>
        </>
      )}

      {connection && tokenHeld !== null && tokenHeld > 0 && (
        <div className={s.position}>
          <span className={s.positionDot} aria-hidden="true" />
          {w.held(unitsText(tokenHeld, 'down', lang), symbol)}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- parts */

type W = (typeof LAUNCH_TRADE)['en'];

/** The route a trade runs on, in the words on screen. */
const ROUTE: Readonly<Record<'curve' | 'pool' | 'poolJupiter', (w: W) => string>> = {
  curve: (w) => w.routeCurve,
  pool: (w) => w.routePool,
  poolJupiter: (w) => w.routePoolJupiter,
};

function ProgressBlock({ progress, lang }: { progress: Progress; lang: Lang }) {
  const w = useWords(LAUNCH_TRADE);
  const pct = progress.migrated ? 100 : Math.max(2, Math.min(100, progress.pct));
  return (
    <div className={s.progress}>
      <div className={`${s.bar} ${progress.migrated ? s.barDone : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.migrated ? 100 : progress.pct} aria-label={w.wayToDex}>
        <div className={s.barFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={s.progressLine}>{progressText(progress, lang)}</div>
    </div>
  );
}

function Details(props: {
  lang: Lang;
  quote: LaunchTradeQuoteResponse | null;
  pairSymbol: string;
  pairDecimals: number;
  route: string;
  slippageBps: number;
  onSlippage: (bps: number) => void;
  disabled: boolean;
  network: string | null;
}) {
  const w = useWords(LAUNCH_TRADE);
  const shares = props.quote ? feeShares(props.quote) : [];
  return (
    <div className={s.details}>
      {shares.length > 0 && (
        <>
          <div className={s.detailsHead}>{w.whoEarns}</div>
          <ul className={s.earners}>
            {shares.map((share) => (
              <li key={share.who}>
                <span>{earnerText(share.who, props.lang)}</span>
                <b>
                  {unitsText(rawToNumber(share.raw, props.pairDecimals), 'down', props.lang)} {props.pairSymbol}
                </b>
                <em>{pctText(share.bps, props.lang)}</em>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={s.detailRow}>
        <span>{w.routeLabel}</span>
        <b>{props.route}</b>
      </div>
      <div className={s.detailRow}>
        <span>{w.slippage}</span>
        <div className={s.slips}>
          {SLIPPAGES.map((bps) => (
            <button key={bps} className={`${s.slip} ${props.slippageBps === bps ? s.slipOn : ''}`} onClick={() => props.onSlippage(bps)} disabled={props.disabled} aria-pressed={props.slippageBps === bps}>
              {pctText(bps, props.lang)}
            </button>
          ))}
        </div>
      </div>
      <div className={s.detailRow}>
        <span>{w.priority}</span>
        <b>{w.priorityLine}</b>
      </div>
      {props.network && (
        <div className={s.detailRow}>
          <span>{w.network}</span>
          <b>{props.network === 'solana:devnet' ? w.devnet : w.mainnet}</b>
        </div>
      )}
    </div>
  );
}

function Working({ phase, wallet, units, side, lang }: { phase: TradePhase | null; wallet: string | null; units: { token: string; tokenDecimals: number; pair: string; pairDecimals: number } | null; side: Side; lang: Lang }) {
  const w = useWords(LAUNCH_TRADE);
  let title = w.build;
  let line = w.buildLine;
  if (phase?.step === 'sign') {
    title = w.confirmIn(phase.wallet || wallet || '');
    const minimum = units ? `${unitsText(rawToNumber(phase.minimumOutRaw, side === 'buy' ? units.tokenDecimals : units.pairDecimals), 'down', lang)} ${side === 'buy' ? units.token : units.pair}` : '';
    line = phase.again ? w.signAgain : w.signLine(minimum);
  } else if (phase?.step === 'send') {
    title = w.sending;
    line = w.sendingLine;
  }
  return (
    <div className={s.working} role="status" aria-live="polite">
      <span className={s.spinner} aria-hidden="true" />
      <div>
        <div className={`${s.display} ${s.workingTitle}`}>{title}</div>
        <div className={s.workingLine}>{line}</div>
      </div>
    </div>
  );
}

function Done({ phase, receipt, symbol, units, lang, onAgain }: { phase: Extract<TradePhase, { step: 'done' }>; receipt: 'wait' | 'done' | 'failed' | null; symbol: string; units: { tokenDecimals: number; pair: string; pairDecimals: number } | null; lang: Lang; onAgain: () => void }) {
  const w = useWords(LAUNCH_TRADE);
  const { done } = phase;
  const filled = done.filled && units ? done.filled : null;
  const title = !filled
    ? w.pending
    : done.side === 'buy'
      ? w.bought(unitsText(rawToNumber(filled.tokensRaw, units!.tokenDecimals), 'down', lang), symbol)
      : w.sold(unitsText(rawToNumber(filled.pairRaw, units!.pairDecimals), 'down', lang), units!.pair);
  const fee = units ? `${unitsText(rawToNumber(done.feeRaw, units.pairDecimals), 'up', lang)} ${units.pair}` : null;
  return (
    <div className={s.done} role="status">
      <div className={`${s.display} ${s.doneTitle}`}>
        <span className={s.check} aria-hidden="true">
          ✓
        </span>
        {title}
      </div>
      <div className={s.receipt}>
        {fee && <span>{w.feePaid(fee)}</span>}
        <span className={receipt === 'done' ? s.receiptOk : receipt === 'failed' ? s.receiptBad : ''}>{receipt === 'done' ? w.receiptDone : receipt === 'failed' ? w.receiptFailed : w.receiptWait}</span>
        <a href={explorerUrl(done.signature, done.network)} target="_blank" rel="noreferrer">
          {w.explorer} ↗
        </a>
      </div>
      <button className={`${s.display} ${s.again}`} onClick={onAgain}>
        {w.again}
      </button>
    </div>
  );
}

function WalletList({ options, connecting, onPick, empty, opening }: { options: readonly WalletOption[]; connecting: string | null; onPick: (name: string) => void; empty: string; opening: (name: string) => string }) {
  if (!options.length) return <div className={s.closed}>{empty}</div>;
  return (
    <div className={s.wallets} role="list">
      {options.map((option) => (
        <button key={option.name} role="listitem" className={s.walletPick} onClick={() => onPick(option.name)} disabled={connecting !== null}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {option.icon ? <img src={option.icon} alt="" /> : <span className={s.walletBlank} />}
          <span>{connecting === option.name ? opening(option.name) : option.name}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

/** A tick a second, for the fee's fall. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
