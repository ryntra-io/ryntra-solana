'use client';

import { useEffect, useMemo } from 'react';
import { spendable } from '@/city/lib/districts/harbor/deposit';
import { SOL_MINT } from '@/city/lib/earn/lst';
import { GOAL_SHAPE, PIER_GOALS, PIER_STYLES, STYLE_HALF, solShort, type PierGoal, type PierStyle } from '@/city/lib/earn/pier';
import { PRO_MAX_LAMPORTS, PRO_MIN_LAMPORTS, bandPct, proAmounts, proChoice, proOther, proPrice, proReward, proSolText, type ProPier } from '@/city/lib/earn/pro';
import { PRO_LOCKED, proGoal, proNetwork, useProPier } from '@/city/lib/earn/pro-store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { stepBpsOfSpacing } from '@/lib/earn-pools/bins';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { Action, AmountField, Kick, Quiet, Segment } from '@/terminal/ui';
import { Facts, Note, OneLine, Result, RiskDots, TicketHead, iconOf } from './bits';
import { noticeKey } from './failures';
import { lineOf } from './PoolTicket';
import { SHAPE_WORD, factRows, gapLine, rangeLine } from './range/facts';
import { gapView, pctText, stretchView } from './range/model';
import { Names, RangeEditor, RangeLine, useEditorId } from './range/RangeEditor';
import { useBins, useTune } from './range/useBins';
import { RANGE } from './range/words';
import { feeText, widthRisk, type Coin, type PoolRow } from './rows';
import { useRefreshAfter } from './useReads';
import { EARN } from './words';
import e from './earn.module.css';

/** With a wallet here, the exact figures follow the form after this pause, once per choice. */
const AUTO_REVIEW_MS = 450;

const GOAL_WORD = { even: 'goalEven', near: 'goalNear', edges: 'goalEdges' } as const;
const WIDTH_WORD = { calm: 'widthCalm', balanced: 'widthBalanced', dense: 'widthDense' } as const;
/** A form's change while its figures are still being built: the build is let go, the change stands (nothing is signed yet). */
function edit(change: () => void): void {
  if (useProPier.getState().phase === 'reviewing') useProPier.setState({ phase: 'idle' });
  change();
}

/**
 * Adding to a pool of DLMM Pro: the same form as any pool — the goal, the range, an amount in SOL, one action. The pool
 * itself swaps the part of the SOL the other coin needs and the position opens, in one approval. The one line says the
 * pool's fee on that swap and the band of the price outside which nothing lands; the rest is behind its «i».
 */
