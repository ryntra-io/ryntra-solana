'use client';

import { useEffect, useMemo } from 'react';
import { spendable } from '@/city/lib/districts/harbor/deposit';
import { PIER_GOALS, PIER_RESERVE_LAMPORTS, PIER_STYLES, rangePrices, solShort, type PierGoal, type PierStyle } from '@/city/lib/earn/pier';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { textFromRaw } from '@/lib/earn/model';
import type { DlmmStockRead } from '@/lib/earn-dlmm/stocks';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { Facts, Note, OneLine, Result, RiskDots, iconOf, iconsAfter } from '@/terminal/earn/bits';
import { lineOf } from '@/terminal/earn/PoolTicket';
import { pctText } from '@/terminal/earn/range/model';
import { Names } from '@/terminal/earn/range/RangeEditor';
import { widthRisk } from '@/terminal/earn/rows';
import { useRefreshAfter } from '@/terminal/earn/useReads';
import { EARN } from '@/terminal/earn/words';
import { StockPoolFacts } from '@/terminal/stocks/StockPoolFacts';
import { StockPositionLine } from '@/terminal/stocks/StockPositionLine';
import { evenPlaces, unbroken } from '@/terminal/pool/pool-view';
import { Action, AmountField, Kick, Quiet, QuietLink, Segment } from '@/terminal/ui';
import { WRAPPED_SOL, quoteSymbol, stockChoice, stockFigures, stockRange, type Lead } from './model';
import { STOCK_LOCKED, useDlmmStock } from './store';
import { noticeWord } from './notice';
import { DLMM_STOCK } from './words';
import e from '@/terminal/earn/earn.module.css';

/** With a wallet the pool admits, the exact figures follow the form after this pause, once per choice. */
const AUTO_REVIEW_MS = 450;

const GOAL_WORD = { even: 'goalEven', near: 'goalNear', edges: 'goalEdges' } as const;
const WIDTH_WORD = { calm: 'widthCalm', balanced: 'widthBalanced', dense: 'widthDense' } as const;

/**
 * A position in a DLMM pool of a checked stock (ANT against USDC or SOL), put in with the two coins the
 * wallet holds: the stock and the other coin (the second follows the first at the pool's price), the goal and the width
 * of the Pier, the exchange's state on top, before the signature what goes in of each coin, the range, the position's
 * deposit and what comes back, the pool's space that does not, the network — and the stock's own line: the issuer's
 * rights and the exchange's hours. One amber action signs exactly the engine's Review, in one approval. Nothing is swapped.
 * `facts` — the stock's facts a stand has read already; the pool's page leaves it out and the parts read them themselves.
 * `head` — the exchange's state on top of the form; the pool's page draws its own over every tab of its ticket
 * (`terminal/pool/PoolSide.tsx`), so it mounts the ticket without a second copy.
 */
