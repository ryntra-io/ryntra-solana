'use client';

import { useEffect, useMemo } from 'react';
import { DOLLAR_MINT, dollarText, rateText, type DollarAsset, type DollarSide } from '@/city/lib/earn/dollar';
import { DOLLAR_BUSY, dollarChoice, setDollarRefusals, useDollar } from '@/city/lib/earn/dollar-store';
import { RISK } from '@/city/lib/earn/flag';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { Action, AmountField, Figure, Kick, Quiet, Segment } from '@/terminal/ui';
import { Note, OneLine, Result, RiskDots, TicketHead, iconOf } from './bits';
import { useRefreshAfter } from './useReads';
import { EARN, LEND_REFUSALS } from './words';
import e from './earn.module.css';

const PROBLEM = { zero: 'pFormat', balance: 'pBalance', position: 'pPosition', liquidity: 'pLiquidity', canary: 'fCeiling' } as const;

/**
 * Lending: one coin, «put in» or «take back», one amount, one tap — the city's own flow over the lending market's
 * routes: the server builds the transaction and seals it, the wallet signs it, the server checks the market again and
 * sends those bytes once. The rate is the market's own; Ryntra takes nothing.
 */
export function LendTicket({ onConnect }: { onConnect: () => void }) {
  const w = useWords(EARN);
  const refusals = useWords(LEND_REFUSALS);
  const lang = useLang();
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

  // The market's refusals are said in this screen's words while it is in front.
  useEffect(() => setDollarRefusals(() => refusals), [refusals]);
  // Nothing left in lending — taken back in full — the ticket is on «put in» again: there is nothing to take.
  // A position the chain did not answer on (its worth unknown) is still a position: only none, or none left, is empty.
  const lent = surface.status === 'ready' && surface.value.owner === owner ? surface.value.positions[asset] : undefined;
  const empty = surface.status === 'ready' && surface.value.owner === owner && (!lent || lent.worthRaw === 0n);
  useEffect(() => {
    if (empty && side === 'withdraw' && useDollar.getState().phase === 'idle') useDollar.getState().setSide('deposit');
  }, [empty, side]);
  useRefreshAfter(phase === 'done', owner);

  const choice = useMemo(() => dollarChoice({ asset, side, typed, surface }, holdings), [asset, side, typed, surface, holdings]);
  const { market, position, raw, problem, max } = choice;
  const text = (amount: bigint, coin: DollarAsset = asset) => `${digits(dollarText(amount, coin), lang)} ${coin}`;
  const coins = [{ mint: DOLLAR_MINT[asset], symbol: asset }];
  const rate = market?.rate != null ? digits(rateText(market.rate), lang) : null;
  const acts = Boolean(choice.surface?.actions.open);
  const hasPosition = Boolean(position && (position.worthRaw ?? 1n) > 0n);

  if (phase === 'done' && done) {
    return (
      <>
        <TicketHead coins={[{ mint: DOLLAR_MINT[done.asset], symbol: done.asset }]} name={done.asset} sub={w.kindLend} figure={rate} figureCap={w.aYear} />
        <Result good word={done.side === 'deposit' ? w.doneLendIn : w.doneLendOut} line={text(BigInt(done.amountRaw), done.asset)} link={done.signature ? explorerTxUrl('mainnet', done.signature) : null} linkLabel={w.explorer} />
        <Quiet full onClick={() => useDollar.getState().again()}>
          {w.ok}
        </Quiet>
      </>
    );
  }

  const label = phase === 'building' ? w.building : phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : phase === 'checking' ? w.checking : side === 'deposit' ? w.lendPut : w.lendTake;
  const problemText = !typed || !problem ? null : problem === 'minimum' ? (market?.minimumRaw != null ? w.pMin(text(market.minimumRaw)) : w.pFormat) : w[PROBLEM[problem]];
  const closed = connection !== null && surface.status === 'ready' && surface.value.owner === owner && !acts;

  return (
    <>
      <TicketHead coins={coins} name={asset} sub={w.kindLend} figure={rate} figureCap={w.aYear} />
      <fieldset className={e.form} disabled={busy}>
      {hasPosition ? (
        <Segment<DollarSide>
          label={w.lendSide}
          value={side}
          onChange={(id) => useDollar.getState().setSide(id)}
          items={[
            { id: 'deposit', label: w.lendPut },
            { id: 'withdraw', label: w.lendTake },
          ]}
        />
      ) : null}
      <AmountField
        label={side === 'deposit' ? w.youPut : w.youTake}
        aside={side === 'deposit' && max !== null ? w.balance(digits(dollarText(max, asset), lang)) : undefined}
        value={typed}
        onChange={(value) => useDollar.getState().setTyped(value)}
        asset={{ symbol: asset, icon: iconOf(DOLLAR_MINT[asset]) }}
      />
      </fieldset>
      {hasPosition && position ? (
        <div className={e.get}>
          <span className={e.getCol}>
            <Kick>{w.inLending}</Kick>
            <Figure value={position.worthRaw !== null ? digits(dollarText(position.worthRaw, asset), lang) : '—'} unit={asset} size="m" />
          </span>
          {position.earnedRaw !== null ? (
            <span className={e.getCol}>
              <Kick>{w.earned}</Kick>
              <Figure value={`+${digits(dollarText(position.earnedRaw, asset), lang)}`} size="s" tone={position.earnedRaw > 0n ? 'up' : undefined} />
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={e.choiceHead}>
        <span className={e.riskRow}>
          <Kick>{w.risk}</Kick>
          <RiskDots dots={RISK.dollar} label={w.riskOf(String(RISK.dollar))} />
        </span>
      </div>
      <OneLine label={w.details} line={side === 'deposit' && market?.minimumRaw != null ? w.lendLine(text(market.minimumRaw)) : w.lendNone}>
        {side === 'withdraw' && position?.availableRaw != null && position.worthRaw != null && position.availableRaw < position.worthRaw ? <p>{w.canLeave(text(position.availableRaw))}</p> : null}
        <p>{w.lendingText}</p>
        <p>{w.lendRisk}</p>
        <p>{w.keysText}</p>
      </OneLine>
      {problemText ? <Note>{problemText}</Note> : null}
      {closed ? <Note>{w.lendClosed}</Note> : null}
      {notice ? (
        <Note tone={notice.tone === 'info' ? 'plain' : notice.tone}>
          {notice.text}{' '}
          {signature && (phase === 'failed' || phase === 'unknown') ? (
            <a className={e.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
              {w.explorer}
            </a>
          ) : null}
        </Note>
      ) : null}
      <Action
        onClick={() => {
          if (!connection) return onConnect();
          void useDollar.getState().press();
        }}
        busy={busy}
        disabled={busy || (connection !== null && (!acts || Boolean(problem) || raw === null))}
      >
        {connection ? label : w.connect}
      </Action>
    </>
  );
}
