'use client';

import { useEffect } from 'react';
import type { PositionView } from '@/lib/liquidity/catalog/positions';
import { reviewFigures } from '@/city/lib/districts/harbor/review';
import { PIER_LOCKED, poolReviewOf, targetKey, usePier } from '@/city/lib/earn/pier-store';
import { bandPct, proAmounts, proPrice, proSolText, type ProBoat, type ProPier } from '@/city/lib/earn/pro';
import { PRO_LOCKED, useProPier } from '@/city/lib/earn/pro-store';
import { feeNear, usdLamports } from '@/city/lib/fee-near';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { PrivateIncomePart, startPrivateIncome, usePrivateIncome } from '@/terminal/stocks/private/PrivateIncome';
import { usePrivateStockButton } from '@/terminal/stocks/private/PrivateStockBuy';
import { Action, Chip, Quiet, Tabs } from '@/terminal/ui';
import { Note, Result, TicketHead } from './bits';
import { noticeKey } from './failures';
import { lineOf } from './PoolTicket';
import { ProOutcome } from './ProTicket';
import { proRewardsText, resultTone, sumText, type PositionRow } from './rows';
import { ResultFacts } from './ResultFacts';
import { pick, type PoolAct, type ProAct } from './ticket';
import { useRefreshAfter } from './useReads';
import { EARN } from './words';
import e from './earn.module.css';

/** The figures of the chosen action follow the ticket after this pause. */
const AUTO_REVIEW_MS = 200;

/** A pool position's state as a chip: earning inside its range, or out of it. */
function RangeChip({ inRange }: { inRange: boolean | null }) {
  const w = useWords(EARN);
  if (inRange === null) return <Chip>{w.empty}</Chip>;
  return inRange ? (
    <Chip tone="ok" dot>
      {w.inRange}
    </Chip>
  ) : (
    <Chip tone="warn">{w.outOfRange}</Chip>
  );
}

/**
 * A pool position of the wallet: take its fees, or leave it — the pool's own flow as the city runs it. One action is
 * chosen, its exact figures follow, and the one amber action signs it.
 */