export function ProTicket({ pier, row, onConnect }: { pier: ProPier; row: PoolRow; onConnect: () => void }) {
  const w = useWords(EARN);
  const rw = useWords(RANGE);
  const lang = useLang();
  const bins = useBins('pro', pier.address);
  const [tune, setTune] = useTune();
  const editorId = useEditorId();
  const style = useProPier((st) => st.style);
  const picked = useProPier((st) => st.goal);
  const goal = proGoal(pier, picked);
  const typed = useProPier((st) => st.typed);
  const phase = useProPier((st) => st.phase);
  const reviewed = useProPier((st) => st.reviewed);
  const notice = useProPier((st) => st.notice);
  const outcome = useProPier((st) => st.outcome);
  const connection = useWallet((st) => st.connection);
  const holdingsFor = useWallet((st) => st.holdings);
  const owner = connection?.address ?? null;
  const holdings = holdingsFor && holdingsFor.owner === owner ? holdingsFor : null;
  const choice = useMemo(() => proChoice(pier, style, goal, typed, holdings, owner), [pier, style, goal, typed, holdings, owner]);
  const shown = reviewed && choice.key && reviewed.key === choice.key ? reviewed : null;
  const summary = shown?.review.summary.action === 'open' ? shown.review.summary : null;

  // The exact figures of what is on the form, while the person reads it.
  useEffect(() => {
    if (!connection || !choice.key || phase !== 'idle' || notice || shown) return;
    const timer = setTimeout(() => void useProPier.getState().prepare(connection, { kind: 'open' }, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, choice.key, phase, notice, shown]);

  if (outcome) return <ProOutcome row={row} other={proOther(pier).symbol} />;

  const sol = spendable(holdings, SOL_MINT);
  const other = proOther(pier);
  const reward = proReward(pier);
  const problem =
    !typed || !choice.problem
      ? null
      : choice.problem === 'format'
        ? w.pFormat
        : choice.problem === 'min'
          ? w.pMin(`${digits(solShort(PRO_MIN_LAMPORTS), lang)} SOL`)
          : choice.problem === 'max'
            ? w.pMax(`${digits(solShort(PRO_MAX_LAMPORTS), lang)} SOL`)
            : w.pBalance;
  // What stays out is said only when it is worth saying: more than a fiftieth of what was typed.
  const stays = summary && choice.lamports !== null && BigInt(summary.staysLamports) * 50n > choice.lamports ? summary.staysLamports : null;
  const said = notice ? noticeKey(notice.text, 'pro') : null;
  // The width is one of the form's three: the pool's own add takes a style, so the range is shown, not set by hand.
  const half = STYLE_HALF[style];
  const read = bins.status === 'ready' ? bins.value : null;
  const stepBps = read?.stepBps ?? stepBpsOfSpacing(pier.tickSpacing);
  // One price for the whole card: the pool's own of the bins' read, else the list's.
  const priceNow = read?.price ?? pier.price;
  const counted = stretchView(priceNow, stepBps, half, read?.bins ?? null);
  // The Review's own edges once it stands: the very range the position opens on.
  const range = summary ? { ...counted, low: summary.lowerPrice, high: summary.upperPrice, downPct: (1 - summary.lowerPrice / priceNow) * 100, upPct: (summary.upperPrice / priceNow - 1) * 100 } : counted;
  const facts = factRows(rw, lang, {
    range,
    steps: 'steps',
    shape: GOAL_SHAPE[goal],
    goesIn: summary ? proAmounts(pier, summary.goesIn.xRaw, summary.goesIn.yRaw) : null,
    exact: true,
    swap: summary ? (BigInt(summary.swap.lamports) > 0n ? { from: `${proSolText(summary.swap.lamports)} SOL`, to: other.symbol, rate: null, unit: other.symbol } : 'none') : null,
    rent: summary ? { pay: proSolText(summary.depositLamports), back: proSolText(summary.depositLamports), all: true, exact: true } : null,
    fee: { inPct: null },
    day: null,
  });
  const gap = read ? gapLine(rw, lang, gapView(read.market.gapPct, stepBps)) : null;
  const waiting = phase === 'reviewing' || PRO_LOCKED.has(phase);
  const label = phase === 'reviewing' ? w.building : phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : w.addToPool;
  const press = () => {
    if (!connection) return onConnect();
    if (shown) void useProPier.getState().confirm(connection, useWallet.getState().holdings);
    else void useProPier.getState().prepare(connection, { kind: 'open' }, holdings);
  };

  return (
    <>
      <TicketHead coins={row.coins} name={row.name} sub={`${feeText(row.feePct, lang)} · ${w.pro}`} />
      {/* While the wallet is open or the bytes travel, the form is what is being signed: it holds still. */}
      <fieldset className={e.form} disabled={PRO_LOCKED.has(phase)}>
      <AmountField
        label={w.youPut}
        aside={sol !== null ? w.balance(digits(solShort(sol), lang)) : undefined}
        value={typed}
        onChange={(text) => edit(() => useProPier.getState().setTyped(text))}
        asset={{ symbol: 'SOL', icon: iconOf(SOL_MINT) }}
      />
      <div className={e.choice}>
        <Kick>{w.goal}</Kick>
        <Segment<PierGoal> label={w.goal} value={goal} onChange={(id) => edit(() => useProPier.getState().setGoal(id))} items={PIER_GOALS.map((id) => ({ id, label: w[GOAL_WORD[id]] }))} />
        <Names items={PIER_GOALS.map((id) => ({ id, label: rw[SHAPE_WORD[GOAL_SHAPE[id]]], on: id === goal }))} />
      </div>
      <div className={e.choice}>
        <div className={e.choiceHead}>
          <Kick>{w.width}</Kick>
          <span className={e.riskRow}>
            <Kick>{w.risk}</Kick>
            <RiskDots dots={widthRisk(style, row.staked)} label={w.riskOf(String(widthRisk(style, row.staked)))} />
          </span>
        </div>
        <Segment<PierStyle> label={w.width} value={style} onChange={(id) => edit(() => useProPier.getState().setStyle(id))} items={PIER_STYLES.map((id) => ({ id, label: w[WIDTH_WORD[id]] }))} />
        <Names items={PIER_STYLES.map((id) => ({ id, label: digits(`±${pctText(stretchView(priceNow, stepBps, STYLE_HALF[id], read?.bins ?? null).upPct)}%`, lang), on: id === style }))} />
      </div>
      <RangeLine line={rangeLine(rw, lang, range, pier.y.symbol, 'steps')} open={tune} onOpen={setTune} controls={editorId} />
      {tune ? <RangeEditor id={editorId} bins={bins} range={range} price={priceNow} stepBps={stepBps} half={half} shape={GOAL_SHAPE[goal]} unit={pier.y.symbol} facts={facts} /> : null}
      </fieldset>
      {gap ? <Note>{gap}</Note> : null}
      <OneLine label={w.poolDetails} line={lineOf([w.poolFee(feeText(row.feePct, lang)), summary ? w.band(digits(bandPct(summary.bandBps), lang)) : null, w.ryntraNone])}>
        <Facts
          rows={[
            [w.dRange, summary ? `${digits(proPrice(summary.lowerPrice), lang)} – ${digits(proPrice(summary.upperPrice), lang)} ${pier.y.symbol}` : null],
            [w.dGoesIn, summary ? `≈ ${digits(proAmounts(pier, summary.goesIn.xRaw, summary.goesIn.yRaw), lang)}` : null],
            [w.dStays, stays ? `≈ ${digits(proSolText(stays), lang)} SOL` : null],
            [w.dSwap, summary ? `${digits(proSolText(summary.swap.lamports), lang)} SOL → ${other.symbol}, ${w.dSwapPool}` : null],
            [w.dMinimum, `${digits(solShort(PRO_MIN_LAMPORTS), lang)} SOL`],
            [w.dDeposit, summary ? `${digits(proSolText(summary.depositLamports), lang)} SOL, ${w.dDepositBack}` : null],
            [w.dNetwork, summary ? `${digits(proSolText(summary.networkLamports), lang)} SOL` : null],
          ]}
        />
        {summary ? <p>{w.dOnePosition(String(summary.ranges))}</p> : null}
        {shown ? <p>{w.approvals(String(shown.review.transactions.length))}</p> : null}
        {reward ? <p>{w.dReward(digits(reward.perDay, lang), reward.symbol)}</p> : null}
        <p>{w.bandText}</p>
        <p>{w.rangeText}</p>
        <p>{w.referralText}</p>
        <p>{w.keysText}</p>
      </OneLine>
      {problem ? <Note>{problem}</Note> : null}
      {notice ? <Note tone={notice.tone}>{w[said ?? 'notSent']}</Note> : null}
      <Action onClick={press} busy={waiting} disabled={waiting || (connection !== null && (Boolean(choice.problem) || !pier.takesDeposits))}>
        {connection ? label : w.connect}
      </Action>
    </>
  );
}

/** What a Pro action did, by its kind: the word of the result and its one line. */
const DONE = {
  open: ['doneAdd', 'doneAddLine'],
  compound: ['doneCompound', 'doneCompoundLine'],
  collect: ['doneTake', 'doneTakeLine'],
  leave: ['doneLeave', 'doneLeaveLine'],
  close: ['doneClose', 'doneCloseLine'],
  care_on: ['ok', 'doneTakeLine'],
  care_off: ['ok', 'doneTakeLine'],
} as const;

/** How a Pro action ended, in plain words: done, in part, not at all, or not known yet — never sent twice. */
export function ProOutcome({ row, other }: { row: Readonly<{ coins: readonly Coin[]; name: string; feePct: number | null }>; other: string }) {
  const w = useWords(EARN);
  const lang = useLang();
  const outcome = useProPier((st) => st.outcome);
  const phase = useProPier((st) => st.phase);
  const sent = useProPier((st) => st.sent);
  const connection = useWallet((st) => st.connection);
  useRefreshAfter(outcome?.kind === 'done' || outcome?.kind === 'partial', connection?.address ?? null);
  if (!outcome) return null;
  const action = sent?.review.action ?? 'open';
  const good = outcome.kind === 'done';
  const signature = outcome.kind === 'failed' ? outcome.signature : 'signatures' in outcome ? (outcome.signatures.at(-1) ?? null) : null;
  const word = good ? w[DONE[action][0]] : outcome.kind === 'partial' ? (action === 'open' ? w.partialSwap(other) : w.partial) : outcome.kind === 'failed' ? w.failed : w.unknown;
  return (
    <>
      <TicketHead coins={row.coins} name={row.name} sub={`${feeText(row.feePct, lang)} · ${w.pro}`} />
      <Result good={good} word={word} line={good ? w[DONE[action][1]] : null} link={signature ? explorerTxUrl(proNetwork(), signature) : null} linkLabel={w.explorer} />
      {outcome.kind === 'unknown' && connection ? (
        <Action onClick={() => void useProPier.getState().recheck(connection.address)} busy={phase === 'sending'} disabled={phase === 'sending'}>
          {w.checking}
        </Action>
      ) : (
        <Quiet full onClick={() => useProPier.getState().again()}>
          {good || outcome.kind === 'partial' ? w.ok : w.again}
        </Quiet>
      )}
    </>
  );
}
