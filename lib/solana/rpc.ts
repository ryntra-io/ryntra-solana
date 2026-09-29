/**
 * The one place Solana RPC is reached from.
 *
 * ## Two endpoints, not one
 *
 * Canon §6.1 is blunt about it: a public endpoint is rate-limited and is not
 * production application infrastructure, so a mainnet product needs a primary
 * **and an independent fallback read path**. §3.5 wants the same thing for a
 * different reason — a provider's answer is not proof on its own, and a second
 * operator is what makes a disagreement visible instead of invisible.
 *
 * So a handle holds an ordered pair rather than a URL. Every request tries the
 * primary; a transport failure moves to the fallback; a JSON-RPC *answer* —
 * including "account not found" — is returned as it came, because retrying an
 * answer does not change facts.
 *
 * **The defaults are public and are stated as public.** They exist so the
 * evidence core works from a clean clone with no account anywhere. The
 * production pair is a named founder input and enters through the environment,
 * never through code, never through a log, never through a commit.
 *
 * The default order is evidence rather than taste, and it was measured while
 * this module was being written: `solana-rpc.publicnode.com` answers
 * `getEpochInfo`, `getBalance` and `getAccountInfo` and refuses
 * `getTokenAccountsByOwner` outright with HTTP 403 `Request blocked`, which is
 * exactly the call a person's own balances depend on;
 * `public.rpc.solanavibestation.com` serves it and rate-limits a burst. Neither
 * one is sufficient alone, which is the argument for the pair rendered in a
 * single default.
 *
 * ## Why the transport is written here
 *
 * `createSolanaRpc(url)` builds its own transport and gives no way in, so
 * failover, a byte ceiling and a record of which endpoint actually answered
 * are all unreachable from the outside. This module builds the transport
 * instead — `parseJsonWithBigInts` and `stringifyJsonWithBigInts` are the same
 * codecs `@solana/kit` installs, and they are not optional: a lamport balance
 * passes `Number.MAX_SAFE_INTEGER` on ordinary wallets and `JSON.parse` would
 * quietly round it.
 *
 * Every read that leaves this module carries a timeout, a response ceiling and
 * a bounded retry, because a public RPC that hangs is a normal Tuesday and an
 * unbounded read would make the caller's freshness stamp a lie.
 */

