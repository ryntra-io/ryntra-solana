'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { crossesMarket, distanceFromMarketPercent, limitAmounts, TRIGGER_V1_MIN_ORDER_USD, typedPrice } from '@/lib/solana/limits/model';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { decimalsOf } from '@/city/lib/trade/figures';
import { formatBps, formatUnits, ticker } from '@/city/lib/trade/format';
import type { LimitIntent, LimitReview } from '@/city/lib/trade/limits';
import { useMine } from '@/city/lib/trade/mine-store';
import { engineAmount, enginePrice, pairKey, reviewKey, SPOT_BUSY, useSpot } from '@/city/lib/trade/spot-store';
import { expiryWords, STOP_EXPIRIES, type StopCoin } from '@/city/lib/trade/stops';
import { useTrade, type Choice, type TowerRef } from '@/city/lib/trade/store';
import { unitOf } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { WalletLine, WalletPicker } from './WalletParts';
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
    (crosses ? (side === 'buy' ? 'At or above the market. Use Market or set it lower.' : 'At or below the market. Use Market or set it higher.') : wrongSide ? (side === 'sell' ? 'Set it below the market.' : 'Set it above the market.') : null);

  const priceLabel = mode === 'limit' ? (side === 'buy' ? 'Buy at' : 'Sell at') : side === 'sell' ? 'Sell if it falls to' : 'Buy if it rises to';

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

  return (
    <>
      <div className={`${s.row} ${s.rowWrap}`}>
        <span className={s.labelGroup}>
          <span className={s.label}>{priceLabel}</span>
          {distance !== null && Number.isFinite(distance) && !crosses && !wrongSide && <span className={s.distance}>{distanceWords(distance)}</span>}
        </span>
        {marketPrice !== null ? (
          <button className={s.marketRef} onClick={() => setPrice(typedPrice(marketPrice))} disabled={!idle} aria-label={`Market price ${typedPrice(marketPrice)} ${unit}. Use it`}>
            Market {typedPrice(marketPrice)}
          </button>
        ) : market?.key === key && market.status === 'error' ? (
          <span className={s.balance}>No market price now</span>
        ) : null}
      </div>
      <label className={`${s.priceField} ${problem && (crosses || wrongSide) ? s.ownWrong : typedPriceOk ? s.ownOn : ''}`}>
        <input
          className={`${s.display} ${s.priceInput}`}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={marketPrice !== null ? typedPrice(marketPrice) : '0.00'}
          aria-label={`${priceLabel}, ${unit} per ${coin}`}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          disabled={!idle}
        />
        <span className={s.priceUnit} aria-hidden="true">
          {unit}
        </span>
      </label>

      <div className={`${s.row} ${s.rowWrap}`}>
        <span className={s.labelGroup}>
          <span className={s.label}>You get</span>
          {getChips}
        </span>
        <span className={s.getInline} aria-live="polite">
          {getRaw && getDecimals !== null && !choice.problem ? (
            <>
              <b className={s.display}>{`${mode === 'stop' ? '≈ ' : ''}${formatUnits(getRaw, getDecimals, 'down')}`}</b> {getUnit}
            </>
          ) : (
            <b className={s.display}>—</b>
          )}
        </span>
      </div>

      {mode === 'limit' ? (
        <>
          {shown ? (
            <LimitTerms review={shown} unit={unit} coin={coin} open={details} onInfo={() => setDetails((v) => !v)} />
          ) : (
            <div className={s.terms}>
              <span className={s.termsText}>
                Min <b>{TRIGGER_V1_MIN_ORDER_USD} USD</b> · until you cancel
              </span>
            </div>
          )}
          {shown && details && <LimitDetails review={shown} unit={unit} coin={coin} />}
        </>
      ) : (
        <>
          <div className={`${s.row} ${s.rowWrap}`}>
            <span className={s.label}>Watch for</span>
            <span className={s.expiries} role="radiogroup" aria-label="Watch for">
              {STOP_EXPIRIES.map((id) => (
                <button key={id} role="radio" aria-checked={expiry === id} className={`${s.payChip} ${expiry === id ? s.payOn : ''}`} onClick={() => setExpiry(id)} disabled={!idle}>
                  {expiryWords(id)}
                </button>
              ))}
            </span>
          </div>
          <div className={s.terms}>
            <span className={s.termsText}>Watched while Ryntra is open</span>
            <button className={`${s.info} ${details ? s.infoOn : ''}`} aria-label="How a stop works" aria-expanded={details} onClick={() => setDetails((v) => !v)}>
              i
            </button>
          </div>
          {details && <StopDetails side={side} />}
        </>
      )}

      <SpotNotes problem={problem} notice={notice} />
      {picking && !connection ? (
        <WalletPicker onBack={() => setPicking(false)} />
      ) : (
        <SpotAction
          mode={mode}
          side={side}
          coin={coin}
          ready={mode === 'limit' ? Boolean(intent) && !problem : Boolean(pair && choice.amountRaw && typedPriceOk && priced) && !problem}
          reviewed={Boolean(shown)}
          needsPrice={!typedPriceOk}
          onPress={() => void tap()}
        />
      )}
      <WalletLine />
    </>
  );
}

