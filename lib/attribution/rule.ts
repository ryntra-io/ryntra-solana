/**
 * The attribution rule — which fact makes an operation Ryntra's, exactly once.
 *
 * Pure and client-safe: no clock, no network, no `process.env`. Everything
 * that counts is a projection over chain facts the public can read for
 * themselves, and the rule is written here once so the public statistics
 * page, the Dune queries and the tests all say the same thing.
 *
 * ## The rule, in one sentence
 *
 * A Solana transaction is a Ryntra operation **iff it credited one of Ryntra's
 * fee identities** — a token account whose authority is Ryntra's Jupiter
 * referral account, or a product's own fee wallet in the attribution registry
 * (`registry.ts`), by a token account it owns in SOL, USDC or USDT — the person
 * paid the Ryntra fee inside that transaction — **and the credit is not the
 * whole of what the signer moved**: a plain transfer into a fee identity moves
 * one asset one way and is a deposit, not a trade (rule 1.1.0). It is counted
 * **once, by its signature**, whatever the client that started it, whatever
 * the router the provider chose, however many pools the route crossed and
 * however many fee identities it credited (rule 1.2.0).
 *
 * Why this fact and not another:
 *
 * - Ryntra owns no AMM and no fee contract. What is Ryntra's on chain is the
 *   referral account Jupiter's referral program initialised for it, the token
 *   accounts that account owns, and the fee wallets the registry names — one
 *   per product, used for nothing else. A fee that arrived there is a fee a
 *   person paid for a trade Ryntra built — nothing else puts money in them.
 * - The fee wallets are why the rule grew: public counters (DefiLlama, Dune)
 *   read fee wallets and never a referral account, and a wallet per product is
 *   what lets them tell a meme trade from a stock purchase. Each credit names
 *   the identity it reached, so a figure can be split by product on chain.
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
 * the same operation produce one signature — the one-submitter protocol:
 * either the app signs and the server executes, or the wallet signs-and-sends
 * and the server adopts that signature, never both — so the key is the same
 * and the operation is one row. A transaction that touches two
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
 * or arrived in their wallet — and nothing else, the same rule the admin
 * dashboard and the Points ledger use (`lib/solana/action-value.ts`). An
 * operation with no stablecoin leg is counted as an operation and reported
 * *unvalued*; it is never priced here, because a price read later is an
 * estimate and a fact is not.
 */

import { ACTION_PAR_MINTS, parUsdMicros } from "../solana/action-value.ts";

export const ATTRIBUTION_RULE_VERSION = "1.2.0";

/** How an operation can be attributed, and how far the proof reaches. */
export type AttributionPath =
  /** Chain-proven: a credit to a referral-owned token account in the transaction. */
  | "JUPITER_REFERRAL_ONCHAIN"
  /** Chain-proven: a credit to a product's fee wallet in the transaction. */
  | "FEE_WALLET_ONCHAIN"
  /** Records only: Relay's request record with Ryntra's app-fee recipient. */
  | "RELAY_APP_FEE_RECORD"
  /** Records only, and no fee at all: the direct Circle lane has no mechanism. */
  | "CCTP_RECORD_ONLY";

export const ATTRIBUTION_PATHS: readonly AttributionPath[] = ["JUPITER_REFERRAL_ONCHAIN", "FEE_WALLET_ONCHAIN", "RELAY_APP_FEE_RECORD", "CCTP_RECORD_ONLY"];

/**
 * One key per operation, whichever client started it. Both chain paths key by
 * the signature, so a transaction that credited the referral account and a fee
 * wallet is still one operation.
 */
export function operationKey(path: AttributionPath, reference: string): string {
  return path === "JUPITER_REFERRAL_ONCHAIN" || path === "FEE_WALLET_ONCHAIN" ? `solana:${reference}` : path === "RELAY_APP_FEE_RECORD" ? `relay:${reference}` : `cctp:${reference}`;
}

/** Native SOL is counted under the wrapped mint: one asset, whichever form the fee took. */
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * An address whose incoming fee makes a transaction Ryntra's. Both are reached
 * through the token accounts they own — never through a wallet's own lamports:
 * a published address collects dust from anyone, and its native history is
 * not a record of fees.
 */
export type FeeIdentityOwner = Readonly<{
  id: string;
  address: string;
  kind: "JUPITER_REFERRAL_ACCOUNT" | "FEE_WALLET";
  /** The last slot a retired identity counts in; its history before it stays counted. */
  endSlot?: number | null;
  /** A fee wallet's canonical fee accounts: only movements of these count, in the rule and in completeness. */
  accounts?: readonly string[];
}>;

