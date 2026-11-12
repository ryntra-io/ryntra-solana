/**
 * What every ladder route shares: the network's own switch (closed answers
 * 404 — the routes do not exist on that network for the deployment), a rate
 * limit, a bounded JSON body and one shape of failure. Private, never cached.
 *
 * On mainnet two more doors, the limits lane's own (a ladder is limit orders):
 * the request comes from this site or the Ryntra app's session for this very
 * wallet (`readSwapCarrier`), and a placement waits on the Swap lane's operator
 * stop — reading and cancelling never do: a person can always see and take back
 * what is theirs.
 */

import type { z } from "zod";

import { clientIp, FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../../http-control.ts";
import { resolveSolanaLaneState } from "../../solana/lane-state.ts";
import { readSwapCarrier, walletMismatch } from "../../solana/swap-carrier.server.ts";
import { ladderGate, ladderNetwork, type LadderNetwork } from "./network.ts";

const LIMITER = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });
const MAX_BODY = 64_000;

type Env = Readonly<Record<string, string | undefined>>;

export type OpenGate = Readonly<{
  network: LadderNetwork;
  pools: readonly string[] | null;
  quotes: readonly string[];
  maxUsd: number | null;
  rate: RateLimitDecision;
}>;

export function ladderHeaders(rate: RateLimitDecision): Record<string, string> {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

export function ladderFailure(status: number, code: string, message: string, rate: RateLimitDecision): Response {
  return Response.json({ error: { code, message } }, { status, headers: ladderHeaders(rate) });
}

/**
 * The network's switch and the rate limit; closed or limited answers here and the route stops. A request that names
 * no network is devnet's, as CITY-135 was: mainnet is only ever asked for by name.
 */
export function openLadder(request: Request, route: string, network: LadderNetwork | null = "devnet", env: Env = process.env, takeBack = false): OpenGate | Response {
  const rate = LIMITER.consume(`bots-ladder:${route}:${clientIp(request.headers)}`);
  const gate = network ? ladderGate(env, network, { takeBack }) : ({ open: false } as const);
  if (!gate.open) return ladderFailure(404, "LADDER_CLOSED", "Not found.", rate);
  if (!rate.allowed) return ladderFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  return { network: gate.network, pools: gate.pools, quotes: gate.quotes, maxUsd: gate.maxUsd, rate };
}

/** The network a request names, `devnet` when it names none; null — a name that is no network. */
export function requestedNetwork(value: unknown): LadderNetwork | null {
  if (value === undefined || value === null || value === "") return "devnet";
  return typeof value === "string" ? ladderNetwork(value) : null;
}

/**
 * Mainnet's two doors: this site or the app's session for this wallet; a placement only while trading is on.
 * Devnet passes as it was.
 */
export async function mainnetDoors(request: Request, gate: OpenGate, options: Readonly<{ acts: boolean; owner: string | null }>, env: Env = process.env): Promise<Response | null> {
  if (gate.network !== "mainnet") return null;
  const carrier = await readSwapCarrier(request, "Ladders must be asked for from this site.");
  if (!carrier.ok) return ladderFailure(carrier.status, carrier.code, carrier.message, gate.rate);
  if (options.owner && walletMismatch(carrier, options.owner)) return ladderFailure(403, "WALLET_MISMATCH", "The session's wallet is not this ladder's wallet.", gate.rate);
  if (options.acts && resolveSolanaLaneState("SWAP", env as Record<string, string | undefined>) !== "OPEN") return ladderFailure(409, "SWAP_PAUSED", "Trading is turned off right now.", gate.rate);
  return null;
}

/** A JSON body within its bound, parsed by the route's schema. */
export async function readLadderBody<S extends z.ZodType>(request: Request, schema: S, rate: RateLimitDecision): Promise<z.output<S> | Response> {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return ladderFailure(413, "TOO_LARGE", "The request is too large.", rate);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return ladderFailure(400, "VALIDATION_ERROR", "The body is not JSON.", rate);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return ladderFailure(400, "VALIDATION_ERROR", "The body does not match the request.", rate);
  return parsed.data;
}

/**
 * The POST routes' opening: the body read once within its bound (its `network` names the switch), then the switch,
 * the rate limit, the schema and mainnet's doors.
 */
export async function openLadderPost<S extends z.ZodType>(
  request: Request,
  route: string,
  schema: S,
  options: Readonly<{
    acts: (body: z.output<S>) => boolean;
    owner: (body: z.output<S>) => string | null;
    /** The request only takes back (reads, cancels): served while mainnet is `CLOSING`. */
    takeBack?: (body: z.output<S>) => boolean;
  }>,
  env: Env = process.env,
): Promise<Readonly<{ gate: OpenGate; body: z.output<S> }> | Response> {
  const text = await request.text().catch(() => "");
  let raw: unknown;
  try {
    raw = text.length <= MAX_BODY ? JSON.parse(text) : undefined;
  } catch {
    raw = undefined;
  }
  const named = raw && typeof raw === "object" ? (raw as { network?: unknown }).network : undefined;
  const parsed = raw === undefined ? null : schema.safeParse(raw);
  /* Only a request that parses and only takes back may pass a `CLOSING` switch. */
  const takeBack = Boolean(parsed?.success && options.takeBack?.(parsed.data as z.output<S>));
  const gate = openLadder(request, route, requestedNetwork(named), env, takeBack);
  if (gate instanceof Response) return gate;
  if (text.length > MAX_BODY) return ladderFailure(413, "TOO_LARGE", "The request is too large.", gate.rate);
  if (raw === undefined) return ladderFailure(400, "VALIDATION_ERROR", "The body is not JSON.", gate.rate);
  if (!parsed?.success) return ladderFailure(400, "VALIDATION_ERROR", "The body does not match the request.", gate.rate);
  const body = parsed.data as z.output<S>;
  const doors = await mainnetDoors(request, gate, { acts: options.acts(body), owner: options.owner(body) }, env);
  if (doors) return doors;
  return { gate, body };
}
