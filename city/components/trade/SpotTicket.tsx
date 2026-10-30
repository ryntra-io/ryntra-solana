'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { crossesMarket, distanceFromMarketPercent, limitAmounts, TRIGGER_V1_MIN_ORDER_USD, typedPrice } from '@/lib/solana/limits/model';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue, plainFigure } from '@/city/lib/i18n/figures';
import { decimalsOf } from '@/city/lib/trade/figures';
import { formatBps, formatUnits, ticker } from '@/city/lib/trade/format';
import type { LimitIntent, LimitReview } from '@/city/lib/trade/limits';
import { useMine } from '@/city/lib/trade/mine-store';
import { engineAmount, enginePrice, pairKey, reviewKey, SPOT_BUSY, useSpot } from '@/city/lib/trade/spot-store';
import { expiryWords, STOP_EXPIRIES, type StopCoin } from '@/city/lib/trade/stops';
import { useTrade, type Choice, type TowerRef } from '@/city/lib/trade/store';
import { unitOf } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { useWalletName, WalletLine, WalletPicker } from './WalletParts';
import { riskWords, SPOT, TRADE } from './words';
import s from './trade.module.css';

/** The pair's price is read again this often while the ticket is open. */
const MARKET_REFRESH_MS = 20_000;

/**
 * Limit and Stop on the trade card, in the card's own fields: the amount above, the price here.
 *
 * A limit order is the engine's: it waits at Jupiter at its price and fills there or not at all, the coins in a
 * program account of this order alone; its Review — what leaves, what comes back, Ryntra's fee and the venue's, the
 * network fee and the refundable deposit — is built by the engine before the wallet opens. A stop is watched on this
 * device while Ryntra is open: reached, the card opens the sale at the market price for the wallet to sign. Every
 * figure is the engine's: the price from its market read, the amounts from its Review or its own arithmetic.
 */
export function SpotTicket({ tower, choice, mode, getChips }: { tower: TowerRef; choice: Choice; mode: 'limit' | 'stop'; getChips: ReactNode }) {
  const phase = useSpot((st) => st.phase);
  if (phase === 'placed' || phase === 'set') return <PlacedPanel />;
  if (phase === 'failed') return <SpotFailed />;
  if (phase === 'unclear') return <SpotUnclear />;
  return <SpotFields tower={tower} choice={choice} mode={mode} getChips={getChips} />;
}

