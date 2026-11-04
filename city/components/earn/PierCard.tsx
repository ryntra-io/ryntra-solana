'use client';

import { useEffect, useMemo } from 'react';
import { percent } from '@/city/lib/districts/harbor/pools';
import { reviewFigures } from '@/city/lib/districts/harbor/review';
import { openTradeCard } from '@/city/lib/coin/open';
import { useEarn } from '@/city/lib/earn/open';
import { PIER_STYLES, pierRange, rangePrices, solShort, STYLE_HALF, STYLE_RISK, unitsShort, usdToSol, PIER_SLIPPAGE_BPS, type Pier, type PierStyle } from '@/city/lib/earn/pier';
import { PIER_MODE } from '@/city/lib/earn/pier-gate';
import { historyPicture, pierSeries, plotOf, type HistoryPicture } from '@/city/lib/earn/pier-history';
import { PIER_BUSY, PIER_LOCKED, pierChoice, usePier, type PierNotice } from '@/city/lib/earn/pier-store';
import { useSaver } from '@/city/lib/earn/saver-store';
import { pctText, type ProvenStrategy } from '@/city/lib/earn/captain';
import { zapLamports, type ZapLeg } from '@/city/lib/earn/zap-store';
import type { Words } from '@/city/lib/earn/words';
import { digits } from '@/city/lib/i18n/dict';
import { amountText } from '@/city/lib/trade/size';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { BackGlyph, Coin, Line, Notify, RiskDots, Wallets } from './bits';
import { CopyRecord, useZapView, ZapAction } from './Copy';
import s from './earn.module.css';

/** With a wallet the Harbor admits, the exact Review follows the card after this pause, once per choice. */
const AUTO_REVIEW_MS = 450;

/**
 * One SOL pier: the amount in SOL, the style, the month gone as a picture, the one line before the signature and the
 * one amber action. The engine builds and checks; the person signs in their own wallet; the result is said in SOL.
 *
 * A copy of «Like the Captain» (CITY-99) is the same card on the strategy's pier: its style fixed, its record in place
 * of the month gone, and — when the wallet holds only SOL — the Zap: the missing coin bought first, then the add.
 */
