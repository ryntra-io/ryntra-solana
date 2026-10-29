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
import { useWallet } from '@/city/lib/trade/wallet';
import { stateOf } from '@/lib/phoenix/market-data';
import { unitsTextFromLots } from '@/lib/phoenix/orders-model';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { useAccountKind } from './Account';
import { ChevronGlyph } from './glyphs';
import s from './exchange.module.css';

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
  const view = useMemo(() => ticketView({ symbol, markets, owner, draft, figures, maxFor, orderStates }), [symbol, markets, owner, draft, figures, maxFor, orderStates]);
  const market = view.market;
  if (!market) return markets.status === 'failed' ? <div className={s.empty}>Phoenix isn’t answering</div> : <span className={s.shimmer} />;
  const marketUnits = unitsOf(market);
  const busy = BUSY.has(phase);
  const marks = leverageMarks(market.maxLeverage);
  const size = sizeView(draft, market, view.maxLots);
  const block = !connection
    ? 'Connect a wallet'
    : !opensFrom(kind)
      ? ACCOUNT_WORDS[kind].title
      : orderStates === null
        ? 'Checking access…'
        : !orderStates.open
          ? 'Not open for this wallet yet'
          : !tradable(market)
            ? stateOf(market) === 'trading'
              ? 'Market paused'
              : STATE_WORDS[stateOf(market)]
            : market.isolatedOnly
              ? 'Isolated margin only'
              : null;
  const sideWord = draft.side === 'long' ? 'long' : 'short';
  const label = phase === 'reviewing' ? 'Preparing…' : (block ?? (view.issue ? ISSUE_WORDS[view.issue] : `Review ${sideWord}`));
  const order = view.figures?.order ?? null;
  const maxText = view.maxLots !== null && marketUnits && /^\d+$/.test(view.maxLots) ? `${unitsTextFromLots(BigInt(view.maxLots), marketUnits.baseLotsDecimals)} ${market.symbol}` : '—';
  const liquidation = !order ? '—' : order.liquidation.kind === 'price' ? price(order.liquidation.priceUsd) : order.liquidation.kind === 'none' ? 'None at this size' : 'Phoenix can’t say';
  return (
    <>
      <div className={s.block}>
        <div className={s.segment} role="radiogroup" aria-label="Side">
          {(['long', 'short'] as const).map((side) => (
            <button key={side} role="radio" aria-checked={draft.side === side} className={`${s.choice} ${draft.side === side ? s.choiceOn : ''}`} disabled={busy} onClick={() => setDraft({ side })}>
              {side === 'long' ? 'Long ↑' : 'Short ↓'}
            </button>
          ))}
        </div>
        <div className={s.segment} role="radiogroup" aria-label="Order type">
          {(['market', 'limit'] as const).map((type) => (
            <button key={type} role="radio" aria-checked={draft.type === type} className={`${s.choice} ${draft.type === type ? s.choiceOn : ''}`} disabled={busy} onClick={() => setDraft({ type })}>
              {type === 'market' ? 'Market' : 'Limit'}
            </button>
          ))}
        </div>
      </div>
      <div className={s.block}>
        <div className={s.labelRow}>
          <div className={s.label}>Leverage</div>
          <div className={`${s.display} ${s.dialValue}`}>{draft.leverage}×</div>
        </div>
        <Slider
          label="Leverage"
          max={SLIDER_STEPS}
          value={Math.round(placeOfLeverage(draft.leverage, market.maxLeverage) * SLIDER_STEPS)}
          text={`${draft.leverage}×`}
          disabled={busy}
          onChange={(at) => setDraft({ leverage: leverageAt(at / SLIDER_STEPS, market.maxLeverage) })}
        />
        <div className={s.marks} role="group" aria-label="Leverage steps">
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
          <div className={s.label}>Limit price</div>
          <label className={s.field}>
            <span className={s.fieldUnit}>$</span>
            <input className={s.input} inputMode="decimal" placeholder={plainPrice(market.markPrice)} aria-label="Limit price, USD" value={draft.price} onChange={(event) => setDraft({ price: event.target.value })} disabled={busy} />
          </label>
        </div>
      )}
      <div className={s.block}>
        <div className={s.labelRow}>
          <div className={s.label}>Size</div>
          {maxText !== '—' && (
            <div className={s.labelSide} title={`The most at ${draft.leverage}×, by Phoenix’s margin calculator`}>
              Max {maxText}
            </div>
          )}
        </div>
        <label className={s.field}>
          <span className={s.fieldUnit}>$</span>
          <input
            className={s.input}
            inputMode="decimal"
            placeholder={draft.size.kind === 'share' ? `${draft.size.percent}%` : '0.00'}
            aria-label="Position size, USD"
            value={size.text}
            onChange={(event) => setDraft({ size: { kind: 'usd', text: event.target.value } })}
            disabled={busy}
          />
        </label>
        <Slider
          label="Share of free collateral"
          max={100}
          value={size.percent ?? 0}
          text={`${size.percent ?? 0}% of free collateral`}
          disabled={busy || !connection || !opensFrom(kind)}
          onChange={(percent) => setDraft({ size: { kind: 'share', percent } })}
        />
        <div className={`${s.chips} ${s.chipsFill}`} role="group" aria-label="Share of free collateral">
          {SHARES.map((share) => (
            <button
              key={share}
              className={`${s.chip} ${size.chip === share ? s.chipOn : ''}`}
              aria-pressed={size.chip === share}
              disabled={busy || !connection || !opensFrom(kind)}
              onClick={() => setDraft({ size: { kind: 'share', percent: share } })}
            >
              {share === 100 ? 'Max' : `${share}%`}
            </button>
          ))}
        </div>
      </div>
      {draft.type === 'market' && (
        <div className={s.block}>
          <button className={s.toggle} aria-pressed={draft.tpsl} disabled={busy} onClick={() => setDraft({ tpsl: !draft.tpsl })}>
            <span>TP / SL</span>
            <span className={`${s.switch} ${draft.tpsl ? s.switchOn : ''}`} aria-hidden="true" />
          </button>
          {draft.tpsl && (
            <div className={s.pairFields}>
              <label className={s.field}>
                <span className={s.fieldUnit}>TP</span>
                <input className={s.input} inputMode="decimal" placeholder="Price" aria-label="Take profit price, USD" value={draft.tp} onChange={(event) => setDraft({ tp: event.target.value })} disabled={busy} />
              </label>
              <label className={s.field}>
                <span className={s.fieldUnit}>SL</span>
                <input className={s.input} inputMode="decimal" placeholder="Price" aria-label="Stop loss price, USD" value={draft.sl} onChange={(event) => setDraft({ sl: event.target.value })} disabled={busy} />
              </label>
            </div>
          )}
        </div>
      )}
      {connection && draft.side && opensFrom(kind) && (
        <div className={s.block}>
          <div className={s.rows} title={`Phoenix’s margin calculator${view.figures ? `, read ${clock(view.figures.observedAt)}` : ''}`} aria-busy={figuresRead === 'loading'}>
            <Row label="Margin" value={usd(order?.marginAtLeverageUsd)} />
            <Row label="Fees" value={usd(order?.feesUsd)} />
            <Row label="Liquidation" value={liquidation} tone={order?.liquidation.kind === 'price' ? 'down' : undefined} />
            <Row label="Free after" value={usd(order?.after?.availableUsd)} />
          </div>
          {order && !order.carried && <div className={`${s.notice} ${s.noticeWarn}`}>Not enough free collateral</div>}
          {figuresRead === 'failed' && !view.figures && <div className={`${s.notice} ${s.noticeWarn}`}>Phoenix isn’t answering.</div>}
        </div>
      )}
      {notice && <div className={`${s.notice} ${notice.tone === 'warn' ? s.noticeWarn : s.noticeError}`}>{notice.text}</div>}
      <div className={s.grow} />
      <div className={s.foot}>
        <button
          className={`${s.display} ${s.action} ${phase === 'reviewing' ? s.waiting : ''}`}
          disabled={busy || block !== null || view.issue !== null}
          onClick={() => connection && void review(connection, { kind: 'open' })}
        >
          {label}
        </button>
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

