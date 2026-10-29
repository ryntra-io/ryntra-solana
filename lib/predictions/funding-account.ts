/**
 * The live money paths of the prediction account, on the server.
 *
 *   read     — the deposit address on Solana, the live balance, the recent
 *              deposits and Ryntra's own withdrawal records (the ones still
 *              moving are re-read from the provider).
 *   preview  — the fee and the amount delivered for one withdrawal into the
 *              person's own Solana wallet, priced now; creates nothing.
 *   withdraw — priced again just before the send: a quote that no longer
 *              delivers, or delivers noticeably less than the Review said,
 *              goes back to the person. Then the record is written *before*
 *              the send, under the browser's request id, and the provider is
 *              asked with that id. An answer that says nothing either way
 *              leaves the record `unknown` — it is never shown as sent, never
 *              as not sent — and the next check asks the same request again,
 *              which the provider answers with the original withdrawal if
 *              there was one.
 *
 * The destination is always the proven wallet: nothing here takes an
 * address from the browser. Every path stops at `FUNDING_OFF` unless the
 * deployment switched live money on (`fundingEnabled`); a deposit address
 * only for a wallet live money is open to (`liveWalletAllowed`). Server only.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { walletChain } from "./env.ts";
import { failure, type PredictionFailure } from "./failure.ts";
import {
  CUSTODY,
  DESTINATION_MISMATCH,
  SOLANA_BRIDGE_FEE_USD,
  SOLANA_CROSS_CHAIN_MIN_USD,
  USDC_DECIMALS,
  WITHDRAW_MIN_RAW,
  WITHDRAW_SEND_LEASE_MS,
  destinationMatches,
  fundingEnabled as moneyOn,
  isTerminal,
  rawToAmount,
  receiveDropped,
  type DepositRow,
  type DepositTarget,
  type LiveBalance,
  type ProviderWithdrawal,
  type WithdrawPreview,
  type WithdrawalPhase,
} from "./funding.ts";
import { liveWalletAllowed } from "./live.ts";
import type { PredictionProvider, Result } from "./provider.ts";
import { withProviderSession } from "./session.ts";

/** Ryntra's record of one withdrawal, written before the send. `refused` — the provider answered and created nothing. */
export type WithdrawalRecord = Readonly<{
  version: number;
  kind: "withdrawal";
  wallet: string;
  requestId: string;
  amountRaw: string;
  destinationAddress: string;
  destinationChainId: number;
  /** What the Review the person confirmed said would arrive, and its fee. */
  reviewedReceiveRaw: string;
  reviewedFeeRaw: string | null;
  phase: WithdrawalPhase | "refused";
  providerStatus: string | null;
  withdrawalId: string | null;
  completedRaw: string | null;
  txHashes: readonly string[];
  /** The provider's own words on a failed or partial withdrawal, or Ryntra's code for a refusal. */
  note: string | null;
  sends: number;
  /** While a send is out: another check reads the record and does not send. */
  sendingUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}>;

