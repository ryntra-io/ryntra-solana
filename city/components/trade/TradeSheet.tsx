'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { iconAttempt, ICON_RETRY_MS, iconSource, monogram } from '@/city/lib/chart/icon';
import { useCity } from '@/city/lib/city/store';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import type { Tower } from '@/city/lib/market/types';
import { colourOf } from '@/city/lib/trade/colour';
import { decimalsOf, figuresOf, type Figures } from '@/city/lib/trade/figures';
import { formatUnits, ticker } from '@/city/lib/trade/format';
import { SPOT_OPEN, TRADE_OPEN } from '@/city/lib/trade/gates';
import { SPOT_IDLE, useSpot } from '@/city/lib/trade/spot-store';
import { balanceOf, choiceOf, payKey, reviewNotes, useTrade, type Choice, type Mode, type Review, type TowerRef } from '@/city/lib/trade/store';
import { sellLine, sellWords, towerRank, type SellLine } from '@/city/lib/trade/tower-window';
import { isBase, unitOf, type PayAsset, type Side } from '@/city/lib/trade/tiles';
import { quarterStore } from '@/city/lib/quarter/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { cardName, MOMENT_BEATS, momentCard, momentFigure, momentSubject } from '@/city/lib/trade/moment';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { openExternal, shareThroughApp } from '@/city/lib/app-bridge/page';
import { coinLink } from '@/city/lib/share/coin-link';
import { useRyntraApp } from '@/city/lib/app-mode';
import { BeaconAction } from '../beacon/BeaconAction';
import { FuturesAction } from '../exchange/FuturesAction';
import { LaunchTowerBody } from '../launch/LaunchTowerBody';
import { AmountPart } from './Amount';
import { CoinFacts, CoinPrice, ShareTower } from './CoinFacts';
import { CoinPicker, type PickerKind } from './CoinPicker';
import { SpotTicket } from './SpotTicket';
import { useWalletName, WalletLine, WalletPicker } from './WalletParts';
import { riskWords, TRADE, type TextKeyOfTrade } from './words';
import s from './trade.module.css';

/** The chart inside the spot window, loaded with it: the plain swap never carries the chart's code. */
const TradeChart = dynamic(() => import('../chart/ChartWindow').then((m) => m.TradeChart), {
  ssr: false,
  loading: () => <div className={s.chartWait} aria-hidden="true" />,
});

/**
 * The tower's one window (CITY-78): a tap on a tower opens it straight away, with no card of its own beside it. On top
 * the coin — its price, the day's move, the chart, its key figures, whether it is verified and what its issuer can do,
 * the rest behind «Details»; under them Buy and Sell, always both. The amount is a share of the balance or typed;
 * before the one amber tap it shows what you get, Ryntra's fee, the route, the least you get and the price impact —
 * every figure from the engine. The person signs in their own wallet. No game motion inside the card: the city
 * celebrates outside it. It stands in the city's one window frame (CITY-65, `TradeLayer`): moved, stretched by any edge,
 * the whole screen on a computer, the bottom sheet on a phone. Spot in a wide window puts the chart left of the ticket.
 */
export function TradeSheet() {
  const w = useWords(TRADE);
  const tower = useTrade((st) => st.tower);
  const phase = useTrade((st) => st.phase);
  const swap = useTrade((st) => st.view === 'swap' && !st.launch);
  const live = useCity((st) => (tower ? (st.snapshot.towers.find((t) => t.id === tower.mint) ?? null) : null));
  const towers = useCity((st) => st.layout.towers);
  const rank = live ? towerRank(towers, live.id) : 0;
  if (!tower) return null;
  return (
    <div className={`${s.sheet} ${s.framed}`} role="group" aria-label={w.tradeOf(ticker(tower.symbol))} data-trade-view={swap ? 'swap' : 'spot'}>
      {/* The frame's head says «Swap» or «Spot» and closes it; Spot names its coin here, with Share and the beacon. */}
      {!swap && (
        <div className={s.head}>
          <TokenIcon tower={tower} />
          <div className={s.title}>
            <div className={`${s.display} ${s.symbol}`}>{ticker(tower.symbol)}</div>
          </div>
          {live && <ShareTower tower={live} rank={rank} total={towers.length} />}
          {live && <BeaconAction tower={live} />}
        </div>
      )}
      {phase === 'done' ? <DonePanel /> : phase === 'failed' ? <FailedPanel /> : phase === 'unknown' ? <UnknownPanel /> : <TradeBody tower={tower} coin={live} rank={rank} />}
    </div>
  );
}