const INTENT_TITLE = (intent: Intent): string => {
  switch (intent.kind) {
    case 'open':
      return 'New position';
    case 'close':
      return `Close ${intent.symbol} position`;
    case 'protect':
      return `${intent.symbol} TP/SL`;
    case 'cancel':
      return intent.leg ? `Cancel ${intent.symbol} ${intent.leg === 'tp' ? 'take profit' : 'stop loss'}` : `Cancel ${intent.symbol} order`;
    case 'cancelAll':
      return `Cancel ${intent.symbol} orders`;
    case 'deposit':
      return 'Add collateral';
    case 'withdraw':
      return 'Withdraw collateral';
  }
};

function ActionCard() {
  const pending = useExchange((st) => st.pending);
  const result = useExchange((st) => st.result);
  const asking = useExchange((st) => st.asking);
  const phase = useExchange((st) => st.phase);
  const notice = useExchange((st) => st.notice);
  const back = useExchange((st) => st.back);
  if (result) return <Outcome result={result} />;
  if (pending) return <ReviewCard pending={pending} />;
  return (
    <div className={s.block} role="status">
      <div className={s.label}>{asking ? INTENT_TITLE(asking) : 'Review'}</div>
      {phase === 'reviewing' ? (
        <>
          <span className={s.shimmer} />
          <span className={`${s.shimmer} ${s.shimmerShort}`} />
        </>
      ) : (
        notice && <div className={`${s.notice} ${notice.tone === 'warn' ? s.noticeWarn : s.noticeError}`}>{notice.text}</div>
      )}
      <button className={s.quiet} onClick={back} disabled={phase === 'reviewing'}>
        Back
      </button>
    </div>
  );
}