export function PierCard({ words, pier, copy = null }: { words: Words; pier: Pier; copy?: ProvenStrategy | null }) {
  const w = words.pier;
  const style = usePier((st) => st.style);
  const typed = usePier((st) => st.typed);
  const phase = usePier((st) => st.phase);
  const reviewed = usePier((st) => st.reviewed);
  const costsFor = usePier((st) => st.costs);
  const notice = usePier((st) => st.notice);
  const outcome = usePier((st) => st.outcome);
  const statesFor = usePier((st) => st.states);
  const candles = usePier((st) => st.candles);
  const connection = useWallet((st) => st.connection);
  const holdingsFor = useWallet((st) => st.holdings);
  const owner = connection?.address ?? null;
  const holdings = holdingsFor && holdingsFor.owner === owner ? holdingsFor : null;
  const states = owner && statesFor?.owner === owner ? statesFor.value : null;
  const admitted = states?.add === 'on';
  const costs = costsFor?.pool === pier.pool.address ? costsFor.value : null;
  const choice = useMemo(() => pierChoice(pier, style, typed, holdings, owner, states?.ceilingUsd ?? null, costs), [pier, style, typed, holdings, owner, states, costs]);
  const shown = reviewed && choice.key && reviewed.key === choice.key ? reviewed : null;
  const figures = shown ? reviewFigures(shown.review, { x: pier.pool.x.symbol, y: pier.pool.y.symbol }, pier.pool) : null;
  const busy = PIER_BUSY.has(phase);
  const range = pierRange(pier, style);
  const prices = rangePrices(range.low, range.high);

  // Opened from the Shelf (a copy) the Piers tab has not asked what this wallet may do here: asked once.
  useEffect(() => {
    if (owner && PIER_MODE !== 'closed' && usePier.getState().states?.owner !== owner) void usePier.getState().loadStates(owner);
  }, [owner]);

  // The exact Review of what is on the card, while the person reads it.
  useEffect(() => {
    if (!connection || !admitted || !choice.key || phase !== 'idle' || notice || shown) return;
    const timer = setTimeout(() => void usePier.getState().prepare(connection, { kind: 'add' }, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, admitted, choice.key, phase, notice, shown]);

  const sol = candles[pier.sol.mint];
  const other = pier.pair === 'lst' ? candles[pier.other.mint] : null;
  const picture = useMemo(() => {
    if (sol?.status !== 'ready' || (pier.pair === 'lst' && other?.status !== 'ready')) return null;
    const series = pierSeries(pier, sol.value, other?.status === 'ready' ? other.value : null);
    return historyPicture(pier, series, style, choice.lamports);
  }, [pier, sol, other, style, choice.lamports]);
  const pastLoading = sol?.status === 'loading' || other?.status === 'loading';
  const short = choice.problem === 'other' && choice.fit.otherMissingLamports > 0n;
  // A copy's Zap: the coin the wallet lacks, bought with SOL first, a little over what is missing.
  const leg: ZapLeg | null = copy && short ? { mint: pier.other.mint, symbol: pier.other.symbol, decimals: pier.other.decimals, lamports: zapLamports(choice.fit.otherMissingLamports) } : null;
  const zap = useZapView(leg);

  if (outcome) return <Outcome words={words} copied={Boolean(copy)} />;

  const minText = digits(solShort(choice.minimum));
  const goesIn = figures ? figures.amounts.join(' + ') : choice.split ? `≈ ${digits(solShort(choice.split.solLamports))} SOL + ${digits(unitsShort(choice.split.otherUnits, pier.other.decimals))} ${pier.other.symbol}` : null;
  const shareSol = figures?.valueUsd != null || choice.lamports ? dayShare(pier, figures?.valueUsd ?? null, choice.lamports) : null;
  const problem = typed && choice.problem && !leg ? problemText(words, choice.problem, choice, pier) : null;
  const getOther = () => {
    if (pier.lst) {
      useSaver.getState().setLst(pier.lst.id);
      useSaver.getState().setTyped(amountText((choice.fit.otherMissingLamports * 102n) / 100n, 9));
      useEarn.getState().openProduct('saver');
    } else openTradeCard({ mint: pier.other.mint, symbol: pier.other.symbol, name: pier.other.symbol, icon: null });
  };
  // Closed — and, under the canary, closed to every wallet it does not name: the canary is never announced.
  const closed = PIER_MODE === 'closed' || (PIER_MODE === 'canary' && !admitted) || (states !== null && !admitted && !states.stopped && states.exit !== 'on');

  return (
    <section className={s.saver} aria-label={pier.pool.pair}>
      <button type="button" className={s.back} onClick={() => usePier.getState().back()} disabled={PIER_LOCKED.has(phase)}>
        <BackGlyph />
        {words.back}
      </button>
      <div className={s.cardHead}>
        <span className={s.pierTitle}>
          <span className={s.pierCoins} aria-hidden="true">
            <Coin mint={pier.other.mint} size={30} symbol={pier.other.symbol} />
            <Coin mint={pier.sol.mint} size={30} symbol="SOL" />
          </span>
          <h3 className={`${s.display} ${s.productName}`}>{pier.lst ? `${pier.lst.symbol} · SOL` : `SOL · ${pier.other.symbol}`}</h3>
        </span>
        <RiskDots dots={STYLE_RISK[style]} words={words} />
      </div>

      {copy ? (
        <CopyRecord words={words} strategy={copy} />
      ) : (
        <div className={s.styles} role="radiogroup" aria-label={w.style}>
          {PIER_STYLES.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={style === id} className={`${s.styleButton} ${style === id ? s.styleOn : ''}`} onClick={() => usePier.getState().setStyle(id)} disabled={busy}>
              <StyleGlyph style={id} />
              <b>{w.styles[id]}</b>
              <span>±{percent(pierRange(pier, id).upPct)}</span>
            </button>
          ))}
        </div>
      )}

      <label className={s.kicker} htmlFor="earn-pier-amount">
        {w.amount}
      </label>
      <div className={s.field}>
        <input
          id="earn-pier-amount"
          className={`${s.input} ${s.amount}`}
          inputMode="decimal"
          autoComplete="off"
          value={typed}
          onChange={(event) => usePier.getState().setTyped(event.target.value)}
          disabled={busy}
          aria-invalid={Boolean(problem)}
        />
        <span className={s.unit}>SOL</span>
        {choice.max !== null && choice.max > 0n ? (
          <button type="button" className={s.inline} onClick={() => usePier.getState().setTyped(amountText(choice.max!, 9))} disabled={busy}>
            {w.max}
          </button>
        ) : null}
      </div>
      {goesIn ? <p className={s.goesIn}>{goesIn}</p> : null}

      {copy ? null : <PierPast words={words} picture={picture} loading={pastLoading} />}

      <Line
        label={words.details}
        line={
          <>
            {leg ? `${words.captain.zapFee} ${zap.fee ?? '…'}` : w.noFee} · {w.minimum} {minText} SOL · {w.risk}
          </>
        }
      >
        <dl className={s.dl}>
          {copy ? (
            <>
              <dt>{words.captain.style}</dt>
              <dd>{w.styles[copy.style]}</dd>
              <dt>{words.captain.fees}</dt>
              <dd>{digits(pctText(copy.feesPct))}</dd>
              <dt>{words.captain.price}</dt>
              <dd>{digits(pctText(copy.pricePct))}</dd>
              <dt>{words.captain.live}</dt>
              <dd>{digits(String(copy.live))}</dd>
            </>
          ) : null}
          {leg ? (
            <>
              <dt>{words.captain.zapGet}</dt>
              <dd>{zap.minimum ? digits(zap.minimum) : '—'}</dd>
              <dt>{words.captain.zapFee}</dt>
              <dd>{zap.fee ? digits(zap.fee) : '—'}</dd>
            </>
          ) : null}
          <dt>{w.range}</dt>
          <dd>
            {digits(prices.low)} – {digits(prices.high)} {pier.pool.y.symbol}
          </dd>
          <dt>{w.bins}</dt>
          <dd>{digits(String(STYLE_HALF[style]))}</dd>
          <dt>{w.rent}</dt>
          <dd>{figures?.rentSol ? `${figures.rentSol} SOL${figures.rentBack ? `, ${w.rentBack}` : ''}` : '—'}</dd>
          <dt>{w.network}</dt>
          <dd>{figures ? `${figures.networkSol} SOL` : '—'}</dd>
          <dt>{w.slippage}</dt>
          <dd>{digits(`${PIER_SLIPPAGE_BPS / 100}%`)}</dd>
          <dt>{w.tradeFee}</dt>
          <dd>{pier.pool.feePct !== null ? digits(`${Number(pier.pool.feePct.toFixed(3))}%`) : '—'}</dd>
          {shareSol !== null ? (
            <>
              <dt>{w.dayFees}</dt>
              <dd>≈ {digits(solShort(shareSol))} SOL</dd>
            </>
          ) : null}
          <dt>Meteora</dt>
          <dd>{w.venue}</dd>
        </dl>
        {figures && figures.transactions > 1 ? <p className={s.fine}>{w.signatures(figures.transactions)}</p> : null}
        <p className={s.fine}>{copy ? words.captain.fine : w.pastFine}</p>
        <p className={s.fine}>{w.fine}</p>
      </Line>

      {problem ? <p className={`${s.note} ${s.noteWarn}`}>{problem}</p> : null}
      {states?.stopped ? <p className={`${s.note} ${s.noteWarn}`}>{w.stopped}</p> : null}
      <PierNote notice={notice ?? (figures?.note ? { tone: 'warn', text: figures.note } : null)} />

      <div className={s.grow} />
      {closed ? (
        <Notify product="pier" words={words} />
      ) : leg && connection ? (
        <ZapAction words={words} pier={pier} leg={leg} admitted={admitted && !states?.stopped} />
      ) : short && connection ? (
        <button type="button" className={`${s.display} ${s.action} ${s.cta}`} onClick={getOther}>
          {w.get(pier.other.symbol)}
        </button>
      ) : (
        <PierAction
          words={words}
          verb={copy ? words.captain.copy : w.add}
          ready={Boolean(shown)}
          blocked={connection && (!admitted || choice.problem) ? (copy ? words.captain.copy : w.add) : null}
          onPrepare={() => connection && void usePier.getState().prepare(connection, { kind: 'add' }, holdings)}
        />
      )}
    </section>
  );
}

