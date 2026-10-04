/**
 * Base mainnet, read-only.
 *
 * Base did not exist anywhere in this repository until the bridge to Base — no
 * RPC, no ABI, no chain entry — and its absence was a recorded decision rather
 * than an oversight. It enters now for one reason: a CCTP burn on Solana is
 * only half a transfer, and the other half lands on Base. A bridge that cannot
 * read the destination cannot say the money arrived; it can only repeat what a
 * provider told it, and a provider's word is not evidence.
 *
 * **Nothing here writes.** There is no signer, no `eth_sendRawTransaction` and
 * no account. Every method below is a read, and the module exports no way to
 * express anything else — the destination mint of a canary transfer is
 * submitted from the signer's own wallet, not from this process.
 *
 * ## Three operators, and they are not interchangeable
 *
 * Solana's handle holds an ordered pair because a second operator is what makes
 * a disagreement visible. Base needs the same, with a wrinkle the Solana side
 * does not have: the free public Base endpoints differ in *what history they
 * hold*, and treating them as equivalent produces a confident wrong answer
 * rather than an error. Each endpoint therefore declares its own limits, and
 * the reads below honour them:
 *
 * - `mainnet.base.org` — the Base team's own endpoint. Archive; `eth_getLogs`
 *   accepts a 10,000-block span and refuses more with a named JSON-RPC error.
 * - `base.drpc.org` — dRPC, a different operator with a different node stack.
 *   Archive, but on the keyless tier a 10,000-block span times out where 5,000
 *   answers, so its declared span is the one that actually works.
 * - `base-rpc.publicnode.com` — PublicNode/Allnodes. **Not an archive node.** It
 *   serves the most recent 100 blocks and refuses anything older, which on
 *   Base's two-second blocks is a little over three minutes. It is a fine third
 *   opinion about the head and useless for finding a mint from an hour ago.
 *
 * Those three limits were measured against the live chain, not read off a
 * pricing page, and the 100-block boundary was found by binary search: head−99
 * answers and head−100 refuses. It is recorded here because a fallback that
 * silently holds no history is worse than no fallback at all.
 *
 * One honest caveat this module cannot fix: all three terminate TLS behind the
 * same CDN. They are independent at the node-operator layer, which is the layer
 * that matters for disagreement about chain state, and not independent against
 * a CDN-wide outage.
 *
 * ## Ethereum, on the same handle
 *
 * Since 2026-09-05 the module serves a second EVM chain rather than copying
 * it. A handle now carries a *chain profile* — id, chain id, CAIP-2 reference,
 * label — and every read is the same read against whichever chain the handle
 * names. Nothing Base-specific changed: the default Base endpoints, their
 * measured limits and the `RYNTRA_BASE_RPC_*` overrides are exactly what they
 * were, and `createBaseRpcHandle()` with no chain still returns a Base handle.
 *
 * The keyless Ethereum endpoints were measured the same way on 2026-09-05,
 * against `MessageTransmitterV2` logs, because Ethereum's free tier is far
 * poorer than Base's and most candidates fail in ways a pricing page does not
 * mention:
 *
 * - `mainnet.gateway.tenderly.co` — Tenderly's public gateway. Archive; a
 *   50,000-block `eth_getLogs` answered in under a second. The declared span
 *   is held at 10,000 so a widened window never leans on one operator's
 *   generosity.
 * - `rpc.mevblocker.io` — MEV Blocker, run by a different operator. Archive;
 *   10,000 blocks answers and 50,000 is refused with a named limit.
 * - `ethereum-rpc.publicnode.com` — PublicNode/Allnodes. **Not an archive
 *   node** on the keyless tier: a 100-block span answers and a 1,000-block span
 *   is refused with "archive requests require a personal token". On twelve-
 *   second blocks that window is twenty minutes.
 *
 * Rejected the same day, with the reason: `eth.drpc.org` times out on the free
 * plan for even a 100-block filtered query; `cloudflare-eth.com` returned an
 * internal error to every read; `rpc.flashbots.net` whitelists no `eth_call`;
 * `eth-mainnet.public.blastapi.io` caps logs at 10 blocks; `eth-pokt.nodies.app`
 * at 50; `rpc.ankr.com/eth` and `api.zan.top` want a key.
 */

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_MAINNET_CHAIN_REF = "eip155:8453" as const;
export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const ETHEREUM_MAINNET_CHAIN_REF = "eip155:1" as const;
export const ROBINHOOD_MAINNET_CHAIN_ID = 4663;
export const ROBINHOOD_MAINNET_CHAIN_REF = "eip155:4663" as const;
export const ARBITRUM_MAINNET_CHAIN_ID = 42161;
export const ARBITRUM_MAINNET_CHAIN_REF = "eip155:42161" as const;
export const OPTIMISM_MAINNET_CHAIN_ID = 10;
export const OPTIMISM_MAINNET_CHAIN_REF = "eip155:10" as const;
export const POLYGON_MAINNET_CHAIN_ID = 137;
export const POLYGON_MAINNET_CHAIN_REF = "eip155:137" as const;
export const BNB_MAINNET_CHAIN_ID = 56;
export const BNB_MAINNET_CHAIN_REF = "eip155:56" as const;

