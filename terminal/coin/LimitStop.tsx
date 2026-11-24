'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SPOT, TRADE, riskWords } from '@/city/components/trade/words';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue, plainFigure } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import { decimalsOf } from '@/city/lib/trade/figures';
import { formatBps, formatUnits } from '@/city/lib/trade/format';
import { STOPS_ENGINE } from '@/city/lib/trade/gates';
import type { LimitIntent, LimitReview } from '@/city/lib/trade/limits';
import { engineAmount, enginePrice, pairKey, reviewKey, SPOT_BUSY, useSpot } from '@/city/lib/trade/spot-store';
import { expiryWords, STOP_EXPIRIES, type StopCoin } from '@/city/lib/trade/stops';
import { useTrade, type Choice, type TowerRef } from '@/city/lib/trade/store';
import { unitOf } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { crossesMarket, distanceFromMarketPercent, limitAmounts, TRIGGER_V1_MIN_ORDER_USD, typedPrice } from '@/lib/solana/limits/model';
import { Action, AmountField, Figure, Icon, Kick, Quiet, Shares, cx } from '@/terminal/ui';
import { FEE } from '@/terminal/ui/words';
import { ExplainBox, ExplainButton, LONG_LABEL, Rows, TxLink, bare, connectOrPick } from './parts';
import { capFromTyped, capHint, capShort, capToPrice, capWritten, priceToCap } from './ticket-rules';
import { BUY_TICKET } from './ticket-words';
import { zerosText } from './tiny';
import { payLogo } from './staples';
import { WalletPick } from './WalletPick';
import { TICKET } from './words';
import s from './ticket.module.css';

/** The pair's price is read again this often while the ticket is open. */
const MARKET_REFRESH_MS = 20_000;

/** The ticket's states where a placed limit or a set stop is said on its own, without the fields it was made from. */
export const SPOT_RESULT: ReadonlySet<string> = new Set(['placed', 'set', 'failed', 'unclear']);

/**
 * Limit and Stop on the ticket, in the ticket's own fields: the amount above, the price here. Both are the trade
 * card's logic as it is (`city/lib/trade/spot-store.ts`): a limit order waits at Jupiter at its price, and its Review —
 * what leaves, what comes back, the fees, the network fee and the refundable deposit — is built by the engine before
 * the wallet opens; a stop is watched and, reached, opens its sale at the market price for the wallet to sign. Every
 * figure is the engine's.
 */
export function LimitStop({
  tower,
  choice,
  mode,
  onOrders,
  onTopUp,
  supply = null,
  risk,
}: {
  tower: TowerRef;
  choice: Choice;
  mode: 'limit' | 'stop';
  onOrders?: () => void;
  onTopUp?: () => void;
  /** The supply the coin's market cap is counted on: given, a limit can be set by market cap. */
  supply?: number | null;
  /** The coin's risk line, over a buy's button. */
  risk?: ReactNode;
}) {
  const phase = useSpot((st) => st.phase);
  if (phase === 'placed' || phase === 'set') return <Placed onOrders={onOrders} />;
  if (phase === 'failed') return <SpotFailed />;
  if (phase === 'unclear') return <SpotUnclear onOrders={onOrders} />;
  return <SpotFields tower={tower} choice={choice} mode={mode} onTopUp={onTopUp} supply={supply} risk={risk} />;
}