import { createSolanaRpcFromTransport, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { parseJsonWithBigInts, stringifyJsonWithBigInts } from "@solana/rpc-spec-types";
import type { EvidenceSource } from "./evidence.ts";

export const SOLANA_NETWORKS = ["mainnet", "devnet"] as const;
export type SolanaNetwork = (typeof SOLANA_NETWORKS)[number];

/**
 * The networks this product may put a **signed** transaction on.
 *
 * Reading, building and simulating are open everywhere — none of them reaches
 * the network with an intent. Submitting is the act that spends, so it has a
 * network-wide list of its own, and mainnet is not on it. M1B adds the
 * narrower action-scoped exception below for one exact ATA-create canary;
 * the general Send owner canary remains its own registered gate.
 *
 * One list, imported by both sides, because the alternative is what this
 * workspace already shipped once — a server that refused mainnet and a console
 * that offered the button anyway, so the boundary was discovered by pressing
 * it. A surface reads this to decide whether the control exists at all; a
 * greyed button is a promise with the switch off.
 */
export const SOLANA_SUBMITTABLE_NETWORKS: readonly SolanaNetwork[] = ["devnet"];

/** Whether a signed transaction may be submitted on this network at all. */
export function canSubmitOn(network: SolanaNetwork): boolean {
  return SOLANA_SUBMITTABLE_NETWORKS.includes(network);
}

/* The write gate moved to `send-safety.ts`.
 *
 * It used to be an action-kind allowlist: on mainnet, exactly
 * `TOKEN_ATA_CREATE` and nothing else, because that was M1B's one canary. An
 * allowlist of shapes cannot express "this transfer was proven safe" — it says
 * only "this transfer looks like the one we once did" — so the gate is now
 * derived from the server's own safety verdict over the exact reviewed
 * transaction. `canSubmitOn` above still answers the narrower question of
 * whether a network is submittable at all. */

/** Ordered: `primary` is asked first, `fallback` only after it fails. */
export const SOLANA_RPC_ROLES = ["primary", "fallback"] as const;
export type SolanaRpcRole = (typeof SOLANA_RPC_ROLES)[number];

type EndpointPair = Readonly<Record<SolanaRpcRole, string | null>>;

const PUBLIC_ENDPOINTS: Record<SolanaNetwork, EndpointPair> = {
  mainnet: {
    /* Not the Labs endpoint: `api.mainnet-beta.solana.com` is aggressively
       rate-limited for anything beyond experiments, and on the machine this
       module was first proven on it sits behind TLS interception — a
       self-signed certificate — while other hosts do not. */
    primary: "https://solana-rpc.publicnode.com",
    /* A different operator, not a second address of the same one. A fallback
       that shares infrastructure with the primary is a spare tyre bolted to
       the same axle. */
    fallback: "https://public.rpc.solanavibestation.com",
  },
  devnet: {
    primary: "https://api.devnet.solana.com",
    /* Absent, and absent is the honest value. Devnet is an internal regression
       fixture rather than a release target (canon §3.1), and no keyless public
       devnet second operator answered when this pair was probed. The env slot
       below exists for anyone who has one. */
    fallback: null,
  },
};

/* Exported so the workspace's Developers and Settings surfaces render these
   names from the module that honors them, instead of keeping a second list
   that drifts. */
export const ENV_OVERRIDES: Record<SolanaNetwork, Readonly<Record<SolanaRpcRole, string>>> = {
  mainnet: {
    primary: "RYNTRA_SOLANA_RPC_MAINNET",
    fallback: "RYNTRA_SOLANA_RPC_MAINNET_FALLBACK",
  },
  devnet: {
    primary: "RYNTRA_SOLANA_RPC_DEVNET",
    fallback: "RYNTRA_SOLANA_RPC_DEVNET_FALLBACK",
  },
};

/** One resolved endpoint, with where it came from. */
export type SolanaEndpoint = Readonly<{
  role: SolanaRpcRole;
  url: string;
  /** The host alone. A provider URL can carry a key in its path or query. */
  host: string;
  /** Whether the founder supplied it, or it is the committed public default. */
  fromEnv: boolean;
}>;

/** One attempt against one endpoint, in the order they happened. */
export type SolanaRpcAttempt = Readonly<{
  role: SolanaRpcRole;
  host: string;
  method: string;
  ok: boolean;
  /** Why it failed, host-only and never the URL. `null` when it answered. */
  reason: string | null;
  durationMs: number;
}>;

export type SolanaRpcConfig = Readonly<{
  network: SolanaNetwork;
  /** Explicit endpoint wins over env; env wins over the public default. */
  endpoint?: string;
  /** Explicit fallback. `null` asks for no fallback at all. */
  fallbackEndpoint?: string | null;
  /** Per-endpoint, not per-request: the pair is tried inside one call. */
  timeoutMs?: number;
  /** Additional attempts after the first failure of the whole pair. */
  retries?: number;
  /** Ceiling on one decoded response body. */
  maxResponseBytes?: number;
}>;

export type SolanaRpcHandle = Readonly<{
  network: SolanaNetwork;
  /** The primary URL. Kept for callers that name the configured endpoint. */
  endpoint: string;
  endpoints: readonly SolanaEndpoint[];
  rpc: Rpc<SolanaRpcApi>;
  timeoutMs: number;
  retries: number;
  maxResponseBytes: number;
  /** Every attempt this handle has made, oldest first. */
  attempts: () => readonly SolanaRpcAttempt[];
  /** The endpoint that answered most recently, or `null` before any read. */
  answered: () => SolanaEndpoint | null;
  /** The host to stamp on evidence: whoever answered, else the primary. */
  host: () => string;
  source: (path: string) => EvidenceSource;
}>;

/** 8 MiB. Large enough for a busy wallet's token accounts, small enough that a
    runaway response is a named failure rather than a heap. */
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-endpoint";
  }
}

function fromEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** The primary endpoint for a network — explicit, then env, then public. */
export function resolveEndpoint(network: SolanaNetwork, explicit?: string): string {
  if (explicit) return explicit;
  return fromEnv(ENV_OVERRIDES[network].primary) ?? (PUBLIC_ENDPOINTS[network].primary as string);
}

