'use client';

import { useEffect, useMemo } from 'react';
import { RISK } from '@/city/lib/earn/flag';
import { lamportsOf, LSTS, lstOf, percentText as percentRaw, solText as solRaw } from '@/city/lib/earn/lst';
import { digits } from '@/city/lib/i18n/dict';
import { useEarn } from '@/city/lib/earn/open';
import { entryCostPct, exitSpreadPct, lamportsFromText, saverLine, yearAtRate } from '@/city/lib/earn/saver';
import { saverChoice, SAVER_BUSY, useSaver } from '@/city/lib/earn/saver-store';
import { useEarnData } from '@/city/lib/earn/store';
import type { Words } from '@/city/lib/earn/words';
import { amountText } from '@/city/lib/trade/size';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { BackGlyph, Coin, Line, RiskDots, Wallets } from './bits';
import s from './earn.module.css';

/** With a wallet, the exact order follows the price after this pause, once per amount. */
const AUTO_ORDER_MS = 450;

/** The Saver's figures in the language on screen (CITY-243): never «5.06%» beside «0,5 SOL». */
const solText = (lamports: bigint | null, signed = false) => digits(solRaw(lamports, signed));
const percentText = (value: number | null) => digits(percentRaw(value));
const pct = (value: number | null) => (value === null ? '—' : percentText(value));

/**
 * The SOL Saver: pick the LST, type the SOL, read the one line, sign once. Every figure is the engine's (the same
 * swap the trade card makes) or the LST's worth read from its pool, and the result is said in SOL.
 */