function SpotFields({ tower, choice, mode, onTopUp, supply, risk }: { tower: TowerRef; choice: Choice; mode: 'limit' | 'stop'; onTopUp?: () => void; supply: number | null; risk?: ReactNode }) {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  const k = useWords(TICKET);
  const x = useWords(BUY_TICKET);
  const fw = useWords(FEE);
  const lang = useLang();
  // The limit's price, typed as a price or as the market cap it stands at (the person's choice, on this ticket).
  const [by, setBy] = useState<'price' | 'cap'>('price');
  const [capTyped, setCapTyped] = useState('');
  const capSet = useRef<string | null>(null);
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
  const connecting = useWallet((st) => Boolean(st.connecting));
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  // The details are the open way's own: Limit and Stop each start closed.
  useEffect(() => setDetails(false), [mode]);

  const base = tower.mint;
  const quoteMint = choice.pay.mint;
  const key = pairKey(side, base, quoteMint);
  const idle = phase === 'idle';
  const empty = Boolean(connection) && side === 'buy' && choice.sizing.max === '0';
  const topUp = empty && Boolean(onTopUp);

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

  const marketPrice = market?.key === key && market.status === 'ready' ? market.price : null;
  const unit = bare(unitOf(choice.pay));
  const coin = bare(tower.symbol);
  const typedPriceOk = enginePrice(price);
  const priceNumber = typedPriceOk ? Number(typedPriceOk) : null;
  const amount = choice.amountRaw && choice.spendDecimals !== null ? engineAmount(choice.amountRaw, choice.spendDecimals) : null;
  const priced = quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  // Both coins' decimals as the engine read them: the quote names them, the wallet's balance names what is spent.
  const fromQuote = {
    base: side === 'sell' ? choice.spendDecimals : priced ? decimalsOf(priced, base) : null,
    quote: choice.pay.decimals ?? (priced ? decimalsOf(priced, quoteMint) : null),
  };
  const quoteUsd = market?.key === key && market.status === 'ready' ? market.quoteUsd : null;

  const intent: LimitIntent | null = connection && amount && typedPriceOk ? { owner: connection.address, side, baseMint: base, quoteMint, amount, price: typedPriceOk, quoteUsd } : null;
  const shown = review && intent && review.key === reviewKey(intent) ? review.review : null;
  // The Review states both coins' decimals itself; before it, the quote and the wallet do.
  const baseDecimals = shown ? shown.pair.baseDecimals : fromQuote.base;
  const quoteDecimals = shown ? shown.pair.quoteDecimals : fromQuote.quote;

  // Where the price stands against the market, by the limits engine's own rules.
  const crosses = mode === 'limit' && priceNumber !== null && marketPrice !== null && crossesMarket(side, priceNumber, marketPrice);
  const distance = priceNumber !== null && marketPrice !== null ? distanceFromMarketPercent(priceNumber, marketPrice) : null;
  const wrongSide = mode === 'stop' && priceNumber !== null && marketPrice !== null && (side === 'sell' ? priceNumber >= marketPrice : priceNumber <= marketPrice);

  // What the amount brings at the typed price: the Review's own figure once it exists, the engine's arithmetic before.
  const pair = baseDecimals !== null && quoteDecimals !== null ? { baseMint: base, baseDecimals, quoteMint, quoteDecimals } : null;
  const getRaw = shown ? shown.takingRaw : pair && amount && typedPriceOk ? (limitAmounts({ pair, side, amount, price: typedPriceOk })?.takingRaw ?? null) : null;
  const getDecimals = side === 'buy' ? baseDecimals : quoteDecimals;
  const getUnit = side === 'buy' ? coin : unit;
  const getFigure = getRaw && getDecimals !== null && !choice.problem ? `${mode === 'stop' ? '≈ ' : ''}${digits(formatUnits(getRaw, getDecimals, 'down'))}` : null;

  // Beside «Add…» neither the balance's sentence nor a remark on a price that cannot be used yet is said.
  const amountProblem = choice.problem && !(topUp && choice.problem.kind === 'balance') ? choice.problem.text : null;
  const problem = amountProblem ?? (topUp ? null : crosses ? (side === 'buy' ? w.atOrAbove : w.atOrBelow) : wrongSide ? (side === 'sell' ? w.setBelow : w.setAbove) : null);
  const note = problem ? { tone: 'error', text: problem } : notice;

  // By market cap: only a limit, only where the supply and what pays in dollars are known.
  const capOpen = mode === 'limit' && supply !== null && supply > 0 && quoteUsd !== null && quoteUsd > 0;
  const byCap = capOpen && by === 'cap';
  const capNow = capOpen && marketPrice !== null ? priceToCap(marketPrice, supply, quoteUsd) : null;
  const typeCap = (text: string) => {
    setCapTyped(text);
    const cap = Number(text);
    const at = text && Number.isFinite(cap) ? capToPrice(cap, supply, quoteUsd) : null;
    const next = at !== null ? typedPrice(at) : '';
    capSet.current = next;
    setPrice(next);
  };
  const flip = () => {
    if (by === 'price') {
      // The price already typed, said as its market cap.
      const cap = priceNumber !== null ? priceToCap(priceNumber, supply, quoteUsd) : null;
      setCapTyped(cap !== null ? capWritten(cap) : '');
      capSet.current = price;
      setBy('cap');
    } else setBy('price');
  };
  // A price put on the ticket another way — a new pair, the market's price, a sentence to the agent — is said again as
  // its market cap.
  useEffect(() => {
    if (!byCap || capSet.current === price) return;
    const cap = priceNumber !== null ? priceToCap(priceNumber, supply, quoteUsd) : null;
    setCapTyped(cap !== null ? capWritten(cap) : '');
    capSet.current = price;
  }, [byCap, price, priceNumber, supply, quoteUsd]);

  const priceLabel = byCap ? (side === 'buy' ? x.buyAtCap : x.sellAtCap) : mode === 'limit' ? (side === 'buy' ? w.buyAt : w.sellAt) : side === 'sell' ? w.sellIfFalls : w.buyIfRises;

  const tap = async () => {
    if (!connection) return connectOrPick(() => setPicking(true));
    if (topUp) return onTopUp?.();
    if (mode === 'stop') {
      if (!pair || !choice.amountRaw || !typedPriceOk) return;
      const baseCoin: StopCoin & { name: string } = { mint: base, symbol: coin, name: tower.name, decimals: pair.baseDecimals };
      const quoteCoin: StopCoin = { mint: quoteMint, symbol: choice.pay.symbol, decimals: pair.quoteDecimals };
      await useSpot.getState().setStop({ side, base: baseCoin, quote: quoteCoin, amountRaw: choice.amountRaw, price: typedPriceOk, expiry }, priced ? priced.order.outAmountRaw : null);
      return;
    }
    if (!intent) return;
    if (shown) await useSpot.getState().placeOrder(intent, { coin, unit });
    else await useSpot.getState().reviewOrder(intent);
  };

  // The minimum is in dollars; paid in another coin (SOL), what it is in that coin too.
  const minInPay = quoteUsd && quoteUsd > 0 && !/^USD[CT]?$/i.test(unit) ? `${digits(plainFigure(TRIGGER_V1_MIN_ORDER_USD / quoteUsd, { significant: 3 }))} ${unit}` : null;

  const ready = mode === 'limit' ? Boolean(intent) && !problem : Boolean(pair && choice.amountRaw && typedPriceOk && priced) && !problem;
  let label = mode === 'stop' ? w.setStop : shown ? w.placeOrder(side === 'buy') : w.reviewOrder;
  let disabled = !ready;
  let busy = false;
  if (phase === 'reviewing') [label, disabled, busy] = [w.building, true, true];
  else if (phase === 'wallet') [label, disabled, busy] = [connection?.wallet ? t.confirmIn(connection.wallet) : t.confirmInWallet, true, true];
  else if (phase === 'sending') [label, disabled, busy] = [w.placing, true, true];
  else if (connecting) [label, disabled, busy] = [t.connecting, true, true];
  else if (!connection) [label, disabled] = [t.connectWallet, false];
  else if (topUp) [label, disabled] = [t.addOf(bare(choice.spendUnit)), false];
  else if (empty) [label, disabled] = [t.notEnough(bare(choice.spendUnit)), true];
  // The one thing missing, said on the button itself.
  else if (!typedPriceOk) [label, disabled] = [mode === 'stop' ? w.setStopPrice : w.setPrice, true];

  return (
    <>
      <fieldset className={cx(s.group, s.priceGroup)} disabled={!idle}>
        {byCap ? (
          <AmountField
            label={priceLabel}
            aside={typedPriceOk ? x.capIsPrice(digits(zerosText(Number(typedPriceOk), typedPrice)), unit) : undefined}
            value={fieldText(capTyped)}
            onChange={(text) => typeCap(capFromTyped(text, lang))}
            placeholder={capNow !== null ? capHint(capNow, lang) : '0'}
            unit="USD"
          />
        ) : (
          <AmountField
            label={priceLabel}
            aside={market?.key === key && market.status === 'error' ? w.noMarketPrice : undefined}
            value={fieldText(price)}
            onChange={(text) => setPrice(fieldValue(text))}
            placeholder={fieldText(marketPrice !== null ? zerosText(marketPrice, typedPrice) : '0')}
            asset={{ symbol: unit, icon: payLogo(choice.pay) }}
          />
        )}
      </fieldset>
      {marketPrice !== null ? (
        <div className={s.priceRow}>
          {capOpen ? (
            <Quiet size="s" className={s.byPick} disabled={!idle} aria-label={byCap ? x.switchToPrice : x.switchToCap} aria-pressed={byCap} onClick={flip}>
              <Icon name="swap" size="s" />
              {byCap ? x.byCap : x.byPrice}
            </Quiet>
          ) : null}
          <span className={s.distance}>{distance !== null && Number.isFinite(distance) && !crosses && !wrongSide ? distanceWords(distance, w) : null}</span>
          {byCap && capNow !== null ? (
            <Quiet size="s" disabled={!idle} aria-label={x.useCapNow(capShort(capNow))} onClick={() => typeCap(capWritten(capNow))}>
              {x.capNow(capShort(capNow))}
            </Quiet>
          ) : (
            <Quiet size="s" disabled={!idle} aria-label={w.useMarketPrice(digits(typedPrice(marketPrice)), unit)} onClick={() => setPrice(typedPrice(marketPrice))}>
              {/* A tiny price as the chart writes it: its zeros counted, not a row of them. */}
              {w.marketAt(digits(zerosText(marketPrice, typedPrice)))}
            </Quiet>
          )}
        </div>
      ) : null}
      {mode === 'stop' ? (
        <fieldset className={s.group} disabled={!idle}>
          <Shares label={w.watchFor} options={STOP_EXPIRIES.map((id) => ({ id, label: expiryWords(id) }))} value={expiry} onPick={setExpiry} />
        </fieldset>
      ) : null}
      {/* «You get» once there is a price to count it at: before it, no line at all (QA 20.11: «You get —»). */}
      {typedPriceOk ? (
        <div className={s.getRow}>
          <span className={s.getCol}>
            <Kick>{t.youGet}</Kick>
            <span className={s.getFigure} aria-live="polite">
              {getFigure ? <Figure value={getFigure} unit={getUnit} size="m" /> : <Figure value="—" size="m" />}
            </span>
          </span>
        </div>
      ) : null}
      <div className={s.termsLine}>
        {mode === 'limit' ? (
          shown ? (
            <>
              <span>
                {shown.fee.ryntraBps > 0 ? fw.ryntra(formatBps(shown.fee.ryntraBps)) : shown.fee.venueBps > 0 ? `${w.jupiterFee} ${formatBps(shown.fee.venueBps)}` : fw.none}
                {` · ${w.fillsAt} ${digits(typedPrice(shown.fillPrice))} ${unit} ${w.per(coin)}`}
              </span>
              <ExplainButton label={w.orderDetails} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
            </>
          ) : (
            <span>
              {`${w.min} ${w.minUsd(TRIGGER_V1_MIN_ORDER_USD)}`}
              {minInPay ? ` ≈ ${minInPay}` : ''}
              {` · ${w.untilYouCancel}`}
            </span>
          )
        ) : (
          <>
            <span>{STOPS_ENGINE ? w.remindWhenThere(side === 'sell') : w.watchedWhileOpen}</span>
            <ExplainButton label={w.howStop} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
          </>
        )}
      </div>
      {details && (mode === 'stop' || shown) ? (
        <ExplainBox id={detailsId}>
          {mode === 'limit' && shown ? (
            <LimitDetails review={shown} unit={unit} coin={coin} />
          ) : (
              <Rows
                rows={[
                  [w.watched, STOPS_ENGINE ? k.watchedByRyntra : w.onDevice],
                  ...(STOPS_ENGINE ? ([[w.reminder, w.reminderWays]] as const) : []),
                  [w.whenReached, w.opensAtMarket(side === 'sell')],
                  [w.signing, w.yourWallet],
                ]}
              />
          )}
        </ExplainBox>
      ) : null}
      {note ? (
        <p className={s.note} data-tone={note.tone} role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      ) : null}
      {risk && side === 'buy' ? <div className={s.risk}>{risk}</div> : null}
      {picking && !connection ? (
        <WalletPick onBack={() => setPicking(false)} />
      ) : (
        <Action className={s.go} data-long={label.length > LONG_LABEL || undefined} onClick={() => void tap()} disabled={disabled} busy={busy} aria-label={label === w.setStop ? w.setStopFor(coin) : undefined}>
          {label}
        </Action>
      )}
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

/** The limit order behind «i»: what goes in, what comes back, the price it fills at, every fee and the deposit. */
function LimitDetails({ review, unit, coin }: { review: LimitReview; unit: string; coin: string }) {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  const out = review.side === 'buy' ? review.pair.baseDecimals : review.pair.quoteDecimals;
  const input = review.side === 'buy' ? review.pair.quoteDecimals : review.pair.baseDecimals;
  const outUnit = review.side === 'buy' ? coin : unit;
  const inUnit = review.side === 'buy' ? unit : coin;
  const rows: [string, string][] = [
    [w.youPutIn, `${digits(formatUnits(review.makingRaw, input))} ${inUnit}`],
    [t.youGet, `${digits(formatUnits(review.takingRaw, out, 'down'))} ${outUnit}${w.whenFills}`],
    [w.yourPrice, `${digits(review.price)} ${unit}`],
    [w.fillsAtLabel, `${digits(typedPrice(review.fillPrice))} ${unit}${review.fee.ryntraBps + review.fee.venueBps > 0 ? w.feeOnTop : ''}`],
    [t.ryntraFee, review.fee.ryntraBps > 0 ? `${formatBps(review.fee.ryntraBps)} · ${digits(formatUnits(review.fee.ryntraFeeRaw, out, 'nearest'))} ${outUnit}` : t.none],
  ];
  if (review.fee.venueBps > 0) rows.push([w.jupiterFee, `${formatBps(review.fee.venueBps)} · ${digits(formatUnits(review.fee.venueFeeRaw, out, 'nearest'))} ${outUnit}`]);
  rows.push([t.networkFee, `${digits(formatUnits(String(review.networkFeeLamports), 9))} SOL`]);
  if (review.depositLamports !== null && review.depositLamports > 0) rows.push([w.deposit, `${digits(formatUnits(String(review.depositLamports), 9))} SOL${w.backWhenCloses}`]);
  rows.push([w.lasts, w.untilCancelIt], [t.riskCheck, riskWords(review.risk.verdict, t)], [w.venue, w.jupiterLimit]);
  return <Rows rows={rows} />;
}

/** A placed limit or a set stop: its price, what it does, and the way to the next one. */
function Placed({ onOrders }: { onOrders?: () => void }) {
  const w = useWords(SPOT);
  const placed = useSpot((st) => st.placed);
  const again = useSpot((st) => st.again);
  if (!placed) return null;
  const seeOrders = () => {
    again();
    onOrders?.();
  };
  if (placed.kind === 'stop') {
    const stop = placed.stop;
    const unit = bare(unitOf(stop.quote));
    const spent = stop.side === 'buy' ? stop.quote.decimals : stop.base.decimals;
    return (
      <>
        <div className={s.result} role="status">
          <Kick className={s.kickUp}>{w.stopSet}</Kick>
          <Figure value={digits(stop.price)} unit={unit} />
          <span className={s.line}>
            {stop.side === 'sell' ? w.sellLine(digits(formatUnits(stop.amountRaw, spent)), bare(stop.base.symbol)) : w.buyWithLine(bare(stop.base.symbol), digits(formatUnits(stop.amountRaw, spent)), unit)}
            {stop.expiresAt ? w.untilDate(dateText(stop.expiresAt, { day: 'numeric', month: 'short' })) : w.untilCancelled}
          </span>
        </div>
        <Action onClick={again}>{w.newStop}</Action>
        {onOrders ? (
          <Quiet full onClick={seeOrders}>
            {w.myOrders}
          </Quiet>
        ) : null}
      </>
    );
  }
  const review = placed.review;
  const baseAmount = review.side === 'buy' ? review.takingRaw : review.makingRaw;
  const quoteAmount = review.side === 'buy' ? review.makingRaw : review.takingRaw;
  return (
    <>
      <div className={s.result} role="status">
        <Kick className={s.kickUp}>{placed.settled ? w.orderPlaced : w.orderSent}</Kick>
        <Figure value={digits(review.price)} unit={bare(placed.unit)} />
        <span className={s.line}>
          {w.placedLine(review.side === 'buy', digits(formatUnits(baseAmount, review.pair.baseDecimals, 'down')), bare(placed.coin), digits(formatUnits(quoteAmount, review.pair.quoteDecimals, 'down')), bare(placed.unit))}
          {placed.settled ? '' : w.notConfirmed}
        </span>
        <TxLink signature={placed.signature} />
      </div>
      <Action onClick={again}>{w.newOrder}</Action>
      {onOrders ? (
        <Quiet full onClick={seeOrders}>
          {w.myOrders}
        </Quiet>
      ) : null}
    </>
  );
}

/** The order reached the chain and failed: only the network fee moved. */
function SpotFailed() {
  const t = useWords(TRADE);
  const signature = useSpot((st) => st.failed);
  const again = useSpot((st) => st.again);
  return (
    <>
      <div className={s.result} role="alert">
        <Kick className={s.kickDown}>{t.didntGo}</Kick>
        <span className={s.line}>{t.onlyFee}</span>
        {signature ? <TxLink signature={signature} /> : null}
      </div>
      <Action onClick={again}>{t.tryAgain}</Action>
    </>
  );
}

/** The order's outcome is not known yet: «My orders» reads it; it is never placed again by itself. */
function SpotUnclear({ onOrders }: { onOrders?: () => void }) {
  const w = useWords(SPOT);
  const t = useWords(TRADE);
  const unclear = useSpot((st) => st.unclear);
  const phase = useSpot((st) => st.phase);
  const again = useSpot((st) => st.again);
  return (
    <>
      <div className={s.result} role="status">
        <Kick className={s.kickWarn}>{t.stillChecking}</Kick>
        <span className={s.line}>{unclear?.message}</span>
        {unclear?.signature ? <TxLink signature={unclear.signature} /> : null}
      </div>
      <Action
        disabled={SPOT_BUSY.has(phase)}
        onClick={() => {
          again();
          onOrders?.();
        }}
      >
        {w.myOrders}
      </Action>
    </>
  );
}