/**
 * The EVM chains a handle can name.
 *
 * For two chains this was also "the ids the CCTP registry uses", and the two
 * facts were one sentence. They are separate now: Robinhood Chain is read over
 * RPC like any EVM chain, and it is **not** a CCTP chain — Circle has no
 * domain for 4663 and the chain carries no USDC. The bridge's own list is
 * `CCTP_EVM_CHAINS` in `lib/solana/cctp-direction.ts` and is deliberately not
 * this one, so adding a chain a handle can read never adds a chain the bridge
 * believes it can move USDC to.
 */
export type EvmChainId = "base" | "ethereum" | "arbitrum" | "optimism" | "polygon" | "bnb" | "robinhood";
export const EVM_CHAIN_IDS: readonly EvmChainId[] = ["base", "ethereum", "arbitrum", "optimism", "polygon", "bnb", "robinhood"];

export type EvmChainProfile = Readonly<{
  id: EvmChainId;
  chainId: number;
  /** `chainId` as a wallet expects it in `wallet_switchEthereumChain`. */
  chainIdHex: string;
  chainRef: "eip155:8453" | "eip155:1" | "eip155:42161" | "eip155:10" | "eip155:137" | "eip155:56" | "eip155:4663";
  label: string;
  /** Where a person can open a transaction on this chain. */
  explorerTxUrl: (hash: string) => string;
  /** Roughly how far apart blocks are, for turning a time window into a block window. */
  blockSeconds: number;
}>;

export const EVM_CHAIN_PROFILES: Readonly<Record<EvmChainId, EvmChainProfile>> = {
  base: {
    id: "base",
    chainId: BASE_MAINNET_CHAIN_ID,
    chainIdHex: "0x2105",
    chainRef: BASE_MAINNET_CHAIN_REF,
    label: "Base",
    explorerTxUrl: (hash) => `https://basescan.org/tx/${hash}`,
    blockSeconds: 2,
  },
  ethereum: {
    id: "ethereum",
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    chainIdHex: "0x1",
    chainRef: ETHEREUM_MAINNET_CHAIN_REF,
    label: "Ethereum",
    explorerTxUrl: (hash) => `https://etherscan.io/tx/${hash}`,
    blockSeconds: 12,
  },
  arbitrum: {
    id: "arbitrum",
    chainId: ARBITRUM_MAINNET_CHAIN_ID,
    chainIdHex: "0xa4b1",
    chainRef: ARBITRUM_MAINNET_CHAIN_REF,
    label: "Arbitrum",
    explorerTxUrl: (hash) => `https://arbiscan.io/tx/${hash}`,
    /* An Arbitrum Nitro L2: blocks are produced on demand, so this is a working
       figure for turning a time window into a block window, not a constant. */
    blockSeconds: 1,
  },
  optimism: {
    id: "optimism",
    chainId: OPTIMISM_MAINNET_CHAIN_ID,
    chainIdHex: "0xa",
    chainRef: OPTIMISM_MAINNET_CHAIN_REF,
    label: "Optimism",
    explorerTxUrl: (hash) => `https://optimistic.etherscan.io/tx/${hash}`,
    blockSeconds: 2,
  },
  polygon: {
    id: "polygon",
    chainId: POLYGON_MAINNET_CHAIN_ID,
    chainIdHex: "0x89",
    chainRef: POLYGON_MAINNET_CHAIN_REF,
    label: "Polygon",
    explorerTxUrl: (hash) => `https://polygonscan.com/tx/${hash}`,
    blockSeconds: 2,
  },
  bnb: {
    id: "bnb",
    chainId: BNB_MAINNET_CHAIN_ID,
    chainIdHex: "0x38",
    chainRef: BNB_MAINNET_CHAIN_REF,
    label: "BNB Chain",
    explorerTxUrl: (hash) => `https://bscscan.com/tx/${hash}`,
    blockSeconds: 3,
  },
  robinhood: {
    id: "robinhood",
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    chainIdHex: "0x1237",
    chainRef: ROBINHOOD_MAINNET_CHAIN_REF,
    label: "Robinhood Chain",
    explorerTxUrl: (hash) => `https://robinhoodchain.blockscout.com/tx/${hash}`,
    /* An Arbitrum Nitro L2: blocks are produced on demand rather than on a
       fixed cadence, so this is a working figure for turning a time window
       into a block window, not a protocol constant. */
    blockSeconds: 1,
  },
};

