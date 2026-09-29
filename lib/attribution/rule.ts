/**
 * The attribution rule — which fact makes an operation Ryntra's, exactly once.
 *
 * `RYN-ATTRIBUTION-DUNE-001`. Pure and client-safe: no clock, no network, no
 * `process.env`. Everything that counts is a projection over chain facts the
 * public can read for themselves, and the rule is written here once so the
 * public statistics page, the Dune queries and the tests all say the same thing.
 *
 * ## The rule, in one sentence
 *
 * A Solana transaction is a Ryntra operation **iff it credited a token account
 * whose authority is Ryntra's Jupiter referral account** — the person paid the
 * Ryntra service fee inside that transaction — **and the credit is not the
 * whole of what the signer moved**: a plain transfer into the referral account
 * moves one asset one way and is a deposit, not a trade (rule 1.1.0). It is
 * counted **once, by its signature**, whatever the client that started it,
 * whatever the router the provider chose, and however many pools the route
 * crossed.
 *
 * Why this fact and not another:
 *
 * - Ryntra owns no AMM and no fee contract. The only thing on chain that is
 *   Ryntra's is the referral account Jupiter's referral program initialised for
 *   it, and the token accounts that account owns. A fee that arrived there is a
 *   fee a person paid for a swap Ryntra asked Jupiter to route — nothing else
 *   puts money in those accounts.
 * - The referral token account is a plain associated token account whose owner
 *   is the referral account (verified on chain 2026-09-10), so the credit is an
 *   ordinary owner-scoped token movement, readable from the transaction's own
 *   `preTokenBalances` / `postTokenBalances` with no program-specific parsing.
 * - The router is **not** part of the rule. Jupiter's Swap API routes through
 *   its own program and, for some orders, through a partner aggregator; the
 *   referral credit lands either way. A rule keyed on the program id would
 *   silently drop real operations (one was seen live on 2026-09-11).
 * - Spot and Swap run the same engine — one `/order`, one signature — so **on
 *   chain they are one figure**. The Spot / Swap split exists only in Ryntra's
 *   own records (`origin` on the action row) and is labelled as such wherever
 *   it is shown. Nothing here pretends to read it off the chain.
 *
 * ## What is not on chain
 *
 * - **Bridge through Relay** charges the app fee inside Relay's quote and
 *   accrues it in an off-chain balance at Relay. The chain shows a transfer
 *   like any other; the attribution lives in Relay's request record and in
 *   Ryntra's own receipt. Counted from records, keyed by the provider request
 *   id, and never presented as a chain-proven figure.
 * - **USDC via Circle CCTP** carries no fee mechanism at all and is not
 *   attributable on chain by any fact. Records only.
 * - **Mayan** is not configured; nothing accrues and nothing is counted.
 *
 * ## Who the taker is
 *
 * The taker is the signer whose own token balances moved — read from the
 * movement, never from signer order alone. The fee payer signs first, and on
 * a wallet that pays its own fee that is the trader; where another account
 * pays the fee (a sponsor, a venue's gasless lane), the trader is the later
 * signer whose tokens moved. When no signer's tokens moved at all the fee
 * payer is named, with no legs and no value. What the balances cannot settle
 * is a transaction in which two signers both move tokens; the taker is then
 * the first of them, and the methodology says so.
 *
 * ## Once and only once
 *
 * The operation key is the signature for the chain path and the provider
 * request id for the record path. A web client and the native client executing
 * the same operation produce one signature — the one-submitter protocol of the
 * canon: either the app signs and the server executes, or the wallet
 * signs-and-sends and the server adopts that signature, never both — so the
 * key is the same and the operation is one row. A transaction that touches two
 * referral token accounts (the day both were created) is one signature and one
 * row. A route across four pools is one signature and one row.
 *
 * ## The historical boundary
 *
 * Before the first credit to a referral-owned token account nothing is provable
 * on chain: earlier swaps carried no referral fee and are indistinguishable from
 * anyone else's. The boundary is therefore **a chain fact, not a date written
 * here** — the earliest attributable signature the reader finds — and every
 * figure is stated "since" it. Operations before it exist only in Ryntra's own
 * receipts and are never added to the chain-proven figures.
 *
 * ## Value
 *
 * Volume is executed value at par: the person's own stablecoin leg — what left
 * or arrived in their wallet — and nothing else, the same rule the Owner's
 * dashboard and the Points ledger use (`lib/solana/action-value.ts`). An
 * operation with no stablecoin leg is counted as an operation and reported
 * *unvalued*; it is never priced here, because a price read later is an
 * estimate and a fact is not.
 */