const BOOK_WORDS: Readonly<Record<OrderReview['book'], string>> = {
  walked: '',
  thin: 'The book can’t fill all of it now',
  quiet: 'The book didn’t answer',
  resting: 'Rests: takes no liquidity',
  unsure: 'Decided on the fill',
};

function orderTitle(review: OrderReview): string {
  const size = units(Number(review.sizeUnits), review.symbol);
  switch (review.kind) {
    case 'open':
      return `${review.side === 'long' ? 'Long' : 'Short'} ${size}`;
    case 'reduce':
      return `Close ${size}`;
    case 'protect':
      return 'Set TP/SL';
    case 'cancel':
      return 'Cancel order';
    case 'cancelAll':
      return `Cancel ${review.cancelAll?.count ?? ''} orders`.replace('  ', ' ');
    case 'cancelConditional':
      return review.conditional && review.conditional.legs.length > 1 ? 'Cancel TP and SL' : 'Cancel TP/SL';
  }
}

function OrderRows({ review }: { review: OrderReview }) {
  const [more, setMore] = useState(false);
  const after = review.after;
  const trades = review.kind === 'open' || review.kind === 'reduce';
  const legs = review.kind === 'open' || review.kind === 'protect';
  const builder = review.fees.builderBps === 0 ? '0' : review.fees.builderUsd === null ? 'On the fill' : usd(review.fees.builderUsd);
  const impact = review.impact ? percent(review.impact.percent, 2) : BOOK_WORDS[review.book] || '—';
  // The size, leverage, liquidation and fee stand in the one line above; the price it fills at stays in sight; how it
  // fills, each fee by itself and the rest of the account open on «Details».
  return (
    <>
      <div className={s.rows}>
        {trades && <Row label="Position value" value={usd(review.notionalUsd)} />}
        {trades && <Row label={review.type === 'limit' && review.kind === 'open' ? 'Limit price' : 'Fills no worse than'} value={price(review.priceUsd)} />}
        {review.kind === 'cancelConditional' && review.conditional && review.conditional.legs.length > 1 && <Row label="Cancels" value="TP and SL together" />}
        {review.clearsLegs && review.kind !== 'cancelConditional' && <Row label="Current TP/SL" value="Replaced" />}
        {legs && review.tpUsd !== null && <Row label="Take profit" value={price(review.tpUsd)} />}
        {legs && review.slUsd !== null && <Row label="Stop loss" value={price(review.slUsd)} />}
        {review.kind === 'protect' && review.tpUsd === null && review.slUsd === null && <Row label="TP/SL" value="Lifted" />}
        {review.order && <Row label="Order" value={`${review.order.side === 'buy' ? 'Buy' : 'Sell'} ${review.order.sizeUnits ?? '—'} at ${price(review.order.priceUsd)}`} />}
        {review.conditional && review.conditional.tpUsd !== null && <Row label="Take profit" value={price(review.conditional.tpUsd)} />}
        {review.conditional && review.conditional.slUsd !== null && <Row label="Stop loss" value={price(review.conditional.slUsd)} />}
        {!trades && <Row label="Network fee" value={lamportsSol(review.networkFeeLamports)} />}
        {more && trades && <Row label="Phoenix fee" value={review.fees.venueUsd === null ? 'On the fill' : usd(review.fees.venueUsd)} />}
        {more && trades && review.fees.builderBps > 0 && <Row label="Ryntra fee" value={builder} />}
        {more && trades && fillWord(review) && <Row label="Fill" value={fillWord(review)!} />}
        {more && trades && <Row label="Price impact" value={impact} tone={review.book === 'thin' ? 'warn' : undefined} />}
        {more && after && trades && <Row label="Leverage after" value={leverage(after.leverage)} />}
        {more && after && trades && <Row label="Free after" value={usd(after.freeCollateralUsd)} />}
        {more && review.kind === 'open' && review.funding && <Row label="Funding" value={funding({ ratePercent: review.funding.ratePercent, payer: review.funding.payer, periodSeconds: review.funding.intervalSeconds })} />}
        {more && trades && <Row label="Network fee" value={lamportsSol(review.networkFeeLamports)} />}
        {review.rentLamports !== '0' && <Row label="Rent, refundable" value={lamportsSol(review.rentLamports)} />}
      </div>
      {trades && (
        <button className={s.more} aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? 'Less' : 'Details'}
          <ChevronGlyph className={`${s.moreGlyph} ${more ? s.moreGlyphOn : ''}`} />
        </button>
      )}
    </>
  );
}

