/**
 * «Стеження за гаманцями» (SOL-R4) — mainnet as Ryntra reads it. A wallet's signatures come from the endpoint whose
 * lists reach back (`launchHistoryEndpoint`: the public operators keep a day or two of them); each transaction from
 * the primary, then the fallback, then that endpoint; the tickers and creators from the Spot catalogue (Jupiter).
 * Reads only.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { launchHistoryEndpoint, launchIndexedEndpoint, type LaunchNetwork } from "../launch/config.server.ts";
import { resolveEndpoints } from "../solana/rpc.ts";
import { readSpotFactsByMint } from "../spot/markets.server.ts";
import { holdingsAcross, type FactsReader, type MintFacts, type RpcCall, type WalletChain } from "./read.ts";
import type { ParsedTransactionLike } from "./trades.ts";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const connections = new Map<string, Connection>();
function connection(url: string): Connection {
  const known = connections.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  connections.set(url, known);
  return known;
}

function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * One transaction as the node keeps it, `jsonParsed`, asked as JSON-RPC: most of a meme trader's transactions are
 * version 1 now (SIMD-0385; measured 21.10 — 10 of 12), which a request capped at version 0 is refused, and the web3.js
 * client of this repository asks for 0. Null when the node does not keep it; a throw when it refused.
 */
async function rawTransaction(url: string, signature: string): Promise<ParsedTransactionLike | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }] }),
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`rpc ${response.status}`);
  const body = (await response.json()) as { result?: ParsedTransactionLike | null; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result ?? null;
}

/**
 * Whether an address is a token's mint, from the chain: an account of the token programs, 82 bytes and more. Asked only
 * when Jupiter did not answer — so a wallet is never followed as a token, nor a token read as a wallet. Null when the
 * chain did not answer either.
 */
export async function isMintAccount(address: string): Promise<boolean | null> {
  try {
    const url = resolveEndpoints("mainnet")[0]!.url;
    const info = await deadline(connection(url).getAccountInfo(new PublicKey(address), "confirmed"), 6_000);
    if (!info) return false;
    return (info.owner.equals(TOKEN_PROGRAM) || info.owner.equals(TOKEN_2022_PROGRAM)) && info.data.length >= 82;
  } catch {
    return null;
  }
}

/* When each node last refused a wallet's token accounts, in this instance: a node that refused rests a minute. */
const refusedAt = new Map<string, number>();
const REST_MS = 60_000;

/** A signature list from one node, at most `ms`. */
async function listOf(url: string, address: string, options: Readonly<{ until?: string; before?: string; limit: number }>, ms: number) {
  const rows = await deadline(connection(url).getSignaturesForAddress(new PublicKey(address), { until: options.until, before: options.before, limit: options.limit }, "confirmed"), ms);
  return rows.map((row) => ({ signature: row.signature, slot: row.slot, blockTime: row.blockTime ?? null, failed: row.err !== null }));
}

const settle = <T,>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => promise.then((value) => ({ ok: true as const, value }), () => ({ ok: false as const }));

/** One JSON-RPC call, twelve seconds at most (Solana's own endpoint takes ten for a cold wallet); a refusal throws with the node's own words. */
const rpcCall: RpcCall = async (url, method, params) => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const body = (await response.json().catch(() => null)) as { result?: unknown; error?: { message?: string } } | null;
  if (!response.ok || !body || body.error) throw new Error(body?.error?.message ?? `rpc ${response.status}`);
  return body.result;
};