/** A launch trade's signature out holds the window as a limit's does: it is not closed under it. */
const holdWindow = (busy: boolean) => useTrade.setState({ held: busy });

/** Which coin the card's picker is choosing: the one paid with or paid in, or the coin traded itself. */
type Picking = Readonly<{ kind: PickerKind; target: 'counter' | 'subject' }>;

function TradeBody({ tower, coin, rank }: { tower: TowerRef; coin: Tower | null; rank: number }) {
  const w = useWords(TRADE);
  const side = useTrade((st) => st.side);
  const pay = useTrade((st) => st.pay);
  const other = useTrade((st) => st.other);
  const storeMode = useTrade((st) => st.mode);
  const view = useTrade((st) => st.view);
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
  const connected = useWallet((st) => Boolean(st.connection));
  const launch = useTrade((st) => st.launch);
  const [picking, setPicking] = useState<Picking | null>(null);

  // A Ryntra launch's tower: its Buy and Sell on its own curve or pool, through the Launch engine (CITY-138).
  if (launch) return <LaunchTowerBody token={tower.mint} onBusy={holdWindow} />;

  const choice = choiceOf(tower, side, holdings, { pay, typed, other });
  // Limit and Stop exist only behind their switch: shut, the card is the market ticket whatever the store says.
  const mode = SPOT_OPEN ? storeMode : 'market';
  const owned = balanceOf(holdings, tower.mint);
  // Nothing to sell: the Sell tab says so in one line, never an empty ticket.
  const nothing = sellLine(side, connected, Boolean(holdings), owned);
  // A limit or a stop under way holds the card the way a market trade does.
  const idle = phase === 'idle' && (mode === 'market' || SPOT_IDLE.has(spotPhase));
  // An order the card builds by itself never shuts the field: typing on drops that order.
  const typable = idle || (phase === 'preparing' && auto);

  // A placed limit or a set stop is said on its own, without the fields it was made from.
  if (mode !== 'market' && SPOT_RESULT.has(spotPhase)) return <SpotTicket tower={tower} choice={choice} mode={mode} getChips={null} />;

  if (picking) {
    const counter = picking.target === 'counter';
    const title = counter ? (side === 'buy' ? w.payWith : w.get) : side === 'buy' ? w.get : w.sell;
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
  const payChips = <PaySwitch choice={choice} onPick={setPay} onMore={pickCounter} disabled={!idle} label={side === 'buy' ? w.payWith : w.sellFor} held={side === 'buy' ? holds : undefined} />;

  // The plain swap: what you pay, one flip, what you get — at the market price, nothing else in the window.
  if (view === 'swap' && TRADE_OPEN) {
    const counterChip = (
      <span className={s.pays}>
        <button className={`${s.payChip} ${s.payOn}`} onClick={pickCounter} disabled={!idle} aria-label={side === 'buy' ? w.payAnother : w.getAnother}>
          {unitOf(choice.pay)} <ChevronGlyph />
        </button>
      </span>
    );
    return (
      <>
        <div className={`${s.row} ${s.rowWrap}`}>
          <span className={s.labelGroup}>
            <span className={s.label}>{w.youPay}</span>
            {side === 'buy' ? counterChip : subjectChip}
          </span>
          {balance && choice.spendDecimals !== null && (
            <span className={s.balance}>
              {w.youHave(digits(formatUnits(balance.spendableRaw, choice.spendDecimals, 'down')), choice.spendUnit)}
            </span>
          )}
        </div>
        {nothing ? <NothingToSell line={nothing} coin={ticker(tower.symbol)} /> : <AmountPart choice={choice} typed={typed} typable={typable} onType={setTyped} onShare={setShare} />}
        <button type="button" className={s.flip} onClick={() => setSide(side === 'buy' ? 'sell' : 'buy')} disabled={!idle} aria-label={w.flip}>
          <FlipGlyph />
        </button>
        {!nothing && <MarketPart tower={tower} choice={choice} getChips={side === 'buy' ? subjectChip : counterChip} />}
      </>
    );
  }

  // Spot: the price and the chart in the window (no chart opened apart), the facts and Futures under the ticket.
  const coinTop = coin && (
    <>
      <CoinPrice tower={coin} chart={false} />
      <TradeChart tower={coin} />
    </>
  );
  const coinFoot = coin && (
    <>
      <CoinFacts tower={coin} rank={rank} />
      <FuturesAction tower={coin} />
    </>
  );

  // Trading from a tower shut by its switch: the coin, and the quiet «soon» in place of the ticket.
  if (!TRADE_OPEN) {
    return (
      <>
        {coinTop}
        <button className={`${s.display} ${s.action}`} disabled>
          {w.tradeSoon}
        </button>
        {coinFoot}
      </>
    );
  }

  return (
    <div className={s.spotGrid}>
      <div className={s.spotChart}>{coinTop}</div>
      <div className={s.spotTicket}>
      {SPOT_OPEN && (
        <div className={s.modes} role="tablist" aria-label={w.orderType}>
          {MODES.map((id) => (
            <button key={id} role="tab" aria-selected={mode === id} className={`${s.mode} ${mode === id ? s.modeOn : ''}`} onClick={() => setMode(id)} disabled={!idle}>
              {w[MODE_WORDS[id]]}
            </button>
          ))}
        </div>
      )}
      <div className={s.sides} role="tablist" aria-label={w.buyOrSell}>
        {(['buy', 'sell'] as const).map((id) => (
          <button key={id} role="tab" aria-selected={side === id} className={`${s.side} ${side === id ? s.sideOn : ''}`} onClick={() => setSide(id)} disabled={!idle}>
            {id === 'buy' ? w.buy : w.sell}
          </button>
        ))}
      </div>
      {nothing ? (
        <NothingToSell line={nothing} coin={ticker(tower.symbol)} />
      ) : (
        <>
          <div className={`${s.row} ${s.rowWrap}`}>
            <span className={s.labelGroup}>
              <span className={s.label}>{side === 'buy' ? w.youPay : w.youSell}</span>
              {side === 'buy' ? payChips : subjectChip}
            </span>
            {balance && choice.spendDecimals !== null && (
              <span className={s.balance}>
                {w.youHave(digits(formatUnits(balance.spendableRaw, choice.spendDecimals, 'down')), choice.spendUnit)}
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
      )}
      {coinFoot}
      </div>
    </div>
  );
}

/**
 * The Sell tab when there is nothing to sell, in one line: no wallet yet (and the way to connect one), the wallet's
 * balances on their way, or none of the coin in it.
 */
function NothingToSell({ line, coin }: { line: SellLine; coin: string }) {
  const w = useWords(TRADE);
  const connecting = useWallet((st) => st.connecting);
  const [picking, setPicking] = useState(false);
  const connect = () => {
    // One wallet in this browser: ask it straight away; several: let the person pick.
    const { wallets, connect: open } = useWallet.getState();
    if (wallets.length === 1) void open(wallets[0]!.name);
    else setPicking(true);
  };
  return (
    <>
      <div className={s.nothing} role="status">
        {sellWords(line, coin)}
      </div>
      {line === 'connect' &&
        (picking ? (
          <WalletPicker onBack={() => setPicking(false)} />
        ) : (
          <button className={`${s.display} ${s.action} ${connecting ? s.waiting : ''}`} onClick={connect} disabled={Boolean(connecting)}>
            {connecting ? w.connecting : w.connectWallet}
          </button>
        ))}
      <WalletLine />
    </>
  );
}

const MODES = ['market', 'limit', 'stop'] as const;
const SPOT_RESULT: ReadonlySet<string> = new Set(['placed', 'set', 'failed', 'unclear']);
const MODE_WORDS: Record<Mode, TextKeyOfTrade> = { market: 'market', limit: 'limit', stop: 'stop' };

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
  const w = useWords(TRADE);
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
          <span className={s.label}>{figures && !shown ? w.youGetAbout : w.youGet}</span>
          {getChips}
        </span>
      </div>
      <div className={s.get} aria-live="polite">
        {choice.problem ? (
          <span className={`${s.display} ${s.getFigure} ${s.getWaiting}`}>—</span>
        ) : figures ? (
          <>
            <span className={`${s.display} ${s.getFigure}`}>{digits(figures.get)}</span>
            <span className={`${s.display} ${s.getSymbol}`}>{getSymbol}</span>
          </>
        ) : (quote.status === 'error' && quote.key === choice.key) || !choice.amountRaw ? (
          <span className={`${s.display} ${s.getFigure} ${s.getWaiting}`}>—</span>
        ) : (
          <span className={s.shimmer} aria-label={w.gettingPrice} />
        )}
      </div>
      {figures && details && <Details figures={figures} review={shown} quoteAt={quote.status === 'ready' ? quote.at : null} getSymbol={getSymbol} />}
      {/* The fee, the least you get, the impact and any warning stand in the pinned dock with the one action: whatever
          the card holds above them scrolls under the dock, never these lines. */}
      {picking && !connection ? (
        <>
          {figures && <Terms figures={figures} exact={Boolean(shown)} getSymbol={getSymbol} open={details} onInfo={() => setDetails((v) => !v)} />}
          <Notes review={shown} problem={choice.problem?.text ?? null} quoteError={quote.status === 'error' && quote.key === choice.key ? quote.refusal.message : null} notice={notice} />
          <WalletPicker onBack={() => setPicking(false)} />
        </>
      ) : (
        <div className={s.dock}>
          {figures && <Terms figures={figures} exact={Boolean(shown)} getSymbol={getSymbol} open={details} onInfo={() => setDetails((v) => !v)} />}
          <Notes review={shown} problem={choice.problem?.text ?? null} quoteError={quote.status === 'error' && quote.key === choice.key ? quote.refusal.message : null} notice={notice} />
          <Action choice={choice} side={side} tower={tower} exact={Boolean(shown)} priced={Boolean(priced)} quoteFailed={quote.status === 'error' && quote.key === choice.key && quote.refusal.retryable} onPress={tap} onRetry={() => void refreshQuote()} />
        </div>
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
  const w = useWords(TRADE);
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
      <button className={`${s.payChip} ${s.moreChip}`} onClick={onMore} disabled={disabled} aria-label={label === w.payWith ? w.payAnother : w.getAnother}>
        <ChevronGlyph />
      </button>
    </span>
  );
}

/** The coin the card trades, with the way to trade another: any coin to get when buying, a coin of the wallet when selling. */
function SubjectChip({ tower, side, onPick, disabled }: { tower: TowerRef; side: Side; onPick: () => void; disabled: boolean }) {
  const w = useWords(TRADE);
  return (
    <span className={s.pays}>
      <button className={`${s.payChip} ${s.payOn}`} onClick={onPick} disabled={disabled} aria-label={side === 'buy' ? w.gettingOf(ticker(tower.symbol)) : w.sellingOf(ticker(tower.symbol))}>
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
  const w = useWords(TRADE);
  const impactClass = figures.impactLevel === 'high' ? s.high : figures.impactLevel === 'notable' ? s.notable : '';
  return (
    <div className={s.terms}>
      <span className={s.termsText}>
        {figures.fee ? (
          <>
            {w.fee} <b>{figures.fee}</b>
          </>
        ) : (
          w.noRyntraFee
        )}
        {' · '}
        {figures.route}
        {exact && (
          <>
            {' · '}
            {w.atLeast}{' '}
            <b>
              {digits(figures.minimum)} {getSymbol}
            </b>
          </>
        )}
        {' · '}
        {w.impact}{' '}
        <b className={impactClass}>{digits(figures.impact)}</b>
      </span>
      <button className={`${s.info} ${open ? s.infoOn : ''}`} aria-label={w.tradeDetails} aria-expanded={open} onClick={onInfo}>
        i
      </button>
    </div>
  );
}

function Details({ figures, review, quoteAt, getSymbol }: { figures: Figures; review: Review | null; quoteAt: number | null; getSymbol: string }) {
  const w = useWords(TRADE);
  const risk = review?.order.risk.verdict;
  const route = review ? review.order.order.route.map((hop) => hop.label).join(' → ') : figures.route;
  return (
    <dl className={s.details}>
      <dt>{w.ryntraFee}</dt>
      <dd>{figures.fee ?? w.none}</dd>
      <dt>{w.route}</dt>
      <dd>{route || figures.route}</dd>
      <dt>{w.youGetAtLeast}</dt>
      <dd>{review ? `${digits(figures.minimum)} ${getSymbol}` : w.setWhenBuilt}</dd>
      <dt>{w.priceImpact}</dt>
      <dd>{digits(figures.impact)}</dd>
      {review && (
        <>
          <dt>{w.slippage}</dt>
          <dd>{digits(figures.slippage)}</dd>
          {figures.networkSol && (
            <>
              <dt>{w.networkFee}</dt>
              <dd>{digits(figures.networkSol)} SOL</dd>
            </>
          )}
          {figures.depositSol && (
            <>
              <dt>{w.newTokenAccount}</dt>
              <dd>
                {digits(figures.depositSol)} SOL{w.once}
              </dd>
            </>
          )}
          {risk && (
            <>
              <dt>{w.riskCheck}</dt>
              <dd>{riskWords(risk, w)}</dd>
            </>
          )}
        </>
      )}
      <dt>{w.price}</dt>
      <dd>Jupiter{quoteAt ? `, ${dateText(quoteAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</dd>
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
  const w = useWords(TRADE);
  const nameOf = useWalletName();
  const phase = useTrade((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => st.connecting);
  const verb = side === 'buy' ? w.buyOf(ticker(tower.symbol)) : w.sellOf(ticker(tower.symbol));
  let label = verb;
  let disabled = false;
  let waiting = false;
  if (phase === 'preparing') [label, disabled, waiting] = [w.gettingOrder, true, true];
  else if (phase === 'wallet') [label, disabled, waiting] = [connection?.wallet ? w.confirmIn(nameOf(connection.wallet)) : w.confirmInWallet, true, true];
  else if (phase === 'sending') [label, disabled, waiting] = [w.sending, true, true];
  else if (phase === 'checking') [label, disabled, waiting] = [w.readingNetwork, true, true];
  else if (connecting) [label, disabled, waiting] = [w.connecting, true, true];
  else if (choice.problem?.kind === 'balance') [label, disabled] = [w.notEnough(choice.spendUnit), true];
  else if (choice.problem) [label, disabled] = [verb, true];
  else if (!connection) label = w.connectWallet;
  // Nothing in the field: a wallet with nothing to spend says so; otherwise the verb waits for an amount.
  else if (!choice.amountRaw) [label, disabled] = [choice.sizing.max === '0' ? (side === 'sell' ? w.nothingToSell : w.notEnough(choice.spendUnit)) : verb, true];
  else if (quoteFailed && !exact) return (
    <button className={`${s.display} ${s.action}`} onClick={onRetry}>
      {w.tryAgain}
    </button>
  );
  else if (!priced && !exact) [label, disabled] = [verb, true];
  return (
    <button className={`${s.display} ${s.action} ${waiting ? s.waiting : ''}`} onClick={onPress} disabled={disabled}>
      {label}
    </button>
  );
}

function DonePanel() {
  const w = useWords(TRADE);
  const done = useTrade((st) => st.done);
  const close = useTrade((st) => st.close);
  if (!done) return null;
  const { trade, side, tower, pay, decimals } = done;
  const coin = ticker(tower.symbol);
  const paid = unitOf(pay);
  const got = trade.outputRaw && decimals[trade.outputMint] !== undefined ? formatUnits(trade.outputRaw, decimals[trade.outputMint]!, 'down') : null;
  const gave = trade.inputRaw && decimals[trade.inputMint] !== undefined ? formatUnits(trade.inputRaw, decimals[trade.inputMint]!) : null;
  const bought = side === 'buy';
  return (
    <>
      <div className={s.kicker}>{bought ? w.youreIn : w.sold}</div>
      <div className={`${s.display} ${s.result}`}>{got ? `${digits(got)} ${bought ? coin : paid}` : bought ? w.isYours(coin) : w.done}</div>
      <div className={s.resultLine}>
        {gave ? w.forPaid(digits(gave), bought ? paid : coin) : ''}
        {bought ? w.glows : w.readBack}
      </div>
      <WalletLine />
      <div className={s.grow} />
      <MomentShare
        key={trade.signature}
        towerId={tower.mint}
        symbol={coin}
        sold={!bought}
        kicker={bought ? w.youreIn : w.sold}
        got={got}
        unit={bought ? coin : paid}
        line={gave ? w.momentLine(digits(gave), bought ? paid : coin) : w.onRyntra}
      />
      <div className={s.walletLine}>
        <a className={s.explorer} href={explorerTxUrl('mainnet', trade.signature)} target="_blank" rel="noreferrer">
          {w.viewTx}
        </a>
        <button className={s.link} onClick={close}>
          {w.close}
        </button>
      </div>
    </>
  );
}

/**
 * The moment of the trade in the city: the camera flies to the tower, it takes your colour and throws fireworks.
 * Nothing is filmed: Share is ready at once and makes a card from the frame on screen, for
 * X or the phone's share sheet.
 */
function MomentShare({ towerId, symbol, sold, kicker, got, unit, line }: { towerId: string; symbol: string; sold: boolean; kicker: string; got: string | null; unit: string; line: string }) {
  const w = useWords(TRADE);
  const address = useWallet((st) => st.connection?.address ?? null);
  const [state, setState] = useState<'ready' | 'making' | 'shared' | 'saved'>('ready');
  // In the Ryntra app the card goes to the app's own share sheet through the bridge (CITY-6b); on a phone, to the
  // system's. Either way the button says Share; a computer posts on X.
  const app = useRyntraApp();
  const phone = useMemo(() => (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) || false, []);
  const colour = address ? colourOf(address) : '#FFB23F';
  // In my quarter the camera is the quarter's: the card is framed on the building of this coin. In the city the
  // camera flies to the coin's tower, if the city has one; a coin without a tower is never selected (a selection of a
  // missing tower holds the city's moments and its idle orbit until something clears it).
  const subject = useMemo(() => (quarterStore.getState().mode !== 'city' ? momentSubject(towerId) : null), [towerId]);
  useEffect(() => {
    const city = useCity.getState();
    const tower = quarterStore.getState().mode === 'city' && city.layout.towers.some((t) => t.tower.id === towerId);
    if (tower) city.select(towerId);
    const timers = MOMENT_BEATS.map((at, beat) =>
      window.setTimeout(() => {
        const st = useCity.getState();
        if (tower) st.play({ kind: 'pump', towerId, symbol, value: '', title: '' });
        else subject?.burst(colour);
        st.shake(beat === MOMENT_BEATS.length - 1 ? 0.45 : 0.25);
      }, at * 1000),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
    // One moment per trade: the key on this component is the signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const words = w.shareWords(sold, got ? digits(got) : '', unit);
  const post = async () => {
    setState('making');
    const card = await momentCard({ kicker, ...momentFigure(got), unit, line, colour }, { focus: subject?.focus });
    const f = card ? new File([card], cardName(symbol), { type: 'image/png' }) : null;
    // The system share sheet is a phone's way to post a card. On a computer it is the system's own panel, which many
    // close without posting: there the card is saved and X opens with the words and the coin's link.
    const viaApp = f ? await shareThroughApp(f, f.name, words) : null;
    if (viaApp) {
      setState(viaApp === 'shared' ? 'shared' : 'ready');
      return;
    }
    if (f && phone && navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f], text: words });
        setState('shared');
      } catch {
        // The person closed the share sheet.
        setState('ready');
      }
      return;
    }
    if (f) download(f);
    openExternal(`https://x.com/intent/post?text=${encodeURIComponent(words)}&url=${encodeURIComponent(coinLink(towerId))}`);
    setState(f ? 'saved' : 'ready');
  };
  return (
    <>
      {state === 'saved' && <div className={s.notice}>{w.cardSaved}</div>}
      <button className={`${s.display} ${s.action} ${state === 'making' ? s.waiting : ''}`} onClick={() => void post()} disabled={state === 'making'}>
        {app || phone ? w.shareClip : w.postOnX}
      </button>
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
  const w = useWords(TRADE);
  const signature = useTrade((st) => st.failed);
  const again = useTrade((st) => st.again);
  return (
    <>
      <div className={`${s.kicker} ${s.kickerDanger}`}>{w.didntGo}</div>
      <div className={s.resultLine}>{w.chainFailed}</div>
      <div className={s.grow} />
      <button className={`${s.display} ${s.action}`} onClick={again}>
        {w.tryAgain}
      </button>
      {signature && (
        <a className={s.explorer} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
          {w.viewTx}
        </a>
      )}
    </>
  );
}

function UnknownPanel() {
  const w = useWords(TRADE);
  const unknown = useTrade((st) => st.unknown);
  const press = useTrade((st) => st.press);
  return (
    <>
      <div className={`${s.kicker} ${s.kickerWarn}`}>{w.stillChecking}</div>
      <div className={s.resultLine}>{unknown?.message ?? w.notKnown}</div>
      <div className={s.grow} />
      <button className={`${s.display} ${s.action}`} onClick={() => void press()}>
        {w.checkAgain}
      </button>
      {unknown && (
        <a className={s.explorer} href={explorerTxUrl('mainnet', unknown.signature)} target="_blank" rel="noreferrer">
          {w.viewTx}
        </a>
      )}
    </>
  );
}

/**
 * The coin's logo through Ryntra's own proxy (the URL Jupiter lists for the coin, or a Ryntra launch's own picture),
 * with the chart's rules (`city/lib/chart/icon.ts`): a busy gateway is asked once more a moment later, and the coin's
 * first letter stands in its circle until the logo comes and for a coin without one — never an empty disc. Per coin:
 * another coin in the same window starts again from its own first try.
 */
function TokenIcon({ tower }: { tower: TowerRef }) {
  const [state, setState] = useState(() => ({ mint: tower.mint, attempt: 0 }));
  const attempt = state.mint === tower.mint ? state.attempt : 0;
  // The proxy also serves a launch's picture for a coin the market lists without a logo: it is always asked.
  const src = iconSource({ id: tower.mint, icon: tower.icon ?? tower.mint }, attempt);

  useEffect(() => {
    if (attempt !== 1) return;
    const timer = setTimeout(() => setState({ mint: tower.mint, attempt: 2 }), ICON_RETRY_MS);
    return () => clearTimeout(timer);
  }, [attempt, tower.mint]);

  return (
    <span className={s.icon} aria-hidden="true">
      <span className={s.iconLetter}>{monogram(tower.symbol)}</span>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} className={s.iconLogo} src={src} alt="" draggable={false} onError={() => setState({ mint: tower.mint, attempt: iconAttempt(attempt) })} />
      ) : null}
    </span>
  );
}

/** The swap's flip: what is paid and what is got change places. */
function FlipGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
      <path d="M8 4v15M4 15l4 4 4-4M16 20V5M12 9l4-4 4 4" />
    </svg>
  );
}