/** How the order fills, in two words: a row of the Review, not a paragraph under it. */
function fillWord(review: OrderReview): string | null {
  if (review.kind === 'open' && review.type === 'market') return review.tif === 'ioc' ? 'What the book gives' : 'All or nothing';
  if (review.kind === 'open') return 'Rests in the book';
  return null;
}

function CollateralRows({ review }: { review: CollateralReview }) {
  const deposit = review.action === 'deposit';
  return (
    <div className={s.rows}>
      <Row label={deposit ? 'From your wallet' : 'From Phoenix collateral'} value={micro(review.amount)} />
      <Row label={deposit ? 'To Phoenix collateral' : 'To your wallet'} value={micro(review.receive)} />
      <Row label="Phoenix keeps" value={micro(review.phoenixFee)} />
      {!deposit && review.freeAfter !== null && <Row label="Free after" value={micro(review.freeAfter)} />}
      <Row label="Network fee" value={lamportsSol(review.networkFeeLamports)} />
      {review.rentLamports !== '0' && <Row label="Rent, refundable" value={lamportsSol(review.rentLamports)} />}
    </div>
  );
}

function ReviewCard({ pending }: { pending: Pending }) {
  const phase = useExchange((st) => st.phase);
  const notice = useExchange((st) => st.notice);
  const confirm = useExchange((st) => st.confirm);
  const back = useExchange((st) => st.back);
  const connection = useWallet((st) => st.connection);
  const locked = LOCKED.has(phase);
  const mine = connection?.address === pending.owner;
  // An order that trades: the side as the title and, in one line under it, the size, leverage, liquidation and fee.
  const terms = pending.kind === 'order' ? reviewTerms(pending.review) : null;
  const title =
    pending.kind === 'order'
      ? terms
        ? pending.review.kind === 'reduce'
          ? 'Close'
          : pending.review.side === 'long'
            ? 'Long'
            : 'Short'
        : orderTitle(pending.review)
      : `${pending.review.action === 'deposit' ? 'Add' : 'Withdraw'} ${micro(pending.review.amount)}`;
  const label = phase === 'wallet' ? 'Confirm in your wallet…' : phase === 'sending' ? 'Sending…' : phase === 'reviewing' ? 'Refreshing…' : 'Sign in wallet';
  return (
    <>
      <div className={s.block}>
        <div className={s.label}>Review · {pending.kind === 'order' ? `${pending.review.symbol}-PERP` : 'USDC'}</div>
        <div className={`${s.display} ${s.result}`}>{title}</div>
        {terms && <div className={s.terms}>{termsLine(terms)}</div>}
        {pending.kind === 'order' ? <OrderRows review={pending.review} /> : <CollateralRows review={pending.review} />}
        {notice && <div className={`${s.notice} ${notice.tone === 'warn' ? s.noticeWarn : s.noticeError}`}>{notice.text}</div>}
      </div>
      <div className={s.grow} />
      <div className={s.foot}>
        <button className={`${s.display} ${s.action} ${locked || phase === 'reviewing' ? s.waiting : ''}`} disabled={!mine || BUSY.has(phase)} onClick={() => connection && void confirm(connection)}>
          {mine ? label : 'Connect the wallet of this Review'}
        </button>
        <button className={s.quiet} onClick={back} disabled={BUSY.has(phase)}>
          Back
        </button>
      </div>
    </>
  );
}

