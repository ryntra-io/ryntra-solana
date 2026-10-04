/**
 * The chain read behind the public statistics — server only.
 *
 * This module answers one question from the chain alone: *which transactions
 * credited Ryntra's fee identities, and what did each of them do?* The fee
 * identities are the referral account's token accounts and the product fee
 * wallets the attribution registry names (`registry.ts`) — their token
 * accounts in the fee mints, never a wallet's own address or lamports: a
 * published address collects dust from anyone, and reading its history would
 * let anybody make the read partial and slow. The rule that turns a transaction into an
 * operation is `rule.ts`; this file only fetches and remembers.
 *
 * ## Why more than one endpoint, and why the balance check
 *
 * Measured on 2026-09-15 against the two referral token accounts: one public
 * operator answered `getSignaturesForAddress` with the last one or two
 * signatures and no hint that older ones exist; a second answered every
 * signature but `null` for transactions older than a few days; the third
 * keeps the whole history and rate-limits. So signature history is the
 * **union** over every endpoint that answers, a transaction is asked of each
 * endpoint until one returns it, and the result is trusted only when every
 * movement seen sums to the balance the accounts hold today
 * (`historyIsComplete`). A reader that cannot prove completeness says so on
 * the page instead of publishing a smaller number as the whole.
 *
 * ## What is remembered
 *
 * A finalized transaction never changes, so its trimmed form is kept per
 * process and only new signatures are fetched on a refresh. The aggregate is
 * kept in the platform's shared data cache for ten minutes, so the public
 * page costs the chain a handful of calls an hour, not one per visitor.
 *
 * ## Where this stops
 *
 * One read fetches at most `MAX_TRANSACTIONS_PER_READ` transactions. Beyond
 * that the figures are marked partial rather than silently capped; the next
 * step at that scale is an indexed store of operations, not a longer loop.
 */

import { unstable_cache } from "next/cache.js";

import { readBoundedRpcResponse, resolveEndpoints, type SolanaEndpoint } from "../solana/rpc.ts";
import { readJupiterPartnerShareBps } from "../swap/fee-balances.server.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { resolveServiceFeeConfig } from "../swap/service-fee.server.ts";
import { associatedTokenAccount } from "./ata.ts";
import { solanaFeeOwners, type FirstCredit } from "./registry.ts";

export { associatedTokenAccount };
import {
  ATTRIBUTION_RULE_VERSION,
  FEE_WALLET_MINTS,
  REFERRAL_IDENTITY_ID,
  aggregateOperations,
  attributeSolanaTransaction,
  historyIsComplete,
  ryntraShareRaw,
  type AttributionTransactionInput,
  type AttributionVerdict,
  type FeeIdentityOwner,
  type NativeBalanceEntry,
  type TokenBalanceEntry,
} from "./rule.ts";

/** Solana Labs keeps the whole transaction history; the public operators in `rpc.ts` do not always. */
export const ARCHIVE_ENDPOINT_ENV = "RYNTRA_SOLANA_RPC_MAINNET_ARCHIVE";
const DEFAULT_ARCHIVE_ENDPOINT = "https://api.mainnet-beta.solana.com";

export const MAX_TRANSACTIONS_PER_READ = 500;
/** Transactions asked at once: a public operator answers a handful in parallel without a rate limit. */
export const TRANSACTION_CONCURRENCY = 4;
/**
 * From the start of a read, after this long no further transaction is asked
 * for and the read answers partial — the routes that wait on it have sixty
 * seconds. A transaction already read is kept for the life of the instance,
 * so the next read carries on from where this one stopped.
 */
export const TRANSACTION_DEADLINE_MS = 42_000;
/**
 * From the start of a read, no transaction is waited for past this: one asked
 * just before the deadline can spend three endpoints' timeouts and a rate
 * limit's backoff, so its answer is dropped here and the read answers partial.
 * What it brings later is still kept for the next read.
 */
