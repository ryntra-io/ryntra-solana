'use client';

import { useEffect, useMemo } from 'react';
import { RISK } from '@/city/lib/earn/flag';
import { DOLLAR_ASSETS, DOLLAR_MINT, dollarText, fieldText, rateText, yearAt } from '@/city/lib/earn/dollar';
import { DOLLAR_BUSY, dollarChoice, setDollarRefusals, useDollar } from '@/city/lib/earn/dollar-store';
import { useEarn } from '@/city/lib/earn/open';
import type { Words } from '@/city/lib/earn/words';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { BackGlyph, Coin, Line, Notify, RiskDots, Wallets } from './bits';
import s from './earn.module.css';

/**
 * The Dollar Saver (CITY-192): pick USDC or SOL, «Put in» or «Take back», type the amount, read the one line — the
 * rate, the minimum, Ryntra's 0 % and the risk — and tap once: the server builds it at Jupiter Lend, the wallet signs.
 * The position and what it earned stand at the top and in «Mine». Where the engine does not take actions for this
 * wallet the card stays a calm card with its live rate and «tell me when it opens».
 */
export function Dollar({ words }: { words: Words }) {
  const w = words.dollar;
  const asset = useDollar((st) => st.asset);
  const side = useDollar((st) => st.side);
  const typed = useDollar((st) => st.typed);
  const surface = useDollar((st) => st.surface);
  const phase = useDollar((st) => st.phase);
  const notice = useDollar((st) => st.notice);
  const done = useDollar((st) => st.done);
  const signature = useDollar((st) => st.signature);
  const connection = useWallet((st) => st.connection);
  const holdings = useWallet((st) => st.holdings);
  const owner = connection?.address ?? null;
  const busy = DOLLAR_BUSY.has(phase);

  useEffect(() => setDollarRefusals(() => w.refusals), [w]);
  useEffect(() => {
    void useDollar.getState().load(owner);
  }, [owner]);

  const choice = useMemo(() => dollarChoice({ asset, side, typed, surface }, holdings), [asset, side, typed, surface, holdings]);
  const { market, position, raw, problem, max } = choice;
  const ready = surface.status === 'ready';
  const acts = Boolean(choice.surface?.actions.open);
  const hasPosition = Boolean(position && (position.worthRaw ?? 1n) > 0n);
  const year = side === 'deposit' ? yearAt(raw, market?.rate ?? null) : null;

  if (phase === 'done' && done) {
    return (
      <section className={s.saver} aria-label={words.products.dollar.name}>
        <div className={`${s.result} ${s.resultGood}`} role="status">
          <span className={`${s.display} ${s.resultWord}`}>{done.side === 'deposit' ? w.doneIn : w.doneOut}</span>
          <p className={s.lead}>
            {dollarText(BigInt(done.amountRaw), done.asset)} {done.asset}
          </p>
          {done.partial ? <p className={s.fine}>{w.partialFine}</p> : <p className={s.fine}>{w.doneLine}</p>}
          {done.signature ? (
            <a className={s.link} href={explorerTxUrl('mainnet', done.signature)} target="_blank" rel="noreferrer">
              {w.explorer}
            </a>
          ) : null}
        </div>
        <div className={s.grow} />
        <div className={s.pair}>
          <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useEarn.getState().setTab('mine')}>
            {words.tabs.mine}
          </button>
          <button type="button" className={`${s.display} ${s.action}`} onClick={() => useDollar.getState().again()}>
            {w.again}
          </button>
        </div>
      </section>
    );
  }

  const label =
    phase === 'building' ? w.building : phase === 'wallet' ? w.wallet : phase === 'sending' ? w.sending : phase === 'checking' ? w.checking : side === 'deposit' ? w.put : w.take;

  return (
    <section className={s.saver} aria-label={words.products.dollar.name}>
      <button type="button" className={s.back} onClick={() => useEarn.getState().openProduct(null)} disabled={busy}>
        <BackGlyph />
        {words.back}
      </button>
      <div className={s.cardHead}>
        <h3 className={`${s.display} ${s.productName}`}>{words.products.dollar.name}</h3>
        <RiskDots dots={RISK.dollar} words={words} />
      </div>

      <div className={s.lsts} role="radiogroup" aria-label={w.amount}>
        {DOLLAR_ASSETS.map((a) => {
          const rate = choice.surface?.markets[a]?.rate ?? null;
          return (
            <button key={a} type="button" role="radio" aria-checked={asset === a} className={`${s.lst} ${asset === a ? s.lstOn : ''}`} onClick={() => useDollar.getState().setAsset(a)} disabled={busy}>
              <Coin mint={DOLLAR_MINT[a]} size={24} symbol={a} />
              <b>{a}</b>
              {rate !== null ? <span>{rateText(rate)}</span> : null}
            </button>
          );
        })}
      </div>

      <div className={s.context}>
        <span className={s.kicker}>
          {w.provider} · {w.rate}
        </span>
        {market?.rate != null ? (
          <b className={`${s.display} ${s.contextFigure}`}>{rateText(market.rate)}</b>
        ) : ready || surface.status === 'error' ? (
          <span className={s.fine}>{w.unavailable}</span>
        ) : (
          <span className={s.bones} aria-busy="true">
            <span />
          </span>
        )}
        <span className={s.contextUnit}>{asset}</span>
      </div>

      {owner && hasPosition && position ? (
        <div className={s.get}>
          <span className={s.kicker}>{w.inSaver}</span>
          <b>{position.worthRaw !== null ? `${dollarText(position.worthRaw, asset)} ${asset}` : '—'}</b>
          {position.earnedRaw !== null ? (
            <span className={position.earnedRaw > 0n ? s.gain : ''}>
              {w.earnedSoFar} +{dollarText(position.earnedRaw, asset)} {asset}
            </span>
          ) : null}
        </div>
      ) : null}

      {acts ? (
        <>
          {hasPosition ? (
            <div className={s.segment} role="radiogroup" aria-label={words.products.dollar.name}>
              {(['deposit', 'withdraw'] as const).map((id) => (
                <button key={id} type="button" role="radio" aria-checked={side === id} className={`${s.segmentButton} ${side === id ? s.segmentOn : ''}`} onClick={() => useDollar.getState().setSide(id)} disabled={busy}>
                  <b>{id === 'deposit' ? w.deposit : w.withdraw}</b>
                </button>
              ))}
            </div>
          ) : null}
          <label className={s.kicker} htmlFor="earn-dollar-amount">
            {w.amount}
          </label>
          <div className={s.field}>
            <input
              id="earn-dollar-amount"
              className={`${s.input} ${s.amount}`}
              inputMode="decimal"
              autoComplete="off"
              value={typed}
              onChange={(event) => useDollar.getState().setTyped(event.target.value)}
              disabled={busy}
              aria-invalid={Boolean(problem && typed)}
            />
            <span className={s.unit}>{asset}</span>
            {max !== null && max > 0n ? (
              <button type="button" className={s.inline} onClick={() => useDollar.getState().setTyped(fieldText(max, asset))} disabled={busy}>
                {w.max}
              </button>
            ) : null}
          </div>
          {year !== null && year > 0n ? (
            <div className={s.get}>
              <span className={s.gain}>
                {w.yearAtRate} +{dollarText(year, asset)} {asset}
              </span>
            </div>
          ) : null}
          {side === 'withdraw' && position?.availableRaw != null && position.worthRaw != null && position.availableRaw < position.worthRaw ? (
            <p className={s.fine}>
              {w.canLeave}: {dollarText(position.availableRaw, asset)} {asset}
            </p>
          ) : null}
        </>
      ) : null}

      <Line
        label={words.details}
        line={
          <>
            {w.noFee}
            {side === 'deposit' && market?.minimumRaw != null ? ` · ${w.minimum} ${dollarText(market.minimumRaw, asset)} ${asset}` : ''} · {w.risk}
          </>
        }
      >
        <p className={s.fine}>{w.riskWhat}</p>
        <p className={s.fine}>{w.rateFloats}</p>
        <p className={s.fine}>{w.partialFine}</p>
      </Line>

      {acts && problem && typed ? <p className={`${s.note} ${s.noteWarn}`}>{w.problem[problem]}</p> : null}
      {notice ? (
        <p className={`${s.note} ${notice.tone === 'error' ? s.noteError : notice.tone === 'warn' ? s.noteWarn : ''}`} role={notice.tone === 'info' ? 'status' : 'alert'}>
          {notice.text}{' '}
          {signature && (phase === 'failed' || phase === 'unknown') ? (
            <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
              {w.explorer}
            </a>
          ) : null}
        </p>
      ) : null}

      <div className={s.grow} />
      {!acts && ready && owner ? (
        <Notify product="dollar" words={words} />
      ) : !connection ? (
        <Wallets words={words} />
      ) : acts ? (
        <button
          type="button"
          className={`${s.display} ${s.action} ${s.cta} ${busy ? s.waiting : ''}`}
          disabled={busy || Boolean(problem) || raw === null}
          onClick={() => void useDollar.getState().press()}
        >
          {label}
        </button>
      ) : (
        <div className={s.bones} aria-busy="true">
          <span />
        </div>
      )}
    </section>
  );
}
