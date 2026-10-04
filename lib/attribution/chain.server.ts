/**
 * The chain read behind the public statistics — server only.
 *
 * This module answers one question from the chain alone: *which transactions
 * credited Ryntra's referral token accounts, and what did each of them do?*
 * The rule that turns a transaction into an operation is `rule.ts`; this file
 * only fetches and remembers.
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
import {
  ATTRIBUTION_RULE_VERSION,
  aggregateOperations,
  attributeSolanaTransaction,
  historyIsComplete,
  ryntraShareRaw,
  type AttributionTransactionInput,
  type AttributionVerdict,
  type TokenBalanceEntry,
} from "./rule.ts";

/** Solana Labs keeps the whole transaction history; the public operators in `rpc.ts` do not always. */
export const ARCHIVE_ENDPOINT_ENV = "RYNTRA_SOLANA_RPC_MAINNET_ARCHIVE";
const DEFAULT_ARCHIVE_ENDPOINT = "https://api.mainnet-beta.solana.com";

export const MAX_TRANSACTIONS_PER_READ = 500;
export const ATTRIBUTION_SHARED_REVALIDATE_S = 600;
const SIGNATURE_PAGE = 1000;
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"] as const;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Between calls to one endpoint, so a read never looks like a burst to a public operator. */
const PACE_MS = 200;

export type ReferralTokenAccount = Readonly<{ address: string; mint: string; decimals: number; amountRaw: string }>;

export type AttributionOperationRow = Readonly<{
  signature: string;
  slot: number;
  blockTime: number | null;
  taker: string;
  feeCredits: readonly Readonly<{ mint: string; decimals: number; amountRaw: string }>[];
  legs: readonly Readonly<{ mint: string; decimals: number; deltaRaw: string }>[];
  valueUsdMicros: string | null;
}>;

export type AttributionChainRead = Readonly<{
  ok: true;
  ruleVersion: string;
  referralAccount: string;
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
    mismatches: readonly Readonly<{ mint: string; seenRaw: string; balanceRaw: string }>[];
  }>;
  operations: readonly AttributionOperationRow[];
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

/** The token accounts the referral account owns, with their balances now. */
export async function readReferralTokenAccounts(
  referralAccount: string,
  endpoints: readonly Endpoint[],
  used: Set<string>,
): Promise<readonly ReferralTokenAccount[]> {
  let lastFailure: unknown = null;
  for (const endpoint of endpoints) {
    try {
      const accounts: ReferralTokenAccount[] = [];
      for (const programId of TOKEN_PROGRAMS) {
        const result = await call<{ value: readonly ParsedTokenAccount[] }>(endpoint, "getTokenAccountsByOwner", [
          referralAccount,
          { programId },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ]);
        for (const entry of result.value) {
          const info = entry.account.data.parsed.info;
          accounts.push({ address: entry.pubkey, mint: info.mint, decimals: info.tokenAmount.decimals, amountRaw: info.tokenAmount.amount });
        }
        await sleep(PACE_MS);
      }
      used.add(endpoint.host);
      return accounts.sort((left, right) => (left.mint < right.mint ? -1 : 1));
    } catch (failure) {
      lastFailure = failure;
    }
  }
  throw lastFailure instanceof Error ? lastFailure : new Error("No endpoint listed the referral token accounts.");
}

type SignatureInfo = Readonly<{ signature: string; slot: number; blockTime: number | null; err: unknown }>;

/**
 * Every signature that touched the accounts, as the union over the endpoints.
 *
 * An endpoint that answers a short list is not wrong about the signatures it
 * names, only silent about the rest; the union keeps what each one knows and
 * the balance check below decides whether the whole was seen.
 */