export const TRANSACTION_HARD_STOP_MS = 50_000;
/** The provider's share is asked once after the transactions; past this it is unknown for this read. */
const PARTNER_SHARE_WAIT_MS = 4_000;
/** The shape of a kept read: a read kept in an older shape is not read back as this one. */
const READ_SHAPE = "read-2";
export const ATTRIBUTION_SHARED_REVALIDATE_S = 600;
const SIGNATURE_PAGE = 1000;
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"] as const;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Between calls to one endpoint, so a read never looks like a burst to a public operator. */
const PACE_MS = 200;

/** A token account a fee identity owns, with its balance now. */
export type ReferralTokenAccount = Readonly<{ owner: string; address: string; mint: string; decimals: number; amountRaw: string }>;

export type AttributionOperationRow = Readonly<{
  signature: string;
  slot: number;
  blockTime: number | null;
  taker: string;
  /** The fee identities the transaction credited, by registry id. */
  identities: readonly string[];
  feeCredits: readonly Readonly<{ mint: string; decimals: number; amountRaw: string }>[];
  legs: readonly Readonly<{ mint: string; decimals: number; deltaRaw: string }>[];
  valueUsdMicros: string | null;
}>;

export type AttributionChainRead = Readonly<{
  ok: true;
  ruleVersion: string;
  /** The Jupiter referral account read, or null when none is configured. */
  referralAccount: string | null;
  /** Every fee identity read: the referral account and the product fee wallets with an address. */
  identities: readonly FeeIdentityOwner[];
  readAt: string;
  /** Hosts that answered, in the order they were used. Never a URL: a provider URL can carry a key. */
  sources: readonly string[];
  accounts: readonly ReferralTokenAccount[];
  /** The partner share the referral project states, or null when the project could not be read. */
  ryntraShareBps: number | null;
  totals: Readonly<{
    operations: number;
    wallets: number;
    valued: number;
    unvalued: number;
    volumeUsdMicros: string;
    fees: readonly Readonly<{ mint: string; decimals: number; grossRaw: string; ryntraRaw: string | null; operations: number }>[];
    first: Readonly<{ signature: string; slot: number; blockTime: number | null }> | null;
    last: Readonly<{ signature: string; slot: number; blockTime: number | null }> | null;
  }>;
  coverage: Readonly<{
    /** Every movement seen sums to the accounts' balances and no transaction was left unread. */
    complete: boolean;
    signaturesSeen: number;
    transactionsRead: number;
    transactionsMissing: number;
    truncated: boolean;
    mismatches: readonly Readonly<{ owner: string | null; mint: string; seenRaw: string; balanceRaw: string }>[];
  }>;
  operations: readonly AttributionOperationRow[];
  /** Each fee identity's earliest credit per mint among the operations read: where the registry's rows started. */
  firstCredits: readonly FirstCredit[];
}>;

export type AttributionChainFailure = Readonly<{ ok: false; code: "NOT_CONFIGURED" | "UNREACHABLE" | "UNREADABLE"; reason: string }>;

export type AttributionRead = AttributionChainRead | AttributionChainFailure;

/* ------------------------------------------------------------ transport */

type Endpoint = Readonly<{ host: string; url: string }>;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-endpoint";
  }
}