/**
 * The mints a product fee wallet takes Ryntra's fee in. A fee wallet is a
 * published plain wallet: anyone can send it anything, so a credit in another
 * mint — a spam token minted into it, an airdrop — is never a fee.
 */
/** The rent a closed token account returns, at most (a Token-2022 account with extensions holds more than the 2,039,280 of a plain one). */
export const TOKEN_ACCOUNT_RENT_CEILING_LAMPORTS = 3_000_000n;

export const FEE_WALLET_MINTS: ReadonlySet<string> = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

/** The referral account's id in the registry. */
export const REFERRAL_IDENTITY_ID = "solana-jupiter-referral";

/** The referral account alone, as rule 1.1.0 counted it, or the identities given. */
function ownersOf(identities: string | readonly FeeIdentityOwner[]): readonly FeeIdentityOwner[] {
  return typeof identities === "string" ? [{ id: REFERRAL_IDENTITY_ID, address: identities, kind: "JUPITER_REFERRAL_ACCOUNT" }] : identities;
}

/** One entry of `preTokenBalances` / `postTokenBalances`, as the RPC states it. */
export type TokenBalanceEntry = Readonly<{
  accountIndex: number;
  /** The token account's address, when the reader names it (from the message's account keys). */
  account?: string;
  mint: string;
  owner?: string;
  uiTokenAmount: Readonly<{ amount: string; decimals: number }>;
}>;

export type MintDelta = Readonly<{ mint: string; decimals: number; deltaRaw: bigint }>;

/** A watched wallet's lamports before and after the transaction, as the RPC states them. */
export type NativeBalanceEntry = Readonly<{ address: string; preLamports: string; postLamports: string }>;

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
  /** The signers' own lamports, kept once a fee wallet exists — to size a fee in SOL against the trade it rides on. */
  nativeBalances?: readonly NativeBalanceEntry[];
}>;

/** A movement of one fee identity in one mint. */
export type OwnerDelta = MintDelta & Readonly<{ owner: string; identity: string; native: boolean }>;

export type AttributedOperation = Readonly<{
  key: string;
  path: "JUPITER_REFERRAL_ONCHAIN" | "FEE_WALLET_ONCHAIN";
  signature: string;
  slot: number;
  blockTime: number | null;
  /** The wallet that signed — the person whose operation it is. */
  taker: string;
  /** What reached Ryntra's fee identities, per mint. Every entry is positive. */
  feeCredits: readonly MintDelta[];
  /** The fee identities the transaction credited, by registry id, in order. */
  identities: readonly string[];
  /** The taker's own owner-scoped movements, per mint. */
  legs: readonly MintDelta[];
  /** Executed value at par in USD micro-units, or null when no leg is a stablecoin. */
  valueUsdMicros: bigint | null;
}>;

