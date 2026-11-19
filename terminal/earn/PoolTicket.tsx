'use client';

import { useEffect, useMemo } from 'react';
import { spendable } from '@/city/lib/districts/harbor/deposit';
import { SOL_MINT } from '@/city/lib/earn/lst';
import { GOAL_SHAPE, MAX_HALF, PIER_GOALS, PIER_SLIPPAGE_BPS, PIER_STYLES, STYLE_HALF, pierCosts, pierHalf, otherInSol, solShort, solUsd, styleOfHalf, unitsShort, zapFigures, type Pier, type PierGoal, type PierStyle } from '@/city/lib/earn/pier';
import { pierSeries } from '@/city/lib/earn/pier-history';
import { PIER_LOCKED, pierChoice, pierGoal, usePier, zapReviewOf } from '@/city/lib/earn/pier-store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { Action, AmountField, Kick, Quiet, Segment } from '@/terminal/ui';
import { Facts, Note, OneLine, Result, RiskDots, TicketHead, iconOf } from './bits';
import { noticeKey } from './failures';
import { SHAPE_WORD, factRows, gapLine, rangeLine } from './range/facts';
import { dayEstimate, dayMove, edgeTexts, gapView, heldShare, pctText, rangeView, rangeWorth, reachOf, rentView } from './range/model';
import { Names, RangeEditor, RangeLine, useEditorId } from './range/RangeEditor';
import { useBins, useTune } from './range/useBins';
import { RANGE } from './range/words';
import { feeText, shortUsd, sumText, widthRisk, type PoolRow } from './rows';
import { useRefreshAfter } from './useReads';
import { EARN } from './words';
import e from './earn.module.css';

/** With a wallet the pool admits, the exact figures follow the form after this pause, once per choice. */
const AUTO_REVIEW_MS = 450;

const GOAL_WORD = { even: 'goalEven', near: 'goalNear', edges: 'goalEdges' } as const;
const WIDTH_WORD = { calm: 'widthCalm', balanced: 'widthBalanced', dense: 'widthDense' } as const;
/** The styles from the narrowest: a width by hand that stands between two carries the narrower one's risk. */
const NARROW_FIRST: readonly PierStyle[] = ['dense', 'balanced', 'calm'];

/** A form's change while its figures are still being built: the build is let go, the change stands (nothing is signed yet). */
function edit(change: () => void): void {
  if (usePier.getState().phase === 'reviewing') usePier.setState({ phase: 'idle' });
  change();
}

/** The first letter up: the parts of the one line are written to follow one another. */
export function lineOf(parts: readonly (string | null)[]): string {
  const said = parts.filter(Boolean).join(' · ');
  return said.charAt(0).toLocaleUpperCase() + said.slice(1);
}

/**
 * Adding to a pool: the goal and the range, the amount in SOL, the one line before the signature and the one amber
 * action. The pool's own flow as the city runs it — the part of the SOL the other coin needs is swapped and the position
 * opened in one approval; the exact figures are built while the form is read, and the wallet signs exactly those.
 * On a pool's own page the page names the pool: `bare` leaves out the ticket's head, and `peek` shows the
 * range over the pool's liquidity — its bars and edges — before «Tune» opens the rest.
 */
