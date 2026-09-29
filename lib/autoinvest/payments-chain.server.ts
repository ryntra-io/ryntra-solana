/**
 * «З кожної оплати» — reading a wallet's USDC movements from the chain
 * (`RYN-PAY-TRIGGERS-001`, canon v5.5 В38) — server only.
 *
 * The one question: which transactions touched the wallet's USDC account
 * since the last one read, and what did each do? The answer feeds the watch
 * (`./payment-watch.ts`); what counts as a payment is `./payments.ts`.
 *
 * ## Why every endpoint, and the chain of balances
 *
 * Public operators disagree about history (measured 2026-09-15, the public
 * RPC history notes): one answers `getSignaturesForAddress` with the last one
 * or two signatures and no hint that there are more, one keeps every
 * signature and forgets old transactions, the archive keeps everything and
 * rate-limits. So the signatures are the **union** over every endpoint, a
 * transaction is asked of each until one returns it, and the read proves
 * itself: the account's balance before each transaction must be its balance
 * after the one before. A read that cannot prove it is marked incomplete —
 * the watch says so and the person sees it — instead of passing a smaller
 * list for the whole.
 *
 * ## Where it stops
 *
 * At most `PAYMENT_TRANSACTIONS_PER_PASS` transactions a pass, the oldest
 * first; the next pass (five minutes later) continues from where this one
 * stopped. A transaction nobody returns stops the read there — nothing after
 * it is read on this pass, so nothing is counted out of order.
 */

import { readBoundedRpcResponse, resolveEndpoints } from "../solana/rpc.ts";
import { accountBalances, type ChainTokenBalance, type ChainTransaction } from "./payments.ts";

/** The archive endpoint keeps the whole history; the public operators in `../solana/rpc.ts` do not always. */
export const PAYMENTS_ARCHIVE_ENV = "RYNTRA_SOLANA_RPC_MAINNET_ARCHIVE";
const DEFAULT_ARCHIVE_ENDPOINT = "https://api.mainnet-beta.solana.com";

/** How many transactions one pass reads at most — the oldest first; the next pass, five minutes later, continues. */
export const PAYMENT_TRANSACTIONS_PER_PASS = 12;
const SIGNATURE_PAGE = 50;
const SIGNATURE_PAGES = 3;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Between calls, so a read never looks like a burst to a public operator. */
const PACE_MS = 120;
/** Backoff after a rate limit; anything else is an answer and goes to the next endpoint. */
const RATE_LIMIT_WAITS_MS = [1_000, 2_500] as const;

export type ChainEndpoint = Readonly<{ host: string; url: string }>;
export type RpcCall = <T>(endpoint: ChainEndpoint, method: string, params: readonly unknown[]) => Promise<T>;
export type ChainTransport = Readonly<{ endpoints: readonly ChainEndpoint[]; call: RpcCall; pace?: () => Promise<void> }>;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-endpoint";
  }
}

/** Primary, fallback, then the archive — each once, in that order. */
export function paymentEndpoints(env: NodeJS.ProcessEnv = process.env): readonly ChainEndpoint[] {
  const list: ChainEndpoint[] = resolveEndpoints("mainnet").map((endpoint) => ({ host: endpoint.host, url: endpoint.url }));
  const archiveUrl = env[PAYMENTS_ARCHIVE_ENV]?.trim() || DEFAULT_ARCHIVE_ENDPOINT;
  if (!list.some((endpoint) => endpoint.host === hostOf(archiveUrl))) list.push({ host: hostOf(archiveUrl), url: archiveUrl });
  return list;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class RateLimited extends Error {}

async function callOnce<T>(endpoint: ChainEndpoint, method: string, params: readonly unknown[]): Promise<T> {
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

/** The transport the tick uses: plain JSON-RPC over HTTPS, retried through a rate limit and never through anything else. */
export function httpTransport(env: NodeJS.ProcessEnv = process.env): ChainTransport {
  return {
    endpoints: paymentEndpoints(env),
    call: async <T>(endpoint: ChainEndpoint, method: string, params: readonly unknown[]): Promise<T> => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await callOnce<T>(endpoint, method, params);
        } catch (failure) {
          if (!(failure instanceof RateLimited) || attempt >= RATE_LIMIT_WAITS_MS.length) throw failure;
          await sleep(RATE_LIMIT_WAITS_MS[attempt]);
        }
      }
    },
    pace: () => sleep(PACE_MS),
  };
}

type SignatureInfo = Readonly<{ signature: string; slot: number; blockTime: number | null; err: unknown }>;

type ParsedInstruction = Readonly<{ program?: string; programId?: string; parsed?: unknown }>;
type RpcTransaction = Readonly<{
  slot: number;
  blockTime: number | null;
  meta: Readonly<{
    err: unknown;
    preBalances?: readonly number[];
    postBalances?: readonly number[];
    preTokenBalances?: readonly ChainTokenBalance[];
    postTokenBalances?: readonly ChainTokenBalance[];
    innerInstructions?: readonly Readonly<{ instructions?: readonly ParsedInstruction[] }>[];
  }> | null;
  transaction: Readonly<{ message: Readonly<{ accountKeys: readonly Readonly<{ pubkey: string; signer: boolean }>[]; instructions?: readonly ParsedInstruction[] }> }>;
}>;