import { ACTION_PAR_MINTS, parUsdMicros } from "../solana/action-value.ts";

export const ATTRIBUTION_RULE_VERSION = "1.1.0";

/** How an operation can be attributed, and how far the proof reaches. */
export type AttributionPath =
  /** Chain-proven: a credit to a referral-owned token account in the transaction. */
  | "JUPITER_REFERRAL_ONCHAIN"
  /** Records only: Relay's request record with Ryntra's app-fee recipient. */
  | "RELAY_APP_FEE_RECORD"
  /** Records only, and no fee at all: the direct Circle lane has no mechanism. */
  | "CCTP_RECORD_ONLY";

export const ATTRIBUTION_PATHS: readonly AttributionPath[] = ["JUPITER_REFERRAL_ONCHAIN", "RELAY_APP_FEE_RECORD", "CCTP_RECORD_ONLY"];

/** One key per operation, whichever client started it. */
export function operationKey(path: AttributionPath, reference: string): string {
  return path === "JUPITER_REFERRAL_ONCHAIN" ? `solana:${reference}` : path === "RELAY_APP_FEE_RECORD" ? `relay:${reference}` : `cctp:${reference}`;
}

/** One entry of `preTokenBalances` / `postTokenBalances`, as the RPC states it. */
export type TokenBalanceEntry = Readonly<{
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: Readonly<{ amount: string; decimals: number }>;
}>;

export type MintDelta = Readonly<{ mint: string; decimals: number; deltaRaw: bigint }>;

export type AttributionTransactionInput = Readonly<{
  signature: string;
  slot: number;
  /** Unix seconds, as the RPC states it; null when the block time is unknown. */
  blockTime: number | null;
  /** `meta.err !== null`. A failed transaction moved nothing and is never an operation. */
  failed: boolean;
  /** The signing account keys in message order; the first is the fee payer. */
  signers: readonly string[];
  preTokenBalances: readonly TokenBalanceEntry[];
  postTokenBalances: readonly TokenBalanceEntry[];
}>;

export type AttributedOperation = Readonly<{
  key: string;
  path: "JUPITER_REFERRAL_ONCHAIN";
  signature: string;
  slot: number;
  blockTime: number | null;
  /** The wallet that signed — the person whose operation it is. */
  taker: string;
  /** What reached the referral-owned token accounts, per mint. Every entry is positive. */
  feeCredits: readonly MintDelta[];
  /** The taker's own owner-scoped movements, per mint. */
  legs: readonly MintDelta[];
  /** Executed value at par in USD micro-units, or null when no leg is a stablecoin. */
  valueUsdMicros: bigint | null;
}>;

export type AttributionVerdict =
  | Readonly<{ attributable: true; operation: AttributedOperation; referralDeltas: readonly MintDelta[] }>
  | Readonly<{
      attributable: false;
      signature: string;
      reason: "FAILED_TRANSACTION" | "NO_REFERRAL_CREDIT" | "NO_SIGNER" | "TRANSFER_TO_REFERRAL";
      /** Every referral-owned movement in the transaction, credits and debits alike, so a claim is visible. */
      referralDeltas: readonly MintDelta[];
    }>;

/**
 * Net movement per mint for one owner, from a transaction's token balances.
 *
 * Owner-scoped rather than account-scoped on purpose: a wrapped-SOL account is
 * created and closed inside a swap, so it appears on one side only, and a token
 * account can be replaced by another for the same mint. Summing by owner and
 * mint is what makes "what did this wallet pay and receive" a single number.
 */
export function ownerMintDeltas(
  owner: string,
  pre: readonly TokenBalanceEntry[],
  post: readonly TokenBalanceEntry[],
): readonly MintDelta[] {
  const totals = new Map<string, { decimals: number; delta: bigint }>();
  const add = (entry: TokenBalanceEntry, sign: 1n | -1n) => {
    if (entry.owner !== owner) return;
    if (!/^[0-9]+$/.test(entry.uiTokenAmount.amount)) return;
    const current = totals.get(entry.mint) ?? { decimals: entry.uiTokenAmount.decimals, delta: 0n };
    current.delta += sign * BigInt(entry.uiTokenAmount.amount);
    totals.set(entry.mint, current);
  };
  for (const entry of pre) add(entry, -1n);
  for (const entry of post) add(entry, 1n);
  return [...totals.entries()]
    .filter(([, value]) => value.delta !== 0n)
    .map(([mint, value]) => ({ mint, decimals: value.decimals, deltaRaw: value.delta }))
    .sort((left, right) => (left.mint < right.mint ? -1 : left.mint > right.mint ? 1 : 0));
}

