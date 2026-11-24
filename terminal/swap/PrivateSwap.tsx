'use client';

import { useEffect, useState } from 'react';

import { digits, useWords } from '@/city/lib/i18n/dict';
import { formatUnits } from '@/city/lib/trade/format';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { DESK } from '@/lib/privacy/desk/config';
import type { Pair } from '@/lib/privacy/desk/quote';
import type { DeskStage } from '@/lib/privacy/desk/run';
import { deskCanCheck, useDeskSwap } from '@/lib/privacy/desk/useDesk';
import { bandActionOf, chooseWay, lineOfWay, ringPair } from '@/lib/privacy/desk/way';
import type { Stage } from '@/lib/privacy/swap/run';
import { usePrivateSwap, type CardOrder } from '@/lib/privacy/swap/useSwap';
import { PrivacyBand, Quiet } from '@/terminal/ui';
import { PRIVATE_SWAP } from './private-words';
import t from '@/terminal/coin/ticket.module.css';

type Words = (typeof PRIVATE_SWAP)['en'];
/** A coin as the card names it: its ticker and its decimals (null until the chain said). */
export type Unit = Readonly<{ symbol: string; decimals: number | null }>;

/** Seconds since a moment, ticking once a second while it stands. */
function useSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1_000));
}

/** The amber button's word while a private swap runs — by the route or at the desk. */
export function privateStageLabel(stage: Stage | 'returning' | DeskStage, seconds: number, w: Words): string {
  if (stage === 'proving') return w.proving(`${seconds} s`);
  return w[stage];
}

/** The form's amber button while a private swap runs: its word and its busy state; null word — the form's own. */
export function usePrivateButton(): Readonly<{ label: string | null; busy: boolean }> {
  const w = useWords(PRIVATE_SWAP);
  const routeStage = usePrivateSwap((st) => st.stage);
  const deskStage = useDeskSwap((st) => st.stage);
  const routeSince = usePrivateSwap((st) => st.since);
  const deskSince = useDeskSwap((st) => st.since);
  const seconds = useSeconds(routeSince ?? deskSince);
  const stage = routeStage ?? deskStage;
  return stage ? { label: privateStageLabel(stage, seconds, w), busy: true } : { label: null, busy: false };
}

const amountOf = (raw: bigint, unit: Unit | undefined) => (unit?.decimals == null ? raw.toString() : formatUnits(raw.toString(), unit.decimals, 'down'));

/** The line a refusal or a failure says — one, in the person's words. */
function lineOf(code: string, w: Words): string {
  if (code === 'ELSEWHERE') return w.soon;
  if (code === 'SAME') return w.same;
  if (code === 'ONE_PROMPT') return w.onePrompt;
  if (code === 'PAIR' || code === 'SIGNER') return w.pair;
  if (code === 'WALLET_REFUSED') return w.refused;
  if (code === 'WALLET_CHANGED_MESSAGE') return w.changed;
  if (code === 'GATE_PAUSED') return w.paused;
  if (code === 'GATE_FLAGGED' || code === 'GATE_FLAGGED_TO' || code === 'GATE_BACK_ONLY') return w.flagged;
  if (code === 'GATE_UNCHECKED') return w.unchecked;
  if (code === 'NOT_REGISTERED') return w.noBalance;
  return w.failed;
}

/**
 * The desk's line: its own codes (`useDesk.ts` — each said before the wallet signs, so nothing moved), else the private
 * balance's own (the gate, the wallet, the network).
 */
function deskLineOf(code: string, w: Words): string {
  if (code === 'DESK_EXPIRED') return w.expired;
  if (code === 'DESK_NOT_NOW') return w.pair;
  if (code.startsWith('DESK_')) return w.deskFailed;
  return lineOf(code, w);
}

/**
 * The private part of the Swap's form, above its one amber button, when «Private» is on. The way is `way.ts`'s: at the
 * private desk when the desk quotes this pair and its leg can be checked before the wallet signs, else by
 * the market route — today always the route: there is no desk yet.
 */
export function PrivateSwapPart({ units, pair }: { units: ReadonlyMap<string, Unit>; pair: Pair }) {
  const way = chooseWay({ desk: DESK, pair, canCheck: deskCanCheck() });
  return way.way === 'desk' ? <DeskSwapPart units={units} /> : <RouteSwapPart units={units} />;
}

/** A coin's unit by any of SOL's names: the card says wrapped SOL, the ring says the system program. */
const unitOf = (units: ReadonlyMap<string, Unit>, mint: string): Unit | undefined => {
  const ring = (m: string) => ringPair({ inMint: m, outMint: m }).inMint;
  return units.get(mint) ?? [...units].find(([m]) => ring(m) === ring(mint))?.[1];
};

/**
 * At the private desk: the band of the swap (both addresses seen, the coins and the amounts hidden — `exposure.ts`'s
 * `swap`), its one line, and how the last swap ended. One transaction, whole or not at all: nothing to read back.
 */