/** A withdrawal as the browser sees it. */
export type WithdrawalView = Readonly<{
  requestId: string;
  phase: WithdrawalRecord["phase"];
  amountUsd: number | null;
  reviewedReceiveUsd: number | null;
  reviewedFeeUsd: number | null;
  completedUsd: number | null;
  destinationAddress: string;
  txHashes: readonly string[];
  note: string | null;
  providerStatus: string | null;
  /**
   * Still unknown past the window in which it is asked again on its own:
   * nothing more is sent for it, it no longer holds a new withdrawal back, and
   * the person is told to look at the AGG account or ask support.
   */
  aged: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type FundingView = Readonly<{
  enabled: boolean;
  custody: typeof CUSTODY;
  /** Where every withdrawal goes: the wallet the person proved. */
  destination: string;
  limits: Readonly<{ withdrawMinUsd: number; crossChainMinUsd: number; bridgeFeeUsd: number }>;
  deposit: DepositTarget | Readonly<{ state: "off" }> | Readonly<{ state: "failed"; code: string }>;
  balance: LiveBalance | null;
  deposits: readonly DepositRow[];
  withdrawals: readonly WithdrawalView[];
  /** Set when the provider could not be read; the records are what the store holds. */
  providerFailure: PredictionFailure | null;
  readAt: string;
}>;

const KEY_PREFIX = "withdrawal:solana:mainnet:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** How long one send holds the record: longer than everything one send may wait on (`WITHDRAW_SEND_LEASE_MS`). */
const SEND_LEASE_MS = WITHDRAW_SEND_LEASE_MS;
/** A record still `sending` after this long lost its request (a timeout, a restart): it is treated as unknown and asked again. */
const SENDING_STALE_MS = SEND_LEASE_MS + 5_000;
/**
 * Past this age an unknown withdrawal is not asked again on its own, and no
 * longer holds a new one back. That the provider still answers the original
 * under its request id this long after is to be confirmed with AGG before
 * real funds go to people (the line's handoff, before people's money).
 */
const RESEND_WINDOW_MS = 6 * 3_600_000;

function records(store: GuardStore) {
  return store.versioned<WithdrawalRecord>("predictionOrders");
}

const keyOf = (wallet: string, requestId: string) => `${KEY_PREFIX}${wallet}:${requestId.toLowerCase()}`;

const usdOf = (raw: string | null) => (raw === null ? null : rawToAmount(raw, USDC_DECIMALS));

/** Unknown (or left sending) and older than the window in which it is asked again on its own. */
function isAged(r: WithdrawalRecord, nowMs: number): boolean {
  return (r.phase === "unknown" || r.phase === "sending") && nowMs - Date.parse(r.createdAt) >= RESEND_WINDOW_MS;
}

/** A record that holds a new withdrawal back: its state is not known yet, and it is still asked about. */
function holdsBack(r: WithdrawalRecord, nowMs: number): boolean {
  return (r.phase === "sending" || r.phase === "unknown") && !isAged(r, nowMs);
}

/**
 * The provider's withdrawal as a record patch. One that names another
 * destination than the proven wallet on Solana is kept with its id (so it is
 * never sent again) but stays unknown, with Ryntra's note — for good: a later
 * answer naming the wallet does not undo what the provider said once.
 */
function acceptedPatch(record: WithdrawalRecord, w: ProviderWithdrawal): Partial<WithdrawalRecord> {
  const ours = record.note !== DESTINATION_MISMATCH && destinationMatches(w, record.wallet, record.destinationChainId);
  return {
    phase: ours ? w.phase : "unknown",
    providerStatus: w.providerStatus,
    withdrawalId: w.withdrawalId,
    completedRaw: ours ? w.completedRaw : null,
    txHashes: w.txHashes.length > 0 ? w.txHashes : record.txHashes,
    note: ours ? w.errorMessage : DESTINATION_MISMATCH,
  };
}

export function withdrawalView(r: WithdrawalRecord, nowMs: number = Date.now()): WithdrawalView {
  return {
    requestId: r.requestId,
    phase: r.phase,
    amountUsd: usdOf(r.amountRaw),
    reviewedReceiveUsd: usdOf(r.reviewedReceiveRaw),
    reviewedFeeUsd: usdOf(r.reviewedFeeRaw),
    completedUsd: usdOf(r.completedRaw),
    destinationAddress: r.destinationAddress,
    txHashes: r.txHashes,
    note: r.note,
    providerStatus: r.providerStatus,
    aged: isAged(r, nowMs),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function solanaOnly(wallet: string): PredictionFailure | null {
  return walletChain(wallet) === "solana" ? null : failure("UNAUTHORIZED", "Prediction accounts are opened with a Solana wallet.");
}

async function listRecords(store: GuardStore, wallet: string): Promise<WithdrawalRecord[]> {
  const rows = await records(store).valuesWithPrefix(`${KEY_PREFIX}${wallet}:`);
  return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Replace a record with a bounded compare-and-set loop; null when the store would not take it. */
async function update(store: GuardStore, wallet: string, requestId: string, patch: (current: WithdrawalRecord) => Partial<WithdrawalRecord>, nowMs: number): Promise<WithdrawalRecord | null> {
  const collection = records(store);
  const key = keyOf(wallet, requestId);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await collection.get(key);
      if (!current) return null as never;
      const next: WithdrawalRecord = { ...current, ...patch(current), version: current.version + 1, updatedAt: new Date(nowMs).toISOString() };
      return (await collection.compareAndSet(key, current.version, next)) ? next : false;
    });
  } catch {
    return null;
  }
}

/** The Solana chain id and the deposit target, from the provider's own supported chains — never a number written here. */
async function solanaTarget(store: GuardStore, provider: PredictionProvider, wallet: string, env: NodeJS.ProcessEnv, nowMs: number): Promise<Result<Extract<DepositTarget, { state: "ready" }>>> {
  const target = await withProviderSession(store, provider, wallet, (session) => provider.depositTarget(session), env, nowMs);
  if (!target.ok) return target;
  if (target.value.state === "preparing") return failure("UNAVAILABLE", "The account's addresses are still being created; try again in a moment.");
  if (target.value.state === "unsupported") return failure("PROVIDER_UNAVAILABLE", "The provider does not list USDC on Solana for this app.");
  return { ok: true, value: target.value };
}

/* ------------------------------------------------------------------ read */

export async function readFunding(store: GuardStore, provider: PredictionProvider, wallet: string, env: NodeJS.ProcessEnv = process.env, nowMs: number = Date.now()): Promise<Result<FundingView>> {
  const refused = solanaOnly(wallet);
  if (refused) return refused;
  /*
   * New money comes in only from wallets live money is open to. A wallet that
   * already holds money here — taken off the list, or never on it — still
   * sees its balance and can take it out while money is switched on.
   */
  const open = liveWalletAllowed(wallet, env);
  let withdrawals = await listRecords(store, wallet);
  let enabled = open;
  if (!open && moneyOn(env)) {
    const held = await withProviderSession(store, provider, wallet, (session) => provider.liveBalance(session), env, nowMs);
    enabled = withdrawals.length > 0 || (held.ok && held.value.cashUsd + held.value.positionsUsd > 0);
  }
  const base = {
    enabled,
    custody: CUSTODY,
    destination: wallet,
    limits: { withdrawMinUsd: Number(WITHDRAW_MIN_RAW) / 10 ** USDC_DECIMALS, crossChainMinUsd: SOLANA_CROSS_CHAIN_MIN_USD, bridgeFeeUsd: SOLANA_BRIDGE_FEE_USD },
    readAt: new Date(nowMs).toISOString(),
  };
  if (!enabled) {
    return { ok: true, value: { ...base, deposit: { state: "off" }, balance: null, deposits: [], withdrawals: withdrawals.slice(0, 10).map((w) => withdrawalView(w, nowMs)), providerFailure: null } };
  }

  /* The ones still moving are re-read: at most three a view, the newest first. A read never sends: an unknown one is asked again only by its own check. */
  for (const open of withdrawals.filter((w) => w.withdrawalId && !isTerminal(w.phase as WithdrawalPhase) && w.phase !== "refused").slice(0, 3)) {
    await checkWithdrawal(store, provider, wallet, open.requestId, env, nowMs, { resend: false }).catch(() => null);
  }
  withdrawals = await listRecords(store, wallet);

  const target: Result<DepositTarget | Readonly<{ state: "off" }>> = open ? await withProviderSession(store, provider, wallet, (session) => provider.depositTarget(session), env, nowMs) : { ok: true, value: { state: "off" } };
  if (!target.ok && (target.code === "NOT_LINKED" || target.code === "SESSION_EXPIRED")) return target;
  const balance = await withProviderSession(store, provider, wallet, (session) => provider.liveBalance(session), env, nowMs);
  const deposits = await withProviderSession(store, provider, wallet, (session) => provider.deposits(session, 10), env, nowMs);
  const providerFailure = [target, balance, deposits].find((r): r is PredictionFailure => !r.ok) ?? null;
  return {
    ok: true,
    value: {
      ...base,
      deposit: target.ok ? target.value : { state: "failed", code: target.code },
      balance: balance.ok ? balance.value : null,
      deposits: deposits.ok ? deposits.value : [],
      withdrawals: withdrawals.slice(0, 10).map((w) => withdrawalView(w, nowMs)),
      providerFailure,
    },
  };
}

/* ------------------------------------------------------------------ preview */

export type PreviewInput = Readonly<{ amountRaw: string } | { max: true }>;

/** The withdrawal into the person's own Solana wallet, priced now. A request under one token is answered here, without the provider. */
export async function previewWithdrawal(store: GuardStore, provider: PredictionProvider, wallet: string, input: PreviewInput, env: NodeJS.ProcessEnv = process.env, nowMs: number = Date.now()): Promise<Result<WithdrawPreview>> {
  const refused = solanaOnly(wallet);
  if (refused) return refused;
  if (!moneyOn(env)) return failure("FUNDING_OFF", "Live money is not switched on here.");
  const target = await solanaTarget(store, provider, wallet, env, nowMs);
  if (!target.ok) return target;
  const chainId = target.value.chainId;
  let amountRaw: string;
  if ("max" in input) {
    const quote = await withProviderSession(store, provider, wallet, (session) => provider.withdrawable(session, chainId), env, nowMs);
    if (!quote.ok) return quote;
    amountRaw = quote.value.maxDeliverableRaw ?? "0";
  } else {
    amountRaw = input.amountRaw;
  }
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) < WITHDRAW_MIN_RAW) {
    return { ok: true, value: { status: "unviable", amountRaw, receiveRaw: null, feeRaw: null, expiresAt: null, maxDeliverableRaw: null, reason: "max" in input ? "insufficient" : "below_minimum", providerReason: null } };
  }
  return withProviderSession(store, provider, wallet, (session) => provider.withdrawPreview(session, { amountRaw, destinationAddress: wallet, destinationChainId: chainId }), env, nowMs);
}

