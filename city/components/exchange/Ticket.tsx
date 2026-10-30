'use client';

import { useMemo, useState } from 'react';
import { ACCOUNT_WORDS, opensFrom } from '@/city/lib/exchange/account';
import type { CollateralReview, OrderReview } from '@/city/lib/exchange/engine';
import { clock, funding, lamportsSol, leverage, micro, percent, plainPrice, price, signedUsd, units, usd } from '@/city/lib/exchange/format';
import { STATE_WORDS, tradable, unitsOf } from '@/city/lib/exchange/markets';
import { leverageAt, leverageMarks, placeOfLeverage, sizeView, SLIDER_STEPS } from '@/city/lib/exchange/sizing';
import { BUSY, LOCKED, ticketView, useExchange, type Intent, type Pending, type Result } from '@/city/lib/exchange/store';
import { reviewTerms, termsLine } from '@/city/lib/exchange/terms';
import { ISSUE_WORDS, SHARES } from '@/city/lib/exchange/ticket';
import { digits, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { useWallet } from '@/city/lib/trade/wallet';
import { stateOf } from '@/lib/phoenix/market-data';
import { unitsTextFromLots } from '@/lib/phoenix/orders-model';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { ConnectAction, useAccountKind } from './Account';
import { ChevronGlyph } from './glyphs';
import { EX } from './words';
import s from './exchange.module.css';

type W = (typeof EX)['en'];

/** The trade side: the ticket, or — while one is open — the Review of an action and then its outcome. */
export function TradePane() {
  const pending = useExchange((st) => st.pending);
  const result = useExchange((st) => st.result);
  const asking = useExchange((st) => st.asking);
  if (pending || result || asking) return <ActionCard />;
  return <Ticket />;
}

function Ticket() {
  const connection = useWallet((st) => st.connection);
  const symbol = useExchange((st) => st.symbol);
  const markets = useExchange((st) => st.markets);
  const owner = useExchange((st) => st.owner);
  const draft = useExchange((st) => st.draft);
  const figures = useExchange((st) => st.figures);
  const maxFor = useExchange((st) => st.maxFor);
  const orderStates = useExchange((st) => st.orderStates);
  const figuresRead = useExchange((st) => st.figuresRead);
  const phase = useExchange((st) => st.phase);
  const notice = useExchange((st) => st.notice);
  const setDraft = useExchange((st) => st.setDraft);
  const review = useExchange((st) => st.review);
  const kind = useAccountKind();
  const w = useWords(EX);
  const view = useMemo(() => ticketView({ symbol, markets, owner, draft, figures, maxFor, orderStates }), [symbol, markets, owner, draft, figures, maxFor, orderStates]);
  const market = view.market;
  if (!market) return markets.status === 'failed' ? <div className={s.empty}>{w.phoenixSilent}</div> : <span className={s.shimmer} />;
  const marketUnits = unitsOf(market);
  const busy = BUSY.has(phase);
  const marks = leverageMarks(market.maxLeverage);
  const size = sizeView(draft, market, view.maxLots);
  const block = !connection
    ? w.connectWallet
    : !opensFrom(kind)
      ? ACCOUNT_WORDS[kind].title
      : orderStates === null
        ? w.checkingAccess
        : !orderStates.open
          ? w.notOpen
          : !tradable(market)
            ? stateOf(market) === 'trading'
              ? w.marketPaused
              : STATE_WORDS[stateOf(market)]
            : market.isolatedOnly
              ? w.isolatedOnly
              : null;
  const reviewSide = draft.side === 'long' ? w.reviewLong : w.reviewShort;
  const label = phase === 'reviewing' ? w.preparing : (block ?? (view.issue ? ISSUE_WORDS[view.issue] : reviewSide));
  const order = view.figures?.order ?? null;
  const maxText = view.maxLots !== null && marketUnits && /^\d+$/.test(view.maxLots) ? `${digits(unitsTextFromLots(BigInt(view.maxLots), marketUnits.baseLotsDecimals))} ${market.symbol}` : '—';
  const liquidation = !order ? '—' : order.liquidation.kind === 'price' ? price(order.liquidation.priceUsd) : order.liquidation.kind === 'none' ? w.noneAtSize : w.phoenixCantSay;
  return (
    <>
      <div className={s.block}>
        <div className={s.segment} role="radiogroup" aria-label={w.side}>
          {(['long', 'short'] as const).map((side) => (
            <button key={side} role="radio" aria-checked={draft.side === side} className={`${s.choice} ${s[side]} ${draft.side === side ? s.choiceOn : ''}`} disabled={busy} onClick={() => setDraft({ side })}>
              {side === 'long' ? w.longUp : w.shortDown}
            </button>
          ))}
        </div>
        <div className={s.segment} role="radiogroup" aria-label={w.orderType}>
          {(['market', 'limit'] as const).map((type) => (
            <button key={type} role="radio" aria-checked={draft.type === type} className={`${s.choice} ${draft.type === type ? s.choiceOn : ''}`} disabled={busy} onClick={() => setDraft({ type })}>
              {type === 'market' ? w.marketOrder : w.limitOrder}
            </button>
          ))}
        </div>
      </div>
      <div className={s.block}>
        <div className={s.labelRow}>
          <div className={s.label}>{w.leverage}</div>
          <div className={`${s.display} ${s.dialValue}`}>{draft.leverage}×</div>
        </div>
        <Slider
          label={w.leverage}
          max={SLIDER_STEPS}
          value={Math.round(placeOfLeverage(draft.leverage, market.maxLeverage) * SLIDER_STEPS)}
          text={`${draft.leverage}×`}
          disabled={busy}
          onChange={(at) => setDraft({ leverage: leverageAt(at / SLIDER_STEPS, market.maxLeverage) })}
        />
        <div className={s.marks} role="group" aria-label={w.leverageSteps}>
          {marks.map((mark) => (
            <button
              key={mark.step}
              className={`${s.mark} ${draft.leverage === mark.step ? s.markOn : ''}`}
              style={{ left: `${mark.at * 100}%` }}
              aria-pressed={draft.leverage === mark.step}
              disabled={busy}
              onClick={() => setDraft({ leverage: mark.step })}
            >
              {mark.step}×
            </button>
          ))}
        </div>
      </div>
      {draft.type === 'limit' && (
        <div className={s.block}>
          <div className={s.label}>{w.limitPrice}</div>
          <label className={s.field}>
            <span className={s.fieldUnit}>$</span>
            <input className={s.input} inputMode="decimal" placeholder={fieldText(plainPrice(market.markPrice))} aria-label={w.limitPriceUsd} value={fieldText(draft.price)} onChange={(event) => setDraft({ price: fieldValue(event.target.value) })} disabled={busy} />
          </label>
        </div>
      )}
      <div className={s.block}>
        <div className={s.labelRow}>
          <div className={s.label}>{w.size}</div>
          {maxText !== '—' && (
            <div className={s.labelSide} title={w.mostAt(draft.leverage)}>
              {w.maxOf(maxText)}
            </div>
          )}
        </div>
        <label className={s.field}>
          <span className={s.fieldUnit}>$</span>
          <input
            className={s.input}
            inputMode="decimal"
            placeholder={draft.size.kind === 'share' ? `${draft.size.percent}%` : digits('0.00')}
            aria-label={w.positionSizeUsd}
            value={fieldText(size.text)}
            onChange={(event) => setDraft({ size: { kind: 'usd', text: fieldValue(event.target.value) } })}
            disabled={busy}
          />
        </label>
        <Slider
          label={w.shareOfFree}
          max={100}
          value={size.percent ?? 0}
          text={w.percentOfFree(size.percent ?? 0)}
          disabled={busy || !connection || !opensFrom(kind)}
          onChange={(percent) => setDraft({ size: { kind: 'share', percent } })}
        />
        <div className={`${s.chips} ${s.chipsFill}`} role="group" aria-label={w.shareOfFree}>
          {SHARES.map((share) => (
            <button
              key={share}
              className={`${s.chip} ${size.chip === share ? s.chipOn : ''}`}
              aria-pressed={size.chip === share}
              disabled={busy || !connection || !opensFrom(kind)}
              onClick={() => setDraft({ size: { kind: 'share', percent: share } })}
            >
              {share === 100 ? w.max : `${share}%`}
            </button>
          ))}
        </div>
      </div>
      {draft.type === 'market' && (
        <div className={s.block}>
          <button className={s.toggle} aria-pressed={draft.tpsl} disabled={busy} onClick={() => setDraft({ tpsl: !draft.tpsl })}>
            <span>{w.tpSlSpaced}</span>
            <span className={`${s.switch} ${draft.tpsl ? s.switchOn : ''}`} aria-hidden="true" />
          </button>
          {draft.tpsl && (
            <div className={s.pairFields}>
              <label className={s.field}>
                <span className={s.fieldUnit}>{w.tp}</span>
                <input className={s.input} inputMode="decimal" placeholder={w.price} aria-label={w.takeProfitUsd} value={fieldText(draft.tp)} onChange={(event) => setDraft({ tp: fieldValue(event.target.value) })} disabled={busy} />
              </label>
              <label className={s.field}>
                <span className={s.fieldUnit}>{w.sl}</span>
                <input className={s.input} inputMode="decimal" placeholder={w.price} aria-label={w.stopLossUsd} value={fieldText(draft.sl)} onChange={(event) => setDraft({ sl: fieldValue(event.target.value) })} disabled={busy} />
              </label>
            </div>
          )}
        </div>
      )}
      {connection && draft.side && opensFrom(kind) && (
        <div className={s.block}>
          <div className={s.rows} title={view.figures ? w.calculatorRead(clock(view.figures.observedAt)) : w.calculator} aria-busy={figuresRead === 'loading'}>
            <Row label={w.margin} value={usd(order?.marginAtLeverageUsd)} />
            <Row label={w.feesTitle} value={usd(order?.feesUsd)} />
            <Row label={w.liquidationTitle} value={liquidation} tone={order?.liquidation.kind === 'price' ? 'down' : undefined} />
            <Row label={w.freeAfter} value={usd(order?.after?.availableUsd)} />
          </div>
          {order && !order.carried && <div className={`${s.notice} ${s.noticeWarn}`}>{w.notEnough}</div>}
          {figuresRead === 'failed' && !view.figures && <div className={`${s.notice} ${s.noticeWarn}`}>{w.phoenixSilentDot}</div>}
        </div>
      )}
      {notice && <div className={`${s.notice} ${notice.tone === 'warn' ? s.noticeWarn : s.noticeError}`}>{notice.text}</div>}
      <div className={s.grow} />
      <div className={s.foot}>
        {connection && block === null && view.issue === 'SIDE' && phase !== 'reviewing' ? (
          // No side yet: Long and Short are the foot's own two buttons, never «choose long or short» under the fold of a
          // phone's half sheet (CITY-150).
          <div className={s.sideActs} role="radiogroup" aria-label={w.side}>
            {(['long', 'short'] as const).map((side) => (
              <button key={side} role="radio" aria-checked={false} className={`${s.display} ${s.sideAct} ${s[side]} ${s.choiceOn}`} disabled={busy} onClick={() => setDraft({ side })}>
                {side === 'long' ? w.longUp : w.shortDown}
              </button>
            ))}
          </div>
        ) : connection ? (
          <button
            className={`${s.display} ${s.action} ${phase === 'reviewing' ? s.waiting : ''}`}
            disabled={busy || block !== null || view.issue !== null}
            onClick={() => void review(connection, { kind: 'open' })}
          >
            {label}
          </button>
        ) : (
          <ConnectAction />
        )}
      </div>
    </>
  );
}

/**
 * One slider of the ticket: a native range, so a keyboard, a screen reader and a thumb all move it, drawn in the city's
 * glass with the travelled part lit.
 */
function Slider({ label, max, value, text, disabled, onChange }: { label: string; max: number; value: number; text: string; disabled: boolean; onChange: (value: number) => void }) {
  const fill = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <input
      type="range"
      className={s.slider}
      min={0}
      max={max}
      step={1}
      value={value}
      aria-label={label}
      aria-valuetext={text}
      disabled={disabled}
      style={{ ['--fill' as string]: `${fill}%` }}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'warn' }) {
  return (
    <div className={s.rowFigure}>
      <span>{label}</span>
      <span className={tone === 'up' ? s.up : tone === 'down' ? s.down : tone === 'warn' ? s.warnText : undefined}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------- the card */

const INTENT_TITLE = (intent: Intent, w: W): string => {
  switch (intent.kind) {
    case 'open':
      return w.newPosition;
    case 'close':
      return w.closePosition(intent.symbol);
    case 'protect':
      return w.tpslOf(intent.symbol);
    case 'cancel':
      return intent.leg ? (intent.leg === 'tp' ? w.cancelTpOf(intent.symbol) : w.cancelSlOf(intent.symbol)) : w.cancelOrderOf(intent.symbol);
    case 'cancelAll':
      return w.cancelOrdersOf(intent.symbol);
    case 'deposit':
      return w.addCollateral;
    case 'withdraw':
      return w.withdrawCollateral;
  }
};

function ActionCard() {
  const pending = useExchange((st) => st.pending);
  const result = useExchange((st) => st.result);
  const asking = useExchange((st) => st.asking);
  const phase = useExchange((st) => st.phase);
  const notice = useExchange((st) => st.notice);
  const back = useExchange((st) => st.back);
  const w = useWords(EX);
  if (result) return <Outcome result={result} />;
  if (pending) return <ReviewCard pending={pending} />;
  return (
    <div className={s.block} role="status">
      <div className={s.label}>{asking ? INTENT_TITLE(asking, w) : w.review}</div>
      {phase === 'reviewing' ? (
        <>
          <span className={s.shimmer} />
          <span className={`${s.shimmer} ${s.shimmerShort}`} />
        </>
      ) : (
        notice && <div className={`${s.notice} ${notice.tone === 'warn' ? s.noticeWarn : s.noticeError}`}>{notice.text}</div>
      )}
      <button className={s.quiet} onClick={back} disabled={phase === 'reviewing'}>
        {w.back}
      </button>
    </div>
  );
}

/** How the book takes the order, when it has no price impact to show; a book that walked says nothing. */
const BOOK_WORDS: Readonly<Record<OrderReview['book'], TextKey<typeof EX> | null>> = {
  walked: null,
  thin: 'bookThin',
  quiet: 'bookQuiet',
  resting: 'bookResting',
  unsure: 'bookUnsure',
};

function orderTitle(review: OrderReview, w: W): string {
  const size = units(Number(review.sizeUnits), review.symbol);
  switch (review.kind) {
    case 'open':
      return review.side === 'long' ? w.longSize(size) : w.shortSize(size);
    case 'reduce':
      return w.closeSize(size);
    case 'protect':
      return w.setTpsl;
    case 'cancel':
      return w.cancelOrder;
    case 'cancelAll':
      return w.cancelCount(review.cancelAll?.count ?? null);
    case 'cancelConditional':
      return review.conditional && review.conditional.legs.length > 1 ? w.cancelTpAndSl : w.cancelTpsl;
  }
}

function OrderRows({ review }: { review: OrderReview }) {
  const [more, setMore] = useState(false);
  const w = useWords(EX);
  const after = review.after;
  const trades = review.kind === 'open' || review.kind === 'reduce';
  const legs = review.kind === 'open' || review.kind === 'protect';
  const builder = review.fees.builderBps === 0 ? '0' : review.fees.builderUsd === null ? w.onTheFill : usd(review.fees.builderUsd);
  const bookWord = BOOK_WORDS[review.book];
  const impact = review.impact ? percent(review.impact.percent, 2) : bookWord ? w[bookWord] : '—';
  const fill = fillWord(review, w);
  // The size, leverage, liquidation and fee stand in the one line above; the price it fills at stays in sight; how it
  // fills, each fee by itself and the rest of the account open on «Details».
  return (
    <>
      <div className={s.rows}>
        {trades && <Row label={w.positionValue} value={usd(review.notionalUsd)} />}
        {trades && <Row label={review.type === 'limit' && review.kind === 'open' ? w.limitPrice : w.fillsNoWorse} value={price(review.priceUsd)} />}
        {review.kind === 'cancelConditional' && review.conditional && review.conditional.legs.length > 1 && <Row label={w.cancels} value={w.tpAndSl} />}
        {review.clearsLegs && review.kind !== 'cancelConditional' && <Row label={w.currentTpsl} value={w.replaced} />}
        {legs && review.tpUsd !== null && <Row label={w.takeProfit} value={price(review.tpUsd)} />}
        {legs && review.slUsd !== null && <Row label={w.stopLoss} value={price(review.slUsd)} />}
        {review.kind === 'protect' && review.tpUsd === null && review.slUsd === null && <Row label={w.tpsl} value={w.lifted} />}
        {review.order && (
          <Row
            label={w.order}
            value={(review.order.side === 'buy' ? w.buyAt : w.sellAt)(review.order.sizeUnits === null || review.order.sizeUnits === undefined ? '—' : digits(String(review.order.sizeUnits)), price(review.order.priceUsd))}
          />
        )}
        {review.conditional && review.conditional.tpUsd !== null && <Row label={w.takeProfit} value={price(review.conditional.tpUsd)} />}
        {review.conditional && review.conditional.slUsd !== null && <Row label={w.stopLoss} value={price(review.conditional.slUsd)} />}
        {!trades && <Row label={w.networkFee} value={lamportsSol(review.networkFeeLamports)} />}
        {more && trades && <Row label={w.phoenixFee} value={review.fees.venueUsd === null ? w.onTheFill : usd(review.fees.venueUsd)} />}
        {more && trades && review.fees.builderBps > 0 && <Row label={w.ryntraFee} value={builder} />}
        {more && trades && fill && <Row label={w.fill} value={fill} />}
        {more && trades && <Row label={w.priceImpact} value={impact} tone={review.book === 'thin' ? 'warn' : undefined} />}
        {more && after && trades && <Row label={w.leverageAfter} value={leverage(after.leverage)} />}
        {more && after && trades && <Row label={w.freeAfter} value={usd(after.freeCollateralUsd)} />}
        {more && review.kind === 'open' && review.funding && <Row label={w.fundingTitle} value={funding({ ratePercent: review.funding.ratePercent, payer: review.funding.payer, periodSeconds: review.funding.intervalSeconds })} />}
        {more && trades && <Row label={w.networkFee} value={lamportsSol(review.networkFeeLamports)} />}
        {review.rentLamports !== '0' && <Row label={w.rent} value={lamportsSol(review.rentLamports)} />}
      </div>
      {trades && (
        <button className={s.more} aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? w.less : w.details}
          <ChevronGlyph className={`${s.moreGlyph} ${more ? s.moreGlyphOn : ''}`} />
        </button>
      )}
    </>
  );
}

/** How the order fills, in two words: a row of the Review, not a paragraph under it. */
function fillWord(review: OrderReview, w: W): string | null {
  if (review.kind === 'open' && review.type === 'market') return review.tif === 'ioc' ? w.whatBookGives : w.allOrNothing;
  if (review.kind === 'open') return w.restsInBook;
  return null;
}

function CollateralRows({ review }: { review: CollateralReview }) {
  const deposit = review.action === 'deposit';
  const w = useWords(EX);
  return (
    <div className={s.rows}>
      <Row label={deposit ? w.fromWallet : w.fromPhoenix} value={micro(review.amount)} />
      <Row label={deposit ? w.toPhoenix : w.toWallet} value={micro(review.receive)} />
      <Row label={w.phoenixKeeps} value={micro(review.phoenixFee)} />
      {!deposit && review.freeAfter !== null && <Row label={w.freeAfter} value={micro(review.freeAfter)} />}
      <Row label={w.networkFee} value={lamportsSol(review.networkFeeLamports)} />
      {review.rentLamports !== '0' && <Row label={w.rent} value={lamportsSol(review.rentLamports)} />}
    </div>
  );
}

function ReviewCard({ pending }: { pending: Pending }) {
  const phase = useExchange((st) => st.phase);
  const notice = useExchange((st) => st.notice);
  const confirm = useExchange((st) => st.confirm);
  const back = useExchange((st) => st.back);
  const connection = useWallet((st) => st.connection);
  const w = useWords(EX);
  const locked = LOCKED.has(phase);
  const mine = connection?.address === pending.owner;
  // An order that trades: the side as the title and, in one line under it, the size, leverage, liquidation and fee.
  const terms = pending.kind === 'order' ? reviewTerms(pending.review) : null;
  const title =
    pending.kind === 'order'
      ? terms
        ? pending.review.kind === 'reduce'
          ? w.closeTitle
          : pending.review.side === 'long'
            ? w.longTitle
            : w.shortTitle
        : orderTitle(pending.review, w)
      : (pending.review.action === 'deposit' ? w.addAmount : w.withdrawAmount)(micro(pending.review.amount));
  const label = phase === 'wallet' ? w.confirmInWallet : phase === 'sending' ? w.sending : phase === 'reviewing' ? w.refreshing : w.signInWallet;
  return (
    <>
      <div className={s.block}>
        <div className={s.label}>{w.reviewOf(pending.kind === 'order' ? w.perp(pending.review.symbol) : 'USDC')}</div>
        <div className={`${s.display} ${s.result}`}>{title}</div>
        {terms && <div className={s.terms}>{termsLine(terms)}</div>}
        {pending.kind === 'order' ? <OrderRows review={pending.review} /> : <CollateralRows review={pending.review} />}
        {notice && <div className={`${s.notice} ${notice.tone === 'warn' ? s.noticeWarn : s.noticeError}`}>{notice.text}</div>}
      </div>
      <div className={s.grow} />
      <div className={s.foot}>
        <button className={`${s.display} ${s.action} ${locked || phase === 'reviewing' ? s.waiting : ''}`} disabled={!mine || BUSY.has(phase)} onClick={() => connection && void confirm(connection)}>
          {mine ? label : w.connectThisWallet}
        </button>
        <button className={s.quiet} onClick={back} disabled={BUSY.has(phase)}>
          {w.back}
        </button>
      </div>
    </>
  );
}

const OUTCOME: Readonly<Record<string, Readonly<{ kicker: TextKey<typeof EX>; tone: 'ok' | 'warn' | 'danger' }>>> = {
  filled: { kicker: 'outFilled', tone: 'ok' },
  partial: { kicker: 'outPartial', tone: 'warn' },
  accepted: { kicker: 'outAccepted', tone: 'ok' },
  set: { kicker: 'outSet', tone: 'ok' },
  cancelled: { kicker: 'outCancelled', tone: 'ok' },
  pending: { kicker: 'outPending', tone: 'warn' },
  failed: { kicker: 'outFailed', tone: 'danger' },
  done: { kicker: 'outDone', tone: 'ok' },
};

function Outcome({ result }: { result: Result }) {
  const back = useExchange((st) => st.back);
  const recheck = useExchange((st) => st.recheck);
  const w = useWords(EX);
  const outcome = result.receipt.outcome;
  const words = OUTCOME[outcome] ?? OUTCOME.pending!;
  const signature = result.receipt.signature;
  const [why, setWhy] = useState(false);
  let title: string;
  let line: string | null = null;
  if (result.kind === 'order') {
    const review = result.review;
    const fills = result.receipt.fills;
    title = fills ? (review.kind === 'reduce' ? w.closedSize : review.side === 'long' ? w.longSize : w.shortSize)(units(fills.sizeUnits, review.symbol)) : orderTitle(review, w);
    if (outcome === 'accepted') line = w.restingAt(price(review.priceUsd));
    if (outcome === 'cancelled' && (review.kind === 'open' || review.kind === 'reduce')) line = w.nothingFilled;
  } else {
    const moved = result.receipt.movedMicro;
    title = (result.review.action === 'deposit' ? w.added : w.withdrew)(micro(moved ?? BigInt(result.review.receive)));
  }
  if (outcome === 'failed') line = w.onlyFee;
  if (outcome === 'pending') line = w.notConfirmed;
  // The chain's own reason for a failure is its words, not ours: behind one quiet «Why».
  const reason = outcome === 'failed' ? result.receipt.reason : null;
  const fills = result.kind === 'order' ? result.receipt.fills : null;
  return (
    <>
      <div className={s.block} role="status">
        <div className={`${s.outcome} ${words.tone === 'warn' ? s.outcomeWarn : words.tone === 'danger' ? s.outcomeDanger : ''}`}>{w[words.kicker]}</div>
        <div className={`${s.display} ${s.result}`}>{title}</div>
        {line && <div className={s.terms}>{line}</div>}
        {reason && (
          <>
            <button className={s.more} aria-expanded={why} onClick={() => setWhy((v) => !v)}>
              {w.why}
              <ChevronGlyph className={`${s.moreGlyph} ${why ? s.moreGlyphOn : ''}`} />
            </button>
            {why && <div className={s.line}>{reason}</div>}
          </>
        )}
        {fills && (
          <div className={s.rows}>
            <Row label={w.averagePrice} value={price(fills.averageUsd)} />
            <Row label={w.feesTitle} value={usd(fills.feeUsd)} />
            {result.kind === 'order' && result.review.kind === 'reduce' && <Row label={w.realisedTitle} value={signedUsd(fills.realizedPnlUsd)} tone={fills.realizedPnlUsd === null ? undefined : fills.realizedPnlUsd >= 0 ? 'up' : 'down'} />}
          </div>
        )}
        {signature && (
          <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noopener noreferrer">
            {w.viewExplorer}
          </a>
        )}
      </div>
      <div className={s.grow} />
      <div className={s.foot}>
        {outcome === 'pending' && (
          <button className={`${s.choice} ${s.choiceOn} ${s.formAction}`} onClick={() => void recheck()}>
            {w.checkAgain}
          </button>
        )}
        <button className={`${s.display} ${s.action}`} onClick={back}>
          {w.done}
        </button>
      </div>
    </>
  );
}
