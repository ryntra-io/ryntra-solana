'use client';

import { solText } from '@/city/lib/earn/lst';
import { useEarn } from '@/city/lib/earn/open';
import { useMoneyStore } from '@/city/lib/money/store';
import type { Words } from '@/city/lib/earn/words';
import { DOLLAR_MINT, dollarText } from '@/city/lib/earn/dollar';
import { CityFrame, Coin, Line, SolFigure, Wallets } from './bits';
import type { MineFigures } from './useMine';
import s from './earn.module.css';

function units(value: number): string {
  if (!(Math.abs(value) > 0)) return '0';
  const abs = Math.abs(value);
  return value.toLocaleString('en-US', { maximumFractionDigits: abs >= 100 ? 2 : abs >= 1 ? 4 : 6 });
}

/**
 * «Mine»: what the wallet holds in Earn, read only — staked SOL valued in SOL with what it earned since it went in
 * through Earn, the piers with their status and SOL-2b's result, and each stock's dividend line read from its
 * multiplier (a split is never a dividend). No wallet: one way to connect. Nothing yet: where to start.
 */
export function Mine({ words, owner, mine }: { words: Words; owner: string | null; mine: MineFigures }) {
  const w = words.mine;
  if (!owner) {
    return (
      <section className={s.emptyState} aria-label={words.tabs.mine}>
        <CityFrame district="harbor" />
        <h3 className={`${s.display} ${s.productName}`}>{w.connectTitle}</h3>
        <p className={s.lead}>{w.connectLine}</p>
        <div className={s.grow} />
        <Wallets words={words} />
      </section>
    );
  }
  if (!mine.ready) {
    return mine.failed ? (
      <section className={s.tabBody}>
        <p className={s.empty}>{words.unavailable}</p>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoneyStore.getState().readWallet()}>
          {words.tryAgain}
        </button>
      </section>
    ) : (
      <div className={s.bones} aria-busy="true">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (mine.empty) {
    return (
      <section className={s.emptyState} aria-label={words.tabs.mine}>
        <CityFrame district="home" />
        <h3 className={`${s.display} ${s.productName}`}>{w.emptyTitle}</h3>
        <p className={s.lead}>{w.emptyLine}</p>
        <div className={s.grow} />
        <button type="button" className={`${s.display} ${s.action}`} onClick={() => useEarn.getState().openProduct('saver')}>
          {w.start}
        </button>
      </section>
    );
  }
  return (
    <section className={s.tabBody} aria-label={words.tabs.mine}>
      {mine.dollars.length ? (
        <>
          <h4 className={s.label}>{w.dollars}</h4>
          <ul className={s.rows}>
            {mine.dollars.map((row) => (
              <li key={row.asset} className={`${s.row} ${s.rowLink}`}>
                <button type="button" className={s.cardHit} onClick={() => useEarn.getState().openProduct('dollar')} aria-label={`${w.dollars} · ${row.asset}`} />
                <Coin mint={DOLLAR_MINT[row.asset]} symbol={row.asset} />
                <span className={s.names}>
                  <b>{row.asset}</b>
                  <span>{row.worthRaw !== null ? `${dollarText(row.worthRaw, row.asset)} ${row.asset}` : words.notMeasured}</span>
                </span>
                <span className={s.figures}>
                  {row.earnedRaw !== null ? (
                    <b className={`${s.figure} ${row.earnedRaw > 0n ? s.gain : ''} ${s.rowFigure}`}>
                      +{dollarText(row.earnedRaw, row.asset)}
                      <small> {row.asset}</small>
                    </b>
                  ) : (
                    <b className={`${s.figure} ${s.rowFigure} ${s.dim}`}>—</b>
                  )}
                  <span>{row.earnedRaw !== null ? words.dollar.earnedSoFar : words.notMeasured}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {mine.lsts.length ? (
        <>
          <h4 className={s.label}>{w.lsts}</h4>
          <ul className={s.rows}>
            {mine.lsts.map((row) => (
              <li key={row.id} className={s.row}>
                <Coin mint={row.mint} />
                <span className={s.names}>
                  <b>{row.symbol}</b>
                  <span>{row.lamports !== null ? `≈ ${solText(row.lamports)} SOL` : `${solText(row.raw)} ${row.symbol}`}</span>
                </span>
                <span className={s.figures}>
                  <SolFigure lamports={row.tracked ? row.tracked.worth - row.tracked.paid : null} className={`${s.rowFigure} ${row.tracked ? '' : s.dim}`} />
                  <span>{row.tracked ? words.earned : words.notMeasured}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {mine.piers.length ? (
        <>
          <h4 className={s.label}>{w.piers}</h4>
          <ul className={s.rows}>
            {mine.piers.map((row) => (
              <li key={row.address} className={s.row}>
                <span className={`${s.status} ${row.status === 'in-range' ? s.statusOn : ''}`} aria-hidden="true" />
                <span className={s.names}>
                  <b>{row.pair}</b>
                  <span>{row.status === 'in-range' ? w.inRange : row.status === 'filled' ? w.filled : w.outOfRange}</span>
                </span>
                <span className={s.figures}>
                  <SolFigure lamports={row.vsHoldLamports} className={`${s.rowFigure} ${row.vsHoldLamports === null ? s.dim : ''}`} />
                  <span>{row.vsHoldLamports === null ? words.notMeasured : words.vsHold}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {mine.stocks.length ? (
        <>
          <h4 className={s.label}>{w.stocks}</h4>
          <ul className={s.rows}>
            {mine.stocks.map((row) => (
              <li key={row.mint} className={s.row}>
                <Coin mint={row.mint} />
                <span className={s.names}>
                  <b>{row.symbol}</b>
                  <span>
                    {units(row.units)} {row.symbol}
                    {row.splitSeen ? ` · ${w.split}` : ''}
                  </span>
                </span>
                <span className={s.figures}>
                  {row.line.dividends ? (
                    <b className={`${s.figure} ${s.gain} ${s.rowFigure}`}>
                      +{units(row.line.units)}
                      <small> {row.symbol}</small>
                    </b>
                  ) : (
                    <b className={`${s.figure} ${s.rowFigure} ${s.dim}`}>—</b>
                  )}
                  <span>{row.line.dividends ? w.dividends : w.dividendsNone}</span>
                </span>
              </li>
            ))}
          </ul>
          <Line label={words.details} line={w.dividends}>
            <p className={s.fine}>{w.dividendFine}</p>
          </Line>
        </>
      ) : null}
    </section>
  );
}