/** Primary, fallback, then the archive — each once, in that order. */
export function attributionEndpoints(env: NodeJS.ProcessEnv = process.env): readonly Endpoint[] {
  const configured: readonly SolanaEndpoint[] = resolveEndpoints("mainnet");
  const archiveUrl = env[ARCHIVE_ENDPOINT_ENV]?.trim() || DEFAULT_ARCHIVE_ENDPOINT;
  const list: Endpoint[] = configured.map((endpoint) => ({ host: endpoint.host, url: endpoint.url }));
  if (!list.some((endpoint) => endpoint.host === hostOf(archiveUrl))) list.push({ host: hostOf(archiveUrl), url: archiveUrl });
  return list;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The promise's answer, or `fallback` once `ms` have passed; the work itself is not stopped, only no longer waited for. */
export function within<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  if (ms <= 0) return Promise.resolve(fallback);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

class RateLimited extends Error {}

/** Backoff after a rate limit, per attempt. The archive endpoint answers 429 under a modest burst and again a second later. */
const RATE_LIMIT_WAITS_MS = [1_000, 2_500, 5_000] as const;

async function callOnce<T>(endpoint: Endpoint, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (response.status === 429) throw new RateLimited(`${endpoint.host} rate-limited ${method}`);
  const text = await readBoundedRpcResponse(response, MAX_RESPONSE_BYTES, endpoint.host);
  if (!response.ok) throw new Error(`${endpoint.host} answered HTTP ${response.status} to ${method}`);
  const parsed = JSON.parse(text) as { result?: T; error?: { code?: number; message?: string } };
  if (parsed.error) {
    if (parsed.error.code === -32005 || /too many requests/i.test(parsed.error.message ?? "")) throw new RateLimited(`${endpoint.host} rate-limited ${method}`);
    throw new Error(`${endpoint.host} refused ${method}: ${parsed.error.message ?? parsed.error.code ?? "unknown"}`);
  }
  return parsed.result as T;
}

/**
 * One call, retried through a rate limit and never through anything else.
 *
 * A limit is the endpoint asking for time, and a transaction that exists is
 * not "missing" because the archive was busy for a second; every other refusal
 * is an answer and goes straight to the next endpoint.
 */
async function call<T>(endpoint: Endpoint, method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await callOnce<T>(endpoint, method, params);
    } catch (failure) {
      if (!(failure instanceof RateLimited) || attempt >= RATE_LIMIT_WAITS_MS.length) throw failure;
      await sleep(RATE_LIMIT_WAITS_MS[attempt]);
    }
  }
}

/* ------------------------------------------------------------ reads */

type ParsedTokenAccount = Readonly<{
  pubkey: string;
  account: Readonly<{ data: Readonly<{ parsed: Readonly<{ info: Readonly<{ mint: string; tokenAmount: Readonly<{ amount: string; decimals: number }> }> }> }> }>;
}>;

const FEE_MINT_DECIMALS: Readonly<Record<string, number>> = {
  So11111111111111111111111111111111111111112: 9,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
};

/**
 * A fee wallet's fee accounts: the canonical account of each fee mint, open or
 * closed. A closed one keeps its history and reads a zero balance, so its past
 * fees still count; any other account the wallet owns — anybody can open one
 * for a published address — is never read.
 */
export async function readFeeWalletAccounts(owner: string, endpoints: readonly Endpoint[], used: Set<string>): Promise<readonly ReferralTokenAccount[]> {
  const open = await readReferralTokenAccounts(owner, endpoints, used, [...FEE_WALLET_MINTS]);
  const accounts: ReferralTokenAccount[] = [];
  for (const mint of FEE_WALLET_MINTS) {
    const address = await associatedTokenAccount(owner, mint);
    const live = open.find((account) => account.address === address);
    accounts.push(live ?? { owner, address, mint, decimals: FEE_MINT_DECIMALS[mint] ?? 0, amountRaw: "0" });
  }
  return accounts;
}

/**
 * The token accounts one fee identity owns, with their balances now. A fee
 * wallet is asked mint by mint — only the fee mints — so token accounts
 * anybody opens for it never reach the read.
 */