const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);

function memoOf(instruction: ParsedInstruction): string | null {
  const isMemo = instruction.program === "spl-memo" || (typeof instruction.programId === "string" && MEMO_PROGRAMS.has(instruction.programId));
  return isMemo && typeof instruction.parsed === "string" ? instruction.parsed : null;
}

/** A parsed transaction trimmed to what the classification reads. */
export function trimTransaction(signature: string, tx: RpcTransaction): ChainTransaction | null {
  if (!tx.meta) return null;
  const outer = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta.innerInstructions ?? []).flatMap((group) => group.instructions ?? []);
  const memos = [...outer, ...inner].map(memoOf).filter((memo): memo is string => memo !== null);
  const trimBalance = (entry: ChainTokenBalance): ChainTokenBalance => ({
    accountIndex: entry.accountIndex,
    mint: entry.mint,
    ...(entry.owner ? { owner: entry.owner } : {}),
    uiTokenAmount: { amount: entry.uiTokenAmount.amount, decimals: entry.uiTokenAmount.decimals },
  });
  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    failed: tx.meta.err !== null && tx.meta.err !== undefined,
    accountKeys: tx.transaction.message.accountKeys.map((key) => ({ pubkey: key.pubkey, signer: key.signer === true })),
    preBalances: tx.meta.preBalances ?? [],
    postBalances: tx.meta.postBalances ?? [],
    preTokenBalances: (tx.meta.preTokenBalances ?? []).map(trimBalance),
    postTokenBalances: (tx.meta.postTokenBalances ?? []).map(trimBalance),
    memos,
  };
}

export type MovementsCursor = Readonly<{ signature: string; slot: number }>;

export type MovementsRead =
  | Readonly<{
      ok: true;
      /** Oldest first: the transactions newer than the cursor, at most one pass's worth. */
      transactions: readonly ChainTransaction[];
      /** The newest transaction read — the next pass reads after it; the input cursor when nothing new was read. */
      cursor: MovementsCursor | null;
      /** The account's balance after the cursor's transaction, in raw units; null when it could not be said. */
      balanceRaw: string | null;
      /** Every endpoint's union was read and the chain of balances held from the cursor to the newest transaction. */
      complete: boolean;
      /** More transactions wait beyond this pass's ceiling. */
      more: boolean;
      /** Hosts that answered, never a URL: a provider URL can carry a key. */
      hosts: readonly string[];
    }>
  | Readonly<{ ok: false; reason: string }>;

/** One endpoint's list of signatures after the cursor, newest first, a page or three; null when it did not answer. */
async function signaturesFrom(transport: ChainTransport, endpoint: ChainEndpoint, account: string, cursor: MovementsCursor | null): Promise<readonly SignatureInfo[] | null> {
  try {
    const rows: SignatureInfo[] = [];
    let before: string | undefined;
    for (let page = 0; page < SIGNATURE_PAGES; page += 1) {
      const options: Record<string, unknown> = { limit: SIGNATURE_PAGE, commitment: "finalized" };
      if (cursor) options.until = cursor.signature;
      if (before) options.before = before;
      const found = await transport.call<readonly SignatureInfo[]>(endpoint, "getSignaturesForAddress", [account, options]);
      await transport.pace?.();
      rows.push(...found);
      /* The first read of a wallet looks one page back; after that, pages continue until the cursor. */
      if (!cursor || found.length < SIGNATURE_PAGE) break;
      before = found[found.length - 1].signature;
    }
    return rows;
  } catch {
    /* One silent operator is the reason the others are asked. */
    return null;
  }
}

/** The union over every endpoint, asked at once — different operators, so nothing looks like a burst to any one of them. */
async function readSignatures(transport: ChainTransport, account: string, cursor: MovementsCursor | null, hosts: Set<string>): Promise<Readonly<{ found: Map<string, SignatureInfo & { order: number }>; answered: number }>> {
  const lists = await Promise.all(transport.endpoints.map((endpoint) => signaturesFrom(transport, endpoint, account, cursor)));
  const found = new Map<string, SignatureInfo & { order: number }>();
  let answered = 0;
  lists.forEach((rows, at) => {
    if (rows === null) return;
    answered += 1;
    hosts.add(transport.endpoints[at].host);
    rows.forEach((row, index) => {
      if (!found.has(row.signature)) found.set(row.signature, { ...row, order: index });
    });
  });
  return { found, answered };
}