export async function readSignatureHistory(
  accounts: readonly ReferralTokenAccount[],
  endpoints: readonly Endpoint[],
  used: Set<string>,
): Promise<Map<string, SignatureInfo>> {
  const seen = new Map<string, SignatureInfo>();
  let answered = 0;
  for (const endpoint of endpoints) {
    try {
      for (const account of accounts) {
        let before: string | undefined;
        for (;;) {
          const page = await call<readonly SignatureInfo[]>(endpoint, "getSignaturesForAddress", [
            account.address,
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
  if (answered === 0) throw new Error("No endpoint answered the signature history of the referral token accounts.");
  return seen;
}

type RpcTransaction = Readonly<{
  slot: number;
  blockTime: number | null;
  meta: Readonly<{ err: unknown; preTokenBalances?: readonly TokenBalanceEntry[]; postTokenBalances?: readonly TokenBalanceEntry[] }> | null;
  transaction: Readonly<{ message: Readonly<{ accountKeys: readonly Readonly<{ pubkey: string; signer: boolean }>[] }> }>;
}>;

/** Finalized transactions never change: once trimmed, kept for the life of the process. */
const transactionMemory = new Map<string, AttributionTransactionInput>();

export function resetAttributionMemory(): void {
  transactionMemory.clear();
}

async function readTransaction(signature: string, endpoints: readonly Endpoint[], used: Set<string>): Promise<AttributionTransactionInput | null> {
  const kept = transactionMemory.get(signature);
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
        preTokenBalances: (tx.meta.preTokenBalances ?? []).map(trimBalance),
        postTokenBalances: (tx.meta.postTokenBalances ?? []).map(trimBalance),
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

function trimBalance(entry: TokenBalanceEntry): TokenBalanceEntry {
  return {
    accountIndex: entry.accountIndex,
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

export function readAttributionFromChain(
  deps: Readonly<{ env?: NodeJS.ProcessEnv; now?: () => Date; referralAccount?: string | null }> = {},
): Promise<AttributionRead> {
  if (deps.referralAccount !== undefined || deps.env !== undefined) return readAttributionOnce(deps);
  if (inflight) return inflight;
  inflight = readAttributionOnce(deps).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function readAttributionOnce(
  deps: Readonly<{ env?: NodeJS.ProcessEnv; now?: () => Date; referralAccount?: string | null }> = {},
): Promise<AttributionRead> {
  const env = deps.env ?? process.env;
  const referralAccount = deps.referralAccount === undefined ? resolveServiceFeeConfig(env).jupiterReferralAccount : deps.referralAccount;
  if (!referralAccount) return { ok: false, code: "NOT_CONFIGURED", reason: "No Jupiter referral account is configured, so nothing on chain is Ryntra's to count." };
  const endpoints = attributionEndpoints(env);
  const used = new Set<string>();
  const readAt = (deps.now ?? (() => new Date()))().toISOString();

  let accounts: readonly ReferralTokenAccount[];
  let history: Map<string, SignatureInfo>;
  try {
    accounts = await readReferralTokenAccounts(referralAccount, endpoints, used);
    history = await readSignatureHistory(accounts, endpoints, used);
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }

  const ordered = [...history.values()].sort((left, right) => left.slot - right.slot || (left.signature < right.signature ? -1 : 1));
  const truncated = ordered.length > MAX_TRANSACTIONS_PER_READ;
  const toRead = truncated ? ordered.slice(-MAX_TRANSACTIONS_PER_READ) : ordered;
  const verdicts: AttributionVerdict[] = [];
  let missing = 0;
  for (const info of toRead) {
    const transaction = await readTransaction(info.signature, endpoints, used);
    if (!transaction) {
      missing += 1;
      continue;
    }
    verdicts.push(attributeSolanaTransaction(transaction, referralAccount));
  }
  if (verdicts.length === 0 && missing > 0) {
    return { ok: false, code: "UNREADABLE", reason: `${missing} transaction(s) of the referral token accounts could not be read from any endpoint.` };
  }

  let shareBps: number | null = null;
  try {
    shareBps = await readJupiterPartnerShareBps(createSolanaRpcHandle({ network: "mainnet" }));
  } catch {
    shareBps = null;
  }

  const operations = verdicts.flatMap((verdict) => (verdict.attributable ? [verdict.operation] : []));
  const totals = aggregateOperations(operations);
  const completeness = historyIsComplete(verdicts, accounts);
  return {
    ok: true,
    ruleVersion: ATTRIBUTION_RULE_VERSION,
    referralAccount,
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
        ryntraRaw: shareBps === null ? null : ryntraShareRaw(fee.grossRaw, shareBps).toString(),
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
      truncated,
      mismatches: completeness.mismatches.map((row) => ({ mint: row.mint, seenRaw: row.seenRaw.toString(), balanceRaw: row.balanceRaw.toString() })),
    },
    operations: operations.map((operation) => ({
      signature: operation.signature,
      slot: operation.slot,
      blockTime: operation.blockTime,
      taker: operation.taker,
      feeCredits: operation.feeCredits.map((credit) => ({ mint: credit.mint, decimals: credit.decimals, amountRaw: credit.deltaRaw.toString() })),
      legs: operation.legs.map((leg) => ({ mint: leg.mint, decimals: leg.decimals, deltaRaw: leg.deltaRaw.toString() })),
      valueUsdMicros: operation.valueUsdMicros === null ? null : operation.valueUsdMicros.toString(),
    })),
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
  ["attribution-chain", ATTRIBUTION_RULE_VERSION],
  { revalidate: ATTRIBUTION_SHARED_REVALIDATE_S, tags: ["attribution"] },
);

/** Next refuses the platform layer outside a request; that is the signal to read directly. */
const isOutsideNext = (failure: unknown): boolean => failure instanceof Error && /incrementalCache missing/.test(failure.message);

/**
 * The read the public page uses: the deployment's shared copy, ten minutes
 * old at most, and never a failed read kept — a failure is answered as a
 * failure this once and asked again on the next request.
 */
export async function readAttribution(): Promise<AttributionRead> {
  try {
    return await readShared();
  } catch (failure) {
    if (failure instanceof AttributionReadFailure) return failure.failure;
    if (failure instanceof AttributionReadPartial) return failure.read;
    if (isOutsideNext(failure)) return readAttributionFromChain();
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}
