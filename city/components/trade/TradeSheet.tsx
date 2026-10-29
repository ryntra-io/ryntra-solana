'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useCity } from '@/city/lib/city/store';
import type { Tower } from '@/city/lib/market/types';
import { colourOf } from '@/city/lib/trade/colour';
import { decimalsOf, figuresOf, type Figures } from '@/city/lib/trade/figures';
import { defaultFrame, fitFrame, moveFrame, readFrame, resizeFrame, standingOf, windowed, writeFrame, type Corner, type Frame } from '@/city/lib/trade/frame';
import { formatUnits, ticker } from '@/city/lib/trade/format';
import { SPOT_OPEN } from '@/city/lib/trade/gates';
import { SPOT_BUSY, SPOT_IDLE, useSpot } from '@/city/lib/trade/spot-store';
import { balanceOf, BUSY, choiceOf, payKey, reviewNotes, useTrade, type Choice, type Mode, type Review, type TowerRef } from '@/city/lib/trade/store';
import { isBase, unitOf, type PayAsset, type Side } from '@/city/lib/trade/tiles';
import { quarterStore } from '@/city/lib/quarter/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { clipName, MOMENT_BEATS, momentFigure, momentSubject, recordMoment, type Moment } from '@/city/lib/trade/moment';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { openExternal, shareThroughApp } from '@/city/lib/app-bridge/page';
import { coinLink } from '@/city/lib/share/coin-link';
import { useRyntraApp } from '@/city/lib/app-mode';
import { CloseGlyph } from '../hud/glyphs';
import { AmountPart } from './Amount';
import { CoinPicker, type PickerKind } from './CoinPicker';
import { SpotTicket } from './SpotTicket';
import { WalletLine, WalletPicker } from './WalletParts';
import s from './trade.module.css';

/**
 * The trade card: a plain financial card over the city. The amount is a share of the balance or typed; before the one
 * amber tap it shows what you get, Ryntra's fee, the route, the least you get and the price impact — every figure from
 * the engine. The person signs in their own wallet. No game motion inside the card: the city celebrates outside it.
 * On a computer the card is a window: dragged by its head, stretched by any corner; on a phone, the bottom sheet.
 */