/**
 * Executed value at par from a taker's legs.
 *
 * The stablecoin the person **paid** is preferred when both sides are
 * stablecoins, because the fee comes out of the input and what left the wallet
 * is the figure a person recognises as the size of their trade.
 */
export function valueAtParUsdMicros(legs: readonly MintDelta[]): bigint | null {
  const stable = legs.filter((leg) => leg.mint in ACTION_PAR_MINTS);
  if (stable.length === 0) return null;
  const paid = stable.find((leg) => leg.deltaRaw < 0n);
  const chosen = paid ?? stable[0];
  const raw = chosen.deltaRaw < 0n ? -chosen.deltaRaw : chosen.deltaRaw;
  return parUsdMicros(raw.toString(), ACTION_PAR_MINTS[chosen.mint]);
}

/**
 * The signer whose tokens moved, and its legs. The first signer is the fee
 * payer; it is the taker only when its own balances moved or when nobody's
 * did. Two signers moving tokens is the one case the balances cannot settle;
 * the first of them is named (see the methodology).
 */
export function takerOf(
  signers: readonly string[],
  pre: readonly TokenBalanceEntry[],
  post: readonly TokenBalanceEntry[],
): Readonly<{ taker: string; legs: readonly MintDelta[] }> | null {
  if (signers.length === 0) return null;
  for (const signer of signers) {
    const legs = ownerMintDeltas(signer, pre, post);
    if (legs.length > 0) return { taker: signer, legs };
  }
  return { taker: signers[0], legs: [] };
}

/**
 * A plain transfer into the referral account: every movement of the signer is
 * a debit, and each one is exactly a credit the referral account received in
 * the same mint. One asset, one way, nothing received — a deposit. A swap
 * always differs: the person received another asset, or paid more of the
 * credited one than the fee (the input the route consumed), or paid in a mint
 * the fee was not taken in.
 */
export function isBareTransfer(legs: readonly MintDelta[], feeCredits: readonly MintDelta[]): boolean {
  if (legs.length === 0) return false;
  return legs.every((leg) => leg.deltaRaw < 0n && feeCredits.some((credit) => credit.mint === leg.mint && credit.deltaRaw === -leg.deltaRaw));
}

/** The rule applied to one transaction. */
export function attributeSolanaTransaction(
  transaction: AttributionTransactionInput,
  referralAccount: string,
): AttributionVerdict {
  const referralDeltas = ownerMintDeltas(referralAccount, transaction.preTokenBalances, transaction.postTokenBalances);
  if (transaction.failed) return { attributable: false, signature: transaction.signature, reason: "FAILED_TRANSACTION", referralDeltas };
  const feeCredits = referralDeltas.filter((delta) => delta.deltaRaw > 0n);
  if (feeCredits.length === 0) return { attributable: false, signature: transaction.signature, reason: "NO_REFERRAL_CREDIT", referralDeltas };
  const who = takerOf(transaction.signers, transaction.preTokenBalances, transaction.postTokenBalances);
  if (!who) return { attributable: false, signature: transaction.signature, reason: "NO_SIGNER", referralDeltas };
  const { taker, legs } = who;
  if (isBareTransfer(legs, feeCredits)) return { attributable: false, signature: transaction.signature, reason: "TRANSFER_TO_REFERRAL", referralDeltas };
  return {
    attributable: true,
    referralDeltas,
    operation: {
      key: operationKey("JUPITER_REFERRAL_ONCHAIN", transaction.signature),
      path: "JUPITER_REFERRAL_ONCHAIN",
      signature: transaction.signature,
      slot: transaction.slot,
      blockTime: transaction.blockTime,
      taker,
      feeCredits,
      legs,
      valueUsdMicros: valueAtParUsdMicros(legs),
    },
  };
}

/* ------------------------------------------------------------ aggregation */

export type FeeTotal = Readonly<{
  mint: string;
  decimals: number;
  /** The gross credited to the referral token account: what people paid. */
  grossRaw: bigint;
  operations: number;
}>;

export type OperationMoment = Readonly<{ signature: string; slot: number; blockTime: number | null }>;