/* ------------------------------------------------------------------ withdraw */

export type WithdrawInput = Readonly<{ requestId: string; amountRaw: string; reviewedReceiveRaw: string; reviewedFeeRaw: string | null }>;

export type WithdrawOutcome =
  /** Recorded and sent (or sent before under this id): the record says where it stands. */
  | Readonly<{ outcome: "recorded"; withdrawal: WithdrawalView }>
  /** Priced again just before the send, it no longer goes as reviewed: nothing was recorded or sent; the person reviews this. */
  | Readonly<{ outcome: "repriced"; preview: WithdrawPreview }>;

export async function submitWithdrawal(store: GuardStore, provider: PredictionProvider, wallet: string, input: WithdrawInput, env: NodeJS.ProcessEnv = process.env, nowMs: number = Date.now()): Promise<Result<WithdrawOutcome>> {
  const refused = solanaOnly(wallet);
  if (refused) return refused;
  if (!moneyOn(env)) return failure("FUNDING_OFF", "Live money is not switched on here.");
  if (!UUID.test(input.requestId)) return failure("VALIDATION_ERROR", "The request id is not a UUID.");
  if (!/^\d+$/.test(input.amountRaw) || BigInt(input.amountRaw) < WITHDRAW_MIN_RAW) return failure("VALIDATION_ERROR", "A withdrawal is at least one USDC.");
  if (!/^\d+$/.test(input.reviewedReceiveRaw) || BigInt(input.reviewedReceiveRaw) <= 0n) return failure("VALIDATION_ERROR", "The reviewed amount is missing.");

  const requestId = input.requestId.toLowerCase();
  const existing = await records(store).get(keyOf(wallet, requestId));
  if (existing) {
    /* The same confirmation sent twice (a double click, a lost answer): the one record answers it. */
    if (existing.amountRaw !== input.amountRaw) return failure("VALIDATION_ERROR", "This request id was used for another amount.");
    const checked = await checkWithdrawal(store, provider, wallet, requestId, env, nowMs);
    return checked.ok ? { ok: true, value: { outcome: "recorded", withdrawal: checked.value } } : checked;
  }
  /* An unknown one older than the window is no longer asked about on its own: it is shown for the person to look at, and does not hold this one back. */
  const open = (await listRecords(store, wallet)).find((r) => holdsBack(r, nowMs));
  if (open) return failure("WITHDRAWAL_OPEN", "A withdrawal whose state is not known yet stands; it is checked first.");

  const target = await solanaTarget(store, provider, wallet, env, nowMs);
  if (!target.ok) return target;
  const request = { amountRaw: input.amountRaw, destinationAddress: wallet, destinationChainId: target.value.chainId };
  const now = await withProviderSession(store, provider, wallet, (session) => provider.withdrawPreview(session, request), env, nowMs);
  if (!now.ok) return now;
  if (now.value.status !== "quoted" || receiveDropped(input.reviewedReceiveRaw, now.value.receiveRaw)) return { ok: true, value: { outcome: "repriced", preview: now.value } };

  const stamp = new Date(nowMs).toISOString();
  const record: WithdrawalRecord = {
    version: 1,
    kind: "withdrawal",
    wallet,
    requestId,
    ...request,
    reviewedReceiveRaw: input.reviewedReceiveRaw,
    reviewedFeeRaw: input.reviewedFeeRaw,
    phase: "sending",
    providerStatus: null,
    withdrawalId: null,
    completedRaw: null,
    txHashes: [],
    note: null,
    sends: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
  let created: boolean;
  try {
    created = await records(store).compareAndSet(keyOf(wallet, requestId), null, record);
  } catch {
    return failure("UNAVAILABLE", "The withdrawal could not be recorded; nothing was sent.");
  }
  if (!created) {
    const checked = await checkWithdrawal(store, provider, wallet, requestId, env, nowMs);
    return checked.ok ? { ok: true, value: { outcome: "recorded", withdrawal: checked.value } } : checked;
  }
  /* Two confirmations at once from two screens both passed the check above: each sees the other now, before anything is sent, and stands down. */
  const rivals = (await listRecords(store, wallet)).filter((r) => r.requestId !== requestId && !r.withdrawalId && holdsBack(r, nowMs));
  if (rivals.length > 0) {
    await update(store, wallet, requestId, () => ({ phase: "refused", note: "WITHDRAWAL_OPEN" }), nowMs);
    return failure("WITHDRAWAL_OPEN", "Another withdrawal was confirmed at the same moment; nothing was sent for this one.");
  }
  const sent = await send(store, provider, record, env, nowMs);
  return { ok: true, value: { outcome: "recorded", withdrawal: withdrawalView(sent, nowMs) } };
}

/**
 * Take the record for one send: refused when it already has the provider's
 * withdrawal, has ended, or another send holds it right now. The lease and
 * the count are written before the request leaves.
 */
async function claimSend(store: GuardStore, wallet: string, requestId: string, nowMs: number): Promise<Readonly<{ claimed: WithdrawalRecord } | { current: WithdrawalRecord | null }>> {
  const collection = records(store);
  const key = keyOf(wallet, requestId);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await collection.get(key);
      if (!current) return { current: null };
      if (current.withdrawalId || current.phase === "refused" || isTerminal(current.phase as WithdrawalPhase)) return { current };
      if (current.sendingUntil && Date.parse(current.sendingUntil) > nowMs) return { current };
      const next: WithdrawalRecord = { ...current, sends: current.sends + 1, sendingUntil: new Date(nowMs + SEND_LEASE_MS).toISOString(), version: current.version + 1, updatedAt: new Date(nowMs).toISOString() };
      return (await collection.compareAndSet(key, current.version, next)) ? { claimed: next } : false;
    });
  } catch {
    return { current: null };
  }
}