export function isEvmChainId(value: unknown): value is EvmChainId {
  return typeof value === "string" && (EVM_CHAIN_IDS as readonly string[]).includes(value);
}

export function evmChainProfile(chain: EvmChainId): EvmChainProfile {
  return EVM_CHAIN_PROFILES[chain];
}

/** The profile behind a CAIP-2 reference, or null for a chain this module does not serve. */
export function evmChainProfileByRef(chainRef: string): EvmChainProfile | null {
  for (const chain of EVM_CHAIN_IDS) {
    if (EVM_CHAIN_PROFILES[chain].chainRef === chainRef) return EVM_CHAIN_PROFILES[chain];
  }
  return null;
}

/** Ordered. `primary` is asked first and `fallback` only after it fails. */
export const BASE_RPC_ROLES = ["primary", "fallback", "independent"] as const;
export type BaseRpcRole = (typeof BASE_RPC_ROLES)[number];

export type BaseEndpoint = Readonly<{
  role: BaseRpcRole;
  url: string;
  host: string;
  /** The organisation that runs the node, not the hostname it answers on. */
  operator: string;
  history: "ARCHIVE" | "RECENT_ONLY";
  /** The largest `eth_getLogs` span this endpoint actually answers. */
  maxLogRangeBlocks: number;
  /** How far back `RECENT_ONLY` reaches. Null for an archive node. */
  recentBlockDepth: number | null;
}>;