/** Mainnet, the way Ryntra reads it: a configured provider first, the public pair otherwise. */
export function productionChain(): WalletChain {
  const endpoints = resolveEndpoints("mainnet").map((endpoint) => endpoint.url);
  /* Only the cluster is read: the list endpoint is the network's, not a launch's. */
  const history = launchHistoryEndpoint({ cluster: "mainnet" } as LaunchNetwork);
  /* A wallet's token accounts is an indexed read: the public primary refuses it, the network's second operator answers —
     and when it refuses a cloud's address (seen on production 21.10), Solana's own public endpoint, then the primary. */
  const indexed = launchIndexedEndpoint({ cluster: "mainnet" } as LaunchNetwork);
  const holdingsNodes = [...new Set([indexed, history, ...endpoints])];
  const readers = [...new Set([...endpoints, history])];
  return {
    async signatures(address, options) {
      const mode = options.before ? "whole" : (options.mode ?? "race");
      /* A provider configured: one node keeps it all. */
      if (history === endpoints[0]) return { rows: await listOf(history, address, options, 12_000), whole: true };
      if (mode === "newest") {
        /* What came since a record read hours ago: the primary keeps it, quickly; the whole history if it will not answer. */
        const quick = await settle(listOf(endpoints[0]!, address, options, 8_000));
        return quick.ok ? { rows: quick.value, whole: false } : { rows: await listOf(history, address, options, 12_000), whole: true };
      }
      if (mode === "whole") {
        /* A creation, or a record read long ago: only the whole history reaches; the newest only when it will not answer —
           and then said to be the newest only. A creation never takes it (the caller reads `whole`). */
        const full = await settle(listOf(history, address, options, 12_000));
        if (full.ok) return { rows: full.value, whole: true };
        if (options.before) throw new Error("the whole history did not answer");
        return { rows: await listOf(endpoints[0]!, address, options, 8_000), whole: false };
      }
      /* A first read: Solana's own endpoint keeps the whole history but from a cloud answers in ten seconds and more
         (measured 21.10) — asked at once with the primary; the whole list if it comes in eight seconds, else the newest. */
      const full = settle(listOf(history, address, options, 12_000));
      const newest = settle(listOf(endpoints[0]!, address, options, 8_000));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const early = await Promise.race([full, new Promise<null>((done) => (timer = setTimeout(() => done(null), 8_000)))]);
      clearTimeout(timer);
      if (early && early.ok) return { rows: early.value, whole: true };
      const quick = await newest;
      if (quick.ok) return { rows: quick.value, whole: false };
      const late = await full;
      if (late.ok) return { rows: late.value, whole: true };
      throw new Error("no node listed the wallet's signatures");
    },
    async transaction(signature) {
      for (const url of readers) {
        try {
          const tx = await rawTransaction(url, signature);
          if (tx) return tx;
        } catch {
          /* The next node: a refusal (429) or a timeout here is not an answer. */
        }
      }
      return null;
    },
    async holdings(wallet, minSlot) {
      /* The nodes in their order, one that refused in the last minute last: it costs its refusal once, not every read —
         and Solana's own endpoint, which also lists signatures, is asked only when the indexed one will not answer. */
      const now = Date.now();
      const resting = (url: string) => now - (refusedAt.get(url) ?? 0) < REST_MS;
      const order = [...holdingsNodes.filter((url) => !resting(url)), ...holdingsNodes.filter(resting)];
      const answer = await holdingsAcross(order, wallet, rpcCall, minSlot);
      for (const url of answer.failed) refusedAt.set(url, Date.now());
      /* No node answered: said in the log with each node's reason — the page says «—», never an empty wallet. */
      if (!answer.held) console.warn(`[wallet-watch] holdings not read for ${wallet.slice(0, 8)}: ${answer.reasons.join("; ")}`);
      return answer.held;
    },
  };
}

/* A mint's facts, kept a minute in this instance: the page polls and the pass runs, Jupiter's keyless budget is small. */
const FACTS_TTL_MS = 60_000;
const factsKept = new Map<string, { value: MintFacts | null; at: number }>();

/** Jupiter's facts of up to a hundred mints in one read (the Spot catalogue), only those not read this minute. */
export const productionFacts: FactsReader = async (mints) => {
  const now = Date.now();
  const missing = mints.filter((mint) => (factsKept.get(mint)?.at ?? 0) + FACTS_TTL_MS < now);
  if (missing.length > 0) {
    const read = await readSpotFactsByMint(missing).catch(() => null);
    if (!read || !read.ok) {
      if (missing.length === mints.length) return null;
    } else {
      const fresh = factsOf(read, missing);
      for (const mint of missing) factsKept.set(mint, { value: fresh.get(mint) ?? null, at: now });
      if (factsKept.size > 5_000) for (const [mint, kept] of factsKept) if (kept.at + FACTS_TTL_MS < now) factsKept.delete(mint);
    }
  }
  const out = new Map<string, MintFacts>();
  for (const mint of mints) {
    const kept = factsKept.get(mint)?.value;
    if (kept) out.set(mint, kept);
  }
  return out;
};

function factsOf(read: Extract<Awaited<ReturnType<typeof readSpotFactsByMint>>, { ok: true }>, mints: readonly string[]): Map<string, MintFacts> {
  const out = new Map<string, MintFacts>();
  for (const mint of mints) {
    const market = read.byMint.get(mint);
    if (!market) continue;
    const facts = read.facts.get(mint);
    const created = facts?.createdAt ?? market.firstPoolAt;
    out.set(mint, {
      symbol: market.symbol,
      name: market.name,
      icon: market.icon,
      priceUsd: market.price,
      liquidityUsd: market.liquidityUsd,
      creator: facts?.dev ?? null,
      createdAt: created ? Math.floor(Date.parse(created) / 1000) : null,
    });
  }
  return out;
}