function SpotFields({ tower, choice, mode, getChips }: { tower: TowerRef; choice: Choice; mode: 'limit' | 'stop'; getChips: ReactNode }) {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  const side = useTrade((st) => st.side);
  const quote = useTrade((st) => st.quote);
  const market = useSpot((st) => st.market);
  const price = useSpot((st) => st.price);
  const expiry = useSpot((st) => st.expiry);
  const review = useSpot((st) => st.review);
  const phase = useSpot((st) => st.phase);
  const notice = useSpot((st) => st.notice);
  const setPrice = useSpot((st) => st.setPrice);
  const setExpiry = useSpot((st) => st.setExpiry);
  const connection = useWallet((st) => st.connection);
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);

  const base = tower.mint;
  const quoteMint = choice.pay.mint;
  const key = pairKey(side, base, quoteMint);
  const idle = phase === 'idle';

  // The pair's price: read when the ticket opens on a pair, and again while it stays open.
  useEffect(() => {
    const read = () => void useSpot.getState().readMarket({ side, baseMint: base, quoteMint, mode });
    read();
    const timer = setInterval(() => document.visibilityState === 'visible' && read(), MARKET_REFRESH_MS);
    return () => clearInterval(timer);
  }, [side, base, quoteMint, mode]);

  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);

  // The details are the open ticket's own: Limit and Stop each start closed.
  useEffect(() => setDetails(false), [mode]);

  const marketPrice = market?.key === key && market.status === 'ready' ? market.price : null;
  const unit = unitOf(choice.pay);
  const coin = ticker(tower.symbol);
  const typedPriceOk = enginePrice(price);
  const priceNumber = typedPriceOk ? Number(typedPriceOk) : null;
  const amount = choice.amountRaw && choice.spendDecimals !== null ? engineAmount(choice.amountRaw, choice.spendDecimals) : null;
  const priced = quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  // Both coins' decimals as the engine read them: the quote names them, the wallet's balance names what is spent.
  const baseDecimals = side === 'sell' ? choice.spendDecimals : priced ? decimalsOf(priced, base) : null;
  const quoteDecimals = choice.pay.decimals ?? (priced ? decimalsOf(priced, quoteMint) : null);

  const intent: LimitIntent | null =
    connection && amount && typedPriceOk ? { owner: connection.address, side, baseMint: base, quoteMint, amount, price: typedPriceOk, quoteUsd: market?.key === key && market.status === 'ready' ? market.quoteUsd : null } : null;
  const shown = review && intent && review.key === reviewKey(intent) ? review.review : null;

  // Where the price stands against the market, by the limits engine's own rules.
  const crosses = mode === 'limit' && priceNumber !== null && marketPrice !== null && crossesMarket(side, priceNumber, marketPrice);
  const distance = priceNumber !== null && marketPrice !== null ? distanceFromMarketPercent(priceNumber, marketPrice) : null;
  const wrongSide = mode === 'stop' && priceNumber !== null && marketPrice !== null && (side === 'sell' ? priceNumber >= marketPrice : priceNumber <= marketPrice);

  // What the amount brings at the typed price: the Review's own figure once it exists, the engine's arithmetic before.
  const pair = baseDecimals !== null && quoteDecimals !== null ? { baseMint: base, baseDecimals, quoteMint, quoteDecimals } : null;
  const getRaw = shown ? shown.takingRaw : pair && amount && typedPriceOk ? (limitAmounts({ pair, side, amount, price: typedPriceOk })?.takingRaw ?? null) : null;
  const getDecimals = side === 'buy' ? baseDecimals : quoteDecimals;
  const getUnit = side === 'buy' ? coin : unit;

  const problem =
    choice.problem?.text ??
    (crosses ? (side === 'buy' ? w.atOrAbove : w.atOrBelow) : wrongSide ? (side === 'sell' ? w.setBelow : w.setAbove) : null);

  const priceLabel = mode === 'limit' ? (side === 'buy' ? w.buyAt : w.sellAt) : side === 'sell' ? w.sellIfFalls : w.buyIfRises;

  const tap = async () => {
    if (!connection) {
      const { wallets, connect } = useWallet.getState();
      if (wallets.length === 1) void connect(wallets[0]!.name);
      else setPicking(true);
      return;
    }
    if (mode === 'stop') {
      if (!pair || !choice.amountRaw || !typedPriceOk) return;
      const baseCoin: StopCoin & { name: string } = { mint: base, symbol: tower.symbol.replace(/^\$+/, ''), name: tower.name, decimals: pair.baseDecimals };
      const quoteCoin: StopCoin = { mint: quoteMint, symbol: choice.pay.symbol, decimals: pair.quoteDecimals };
      useSpot.getState().setStop({ side, base: baseCoin, quote: quoteCoin, amountRaw: choice.amountRaw, price: typedPriceOk, expiry }, priced ? priced.order.outAmountRaw : null);
      return;
    }
    if (!intent) return;
    if (shown) await useSpot.getState().placeOrder(intent, { coin, unit });
    else await useSpot.getState().reviewOrder(intent);
  };

  // The minimum is in dollars; paid in another coin (SOL), what it is in that coin too (CITY-150).
  const quoteUsd = market?.key === key && market.status === 'ready' ? market.quoteUsd : null;
  const minInPay = quoteUsd && quoteUsd > 0 && !/^USD[CT]?$/i.test(unit) ? `${digits(plainFigure(TRIGGER_V1_MIN_ORDER_USD / quoteUsd, { significant: 3 }))} ${unit}` : null;

  // The order's one line before the press: the Review's terms, the minimum and until when, or how a stop is watched.
  const terms =
    mode === 'limit' ? (
      shown ? (
        <LimitTerms review={shown} unit={unit} coin={coin} open={details} onInfo={() => setDetails((v) => !v)} />
      ) : (
        <div className={s.terms}>
          <span className={s.termsText}>
            {w.min} <b>{w.minUsd(TRIGGER_V1_MIN_ORDER_USD)}</b>
            {minInPay ? ` ≈ ${minInPay}` : ''} · {w.untilYouCancel}
          </span>
        </div>
      )
    ) : (
      <div className={s.terms}>
        <span className={s.termsText}>{w.watchedWhileOpen}</span>
        <button className={`${s.info} ${details ? s.infoOn : ''}`} aria-label={w.howStop} aria-expanded={details} onClick={() => setDetails((v) => !v)}>
          i
        </button>
      </div>
    );

  return (
    <>
      <div className={`${s.row} ${s.rowWrap}`}>
        <span className={s.labelGroup}>
          <span className={s.label}>{priceLabel}</span>
          {distance !== null && Number.isFinite(distance) && !crosses && !wrongSide && <span className={s.distance}>{distanceWords(distance, w)}</span>}
        </span>
        {marketPrice !== null ? (
          <button className={s.marketRef} onClick={() => setPrice(typedPrice(marketPrice))} disabled={!idle} aria-label={w.useMarketPrice(digits(typedPrice(marketPrice)), unit)}>
            {w.marketAt(digits(typedPrice(marketPrice)))}
          </button>
        ) : market?.key === key && market.status === 'error' ? (
          <span className={s.balance}>{w.noMarketPrice}</span>
        ) : null}
      </div>
      <label className={`${s.priceField} ${problem && (crosses || wrongSide) ? s.ownWrong : typedPriceOk ? s.ownOn : ''}`}>
        <input
          className={`${s.display} ${s.priceInput}`}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={fieldText(marketPrice !== null ? typedPrice(marketPrice) : '0.00')}
          aria-label={w.priceField(priceLabel, unit, coin)}
          value={fieldText(price)}
          onChange={(event) => setPrice(fieldValue(event.target.value))}
          disabled={!idle}
        />
        <span className={s.priceUnit} aria-hidden="true">
          {unit}
        </span>
      </label>

      <div className={`${s.row} ${s.rowWrap}`}>
        <span className={s.labelGroup}>
          <span className={s.label}>{t.youGet}</span>
          {getChips}
        </span>
        <span className={s.getInline} aria-live="polite">
          {getRaw && getDecimals !== null && !choice.problem ? (
            <>
              <b className={s.display}>{`${mode === 'stop' ? '≈ ' : ''}${digits(formatUnits(getRaw, getDecimals, 'down'))}`}</b> {getUnit}
            </>
          ) : (
            <b className={s.display}>—</b>
          )}
        </span>
      </div>

      {mode === 'stop' && (
        <div className={`${s.row} ${s.rowWrap}`}>
          <span className={s.label}>{w.watchFor}</span>
          <span className={s.expiries} role="radiogroup" aria-label={w.watchFor}>
            {STOP_EXPIRIES.map((id) => (
              <button key={id} role="radio" aria-checked={expiry === id} className={`${s.payChip} ${expiry === id ? s.payOn : ''}`} onClick={() => setExpiry(id)} disabled={!idle}>
                {expiryWords(id)}
              </button>
            ))}
          </span>
        </div>
      )}
      {mode === 'limit' ? shown && details && <LimitDetails review={shown} unit={unit} coin={coin} /> : details && <StopDetails side={side} />}

      {/* The order's terms and any warning stand in the pinned dock with the one action: the card scrolls under the dock,
          never these lines. */}
      {picking && !connection ? (
        <>
          {terms}
          <SpotNotes problem={problem} notice={notice} />
          <WalletPicker onBack={() => setPicking(false)} />
        </>
      ) : (
        <div className={s.dock}>
          {terms}
          <SpotNotes problem={problem} notice={notice} />
          <SpotAction
            mode={mode}
            side={side}
            coin={coin}
            ready={mode === 'limit' ? Boolean(intent) && !problem : Boolean(pair && choice.amountRaw && typedPriceOk && priced) && !problem}
            reviewed={Boolean(shown)}
            needsPrice={!typedPriceOk}
            onPress={() => void tap()}
          />
        </div>
      )}
      <WalletLine />
    </>
  );
}

