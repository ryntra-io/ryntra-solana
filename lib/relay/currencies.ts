/**
 * Which tokens a person may name, and what they actually are.
 *
 * The cross-chain swap grew from a fixed list of ten named pairs to supported
 * assets between supported networks. That is only safe if the product can
 * answer two questions about a token it has never seen: **how many decimals**
 * it has, and **whether it is the token whose name it is wearing**.
 *
 * Both come from Relay's own currency index, which covers all four networks
 * including Solana. Decimals are not negotiable — an 18-decimal reading of a
 * 5-decimal token is a swap of the wrong size — so nothing here guesses one.
 *
 * ## The `verified` flag is the whole point of this module
 *
 * Searching `USDC` on Solana returns the real one and four impostors
 * (`USDC-SOL`, `USDC-BSC`, `USDC-ERC20`, `SOL-USDC`), all with plausible
 * symbols and none of them USDC. Searching `BONK` returns BONK and `BONK2.0`.
 * A picker that lists them as equals is a picker that hands somebody a
 * worthless token with the right name on it — the most ordinary way this
 * product could lose someone money, and it needs no attacker inside our
 * systems.
 *
 * So `verified` travels with every row and every surface must show it. This
 * module never filters the unverified out and never silently prefers the
 * verified one: hiding a token a person actually holds is its own defect. It
 * marks them, and the choice stays with the person, in front of the fact.
 */

import { z } from "zod";

import type { SwapNetwork } from "../swap/catalog.ts";
import { RELAY_API_ORIGIN, RELAY_CHAIN_IDS, relayNativeAddress, swapNetworkOfRelayChain } from "./chains.ts";
import { relayJsonHeaders } from "./http.ts";

export const RELAY_CURRENCIES_PATH = "/currencies/v2";

export type SwapTokenRow = Readonly<{
  network: SwapNetwork;
  /** Mint on Solana, contract on an EVM chain, the native sentinel for the chain's coin. */
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  /**
   * Whether the provider's index vouches for this being the token its symbol
   * claims. `false` is not "bad" — it is "nobody has checked", which is the
   * thing a person must be told rather than protected from.
   */
  verified: boolean;
  /** True for the chain's own coin, which has no contract to inspect. */
  native: boolean;
}>;

const RowSchema = z
  .object({
    chainId: z.number(),
    address: z.string().min(1),
    symbol: z.string().min(1),
    name: z.string().optional(),
    decimals: z.number().int().min(0).max(36),
    metadata: z.object({ verified: z.boolean().optional() }).passthrough().optional(),
  })
  .passthrough();

export type RelayCurrencyDependencies = Readonly<{
  /**
   * Ryntra's Relay API key, resolved by the server route that calls this.
   *
   * Not read here: this module is importable by a surface a browser loads, and a
   * module a browser may import is not a module that reads the environment. It
   * is sent so that per-key request history in the Relay Dashboard can tell
   * production apart from a preview deploy, and so this call counts against
   * Ryntra's own rate limit rather than the anonymous pool.
   */
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  origin?: string;
  timeoutMs?: number;
}>;

export type SwapTokenLookup =
  | Readonly<{ ok: true; tokens: readonly SwapTokenRow[] }>
  | Readonly<{ ok: false; code: "TRANSPORT" | "HTTP_ERROR" | "UNREADABLE" | "RATE_LIMITED"; reason: string }>;

async function ask(body: Record<string, unknown>, deps: RelayCurrencyDependencies): Promise<SwapTokenLookup> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(RELAY_CURRENCIES_PATH, deps.origin ?? RELAY_API_ORIGIN).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8_000);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: relayJsonHeaders({ apiKey: deps.apiKey }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    return { ok: false, code: "TRANSPORT", reason: error instanceof Error ? error.message : String(error) };
  }
  clearTimeout(timer);
  if (response.status === 429) return { ok: false, code: "RATE_LIMITED", reason: "The token index is rate-limiting right now." };
  if (!response.ok) return { ok: false, code: "HTTP_ERROR", reason: `The token index answered HTTP ${response.status}.` };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: "UNREADABLE", reason: "The token index did not answer with JSON." };
  }
  /* Relay answers an array of arrays, one per requested chain. */
  const flat = Array.isArray(payload) ? payload.flat() : [];
  const tokens: SwapTokenRow[] = [];
  for (const candidate of flat) {
    const parsed = RowSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const network = swapNetworkOfRelayChain(parsed.data.chainId);
    /* A row for a chain this product does not serve is dropped rather than
       shown: a token a person cannot reach is not a choice. */
    if (!network) continue;
    const address = parsed.data.address;
    tokens.push({
      network,
      address,
      symbol: parsed.data.symbol,
      name: parsed.data.name ?? null,
      decimals: parsed.data.decimals,
      verified: parsed.data.metadata?.verified === true,
      native: address.toLowerCase() === relayNativeAddress(network).toLowerCase(),
    });
  }
  return { ok: true, tokens };
}

/**
 * Tokens matching what a person typed, on one network.
 *
 * The term may be a symbol, a name or a whole address — the index takes all
 * three, and a pasted contract is how somebody reaches a token too new or too
 * small to be indexed by name.
 */
export async function searchSwapTokens(
  args: Readonly<{ network: SwapNetwork; term: string; limit?: number }>,
  deps: RelayCurrencyDependencies = {},
): Promise<SwapTokenLookup> {
  const term = args.term.trim();
  if (term.length === 0) return { ok: true, tokens: [] };
  return ask(
    {
      chainIds: [RELAY_CHAIN_IDS[args.network]],
      term,
      limit: Math.min(Math.max(args.limit ?? 20, 1), 50),
      useExternalSearch: true,
    },
    deps,
  );
}

/**
 * One token by its exact address, or null when the index does not know it.
 *
 * This is the call that decides an amount: a swap is built from the decimals
 * it returns. A token the index cannot describe is refused rather than
 * assumed, because every default here is wrong for some token.
 */
export async function resolveSwapToken(
  args: Readonly<{ network: SwapNetwork; address: string }>,
  deps: RelayCurrencyDependencies = {},
): Promise<SwapTokenRow | null> {
  const wanted = args.address.trim();
  if (wanted.length === 0) return null;
  const result = await ask(
    { chainIds: [RELAY_CHAIN_IDS[args.network]], term: wanted, limit: 10, useExternalSearch: true },
    deps,
  );
  if (!result.ok) return null;
  return (
    result.tokens.find((token) => token.network === args.network && token.address.toLowerCase() === wanted.toLowerCase()) ?? null
  );
}