export type AttributionTotals = Readonly<{
  operations: number;
  wallets: number;
  valued: number;
  unvalued: number;
  volumeUsdMicros: bigint;
  fees: readonly FeeTotal[];
  first: OperationMoment | null;
  last: OperationMoment | null;
}>;

function moment(operation: AttributedOperation): OperationMoment {
  return { signature: operation.signature, slot: operation.slot, blockTime: operation.blockTime };
}

/**
 * Totals over a set of operations, each counted once by key.
 *
 * Duplicates are dropped here rather than trusted away: the same signature
 * reaches a reader from every referral token account it touched, and the same
 * receipt can be re-read. Two rows with one key are one operation.
 */
export function aggregateOperations(operations: readonly AttributedOperation[]): AttributionTotals {
  const byKey = new Map<string, AttributedOperation>();
  for (const operation of operations) if (!byKey.has(operation.key)) byKey.set(operation.key, operation);
  const rows = [...byKey.values()].sort((left, right) => left.slot - right.slot || (left.signature < right.signature ? -1 : 1));
  const wallets = new Set<string>();
  const fees = new Map<string, { decimals: number; grossRaw: bigint; operations: number }>();
  let volume = 0n;
  let valued = 0;
  for (const row of rows) {
    wallets.add(row.taker);
    if (row.valueUsdMicros !== null) {
      valued += 1;
      volume += row.valueUsdMicros;
    }
    for (const credit of row.feeCredits) {
      const total = fees.get(credit.mint) ?? { decimals: credit.decimals, grossRaw: 0n, operations: 0 };
      total.grossRaw += credit.deltaRaw;
      total.operations += 1;
      fees.set(credit.mint, total);
    }
  }
  return {
    operations: rows.length,
    wallets: wallets.size,
    valued,
    unvalued: rows.length - valued,
    volumeUsdMicros: volume,
    fees: [...fees.entries()]
      .map(([mint, total]) => ({ mint, decimals: total.decimals, grossRaw: total.grossRaw, operations: total.operations }))
      .sort((left, right) => (left.mint < right.mint ? -1 : 1)),
    first: rows.length > 0 ? moment(rows[0]) : null,
    last: rows.length > 0 ? moment(rows[rows.length - 1]) : null,
  };
}

/**
 * Ryntra's share of a gross fee, from the share the referral project states.
 *
 * The provider's part rounds **up**, so the figure called Ryntra's is never the
 * optimistic one — the same arithmetic the receipts and the fee balances use.
 */
export function ryntraShareRaw(grossRaw: bigint, ryntraShareBps: number): bigint {
  const provider = (grossRaw * BigInt(10_000 - ryntraShareBps) + 9_999n) / 10_000n;
  return grossRaw - provider;
}

/**
 * Whether the reader saw the whole history of the referral token accounts.
 *
 * A public RPC endpoint may keep only part of an account's history and answer
 * a shorter list without saying so. The accounts themselves cannot lie: their
 * balance today equals every credit minus every debit ever made, so a reader
 * that sums every movement it saw and does not land on the balance has missed
 * transactions — and says so instead of publishing a smaller number as if it
 * were the whole.
 */
export function historyIsComplete(
  verdicts: readonly AttributionVerdict[],
  balances: readonly Readonly<{ mint: string; amountRaw: string }>[],
): Readonly<{ complete: boolean; mismatches: readonly Readonly<{ mint: string; seenRaw: bigint; balanceRaw: bigint }>[] }> {
  const seen = new Map<string, bigint>();
  const counted = new Set<string>();
  for (const verdict of verdicts) {
    const signature = verdict.attributable ? verdict.operation.signature : verdict.signature;
    if (counted.has(signature)) continue;
    counted.add(signature);
    /* A failed transaction still appears in the account's history and moved
       nothing; its deltas are empty by construction, so summing them changes
       nothing. */
    for (const delta of verdict.referralDeltas) seen.set(delta.mint, (seen.get(delta.mint) ?? 0n) + delta.deltaRaw);
  }
  const mismatches: { mint: string; seenRaw: bigint; balanceRaw: bigint }[] = [];
  for (const balance of balances) {
    const balanceRaw = BigInt(balance.amountRaw);
    const seenRaw = seen.get(balance.mint) ?? 0n;
    if (seenRaw !== balanceRaw) mismatches.push({ mint: balance.mint, seenRaw, balanceRaw });
  }
  return { complete: mismatches.length === 0, mismatches };
}
