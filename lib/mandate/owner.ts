/**
 * CITY-207 — a wallet's agents as the engine knows them, for any browser and any phone: the mandates the agent works
 * for (its book, `./book.server.ts`), the money autopilot standing on one of them (`../pilot/book.server.ts`) and the
 * piers it looks after (`../care/service.server.ts`), each network apart. Before this, only the browser that signed a
 * mandate knew where it was; now the book is the truth and the browser's note only a cache.
 *
 * Pure: the shapes and the one rule of which mandate a wallet sees first. The reads are `./owner.server.ts`.
 * Public data only — addresses, numbers, states; never a key.
 */

import type { BookEntry, BookStatus } from "./book.server.ts";
import type { MandateNetwork, MandateRecord } from "./service.server.ts";
import { resultOf } from "./strategy.ts";

export const AGENT_NETWORKS: readonly MandateNetwork[] = ["mainnet", "devnet"];

/** The newest mandates a wallet's answer carries per network; older ones stay in the book. */
export const MANDATES_SHOWN = 5;

/** What the chain says of a mandate now: its budget left and whether its policy still stands; null — not read. */
export type ChainNow = Readonly<{ budgetLamports: string | null; live: boolean | null }>;

export const UNREAD: ChainNow = { budgetLamports: null, live: null };

export type OwnerMandate = Readonly<{
  /** The public addresses and numbers the person signed — what the city keeps as its cache. */
  record: MandateRecord;
  preset: BookEntry["preset"];
  strategy: BookEntry["strategy"];
  plan: string;
  /** The book's state: working, paused, stopped, ended or spent. */
  status: BookStatus;
  pausedBy: BookEntry["pausedBy"] | null;
  receiveMint: string;
  said: string | null;
  /** The budget's SOL in the vault on chain, lamports; null — not read. */
  budgetLamports: string | null;
  /** Whether the policy still stands on chain; null — not read. */
  live: boolean | null;
  /** The agent may act: its policy stands and the book has it at work (or resting a while). */
  active: boolean;
  /** What is at work: the budget spent on the coin, lamports, and the coin bought, its base units, over the done trades. */
  spentLamports: string;
  boughtRaw: string;
  trades: number;
  /** The money autopilot's trade part stands on this mandate. */
  pilot: boolean;
  /** CITY-70: her «Freeze» is on — the agent starts nothing new. */
  frozen: boolean;
  createdAt: number;
  updatedAt: number;
}>;

export type OwnerPilot = Readonly<{ status: "working" | "stopped"; policy: string | null; createdAt: number }>;

export type OwnerCare = Readonly<{ key: string; pool: string; vault: string; status: "working" | "stopped"; createdAt: number }>;

/** Which of the engine's switches stand open on this deployment for the network. */
export type NetworkOpen = Readonly<{ mandate: boolean; pilot: boolean; care: boolean }>;

export type NetworkAgents = Readonly<{
  network: MandateNetwork;
  open: NetworkOpen;
  /** False when the book did not answer: the lists are then empty, not «none». */
  read: boolean;
  mandates: readonly OwnerMandate[];
  pilot: OwnerPilot | null;
  cares: readonly OwnerCare[];
}>;

export type OwnerAgents = Readonly<{ owner: string; networks: Readonly<Record<MandateNetwork, NetworkAgents>> }>;

/** A book's state in which the agent still acts for her. */
export const atWork = (status: BookStatus): boolean => status === "working" || status === "paused";

/** One mandate of the book as the wallet's answer shows it, with what the chain says now. */
export function ownerMandate(entry: BookEntry, chain: ChainNow, pilotPolicy: string | null, frozen = false): OwnerMandate {
  const result = resultOf(entry.trades, null);
  return {
    record: entry.record,
    preset: entry.preset,
    strategy: entry.strategy,
    plan: entry.plan ?? "steady",
    status: entry.status,
    pausedBy: entry.pausedBy ?? null,
    receiveMint: entry.receiveMint,
    said: entry.said,
    budgetLamports: chain.budgetLamports,
    live: chain.live,
    /* A removed policy is a stop, whatever the book has not caught yet; an unread chain leaves the book's word. */
    active: atWork(entry.status) && chain.live !== false,
    spentLamports: result.spentRaw,
    boughtRaw: result.boughtRaw,
    trades: result.trades,
    pilot: pilotPolicy !== null && pilotPolicy === entry.record.policy,
    frozen,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/** The wallet's mandates on one network, the newest first, at most `MANDATES_SHOWN`. */
export function ownedEntries(rows: readonly BookEntry[], owner: string): readonly BookEntry[] {
  return rows
    .filter((row) => row.record.owner === owner)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MANDATES_SHOWN);
}

/** The mandate a wallet sees first: one at work, the newest of them; else the newest of all. */
export function leadMandate(mandates: readonly OwnerMandate[]): OwnerMandate | null {
  return mandates.find((m) => m.active) ?? mandates[0] ?? null;
}

/** An SPL token account's amount from its raw data (offset 64, u64 little-endian); null — not one. */
export function tokenAmountOf(data: Uint8Array | null | undefined): string | null {
  if (!data || data.length < 72) return null;
  let amount = 0n;
  for (let i = 7; i >= 0; i -= 1) amount = (amount << 8n) | BigInt(data[64 + i]!);
  return amount.toString();
}