export function DlmmStockTicket({ read, onConnect, facts: given, head = true }: { read: DlmmStockRead; onConnect: () => void; facts?: PoolFacts | null; head?: boolean }) {
  const w = useWords(EARN);
  const d = useWords(DLMM_STOCK);
  const lang = useLang();
  const goal = useDlmmStock((st) => st.goal);
  const style = useDlmmStock((st) => st.style);
  const typed = useDlmmStock((st) => st.typed);
  const phase = useDlmmStock((st) => st.phase);
  const reviewed = useDlmmStock((st) => st.reviewed);
  const reserveFor = useDlmmStock((st) => st.reserve);
  const notice = useDlmmStock((st) => st.notice);
  const outcome = useDlmmStock((st) => st.outcome);
  const connection = useWallet((st) => st.connection);
  const holdingsFor = useWallet((st) => st.holdings);
  const owner = connection?.address ?? null;
  const holdings = holdingsFor && holdingsFor.owner === owner ? holdingsFor : null;
  const reserve = reserveFor?.pool === read.pool ? reserveFor.value : PIER_RESERVE_LAMPORTS;
  const choice = useMemo(() => stockChoice(read, owner, typed, holdings, goal, style, reserve), [read, owner, typed, holdings, goal, style, reserve]);
  const shown = reviewed && choice.key && reviewed.key === choice.key ? reviewed : null;
  const figures = shown ? stockFigures(shown.review, read) : null;
  const open = read.add === 'on' && !read.paused;

  // The exact figures of what is on the form, while the person reads it.
  useEffect(() => {
    if (!connection || !open || !choice.key || phase !== 'idle' || notice || shown) return;
    const timer = setTimeout(() => void useDlmmStock.getState().prepare(connection, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, open, choice.key, phase, notice, shown]);

  if (outcome) return <StockOutcome />;

  const quote = quoteSymbol(read);
  const heldStock = spendable(holdings, read.stock.mint);
  const heldQuote = spendable(holdings, read.quote.kind === 'sol' ? WRAPPED_SOL : read.quote.mint);
  const balance = (units: bigint | null, decimals: number) => (units !== null ? w.balance(digits(textFromRaw(units, decimals, Math.min(decimals, 4)) || '0', lang)) : undefined);
  const counted = stockRange(read, style);
  const range = figures && figures.low !== null && figures.high !== null ? { low: figures.low, high: figures.high } : counted;
  // The range's two prices with the same decimals.
  const edges = rangePrices(range.low, range.high);
  const prices = evenPlaces(edges.low, edges.high);
  const rangeText = digits(`${w.dRange} ${prices.low} – ${prices.high} ${quote}`, lang);
  const problem =
    !choice.problem || (!typed.stock.trim() && !typed.quote.trim())
      ? null
      : choice.problem === 'format'
        ? w.pFormat
        : choice.problem === 'stock'
          ? d.short(read.stock.symbol)
          : choice.problem === 'quote'
            ? d.short(quote)
            : d.shortSol;
  const said = notice ? noticeWord(notice.code) : null;
  const waiting = phase === 'reviewing' || STOCK_LOCKED.has(phase);
  const label = phase === 'reviewing' ? w.building : phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : w.addToPool;
  const set = (lead: Lead) => (text: string) => useDlmmStock.getState().setTyped(lead, text);
  const press = () => {
    if (!connection) return onConnect();
    if (shown) void useDlmmStock.getState().confirm(connection, useWallet.getState().holdings);
    else void useDlmmStock.getState().prepare(connection, holdings);
  };
  const sol = (lamports: bigint) => digits(solShort(lamports), lang);

  return (
    <>
      {head ? <StockPoolFacts mint={read.stock.mint} facts={given} /> : null}
      {/* While the wallet is open or the bytes travel, the form is what is being signed: it holds still. */}
      <fieldset className={e.form} disabled={STOCK_LOCKED.has(phase)} data-dlmm-stock="">
        <AmountField label={w.youPut} aside={balance(heldStock, read.stock.decimals)} value={typed.stock} onChange={set('stock')} asset={{ symbol: read.stock.symbol, icon: iconOf(read.stock.mint), also: iconsAfter(read.stock.mint) }} />
        <AmountField label={d.together} aside={balance(heldQuote, read.quote.decimals)} value={typed.quote} onChange={set('quote')} asset={{ symbol: quote, icon: iconOf(read.quote.mint), also: iconsAfter(read.quote.mint) }} />
        <div className={e.choice}>
          <Kick>{w.goal}</Kick>
          {/* The goal's own words alone: the shapes' technical names («Spot · Curve · Bid-Ask») are not the person's. */}
          <Segment<PierGoal> label={w.goal} value={goal} onChange={(id) => useDlmmStock.getState().setGoal(id)} items={PIER_GOALS.map((id) => ({ id, label: w[GOAL_WORD[id]] }))} />
        </div>
        <div className={e.choice}>
          <div className={e.choiceHead}>
            <Kick>{w.width}</Kick>
            <span className={e.riskRow}>
              <Kick>{w.risk}</Kick>
              <RiskDots dots={widthRisk(style, false)} label={w.riskOf(String(widthRisk(style, false)))} />
            </span>
          </div>
          <Segment<PierStyle> label={w.width} value={style} onChange={(id) => useDlmmStock.getState().setStyle(id)} items={PIER_STYLES.map((id) => ({ id, label: w[WIDTH_WORD[id]] }))} />
          <Names items={PIER_STYLES.map((id) => ({ id, label: digits(`±${pctText(stockRange(read, id).upPct)}%`, lang), on: id === style }))} />
        </div>
      </fieldset>
      {/* Each part of the line holds together: it breaks only between them, never «Ryntra / 0%». */}
      <OneLine label={w.poolDetails} line={lineOf([rangeText, d.noSwap, w.ryntraNone].map(unbroken))}>
        <Facts
          rows={[
            [w.dGoesIn, figures && figures.goesIn.length ? digits(figures.goesIn.join(' + '), lang) : null],
            [w.dDeposit, figures && figures.depositBack > 0n ? `${sol(figures.depositBack)} SOL · ${w.dDepositBack}` : null],
            [d.kept, figures && figures.kept > 0n ? `${sol(figures.kept)} SOL · ${d.keptBack}` : null],
            [w.dNetwork, figures ? `${sol(figures.network)} SOL` : null],
          ]}
        />
        {figures ? <p>{w.approvals(String(figures.transactions))}</p> : null}
        <p>{d.follows}</p>
        <p>{d.twoCoins}</p>
        <p>{w.rangeText}</p>
        <p>{d.exitWhy}</p>
        <p>{w.keysText}</p>
      </OneLine>
      {read.paused ? <Note>{d.paused}</Note> : !open ? <Note tone="plain">{read.stopped ? w.fPaused : d.closed}</Note> : problem ? <Note>{problem}</Note> : null}
      {said ? <Note tone={notice!.tone}>{said.book === 'stock' ? d[said.key] : w[said.key]}</Note> : null}
      <StockPositionLine mint={read.stock.mint} issuer={read.stock.issuer} facts={given} />
      <Action onClick={press} busy={waiting} disabled={waiting || (connection !== null && (!open || Boolean(choice.problem)))}>
        {connection ? label : w.connect}
      </Action>
      {choice.problem === 'stock' ? (
        <QuietLink href={`/pool/${read.pool}?tab=swap`} size="s">
          {d.get(read.stock.symbol)}
        </QuietLink>
      ) : null}
    </>
  );
}

/** How the add ended, in plain words: done, in part, not at all, or not known yet — never sent twice. */
function StockOutcome() {
  const w = useWords(EARN);
  const d = useWords(DLMM_STOCK);
  const outcome = useDlmmStock((st) => st.outcome);
  const phase = useDlmmStock((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  useRefreshAfter(outcome?.kind === 'done' || outcome?.kind === 'partial', connection?.address ?? null);
  if (!outcome) return null;
  const good = outcome.kind === 'done';
  const signature = outcome.kind === 'failed' ? outcome.signature : 'signatures' in outcome ? (outcome.signatures.at(-1) ?? null) : null;
  const word = good ? w.doneAdd : outcome.kind === 'partial' ? w.partial : outcome.kind === 'failed' ? w.failed : w.unknown;
  return (
    <>
      <Result good={good} word={word} line={good ? `${w.doneAddLine} ${d.exitWhy}` : null} link={signature ? explorerTxUrl('mainnet', signature) : null} linkLabel={w.explorer} />
      {outcome.kind === 'unknown' ? (
        <Action onClick={() => void useDlmmStock.getState().recheck()} busy={phase === 'sending'} disabled={phase === 'sending'}>
          {w.checking}
        </Action>
      ) : (
        <Quiet full onClick={() => useDlmmStock.getState().again()}>
          {good || outcome.kind === 'partial' ? w.ok : w.again}
        </Quiet>
      )}
    </>
  );
}
