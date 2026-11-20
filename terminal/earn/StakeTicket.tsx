'use client';

import { useEffect, useMemo, useState } from 'react';
import { RISK } from '@/city/lib/earn/flag';
import { lamportsOf, lstOf, percentText, SOL_MINT, solText } from '@/city/lib/earn/lst';
import { entryCostPct, exitSpreadPct, lamportsFromText, saverLine } from '@/city/lib/earn/saver';
import { SAVER_BUSY, saverChoice, useSaver } from '@/city/lib/earn/saver-store';
import { useEarnData } from '@/city/lib/earn/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { Action, AmountField, Figure, Kick, Quiet } from '@/terminal/ui';
import { Facts, Note, OneLine, Result, RiskDots, TicketHead, iconOf } from './bits';
import { lineOf } from './PoolTicket';
import { useRefreshAfter } from './useReads';
import { EARN } from './words';
import e from './earn.module.css';

/** With a wallet, the exact order follows the price after this pause, once per amount. */
const AUTO_ORDER_MS = 450;

/**
 * Staking: SOL into a staked SOL coin in one signature — the city's own flow over the trade card's swap. Every figure
 * is that swap's (the quote, then the exact order the wallet signs) or the coin's worth read from its pool; nothing
 * here prices or builds anything of its own.
 */
