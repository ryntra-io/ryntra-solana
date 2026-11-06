/**
 * CITY-204 — the agent looks after each plan: one pass over the autopilots of the network. For each, it reads what the
 * parts hold now — the trade from the agent's book, the savings from Jupiter Lend, the pier from Meteora, SOL's price —
 * asks the care (`./care.ts`) and writes down what it did: a hold of the trade's buys, a hold lifted, a drift noted, what
 * the plan earned. The only thing it moves is the trade's own switch in the agent's book (`paused` · `market` / `balance`,
 * and back) — it signs nothing and sends nothing; the trading itself is the agent's pass (`lib/mandate/tick.server.ts`),
 * which runs right after this one in the same cron and so sees the hold before it buys.
 *
 * Every read is handed in (`PilotReads`): the production ones are `./service.server.ts`, the tests' are fixtures.
 */

import type { GuardStore } from "../guard/store.ts";
import { readEntry, writeEntry } from "../mandate/book.server.ts";
import { careOf, earnedOf, isHold, weekOf, withMark, withSnap, type HoldWhy, type TradeState } from "./care.ts";
import { readPilots, withEvent, writePilot, type PilotEntry, type PilotEvent } from "./book.server.ts";
import { legsOf, usdOfSol, usdOfUsdc, type PilotPart } from "./plan.ts";

/** A plan is looked after at most this often. */
export const CARE_EVERY_MS = 15 * 60_000;
/** The pass starts no plan after this: the agent's own pass follows in the same minute. */
export const PILOT_PASS_MS = 15_000;
export const PILOTS_PER_PASS = 12;
/** A drift is told once a day at most. */
export const DRIFT_TOLD_MS = 86_400_000;

/** What a Jupiter Lend position of one asset holds, base units: worth now, and put in. Null fields — not read. */
export type LendRead = Readonly<{ underlyingRaw: bigint | null; depositedRaw: bigint | null }>;

export type PilotReads = Readonly<{
  /**
   * The trade's mandate: its state in the agent's book, its result after every fee, lamports, and whether its policy still
   * stands on chain (`live`; absent — not read). The agent's own pass leaves a paused mandate alone, so a stop she signs
   * while the care holds the trade is seen here, on chain, not in the book.
   */
  trade: (policy: string, owner: string) => Promise<Readonly<{ state: TradeState; netRaw: bigint | null; live?: boolean }> | null>;
  /** Her Jupiter Lend positions of USDC and of SOL. */
  lend: (owner: string) => Promise<Readonly<{ usdc: LendRead | null; sol: LendRead | null }>>;
  /** What her pier position is worth now, USD, its unclaimed fees inside; null — not read. */
  pier: (owner: string, position: string, pool: string | null) => Promise<number | null>;
  solUsd: () => Promise<number | null>;
  /** The trade's buys held — or let go — in the agent's book, on the row read afresh; false when the row is not the agent's to change. */
  hold: (policy: string, why: HoldWhy, now: number) => Promise<boolean>;
  go: (policy: string, now: number) => Promise<boolean>;
}>;

export type PilotLine = Readonly<{ owner: string; did: "cared" | "held" | "went" | "stopped" | "waited" | "unread" }>;

/** A leg's part of a Lend position: what the leg put in, grown by the position's own rate, never more than it holds. */
export function legWorth(legRaw: bigint, read: LendRead | null): bigint | null {
  if (legRaw === 0n) return 0n;
  if (!read || read.underlyingRaw === null || read.depositedRaw === null || read.depositedRaw <= 0n) return null;
  const grown = (legRaw * read.underlyingRaw) / read.depositedRaw;
  return grown < read.underlyingRaw ? grown : read.underlyingRaw;
}

export async function runPilotPass(deps: Readonly<{ store: GuardStore; cluster: string; reads: PilotReads; now?: () => number }>): Promise<readonly PilotLine[]> {
  const now = deps.now ?? Date.now;
  const started = now();
  const lines: PilotLine[] = [];
  const pilots = (await readPilots(deps.store, deps.cluster)).filter((p) => p.status === "working").sort((a, b) => (a.care?.at ?? 0) - (b.care?.at ?? 0));
  for (const pilot of pilots) {
    if (lines.length >= PILOTS_PER_PASS || now() - started >= PILOT_PASS_MS) break;
    if (pilot.care && now() - pilot.care.at < CARE_EVERY_MS) continue;
    let did: PilotLine["did"];
    try {
      did = await careFor(pilot, deps.reads, deps.store, now());
    } catch {
      did = "unread";
    }
    lines.push({ owner: pilot.owner, did });
  }
  return lines;
}

