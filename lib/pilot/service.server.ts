/**
 * CITY-204 — the money autopilot wired to the deployment: its switch, the reads its care takes (the agent's book, Jupiter
 * Lend, Meteora, SOL's price) and the pass the agent's cron runs before it trades. Holds no key, signs nothing, sends
 * nothing: the money moves only in the person's own signed transactions and through the agent's signed policy.
 *
 * The switch: `RYNTRA_MONEY_PILOT=on` on the server, over the mandate's own (`RYNTRA_AGENT_MANDATE`, its network the
 * pilot's); shut by default.
 */

import "server-only";

import { PublicKey, type Connection } from "@solana/web3.js";

import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSurvivesColdStart, type GuardStore } from "../guard/store.ts";
import { readEntry } from "../mandate/book.server.ts";
import { agentResult } from "../mandate/agent-service.server.ts";
import { mandateConnection, mandateGate, type MandateGate } from "../mandate/service.server.ts";
import { fetchTokenCatalog } from "../solana/catalog.ts";
import { readPilot, type JoinDeps } from "./book.server.ts";
import { viewOfPilot, type PilotView } from "./view.ts";

export { viewOfPilot, type PilotView } from "./view.ts";
import { runPilotPass, setHold, type LendRead, type PilotLine, type PilotReads } from "./pass.server.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const PILOT_ENV = "RYNTRA_MONEY_PILOT";
export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type PilotGate = Readonly<{ open: false }> | Readonly<{ open: true; mandate: Extract<MandateGate, { open: true }> }>;

export function pilotGate(env: Env): PilotGate {
  if (env[PILOT_ENV]?.trim().toLowerCase() !== "on") return { open: false };
  const mandate = mandateGate(env);
  return mandate.open ? { open: true, mandate } : { open: false };
}

const within = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]).catch(() => null);

/** SOL in dollars from Jupiter's catalogue; null when it does not answer. */
export async function solUsdNow(): Promise<number | null> {
  const catalog = await fetchTokenCatalog([WSOL], 5_000).catch(() => null);
  const price = catalog?.ok ? Number(catalog.byMint[WSOL]?.usdPrice ?? Number.NaN) : Number.NaN;
  return Number.isFinite(price) && price > 0 ? price : null;
}

const rawOf = (value: string | null | undefined): bigint | null => (typeof value === "string" && /^\d{1,30}$/u.test(value) ? BigInt(value) : null);

/** The production reads of the care. */
export function pilotReads(gate: Extract<PilotGate, { open: true }>, store: GuardStore, connection: Connection): PilotReads {
  const network = gate.mandate.network;
  return {
    trade: async (policy, owner) => {
      const [view, policyAccount] = await Promise.all([agentResult({ policy, owner }, gate.mandate, { store, connection }), connection.getAccountInfo(new PublicKey(policy), "confirmed")]);
      if (!view) return null;
      return { state: { status: view.status, pausedBy: view.pausedBy ?? null, since: view.updatedAt }, netRaw: view.net?.netRaw === null || view.net?.netRaw === undefined ? null : BigInt(view.net.netRaw), live: policyAccount !== null };
    },
    lend: async (owner) => {
      const { readEarnSurface } = await import("../earn/service.server.ts");
      const surface = await readEarnSurface(owner);
      const of = (mint: string): LendRead | null => {
        const position = surface.positions.find((row) => row.provider === "jupiter" && (row.asset.mint === mint || row.marketId === mint));
        return position ? { underlyingRaw: rawOf(position.underlyingRaw), depositedRaw: rawOf(position.depositedRaw) } : null;
      };
      return { usdc: of(USDC_MAINNET), sol: of(WSOL) };
    },
    pier: async (owner, position, pool) => {
      const [{ readWalletPositions }, { positionView }, { readPoolRecord }] = await Promise.all([import("../liquidity/catalog/chain.server.ts"), import("../liquidity/catalog/positions.ts"), import("../liquidity/catalog/service.server.ts")]);
      const read = await within(readWalletPositions(owner), 9_000);
      const rows = read && read.dlmm.ok ? read.dlmm.value : null;
      const row = rows?.find((p) => p.address === position);
      if (!row) return null;
      const record = await within(readPoolRecord("dlmm", pool ?? row.pool, { meteora: { timeoutMs: 4_000 } }), 5_000);
      const view = positionView(row, "dlmm", record?.pool ?? null, record?.at ?? null);
      return view.valueUsd === null ? null : view.valueUsd + (view.unclaimedUsd ?? 0);
    },
    solUsd: solUsdNow,
    hold: (policy, why, now) => setHold(store, network, policy, why, now),
    go: (policy, now) => setHold(store, network, policy, null, now),
  };
}

/** The pass the agent's cron runs before the agent trades; shut — nothing. */
export async function pilotMinute(env: Env, deps: Readonly<{ store?: GuardStore; connection?: Connection; reads?: PilotReads; now?: () => number }> = {}): Promise<Readonly<{ ran: false; why: string }> | Readonly<{ ran: true; lines: readonly PilotLine[] }>> {
  const gate = pilotGate(env);
  if (!gate.open) return { ran: false, why: "closed" };
  const store = deps.store ?? getGuardRuntime().store;
  if (!storeSurvivesColdStart(store)) return { ran: false, why: "store" };
  const reads = deps.reads ?? pilotReads(gate, store, deps.connection ?? mandateConnection(gate.mandate.network));
  const lines = await runPilotPass({ store, cluster: gate.mandate.network, reads, ...(deps.now ? { now: deps.now } : {}) });
  return { ran: true, lines };
}

/** What the book needs to join a plan, in production. */
export function joinDeps(gate: Extract<PilotGate, { open: true }>, store: GuardStore, connection: Connection): JoinDeps {
  return {
    store,
    cluster: gate.mandate.network,
    mandate: async (policy) => {
      const entry = await readEntry(store, policy, gate.mandate.network);
      return entry ? { owner: entry.record.owner, preset: entry.preset, createdAt: entry.createdAt, status: entry.status } : null;
    },
    landed: async (signature, owner) => {
      const read = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!read?.meta || read.meta.err) return null;
      const payer = read.transaction.message.getAccountKeys({ accountKeysFromLookups: read.meta.loadedAddresses ?? null }).get(0);
      if (!payer || !payer.equals(new PublicKey(owner))) return null;
      return { at: (read.blockTime ?? 0) * 1000 };
    },
    solUsd: solUsdNow,
  };
}

export async function pilotOf(store: GuardStore, network: string, owner: string): Promise<PilotView | null> {
  const entry = await readPilot(store, network, owner);
  return entry ? viewOfPilot(entry) : null;
}