export async function readReferralTokenAccounts(
  owner: string,
  endpoints: readonly Endpoint[],
  used: Set<string>,
  mints: readonly string[] | null = null,
): Promise<readonly ReferralTokenAccount[]> {
  let lastFailure: unknown = null;
  const filters: readonly Readonly<Record<string, string>>[] = mints ? mints.map((mint) => ({ mint })) : TOKEN_PROGRAMS.map((programId) => ({ programId }));
  for (const endpoint of endpoints) {
    try {
      const accounts: ReferralTokenAccount[] = [];
      for (const filter of filters) {
        const result = await call<{ value: readonly ParsedTokenAccount[] }>(endpoint, "getTokenAccountsByOwner", [
          owner,
          filter,
          { encoding: "jsonParsed", commitment: "confirmed" },
        ]);
        for (const entry of result.value) {
          const info = entry.account.data.parsed.info;
          accounts.push({ owner, address: entry.pubkey, mint: info.mint, decimals: info.tokenAmount.decimals, amountRaw: info.tokenAmount.amount });
        }
        await sleep(PACE_MS);
      }
      used.add(endpoint.host);
      return accounts.sort((left, right) => (left.mint < right.mint ? -1 : 1));
    } catch (failure) {
      lastFailure = failure;
    }
  }
  throw lastFailure instanceof Error ? lastFailure : new Error("No endpoint listed the fee identity's token accounts.");
}



type SignatureInfo = Readonly<{ signature: string; slot: number; blockTime: number | null; err: unknown }>;

/**
 * Every signature that touched the addresses, as the union over the endpoints.
 *
 * An endpoint that answers a short list is not wrong about the signatures it
 * names, only silent about the rest; the union keeps what each one knows and
 * the balance check below decides whether the whole was seen.
 */
export async function readSignatureHistory(
  addresses: readonly string[],
  endpoints: readonly Endpoint[],
  used: Set<string>,
): Promise<Map<string, SignatureInfo>> {
  const seen = new Map<string, SignatureInfo>();
  let answered = 0;
  for (const endpoint of endpoints) {
    try {
      for (const address of addresses) {
        let before: string | undefined;
        for (;;) {
          const page = await call<readonly SignatureInfo[]>(endpoint, "getSignaturesForAddress", [
            address,
            { limit: SIGNATURE_PAGE, ...(before ? { before } : {}) },
          ]);
          for (const entry of page) if (!seen.has(entry.signature)) seen.set(entry.signature, entry);
          await sleep(PACE_MS);
          if (page.length < SIGNATURE_PAGE) break;
          before = page[page.length - 1].signature;
        }
      }
      answered += 1;
      used.add(endpoint.host);
    } catch {
      /* One silent operator is the reason the others are asked. */
    }
  }
  if (answered === 0) throw new Error("No endpoint answered the signature history of the fee identities.");
  return seen;
}

type RpcTransaction = Readonly<{
  slot: number;
  blockTime: number | null;
  meta: Readonly<{
    err: unknown;
    preBalances?: readonly number[];
    postBalances?: readonly number[];
    preTokenBalances?: readonly TokenBalanceEntry[];
    postTokenBalances?: readonly TokenBalanceEntry[];
  }> | null;
  transaction: Readonly<{ message: Readonly<{ accountKeys: readonly Readonly<{ pubkey: string; signer: boolean }>[] }> }>;
}>;

/** Finalized transactions never change: once trimmed, kept for the life of the process. */
const transactionMemory = new Map<string, AttributionTransactionInput>();

export function resetAttributionMemory(): void {
  transactionMemory.clear();
}

/** The signers' lamports, before and after: what a fee in SOL is sized against. */
function nativeBalancesOf(tx: RpcTransaction, watched: ReadonlySet<string>): readonly NativeBalanceEntry[] {
  const keys = tx.transaction.message.accountKeys;
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];
  const entries: NativeBalanceEntry[] = [];
  keys.forEach((key, index) => {
    if (!watched.has(key.pubkey) || pre[index] === undefined || post[index] === undefined) return;
    entries.push({ address: key.pubkey, preLamports: String(pre[index]), postLamports: String(post[index]) });
  });
  return entries;
}

