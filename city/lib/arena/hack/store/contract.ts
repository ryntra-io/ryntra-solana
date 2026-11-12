/**
 * What Hack keeps on the server (CITY-226), as one interface two stores fill: memory on a developer's machine and in
 * tests (`memory.ts`), the database wherever a deployment runs (`supabase.ts`, over
 * `supabase/migrations/20261108180000_hack_v1.sql`). It is the library's `HackStore` (CITY-223, `../registry.ts`) and
 * the atomic steps the routes need on top of it — each one decided under one lock, so two server instances never both
 * pass a rule only one of them fits:
 *
 *   • an order opens once — an id never overwrites another — and one protocol wallet opens so many a day;
 *   • an agent takes an order once; the protocol's owner never attacks its own order; one owner plays one side;
 *   • a finding is filed once — the same id never overwrites the first one's evidence or verdict — and needs its
 *     agent's take; «who first» by the duplicate key: one confirmed finding to a vulnerability, the later a duplicate;
 *   • an owner's move (pause, resume, close, settle) is the protocol owner's alone; the deadline the system's.
 *
 * No money here: `payable` is only «the rules would allow a reward».
 */

import type { HackStore, StoredOrder } from "../registry.ts";
import type { Assessment, HackReason } from "../rules.ts";
import { dedupeKey, type Finding, type Severity } from "../finding.ts";
import { ORDER_TRANSITIONS, type Order, type OrderMove } from "../order.ts";

/** The two sides of an order: the attacker breaks the copy and files findings; the defender patches (CITY-225). */
export const HACK_ROLES = ["attacker", "defender"] as const;
export type HackRole = (typeof HACK_ROLES)[number];
export const isHackRole = (value: unknown): value is HackRole => typeof value === "string" && (HACK_ROLES as readonly string[]).includes(value);

/** An agent on an order: its id, its owner's wallet and its side. */
export type Take = { readonly order: string; readonly hunter: string; readonly owner: string; readonly role: HackRole; readonly takenAt: number };

/** The owner's own reasons, beside the rules' (`HackReason`), and the one a plain `putFinding` records under. */
export type FiledReason = HackReason | "OWNER_CONFIRMED" | "OWNER_REJECTED" | "RECORDED";

/** A finding as it is kept: the finding as handed in (its `status` is the kept one) and the verdict on it. */
export type FiledFinding = {
  readonly finding: Finding;
  readonly reason: FiledReason;
  /** The severity it counts at; `null` when it does not count. */
  readonly severity: Severity | null;
  readonly payable: boolean;
  readonly dedupeKey: string;
  readonly detail: string;
  /** The protocol owner who gave their word on it under review, and when. */
  readonly resolvedBy: string | null;
  readonly resolvedAt: number | null;
  readonly updatedAt: number;
};

/** A day's limit: since a moment (the UTC day's start), at most so many. `null` — no limit (the library's own path). */
export type DayLimit = { readonly since: number; readonly perOwner: number; readonly perHunter?: number } | null;

export type Opened = { ok: true; order: Order } | { ok: false; reason: "EXISTS" | "RATE_LIMITED" };

export type MoveRefusal = "NOT_FOUND" | "NOT_OWNER" | "NOT_YET" | "BAD_MOVE" | "UNRESOLVED";
export type Moved = { ok: true; order: Order } | { ok: false; reason: MoveRefusal; status?: Order["status"] };

export type TakeRefusal = "NOT_FOUND" | "CLOSED" | "WINDOW" | "SELF_AUDIT" | "BOTH_SIDES" | "HUNTER_TAKEN" | "RATE_LIMITED";
export type Taken = { ok: true; take: Take; again: boolean } | { ok: false; reason: TakeRefusal; status?: Order["status"] };

export type FileRefusal = "NOT_FOUND" | "EXISTS" | "NOT_TAKEN" | "RATE_LIMITED";
export type Filed = { ok: true; filed: FiledFinding } | { ok: false; reason: FileRefusal };

export type ResolveRefusal = "NOT_FOUND" | "NOT_OWNER" | "SETTLED" | "NOT_PENDING" | "NO_RUN";
export type Resolved = { ok: true; filed: FiledFinding } | { ok: false; reason: ResolveRefusal; status?: Finding["status"] };

export type Verdict = "confirm" | "reject";

/** The verdict a finding is filed with: the rules' `Assessment` fits it as it is. */
export type FileVerdict = {
  readonly status: Finding["status"];
  readonly reason: FiledReason;
  readonly severity: Severity | null;
  readonly payable: boolean;
  readonly dedupeKey: string;
  readonly detail: string;
};