const OUTCOME: Readonly<Record<string, Readonly<{ kicker: string; tone: 'ok' | 'warn' | 'danger' }>>> = {
  filled: { kicker: 'Filled', tone: 'ok' },
  partial: { kicker: 'Partly filled', tone: 'warn' },
  accepted: { kicker: 'Order placed', tone: 'ok' },
  set: { kicker: 'TP/SL set', tone: 'ok' },
  cancelled: { kicker: 'Cancelled', tone: 'ok' },
  pending: { kicker: 'Sent', tone: 'warn' },
  failed: { kicker: 'Didn’t go through', tone: 'danger' },
  done: { kicker: 'Done', tone: 'ok' },
};

function Outcome({ result }: { result: Result }) {
  const back = useExchange((st) => st.back);
  const recheck = useExchange((st) => st.recheck);
  const outcome = result.receipt.outcome;
  const words = OUTCOME[outcome] ?? OUTCOME.pending!;
  const signature = result.receipt.signature;
  const [why, setWhy] = useState(false);
  let title: string;
  let line: string | null = null;
  if (result.kind === 'order') {
    const review = result.review;
    const fills = result.receipt.fills;
    title = fills ? `${review.kind === 'reduce' ? 'Closed' : review.side === 'long' ? 'Long' : 'Short'} ${units(fills.sizeUnits, review.symbol)}` : orderTitle(review);
    if (outcome === 'accepted') line = `Resting at ${price(review.priceUsd)}`;
    if (outcome === 'cancelled' && (review.kind === 'open' || review.kind === 'reduce')) line = 'Nothing filled · only the network fee spent';
  } else {
    const moved = result.receipt.movedMicro;
    title = `${result.review.action === 'deposit' ? 'Added' : 'Withdrew'} ${micro(moved ?? BigInt(result.review.receive))}`;
  }
  if (outcome === 'failed') line = 'Only the network fee spent';
  if (outcome === 'pending') line = 'Not confirmed yet · nothing will be sent again';
  // The chain's own reason for a failure is its words, not ours: behind one quiet «Why».
  const reason = outcome === 'failed' ? result.receipt.reason : null;
  const fills = result.kind === 'order' ? result.receipt.fills : null;
  return (
    <>
      <div className={s.block} role="status">
        <div className={`${s.outcome} ${words.tone === 'warn' ? s.outcomeWarn : words.tone === 'danger' ? s.outcomeDanger : ''}`}>{words.kicker}</div>
        <div className={`${s.display} ${s.result}`}>{title}</div>
        {line && <div className={s.terms}>{line}</div>}
        {reason && (
          <>
            <button className={s.more} aria-expanded={why} onClick={() => setWhy((v) => !v)}>
              Why
              <ChevronGlyph className={`${s.moreGlyph} ${why ? s.moreGlyphOn : ''}`} />
            </button>
            {why && <div className={s.line}>{reason}</div>}
          </>
        )}
        {fills && (
          <div className={s.rows}>
            <Row label="Average price" value={price(fills.averageUsd)} />
            <Row label="Fees" value={usd(fills.feeUsd)} />
            {result.kind === 'order' && result.review.kind === 'reduce' && <Row label="Realised" value={signedUsd(fills.realizedPnlUsd)} tone={fills.realizedPnlUsd === null ? undefined : fills.realizedPnlUsd >= 0 ? 'up' : 'down'} />}
          </div>
        )}
        {signature && (
          <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noopener noreferrer">
            View on Solana Explorer
          </a>
        )}
      </div>
      <div className={s.grow} />
      <div className={s.foot}>
        {outcome === 'pending' && (
          <button className={`${s.choice} ${s.choiceOn} ${s.formAction}`} onClick={() => void recheck()}>
            Check again
          </button>
        )}
        <button className={`${s.display} ${s.action}`} onClick={back}>
          Done
        </button>
      </div>
    </>
  );
}