const DEFAULT_ENDPOINTS_BY_CHAIN: Readonly<Record<EvmChainId, readonly Omit<BaseEndpoint, "role">[]>> = {
  base: [
    {
      url: "https://mainnet.base.org",
      host: "mainnet.base.org",
      operator: "Base",
      history: "ARCHIVE",
      maxLogRangeBlocks: 10_000,
      recentBlockDepth: null,
    },
    {
      url: "https://base.drpc.org",
      host: "base.drpc.org",
      operator: "dRPC",
      history: "ARCHIVE",
      /* 10,000 is accepted and then times out on the keyless tier. The number
         that answers is the number worth writing down. */
      maxLogRangeBlocks: 5_000,
      recentBlockDepth: null,
    },
    {
      url: "https://base-rpc.publicnode.com",
      host: "base-rpc.publicnode.com",
      operator: "PublicNode (Allnodes)",
      history: "RECENT_ONLY",
      /* Log queries are only meaningful inside the window it retains. */
      maxLogRangeBlocks: 100,
      recentBlockDepth: 100,
    },
  ],
  ethereum: [
    {
      url: "https://mainnet.gateway.tenderly.co",
      host: "mainnet.gateway.tenderly.co",
      operator: "Tenderly",
      history: "ARCHIVE",
      /* 50,000 answered in 795ms on 2026-09-05; declared at 10,000 so no
         window this module widens ever depends on one operator's ceiling. */
      maxLogRangeBlocks: 10_000,
      recentBlockDepth: null,
    },
    {
      url: "https://rpc.mevblocker.io",
      host: "rpc.mevblocker.io",
      operator: "MEV Blocker",
      history: "ARCHIVE",
      /* 10,000 answers; 50,000 is refused with "range 50000 exceeds limit of 10000". */
      maxLogRangeBlocks: 10_000,
      recentBlockDepth: null,
    },
    {
      url: "https://ethereum-rpc.publicnode.com",
      host: "ethereum-rpc.publicnode.com",
      operator: "PublicNode (Allnodes)",
      history: "RECENT_ONLY",
      /* 100 answers; 1,000 is refused as an archive request on the keyless tier. */
      maxLogRangeBlocks: 100,
      recentBlockDepth: 100,
    },
  ],
  /*
   * Robinhood Chain, read 2026-09-09. Both endpoints answered `eth_chainId`
   * 0x1237, `eth_gasPrice` and `eth_blockNumber`; `eth_estimateGas` is served
   * (a bare value transfer to the depository reverts, which is the contract
   * talking, not the node).
   *
   * Rejected the same day, with the reason: `robinhood.drpc.org` answers
   * `eth_chainId` but refuses `eth_gasPrice` and `eth_blockNumber` with
   * "the method does not exist/is not available" on the keyless tier — the
   * same shape of half-service the Ethereum notes above record for drpc.
   *
   * Neither is an archive node for this lane's purposes and neither is
   * claimed to be. The lane needs a gas price, a nonce and a receipt; it
   * backfills no logs on this chain. Robinhood's own documentation marks its
   * public endpoint rate-limited and not for production, which is why an
   * operator endpoint can be configured over it by name.
   */
  /*
   * The four networks added on 2026-09-10, each endpoint read the same day and
   * only written down after it answered `eth_chainId` with the right value plus
   * `eth_gasPrice` and `eth_blockNumber`.
   *
   * Rejected on the same reading, with the reason: `polygon-rpc.com` answers
   * **HTTP 401** to every keyless call, and `polygon.llamarpc.com` does not
   * resolve from here at all. Neither is in the list, and neither is silently
   * absent — an endpoint that fails on the day it is added would be a fallback
   * that has never worked.
   *
   * None of these is an archive node and none is claimed to be. The Bridge path
   * asks each chain for exactly one thing — `eth_gasPrice`, inside
   * `buildRelayEvmCalls` — and backfills no logs on any of them, so the history
   * and log-range fields are stated conservatively rather than measured. A lane
   * that ever needs history on these chains must measure them first.
   */
  arbitrum: [
    {
      url: "https://arbitrum-one.publicnode.com",
      host: "arbitrum-one.publicnode.com",
      operator: "Allnodes",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
    {
      url: "https://arb1.arbitrum.io/rpc",
      host: "arb1.arbitrum.io",
      operator: "Offchain Labs",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
  ],
  optimism: [
    {
      url: "https://optimism.publicnode.com",
      host: "optimism.publicnode.com",
      operator: "Allnodes",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
    {
      url: "https://mainnet.optimism.io",
      host: "mainnet.optimism.io",
      operator: "OP Labs",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
  ],
  polygon: [
    {
      url: "https://polygon-bor-rpc.publicnode.com",
      host: "polygon-bor-rpc.publicnode.com",
      operator: "Allnodes",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
    {
      url: "https://polygon.drpc.org",
      host: "polygon.drpc.org",
      operator: "drpc",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
  ],
  bnb: [
    {
      url: "https://bsc-rpc.publicnode.com",
      host: "bsc-rpc.publicnode.com",
      operator: "Allnodes",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
    {
      url: "https://bsc-dataseed.bnbchain.org",
      host: "bsc-dataseed.bnbchain.org",
      operator: "BNB Chain",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
  ],
  robinhood: [
    {
      url: "https://rpc.mainnet.chain.robinhood.com",
      host: "rpc.mainnet.chain.robinhood.com",
      operator: "Robinhood",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 1_000,
      recentBlockDepth: 1_000,
    },
    {
      url: "https://robinhood-rpc.publicnode.com",
      host: "robinhood-rpc.publicnode.com",
      operator: "PublicNode (Allnodes)",
      history: "RECENT_ONLY",
      maxLogRangeBlocks: 100,
      recentBlockDepth: 100,
    },
  ],
};

export const BASE_ENV_OVERRIDES: Readonly<Record<BaseRpcRole, string>> = {
  primary: "RYNTRA_BASE_RPC_MAINNET",
  fallback: "RYNTRA_BASE_RPC_MAINNET_FALLBACK",
  independent: "RYNTRA_BASE_RPC_MAINNET_INDEPENDENT",
};

export const ETHEREUM_ENV_OVERRIDES: Readonly<Record<BaseRpcRole, string>> = {
  primary: "RYNTRA_ETHEREUM_RPC_MAINNET",
  fallback: "RYNTRA_ETHEREUM_RPC_MAINNET_FALLBACK",
  independent: "RYNTRA_ETHEREUM_RPC_MAINNET_INDEPENDENT",
};

export const ROBINHOOD_ENV_OVERRIDES: Readonly<Record<BaseRpcRole, string>> = {
  primary: "RYNTRA_ROBINHOOD_RPC_MAINNET",
  fallback: "RYNTRA_ROBINHOOD_RPC_MAINNET_FALLBACK",
  independent: "RYNTRA_ROBINHOOD_RPC_MAINNET_INDEPENDENT",
};

/* Each added chain keeps the same escape hatch as the three before it: a named
   operator endpoint can be configured over the public default without a release,
   because a keyless public node is a starting point rather than a guarantee. */
const ARBITRUM_ENV_OVERRIDES: Readonly<Record<BaseRpcRole, string>> = {
  primary: "RYNTRA_ARBITRUM_RPC_MAINNET_PRIMARY",
  fallback: "RYNTRA_ARBITRUM_RPC_MAINNET_FALLBACK",
  independent: "RYNTRA_ARBITRUM_RPC_MAINNET_INDEPENDENT",
};

const OPTIMISM_ENV_OVERRIDES: Readonly<Record<BaseRpcRole, string>> = {
  primary: "RYNTRA_OPTIMISM_RPC_MAINNET_PRIMARY",
  fallback: "RYNTRA_OPTIMISM_RPC_MAINNET_FALLBACK",
  independent: "RYNTRA_OPTIMISM_RPC_MAINNET_INDEPENDENT",
};

const POLYGON_ENV_OVERRIDES: Readonly<Record<BaseRpcRole, string>> = {
  primary: "RYNTRA_POLYGON_RPC_MAINNET_PRIMARY",
  fallback: "RYNTRA_POLYGON_RPC_MAINNET_FALLBACK",
  independent: "RYNTRA_POLYGON_RPC_MAINNET_INDEPENDENT",
};

const BNB_ENV_OVERRIDES: Readonly<Record<BaseRpcRole, string>> = {
  primary: "RYNTRA_BNB_RPC_MAINNET_PRIMARY",
  fallback: "RYNTRA_BNB_RPC_MAINNET_FALLBACK",
  independent: "RYNTRA_BNB_RPC_MAINNET_INDEPENDENT",
};

export const EVM_ENV_OVERRIDES: Readonly<Record<EvmChainId, Readonly<Record<BaseRpcRole, string>>>> = {
  base: BASE_ENV_OVERRIDES,
  ethereum: ETHEREUM_ENV_OVERRIDES,
  arbitrum: ARBITRUM_ENV_OVERRIDES,
  optimism: OPTIMISM_ENV_OVERRIDES,
  polygon: POLYGON_ENV_OVERRIDES,
  bnb: BNB_ENV_OVERRIDES,
  robinhood: ROBINHOOD_ENV_OVERRIDES,
};

export function defaultEvmEndpoints(chain: EvmChainId): readonly Omit<BaseEndpoint, "role">[] {
  return DEFAULT_ENDPOINTS_BY_CHAIN[chain];
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

export type BaseRpcFailureCode =
  | "TRANSPORT_FAILED"
  | "HTTP_ERROR"
  | "MALFORMED_RESPONSE"
  | "RPC_ERROR"
  | "RANGE_UNSUPPORTED"
  | "HISTORY_UNAVAILABLE"
  | "NO_ENDPOINT_ANSWERED";

export type BaseRpcRead<T> =
  | Readonly<{ ok: true; value: T; endpoint: BaseEndpoint }>
  | Readonly<{
      ok: false;
      code: BaseRpcFailureCode;
      reason: string;
      /** Every endpoint that was asked and what it said. Never collapsed to one. */
      attempts: readonly Readonly<{ host: string; code: BaseRpcFailureCode; reason: string }>[];
    }>;

/**
 * A handle carries no mutable state.
 *
 * Which endpoint answered travels on the result of each read instead, because a
 * handle-level "last answered" is a shared variable that two concurrent reads
 * would race over — and the one place it gets used is evidence, where the wrong
 * host name is worse than no host name.
 */
export type BaseRpcHandle = Readonly<{
  chainId: number;
  /** Which EVM chain every read on this handle is about. */
  chain: EvmChainProfile;
  endpoints: readonly BaseEndpoint[];
  timeoutMs: number;
  fetchImpl: typeof fetch;
}>;

/** The same handle, named for what it now is. */
export type EvmRpcHandle = BaseRpcHandle;

function endpointFor(
  chain: EvmChainId,
  role: BaseRpcRole,
  index: number,
  env: NodeJS.ProcessEnv,
): Omit<BaseEndpoint, "role"> | null {
  const override = env[EVM_ENV_OVERRIDES[chain][role]]?.trim();
  if (override) {
    let url: URL;
    try {
      url = new URL(override);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") return null;
    return {
      url: url.toString().replace(/\/$/, ""),
      host: url.host,
      operator: "configured",
      /* A configured endpoint is assumed to be at least as capable as the
         default it replaces. Assuming less would silently narrow a paid
         archive node to a public one's limits; assuming more is the caller's
         own configuration to answer for. */
      history: "ARCHIVE",
      maxLogRangeBlocks: 10_000,
      recentBlockDepth: null,
    };
  }
  return DEFAULT_ENDPOINTS_BY_CHAIN[chain][index] ?? null;
}

export type EvmRpcHandleOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Restrict to endpoints that hold history. Log backfill needs this. */
  requireArchive?: boolean;
  /** Which chain the handle reads. Base when absent, so every existing caller is unchanged. */
  chain?: EvmChainId;
}>;

export function createBaseRpcHandle(options: EvmRpcHandleOptions = {}): BaseRpcHandle {
  const env = options.env ?? process.env;
  const chain = options.chain ?? "base";
  const profile = EVM_CHAIN_PROFILES[chain];
  const endpoints = BASE_RPC_ROLES.map((role, index) => {
    const base = endpointFor(chain, role, index, env);
    return base ? ({ ...base, role } satisfies BaseEndpoint) : null;
  }).filter((entry): entry is BaseEndpoint => entry !== null);

  const selected = options.requireArchive ? endpoints.filter((entry) => entry.history === "ARCHIVE") : endpoints;
  return {
    chainId: profile.chainId,
    chain: profile,
    endpoints: selected,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

/** A handle for a named EVM chain. The Base-named creator with the chain said out loud. */
export function createEvmRpcHandle(chain: EvmChainId, options: Omit<EvmRpcHandleOptions, "chain"> = {}): EvmRpcHandle {
  return createBaseRpcHandle({ ...options, chain });
}

async function readBounded(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new Error("The EVM RPC response exceeded the byte ceiling.");
    }
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let seen = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("The EVM RPC response exceeded the byte ceiling.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

type SingleAttempt =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; code: BaseRpcFailureCode; reason: string }>;

let requestId = 0;

async function callOne(
  handle: BaseRpcHandle,
  endpoint: BaseEndpoint,
  method: string,
  params: readonly unknown[],
): Promise<SingleAttempt> {
  let response: Response;
  try {
    response = await handle.fetchImpl(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      signal: AbortSignal.timeout(handle.timeoutMs),
      cache: "no-store",
    });
  } catch (cause) {
    return {
      ok: false,
      code: "TRANSPORT_FAILED",
      reason: `${endpoint.host} did not answer ${method}: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  let text: string;
  try {
    text = await readBounded(response);
  } catch (cause) {
    return { ok: false, code: "MALFORMED_RESPONSE", reason: cause instanceof Error ? cause.message : String(cause) };
  }
  if (!response.ok) {
    return { ok: false, code: "HTTP_ERROR", reason: `${endpoint.host} answered HTTP ${response.status} to ${method}` };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, code: "MALFORMED_RESPONSE", reason: `${endpoint.host} answered ${method} with non-JSON.` };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "MALFORMED_RESPONSE", reason: `${endpoint.host} answered ${method} with a non-object.` };
  }
  const envelope = body as Record<string, unknown>;
  if (envelope.error !== undefined && envelope.error !== null) {
    const error = envelope.error as Record<string, unknown>;
    const message = typeof error.message === "string" ? error.message : JSON.stringify(error);
    /* A range refusal is not a broken endpoint, and a caller that widens its
       window on a retry would ask the next one the same impossible question. */
    const code = /limited to a .* range|exceed|too large|timeout on the free plan/i.test(message)
      ? "RANGE_UNSUPPORTED"
      : /(?:missing trie node|state is not available|block not found|older than|not available on this node)/i.test(message)
        ? "HISTORY_UNAVAILABLE"
        : "RPC_ERROR";
    return { ok: false, code, reason: `${endpoint.host}: ${message}` };
  }
  if (!("result" in envelope)) {
    return { ok: false, code: "MALFORMED_RESPONSE", reason: `${endpoint.host} answered ${method} without a result.` };
  }
  return { ok: true, value: envelope.result };
}

/**
 * One read, tried across the endpoints in order.
 *
 * A transport failure moves on; a JSON-RPC *answer* does not, because retrying
 * an answer does not change facts. A range refusal is the one exception worth
 * naming — it belongs to the endpoint rather than to the chain, so the next
 * endpoint gets to answer the same question.
 */
export async function baseRpcCall<T = unknown>(
  handle: BaseRpcHandle,
  method: string,
  params: readonly unknown[] = [],
  options: Readonly<{ endpoints?: readonly BaseEndpoint[] }> = {},
): Promise<BaseRpcRead<T>> {
  const candidates = options.endpoints ?? handle.endpoints;
  const attempts: { host: string; code: BaseRpcFailureCode; reason: string }[] = [];
  for (const endpoint of candidates) {
    const attempt = await callOne(handle, endpoint, method, params);
    if (attempt.ok) return { ok: true, value: attempt.value as T, endpoint };
    attempts.push({ host: endpoint.host, code: attempt.code, reason: attempt.reason });
    if (attempt.code === "RPC_ERROR") {
      /* The chain answered and said no. Asking a second operator the same
         question would not change it, and pretending otherwise would turn one
         clear refusal into an ambiguous sweep. */
      return { ok: false, code: attempt.code, reason: attempt.reason, attempts };
    }
  }
  return {
    ok: false,
    code: attempts.length === 0 ? "NO_ENDPOINT_ANSWERED" : (attempts[attempts.length - 1]?.code ?? "NO_ENDPOINT_ANSWERED"),
    reason:
      attempts.length === 0
        ? `No ${handle.chain.label} endpoint is configured for this read.`
        : `No ${handle.chain.label} endpoint answered ${method}: ${attempts.map((entry) => entry.reason).join(" · ")}`,
    attempts,
  };
}

const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/;

/** A JSON-RPC hex quantity as a decimal string. Refuses anything else. */
export function hexQuantityToDecimal(value: unknown): string | null {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) return null;
  return BigInt(value).toString();
}

/** The current head, as a decimal string. */
export async function readBaseBlockNumber(handle: BaseRpcHandle): Promise<BaseRpcRead<string>> {
  const read = await baseRpcCall(handle, "eth_blockNumber", []);
  if (!read.ok) return read;
  const decimal = hexQuantityToDecimal(read.value);
  if (decimal === null) {
    return {
      ok: false,
      code: "MALFORMED_RESPONSE",
      reason: `${read.endpoint.host} returned a block number that is not a hex quantity.`,
      attempts: [{ host: read.endpoint.host, code: "MALFORMED_RESPONSE", reason: "not a hex quantity" }],
    };
  }
  return { ok: true, value: decimal, endpoint: read.endpoint };
}

/** `eth_call` against a contract at the latest block. */
export async function baseEthCall(
  handle: BaseRpcHandle,
  args: Readonly<{ to: string; data: string; block?: string }>,
  options: Readonly<{ endpoints?: readonly BaseEndpoint[] }> = {},
): Promise<BaseRpcRead<string>> {
  const read = await baseRpcCall<string>(
    handle,
    "eth_call",
    [{ to: args.to, data: args.data }, args.block ?? "latest"],
    options,
  );
  if (!read.ok) return read;
  if (typeof read.value !== "string" || !/^0x[0-9a-fA-F]*$/.test(read.value)) {
    return {
      ok: false,
      code: "MALFORMED_RESPONSE",
      reason: `${read.endpoint.host} returned a call result that is not hexadecimal.`,
      attempts: [{ host: read.endpoint.host, code: "MALFORMED_RESPONSE", reason: "not hexadecimal" }],
    };
  }
  return read;
}

/** The four-byte selector for `balanceOf(address)`, computed from its signature. */
export const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";

/** An EVM address as a 32-byte ABI word: twelve zero bytes, then the address. */
export function abiAddressWord(address: string): string | null {
  const match = /^0x([0-9a-fA-F]{40})$/.exec(address.trim());
  return match ? `${"0".repeat(24)}${match[1].toLowerCase()}` : null;
}

/**
 * An ERC-20 balance in base units.
 *
 * USDC on Base has six decimals. The caller scales; this returns what the chain
 * said, because a scaled number with no decimals attached is how a balance ends
 * up a million times wrong.
 */
export async function readBaseErc20Balance(
  handle: BaseRpcHandle,
  args: Readonly<{ token: string; owner: string }>,
): Promise<BaseRpcRead<string>> {
  const word = abiAddressWord(args.owner);
  if (word === null) {
    return {
      ok: false,
      code: "MALFORMED_RESPONSE",
      reason: `${args.owner} is not a 20-byte EVM address.`,
      attempts: [],
    };
  }
  const read = await baseEthCall(handle, { to: args.token, data: `${ERC20_BALANCE_OF_SELECTOR}${word}` });
  if (!read.ok) return read;
  const decimal = hexQuantityToDecimal(read.value);
  if (decimal === null) {
    return {
      ok: false,
      code: "MALFORMED_RESPONSE",
      reason: `${read.endpoint.host} returned a balance that is not a hex quantity.`,
      attempts: [{ host: read.endpoint.host, code: "MALFORMED_RESPONSE", reason: "not a hex quantity" }],
    };
  }
  return { ok: true, value: decimal, endpoint: read.endpoint };
}

/** The four-byte selector for `decimals()`, computed from its signature. */
export const ERC20_DECIMALS_SELECTOR = "0x313ce567";

/**
 * How many places an ERC-20 divides into, read from the token itself.
 *
 * The catalogue knows this for the assets it names and knows nothing about the
 * rest, and the rest is now most of them — the swap surface can name any token
 * the rails carry. A balance shown with guessed decimals is not a smaller
 * mistake than no balance: eighteen places read as six is a figure a million
 * million times too large, sitting under a MAX button.
 *
 * A token whose answer is not a plausible ERC-20 scale is reported as
 * unreadable rather than defaulted to eighteen, for the same reason.
 */
export async function readBaseErc20Decimals(
  handle: BaseRpcHandle,
  args: Readonly<{ token: string }>,
): Promise<BaseRpcRead<number>> {
  const read = await baseEthCall(handle, { to: args.token, data: ERC20_DECIMALS_SELECTOR });
  if (!read.ok) return read;
  const decimal = hexQuantityToDecimal(read.value);
  const value = decimal === null ? null : Number(decimal);
  if (value === null || !Number.isInteger(value) || value < 0 || value > 36) {
    return {
      ok: false,
      code: "MALFORMED_RESPONSE",
      reason: `${read.endpoint.host} returned a token scale that is not an ERC-20 decimals value.`,
      attempts: [{ host: read.endpoint.host, code: "MALFORMED_RESPONSE", reason: "not a decimals value" }],
    };
  }
  return { ok: true, value, endpoint: read.endpoint };
}

export type BaseLog = Readonly<{
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}>;

function readLog(value: unknown): BaseLog | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.address !== "string" || typeof raw.data !== "string") return null;
  if (!Array.isArray(raw.topics) || raw.topics.some((topic) => typeof topic !== "string")) return null;
  if (typeof raw.blockNumber !== "string" || typeof raw.transactionHash !== "string") return null;
  if (typeof raw.logIndex !== "string") return null;
  return {
    address: raw.address.toLowerCase(),
    topics: raw.topics.map((topic) => (topic as string).toLowerCase()),
    data: raw.data.toLowerCase(),
    blockNumber: raw.blockNumber,
    transactionHash: raw.transactionHash.toLowerCase(),
    logIndex: raw.logIndex,
  };
}

/**
 * `eth_getLogs` over one span, asked only of endpoints that can answer it.
 *
 * The span is checked against each endpoint's own declared ceiling before the
 * request is made. Asking an endpoint for more than it serves produces a
 * refusal that reads like an empty result to anyone not looking closely, and
 * "no mint found" is exactly the wrong thing to be casually wrong about.
 */
export async function readBaseLogs(
  handle: BaseRpcHandle,
  args: Readonly<{
    address: string;
    topics: readonly (string | null)[];
    fromBlock: bigint;
    toBlock: bigint;
  }>,
): Promise<BaseRpcRead<readonly BaseLog[]>> {
  const span = args.toBlock - args.fromBlock + 1n;
  if (span <= 0n) {
    return { ok: false, code: "RANGE_UNSUPPORTED", reason: "The block span is empty.", attempts: [] };
  }
  const capable = handle.endpoints.filter((endpoint) => BigInt(endpoint.maxLogRangeBlocks) >= span);
  if (capable.length === 0) {
    const widest = handle.endpoints.reduce((best, entry) => Math.max(best, entry.maxLogRangeBlocks), 0);
    return {
      ok: false,
      code: "RANGE_UNSUPPORTED",
      reason: `A ${span}-block span exceeds every configured ${handle.chain.label} endpoint; the widest answers ${widest}.`,
      attempts: [],
    };
  }
  const read = await baseRpcCall<unknown>(
    handle,
    "eth_getLogs",
    [
      {
        address: args.address,
        topics: args.topics,
        fromBlock: `0x${args.fromBlock.toString(16)}`,
        toBlock: `0x${args.toBlock.toString(16)}`,
      },
    ],
    { endpoints: capable },
  );
  if (!read.ok) return read;
  if (!Array.isArray(read.value)) {
    return {
      ok: false,
      code: "MALFORMED_RESPONSE",
      reason: `${read.endpoint.host} returned logs that are not an array.`,
      attempts: [{ host: read.endpoint.host, code: "MALFORMED_RESPONSE", reason: "not an array" }],
    };
  }
  const logs: BaseLog[] = [];
  for (const entry of read.value) {
    const log = readLog(entry);
    if (!log) {
      return {
        ok: false,
        code: "MALFORMED_RESPONSE",
        reason: `${read.endpoint.host} returned a log this reader could not parse.`,
        attempts: [{ host: read.endpoint.host, code: "MALFORMED_RESPONSE", reason: "unparseable log" }],
      };
    }
    logs.push(log);
  }
  return { ok: true, value: logs, endpoint: read.endpoint };
}