export function Saver({ words }: { words: Words }) {
  const w = words.saver;
  const lst = useSaver((st) => st.lst);
  const typed = useSaver((st) => st.typed);
  const quote = useSaver((st) => st.quote);
  const exit = useSaver((st) => st.exit);
  const review = useSaver((st) => st.review);
  const phase = useSaver((st) => st.phase);
  const notice = useSaver((st) => st.notice);
  const done = useSaver((st) => st.done);
  const failed = useSaver((st) => st.failed);
  const unknown = useSaver((st) => st.unknown);
  const connection = useWallet((st) => st.connection);
  const holdings = useWallet((st) => st.holdings);
  const feed = useEarnData((st) => st.feed);
  const row = feed.status === 'ready' ? feed.value.lsts.find((r) => r.id === lst) ?? null : null;
  const token = lstOf(lst)!;
  const choice = useMemo(() => saverChoice(lst, typed, holdings), [lst, typed, holdings]);
  const key = choice.key ? `${lst}:${choice.key}` : null;
  const busy = SAVER_BUSY.has(phase) || phase === 'preparing';

  // A price for the amount on screen. A signature another surface left out is the engine's to name: its owner lock
  // turns the next order into a read-back of that signature (`prepareOrder` → `locked`).
  useEffect(() => {
    if (useSaver.getState().quote.status === 'none') void useSaver.getState().refreshQuote();
  }, [connection]);
  // With a wallet, the exact order is built while the person reads the line.
  useEffect(() => {
    if (!connection || !key || quote.status !== 'ready' || quote.key !== key || review?.key === key || phase !== 'idle' || notice) return;
    const timer = setTimeout(() => void useSaver.getState().prepare(true), AUTO_ORDER_MS);
    return () => clearTimeout(timer);
  }, [connection, key, quote, review, phase, notice]);

  const ordered = review && review.key === key ? review.order : null;
  const priced = ordered?.order ?? (quote.status === 'ready' && quote.key === key ? quote.body.order : null);
  const line = priced ? saverLine(priced, ordered ? 'order' : 'quote', row?.rate ?? null) : null;
  const inLamports = choice.amountRaw ? BigInt(choice.amountRaw) : lamportsFromText(typed);
  const outRaw = priced && /^\d+$/.test(priced.outAmountRaw) ? BigInt(priced.outAmountRaw) : null;
  const entry = inLamports && outRaw ? entryCostPct(inLamports, outRaw, row?.rate ?? null) : null;
  const back = exit && exit.key === key && exit.lamports && outRaw ? exitSpreadPct(outRaw, BigInt(exit.lamports), row?.rate ?? null) : null;
  const year = yearAtRate(line?.expectedLamports ?? null, row?.apyPct ?? null);
  const max = choice.sizing.max;

  if (phase === 'done' && done) {
    const worth = done.lstRaw ? lamportsOf(BigInt(done.lstRaw), row?.rate ?? null) : null;
    return (
      <section className={s.saver} aria-label={words.products.saver.name}>
        <div className={`${s.result} ${s.resultGood}`} role="status">
          <span className={`${s.display} ${s.resultWord}`}>{w.done}</span>
          <p className={s.lead}>
            {done.lstRaw ? `${solText(BigInt(done.lstRaw))} ${token.symbol}` : token.symbol}
            {worth !== null ? ` ≈ ${solText(worth)} SOL` : ''}
          </p>
          <p className={s.fine}>{w.doneLine}</p>
          <a className={s.link} href={explorerTxUrl('mainnet', done.signature)} target="_blank" rel="noreferrer">
            {w.explorer}
          </a>
        </div>
        <div className={s.grow} />
        <div className={s.pair}>
          <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useEarn.getState().setTab('mine')}>
            {words.tabs.mine}
          </button>
          <button type="button" className={`${s.display} ${s.action}`} onClick={() => useSaver.getState().again()}>
            {w.again}
          </button>
        </div>
      </section>
    );
  }

  const action =
    phase === 'preparing'
      ? w.building
      : phase === 'wallet'
        ? w.wallet
        : phase === 'sending'
          ? w.sending
          : phase === 'checking'
            ? w.checking
            : phase === 'failed'
              ? w.again
              : phase === 'unknown'
                ? w.checking
                : ordered
                  ? w.sign
                  : w.review;

  return (
    <section className={s.saver} aria-label={words.products.saver.name}>
      <button type="button" className={s.back} onClick={() => useEarn.getState().openProduct(null)} disabled={busy}>
        <BackGlyph />
        {words.back}
      </button>
      <div className={s.cardHead}>
        <h3 className={`${s.display} ${s.productName}`}>{words.products.saver.name}</h3>
        <RiskDots dots={RISK.saver} words={words} />
      </div>
      <div className={s.lsts} role="radiogroup" aria-label={words.saver.lsts}>
        {LSTS.map((l) => {
          const r = feed.status === 'ready' ? feed.value.lsts.find((x) => x.id === l.id) : null;
          return (
            <button key={l.id} type="button" role="radio" aria-checked={lst === l.id} className={`${s.lst} ${lst === l.id ? s.lstOn : ''}`} onClick={() => useSaver.getState().setLst(l.id)} disabled={busy}>
              <Coin mint={l.mint} size={24} />
              <b>{l.symbol}</b>
              {r?.apyPct != null ? <span>{percentText(r.apyPct)}</span> : null}
            </button>
          );
        })}
      </div>
      <label className={s.kicker} htmlFor="earn-saver-amount">
        {w.amount}
      </label>
      <div className={s.field}>
        <input
          id="earn-saver-amount"
          className={`${s.input} ${s.amount}`}
          inputMode="decimal"
          autoComplete="off"
          value={typed}
          onChange={(event) => useSaver.getState().setTyped(event.target.value)}
          disabled={busy}
          aria-invalid={Boolean(choice.problem)}
        />
        <span className={s.unit}>SOL</span>
        {max !== null && BigInt(max) > 0n ? (
          <button type="button" className={s.inline} onClick={() => useSaver.getState().setTyped(amountText(BigInt(max), 9))} disabled={busy}>
            {w.max}
          </button>
        ) : null}
      </div>

      {line ? (
        <div className={s.get}>
          <span className={s.kicker}>{w.youGet}</span>
          <b>
            ≈ {line.expected} {token.symbol}
          </b>
          {line.expectedLamports !== null ? <span>≈ {solText(line.expectedLamports)} SOL</span> : null}
          {year !== null ? (
            <span className={s.gain}>
              {w.yearAtRate} {solText(year, true)} SOL
            </span>
          ) : null}
        </div>
      ) : quote.status === 'loading' ? (
        <div className={s.bones} aria-busy="true">
          <span />
        </div>
      ) : null}

      {line ? (
        <Line
          label={words.details}
          line={
            <>
              {line.fee ? `${w.fee} ${line.fee}` : w.noFee} · {w.minimum} {line.minimum} {token.symbol}
              {line.costLamports !== null ? ` · ${line.rentSol ? w.networkRent : w.network} ${solText(line.costLamports)} SOL` : ''} · {w.risk}
            </>
          }
        >
          <dl className={s.dl}>
            <dt>{w.fee}</dt>
            <dd>{line.fee ?? w.noFee}</dd>
            <dt>{w.minimum}</dt>
            <dd>
              {line.minimum} {token.symbol}
              {line.minimumLamports !== null ? ` ≈ ${solText(line.minimumLamports)} SOL` : ''}
            </dd>
            <dt>{w.network}</dt>
            <dd>{line.networkSol ? `${line.networkSol} SOL` : '—'}</dd>
            {line.rentSol ? (
              <>
                <dt>{w.rent}</dt>
                <dd>{line.rentSol} SOL</dd>
              </>
            ) : null}
            <dt>{w.entryCost}</dt>
            <dd>{pct(entry)}</dd>
            <dt>{w.exitSpread}</dt>
            <dd>{pct(back)}</dd>
            <dt>{w.lstFee}</dt>
            <dd>{pct(row?.rewardsFeePct ?? null)}</dd>
            <dt>{w.route}</dt>
            <dd>{line.route}</dd>
            <dt>{w.method}</dt>
            <dd>{row?.source === 'sanctum' ? w.methodSanctum : row?.source === 'chain' ? w.methodChain : '—'}</dd>
          </dl>
          <p className={s.fine}>{w.riskWhat}</p>
          <p className={s.fine}>{w.fine}</p>
        </Line>
      ) : null}

      {choice.problem && typed ? <p className={`${s.note} ${s.noteWarn}`}>{w.problem[choice.problem.kind]}</p> : null}
      {notice ? <p className={`${s.note} ${notice.tone === 'error' ? s.noteError : notice.tone === 'warn' ? s.noteWarn : ''}`} role={notice.tone === 'info' ? 'status' : 'alert'}>{notice.text}</p> : null}
      {phase === 'failed' && failed ? (
        <p className={`${s.note} ${s.noteError}`} role="alert">
          {w.failed}. {w.failedLine}{' '}
          <a className={s.link} href={explorerTxUrl('mainnet', failed)} target="_blank" rel="noreferrer">
            {w.explorer}
          </a>
        </p>
      ) : null}
      {phase === 'unknown' && unknown ? (
        <p className={`${s.note} ${s.noteWarn}`} role="status">
          {unknown.message}
        </p>
      ) : null}

      <div className={s.grow} />
      {connection ? (
        <button
          type="button"
          className={`${s.display} ${s.action} ${s.cta} ${busy ? s.waiting : ''}`}
          disabled={busy || (!ordered && phase === 'idle' && (!choice.amountRaw || quote.status === 'error'))}
          onClick={() => void useSaver.getState().press()}
        >
          {action}
        </button>
      ) : (
        <Wallets words={words} />
      )}
    </section>
  );
}