async function readTransaction(transport: ChainTransport, signature: string, hosts: Set<string>): Promise<ChainTransaction | null> {
  for (const endpoint of transport.endpoints) {
    try {
      const tx = await transport.call<RpcTransaction | null>(endpoint, "getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
      await transport.pace?.();
      const trimmed = tx ? trimTransaction(signature, tx) : null;
      if (!trimmed) continue;
      hosts.add(endpoint.host);
      return trimmed;
    } catch {
      /* Ask the next one. */
    }
  }
  return null;
}

/** The account's balance now, in raw units; "0" for an account that does not exist yet; null when nobody could say. */
async function readBalanceNow(transport: ChainTransport, account: string, hosts: Set<string>): Promise<string | null> {
  for (const endpoint of transport.endpoints) {
    try {
      const result = await transport.call<{ value?: { amount?: string } }>(endpoint, "getTokenAccountBalance", [account, { commitment: "finalized" }]);
      await transport.pace?.();
      hosts.add(endpoint.host);
      return typeof result?.value?.amount === "string" && /^\d+$/.test(result.value.amount) ? result.value.amount : null;
    } catch (failure) {
      /* An account nobody opened yet holds nothing: that is an answer, not a failure. */
      if (failure instanceof Error && /could not find account|invalid param/i.test(failure.message)) return "0";
    }
  }
  return null;
}

/**
 * The transactions that touched `account` after `cursor` — or, on a wallet's
 * first read, after `sinceSec` — oldest first, with the chain of balances
 * checked from `balanceRaw`.
 */
export async function readUsdcMovements(
  input: Readonly<{
    account: string;
    cursor: MovementsCursor | null;
    balanceRaw: string | null;
    sinceSec: number;
    seen?: ReadonlySet<string>;
    /** A wall-clock instant (ms) past which no further transaction is read on this pass — the tick's own budget; the next pass continues. */
    deadlineMs?: number;
  }>,
  transport: ChainTransport = httpTransport(),
): Promise<MovementsRead> {
  const hosts = new Set<string>();
  const { found, answered } = await readSignatures(transport, input.account, input.cursor, hosts);
  if (answered === 0) return { ok: false, reason: "No endpoint answered the wallet's USDC history." };

  const all = [...found.values()];
  /* The newest signature of all, whatever its time — the cursor a first read starts from when nothing new happened. */
  const newestOverall = all.reduce<(SignatureInfo & { order: number }) | null>((best, row) => (!best || row.slot > best.slot || (row.slot === best.slot && row.order < best.order) ? row : best), null);
  const fresh = all
    .filter((row) => row.err === null || row.err === undefined)
    /* A transaction an earlier pass read is never read again — an endpoint that ignores `until` cannot make one count twice. */
    .filter((row) => row.signature !== input.cursor?.signature && !input.seen?.has(row.signature))
    .filter((row) => (input.cursor ? row.slot >= input.cursor.slot : row.blockTime !== null && row.blockTime >= input.sinceSec))
    /* Oldest first: by slot, and within one slot the order the endpoint listed them in, reversed (it lists newest first). */
    .sort((a, b) => a.slot - b.slot || b.order - a.order);

  if (fresh.length === 0) {
    if (input.cursor) return { ok: true, transactions: [], cursor: input.cursor, balanceRaw: input.balanceRaw, complete: true, more: false, hosts: [...hosts] };
    /* A first read with nothing new: start the chain of balances now, from the newest signature there is. */
    const balanceRaw = await readBalanceNow(transport, input.account, hosts);
    return {
      ok: true,
      transactions: [],
      cursor: newestOverall ? { signature: newestOverall.signature, slot: newestOverall.slot } : null,
      balanceRaw,
      complete: balanceRaw !== null,
      more: false,
      hosts: [...hosts],
    };
  }

  const batch = fresh.slice(0, PAYMENT_TRANSACTIONS_PER_PASS);
  const transactions: ChainTransaction[] = [];
  let cursor = input.cursor;
  let running: bigint | null = input.balanceRaw !== null && /^\d+$/.test(input.balanceRaw) ? BigInt(input.balanceRaw) : null;
  let complete = true;
  let stopped = false;
  for (const row of batch) {
    /* Out of the pass's time: what was read stands, and the next pass continues from it — nothing skipped, nothing counted out of order. */
    if (input.deadlineMs !== undefined && Date.now() > input.deadlineMs) {
      stopped = true;
      break;
    }
    const tx = await readTransaction(transport, row.signature, hosts);
    if (!tx) {
      /* Nothing after an unread transaction is read on this pass: the next one continues from here. */
      complete = false;
      stopped = true;
      break;
    }
    const balance = accountBalances(tx, input.account);
    if (balance.touched) {
      /* The balance before this transaction must be the balance after the last one read: otherwise one was skipped. */
      if (running !== null && balance.pre !== running) complete = false;
      running = balance.post;
    }
    transactions.push(tx);
    cursor = { signature: tx.signature, slot: tx.slot };
  }
  return {
    ok: true,
    transactions,
    cursor,
    balanceRaw: running === null ? null : running.toString(),
    complete,
    more: stopped || fresh.length > batch.length,
    hosts: [...hosts],
  };
}