export function PoolTicket({ pier, row, addOpen, onConnect, bare = false, peek = false }: { pier: Pier; row: PoolRow; addOpen: boolean; onConnect: () => void; bare?: boolean; peek?: boolean }) {
  const w = useWords(EARN);
  const rw = useWords(RANGE);
  const lang = useLang();
  const style = usePier((st) => st.style);
  const own = usePier((st) => st.half);
  const copied = usePier((st) => st.copy !== null);
  const picked = usePier((st) => st.goal);
  const goal = pierGoal(pier, picked);
  const typed = usePier((st) => st.typed);
  const phase = usePier((st) => st.phase);
  const reviewed = usePier((st) => st.reviewed);
  const costsFor = usePier((st) => st.costs);
  const notice = usePier((st) => st.notice);
  const outcome = usePier((st) => st.outcome);
  const statesFor = usePier((st) => st.states);
  const candles = usePier((st) => st.candles);
  const days = usePier((st) => st.days);
  const connection = useWallet((st) => st.connection);
  const holdingsFor = useWallet((st) => st.holdings);
  const owner = connection?.address ?? null;
  const holdings = holdingsFor && holdingsFor.owner === owner ? holdingsFor : null;
  const states = owner && statesFor?.owner === owner ? statesFor.value : null;
  const admitted = states?.add === 'on';
  const costs = costsFor?.pool === pier.pool.address ? costsFor.value : null;
  const choice = useMemo(() => pierChoice(pier, style, typed, holdings, owner, states?.ceilingUsd ?? null, costs, goal, own), [pier, style, goal, typed, holdings, owner, states, costs, own]);
  const shown = reviewed && choice.key && reviewed.key === choice.key ? reviewed : null;
  const zapped = zapReviewOf(shown);
  const figures = zapped ? zapFigures(zapped, pier) : null;
  const bins = useBins('dlmm', pier.pool.address);
  const [tune, setTune] = useTune();
  const editorId = useEditorId();

  // The exact figures of what is on the form, while the person reads it.
  useEffect(() => {
    if (!connection || !admitted || !choice.key || phase !== 'idle' || notice || shown) return;
    const timer = setTimeout(() => void usePier.getState().prepare(connection, { kind: 'add' }, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, admitted, choice.key, phase, notice, shown]);

  if (outcome) return <PoolOutcome pier={pier} row={row} />;

  const sol = spendable(holdings, SOL_MINT);
  const half = pierHalf(style, own);
  // A width by hand carries the risk of the style it stands nearest to.
  const near = styleOfHalf(half) ?? NARROW_FIRST.reduce((best, id) => (Math.abs(STYLE_HALF[id] - half) < Math.abs(STYLE_HALF[best] - half) ? id : best));
  const stepBps = pier.pool.binStepBps!;
  const read = bins.status === 'ready' ? bins.value : null;
  // The pool's own price and bins where they were read; until then the venue's price, counted by the step.
  const counted = rangeView(read?.price ?? pier.pool.price, stepBps, half, read?.bins ?? null);
  // Once a Review stands the range is the Review's own — the very bins it opens, at the price it was built at: a read of
  // the bins a moment older never stands in for what is signed.
  const built = zapped?.preview.range?.kind === 'bins' ? zapped.preview.range : null;
  const builtAt = built ? { low: Number(built.lowerPrice), high: Number(built.upperPrice), price: Number(zapped!.preview.price) } : null;
  const range = builtAt && builtAt.low > 0 && builtAt.high > builtAt.low && builtAt.price > 0 ? { ...counted, low: builtAt.low, high: builtAt.high, downPct: (1 - builtAt.low / builtAt.price) * 100, upPct: (builtAt.high / builtAt.price - 1) * 100 } : counted;
  const priceNow = range === counted ? (read?.price ?? pier.pool.price) : builtAt!.price;
  const price = solUsd(pier);
  const depositUsd = choice.lamports !== null && price !== null ? (Number(choice.lamports) / 1e9) * price : null;
  // What lies in the range now is said in the pool's second coin: dollars at that coin's own price.
  const yUsd = pier.pool.y.priceUsd ?? (pier.solSide === 'y' ? price : null);
  // How far the pool's price walked in the day gone, from the engine's candles of the pair: a range narrower than that
  // walk holds the price only a part of the day.
  // SOL against dollars walks as SOL's own price, wicks included; a staked SOL against SOL walks as the ratio of two
  // closes — a pair that moves little.
  const solLine = candles[pier.sol.mint];
  const otherLine = pier.pair === 'lst' ? candles[pier.other.mint] : null;
  const move =
    pier.pair === 'usdc'
      ? (days[pier.sol.mint] ?? null)
      : solLine?.status === 'ready' && otherLine?.status === 'ready'
        ? dayMove(pierSeries(pier, solLine.value, otherLine.value))
        : null;
  const day = dayEstimate({ lpFees24hUsd: pier.pool.lpFees24hUsd, depositUsd, rangeUsd: read && yUsd !== null ? rangeWorth(read, half) * yUsd : null, poolUsd: pier.pool.tvlUsd, held: heldShare(range.steps, stepBps, move?.low ?? null, move?.high ?? null) });
  const daySaid = day ? (day.basis === 'range' ? rw.dayOf(sumText(day.dayUsd, lang)) : rw.dayPool(sumText(day.dayUsd, lang))) : null;
  const goesIn = figures?.amounts.length
    ? figures.amounts.join(' + ')
    : choice.split
      ? `${solShort(choice.split.solLamports)} SOL + ${unitsShort(choice.split.otherUnits, pier.other.decimals)} ${pier.other.symbol}`
      : null;
  // The swap of the part the other coin needs: the Review's own once it stands, an even half at the pool's price before.
  const leg = zapped?.preview.swap ?? null;
  const legRate = leg && leg.route !== 'none' && /^[1-9]\d*$/.test(leg.inAmount) && /^[1-9]\d*$/.test(leg.expectedOut) ? Number(leg.expectedOut) / 10 ** pier.other.decimals / (Number(leg.inAmount) / 1e9) : null;
  // What the swap should bring and its rate are one quote: the two multiply out. The least it brings is behind the «i».
  const legOut = legRate !== null && leg ? `≈ ${unitsShort(BigInt(leg.expectedOut), pier.other.decimals)} ${pier.other.symbol}` : null;
  const swapped = figures
    ? figures.swapInSol
      ? { from: figures.swapInSol, to: legOut ?? figures.swapFloor ?? '—', rate: legOut && legRate !== null ? solShort(legRate) : null, unit: pier.other.symbol }
      : ('none' as const)
    : choice.split && choice.lamports !== null
      ? { from: `≈ ${solShort(choice.lamports - choice.split.solLamports)} SOL`, to: `${unitsShort(choice.split.otherUnits, pier.other.decimals)} ${pier.other.symbol}`, rate: solShort(1 / otherInSol(pier)), unit: pier.other.symbol }
      : null;
  const reviewCosts = zapped ? pierCosts(zapped) : null;
  const guestRent = read ? rentView(read.rent, read.activeId, half) : null;
  const rent = reviewCosts ? { pay: solShort(reviewCosts.rent), back: solShort(reviewCosts.rentBack), all: reviewCosts.rent === reviewCosts.rentBack, exact: true } : guestRent ? { pay: solShort(guestRent.pay), back: solShort(guestRent.back), all: guestRent.pay === guestRent.back, exact: false } : null;
  const facts = factRows(rw, lang, {
    range,
    // One word for a step of the price on every pool's form («33 bins» here, «33 steps» on DLMM Pro's).
    steps: 'steps',
    shape: GOAL_SHAPE[goal],
    goesIn,
    exact: Boolean(figures?.amounts.length),
    swap: swapped,
    rent,
    fee: figures ? { inPct: figures.feePct } : null,
    day: day ? { usd: sumText(day.dayUsd, lang), basis: day.basis } : null,
  });
  const gap = read ? gapLine(rw, lang, gapView(read.market.gapPct, stepBps)) : null;
  // The range's two prices behind «Details», to the places the pool's step needs.
  const edges = edgeTexts(range.low, range.high, priceNow, stepBps);
  const problem =
    !typed || !choice.problem
      ? null
      : choice.problem === 'format'
        ? w.pFormat
        : choice.problem === 'min'
          ? w.pMin(`${digits(solShort(choice.minimum), lang)} SOL`)
          : choice.problem === 'ceiling'
            ? w.pMax(`${digits(solShort(choice.ceiling), lang)} SOL`)
            : w.pBalance;
  const said = notice ? noticeKey(notice.text, 'pool') : null;
  const closed = connection !== null && states !== null && !admitted;
  const waiting = phase === 'reviewing' || PIER_LOCKED.has(phase);
  const label = phase === 'reviewing' ? w.building : phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : w.addToPool;
  const press = () => {
    if (!connection) return onConnect();
    if (shown) void usePier.getState().confirm(connection, useWallet.getState().holdings);
    else void usePier.getState().prepare(connection, { kind: 'add' }, holdings);
  };

  return (
    <>
      {/* A day's fees as the table's row says them: what trades paid the pool, from the very read the ticket stands on. */}
      {bare ? null : <TicketHead coins={row.coins} name={row.name} sub={feeText(row.feePct, lang)} figure={pier.pool.fees24hUsd !== null ? shortUsd(pier.pool.fees24hUsd, lang) : null} figureCap={w.fees24} />}
      {/* While the wallet is open or the bytes travel, the form is what is being signed: it holds still. */}
      <fieldset className={e.form} disabled={PIER_LOCKED.has(phase)}>
      <AmountField
        label={w.youPut}
        aside={sol !== null ? w.balance(digits(solShort(sol), lang)) : undefined}
        value={typed}
        onChange={(text) => edit(() => usePier.getState().setTyped(text))}
        asset={{ symbol: 'SOL', icon: iconOf(SOL_MINT) }}
      />
      <div className={e.choice}>
        <Kick>{w.goal}</Kick>
        <Segment<PierGoal> label={w.goal} value={goal} onChange={(id) => edit(() => usePier.getState().setGoal(id))} items={PIER_GOALS.map((id) => ({ id, label: w[GOAL_WORD[id]] }))} />
        <Names items={PIER_GOALS.map((id) => ({ id, label: rw[SHAPE_WORD[GOAL_SHAPE[id]]], on: id === goal }))} />
      </div>
      <div className={e.choice}>
        <div className={e.choiceHead}>
          <Kick>{w.width}</Kick>
          <span className={e.riskRow}>
            <Kick>{w.risk}</Kick>
            <RiskDots dots={widthRisk(near, row.staked)} label={w.riskOf(String(widthRisk(near, row.staked)))} />
          </span>
        </div>
        <Segment<PierStyle> label={w.width} value={styleOfHalf(half)} onChange={(id) => edit(() => usePier.getState().setStyle(id))} items={PIER_STYLES.map((id) => ({ id, label: w[WIDTH_WORD[id]] }))} />
        <Names items={PIER_STYLES.map((id) => ({ id, label: digits(`±${pctText(reachOf(stepBps, pierHalf(id)).upPct)}%`, lang), on: id === styleOfHalf(half) }))} />
      </div>
      <RangeLine line={rangeLine(rw, lang, range, pier.pool.y.symbol, 'steps', stepBps)} open={tune} onOpen={setTune} controls={editorId} />
      {tune || peek ? (
        <RangeEditor
          id={editorId}
          bins={bins}
          range={range}
          price={priceNow}
          stepBps={stepBps}
          half={half}
          max={MAX_HALF}
          shape={GOAL_SHAPE[goal]}
          unit={pier.pool.y.symbol}
          onHalf={copied || PIER_LOCKED.has(phase) ? undefined : (next) => edit(() => usePier.getState().setHalf(next))}
          facts={facts}
          compact={!tune}
        />
      ) : null}
      </fieldset>
      {gap ? <Note>{gap}</Note> : null}
      <OneLine label={w.poolDetails} line={lineOf([figures ? (figures.feePct ? w.ryntraFee(digits(figures.feePct, lang)) : w.ryntraNone) : null, w.band(digits(String(PIER_SLIPPAGE_BPS / 100), lang))])}>
        <Facts
          rows={[
            [w.dRange, digits(`${edges.low} – ${edges.high} ${pier.pool.y.symbol}`, lang)],
            [w.dGoesIn, goesIn ? digits(`≈ ${goesIn}`, lang) : null],
            [w.dSwap, figures?.swapInSol ? `${digits(figures.swapInSol, lang)} → ${digits(figures.swapFloor ?? '—', lang)}` : null],
            [w.dMinimum, `${digits(solShort(choice.minimum), lang)} SOL`],
            [w.dDeposit, figures?.rentSol ? `${digits(figures.rentSol, lang)} SOL${figures.rentBack ? `, ${w.dDepositBack}` : ''}` : null],
            [w.dNetwork, figures ? `${digits(figures.networkSol, lang)} SOL` : null],
            [w.dTradeFee, feeText(pier.pool.feePct, lang)],
            [w.dDay, daySaid],
          ]}
        />
        {figures ? <p>{w.approvals(String(figures.transactions))}</p> : null}
        <p>{w.bandText}</p>
        <p>{w.rangeText}</p>
        <p>{rw.aboutEven}</p>
        <p>{rw.aboutDay}</p>
        <p>{rw.aboutRent}</p>
        <p>{w.feeText}</p>
        <p>{w.keysText}</p>
      </OneLine>
      {problem ? <Note>{problem}</Note> : null}
      {states?.stopped ? <Note>{w.paused}</Note> : closed || !addOpen ? <Note>{w.fClosed}</Note> : null}
      {notice ? <Note tone={notice.tone}>{said ? w[said] : notice.text}</Note> : null}
      <Action onClick={press} busy={waiting} disabled={waiting || !addOpen || (connection !== null && (!admitted || Boolean(choice.problem)))}>
        {connection ? label : w.connect}
      </Action>
    </>
  );
}

/**
 * How an add ended, in plain words: added, in part, not at all, or not known yet — never sent twice. An add that landed
 * only in part — the swap went through, the position did not open — offers one more approval that brings what the swap
 * left in the wallet back to SOL; its figure is built while the person reads what happened.
 */
function PoolOutcome({ pier, row }: { pier: Pier; row: PoolRow }) {
  const w = useWords(EARN);
  const lang = useLang();
  const outcome = usePier((st) => st.outcome);
  const phase = usePier((st) => st.phase);
  const sent = usePier((st) => st.sent);
  const rest = usePier((st) => st.rest);
  const connection = useWallet((st) => st.connection);
  const zapped = outcome?.kind === 'partial' ? zapReviewOf(sent) : null;
  const half = Boolean(zapped && zapped.preview.action === 'zap_in');

  useEffect(() => {
    if (half && connection && !rest && phase === 'partial') void usePier.getState().prepareRest(connection);
  }, [half, connection, rest, phase]);

  useRefreshAfter(outcome?.kind === 'done' || outcome?.kind === 'partial' || rest?.outcome?.kind === 'done', connection?.address ?? null);

  if (!outcome) return null;
  const restOutcome = rest?.outcome ?? null;
  const restDone = restOutcome?.kind === 'done';
  const signature =
    restOutcome && restOutcome.kind === 'done'
      ? (restOutcome.signatures.at(-1) ?? null)
      : outcome.kind === 'failed'
        ? outcome.signature
        : 'signatures' in outcome
          ? (outcome.signatures.at(-1) ?? null)
          : null;
  const good = outcome.kind === 'done' || restDone;
  const word = restDone ? w.restDone : outcome.kind === 'done' ? w.doneAdd : half ? w.partialSwap(pier.other.symbol) : outcome.kind === 'partial' ? w.partial : outcome.kind === 'failed' ? w.failed : w.unknown;
  const restReview = rest?.reviewed ? zapReviewOf(rest.reviewed) : null;
  const back = restReview ? zapFigures(restReview, pier).backSol : null;
  const restSaid = rest?.notice ? noticeKey(rest.notice.text, 'pool') : null;
  const waiting = phase === 'wallet' || phase === 'sending';

  return (
    <>
      <TicketHead coins={row.coins} name={row.name} sub={feeText(row.feePct, lang)} />
      <Result
        good={good}
        word={word}
        line={restDone ? w.doneTakeLine : outcome.kind === 'done' ? w.doneAddLine : null}
        link={signature ? explorerTxUrl('mainnet', signature) : null}
        linkLabel={w.explorer}
        extra={half && !restDone && back ? <p className={e.resultLine}>{w.restBack(digits(back, lang))}</p> : null}
      />
      {half && !restDone && rest?.notice ? <Note tone={rest.notice.tone}>{restSaid ? w[restSaid] : rest.notice.text}</Note> : null}
      {outcome.kind === 'unknown' && connection ? (
        <Action onClick={() => void usePier.getState().recheck(connection.address)} busy={phase === 'sending'} disabled={phase === 'sending'}>
          {w.checking}
        </Action>
      ) : half && !restDone && connection ? (
        <>
          <Action onClick={() => void usePier.getState().takeRest(connection)} busy={waiting || (!rest?.reviewed && !rest?.notice)} disabled={waiting}>
            {phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : !rest?.reviewed && !rest?.notice ? w.building : w.takeRest}
          </Action>
          <Quiet full onClick={() => usePier.getState().again()} disabled={waiting}>
            {w.ok}
          </Quiet>
        </>
      ) : (
        <Quiet full onClick={() => usePier.getState().again()}>
          {good || outcome.kind === 'partial' ? w.ok : w.again}
        </Quiet>
      )}
    </>
  );
}