/** A kept transaction this read can use: one kept before signers were watched, or before accounts were named, is read again. */
function keptTransaction(signature: string, watchSigners: boolean): AttributionTransactionInput | null {
  const kept = transactionMemory.get(signature);
  if (!kept) return null;
  if (watchSigners && kept.nativeBalances === undefined) return null;
  return kept.preTokenBalances.concat(kept.postTokenBalances).every((entry) => entry.account !== undefined) ? kept : null;
}

async function readTransaction(
  signature: string,
  endpoints: readonly Endpoint[],
  used: Set<string>,
  watchSigners: boolean,
): Promise<AttributionTransactionInput | null> {
  const kept = keptTransaction(signature, watchSigners);
  if (kept) return kept;
  for (const endpoint of endpoints) {
    try {
      const tx = await call<RpcTransaction | null>(endpoint, "getTransaction", [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" },
      ]);
      await sleep(PACE_MS);
      if (!tx || !tx.meta) continue;
      const trimmed: AttributionTransactionInput = {
        signature,
        slot: tx.slot,
        blockTime: tx.blockTime ?? null,
        failed: tx.meta.err !== null && tx.meta.err !== undefined,
        signers: tx.transaction.message.accountKeys.filter((key) => key.signer).map((key) => key.pubkey),
        preTokenBalances: (tx.meta.preTokenBalances ?? []).map((entry) => trimBalance(entry, tx.transaction.message.accountKeys)),
        postTokenBalances: (tx.meta.postTokenBalances ?? []).map((entry) => trimBalance(entry, tx.transaction.message.accountKeys)),
        ...(watchSigners ? { nativeBalances: nativeBalancesOf(tx, new Set(tx.transaction.message.accountKeys.filter((key) => key.signer).map((key) => key.pubkey))) } : {}),
      };
      transactionMemory.set(signature, trimmed);
      used.add(endpoint.host);
      return trimmed;
    } catch {
      /* Ask the next one; a transaction the last endpoint cannot give is recorded as missing. */
    }
  }
  return null;
}

function trimBalance(entry: TokenBalanceEntry, keys: readonly Readonly<{ pubkey: string }>[]): TokenBalanceEntry {
  const account = keys[entry.accountIndex]?.pubkey;
  return {
    accountIndex: entry.accountIndex,
    ...(account ? { account } : {}),
    mint: entry.mint,
    ...(entry.owner ? { owner: entry.owner } : {}),
    uiTokenAmount: { amount: entry.uiTokenAmount.amount, decimals: entry.uiTokenAmount.decimals },
  };
}

/* ------------------------------------------------------------ the read */

/**
 * The whole read, uncached: the chain as it is at this moment.
 *
 * Single-flight per process: a page and its JSON route arriving together share
 * one read, so the public endpoints see one pass and not two racing ones —
 * which is exactly how a rate limit turned three real transactions into
 * "missing" on the first stand run.
 */
let inflight: Promise<AttributionRead> | null = null;

type ReadDeps = Readonly<{
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** The referral account to read; the deployment's when absent, none when null. */
  referralAccount?: string | null;
  /** The product fee wallets to read; the registry's when absent. */
  feeWallets?: readonly FeeIdentityOwner[];
  /** From the read's start, how long transactions may be asked for before it answers partial. */
  deadlineMs?: number;
  /** From the read's start, how long a transaction already asked for is waited for. */
  hardStopMs?: number;
}>;