/** Moves only the protocol owner may make — the same list as the library's registry. */
export const OWNER_MOVES: readonly OrderMove[] = ["pause", "resume", "close", "settle"];

export interface HackDb extends HackStore {
  /** `true` when every server instance reads the same store (the database). Production opens only on one. */
  readonly durable: boolean;

  /** A new order, once, with the day's limit for its protocol wallet. */
  open(stored: StoredOrder, limit: DayLimit, now: number): Promise<Opened>;
  /** A move of the order's state machine; `by` is the caller's wallet, `null` for the system's deadline. */
  move(id: string, move: OrderMove, by: string | null, now: number): Promise<Moved>;
  /** An agent takes an order; the same take again is the same take (`again`). */
  take(input: Omit<Take, "takenAt">, limit: DayLimit, now: number): Promise<Taken>;
  takes(orderId: string): Promise<Take[]>;
  /** A finding with the rules' verdict, filed once; `needTake` asks for the agent's attacker take on the order. */
  file(input: { finding: Finding; verdict: FileVerdict }, options: { needTake: boolean; limit: DayLimit }, now: number): Promise<Filed>;
  /** `payable` — what a confirmation would allow, if first. */
  resolve(input: { id: string; by: string; verdict: Verdict; payable: boolean }, now: number): Promise<Resolved>;
  filed(id: string): Promise<FiledFinding | null>;
  filedForOrder(orderId: string): Promise<FiledFinding[]>;

  /** One write from a network this hour; refused once the hour's count passes `cap`. */
  hit(key: string, cap: number, now: number): Promise<{ allowed: boolean; retryAfterS: number }>;
  /** A stored answer to a request key, so a retried write is never done twice. */
  answer(key: string, now: number): Promise<unknown | null>;
  keepAnswer(key: string, body: unknown, now: number): Promise<void>;
}

/** The store could not be reached, or answered in a way Hack does not read: nothing it was asked is known. */
export class HackStoreUnavailable extends Error {
  override name = "HackStoreUnavailable";
}

/** The store refused a plain `HackStore` write the library asked for (no such order, or a move off the state machine). */
export class HackStoreRefused extends Error {
  override name = "HackStoreRefused";
}

/** The limits of the start wave: no money, training orders, generous for people and tight for floods. */
export const HACK_LIMITS = {
  /** Orders one protocol wallet opens a UTC day. */
  ordersPerDay: 5,
  /** Takes one wallet makes a UTC day, over every order. */
  takesPerDay: 30,
  /** Findings one wallet files a UTC day, and one agent. */
  findingsPerDay: 60,
  findingsPerHunterDay: 30,
  /** Writes from one network an hour (IPv4 address, IPv6 /64). */
  writesPerHour: 120,
  /** Writes from one wallet an hour, over every route. */
  walletWritesPerHour: 240,
  /** The longest window an order may run. */
  maxWindowMs: 90 * 24 * 3_600_000,
} as const;

export const DAY_MS = 86_400_000;
export const dayStart = (at: number) => at - (at % DAY_MS);

/** How long the answer to a request key is kept: a retry comes within minutes. */
export const ANSWER_MS = 10 * 60_000;

/** The default the reason of a plain `putFinding` records under, and the status it came with. */
export const RECORDED: FiledReason = "RECORDED";

/**
 * The move that takes an order from one status to another, for the library's plain `setOrderStatus`: an owner's move
 * before the system's deadline (both reach `closed`). `null` when no single move does.
 */
export function moveToward(from: Order["status"], to: Order["status"]): OrderMove | null {
  const moves = ORDER_TRANSITIONS[from] ?? {};
  const found = (Object.keys(moves) as OrderMove[]).filter((m) => moves[m] === to);
  return found.find((m) => m !== "deadline") ?? found[0] ?? null;
}

/** What a plain `putFinding` records: the status it came with, counted at its claim only when it was confirmed or a duplicate. */
export function recordedVerdict(finding: Finding): FileVerdict {
  const counted = finding.status === "confirmed" || finding.status === "duplicate";
  return { status: finding.status, reason: RECORDED, severity: counted ? finding.severity : null, payable: false, dedupeKey: dedupeKey(finding), detail: "recorded" };
}

/** The rules' assessment as a filing verdict. */
export const verdictOf = (assessment: Assessment): FileVerdict => ({
  status: assessment.status,
  reason: assessment.reason,
  severity: assessment.severity,
  payable: assessment.payable,
  dedupeKey: assessment.dedupeKey,
  detail: assessment.detail,
});