async function careFor(pilot: PilotEntry, reads: PilotReads, store: GuardStore, at: number): Promise<PilotLine["did"]> {
  const legs = legsOf(pilot.plan);
  const [trade, lend, pier, solUsd] = await Promise.all([
    pilot.policy ? reads.trade(pilot.policy, pilot.owner).catch(() => undefined) : Promise.resolve(null),
    pilot.legs.saveUsdc?.state === "landed" || pilot.legs.saveSol?.state === "landed" ? reads.lend(pilot.owner).catch(() => null) : Promise.resolve(null),
    pilot.legs.pool?.state === "landed" && pilot.legs.pool.position ? reads.pier(pilot.owner, pilot.legs.pool.position, pilot.legs.pool.pool ?? null).catch(() => null) : Promise.resolve(null),
    reads.solUsd().catch(() => null),
  ]);

  /* Her stop: the mandate taken back — the plan stops with it; what is in her savings and her pier stays hers, where it is. */
  if (trade && (trade.state.status === "stopped" || trade.live === false)) {
    /* A mandate the care held when she stopped it: the book says so too, or it would read «paused» for ever. */
    if (trade.live === false && pilot.policy) await stopInBook(store, pilot.cluster, pilot.policy, at);
    await writePilot(store, { ...withEvent(pilot, { at, what: "stopped" }), status: "stopped", updatedAt: at });
    return "stopped";
  }

  const marks = withMark(pilot.marks, at, solUsd);
  const p = solUsd;
  const lendUsdc = legWorth(legs.save.usdcRaw, pilot.legs.saveUsdc?.state === "landed" ? (lend?.usdc ?? null) : { underlyingRaw: legs.save.usdcRaw, depositedRaw: legs.save.usdcRaw });
  const lendSol = legWorth(legs.save.solRaw, pilot.legs.saveSol?.state === "landed" ? (lend?.sol ?? null) : { underlyingRaw: legs.save.solRaw, depositedRaw: legs.save.solRaw });
  const poolUsd = pilot.legs.pool?.state === "landed" ? pier : p === null ? null : usdOfSol(legs.pool.solRaw, p);
  const tradeRaw = trade === undefined ? null : trade === null ? 0n : trade.netRaw === null ? null : legs.trade.solRaw + trade.netRaw;
  const values: Record<PilotPart, number | null> = {
    trade: p === null || tradeRaw === null ? null : usdOfSol(tradeRaw > 0n ? tradeRaw : 0n, p),
    save: p === null || lendUsdc === null || lendSol === null ? null : usdOfUsdc(lendUsdc) + usdOfSol(lendSol, p),
    pool: legs.pool.solRaw === 0n ? 0 : poolUsd,
    reserve: p === null ? null : usdOfSol(legs.reserve.solRaw, p) + usdOfUsdc(legs.reserve.usdcRaw),
  };
  const state: TradeState | null = trade ? (pilot.held && trade.state.status === "paused" && trade.state.pausedBy === pilot.held.why ? { ...trade.state, since: pilot.held.since } : trade.state) : null;
  const care = careOf({ rules: pilot.plan.rules, targets: pilot.plan.shares, now: at, marks, trade: state, values });

  let next: PilotEntry = { ...pilot, marks };
  let did: PilotLine["did"] = "cared";
  if (pilot.policy && care.trade.do === "hold" && (await reads.hold(pilot.policy, care.trade.why, at))) {
    next = withEvent({ ...next, held: { why: care.trade.why, since: at } }, { at, what: "hold", why: care.trade.why, ...(care.trade.why === "market" && care.fallBps !== null ? { fallBps: care.fallBps } : {}) });
    did = "held";
  } else if (pilot.policy && care.trade.do === "go" && (await reads.go(pilot.policy, at))) {
    const { held: _was, ...rest } = next;
    next = withEvent(rest, { at, what: "go" });
    did = "went";
  }
  const lastDrift = [...next.events].reverse().find((event) => event.what === "drift");
  if (care.drift.length && (!lastDrift || at - lastDrift.at >= DRIFT_TOLD_MS || JSON.stringify(lastDrift.parts) !== JSON.stringify(care.drift))) next = withEvent(next, { at, what: "drift", parts: care.drift } satisfies PilotEvent);

  /* What it earned, against just holding what went in: the trade after every fee, the interest, the pier against its SOL. */
  const earnedUsd =
    p === null
      ? null
      : earnedOf(
          {
            tradeUsd: trade && trade.netRaw !== null ? usdOfSol(trade.netRaw, p) : trade === null ? 0 : null,
            saveUsd: lendUsdc === null || lendSol === null ? null : usdOfUsdc(lendUsdc - legs.save.usdcRaw) + usdOfSol(lendSol - legs.save.solRaw, p),
            poolUsd: poolUsd === null ? null : poolUsd - usdOfSol(legs.pool.solRaw, p),
          },
          { trade: legs.trade.solRaw > 0n, save: legs.save.usdcRaw > 0n || legs.save.solRaw > 0n, pool: legs.pool.solRaw > 0n },
        );
  const snaps = withSnap(next.snaps, at, earnedUsd);
  const weekUsd = weekOf(snaps, at, earnedUsd);
  next = { ...next, snaps, care: { at, shares: care.shares, earnedUsd, weekUsd, solUsd, fallBps: care.fallBps }, updatedAt: at };
  await writePilot(store, next);
  return did;
}

/** Her stop, written in the agent's book when the policy is gone and the row still stands paused or working. */
export async function stopInBook(store: GuardStore, network: "devnet" | "mainnet", policy: string, now: number): Promise<boolean> {
  const entry = await readEntry(store, policy, network);
  if (!entry || (entry.status !== "paused" && entry.status !== "working")) return false;
  const { pausedBy: _was, ...rest } = entry;
  await writeEntry(store, { ...rest, status: "stopped", updatedAt: now });
  return true;
}

/**
 * The trade's buys held for `why`, or — `why` null — the agent's own hold lifted, on the book's row read afresh. A pause
 * of the book's own (the person's exit, a loss, failures) is never touched; a mandate no longer working is left alone.
 */
export async function setHold(store: GuardStore, network: "devnet" | "mainnet", policy: string, why: HoldWhy | null, now: number): Promise<boolean> {
  const entry = await readEntry(store, policy, network);
  if (!entry) return false;
  if (why) {
    if (entry.status === "working" || (entry.status === "paused" && isHold(entry.pausedBy) && entry.pausedBy !== why)) {
      await writeEntry(store, { ...entry, status: "paused", pausedBy: why, updatedAt: now });
      return true;
    }
    return false;
  }
  if (entry.status !== "paused" || !isHold(entry.pausedBy)) return false;
  const { pausedBy: _was, ...rest } = entry;
  await writeEntry(store, { ...rest, status: "working", updatedAt: now });
  return true;
}