/** «12.4% below» — how far the typed price sits from the pair's price now. */
function distanceWords(pct: number): string {
  const abs = Math.abs(pct);
  if (abs < 0.01) return 'At market';
  const text = abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return `${Number(text)}% ${pct < 0 ? 'below' : 'above'}`;
}

/** The limit's terms before the signature, in one line: Ryntra's fee or the venue's, the price it fills at. */
function LimitTerms({ review, unit, coin, open, onInfo }: { review: LimitReview; unit: string; coin: string; open: boolean; onInfo: () => void }) {
  return (
    <div className={s.terms}>
      <span className={s.termsText}>
        {review.fee.ryntraBps > 0 ? (
          <>
            Fee <b>{formatBps(review.fee.ryntraBps)}</b>
          </>
        ) : review.fee.venueBps > 0 ? (
          <>
            Jupiter fee <b>{formatBps(review.fee.venueBps)}</b>
          </>
        ) : (
          'No fee'
        )}
        {' · fills at '}
        <b>
          {typedPrice(review.fillPrice)} {unit}
        </b>
        {` per ${coin} · until you cancel`}
      </span>
      <button className={`${s.info} ${open ? s.infoOn : ''}`} aria-label="Order details" aria-expanded={open} onClick={onInfo}>
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

function LimitDetails({ review, unit, coin }: { review: LimitReview; unit: string; coin: string }) {
  const out = review.side === 'buy' ? review.pair.baseDecimals : review.pair.quoteDecimals;
  const input = review.side === 'buy' ? review.pair.quoteDecimals : review.pair.baseDecimals;
  const outUnit = review.side === 'buy' ? coin : unit;
  const inUnit = review.side === 'buy' ? unit : coin;
  return (
    <dl className={s.details}>
      <dt>You put in</dt>
      <dd>
        {formatUnits(review.makingRaw, input)} {inUnit}
      </dd>
      <dt>You get</dt>
      <dd>
        {formatUnits(review.takingRaw, out, 'down')} {outUnit}, when it fills
      </dd>
      <dt>Your price</dt>
      <dd>
        {review.price} {unit}
      </dd>
      <dt>Fills at</dt>
      <dd>
        {typedPrice(review.fillPrice)} {unit}
        {review.fee.ryntraBps + review.fee.venueBps > 0 ? ', the fee on top' : ''}
      </dd>
      <dt>Ryntra fee</dt>
      <dd>{review.fee.ryntraBps > 0 ? `${formatBps(review.fee.ryntraBps)} · ${formatUnits(review.fee.ryntraFeeRaw, out, 'nearest')} ${outUnit}` : 'None'}</dd>
      {review.fee.venueBps > 0 && (
        <>
          <dt>Jupiter fee</dt>
          <dd>
            {formatBps(review.fee.venueBps)} · {formatUnits(review.fee.venueFeeRaw, out, 'nearest')} {outUnit}
          </dd>
        </>
      )}
      <dt>Network fee</dt>
      <dd>{formatUnits(String(review.networkFeeLamports), 9)} SOL</dd>
      {review.depositLamports !== null && review.depositLamports > 0 && (
        <>
          <dt>Deposit</dt>
          <dd>{formatUnits(String(review.depositLamports), 9)} SOL, back when it closes</dd>
        </>
      )}
      <dt>Lasts</dt>
      <dd>Until you cancel it</dd>
      <dt>Risk check</dt>
      <dd>{RISK_WORDS[review.risk.verdict] ?? review.risk.verdict}</dd>
      <dt>Venue</dt>
      <dd>Jupiter limit order</dd>
    </dl>
  );
}

/** How a stop works, behind its «i»: kept on this device, the sale opens for the wallet to sign — nothing sells by itself. */
function StopDetails({ side }: { side: 'buy' | 'sell' }) {
  return (
    <dl className={s.details}>
      <dt>Watched</dt>
      <dd>On this device, while Ryntra is open</dd>
      <dt>When reached</dt>
      <dd>The {side === 'sell' ? 'sale' : 'purchase'} opens at the market price</dd>
      <dt>Signing</dt>
      <dd>Your wallet. Nothing trades by itself</dd>
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
  const phase = useSpot((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => st.connecting);
  let label = mode === 'stop' ? `Set stop` : reviewed ? `Place ${side === 'buy' ? 'buy' : 'sell'} order` : 'Review order';
  let disabled = !ready;
  let waiting = false;
  if (phase === 'reviewing') [label, disabled, waiting] = ['Building your order…', true, true];
  else if (phase === 'wallet') [label, disabled, waiting] = [`Confirm in ${connection?.wallet ?? 'your wallet'}`, true, true];
  else if (phase === 'sending') [label, disabled, waiting] = ['Placing…', true, true];
  else if (connecting) [label, disabled, waiting] = ['Connecting…', true, true];
  else if (!connection) [label, disabled] = ['Connect wallet', false];
  // The one thing missing, said on the button itself.
  else if (needsPrice) [label, disabled] = [mode === 'stop' ? 'Set a stop price' : 'Set a price', true];
  return (
    <div className={s.dock}>
      <button className={`${s.display} ${s.action} ${waiting ? s.waiting : ''}`} onClick={onPress} disabled={disabled} aria-label={label === 'Set stop' ? `Set stop for ${coin}` : undefined}>
        {label}
      </button>
    </div>
  );
}

function openOrders() {
  // The card steps aside for the panel; nothing is under way here.
  useSpot.getState().again();
  useTrade.getState().close();
  useMine.getState().openOrders();
}

function PlacedPanel() {
  const placed = useSpot((st) => st.placed);
  const again = useSpot((st) => st.again);
  if (!placed) return null;
  if (placed.kind === 'stop') {
    const stop = placed.stop;
    const unit = unitOf(stop.quote);
    const spent = stop.side === 'buy' ? stop.quote.decimals : stop.base.decimals;
    return (
      <>
        <div className={s.kicker}>Stop set</div>
        <div className={`${s.display} ${s.result}`}>
          {stop.price} {unit}
        </div>
        <div className={s.resultLine}>
          {stop.side === 'sell' ? `Sell ${formatUnits(stop.amountRaw, spent)} ${ticker(stop.base.symbol)}` : `Buy ${ticker(stop.base.symbol)} with ${formatUnits(stop.amountRaw, spent)} ${unit}`}
          {stop.expiresAt ? ` · until ${new Date(stop.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ' · until cancelled'}
        </div>
        <WalletLine />
        <div className={s.grow} />
        <div className={s.pair}>
          <button className={`${s.display} ${s.action}`} onClick={openOrders}>
            My orders
          </button>
          <button className={s.quiet} onClick={again}>
            New stop
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
      <div className={s.kicker}>{placed.settled ? 'Order placed' : 'Order sent'}</div>
      <div className={`${s.display} ${s.result}`}>
        {review.price} {placed.unit}
      </div>
      <div className={s.resultLine}>
        {review.side === 'buy' ? 'Buy' : 'Sell'} {formatUnits(baseAmount, review.pair.baseDecimals, 'down')} {placed.coin} for {formatUnits(quoteAmount, review.pair.quoteDecimals, 'down')} {placed.unit}
        {placed.settled ? '' : '. Not confirmed yet. Do not place it again.'}
      </div>
      <WalletLine />
      <div className={s.grow} />
      <div className={s.pair}>
        <button className={`${s.display} ${s.action}`} onClick={openOrders}>
          My orders
        </button>
        <button className={s.quiet} onClick={again}>
          New order
        </button>
      </div>
      <a className={s.explorer} href={explorerTxUrl('mainnet', placed.signature)} target="_blank" rel="noreferrer">
        View transaction ↗
      </a>
    </>
  );
}

function SpotFailed() {
  const signature = useSpot((st) => st.failed);
  const again = useSpot((st) => st.again);
  return (
    <>
      <div className={`${s.kicker} ${s.kickerDanger}`}>Didn’t go through</div>
      <div className={s.resultLine}>Only the network fee was spent.</div>
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

function SpotUnclear() {
  const unclear = useSpot((st) => st.unclear);
  const phase = useSpot((st) => st.phase);
  return (
    <>
      <div className={`${s.kicker} ${s.kickerWarn}`}>Still checking</div>
      <div className={s.resultLine}>{unclear?.message}</div>
      <div className={s.grow} />
      <button className={`${s.display} ${s.action}`} onClick={openOrders} disabled={SPOT_BUSY.has(phase)}>
        My orders
      </button>
      {unclear?.signature && (
        <a className={s.explorer} href={explorerTxUrl('mainnet', unclear.signature)} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      )}
    </>
  );
}
