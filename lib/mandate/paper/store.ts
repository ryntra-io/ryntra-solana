/**
 * Where paper agents live: their own store, never the mandate's book (paper and money never mix). One row per
 * key the person's browser holds; each write names the version it read, so two passes never both trade the same
 * paper agent — the one that lost the race leaves it to the next pass.
 *
 * Two stores: the database's (`./supabase-store.ts`, the functions of
 * `supabase/migrations/20261120190100_agent_paper_week_v1.sql`) and one in memory for the tests. Until the migration is
 * applied the database's answers `PaperStoreUnavailable`, and the route and the cron say so — paper is not open yet —
 * rather than keep a week in an instance's memory that the next cold start forgets.
 */

import { paperAgentOf, type PaperAgent, type PaperNetwork } from "./model.ts";

export class PaperStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperStoreUnavailable";
  }
}

export type Versioned = Readonly<{ agent: PaperAgent; version: number }>;

/** What a start answered: started; one already trades on paper for this key; the store holds as many as it takes. */
export type StartAnswer = "started" | "working" | "full";

/** What an admission answered: admitted (and counted); this caller or everyone started too many lately; the store is full. */
/** `limited` — this wallet started too often; `busy` — everyone together did (not this wallet's doing). */
export type AdmitAnswer = "ok" | "limited" | "busy" | "full";

/**
 * How many starts the store admits — the same figures as `public.agent_paper_admit`: a caller's in the last hour and the
 * last day, and everyone's in the last hour. Every admitted attempt counts, whether or not its quotes then read: a start
 * spends live quotes, so a start that failed is still a start.
 */
export const PAPER_STARTS = Object.freeze({ perHour: 3, perDay: 8, allPerHour: 240 });

export type PaperStore = Readonly<{
  get(id: string): Promise<Versioned | null>;
  /**
   * May `who` (an HMAC of the caller's address, `../service.server.ts` `whoOf`) start a paper week now? Asked before a
   * single quote is spent; an admitted attempt is counted at once. Durable: the database's ledger, not an instance's memory.
   */
  admit(who: string, network: PaperNetwork, limit: number): Promise<AdmitAnswer>;
  /** A new week for this key: refused while one of its weeks is still at work; a week that ended is replaced. */
  start(agent: PaperAgent, limit: number): Promise<StartAnswer>;
  /** The agent written over the version read; the new version, or null when another pass wrote first. */
  put(agent: PaperAgent, version: number): Promise<number | null>;
  /** The paper agents at work, the longest untouched first. */
  due(network: PaperNetwork, limit: number): Promise<readonly Versioned[]>;
  /** The weeks that ended and stayed untouched for `days` (at least 30), gone; how many. */
  purge(days: number): Promise<number>;
}>;

/** The most paper agents one store keeps at work at once: every one of them costs the route a few quotes a pass. */
export const PAPER_AT_WORK_MAX = 2_000;

const atWork = (agent: PaperAgent) => agent.status === "working" || agent.status === "paused";

const HOUR_MS = 3_600_000;

/** A store in memory — the tests', and nothing else's. */
export function createMemoryPaperStore(options: Readonly<{ now?: () => number }> = {}): PaperStore & { rows: Map<string, Versioned>; starts: { who: string; at: number }[] } {
  const rows = new Map<string, Versioned>();
  const starts: { who: string; at: number }[] = [];
  const clock = options.now ?? Date.now;
  return {
    rows,
    starts,
    async get(id) {
      return rows.get(id) ?? null;
    },
    async admit(who, _network, limit) {
      const now = clock();
      starts.splice(0, starts.length, ...starts.filter((one) => one.at >= now - 24 * HOUR_MS));
      if ([...rows.values()].filter((row) => atWork(row.agent)).length >= limit) return "full";
      const mine = starts.filter((one) => one.who === who);
      if (mine.filter((one) => one.at >= now - HOUR_MS).length >= PAPER_STARTS.perHour || mine.length >= PAPER_STARTS.perDay) return "limited";
      if (starts.filter((one) => one.at >= now - HOUR_MS).length >= PAPER_STARTS.allPerHour) return "busy";
      starts.push({ who, at: now });
      return "ok";
    },
    async start(agent, limit) {
      const was = rows.get(agent.id);
      if (was && atWork(was.agent)) return "working";
      if ([...rows.values()].filter((row) => atWork(row.agent)).length >= limit) return "full";
      rows.set(agent.id, { agent, version: (was?.version ?? 0) + 1 });
      return "started";
    },
    async put(agent, version) {
      const was = rows.get(agent.id);
      if (!was || was.version !== version) return null;
      const next = { agent, version: version + 1 };
      rows.set(agent.id, next);
      return next.version;
    },
    async due(network, limit) {
      return [...rows.values()]
        .filter((row) => row.agent.network === network && (row.agent.status === "working" || (row.agent.status === "paused" && row.agent.pausedBy === "unread")))
        .sort((a, b) => a.agent.updatedAt - b.agent.updatedAt)
        .slice(0, limit);
    },
    async purge(days) {
      const before = clock() - Math.max(30, days) * 86_400_000;
      let gone = 0;
      for (const [id, row] of rows) {
        if (!atWork(row.agent) && row.agent.updatedAt < before) {
          rows.delete(id);
          gone += 1;
        }
      }
      return gone;
    },
  };
}

/** A versioned row as a store answered it; null for anything that is not exactly one. */
export function versionedOf(value: unknown): Versioned | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const agent = paperAgentOf(row.doc);
  if (!agent || !Number.isInteger(row.version) || (row.version as number) < 1) return null;
  return { agent, version: row.version as number };
}