export function TradeSheet() {
  const tower = useTrade((st) => st.tower);
  const phase = useTrade((st) => st.phase);
  const spotPhase = useSpot((st) => st.phase);
  const close = useTrade((st) => st.close);
  const live = useCity((st) => (tower ? (st.snapshot.towers.find((t) => t.id === tower.mint) ?? null) : null));
  const { frame, onHeadDown, onCornerDown } = useFrame();
  const dialog = useRef<HTMLDivElement>(null);
  const windowedNow = Boolean(frame);
  const mint = tower?.mint ?? null;
  // On a computer the window takes the keyboard when it opens; Escape still closes it (TradeLayer).
  useEffect(() => {
    if (!windowedNow || !mint) return;
    const node = dialog.current;
    if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
  }, [windowedNow, mint]);
  if (!tower) return null;
  const busy = BUSY.has(phase) || SPOT_BUSY.has(spotPhase);
  const card = (
    <div ref={dialog} tabIndex={-1} className={`${s.sheet} ${frame ? s.floating : ''}`} role="dialog" aria-label={`Trade ${ticker(tower.symbol)}`}>
      <div className={`${s.head} ${frame ? s.grab : ''}`} onPointerDown={frame ? onHeadDown : undefined}>
        <TokenIcon tower={tower} />
        <div className={s.title}>
          <div className={`${s.display} ${s.symbol}`}>{ticker(tower.symbol)}</div>
          {live && <PriceLine tower={live} />}
        </div>
        <button className={s.close} aria-label="Close" onClick={close} disabled={busy}>
          <CloseGlyph />
        </button>
      </div>
      {phase === 'done' ? <DonePanel /> : phase === 'failed' ? <FailedPanel /> : phase === 'unknown' ? <UnknownPanel /> : <TradeBody tower={tower} />}
    </div>
  );
  if (!frame) return card;
  // Anchored by its bottom edge: a taller card grows upward into the free room, then scrolls with its action pinned.
  const stand = standingOf(frame, viewport());
  return (
    <div className={s.window} style={{ left: stand.left, bottom: stand.bottom, width: stand.width, minHeight: stand.minHeight, maxHeight: stand.maxHeight }}>
      {card}
      <span className={`${s.corner} ${s.cornerNw}`} aria-hidden="true" onPointerDown={(event) => onCornerDown(event, 'nw')} />
      <span className={`${s.corner} ${s.cornerNe}`} aria-hidden="true" onPointerDown={(event) => onCornerDown(event, 'ne')} />
      <span className={`${s.corner} ${s.cornerSw}`} aria-hidden="true" onPointerDown={(event) => onCornerDown(event, 'sw')} />
      <span className={`${s.corner} ${s.cornerSe}`} aria-hidden="true" onPointerDown={(event) => onCornerDown(event, 'se')} />
    </div>
  );
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const local = () => window.localStorage;

/**
 * The card's window on a computer: where it stands and how big it is, remembered in this browser. Null on a phone,
 * where the card is the bottom sheet.
 */
function useFrame() {
  const [frame, setFrame] = useState<Frame | null>(null);
  const drag = useRef<{ kind: 'move' | Corner; x: number; y: number; start: Frame } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const view = viewport();
      if (!windowed(view)) return setFrame(null);
      setFrame((now) => fitFrame(now ?? readFrame(local) ?? defaultFrame(view), view));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  const begin = (event: ReactPointerEvent<HTMLElement>, kind: 'move' | Corner) => {
    if (!frame || event.button !== 0) return;
    event.preventDefault();
    drag.current = { kind, x: event.clientX, y: event.clientY, start: frame };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const now = drag.current;
      if (!now) return;
      const dx = move.clientX - now.x;
      const dy = move.clientY - now.y;
      setFrame(now.kind === 'move' ? moveFrame(now.start, dx, dy, viewport()) : resizeFrame(now.start, now.kind, dx, dy, viewport()));
    };
    const onUp = () => {
      drag.current = null;
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setFrame((now) => {
        if (now) writeFrame(local, now);
        return now;
      });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return {
    frame,
    // The close button in the head stays a button, never a handle.
    onHeadDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!(event.target as HTMLElement).closest('button')) begin(event, 'move');
    },
    onCornerDown: (event: ReactPointerEvent<HTMLElement>, corner: Corner) => begin(event, corner),
  };
}

/** Which coin the card's picker is choosing: the one paid with or paid in, or the coin traded itself. */
type Picking = Readonly<{ kind: PickerKind; target: 'counter' | 'subject' }>;