/** One send of a recorded withdrawal under its own request id; the record answers what it came to. */
async function send(store: GuardStore, provider: PredictionProvider, record: WithdrawalRecord, env: NodeJS.ProcessEnv, nowMs: number): Promise<WithdrawalRecord> {
  const { wallet, requestId } = record;
  const claim = await claimSend(store, wallet, requestId, nowMs);
  if (!("claimed" in claim)) return claim.current ?? record;
  const claimed = claim.claimed;
  /* A send before this one may have created the withdrawal: from then on, no refusal of a later send says anything about it. */
  const earlierSend = claimed.sends > 1;
  const result = await withProviderSession(
    store,
    provider,
    wallet,
    (session) => provider.withdraw(session, { requestId, amountRaw: record.amountRaw, destinationAddress: record.destinationAddress, destinationChainId: record.destinationChainId }),
    env,
    nowMs,
  ).catch(() => ({ ok: true as const, value: { outcome: "unknown" as const, reason: "threw" } }));
  let patch: Partial<WithdrawalRecord>;
  if (result.ok && result.value.outcome === "accepted") {
    patch = acceptedPatch(record, result.value.withdrawal);
  } else if (!earlierSend && !result.ok) {
    /* No session, or no provider configured: this first request never left. */
    patch = { phase: "refused", note: result.code };
  } else if (!earlierSend && result.ok && result.value.outcome === "refused") {
    patch = { phase: "refused", note: result.value.failure.code };
  } else {
    patch = { phase: "unknown" };
  }
  /* Never backwards: a record that already holds the provider's withdrawal, or has ended, keeps it whatever this send came to. */
  const written = await update(
    store,
    wallet,
    requestId,
    (current) => {
      const ended = isTerminal(current.phase as WithdrawalPhase);
      /* The provider's own withdrawal wins over anything short of an end — a refusal written by an older send included. */
      if (patch.withdrawalId) return ended ? { sendingUntil: null } : { ...patch, sendingUntil: null };
      if (ended || current.withdrawalId || current.phase === "refused") return { sendingUntil: null };
      /* A newer send went out meanwhile: this one's refusal says nothing about it. */
      if (patch.phase === "refused" && current.sends > claimed.sends) return { phase: "unknown", sendingUntil: null };
      return { ...patch, sendingUntil: null };
    },
    nowMs,
  );
  /* The store missed the answer: nothing durable says what happened, so the person is told it is unknown; the next check asks the same request again. */
  return written ?? { ...claimed, phase: "unknown", sendingUntil: null };
}

