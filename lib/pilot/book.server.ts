/**
 * CITY-204 — the money autopilots: one per wallet and network, kept in the Guard store's `moneyPilots` (a value in the
 * same column; no DDL), keyed `p:<cluster>:<owner>`. Public data only: addresses, numbers, signatures, her own words.
 *
 * A plan joins the book only when what it stands on is real: its trade part is a mandate of the agent's book for this
 * wallet (checked on chain when it joined, `lib/mandate/book.server.ts`), and each leg that moved money is a signature
 * the chain has, paid by this wallet. Without her wallet's proof it joins only fresh — within minutes of the mandate or
 * the legs it names — so nobody can hang a plan on a stranger's agent later.
 */

import type { GuardCollection, GuardStore } from "../guard/store.ts";
import type { Mark } from "../mandate/plans.ts";
import type { HoldWhy, Snap } from "./care.ts";
import { legsOf, planFromData, type PilotNetwork, type PilotPart, type PilotPlanData } from "./plan.ts";

export const PILOT_BOOK = "moneyPilots";
export const pilotKey = (cluster: string, owner: string) => `p:${cluster}:${owner}`;
export const pilotsOf = (store: GuardStore): GuardCollection<PilotEntry> => store.collection(PILOT_BOOK);

/** A plan joins without her wallet's proof only this soon after what it stands on. */
export const JOIN_FRESH_MS = 15 * 60_000;
/** What the agent did lately, newest last. */
export const EVENTS_KEPT = 30;

export type LegState = Readonly<{ asset: "SOL" | "USDC"; raw: string; signature: string | null; state: "paper" | "landed"; position?: string; pool?: string }>;

export type PilotEvent = Readonly<{
  at: number;
  what: "start" | "hold" | "go" | "drift" | "stopped";
  why?: HoldWhy;
  /** SOL's fall when it held for the market, basis points. */
  fallBps?: number;
  parts?: readonly PilotPart[];
}>;

export type PilotEntry = Readonly<{
  v: 1;
  cluster: PilotNetwork;
  owner: string;
  said: string | null;
  plan: PilotPlanData;
  /** The trade part's mandate in the agent's book; null — the plan trades nothing. */
  policy: string | null;
  legs: Readonly<{ saveUsdc: LegState | null; saveSol: LegState | null; pool: LegState | null }>;
  /** SOL's price the day it started, USD — what the pier's SOL is measured against. */
  startSolUsd: number | null;
  status: "working" | "stopped";
  /** Since when the agent holds the trade's buys, and why. */
  held?: Readonly<{ why: HoldWhy; since: number }>;
  events: readonly PilotEvent[];
  marks: readonly Mark[];
  snaps: readonly Snap[];
  /** The last care: when, the shares then, what it earned since the start and over the week, USD (null — not read). */
  care?: Readonly<{ at: number; shares: Readonly<Record<PilotPart, number>> | null; earnedUsd: number | null; weekUsd: number | null; solUsd: number | null; fallBps: number | null }>;
  createdAt: number;
  updatedAt: number;
}>;

export const withEvent = (entry: PilotEntry, event: PilotEvent): PilotEntry => ({ ...entry, events: [...entry.events, event].slice(-EVENTS_KEPT) });

export async function readPilot(store: GuardStore, cluster: string, owner: string): Promise<PilotEntry | null> {
  const row = await pilotsOf(store).get(pilotKey(cluster, owner));
  return row && row.v === 1 ? row : null;
}

export async function writePilot(store: GuardStore, entry: PilotEntry): Promise<void> {
  await pilotsOf(store).set(pilotKey(entry.cluster, entry.owner), entry);
}

export async function readPilots(store: GuardStore, cluster: string): Promise<readonly PilotEntry[]> {
  return (await pilotsOf(store).valuesWithPrefix(`p:${cluster}:`)).filter((row) => row?.v === 1);
}

/* ---------------------------------------------------------------- joining */

export type JoinLeg = Readonly<{ signature: string; position?: string | null; pool?: string | null }>;

export type JoinInput = Readonly<{
  owner: string;
  said: string | null;
  plan: unknown;
  policy: string | null;
  legs: Readonly<{ saveUsdc?: JoinLeg | null; saveSol?: JoinLeg | null; pool?: JoinLeg | null }>;
  /** The wallet proved itself to Ryntra (its sign-in): the freshness bound does not apply. */
  proven: boolean;
}>;

/** What the book needs to know of the chain and of the agent's book. */
export type JoinDeps = Readonly<{
  store: GuardStore;
  cluster: PilotNetwork;
  /** The mandate's row in the agent's book: its owner, its budget, when it joined. */
  mandate: (policy: string) => Promise<Readonly<{ owner: string; preset: string; createdAt: number; status: string }> | null>;
  /** A signature's fate: landed and paid by this wallet, when; null — not landed, failed, or another payer's. */
  landed: (signature: string, owner: string) => Promise<Readonly<{ at: number }> | null>;
  solUsd: () => Promise<number | null>;
  now?: () => number;
}>;