function TradeBody({ tower }: { tower: TowerRef }) {
  const side = useTrade((st) => st.side);
  const pay = useTrade((st) => st.pay);
  const other = useTrade((st) => st.other);
  const storeMode = useTrade((st) => st.mode);
  const typed = useTrade((st) => st.typed);
  const phase = useTrade((st) => st.phase);
  const auto = useTrade((st) => st.auto);
  const setSide = useTrade((st) => st.setSide);
  const setMode = useTrade((st) => st.setMode);
  const setShare = useTrade((st) => st.setShare);
  const setPay = useTrade((st) => st.setPay);
  const setTyped = useTrade((st) => st.setTyped);
  const pickCoin = useTrade((st) => st.pickCoin);
  const spotPhase = useSpot((st) => st.phase);
  const holdings = useWallet((st) => st.holdings);
  const [picking, setPicking] = useState<Picking | null>(null);

  const choice = choiceOf(tower, side, holdings, { pay, typed, other });
  // Limit and Stop exist only behind their switch: shut, the card is the market ticket whatever the store says.
  const mode = SPOT_OPEN ? storeMode : 'market';
  const owned = balanceOf(holdings, tower.mint);
  const sellable = Boolean(owned && owned.spendableRaw !== '0');
  // A limit or a stop under way holds the card the way a market trade does.
  const idle = phase === 'idle' && (mode === 'market' || SPOT_IDLE.has(spotPhase));
  // An order the card builds by itself never shuts the field: typing on drops that order.
  const typable = idle || (phase === 'preparing' && auto);

  // A placed limit or a set stop is said on its own, without the fields it was made from.
  if (mode !== 'market' && SPOT_RESULT.has(spotPhase)) return <SpotTicket tower={tower} choice={choice} mode={mode} getChips={null} />;

  if (picking) {
    const counter = picking.target === 'counter';
    const title = counter ? (side === 'buy' ? 'Pay with' : 'Get') : side === 'buy' ? 'Get' : 'Sell';
    return (
      <CoinPicker
        kind={picking.kind}
        title={title}
        exclude={[tower.mint]}
        onBack={() => setPicking(null)}
        onPick={(asset) => {
          setPicking(null);
          if (counter) pickCoin(asset);
          else retarget(asset, side, mode);
        }}
      />
    );
  }

  const balance = choice.holding;
  // Buying, the wallet pays and the search finds what to get; selling, the wallet holds what is sold and the search
  // finds what to be paid in.
  const pickCounter = () => setPicking({ kind: side === 'buy' ? 'wallet' : 'search', target: 'counter' });
  const pickSubject = () => setPicking({ kind: side === 'buy' ? 'search' : 'wallet', target: 'subject' });
  const subjectChip = <SubjectChip tower={tower} side={side} onPick={pickSubject} disabled={!idle} />;
  const holds = (mint: string) => {
    const balance = balanceOf(holdings, mint);
    return balance === null || balance.spendableRaw !== '0';
  };
  const payChips = <PaySwitch choice={choice} onPick={setPay} onMore={pickCounter} disabled={!idle} label={side === 'buy' ? 'Pay with' : 'Sell for'} held={side === 'buy' ? holds : undefined} />;

  return (
    <>
      {SPOT_OPEN && (
        <div className={s.modes} role="tablist" aria-label="Order type">
          {MODES.map((id) => (
            <button key={id} role="tab" aria-selected={mode === id} className={`${s.mode} ${mode === id ? s.modeOn : ''}`} onClick={() => setMode(id)} disabled={!idle}>
              {MODE_WORDS[id]}
            </button>
          ))}
        </div>
      )}
      {(sellable || side === 'sell') && (
        <div className={s.sides} role="tablist" aria-label="Buy or sell">
          {(['buy', 'sell'] as const).map((id) => (
            <button key={id} role="tab" aria-selected={side === id} className={`${s.side} ${side === id ? s.sideOn : ''}`} onClick={() => setSide(id)} disabled={!idle}>
              {id === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>
      )}
      <div className={`${s.row} ${s.rowWrap}`}>
        <span className={s.labelGroup}>
          <span className={s.label}>{side === 'buy' ? 'You pay' : 'You sell'}</span>
          {side === 'buy' ? payChips : subjectChip}
        </span>
        {balance && choice.spendDecimals !== null && (
          <span className={s.balance}>
            You have {formatUnits(balance.spendableRaw, choice.spendDecimals, 'down')} {choice.spendUnit}
          </span>
        )}
      </div>
      <AmountPart choice={choice} typed={typed} typable={typable} onType={setTyped} onShare={setShare} />
      {mode === 'market' ? (
        <MarketPart tower={tower} choice={choice} getChips={side === 'buy' ? subjectChip : payChips} />
      ) : (
        <SpotTicket tower={tower} choice={choice} mode={mode} getChips={side === 'buy' ? subjectChip : payChips} />
      )}
    </>
  );
}

const MODES = ['market', 'limit', 'stop'] as const;
const SPOT_RESULT: ReadonlySet<string> = new Set(['placed', 'set', 'failed', 'unclear']);
const MODE_WORDS: Record<Mode, string> = { market: 'Market', limit: 'Limit', stop: 'Stop' };

/**
 * Another coin to trade on the same card: a tower is flown to, its card under this one, and any other coin has no
 * tower to show. The side, the way to trade and what is paid with stay as they were.
 */
function retarget(asset: PayAsset, side: Side, mode: Mode) {
  const city = useCity.getState();
  city.select(city.layout.towers.some((placed) => placed.tower.id === asset.mint) ? asset.mint : null);
  useTrade.getState().openFor({ id: asset.mint, symbol: asset.symbol, name: asset.name ?? asset.symbol, icon: asset.icon ?? null }, side, { mode });
}

/** The market ticket: what you get at the engine's price, its terms, and the one amber tap. */
function MarketPart({ tower, choice, getChips }: { tower: TowerRef; choice: Choice; getChips: ReactNode }) {
  const side = useTrade((st) => st.side);
  const quote = useTrade((st) => st.quote);
  const review = useTrade((st) => st.review);
  const notice = useTrade((st) => st.notice);
  const press = useTrade((st) => st.press);
  const refreshQuote = useTrade((st) => st.refreshQuote);
  const connection = useWallet((st) => st.connection);
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);

  const shown = review && review.key === choice.key ? review : null;
  const priced = quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  const getSymbol = side === 'buy' ? ticker(tower.symbol) : unitOf(choice.pay);
  const outputDecimals = shown ? decimalsOf(shown.order, choice.outputMint) : priced ? decimalsOf(priced, choice.outputMint) : null;
  const figures = useMemo<Figures | null>(() => {
    if (outputDecimals === null) return null;
    if (shown) return figuresOf(shown.order.order, outputDecimals, 'order');
    return priced ? figuresOf(priced.order, outputDecimals, 'quote') : null;
  }, [shown, priced, outputDecimals]);

  // A wallet that connects closes the list of wallets.
  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);

  const tap = async () => {
    if ((await press()) !== 'connect') return;
    // One wallet in this browser: ask it straight away; several: let the person pick.
    const { wallets, connect } = useWallet.getState();
    if (wallets.length === 1) void connect(wallets[0]!.name);
    else setPicking(true);
  };

  return (
    <>
      <div className={s.row}>
        <span className={s.labelGroup}>
          <span className={s.label}>{figures && !shown ? 'You get about' : 'You get'}</span>
          {getChips}
        </span>
      </div>
      <div className={s.get} aria-live="polite">
        {choice.problem ? (
          <span className={`${s.display} ${s.getFigure} ${s.getWaiting}`}>—</span>
        ) : figures ? (
          <>
            <span className={`${s.display} ${s.getFigure}`}>{figures.get}</span>
            <span className={`${s.display} ${s.getSymbol}`}>{getSymbol}</span>
          </>
        ) : (quote.status === 'error' && quote.key === choice.key) || !choice.amountRaw ? (
          <span className={`${s.display} ${s.getFigure} ${s.getWaiting}`}>—</span>
        ) : (
          <span className={s.shimmer} aria-label="Getting the price" />
        )}
      </div>
      {figures && <Terms figures={figures} exact={Boolean(shown)} getSymbol={getSymbol} open={details} onInfo={() => setDetails((v) => !v)} />}
      {figures && details && <Details figures={figures} review={shown} quoteAt={quote.status === 'ready' ? quote.at : null} getSymbol={getSymbol} />}
      <Notes review={shown} problem={choice.problem?.text ?? null} quoteError={quote.status === 'error' && quote.key === choice.key ? quote.refusal.message : null} notice={notice} />
      {picking && !connection ? (
        <WalletPicker onBack={() => setPicking(false)} />
      ) : (
        <Action choice={choice} side={side} tower={tower} exact={Boolean(shown)} priced={Boolean(priced)} quoteFailed={quote.status === 'error' && quote.key === choice.key && quote.refusal.retryable} onPress={tap} onRetry={() => void refreshQuote()} />
      )}
      <WalletLine />
    </>
  );
}

/**
 * What the card pays with or is paid in: SOL, USDC and the other coin the person picked as chips, and one more chip
 * for any other coin — the wallet's when paying, the search's when being paid.
 */
function PaySwitch({ choice, onPick, onMore, disabled, label, held }: { choice: Choice; onPick: (key: string) => void; onMore: () => void; disabled: boolean; label: string; held?: (mint: string) => boolean }) {
  // Paying, only a coin the wallet holds is offered; a coin found to be paid in waits for the sale side.
  const others = choice.options.filter((asset) => !isBase(asset) && (!held || asset.mint === choice.pay.mint || held(asset.mint)));
  return (
    <span className={s.pays} role="radiogroup" aria-label={label}>
      {choice.options.filter(isBase).map((asset) => (
        <button key={asset.mint} role="radio" aria-checked={asset.mint === choice.pay.mint} className={`${s.payChip} ${asset.mint === choice.pay.mint ? s.payOn : ''}`} onClick={() => onPick(payKey(asset))} disabled={disabled}>
          {asset.symbol}
        </button>
      ))}
      {others.map((asset) => (
        <button
          key={asset.mint}
          role="radio"
          aria-checked={asset.mint === choice.pay.mint}
          className={`${s.payChip} ${asset.mint === choice.pay.mint ? s.payOn : ''}`}
          onClick={() => (asset.mint === choice.pay.mint ? onMore() : onPick(payKey(asset)))}
          disabled={disabled}
        >
          {unitOf(asset)}
        </button>
      ))}
      <button className={`${s.payChip} ${s.moreChip}`} onClick={onMore} disabled={disabled} aria-label={label === 'Pay with' ? 'Pay with another coin' : 'Get another coin'}>
        {others.length ? <ChevronGlyph /> : <>More <ChevronGlyph /></>}
      </button>
    </span>
  );
}

/** The coin the card trades, with the way to trade another: any coin to get when buying, a coin of the wallet when selling. */
function SubjectChip({ tower, side, onPick, disabled }: { tower: TowerRef; side: Side; onPick: () => void; disabled: boolean }) {
  return (
    <span className={s.pays}>
      <button className={`${s.payChip} ${s.payOn}`} onClick={onPick} disabled={disabled} aria-label={side === 'buy' ? `Getting ${ticker(tower.symbol)}. Get another coin` : `Selling ${ticker(tower.symbol)}. Sell another coin`}>
        {ticker(tower.symbol)} <ChevronGlyph />
      </button>
    </span>
  );
}

function ChevronGlyph() {
  return (
    <svg className={s.chevron} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}

/** The terms before the signature, in one line: fee, route, the least you get, price impact. */
function Terms({ figures, exact, getSymbol, open, onInfo }: { figures: Figures; exact: boolean; getSymbol: string; open: boolean; onInfo: () => void }) {
  const impactClass = figures.impactLevel === 'high' ? s.high : figures.impactLevel === 'notable' ? s.notable : '';
  return (
    <div className={s.terms}>
      <span className={s.termsText}>
        {figures.fee ? (
          <>
            Fee <b>{figures.fee}</b>
          </>
        ) : (
          'No Ryntra fee'
        )}
        {' · '}
        {figures.route}
        {exact && (
          <>
            {' · at least '}
            <b>
              {figures.minimum} {getSymbol}
            </b>
          </>
        )}
        {' · impact '}
        <b className={impactClass}>{figures.impact}</b>
      </span>
      <button className={`${s.info} ${open ? s.infoOn : ''}`} aria-label="Trade details" aria-expanded={open} onClick={onInfo}>
        i
      </button>
    </div>
  );
}

const RISK_WORDS: Record<string, string> = {
  NO_KNOWN_BLOCKER: 'No known blocker (not a safety rating)',
  REVIEW_REQUIRED: 'Needs care',
  BLOCKED: 'Blocked',
  INCOMPLETE: 'Not fully read',
};

function Details({ figures, review, quoteAt, getSymbol }: { figures: Figures; review: Review | null; quoteAt: number | null; getSymbol: string }) {
  const risk = review?.order.risk.verdict;
  const route = review ? review.order.order.route.map((hop) => hop.label).join(' → ') : figures.route;
  return (
    <dl className={s.details}>
      <dt>Ryntra fee</dt>
      <dd>{figures.fee ?? 'None'}</dd>
      <dt>Route</dt>
      <dd>{route || figures.route}</dd>
      <dt>You get at least</dt>
      <dd>{review ? `${figures.minimum} ${getSymbol}` : 'Set when your order is built'}</dd>
      <dt>Price impact</dt>
      <dd>{figures.impact}</dd>
      {review && (
        <>
          <dt>Slippage</dt>
          <dd>{figures.slippage}</dd>
          {figures.networkSol && (
            <>
              <dt>Network fee</dt>
              <dd>{figures.networkSol} SOL</dd>
            </>
          )}
          {figures.depositSol && (
            <>
              <dt>New token account</dt>
              <dd>{figures.depositSol} SOL, once</dd>
            </>
          )}
          {risk && (
            <>
              <dt>Risk check</dt>
              <dd>{RISK_WORDS[risk] ?? risk}</dd>
            </>
          )}
        </>
      )}
      <dt>Price</dt>
      <dd>Jupiter{quoteAt ? `, ${new Date(quoteAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</dd>
    </dl>
  );
}

/** One line: what is wrong with a typed amount, the engine's warning over the order, a refusal, or what just happened. */
function Notes({ review, problem, quoteError, notice }: { review: Review | null; problem: string | null; quoteError: string | null; notice: Readonly<{ tone: string; text: string }> | null }) {
  const warnings = reviewNotes(review);
  const caution = review?.order.risk.verdict === 'REVIEW_REQUIRED' ? review.order.risk.findings.find((f) => f.outcome === 'REVIEW_REQUIRED')?.detail : null;
  const line = (problem ? { tone: 'error', text: problem } : null) ?? notice ?? (warnings[0] ? { tone: 'warn', text: warnings[0] } : caution ? { tone: 'warn', text: caution } : quoteError ? { tone: 'error', text: quoteError } : null);
  if (!line) return null;
  const tone = line.tone === 'warn' ? s.noticeWarn : line.tone === 'error' ? s.noticeError : '';
  return (
    <div className={`${s.notice} ${tone}`} role={line.tone === 'error' ? 'alert' : 'status'}>
      {line.text}
    </div>
  );
}

function Action({
  choice,
  side,
  tower,
  exact,
  priced,
  quoteFailed,
  onPress,
  onRetry,
}: {
  choice: Choice;
  side: 'buy' | 'sell';
  tower: TowerRef;
  exact: boolean;
  priced: boolean;
  quoteFailed: boolean;
  onPress: () => void;
  onRetry: () => void;
}) {
  const phase = useTrade((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => st.connecting);
  const verb = `${side === 'buy' ? 'Buy' : 'Sell'} ${ticker(tower.symbol)}`;
  let label = verb;
  let disabled = false;
  let waiting = false;
  if (phase === 'preparing') [label, disabled, waiting] = ['Getting your order…', true, true];
  else if (phase === 'wallet') [label, disabled, waiting] = [`Confirm in ${connection?.wallet ?? 'your wallet'}`, true, true];
  else if (phase === 'sending') [label, disabled, waiting] = ['Sending…', true, true];
  else if (phase === 'checking') [label, disabled, waiting] = ['Reading the network…', true, true];
  else if (connecting) [label, disabled, waiting] = ['Connecting…', true, true];
  else if (choice.problem?.kind === 'balance') [label, disabled] = [`Not enough ${choice.spendUnit}`, true];
  else if (choice.problem) [label, disabled] = [verb, true];
  else if (!connection) label = 'Connect wallet';
  // Nothing in the field: a wallet with nothing to spend says so; otherwise the verb waits for an amount.
  else if (!choice.amountRaw) [label, disabled] = [choice.sizing.max === '0' ? (side === 'sell' ? 'Nothing to sell' : `Not enough ${choice.spendUnit}`) : verb, true];
  else if (quoteFailed && !exact) return (
    <div className={s.dock}>
      <button className={`${s.display} ${s.action}`} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
  else if (!priced && !exact) [label, disabled] = [verb, true];
  return (
    <div className={s.dock}>
      <button className={`${s.display} ${s.action} ${waiting ? s.waiting : ''}`} onClick={onPress} disabled={disabled}>
        {label}
      </button>
    </div>
  );
}

function DonePanel() {
  const done = useTrade((st) => st.done);
  const close = useTrade((st) => st.close);
  const again = useTrade((st) => st.again);
  if (!done) return null;
  const { trade, side, tower, pay, decimals } = done;
  const coin = ticker(tower.symbol);
  const paid = unitOf(pay);
  const got = trade.outputRaw && decimals[trade.outputMint] !== undefined ? formatUnits(trade.outputRaw, decimals[trade.outputMint]!, 'down') : null;
  const gave = trade.inputRaw && decimals[trade.inputMint] !== undefined ? formatUnits(trade.inputRaw, decimals[trade.inputMint]!) : null;
  const bought = side === 'buy';
  return (
    <>
      <div className={s.kicker}>{bought ? 'You’re in' : 'Sold'}</div>
      <div className={`${s.display} ${s.result}`}>{got ? `${got} ${bought ? coin : paid}` : bought ? `${coin} is yours` : 'Done'}</div>
      <div className={s.resultLine}>
        {gave ? `For ${gave} ${bought ? paid : coin}. ` : ''}
        {bought ? 'Your tower glows in your colour.' : 'Read back from the chain.'}
      </div>
      <WalletLine />
      <div className={s.grow} />
      <MomentShare key={trade.signature} towerId={tower.mint} symbol={coin} kicker={bought ? 'You’re in' : 'Sold'} got={got} unit={bought ? coin : paid} line={gave ? `For ${gave} ${bought ? paid : coin} · on Ryntra` : 'On Ryntra'} onAgain={again} />
      <div className={s.walletLine}>
        <a className={s.explorer} href={explorerTxUrl('mainnet', trade.signature)} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
        <button className={s.link} onClick={close}>
          Close
        </button>
      </div>
    </>
  );
}

/**
 * The moment of the trade, made from the city: the camera flies to the tower, it takes your colour and throws
 * fireworks while a clip records; then the clip loops here, ready for X or the phone's share sheet.
 */
function MomentShare({ towerId, symbol, kicker, got, unit, line, onAgain }: { towerId: string; symbol: string; kicker: string; got: string | null; unit: string; line: string; onAgain: () => void }) {
  const address = useWallet((st) => st.connection?.address ?? null);
  const [moment, setMoment] = useState<Moment | null>(null);
  const [state, setState] = useState<'making' | 'ready' | 'shared' | 'saved'>('making');
  // In the Ryntra app the clip goes to the app's own share sheet through the bridge (CITY-6b): the button says so.
  const app = useRyntraApp();
  const url = useMemo(() => (moment?.video ? URL.createObjectURL(moment.video) : moment?.still ? URL.createObjectURL(moment.still) : null), [moment]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  useEffect(() => {
    let alive = true;
    const city = useCity.getState();
    const colour = address ? colourOf(address) : '#FFB23F';
    // In my quarter the camera is the quarter's: the clip films what it sees, framed on the building of this coin.
    // In the city the camera flies to the coin's tower, if the city has one; a coin without a tower is never
    // selected (a selection of a missing tower holds the city's moments and its idle orbit until something clears it).
    const inQuarter = quarterStore.getState().mode !== 'city';
    const subject = inQuarter ? momentSubject(towerId) : null;
    const tower = !inQuarter && city.layout.towers.some((t) => t.tower.id === towerId);
    if (tower) city.select(towerId);
    void recordMoment({ kicker, ...momentFigure(got), unit, line, colour }, (beat) => {
      const st = useCity.getState();
      if (tower) st.play({ kind: 'pump', towerId, symbol, value: '', title: '' });
      else subject?.burst(colour);
      st.shake(beat === MOMENT_BEATS.length - 1 ? 0.45 : 0.25);
    }, { focus: subject?.focus }).then((made) => {
      if (!alive) return;
      setMoment(made);
      setState('ready');
    });
    return () => {
      alive = false;
    };
    // One moment per trade: the key on this component is the signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const words = `${kicker === 'Sold' ? 'Sold' : 'I’m in'} ${got ? `${got} ` : ''}${unit} on Ryntra. Every Solana coin is a tower.`;
  const file = (): File | null => {
    if (moment?.video) return new File([moment.video], clipName(symbol, moment.type), { type: moment.video.type });
    if (moment?.still) return new File([moment.still], clipName(symbol, null).replace(/\.\w+$/, '.png'), { type: 'image/png' });
    return null;
  };
  const post = async () => {
    const f = file();
    // The system share sheet is a phone's way to post a clip. On a computer it is the system's own panel, which many
    // close without posting: there the clip is saved and X opens with the words, ready for the clip.
    const phone = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    // In the Ryntra app the clip goes to the app's own share sheet.
    const viaApp = f ? await shareThroughApp(f, f.name, words) : null;
    if (viaApp) {
      if (viaApp === 'shared') setState('shared');
      return;
    }
    if (f && phone && navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f], text: words });
        setState('shared');
      } catch {
        // The person closed the share sheet.
      }
      return;
    }
    if (f) download(f);
    openExternal(`https://x.com/intent/post?text=${encodeURIComponent(words)}&url=${encodeURIComponent(coinLink(towerId))}`);
    setState('saved');
  };
  return (
    <>
      {url ? (
        moment?.video ? (
          <video className={s.card} src={url} autoPlay loop muted playsInline aria-label={words} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={s.card} src={url} alt={words} />
        )
      ) : (
        <div className={`${s.notice}`}>{state === 'making' ? 'Filming your moment in the city…' : 'The moment could not be filmed on this device.'}</div>
      )}
      {state === 'saved' && <div className={s.notice}>Clip saved. Attach it to your post on X.</div>}
      <div className={s.pair}>
        <button className={`${s.display} ${s.action} ${state === 'making' ? s.waiting : ''}`} onClick={() => void post()} disabled={state === 'making' || !url}>
          {state === 'making' ? 'Filming…' : app ? 'Share clip' : 'Post on X'}
        </button>
        <button
          className={s.quiet}
          onClick={() => {
            const f = file();
            if (f) download(f);
            else onAgain();
          }}
          disabled={state === 'making'}
        >
          {url ? 'Save' : 'Again'}
        </button>
      </div>
    </>
  );
}

function download(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

function FailedPanel() {
  const signature = useTrade((st) => st.failed);
  const again = useTrade((st) => st.again);
  return (
    <>
      <div className={`${s.kicker} ${s.kickerDanger}`}>Didn’t go through</div>
      <div className={s.resultLine}>The trade reached the chain and failed. Only the network fee was spent.</div>
      <div className={s.grow} />
      <button className={`${s.display} ${s.action}`} onClick={again}>
        Try again
      </button>
      {signature && (
        <a className={s.explorer} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      )}
    </>
  );
}

function UnknownPanel() {
  const unknown = useTrade((st) => st.unknown);
  const press = useTrade((st) => st.press);
  return (
    <>
      <div className={`${s.kicker} ${s.kickerWarn}`}>Still checking</div>
      <div className={s.resultLine}>{unknown?.message ?? 'The outcome is not known yet. Do not send another; check again.'}</div>
      <div className={s.grow} />
      <button className={`${s.display} ${s.action}`} onClick={() => void press()}>
        Check again
      </button>
      {unknown && (
        <a className={s.explorer} href={explorerTxUrl('mainnet', unknown.signature)} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      )}
    </>
  );
}

function PriceLine({ tower }: { tower: Tower }) {
  const up = tower.change24h >= 0;
  return (
    <div className={s.priceLine}>
      {price(tower.price)}{' '}
      <span className={up ? s.up : s.down}>
        {up ? '+' : '−'}
        {Math.abs(tower.change24h).toFixed(1)}% <small>24H</small>
      </span>
    </div>
  );
}

/** The coin's logo through Ryntra's own proxy; a logo it cannot bring leaves the plain disc. */
function TokenIcon({ tower }: { tower: TowerRef }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={s.icon} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.icon} src={`/api/icon/${tower.mint}`} alt="" draggable={false} onError={() => setFailed(true)} />;
}

function price(p: number): string {
  if (!(p > 0)) return '';
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  const digits = Math.max(2, -Math.floor(Math.log10(p)) + 2);
  return `$${p.toFixed(Math.min(digits, 10))}`;
}