/** The fee identities one read covers: the referral account, then the registry's fee wallets. */
export function feeIdentitiesToRead(referralAccount: string | null, feeWallets: readonly FeeIdentityOwner[]): readonly FeeIdentityOwner[] {
  const owners: FeeIdentityOwner[] = [];
  /* The deployment's referral account, or the registry's when the deployment names none. */
  const registryReferral = feeWallets.find((owner) => owner.kind === "JUPITER_REFERRAL_ACCOUNT");
  const referral = referralAccount ?? registryReferral?.address ?? null;
  /* A deployment's account that is not the published one is read under its own id, so its start never lands on the published row. */
  const published = registryReferral !== undefined && referral === registryReferral.address;
  if (referral) owners.push({ id: published || !registryReferral ? REFERRAL_IDENTITY_ID : `${REFERRAL_IDENTITY_ID}-deployment`, address: referral, kind: "JUPITER_REFERRAL_ACCOUNT", endSlot: published ? registryReferral.endSlot ?? null : null });
  for (const wallet of feeWallets) if (wallet.kind === "FEE_WALLET" && !owners.some((owner) => owner.address === wallet.address)) owners.push(wallet);
  return owners;
}

export function readAttributionFromChain(deps: ReadDeps = {}): Promise<AttributionRead> {
  if (deps.referralAccount !== undefined || deps.env !== undefined || deps.feeWallets !== undefined) return readAttributionOnce(deps);
  if (inflight) return inflight;
  inflight = readAttributionOnce(deps).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function readAttributionOnce(deps: ReadDeps = {}): Promise<AttributionRead> {
  const started = Date.now();
  const env = deps.env ?? process.env;
  const referralAccount = deps.referralAccount === undefined ? resolveServiceFeeConfig(env).jupiterReferralAccount : deps.referralAccount;
  const owners = feeIdentitiesToRead(referralAccount, deps.feeWallets ?? solanaFeeOwners());
  if (owners.length === 0) return { ok: false, code: "NOT_CONFIGURED", reason: "No fee identity is configured, so nothing on chain is Ryntra's to count." };
  const wallets = owners.filter((owner) => owner.kind === "FEE_WALLET");
  /* Once a fee wallet exists, every signer's lamports, to size a fee in SOL against the trade it rides on. */
  const watchSigners = wallets.length > 0;
  const endpoints = attributionEndpoints(env);
  const used = new Set<string>();
  const readAt = (deps.now ?? (() => new Date()))().toISOString();

  let accounts: ReferralTokenAccount[];
  let history: Map<string, SignatureInfo>;
  let scopedOwners: readonly FeeIdentityOwner[] = owners;
  try {
    accounts = [];
    for (const owner of owners) {
      /* Anyone can open token accounts a published wallet owns: a fee wallet is read by its canonical fee accounts only. */
      accounts.push(...(owner.kind === "FEE_WALLET" ? await readFeeWalletAccounts(owner.address, endpoints, used) : await readReferralTokenAccounts(owner.address, endpoints, used)));
    }
    history = await readSignatureHistory(accounts.map((account) => account.address), endpoints, used);
    /* A fee wallet counts its canonical fee accounts only, in every transaction. */
    scopedOwners = owners.map((owner) => (owner.kind === "FEE_WALLET" ? { ...owner, accounts: accounts.filter((account) => account.owner === owner.address).map((account) => account.address) } : owner));
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }

  const ordered = [...history.values()].sort((left, right) => left.slot - right.slot || (left.signature < right.signature ? -1 : 1));
  const truncated = ordered.length > MAX_TRANSACTIONS_PER_READ;
  const toRead = truncated ? ordered.slice(-MAX_TRANSACTIONS_PER_READ) : ordered;
  const verdicts: AttributionVerdict[] = [];
  let missing = 0;
  let outOfTime = false;
  const stopAt = started + (deps.hardStopMs ?? TRANSACTION_HARD_STOP_MS);
  const unanswered = Symbol("unanswered");
  for (let index = 0; index < toRead.length; index += TRANSACTION_CONCURRENCY) {
    const batch = toRead.slice(index, index + TRANSACTION_CONCURRENCY);
    /* Past the deadline only what this instance already holds is used; nothing new is asked. */
    const late = Date.now() - started > (deps.deadlineMs ?? TRANSACTION_DEADLINE_MS);
    if (late) outOfTime = true;
    const transactions = await Promise.all(
      batch.map((info) => (late ? Promise.resolve(keptTransaction(info.signature, watchSigners)) : within(readTransaction(info.signature, endpoints, used, watchSigners), stopAt - Date.now(), unanswered))),
    );
    for (const transaction of transactions) {
      if (transaction === unanswered) outOfTime = true;
      if (!transaction || transaction === unanswered) {
        missing += 1;
        continue;
      }
      verdicts.push(attributeSolanaTransaction(transaction, scopedOwners));
    }
  }
  if (verdicts.length === 0 && missing > 0) {
    return {
      ok: false,
      code: "UNREADABLE",
      reason: outOfTime
        ? `The read's time ran out before any of ${missing} transaction(s) of the fee identities was read; the next read carries on.`
        : `${missing} transaction(s) of the fee identities could not be read from any endpoint.`,
    };
  }

  let shareBps: number | null = null;
  try {
    shareBps = await within(readJupiterPartnerShareBps(createSolanaRpcHandle({ network: "mainnet" })), PARTNER_SHARE_WAIT_MS, null);
  } catch {
    shareBps = null;
  }

  const operations = verdicts.flatMap((verdict) => (verdict.attributable ? [verdict.operation] : []));
  const totals = aggregateOperations(operations);
  /* The provider's share applies to what reached the referral account; a
     product fee wallet receives the fee whole, with no provider between. */
  const referralGross = new Map<string, bigint>();
  const counted = new Set<string>();
  for (const verdict of verdicts) {
    if (!verdict.attributable || counted.has(verdict.operation.key)) continue;
    counted.add(verdict.operation.key);
    for (const delta of verdict.ownerDeltas) {
      if (delta.deltaRaw > 0n && delta.identity.startsWith(REFERRAL_IDENTITY_ID)) referralGross.set(delta.mint, (referralGross.get(delta.mint) ?? 0n) + delta.deltaRaw);
    }
  }
  const firsts = new Map<string, FirstCredit>();
  for (const verdict of verdicts) {
    if (!verdict.attributable) continue;
    const { signature, slot, blockTime, identities } = verdict.operation;
    for (const delta of verdict.ownerDeltas) {
      /* Only what made the operation Ryntra's: a counted credit of a credited identity. */
      if (delta.deltaRaw <= 0n || !identities.includes(delta.identity)) continue;
      const owner = owners.find((entry) => entry.id === delta.identity);
      if (owner?.endSlot != null && slot > owner.endSlot) continue;
      const key = `${delta.identity}|${delta.mint}`;
      const kept = firsts.get(key);
      if (!kept || slot < kept.slot || (slot === kept.slot && signature < kept.signature)) firsts.set(key, { identity: delta.identity, mint: delta.mint, signature, slot, blockTime });
    }
  }
  const ryntraOf = (mint: string, grossRaw: bigint): string | null => {
    const viaReferral = referralGross.get(mint) ?? 0n;
    if (viaReferral > 0n && shareBps === null) return null;
    return (grossRaw - viaReferral + (viaReferral > 0n && shareBps !== null ? ryntraShareRaw(viaReferral, shareBps) : 0n)).toString();
  };
  const completeness = historyIsComplete(verdicts, accounts.map((account) => ({ owner: account.owner, mint: account.mint, amountRaw: account.amountRaw })));
  return {
    ok: true,
    ruleVersion: ATTRIBUTION_RULE_VERSION,
    referralAccount: referralAccount ?? null,
    identities: owners,
    readAt,
    sources: [...used],
    accounts,
    ryntraShareBps: shareBps,
    totals: {
      operations: totals.operations,
      wallets: totals.wallets,
      valued: totals.valued,
      unvalued: totals.unvalued,
      volumeUsdMicros: totals.volumeUsdMicros.toString(),
      fees: totals.fees.map((fee) => ({
        mint: fee.mint,
        decimals: fee.decimals,
        grossRaw: fee.grossRaw.toString(),
        ryntraRaw: ryntraOf(fee.mint, fee.grossRaw),
        operations: fee.operations,
      })),
      first: totals.first,
      last: totals.last,
    },
    coverage: {
      complete: completeness.complete && missing === 0 && !truncated,
      signaturesSeen: ordered.length,
      transactionsRead: verdicts.length,
      transactionsMissing: missing,
      truncated: truncated || outOfTime,
      mismatches: completeness.mismatches.map((row) => ({ owner: row.owner, mint: row.mint, seenRaw: row.seenRaw.toString(), balanceRaw: row.balanceRaw.toString() })),
    },
    operations: operations.map((operation) => ({
      signature: operation.signature,
      slot: operation.slot,
      blockTime: operation.blockTime,
      taker: operation.taker,
      identities: operation.identities,
      feeCredits: operation.feeCredits.map((credit) => ({ mint: credit.mint, decimals: credit.decimals, amountRaw: credit.deltaRaw.toString() })),
      legs: operation.legs.map((leg) => ({ mint: leg.mint, decimals: leg.decimals, deltaRaw: leg.deltaRaw.toString() })),
      valueUsdMicros: operation.valueUsdMicros === null ? null : operation.valueUsdMicros.toString(),
    })),
    firstCredits: [...firsts.values()],
  };
}

class AttributionReadFailure extends Error {
  readonly failure: AttributionChainFailure;
  constructor(failure: AttributionChainFailure) {
    super(failure.reason);
    this.failure = failure;
  }
}

/** A read that answered but could not prove it saw everything: shown once, never kept. */
class AttributionReadPartial extends Error {
  readonly read: AttributionChainRead;
  constructor(read: AttributionChainRead) {
    super("partial");
    this.read = read;
  }
}

/* A failed or partial read is thrown rather than returned here, because the
   platform layer keeps whatever the function returns for ten minutes, and
   neither a failure nor a lower bound is a figure worth keeping that long. */
const readShared = unstable_cache(
  async (): Promise<AttributionChainRead> => {
    const read = await readAttributionFromChain();
    if (!read.ok) throw new AttributionReadFailure(read);
    if (!read.coverage.complete) throw new AttributionReadPartial(read);
    return read;
  },
  /* A registry that names a new fee wallet is a new read, not a ten-minute-old one. */
  ["attribution-chain", ATTRIBUTION_RULE_VERSION, READ_SHAPE, solanaFeeOwners().map((owner) => `${owner.address}:${owner.endSlot ?? ""}`).join(",")],
  { revalidate: ATTRIBUTION_SHARED_REVALIDATE_S, tags: ["attribution"] },
);

/** Next refuses the platform layer outside a request; that is the signal to read directly. */
const isOutsideNext = (failure: unknown): boolean => failure instanceof Error && /incrementalCache missing/.test(failure.message);

/** A partial or failed read is not kept in the shared copy; this instance answers it for a minute, so a crowd does not re-read the chain per request. */
const PARTIAL_KEEP_MS = 60_000;
let lastPartial: Readonly<{ read: AttributionRead; at: number }> | null = null;

/**
 * The read the public page uses: the deployment's shared copy, ten minutes
 * old at most, and never a failed read kept — a failure is answered as a
 * failure this once and asked again on the next request; a partial read is
 * answered as partial, from this instance, for a minute.
 */
export async function readAttribution(): Promise<AttributionRead> {
  if (lastPartial && Date.now() - lastPartial.at < PARTIAL_KEEP_MS) return lastPartial.read;
  try {
    return await readShared();
  } catch (failure) {
    if (failure instanceof AttributionReadFailure) {
      lastPartial = { read: failure.failure, at: Date.now() };
      return failure.failure;
    }
    if (failure instanceof AttributionReadPartial) {
      lastPartial = { read: failure.read, at: Date.now() };
      return failure.read;
    }
    if (isOutsideNext(failure)) return readAttributionFromChain();
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}