/**
 * The ordered pair for a network.
 *
 * A fallback equal to the primary is dropped rather than tried twice: asking
 * the same host again after it refused is a retry wearing a fallback's name,
 * and it would report `DEGRADED` health for a pair that never existed.
 */
export function resolveEndpoints(network: SolanaNetwork, config?: SolanaRpcConfig): readonly SolanaEndpoint[] {
  const primaryEnv = fromEnv(ENV_OVERRIDES[network].primary);
  const primaryUrl = config?.endpoint ?? primaryEnv ?? (PUBLIC_ENDPOINTS[network].primary as string);
  const resolved: SolanaEndpoint[] = [
    {
      role: "primary",
      url: primaryUrl,
      host: hostOf(primaryUrl),
      fromEnv: config?.endpoint === undefined && primaryEnv !== null,
    },
  ];

  const fallbackEnv = fromEnv(ENV_OVERRIDES[network].fallback);
  const fallbackUrl =
    config?.fallbackEndpoint !== undefined
      ? config.fallbackEndpoint
      : (fallbackEnv ?? PUBLIC_ENDPOINTS[network].fallback);
  if (fallbackUrl && fallbackUrl !== primaryUrl) {
    resolved.push({
      role: "fallback",
      url: fallbackUrl,
      host: hostOf(fallbackUrl),
      fromEnv: config?.fallbackEndpoint === undefined && fallbackEnv !== null,
    });
  }
  return resolved;
}

function methodOf(payload: unknown): string {
  return typeof payload === "object" && payload !== null && typeof (payload as { method?: unknown }).method === "string"
    ? (payload as { method: string }).method
    : "unknown";
}

/**
 * Read a response body with a hard ceiling on decoded bytes.
 *
 * Streamed rather than buffered so the ceiling is reached at the ceiling
 * instead of after the whole body has already been held in memory — which is
 * the difference between a limit and a note about one.
 */
export async function readBoundedRpcResponse(response: Response, maxBytes: number, host: string): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    throw new Error(`${host} announced ${declared} bytes, over the ${maxBytes}-byte ceiling`);
  }
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (text.length > maxBytes) throw new Error(`${host} returned over the ${maxBytes}-byte ceiling`);
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel();
      throw new Error(`${host} exceeded the ${maxBytes}-byte response ceiling`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * The transport: the pair, in order, with the ceiling and the record.
 *
 * A non-2xx status is a transport failure and moves to the next endpoint —
 * that is what a refusal looks like on the wire, and `Request blocked` arrives
 * as HTTP 403. A 2xx carrying a JSON-RPC `error` is an **answer** and is
 * returned; `@solana/kit` turns it into a typed error at the call site, where
 * the caller can tell "no such account" from "the endpoint would not talk".
 */
/**
 * A failure reason, with the endpoint reduced to its host.
 *
 * A provider URL can carry an API key in its path or query, and a transport
 * error is the one string in this module that quotes the URL back — Node's
 * DNS and TLS failures do it by habit. This is the difference between an
 * attempt log a surface can render and a credential in a log line.
 */
function redact(failure: unknown, endpoint: SolanaEndpoint): string {
  const message = failure instanceof Error ? failure.message : String(failure);
  return message.split(endpoint.url).join(endpoint.host);
}

function createPairTransport(args: {
  endpoints: readonly SolanaEndpoint[];
  timeoutMs: number;
  maxResponseBytes: number;
  record: (attempt: SolanaRpcAttempt) => void;
  onAnswer: (endpoint: SolanaEndpoint) => void;
}) {
  return async function transport<TResponse>(config: {
    payload: unknown;
    signal?: AbortSignal;
  }): Promise<TResponse> {
    const method = methodOf(config.payload);
    let lastFailure: unknown;

    for (const endpoint of args.endpoints) {
      config.signal?.throwIfAborted();
      const startedAt = Date.now();
      const timeout = AbortSignal.timeout(args.timeoutMs);
      const signal = config.signal ? AbortSignal.any([config.signal, timeout]) : timeout;
      try {
        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            /* The same courtesy header `@solana/kit` sends, so an operator
               reading their own logs sees a client rather than a stranger. */
            "solana-client": "ryntra/@solana/kit",
          },
          body: stringifyJsonWithBigInts(config.payload),
          signal,
        });
        if (!response.ok) {
          throw new Error(`${endpoint.host} answered HTTP ${response.status}`);
        }
        const raw = await readBoundedRpcResponse(response, args.maxResponseBytes, endpoint.host);
        const parsed = parseJsonWithBigInts(raw) as TResponse;
        args.record({
          role: endpoint.role,
          host: endpoint.host,
          method,
          ok: true,
          reason: null,
          durationMs: Date.now() - startedAt,
        });
        args.onAnswer(endpoint);
        return parsed;
      } catch (failure) {
        lastFailure = failure;
        args.record({
          role: endpoint.role,
          host: endpoint.host,
          method,
          ok: false,
          reason: redact(failure, endpoint),
          durationMs: Date.now() - startedAt,
        });
      }
    }

    const hosts = args.endpoints.map((endpoint) => endpoint.host).join(", ");
    throw new Error(
      `No Solana RPC endpoint answered ${method} (${hosts}): ${
        lastFailure instanceof Error ? lastFailure.message : String(lastFailure)
      }`,
    );
  };
}