export type JoinResult = Readonly<{ ok: true; entry: PilotEntry }> | Readonly<{ ok: false; code: "REFUSED" | "UNAVAILABLE"; reason: string }>;

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/u;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

export async function joinPilot(input: JoinInput, deps: JoinDeps): Promise<JoinResult> {
  const now = (deps.now ?? Date.now)();
  const plan = planFromData(input.plan);
  if (!plan) return { ok: false, code: "REFUSED", reason: "Not a plan the agent keeps." };
  if (!ADDRESS.test(input.owner)) return { ok: false, code: "REFUSED", reason: "Not a wallet." };
  const legs = legsOf(plan);
  const fresh = (at: number) => input.proven || (at <= now + 60_000 && now - at <= JOIN_FRESH_MS);

  /* The trade: the mandate the agent works for, this wallet's, of the plan's budget. */
  let policy: string | null = null;
  if (plan.preset) {
    if (!input.policy || !ADDRESS.test(input.policy)) return { ok: false, code: "REFUSED", reason: "The plan trades, so it names its mandate." };
    const row = await deps.mandate(input.policy).catch(() => undefined);
    if (row === undefined) return { ok: false, code: "UNAVAILABLE", reason: "The agent's book did not answer." };
    if (!row || row.owner !== input.owner) return { ok: false, code: "REFUSED", reason: "The agent does not work for this wallet's mandate." };
    if (row.preset !== plan.preset) return { ok: false, code: "REFUSED", reason: "The mandate's budget is not the plan's." };
    if (!fresh(row.createdAt)) return { ok: false, code: "REFUSED", reason: "The mandate is not a new one." };
    policy = input.policy;
  } else if (input.policy) return { ok: false, code: "REFUSED", reason: "The plan trades nothing." };

  /* The legs that moved money: each a signature the chain has, paid by her. A leg of the plan without one runs on paper. */
  const leg = async (asset: "SOL" | "USDC", raw: bigint, given: JoinLeg | null | undefined, live: boolean): Promise<LegState | null | "refused" | "unavailable"> => {
    if (raw === 0n) return given ? "refused" : null;
    if (!live || !given) return { asset, raw: raw.toString(), signature: null, state: "paper" };
    if (!SIGNATURE.test(given.signature)) return "refused";
    const fate = await deps.landed(given.signature, input.owner).catch(() => undefined);
    if (fate === undefined) return "unavailable";
    if (!fate || !fresh(fate.at)) return "refused";
    const position = given.position && ADDRESS.test(given.position) ? given.position : undefined;
    const pool = given.pool && ADDRESS.test(given.pool) ? given.pool : undefined;
    return { asset, raw: raw.toString(), signature: given.signature, state: "landed", ...(position ? { position } : {}), ...(pool ? { pool } : {}) };
  };
  const live = deps.cluster === "mainnet";
  const [saveUsdc, saveSol, pool] = await Promise.all([leg("USDC", legs.save.usdcRaw, input.legs.saveUsdc, live), leg("SOL", legs.save.solRaw, input.legs.saveSol, live), leg("SOL", legs.pool.solRaw, input.legs.pool, live)]);
  const all = [saveUsdc, saveSol, pool];
  if (all.includes("unavailable")) return { ok: false, code: "UNAVAILABLE", reason: "The chain did not answer." };
  if (all.includes("refused")) return { ok: false, code: "REFUSED", reason: "A leg is not a transaction of this wallet's." };
  if (!policy && !all.some((x) => x && typeof x === "object" && x.state === "landed")) return { ok: false, code: "REFUSED", reason: "Nothing of the plan stands." };

  const solUsd = await deps.solUsd().catch(() => null);
  const known = await readPilot(deps.store, deps.cluster, input.owner);
  /* The same plan joining twice — a retry — keeps the first. */
  if (known && known.status === "working" && known.policy === policy && JSON.stringify(known.legs) === JSON.stringify({ saveUsdc, saveSol, pool })) return { ok: true, entry: known };
  const entry: PilotEntry = {
    v: 1,
    cluster: deps.cluster,
    owner: input.owner,
    said: input.said ? input.said.slice(0, 140) : null,
    plan,
    policy,
    legs: { saveUsdc: saveUsdc as LegState | null, saveSol: saveSol as LegState | null, pool: pool as LegState | null },
    startSolUsd: solUsd,
    status: "working",
    events: [{ at: now, what: "start" }],
    marks: solUsd !== null ? [{ at: now, price: solUsd }] : [],
    snaps: [{ at: now, earnedUsd: 0 }],
    createdAt: now,
    updatedAt: now,
  };
  await writePilot(deps.store, entry);
  return { ok: true, entry };
}