export function StakeTicket({ onConnect }: { onConnect: () => void }) {
  const w = useWords(EARN);
  const lang = useLang();
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
  const row = feed.status === 'ready' ? (feed.value.lsts.find((entry) => entry.id === lst) ?? null) : null;
  const token = lstOf(lst)!;
  const choice = useMemo(() => saverChoice(lst, typed, holdings), [lst, typed, holdings]);
  const key = choice.key ? `${lst}:${choice.key}` : null;
  const busy = SAVER_BUSY.has(phase) || phase === 'preparing';
  // The screen's own order build, started while the person reads: an amount typed meanwhile lets it go. Any other build —
  // a press, which may go on to the wallet with rebuilt bytes — holds the field until it is over.
  const [building, setBuilding] = useState(false);
  const locked = SAVER_BUSY.has(phase) || (phase === 'preparing' && !building);
  useEffect(() => {
    if (phase !== 'preparing') setBuilding(false);
  }, [phase]);

  // A price for the amount on screen; a signature another screen left out is the swap's own to name.
  useEffect(() => {
    if (useSaver.getState().quote.status === 'none') void useSaver.getState().refreshQuote();
  }, [connection, lst]);
  // With a wallet, the exact order is built while the person reads the line.
  useEffect(() => {
    if (!connection || !key || quote.status !== 'ready' || quote.key !== key || review?.key === key || phase !== 'idle' || notice) return;
    const timer = setTimeout(() => {
      setBuilding(true);
      void useSaver.getState().prepare(true);
    }, AUTO_ORDER_MS);
    return () => clearTimeout(timer);
  }, [connection, key, quote, review, phase, notice]);
  useRefreshAfter(phase === 'done', connection?.address ?? null);

  const coins = [{ mint: token.mint, symbol: token.symbol }];
  const rate = row?.apyPct != null ? digits(percentText(row.apyPct), lang) : null;

  if (phase === 'done' && done) {
    const worth = done.lstRaw ? lamportsOf(BigInt(done.lstRaw), row?.rate ?? null) : null;
    const got = done.lstRaw ? `${digits(solText(BigInt(done.lstRaw)), lang)} ${token.symbol}` : token.symbol;
    return (
      <>
        <TicketHead coins={coins} name={token.symbol} sub={w.kindStake} figure={rate} figureCap={w.aYear} />
        <Result good word={w.doneStake} line={`${got}${worth !== null ? ` ${w.worth(digits(solText(worth), lang))}` : ''}. ${w.doneStakeLine}`} link={explorerTxUrl('mainnet', done.signature)} linkLabel={w.explorer} />
        <Quiet full onClick={() => useSaver.getState().again()}>
          {w.ok}
        </Quiet>
      </>
    );
  }

  const ordered = review && review.key === key ? review.order : null;
  const priced = ordered?.order ?? (quote.status === 'ready' && quote.key === key ? quote.body.order : null);
  const line = priced ? saverLine(priced, ordered ? 'order' : 'quote', row?.rate ?? null) : null;
  const inLamports = choice.amountRaw ? BigInt(choice.amountRaw) : lamportsFromText(typed);
  const outRaw = priced && /^\d+$/.test(priced.outAmountRaw) ? BigInt(priced.outAmountRaw) : null;
  const entry = inLamports && outRaw ? entryCostPct(inLamports, outRaw, row?.rate ?? null) : null;
  const back = exit && exit.key === key && exit.lamports && outRaw ? exitSpreadPct(outRaw, BigInt(exit.lamports), row?.rate ?? null) : null;
  const pct = (value: number | null) => (value === null ? null : digits(percentText(value), lang));
  const sol = holdings?.sol ? BigInt(holdings.sol.spendableRaw) : null;
  const problem = typed && choice.problem ? (choice.problem.kind === 'balance' ? w.pBalance : w.pFormat) : null;
  const label = phase === 'preparing' ? w.building : phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : phase === 'checking' || phase === 'unknown' ? w.checking : phase === 'failed' ? w.again : w.stakeAction;

  return (
    <>
      <TicketHead coins={coins} name={token.symbol} sub={w.kindStake} figure={rate} figureCap={w.aYear} />
      <fieldset className={e.form} disabled={locked}>
        <AmountField
          label={w.youPut}
          aside={sol !== null ? w.balance(digits(solText(sol), lang)) : undefined}
          // The amount is written as the rest of the site writes it — «0,1» in Ukrainian — and kept with a point,
          // as the ladder's field keeps it (`fieldText` / `fieldValue`): «1,234» is one SOL and a fraction, never a format error.
          value={fieldText(typed, lang)}
          onChange={(text) => {
            // The screen's own order build for the last amount is let go (nothing goes to the wallet from it); the new amount stands.
            if (building && useSaver.getState().phase === 'preparing') useSaver.setState({ phase: 'idle' });
            useSaver.getState().setTyped(fieldValue(text, lang));
          }}
          asset={{ symbol: 'SOL', icon: iconOf(SOL_MINT) }}
        />
      </fieldset>
      {line ? (
        <div className={e.get}>
          <span className={e.getCol}>
            <Kick>{w.youGet}</Kick>
            <Figure value={`≈ ${digits(line.expected, lang)}`} unit={token.symbol} size="m" />
          </span>
          {line.expectedLamports !== null ? <span className={e.cap}>{w.worth(digits(solText(line.expectedLamports), lang))}</span> : null}
        </div>
      ) : null}
      <div className={e.choiceHead}>
        <span className={e.riskRow}>
          <Kick>{w.risk}</Kick>
          <RiskDots dots={RISK.saver} label={w.riskOf(String(RISK.saver))} />
        </span>
      </div>
      <OneLine label={w.details} line={lineOf([line ? (line.fee ? w.stakeFee(digits(line.fee, lang)) : w.ryntraNone) : null, line ? `${w.dLeast.toLocaleLowerCase()} ${digits(line.minimum, lang)} ${token.symbol}` : '…'])}>
        <Facts
          rows={[
            [w.dLeast, line ? `${digits(line.minimum, lang)} ${token.symbol}` : null],
            [w.dNetwork, line?.networkSol ? `${digits(line.networkSol, lang)} SOL` : null],
            [w.dAccount, line?.rentSol ? `${digits(line.rentSol, lang)} SOL` : null],
            [w.dEntry, pct(entry)],
            [w.dExit, pct(back)],
            [w.dPoolShare, pct(row?.rewardsFeePct ?? null)],
            [w.dRoute, line?.route ?? null],
          ]}
        />
        <p>{w.stakeRisk}</p>
        <p>{w.stakingText}</p>
        <p>{w.keysText}</p>
      </OneLine>
      {problem ? <Note>{problem}</Note> : null}
      {notice ? <Note tone={notice.tone === 'info' ? 'plain' : notice.tone}>{notice.text}</Note> : null}
      {phase === 'failed' && failed ? (
        <Note tone="error">
          {w.failed}{' '}
          <a className={e.link} href={explorerTxUrl('mainnet', failed)} target="_blank" rel="noreferrer">
            {w.explorer}
          </a>
        </Note>
      ) : null}
      {phase === 'unknown' && unknown ? <Note>{w.unknown}</Note> : null}
      <Action
        onClick={() => {
          if (!connection) return onConnect();
          setBuilding(false);
          void useSaver.getState().press();
        }}
        busy={busy}
        disabled={busy || (connection !== null && !ordered && phase === 'idle' && (!choice.amountRaw || quote.status === 'error'))}
      >
        {connection ? label : w.connect}
      </Action>
    </>
  );
}