/** The day gone: what this amount's share of the pool's depth took of its fees, in SOL. A fact, never a forecast. */
function dayShare(pier: Pier, valueUsd: number | null, lamports: bigint | null): number | null {
  const fees = pier.pool.lpFees24hUsd;
  const price = usdToSol(pier, 1);
  const usd = valueUsd ?? (lamports !== null && price ? Number(lamports) / 1e9 / price : null);
  if (fees === null || usd === null || !(usd > 0)) return null;
  return usdToSol(pier, (fees * usd) / (pier.pool.tvlUsd + usd));
}

function problemText(words: Words, problem: NonNullable<ReturnType<typeof pierChoice>['problem']>, choice: ReturnType<typeof pierChoice>, pier: Pier): string {
  const p = words.pier.problem;
  if (problem === 'min') return p.min(digits(solShort(choice.minimum)));
  if (problem === 'ceiling') return p.ceiling(digits(solShort(choice.ceiling)));
  if (problem === 'other') return p.other(pier.other.symbol);
  return p[problem]('');
}

/** The style's spread over the bins: the same worth over many low bars, or a few tall ones by the price. */
export function StyleGlyph({ style }: { style: PierStyle }) {
  const bars = 9;
  const used = style === 'calm' ? 9 : style === 'balanced' ? 5 : 3;
  const height = 22 * Math.min(1, 2.2 / used + 0.12);
  return (
    <svg className={s.styleGlyph} viewBox="0 0 54 26" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const on = Math.abs(i - 4) <= (used - 1) / 2;
        const h = on ? height : 2;
        return <rect key={i} x={i * 6 + 0.5} y={25 - h} width="4.4" height={h} rx="1" className={on ? s.barOn : s.barOff} />;
      })}
    </svg>
  );
}