/** «12.4% below» — how far the typed price sits from the pair's price now. */
function distanceWords(pct: number, w: (typeof SPOT)['en']): string {
  const abs = Math.abs(pct);
  if (abs < 0.01) return w.atMarket;
  const text = abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  const figure = digits(String(Number(text)));
  return pct < 0 ? w.below(figure) : w.above(figure);
}

/** The limit's terms before the signature, in one line: Ryntra's fee or the venue's, the price it fills at. */
function LimitTerms({ review, unit, coin, open, onInfo }: { review: LimitReview; unit: string; coin: string; open: boolean; onInfo: () => void }) {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  return (
    <div className={s.terms}>
      <span className={s.termsText}>
        {review.fee.ryntraBps > 0 ? (
          <>
            {t.fee} <b>{formatBps(review.fee.ryntraBps)}</b>
          </>
        ) : review.fee.venueBps > 0 ? (
          <>
            {w.jupiterFee} <b>{formatBps(review.fee.venueBps)}</b>
          </>
        ) : (
          w.noFee
        )}
        {' · '}
        {w.fillsAt}{' '}
        <b>
          {digits(typedPrice(review.fillPrice))} {unit}
        </b>
        {` ${w.per(coin)} · ${w.untilYouCancel}`}
      </span>
      <button className={`${s.info} ${open ? s.infoOn : ''}`} aria-label={w.orderDetails} aria-expanded={open} onClick={onInfo}>
        i
      </button>
    </div>
  );
}

