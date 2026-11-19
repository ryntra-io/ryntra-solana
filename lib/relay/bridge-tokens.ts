/**
 * The coins of one chain, from Relay's own index: «Брідж має з любої монети в любу кидати».
 *
 * `POST /currencies/v2` answers for every chain Relay carries — Bitcoin and Tron as well as Base — by ticker, by name or
 * by a pasted address, and with an empty term its own default list (the coins it features first). Every row keeps
 * Relay's `verified`: a search for `USDC` returns the real one and its impostors, and the page shows the mark rather
 * than choosing for the person. Decimals are never guessed — a row without them is no choice.
 */

import { RELAY_API_ORIGIN } from "./chains.ts";
import { normalizeBridgeToken, type BridgeToken } from "./bridge-chains.ts";
import { relayJsonHeaders } from "./http.ts";

export type BridgeTokenLookup =
  | Readonly<{ ok: true; tokens: readonly BridgeToken[] }>
  | Readonly<{ ok: false; code: "TRANSPORT" | "HTTP_ERROR" | "UNREADABLE" | "RATE_LIMITED"; reason: string }>;

export type BridgeTokenDependencies = Readonly<{
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  origin?: string;
  timeoutMs?: number;
}>;

/** The body Relay is asked: a term searches (outside sources too, so a pasted address finds a new coin); none lists. */
export function bridgeTokenQuery(args: Readonly<{ chainId: number; term?: string; limit?: number; external?: boolean }>): Record<string, unknown> {
  const term = (args.term ?? "").trim();
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 50);
  return term ? { chainIds: [args.chainId], term, limit, useExternalSearch: args.external !== false } : { chainIds: [args.chainId], defaultList: true, limit };
}

/** Relay's answer — one array, or one per chain asked — as coins of the chain asked; foreign rows are dropped. */
export function readBridgeTokens(payload: unknown, chainId: number): BridgeToken[] {
  const flat = Array.isArray(payload) ? payload.flat() : [];
  const seen = new Set<string>();
  const tokens: BridgeToken[] = [];
  for (const raw of flat) {
    const token = normalizeBridgeToken(raw, chainId);
    if (!token || token.chainId !== chainId) continue;
    const key = token.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

export async function searchBridgeTokens(args: Readonly<{ chainId: number; term?: string; limit?: number; external?: boolean }>, deps: BridgeTokenDependencies = {}): Promise<BridgeTokenLookup> {
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(new URL("/currencies/v2", deps.origin ?? RELAY_API_ORIGIN).toString(), {
      method: "POST",
      headers: relayJsonHeaders({ apiKey: deps.apiKey }),
      body: JSON.stringify(bridgeTokenQuery(args)),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000),
    });
  } catch (error) {
    return { ok: false, code: "TRANSPORT", reason: error instanceof Error ? error.message : String(error) };
  }
  if (response.status === 429) return { ok: false, code: "RATE_LIMITED", reason: "The coin index is busy right now." };
  if (!response.ok) return { ok: false, code: "HTTP_ERROR", reason: `The coin index answered HTTP ${response.status}.` };
  try {
    return { ok: true, tokens: readBridgeTokens(await response.json(), args.chainId) };
  } catch {
    return { ok: false, code: "UNREADABLE", reason: "The coin index did not answer with JSON." };
  }
}

/**
 * One coin by its exact address on a chain, or null when Relay's index does not know it. `external: false` keeps to
 * Relay's own index (the logo route): outside sources carry metadata their creators wrote.
 */
export async function findBridgeToken(args: Readonly<{ chainId: number; address: string; external?: boolean }>, deps: BridgeTokenDependencies = {}): Promise<BridgeToken | null> {
  const wanted = args.address.trim();
  if (!wanted) return null;
  const found = await searchBridgeTokens({ chainId: args.chainId, term: wanted, limit: 10, external: args.external }, deps);
  if (!found.ok) return null;
  const hex = wanted.startsWith("0x");
  return found.tokens.find((token) => (hex ? token.address.toLowerCase() === wanted.toLowerCase() : token.address === wanted)) ?? null;
}