/** «Past 30 days»: the price path, the style's band around where it began, the time inside it and the end against holding. */
function PierPast({ words, picture, loading }: { words: Words; picture: HistoryPicture | null; loading: boolean }) {
  const w = words.pier;
  if (!picture) {
    return loading ? (
      <div className={s.bones} aria-busy="true">
        <span />
      </div>
    ) : null;
  }
  const W = 300;
  const H = 64;
  const plot = plotOf(picture, W, H);
  const vs = picture.vsHoldSol;
  return (
    <figure className={s.past} aria-label={w.past}>
      <figcaption className={s.pastFigures}>
        <span className={s.kicker}>{w.past}</span>
        <span className={s.pastPair}>
          <span>
            <small>{w.inRangeShare}</small>
            <b>{digits(`${Math.round(picture.inRange * 100)}%`)}</b>
          </span>
          <span>
            <small>
              {w.vsHold} · {w.beforeFees}
            </small>
            <b className={vs === null || Math.abs(vs) < 1e-9 ? undefined : vs > 0 ? s.gain : s.loss}>{vs !== null ? `${vs > 0 ? '+' : ''}${digits(solShort(vs))} SOL` : digits(`${picture.vsHoldPct.toFixed(2)}%`)}</b>
          </span>
        </span>
      </figcaption>
      <svg className={s.pastPlot} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="earn-past-band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9945ff" stopOpacity="0.32" />
            <stop offset="1" stopColor="#9945ff" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <rect x="0" y={plot.bandTop} width={W} height={Math.max(1, plot.bandBottom - plot.bandTop)} fill="url(#earn-past-band)" />
        <line x1="0" x2={W} y1={plot.bandTop} y2={plot.bandTop} className={s.pastEdge} />
        <line x1="0" x2={W} y1={plot.bandBottom} y2={plot.bandBottom} className={s.pastEdge} />
        <path d={plot.line} className={s.pastLine} />
        {plot.lit.map((d, i) => (
          <path key={i} d={d} className={s.pastLit} />
        ))}
        <circle cx={plot.end.x - 2} cy={plot.end.y} r="3" className={s.pastDot} />
      </svg>
    </figure>
  );
}