export function PositionTicket({ view, row, act, exitOpen, solPriceUsd, onConnect }: { view: PositionView; row: PositionRow; act: PoolAct; exitOpen: boolean; solPriceUsd: number | null; onConnect: () => void }) {
  const w = useWords(EARN);
  const lang = useLang();
  const phase = usePier((st) => st.phase);
  const reviewed = usePier((st) => st.reviewed);
  const notice = usePier((st) => st.notice);
  const outcome = usePier((st) => st.outcome);
  const sent = usePier((st) => st.sent);
  const connection = useWallet((st) => st.connection);
  const holdings = useWallet((st) => st.holdings);
  // A stock pool's fees into the private balance: the same ticket and button; the part is `terminal/stocks/private`'s.
  const priv = usePrivateIncome(view.x.mint, view.y.mint);
  const privButton = usePrivateStockButton();
  const wanted = connection ? targetKey(connection.address, { kind: act, position: view }) : null;
  const shown = wanted && reviewed?.key === wanted ? reviewed : null;
  const review = poolReviewOf(shown);
  const figures = review ? reviewFigures(review, { x: view.x.symbol, y: view.y.symbol }, null) : null;
  const canClaim = !view.feesElsewhere && (view.x.unclaimed > 0 || view.y.unclaimed > 0);
  const possible = exitOpen && (act === 'exit' || canClaim);

  // The exact figures of the chosen action, while the person reads the ticket.
  useEffect(() => {
    if (!connection || !possible || phase !== 'idle' || notice || shown || outcome) return;
    const timer = setTimeout(() => void usePier.getState().prepare(connection, { kind: act, position: view }, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, possible, phase, notice, shown, outcome, act, view]);
  useRefreshAfter(outcome?.kind === 'done' || outcome?.kind === 'partial', connection?.address ?? null);

  const head = <TicketHead coins={row.coins} name={row.name} sub={row.mark ? digits(row.mark, lang) : w.kindPool} extra={<RangeChip inRange={row.inRange} />} />;

  if (outcome) {
    const left = sent?.body.action === 'remove';
    const good = outcome.kind === 'done';
    const signature = outcome.kind === 'failed' ? outcome.signature : 'signatures' in outcome ? (outcome.signatures.at(-1) ?? null) : null;
    return (
      <>
        {head}
        <Result
          good={good}
          word={good ? (left ? w.doneLeave : w.doneTake) : outcome.kind === 'partial' ? w.partial : outcome.kind === 'failed' ? w.failed : w.unknown}
          line={good ? (left ? w.doneLeaveLine : w.doneTakeLine) : null}
          link={signature ? explorerTxUrl('mainnet', signature) : null}
          linkLabel={w.explorer}
        />
        {outcome.kind === 'unknown' && connection ? (
          <Action onClick={() => void usePier.getState().recheck(connection.address)} busy={phase === 'sending'} disabled={phase === 'sending'}>
            {w.checking}
          </Action>
        ) : (
          <Quiet full onClick={() => usePier.getState().again()}>
            {good || outcome.kind === 'partial' ? w.ok : w.again}
          </Quiet>
        )}
      </>
    );
  }

  const near = review && act === 'claim' ? feeNear(usdLamports(view.unclaimedUsd, solPriceUsd), review.networkFeeLamports) : null;
  const said = notice ? noticeKey(notice.text, 'pool') : null;
  const waiting = phase === 'reviewing' || PIER_LOCKED.has(phase);
  const verb = act === 'claim' ? w.take : w.leave;
  const label = phase === 'reviewing' ? w.building : phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : verb;
  const press = () => {
    if (!connection) return onConnect();
    if (priv.on && review) return startPrivateIncome(review, view.x.mint, view.y.mint, connection.wallet, connection.address);
    if (shown) void usePier.getState().confirm(connection, holdings);
    else void usePier.getState().prepare(connection, { kind: act, position: view }, holdings);
  };

  return (
    <>
      {head}
      <div className={e.get}>
        <span className={e.getCol}>
          <span className={e.cap}>{w.now}</span>
          <span className={e.amounts}>{sumText(row.nowUsd, lang)}</span>
        </span>
        <span className={e.getCol}>
          <span className={e.cap}>{w.earned}</span>
          <span className={e.amounts} data-tone={resultTone(row.earnedUsd)}>
            {sumText(row.earnedUsd, lang, true)}
          </span>
        </span>
      </div>
      <Tabs<PoolAct>
        fill
        label={w.actions}
        value={act}
        onChange={(id) => void pick({ kind: 'position', address: view.address, act: id })}
        items={[
          { id: 'claim', label: w.take },
          { id: 'exit', label: w.leave },
        ]}
      />
      {figures ? (
        <div className={e.getCol}>
          <span className={e.cap}>{act === 'claim' ? w.youTake : w.youGetBack}</span>
          <span className={e.amounts}>{figures.amounts.length ? figures.amounts.join(' + ') : w.nothingYet}</span>
          <span className={`${e.cap} ${e.capWrap}`}>{lineOf([w.network(figures.networkSol), figures.rentReturnedSol ? w.depositBack(figures.rentReturnedSol) : null, act === 'exit' ? w.closes : w.stays])}</span>
        </div>
      ) : !possible && connection ? (
        <Note tone="plain">{view.feesElsewhere && act === 'claim' ? w.feesElsewhere : exitOpen ? w.nothingYet : w.fClosed}</Note>
      ) : null}
      {near ? <Note>{near === 'over' ? w.feeOver : w.feeNear}</Note> : null}
      {figures?.note && !notice ? <Note>{figures.note}</Note> : null}
      {notice ? <Note tone={notice.tone}>{said ? w[said] : notice.text}</Note> : null}
      {priv.offered ? <PrivateIncomePart x={view.x} y={view.y} review={review} on={priv.on} /> : null}
      <Action onClick={press} busy={waiting || (priv.on && privButton.busy)} disabled={waiting || (connection !== null && !possible) || (priv.on && privButton.busy)}>
        {connection ? ((priv.on ? privButton.label : null) ?? label) : w.connect}
      </Action>
    </>
  );
}

const PRO_VERB = { collect: 'take', compound: 'takeAndAdd', leave: 'leave', close: 'close' } as const;

/**
 * A position in a pool of DLMM Pro: take what it earned, take it and add it back in one transaction, or leave; an empty
 * one gives its deposit back. The Pro pool's own flow as the city runs it; the exact figures stand before the signature.
 */
export function ProPositionTicket({ boat, pier, row, act, solPriceUsd, onConnect }: { boat: ProBoat; pier: ProPier; row: PositionRow; act: ProAct; solPriceUsd: number | null; onConnect: () => void }) {
  const w = useWords(EARN);
  const lang = useLang();
  const phase = useProPier((st) => st.phase);
  const reviewed = useProPier((st) => st.reviewed);
  const notice = useProPier((st) => st.notice);
  const outcome = useProPier((st) => st.outcome);
  const connection = useWallet((st) => st.connection);
  const holdings = useWallet((st) => st.holdings);
  const shown = reviewed && reviewed.review.action === act && reviewed.key.endsWith(`:${boat.nftMint}`) ? reviewed : null;
  const summary = shown?.review.summary ?? null;
  const hasFees = BigInt(boat.fees.lamports) > 0n;
  const hasRewards = boat.rewards.some((reward) => reward.symbol !== null && BigInt(reward.accruedRaw) > 0n);
  const hasLiquidity = BigInt(boat.worth.lamports) > 0n;
  // What there is to do: an empty position only gives its deposit back.
  const acts: readonly ProAct[] = boat.empty ? ['close'] : hasLiquidity ? ['collect', 'compound', 'leave'] : ['collect', 'close'];
  const possible = acts.includes(act) && !((act === 'compound' && !hasFees) || (act === 'collect' && !hasFees && !hasRewards));

  useEffect(() => {
    if (!connection || !possible || phase !== 'idle' || notice || shown || outcome) return;
    const timer = setTimeout(() => void useProPier.getState().prepare(connection, { kind: act, nftMint: boat.nftMint }, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, possible, phase, notice, shown, outcome, act, boat.nftMint]);

  if (outcome) return <ProOutcome row={{ coins: row.coins, name: row.name, feePct: pier.feeBps / 100 }} other={pier.solIsX ? pier.y.symbol : pier.x.symbol} />;

  const said = notice ? noticeKey(notice.text, 'pro') : null;
  const waiting = phase === 'reviewing' || PRO_LOCKED.has(phase);
  const label = phase === 'reviewing' ? w.building : phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : w[PRO_VERB[act]];
  const press = () => {
    if (!connection) return onConnect();
    if (shown) void useProPier.getState().confirm(connection, holdings);
    else void useProPier.getState().prepare(connection, { kind: act, nftMint: boat.nftMint }, holdings);
  };
  const network = summary ? w.network(digits(proSolText(summary.networkLamports), lang)) : null;
  const rewardText = summary && 'rewards' in summary ? proRewardsText(pier, summary.rewards) : '';

  return (
    <>
      <TicketHead coins={row.coins} name={row.name} sub={row.mark ? `${digits(row.mark, lang)} · ${w.pro}` : w.pro} extra={<RangeChip inRange={row.inRange} />} />
      <div className={e.get}>
        <span className={e.getCol}>
          <span className={e.cap}>{w.now}</span>
          <span className={e.amounts}>{sumText(row.nowUsd, lang)}</span>
        </span>
        <span className={e.getCol}>
          <span className={e.cap}>{w.earned}</span>
          <span className={e.amounts} data-tone={resultTone(row.earnedUsd)}>
            {sumText(row.earnedUsd, lang, true)}
          </span>
        </span>
      </div>
      {row.result && !boat.empty ? <ResultFacts result={row.result} solPriceUsd={solPriceUsd} /> : null}
      {acts.length > 1 ? (
        <Tabs<ProAct> fill label={w.actions} value={act} onChange={(id) => void pick({ kind: 'proPosition', nftMint: boat.nftMint, act: id })} items={acts.map((id) => ({ id, label: id === 'compound' ? w.addMore : w[PRO_VERB[id]] }))} />
      ) : null}
      {summary?.action === 'compound' ? (
        <div className={e.getCol}>
          <span className={e.cap}>{w.takeAndAdd}</span>
          <span className={e.amounts}>{digits(proAmounts(pier, summary.collected.xRaw, summary.collected.yRaw), lang) || w.nothingYet}</span>
          <span className={`${e.cap} ${e.capWrap}`}>{lineOf([w.band(digits(bandPct(summary.bandBps), lang)), network, w.stays])}</span>
        </div>
      ) : summary?.action === 'collect' ? (
        <div className={e.getCol}>
          <span className={e.cap}>{w.youTake}</span>
          <span className={e.amounts}>{digits([summary.fees ? proAmounts(pier, summary.fees.xRaw, summary.fees.yRaw) : '', rewardText].filter(Boolean).join(' + '), lang) || w.nothingYet}</span>
          <span className={`${e.cap} ${e.capWrap}`}>{lineOf([network, w.stays])}</span>
        </div>
      ) : summary?.action === 'leave' ? (
        <div className={e.getCol}>
          <span className={e.cap}>{w.youGetBack}</span>
          <span className={e.amounts}>{digits(proAmounts(pier, summary.expected.xRaw, summary.expected.yRaw), lang) || '—'}</span>
          <span className={`${e.cap} ${e.capWrap}`}>{lineOf([w.atLeast(digits(proAmounts(pier, summary.minimum.xRaw, summary.minimum.yRaw), lang) || '0'), w.band(digits(bandPct(summary.bandBps), lang)), network])}</span>
        </div>
      ) : summary?.action === 'close' ? (
        <div className={e.getCol}>
          <span className={e.cap}>{w.close}</span>
          <span className={`${e.cap} ${e.capWrap}`}>{lineOf([network, w.closes])}</span>
        </div>
      ) : !possible && connection ? (
        <Note tone="plain">{w.nothingYet}</Note>
      ) : null}
      {!boat.inRange && !boat.empty ? <span className={`${e.cap} ${e.capWrap}`}>{`${digits(proPrice(boat.lowerPrice), lang)} – ${digits(proPrice(boat.upperPrice), lang)} ${pier.y.symbol}. ${w.rangeText}`}</span> : null}
      {notice ? <Note tone={notice.tone}>{w[said ?? 'notSent']}</Note> : null}
      <Action onClick={press} busy={waiting} disabled={waiting || (connection !== null && !possible)}>
        {connection ? label : w.connect}
      </Action>
    </>
  );
}