/**
 * Where one withdrawal stands now. Moving: the provider's status. Unknown, or
 * left `sending` by a request that never finished: the same request again
 * (the provider answers the original when there is one) — but only while
 * live money is on; switched off, the record waits as it is.
 */
export async function checkWithdrawal(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  requestId: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
  options: Readonly<{ resend: boolean }> = { resend: true },
): Promise<Result<WithdrawalView>> {
  const refused = solanaOnly(wallet);
  if (refused) return refused;
  const record = await records(store).get(keyOf(wallet, requestId.toLowerCase()));
  if (!record) return failure("NOT_FOUND", "No such withdrawal for this wallet.");
  if (record.phase === "refused" || isTerminal(record.phase)) return { ok: true, value: withdrawalView(record, nowMs) };

  if (record.withdrawalId) {
    const read = await withProviderSession(store, provider, wallet, (session) => provider.withdrawal(session, record.withdrawalId as string), env, nowMs);
    if (!read.ok) return { ok: true, value: withdrawalView(record, nowMs) };
    const next = await update(store, wallet, record.requestId, (current) => acceptedPatch(current, read.value), nowMs);
    return { ok: true, value: withdrawalView(next ?? record, nowMs) };
  }

  const stale = record.phase === "unknown" || nowMs - Date.parse(record.updatedAt) > SENDING_STALE_MS;
  /* Recorded and never taken for a send (the request that recorded it stopped first): nothing left, and nothing will on its own. */
  if (stale && record.sends === 0) {
    const closed = await update(store, wallet, record.requestId, (c) => (c.sends === 0 && !c.withdrawalId ? { phase: "refused", note: "NOT_SENT" } : {}), nowMs);
    return { ok: true, value: withdrawalView(closed ?? record, nowMs) };
  }
  /* Asked again on its own only for a while: an old unknown one waits for a person to look, never a late second withdrawal. */
  const young = nowMs - Date.parse(record.createdAt) < RESEND_WINDOW_MS;
  if (!stale || !young || !options.resend || !moneyOn(env)) return { ok: true, value: withdrawalView(record, nowMs) };
  return { ok: true, value: withdrawalView(await send(store, provider, record, env, nowMs), nowMs) };
}