export function PierNote({ notice }: { notice: PierNotice | null }) {
  if (!notice) return null;
  return (
    <p className={`${s.note} ${notice.tone === 'warn' ? s.noteWarn : s.noteError}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      {notice.text}
    </p>
  );
}

/** The one amber action: connect, build the exact Review, sign it, or say plainly why not. */
export function PierAction({ words, verb, ready, blocked, onPrepare }: { words: Words; verb: string; ready: boolean; blocked: string | null; onPrepare: () => void }) {
  const w = words.pier;
  const phase = usePier((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  if (!connection) return <Wallets words={words} />;
  const waiting = phase === 'reviewing' || phase === 'wallet' || phase === 'sending';
  const label = phase === 'reviewing' ? w.building : phase === 'wallet' ? w.wallet : phase === 'sending' ? w.sending : blocked ?? verb;
  const press = () => {
    if (ready) void usePier.getState().confirm(connection, useWallet.getState().holdings);
    else onPrepare();
  };
  return (
    <button type="button" className={`${s.display} ${s.action} ${s.cta} ${waiting ? s.waiting : ''}`} onClick={press} disabled={waiting || Boolean(blocked)}>
      {label}
    </button>
  );
}

/** What happened, in the window's words: moored, partly, not at all, or not known yet — never sent twice. */
export function Outcome({ words, copied = false }: { words: Words; copied?: boolean }) {
  const w = words.pier;
  const outcome = usePier((st) => st.outcome);
  const phase = usePier((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  if (!outcome) return null;
  const signature = outcome.kind === 'failed' ? outcome.signature : 'signatures' in outcome ? outcome.signatures.at(-1) ?? null : null;
  const good = outcome.kind === 'done';
  const word = outcome.kind === 'done' ? (copied ? words.captain.copied : w.done) : outcome.kind === 'partial' ? w.partial : outcome.kind === 'failed' ? w.failed : w.unknown;
  return (
    <section className={s.saver}>
      <div className={`${s.result} ${good ? s.resultGood : ''}`} role="status">
        {good ? (
          <>
            <span className={`${s.display} ${s.resultWord}`}>{word}</span>
            <p className={s.fine}>{copied ? words.captain.copiedLine : w.doneLine}</p>
          </>
        ) : (
          <p className={s.lead}>{word}</p>
        )}
        {signature ? (
          <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
            {w.explorer}
          </a>
        ) : null}
      </div>
      <div className={s.grow} />
      {outcome.kind === 'unknown' && connection ? (
        <button type="button" className={`${s.display} ${s.action} ${phase === 'sending' ? s.waiting : ''}`} onClick={() => void usePier.getState().recheck(connection.address)} disabled={phase === 'sending'}>
          {phase === 'sending' ? w.sending : w.checking}
        </button>
      ) : (
        <button type="button" className={`${s.display} ${good ? s.action : s.secondary}`} onClick={() => usePier.getState().again()}>
          {good || outcome.kind === 'partial' ? (copied ? words.back : w.toPiers) : w.again}
        </button>
      )}
    </section>
  );
}