function LimitDetails({ review, unit, coin }: { review: LimitReview; unit: string; coin: string }) {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  const out = review.side === 'buy' ? review.pair.baseDecimals : review.pair.quoteDecimals;
  const input = review.side === 'buy' ? review.pair.quoteDecimals : review.pair.baseDecimals;
  const outUnit = review.side === 'buy' ? coin : unit;
  const inUnit = review.side === 'buy' ? unit : coin;
  return (
    <dl className={s.details}>
      <dt>{w.youPutIn}</dt>
      <dd>
        {digits(formatUnits(review.makingRaw, input))} {inUnit}
      </dd>
      <dt>{t.youGet}</dt>
      <dd>
        {digits(formatUnits(review.takingRaw, out, 'down'))} {outUnit}
        {w.whenFills}
      </dd>
      <dt>{w.yourPrice}</dt>
      <dd>
        {digits(review.price)} {unit}
      </dd>
      <dt>{w.fillsAtLabel}</dt>
      <dd>
        {digits(typedPrice(review.fillPrice))} {unit}
        {review.fee.ryntraBps + review.fee.venueBps > 0 ? w.feeOnTop : ''}
      </dd>
      <dt>{t.ryntraFee}</dt>
      <dd>{review.fee.ryntraBps > 0 ? `${formatBps(review.fee.ryntraBps)} · ${digits(formatUnits(review.fee.ryntraFeeRaw, out, 'nearest'))} ${outUnit}` : t.none}</dd>
      {review.fee.venueBps > 0 && (
        <>
          <dt>{w.jupiterFee}</dt>
          <dd>
            {formatBps(review.fee.venueBps)} · {digits(formatUnits(review.fee.venueFeeRaw, out, 'nearest'))} {outUnit}
          </dd>
        </>
      )}
      <dt>{t.networkFee}</dt>
      <dd>{digits(formatUnits(String(review.networkFeeLamports), 9))} SOL</dd>
      {review.depositLamports !== null && review.depositLamports > 0 && (
        <>
          <dt>{w.deposit}</dt>
          <dd>
            {digits(formatUnits(String(review.depositLamports), 9))} SOL{w.backWhenCloses}
          </dd>
        </>
      )}
      <dt>{w.lasts}</dt>
      <dd>{w.untilCancelIt}</dd>
      <dt>{t.riskCheck}</dt>
      <dd>{riskWords(review.risk.verdict, t)}</dd>
      <dt>{w.venue}</dt>
      <dd>{w.jupiterLimit}</dd>
    </dl>
  );
}

/** How a stop works, behind its «i»: kept on this device, the sale opens for the wallet to sign — nothing sells by itself. */
function StopDetails({ side }: { side: 'buy' | 'sell' }) {
  const w = useWords(SPOT);
  return (
    <dl className={s.details}>
      <dt>{w.watched}</dt>
      <dd>{w.onDevice}</dd>
      <dt>{w.whenReached}</dt>
      <dd>{w.opensAtMarket(side === 'sell')}</dd>
      <dt>{w.signing}</dt>
      <dd>{w.yourWallet}</dd>
    </dl>
  );
}

function SpotNotes({ problem, notice }: { problem: string | null; notice: Readonly<{ tone: string; text: string }> | null }) {
  const line = problem ? { tone: 'error', text: problem } : notice;
  if (!line) return null;
  const tone = line.tone === 'warn' ? s.noticeWarn : line.tone === 'error' ? s.noticeError : '';
  return (
    <div className={`${s.notice} ${tone}`} role={line.tone === 'error' ? 'alert' : 'status'}>
      {line.text}
    </div>
  );
}