function DeskSwapPart({ units }: { units: ReadonlyMap<string, Unit> }) {
  const w = useWords(PRIVATE_SWAP);
  const failure = useDeskSwap((st) => st.failure);
  const done = useDeskSwap((st) => st.done);
  const expired = failure?.code === 'DESK_EXPIRED';
  const line: Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }> | null = done
    ? { tone: 'info', text: w.done(unitOf(units, done.outMint)?.symbol ?? '') }
    : failure
      ? { tone: expired ? 'warn' : 'error', text: deskLineOf(failure.code, w) }
      : null;
  return (
    <>
      <PrivacyBand action={bandActionOf('desk')} />
      <p className={t.note} data-tone="info">
        {w[lineOfWay('desk')]}
      </p>
      {line ? (
        <p className={t.note} data-tone={line.tone} role={line.tone === 'error' ? 'alert' : 'status'}>
          {line.text}
        </p>
      ) : null}
    </>
  );
}

/**
 * By the market route: the band «what others see»
 * for a swap by a market route (all four seen — the trade is on chain) with its one line that the rest of the balance
 * stays hidden and the coin bought goes back into it; then where the coins are after the swap, from the chain, and —
 * only when a break left them on the person's own wallet — one quiet «Return to private balance». The button itself is
 * the form's own; its words while the swap runs come from `privateStageLabel`.
 */
function RouteSwapPart({ units }: { units: ReadonlyMap<string, Unit> }) {
  const w = useWords(PRIVATE_SWAP);
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const stage = usePrivateSwap((st) => st.stage);
  const path = usePrivateSwap((st) => st.path);
  const where = usePrivateSwap((st) => st.where);
  const failure = usePrivateSwap((st) => st.failure);
  const returned = usePrivateSwap((st) => st.returned);
  const outMint = usePrivateSwap((st) => st.outMint);
  const out = outMint ? units.get(outMint) : undefined;

  // A swap this browser left half way is read from the chain again when its wallet is here.
  useEffect(() => {
    if (owner) void usePrivateSwap.getState().reread(owner);
  }, [owner]);
  // Still landing: the chain is read again shortly — the button never says «done» before it is.
  useEffect(() => {
    if (!owner || where?.place !== 'landing') return;
    const timer = setTimeout(() => void usePrivateSwap.getState().reread(owner), 4_000);
    return () => clearTimeout(timer);
  }, [owner, where]);

  let line: Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }> | null = null;
  if (path?.kind === 'refuse') line = { tone: path.code === 'ELSEWHERE' ? 'info' : 'warn', text: lineOf(path.code, w) };
  else if (where?.place === 'wallet') line = { tone: 'warn', text: digits(w.inWallet(amountOf(where.amount, units.get(where.mint)), units.get(where.mint)?.symbol ?? '')) };
  else if (where?.place === 'landing') line = { tone: 'info', text: w.landing };
  else if (where?.place === 'private' && where.done) line = { tone: 'info', text: w.done(out?.symbol ?? '') };
  else if (where?.place === 'private') line = { tone: 'info', text: w.nothing };
  else if (returned) line = { tone: 'info', text: w.returned };
  if (failure && !line) line = { tone: 'error', text: lineOf(failure.code, w) };

  return (
    <>
      <PrivacyBand action="routeSwap" />
      <p className={t.note} data-tone="info">
        {w.seen}
      </p>
      {line ? (
        <p className={t.note} data-tone={line.tone} role={line.tone === 'error' ? 'alert' : 'status'}>
          {line.text}
        </p>
      ) : null}
      {where?.place === 'private' && where.done && where.surplus > 0n ? (
        <p className={t.note} data-tone="info">
          {digits(w.surplus(amountOf(where.surplus, out), out?.symbol ?? ''))}
        </p>
      ) : null}
      {where?.place === 'wallet' && connection ? (
        <Quiet full disabled={stage !== null} onClick={() => void usePrivateSwap.getState().giveBack(connection.wallet, connection.address)}>
          {w.giveBack}
        </Quiet>
      ) : null}
    </>
  );
}

/** The network the swap's card builds its orders for: Jupiter's routes are on Solana's main network. */
const CARD_CHAIN = 'solana:mainnet';

/** Starts a private swap of the card's exact order with the connected wallet — at the desk when `way.ts` chose it. */
export function startPrivateSwap(order: CardOrder, wallet: string, owner: string): void {
  const pair = ringPair({ inMint: order.inputMint, outMint: order.outputMint });
  if (chooseWay({ desk: DESK, pair, canCheck: deskCanCheck() }).way === 'desk') {
    return void useDeskSwap.getState().start({ owner, ...pair, inRaw: BigInt(order.inAmountRaw) }, wallet);
  }
  // After the proof, the card's freshest exact order (it renews its bytes while the person waits).
  void usePrivateSwap.getState().start(order, CARD_CHAIN, wallet, owner, () => useTrade.getState().review?.order.order ?? null);
}