export type AttributionVerdict =
  | Readonly<{ attributable: true; operation: AttributedOperation; ownerDeltas: readonly OwnerDelta[] }>
  | Readonly<{
      attributable: false;
      signature: string;
      reason: "FAILED_TRANSACTION" | "NO_FEE_CREDIT" | "NO_SIGNER" | "TRANSFER_TO_FEE_IDENTITY";
      /** Every movement of a fee identity in the transaction, credits and debits alike, so a withdrawal is visible. */
      ownerDeltas: readonly OwnerDelta[];
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

/** Every movement of the fee identities in one transaction: the token accounts each owns. */
export function feeIdentityDeltas(transaction: AttributionTransactionInput, owners: readonly FeeIdentityOwner[]): readonly OwnerDelta[] {
  const deltas: OwnerDelta[] = [];
  for (const owner of owners) {
    /* A fee wallet's other token accounts are whatever anyone opened for it: only the canonical ones are its. */
    const only = owner.accounts ? new Set(owner.accounts) : null;
    const scoped = (entries: readonly TokenBalanceEntry[]) => (only ? entries.filter((entry) => entry.account !== undefined && only.has(entry.account)) : entries);
    for (const delta of ownerMintDeltas(owner.address, scoped(transaction.preTokenBalances), scoped(transaction.postTokenBalances))) {
      /* A fee wallet's other mints are whatever anyone sent it: not its history, not its fees. */
      if (owner.kind === "FEE_WALLET" && !FEE_WALLET_MINTS.has(delta.mint)) continue;
      deltas.push({ ...delta, owner: owner.address, identity: owner.id, native: false });
    }
  }
  return deltas;
}

/** Credits summed per mint, positive only, sorted by mint. */
function creditsPerMint(deltas: readonly OwnerDelta[]): readonly MintDelta[] {
  const totals = new Map<string, { decimals: number; delta: bigint }>();
  for (const delta of deltas) {
    if (delta.deltaRaw <= 0n) continue;
    const current = totals.get(delta.mint) ?? { decimals: delta.decimals, delta: 0n };
    current.delta += delta.deltaRaw;
    totals.set(delta.mint, current);
  }
  return [...totals.entries()]
    .map(([mint, value]) => ({ mint, decimals: value.decimals, deltaRaw: value.delta }))
    .sort((left, right) => (left.mint < right.mint ? -1 : left.mint > right.mint ? 1 : 0));
}

/**
 * The rule applied to one transaction.
 *
 * `identities` is the referral account's address — the rule as it read until
 * 1.2.0 — or the fee identities the registry names.
 */
export function attributeSolanaTransaction(
  transaction: AttributionTransactionInput,
  identities: string | readonly FeeIdentityOwner[],
): AttributionVerdict {
  const owners = ownersOf(identities);
  const ownerDeltas = feeIdentityDeltas(transaction, owners);
  if (transaction.failed) return { attributable: false, signature: transaction.signature, reason: "FAILED_TRANSACTION", ownerDeltas };
  const ownerOf = new Map(owners.map((owner) => [owner.id, owner]));
  const counts = (delta: OwnerDelta): boolean => {
    const owner = ownerOf.get(delta.identity);
    if (!owner || delta.deltaRaw <= 0n) return false;
    /* A retired identity's credits after its end are not Ryntra's any more. */
    if (owner.endSlot !== undefined && owner.endSlot !== null && transaction.slot > owner.endSlot) return false;
    return owner.kind !== "FEE_WALLET" || FEE_WALLET_MINTS.has(delta.mint);
  };
  const credits = ownerDeltas.filter(counts);
  if (credits.length === 0) return { attributable: false, signature: transaction.signature, reason: "NO_FEE_CREDIT", ownerDeltas };
  const feeCredits = creditsPerMint(credits);
  /* A fee identity that signs is moving its own money; the taker is someone else. */
  const ownAddresses = new Set(owners.map((owner) => owner.address));
  const who = takerOf(
    transaction.signers.filter((signer) => !ownAddresses.has(signer)),
    transaction.preTokenBalances,
    transaction.postTokenBalances,
  );
  if (!who) return { attributable: false, signature: transaction.signature, reason: "NO_SIGNER", ownerDeltas };
  const { taker, legs } = who;
  /* A deposit: the signer's tokens went only into a fee identity — or no token
     of the signer moved at all and the only credit is lamports. */
  const nativeOnlyDeposit = legs.length === 0 && credits.every((credit) => credit.native);
  if (isBareTransfer(legs, feeCredits) || nativeOnlyDeposit) return { attributable: false, signature: transaction.signature, reason: "TRANSFER_TO_FEE_IDENTITY", ownerDeltas };
  /* Through a fee wallet alone the transaction must look like a trade: the
     signer received something, or paid in a mint the fee was not taken in. An
     airdrop that also reached the wallet pays out one mint and receives none. */
  const viaReferral = credits.some((credit) => ownerOf.get(credit.identity)?.kind === "JUPITER_REFERRAL_ACCOUNT");
  if (!viaReferral) {
    const creditedMints = new Set(credits.map((credit) => credit.mint));
    const takerNative = (transaction.nativeBalances ?? []).find((entry) => entry.address === taker);
    const takerLamports = takerNative && /^[0-9]+$/.test(takerNative.preLamports) && /^[0-9]+$/.test(takerNative.postLamports) ? BigInt(takerNative.postLamports) - BigInt(takerNative.preLamports) : null;
    /* Received something: a token, or SOL unwrapped into the wallet itself —
       beyond the rent of the person's own token accounts closed in the same
       transaction, which comes back to them whatever else happened. */
    const takerAccounts = (entries: readonly TokenBalanceEntry[]) => new Set(entries.filter((entry) => entry.owner === taker).map((entry) => entry.accountIndex));
    const after = takerAccounts(transaction.postTokenBalances);
    const closed = [...takerAccounts(transaction.preTokenBalances)].filter((index) => !after.has(index)).length;
    const refund = BigInt(closed) * TOKEN_ACCOUNT_RENT_CEILING_LAMPORTS;
    const received = legs.some((leg) => leg.deltaRaw > 0n) || (takerLamports !== null && takerLamports > refund);
    const traded = received || legs.some((leg) => leg.deltaRaw < 0n && !creditedMints.has(leg.mint));
    if (!traded) return { attributable: false, signature: transaction.signature, reason: "TRANSFER_TO_FEE_IDENTITY", ownerDeltas };
    /* A fee is a share of the trade it rides on: at least a basis point of
       the person's own movement in that asset. Dust sent beside somebody's
       large swap is not a fee and does not make the swap Ryntra's. */
    const abs = (value: bigint) => (value < 0n ? -value : value);
    const sized = feeCredits.every((credit) => {
      let reference = abs(legs.find((leg) => leg.mint === credit.mint)?.deltaRaw ?? 0n);
      if (credit.mint === NATIVE_SOL_MINT && takerLamports !== null) reference += abs(takerLamports);
      return reference > 0n && credit.deltaRaw * 10_000n >= reference;
    });
    if (!sized) return { attributable: false, signature: transaction.signature, reason: "TRANSFER_TO_FEE_IDENTITY", ownerDeltas };
  }
  const credited = [...new Set(credits.map((credit) => credit.identity))];
  const viaWallet = owners.some((owner) => owner.kind === "FEE_WALLET" && credited.includes(owner.id));
  const path = viaWallet ? "FEE_WALLET_ONCHAIN" : "JUPITER_REFERRAL_ONCHAIN";
  return {
    attributable: true,
    ownerDeltas,
    operation: {
      key: operationKey(path, transaction.signature),
      path,
      signature: transaction.signature,
      slot: transaction.slot,
      blockTime: transaction.blockTime,
      taker,
      feeCredits,
      identities: credited,
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
 * Whether the reader saw the whole history of the fee identities.
 *
 * A public RPC endpoint may keep only part of an account's history and answer
 * a shorter list without saying so. The accounts themselves cannot lie: their
 * balance today equals every credit minus every debit ever made, so a reader
 * that sums every movement it saw and does not land on the balance has missed
 * transactions — and says so instead of publishing a smaller number as if it
 * were the whole. With owners named, the sum is per owner and mint: a fee
 * wallet's lamports and its wrapped-SOL account are one balance of one owner,
 * and two owners never share a figure.
 */
export function historyIsComplete(
  verdicts: readonly AttributionVerdict[],
  balances: readonly Readonly<{ owner?: string; mint: string; amountRaw: string }>[],
): Readonly<{ complete: boolean; mismatches: readonly Readonly<{ owner: string | null; mint: string; seenRaw: bigint; balanceRaw: bigint }>[] }> {
  const byOwner = balances.some((balance) => balance.owner !== undefined);
  const keyOf = (owner: string | null, mint: string) => (byOwner ? `${owner ?? ""}|${mint}` : mint);
  const seen = new Map<string, bigint>();
  const counted = new Set<string>();
  for (const verdict of verdicts) {
    const signature = verdict.attributable ? verdict.operation.signature : verdict.signature;
    if (counted.has(signature)) continue;
    counted.add(signature);
    /* A failed transaction still appears in the account's history and moved
       nothing; its deltas are empty by construction, so summing them changes
       nothing. */
    for (const delta of verdict.ownerDeltas) {
      const key = keyOf(delta.owner, delta.mint);
      seen.set(key, (seen.get(key) ?? 0n) + delta.deltaRaw);
    }
  }
  const owed = new Map<string, { owner: string | null; mint: string; balanceRaw: bigint }>();
  for (const balance of balances) {
    const owner = byOwner ? (balance.owner ?? null) : null;
    const key = keyOf(owner, balance.mint);
    const current = owed.get(key) ?? { owner, mint: balance.mint, balanceRaw: 0n };
    current.balanceRaw += BigInt(balance.amountRaw);
    owed.set(key, current);
  }
  const mismatches: { owner: string | null; mint: string; seenRaw: bigint; balanceRaw: bigint }[] = [];
  for (const [key, balance] of owed) {
    const seenRaw = seen.get(key) ?? 0n;
    if (seenRaw !== balance.balanceRaw) mismatches.push({ owner: balance.owner, mint: balance.mint, seenRaw, balanceRaw: balance.balanceRaw });
  }
  /* Movements in a mint the identity holds no account of now — a closed
     account — must net to zero; otherwise history is missing. */
  for (const [key, seenRaw] of seen) {
    if (owed.has(key) || seenRaw === 0n) continue;
    const [owner, mint] = byOwner ? key.split("|") : [null, key];
    mismatches.push({ owner, mint, seenRaw, balanceRaw: 0n });
  }
  return { complete: mismatches.length === 0, mismatches };
}
