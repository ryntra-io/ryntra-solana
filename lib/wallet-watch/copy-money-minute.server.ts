/**
 * «Повторюй за гаманцем» with money at work: the cron's minute (`app/api/cron/agent-copy`). One pass of the
 * engine (`./copy-money.server.ts` `runCopyMoneyPass`) over her copies on mainnet — only while the switch is open.
 *
 * In this order, and the first «no» stops it:
 * 1. **the switch** — `RYNTRA_AGENT_COPY=on` and the agent's mandate open on mainnet (`./copy-money-door.server.ts`
 *    `copyMoneyGate`); closed — the minute reads nothing and sends nothing: no key, no store, no chain;
 * 2. **the agent's key** — as every agent of Ryntra's (`../mandate/agent-service.server.ts` `agentKeyFor`): on mainnet only
 *    Google's KMS, and only once Google says its address is the registry's agent;
 * 3. **a store that survives a cold start** and **a chain that is mainnet** (its genesis);
 * 4. **the leaders' reads** — each leader read once a pass for every copy of it, from the wallet watch's own record when it
 *    was read in this window, else through the chain counted call by call under the day's ceiling of the copies' reads
 *    (`./copy-reads.server.ts`, the paper copies' own): a leader the day no longer holds is not read this pass — its trades
 *    wait, and a copy that waits too long misses them as late, never at a stale price. The
 *    window is the wallet watch's own pass (`LEADER_WINDOW_MS`, two minutes, on the clock's even minutes): a leader read in
 *    it — by the wallet watch, or by this cron a minute before — is not read again, so a quiet leader costs the ceiling
 *    720 reads a day, not one every minute (the ceiling's «eight quiet leaders»).
 *
 * The orders themselves — the freeze, the mandate, one order a minute, written down before they are sent — are the engine's.
 * One pass at a time, bounded in copies and in time (`runCopyMoneyPass`): a pass that finds another under way
 * reads nothing and says `busy`.
 */

import type { Connection } from "@solana/web3.js";

import type { GuardStore } from "../guard/store.ts";
import { storeSurvivesColdStart } from "../guard/store.ts";
import type { Fetch } from "../launch/signer/gcp-kms.server.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import type { agentTrade } from "../mandate/run.server.ts";
import type { CopyReads } from "./run.ts";
import { COPY_CALL_CREDITS, COPY_READ_WORST, READ_MAX_NEW, metered } from "./run.ts";
import { refreshActivity, type WalletChain } from "./read.ts";
import { readActivity } from "./store.ts";
import type { WalletTrade } from "./trades.ts";
import { copyMoneyGate } from "./copy-money-door.server.ts";
import type { CopyPassLine, CopyVenue } from "./copy-money.server.ts";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The window a leader is read once in, ms: the wallet watch's own pass (`vercel.json`, every two minutes), on
 * the clock's even minutes. The cron comes every minute: the minute after a read finds the leader read in this window, and
 * the next window's first minute reads it again — whatever the cron's few seconds of drift.
 */
export const LEADER_WINDOW_MS = 120_000;
/** The leader's record read in this window (`LEADER_WINDOW_MS`) is the pass's read: the wallet watch, or this cron, read it. */
export const leaderReadNow = (readAtMs: number, nowMs: number): boolean => Number.isFinite(readAtMs) && readAtMs <= nowMs + 5_000 && Math.floor(readAtMs / LEADER_WINDOW_MS) >= Math.floor(nowMs / LEADER_WINDOW_MS);
/** Kept for the readers: how old a record may be and still be this window's, at most. */
export const LEADER_FRESH_MS = LEADER_WINDOW_MS;

export type LeaderTally = { read: number; fresh: number; capped: number };

/**
 * The leaders' reads of one pass: each leader once, whatever the number of copies of it. A record read in this window
 * (`leaderReadNow`) costs nothing; any other read is asked of the day's ceiling at its worst first and paid by its calls
 * after — as the paper copies' reads are. Null — not read this pass.
 */