export function createSolanaRpcHandle(config: SolanaRpcConfig): SolanaRpcHandle {
  const endpoints = resolveEndpoints(config.network, config);
  const timeoutMs = config.timeoutMs ?? 10_000;
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const attempts: SolanaRpcAttempt[] = [];
  let answered: SolanaEndpoint | null = null;

  const rpc = createSolanaRpcFromTransport(
    createPairTransport({
      endpoints,
      timeoutMs,
      maxResponseBytes,
      record: (attempt) => {
        attempts.push(attempt);
      },
      onAnswer: (endpoint) => {
        answered = endpoint;
      },
    }),
  );

  const host = () => (answered as SolanaEndpoint | null)?.host ?? endpoints[0].host;

  return {
    network: config.network,
    endpoint: endpoints[0].url,
    endpoints,
    rpc,
    timeoutMs,
    retries: config.retries ?? 1,
    maxResponseBytes,
    attempts: () => attempts,
    answered: () => answered,
    host,
    source: (path: string) => ({
      ref: `solana:${config.network}:rpc:${path}`,
      /* The label names the host, never the full URL: a provider URL can carry
         an API key in its path, and a source label is exactly the string that
         ends up on receipts and in fixtures. It names whoever answered, so a
         read served by the fallback says so on the evidence rather than
         inheriting the primary's name. */
      label: `Solana ${config.network} JSON-RPC (${host()})`,
    }),
  };
}

/**
 * Build a read handle whose provider host differs from the one-shot submit
 * endpoint. Returns null rather than reusing the submit provider as "proof".
 */
export function createIndependentReadHandle(
  submissionHandle: SolanaRpcHandle,
): SolanaRpcHandle | null {
  const submitEndpoint = submissionHandle.endpoints[0];
  const independent = submissionHandle.endpoints.find(
    (endpoint) => endpoint.host !== submitEndpoint.host,
  );
  if (!independent) return null;
  return createSolanaRpcHandle({
    network: submissionHandle.network,
    endpoint: independent.url,
    fallbackEndpoint: null,
    timeoutMs: submissionHandle.timeoutMs,
    retries: 0,
    maxResponseBytes: submissionHandle.maxResponseBytes,
  });
}

/**
 * Run one RPC send with the handle's discipline, retrying transient failures.
 *
 * The endpoint pair is walked inside the transport, so one call here is
 * already "primary, then fallback". The retry above it is for the case where
 * both were transiently unavailable — a rate limit that clears, a dropped
 * connection — and it is bounded.
 *
 * Retries are for the transport, never for the answer: a response that parses
 * is returned as-is even when it is "account not found", because "not found"
 * is a fact and re-asking does not change facts.
 */
export async function withRpcDiscipline<T>(
  handle: SolanaRpcHandle,
  run: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  let lastFailure: unknown;
  /* The outer budget covers the whole pair, or it would abort the fallback
     before it was ever asked. */
  const budgetMs = handle.timeoutMs * handle.endpoints.length + 1_000;
  for (let attempt = 0; attempt <= handle.retries; attempt += 1) {
    const signal = AbortSignal.timeout(budgetMs);
    try {
      return await run(signal);
    } catch (failure) {
      lastFailure = failure;
    }
  }
  throw lastFailure instanceof Error
    ? lastFailure
    : new Error(`Solana RPC failed after ${handle.retries + 1} attempts: ${String(lastFailure)}`);
}