function SpotAction({
  mode,
  side,
  coin,
  ready,
  reviewed,
  needsPrice,
  onPress,
}: {
  mode: 'limit' | 'stop';
  side: 'buy' | 'sell';
  coin: string;
  ready: boolean;
  reviewed: boolean;
  needsPrice: boolean;
  onPress: () => void;
}) {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  const nameOf = useWalletName();
  const phase = useSpot((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => st.connecting);
  let label = mode === 'stop' ? w.setStop : reviewed ? w.placeOrder(side === 'buy') : w.reviewOrder;
  let disabled = !ready;
  let waiting = false;
  if (phase === 'reviewing') [label, disabled, waiting] = [w.building, true, true];
  else if (phase === 'wallet') [label, disabled, waiting] = [connection?.wallet ? t.confirmIn(nameOf(connection.wallet)) : t.confirmInWallet, true, true];
  else if (phase === 'sending') [label, disabled, waiting] = [w.placing, true, true];
  else if (connecting) [label, disabled, waiting] = [t.connecting, true, true];
  else if (!connection) [label, disabled] = [t.connectWallet, false];
  // The one thing missing, said on the button itself.
  else if (needsPrice) [label, disabled] = [mode === 'stop' ? w.setStopPrice : w.setPrice, true];
  return (
    <button className={`${s.display} ${s.action} ${waiting ? s.waiting : ''}`} onClick={onPress} disabled={disabled} aria-label={label === w.setStop ? w.setStopFor(coin) : undefined}>
      {label}
    </button>
  );
}

function openOrders() {
  // The card steps aside for the panel; nothing is under way here.
  useSpot.getState().again();
  useTrade.getState().close();
  useMine.getState().openOrders();
}

function PlacedPanel() {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  const placed = useSpot((st) => st.placed);
  const again = useSpot((st) => st.again);
  if (!placed) return null;
  if (placed.kind === 'stop') {
    const stop = placed.stop;
    const unit = unitOf(stop.quote);
    const spent = stop.side === 'buy' ? stop.quote.decimals : stop.base.decimals;
    return (
      <>
        <div className={s.kicker}>{w.stopSet}</div>
        <div className={`${s.display} ${s.result}`}>
          {digits(stop.price)} {unit}
        </div>
        <div className={s.resultLine}>
          {stop.side === 'sell' ? w.sellLine(digits(formatUnits(stop.amountRaw, spent)), ticker(stop.base.symbol)) : w.buyWithLine(ticker(stop.base.symbol), digits(formatUnits(stop.amountRaw, spent)), unit)}
          {stop.expiresAt ? w.untilDate(dateText(stop.expiresAt, { day: 'numeric', month: 'short' })) : w.untilCancelled}
        </div>
        <WalletLine />
        <div className={s.grow} />
        <div className={s.pair}>
          <button className={`${s.display} ${s.action}`} onClick={openOrders}>
            {w.myOrders}
          </button>
          <button className={s.quiet} onClick={again}>
            {w.newStop}
          </button>
        </div>
      </>
    );
  }
  const review = placed.review;
  const baseAmount = review.side === 'buy' ? review.takingRaw : review.makingRaw;
  const quoteAmount = review.side === 'buy' ? review.makingRaw : review.takingRaw;
  return (
    <>
      <div className={s.kicker}>{placed.settled ? w.orderPlaced : w.orderSent}</div>
      <div className={`${s.display} ${s.result}`}>
        {digits(review.price)} {placed.unit}
      </div>
      <div className={s.resultLine}>
        {w.placedLine(review.side === 'buy', digits(formatUnits(baseAmount, review.pair.baseDecimals, 'down')), placed.coin, digits(formatUnits(quoteAmount, review.pair.quoteDecimals, 'down')), placed.unit)}
        {placed.settled ? '' : w.notConfirmed}
      </div>
      <WalletLine />
      <div className={s.grow} />
      <div className={s.pair}>
        <button className={`${s.display} ${s.action}`} onClick={openOrders}>
          {w.myOrders}
        </button>
        <button className={s.quiet} onClick={again}>
          {w.newOrder}
        </button>
      </div>
      <a className={s.explorer} href={explorerTxUrl('mainnet', placed.signature)} target="_blank" rel="noreferrer">
        {t.viewTx}
      </a>
    </>
  );
}

function SpotFailed() {
  const t = useWords(TRADE);
  const signature = useSpot((st) => st.failed);
  const again = useSpot((st) => st.again);
  return (
    <>
      <div className={`${s.kicker} ${s.kickerDanger}`}>{t.didntGo}</div>
      <div className={s.resultLine}>{t.onlyFee}</div>
      <div className={s.grow} />
      <button className={`${s.display} ${s.action}`} onClick={again}>
        {t.tryAgain}
      </button>
      {signature && (
        <a className={s.explorer} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
          {t.viewTx}
        </a>
      )}
    </>
  );
}

function SpotUnclear() {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  const unclear = useSpot((st) => st.unclear);
  const phase = useSpot((st) => st.phase);
  return (
    <>
      <div className={`${s.kicker} ${s.kickerWarn}`}>{t.stillChecking}</div>
      <div className={s.resultLine}>{unclear?.message}</div>
      <div className={s.grow} />
      <button className={`${s.display} ${s.action}`} onClick={openOrders} disabled={SPOT_BUSY.has(phase)}>
        {w.myOrders}
      </button>
      {unclear?.signature && (
        <a className={s.explorer} href={explorerTxUrl('mainnet', unclear.signature)} target="_blank" rel="noreferrer">
          {t.viewTx}
        </a>
      )}
    </>
  );
}