export function leaderReader(input: Readonly<{ store: GuardStore; chain: WalletChain; reads?: CopyReads; now: () => number }>): Readonly<{ read: (leader: string) => Promise<readonly WalletTrade[] | null>; tally: LeaderTally }> {
  const tally: LeaderTally = { read: 0, fresh: 0, capped: 0 };
  const once = new Map<string, Promise<readonly WalletTrade[] | null>>();
  const readOne = async (leader: string): Promise<readonly WalletTrade[] | null> => {
    const nowMs = input.now();
    const found = await readActivity(input.store, leader).catch(() => null);
    if (found && leaderReadNow(Date.parse(found.readAt), nowMs)) {
      tally.fresh += 1;
      return found.trades;
    }
    if (input.reads && !input.reads.allows(COPY_READ_WORST, nowMs)) {
      tally.capped += 1;
      return null;
    }
    let calls = 0;
    const chain = metered(input.chain, (n) => (calls += n));
    /* Not this window's: read now — `freshMs: 0`, the window above is the one judge of whether it is fresh. */
    const activity = await refreshActivity(input.store, chain, leader, { nowMs, freshMs: 0, maxNew: READ_MAX_NEW, concurrency: 2 }).catch(() => null);
    if (input.reads && calls > 0) input.reads.spend(calls * COPY_CALL_CREDITS, input.now());
    if (!activity) return null;
    tally.read += 1;
    return activity.trades;
  };
  return {
    read: (leader) => {
      let read = once.get(leader);
      if (!read) {
        read = readOne(leader);
        once.set(leader, read);
      }
      return read;
    },
    tally,
  };
}

export type CopyMinuteAnswer =
  | Readonly<{ ran: false; why: "closed" | "no-key" | "key-unread" | "wrong-key" | "store" | "not-mainnet" | "busy" }>
  | Readonly<{ ran: true; lines: readonly CopyPassLine[]; leaders: LeaderTally }>;

export type CopyMinuteDeps = Readonly<{
  store?: GuardStore;
  connection?: Connection;
  now?: () => number;
  fetch?: Fetch;
  /** The tests' own: the agent's key, the leaders' chain, the day's ceiling, the venue and the one trade. */
  key?: KeySigner;
  chain?: WalletChain;
  reads?: CopyReads;
  venue?: CopyVenue;
  trade?: typeof agentTrade;
}>;

/** One minute of her copies with money on mainnet — or, closed or not ready, nothing at all, and why. */
export async function copyMoneyMinute(env: Env, deps: CopyMinuteDeps = {}): Promise<CopyMinuteAnswer> {
  /* Closed: nothing is loaded, read or sent. */
  const gate = copyMoneyGate(env);
  if (!gate.open) return { ran: false, why: "closed" };
  const service = await import("../mandate/agent-service.server.ts");
  const options = deps.fetch ? { fetch: deps.fetch } : {};
  const key = deps.key ?? service.agentKeyFor(env, gate, options);
  if (!key) return { ran: false, why: "no-key" };
  /* In KMS the key's address is known only by asking Google: a key that is not the gate's agent runs no pass. */
  const access = !deps.key && key.mode === "kms" ? service.agentKmsAccess(env, options) : null;
  if (access) {
    const { kmsPublicAddress } = await import("../launch/signer/gcp-kms.server.ts");
    const address = await kmsPublicAddress(access).catch(() => null);
    if (address === null) return { ran: false, why: "key-unread" };
    if (address !== gate.agent.toBase58()) return { ran: false, why: "wrong-key" };
  }
  const store = deps.store ?? (await import("../guard/runtime.ts")).getGuardRuntime().store;
  if (!storeSurvivesColdStart(store)) return { ran: false, why: "store" };
  const { mandateConnection, onNetwork } = await import("../mandate/service.server.ts");
  const connection = deps.connection ?? mandateConnection(gate.network);
  if (!(await onNetwork(connection, gate.network))) return { ran: false, why: "not-mainnet" };
  const now = deps.now ?? Date.now;
  const [{ agentJournal }, engine] = await Promise.all([import("../mandate/tick.server.ts"), import("./copy-money.server.ts")]);
  const chain = deps.chain ?? (await import("./chain.server.ts")).productionChain();
  const reads = deps.reads ?? (await import("./copy-reads.server.ts")).copyReads(env);
  const leaders = leaderReader({ store, chain, reads, now });
  const venue = deps.venue ?? (await engine.jupiterCopyVenue(connection));
  const lines = await engine.runCopyMoneyPass({
    store,
    cluster: gate.network,
    connection,
    key,
    agent: gate.agent,
    journal: agentJournal(() => store),
    venue,
    readLeader: leaders.read,
    now,
    ...(deps.trade ? { trade: deps.trade } : {}),
  });
  /* Another pass holds the network — nothing was read or sent by this one. */
  if (lines === null) return { ran: false, why: "busy" };
  return { ran: true, lines, leaders: leaders.tally };
}
