import type { Archetype, Brain, RingFormat, Weight } from "./contract.ts";
import type { MadeKey } from "./keys.ts";
import { type RatingRecord } from "./rating.ts";

/**
 * What the Ring keeps (CITY-50): agents, their keys (sealed), their ratings and the answers to request keys. The
 * interface is the Ring's; a deployment keeps it in the database (`supabase-store.ts`,
 * `supabase/migrations/*_ring_v1.sql`) so every server instance sees one agent per garage slot. This file also has
 * the memory store — tests and a developer's machine only: it lives as long as one warm instance, so the server never
 * opens the Ring in production on it (`ready.ts`).
 */

export type KeyState = "live" | "quiet" | "off";

export type AgentRecord = {
  id: string;
  /** `a:<account id>` — the Ryntra account signed in with a wallet. */
  owner: string;
  quarterId: string;
  slot: number;
  archetype: Archetype;
  brain: Brain;
  formats: RingFormat[];
  scenario: string;
  status: "active" | "off";
  key: { state: KeyState; hash: string | null; limitUsd: number | null };
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** The body, brain and script an agent is changed to. */
export type AgentNext = Pick<AgentRecord, "archetype" | "brain" | "formats" | "scenario">;

export type Refused = { ok: false; error: "not_found" | "not_owner" | "off" | "version"; current: AgentRecord | null };

export type Changed = { ok: true; agent: AgentRecord; retired: string | null } | Refused;

/** An agent with its rating row in one format on its current brain; `null` before its first rated game there. */
export type Ranked = { agent: AgentRecord; rating: RatingRecord | null };

/** A rating row to write after a rated duel, only if the row still has `before` games (compare-and-set). */
export type RateInput = { agentId: string; brain: Pick<Brain, "id" | "provider">; row: RatingRecord; before: number };

export interface RingStore {
  /** True for a store every server instance shares (the database); false for one instance's memory. */
  readonly durable: boolean;
  /** The active agent in a garage slot. */
  agentAt(quarterId: string, slot: number): Promise<AgentRecord | null>;
  agent(id: string): Promise<AgentRecord | null>;
  /** The rating rows of an agent's brain (the model on its provider); a format with no row has not been played. */
  ratings(agentId: string, brain: Pick<Brain, "id" | "provider">): Promise<RatingRecord[]>;
  /** Agents and keys an owner made since a moment: the daily limits. */
  made(owner: string, since: number): Promise<{ agents: number; keys: number }>;
  /** A new agent with its key, if one was made; refused when the slot already has an active agent. Atomic. */
  create(agent: AgentRecord, key: MadeKey | null, now: number): Promise<{ ok: true; agent: AgentRecord } | { ok: false; error: "slot_taken" }>;
  /** The agent changed at the version its owner saw; a new key replaces the old one, which comes back to be switched off. */
  change(input: { id: string; owner: string; version: number; next: AgentNext; key: MadeKey | null }, now: number): Promise<Changed>;
  /** The agent switched off at the version its owner saw; its slot is free again and its key comes back to be switched off. */
  off(input: { id: string; owner: string; version: number }, now: number): Promise<Changed>;
  /** OpenRouter confirmed the key is off. */
  keyDisabled(hash: string, now: number): Promise<void>;
  /** A key made for a write that did not hold: it counts toward the daily limit and, unless confirmed off, waits for a sweep. */
  keyDropped(input: { hash: string; owner: string; disabled: boolean }, now: number): Promise<void>;
  /** A stored answer to a request key, so a retried write is never done twice. */
  answer(key: string, now: number): Promise<unknown | null>;
  keepAnswer(key: string, body: unknown, now: number): Promise<void>;
  /** The owner's active agents, oldest first (CITY-217: the Arena reads «my agent» without a garage visit). */
  mine(owner: string): Promise<AgentRecord[]>;
  /**
   * Active agents of other owners in one class whose brain can play the format, closest to a rating first — the
   * rivals a rated duel is drawn from (CITY-217).
   */
  rivals(input: { owner: string; weight: Weight; format: RingFormat; near: number; limit: number }): Promise<Ranked[]>;
  /** The board of a format: active agents with at least one rated game on their current brain, best first. */
  board(format: RingFormat, limit: number): Promise<(Ranked & { rating: RatingRecord })[]>;
  /** Writes a rating row if it still has `before` games; false when another duel moved it first (read again, retry). */
  rate(input: RateInput, now: number): Promise<boolean>;
  /** The sealed secret of the agent's live key, for the server to open for one match; `null` when it has none. */
  sealedKey(agentId: string, hash: string): Promise<string | null>;
}

/** The store could not be reached or answered in a way the Ring does not read: nothing it was asked is known. */
export class RingStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RingStoreUnavailable";
  }
}

/** How long the answer to a request key is kept: a retry comes within minutes. */
export const ANSWER_MS = 10 * 60_000;

const KEEP = 20_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** What a change or a switch-off may do to the agent as it is: the same checks the database makes under the row's lock. */
export function refusal(current: AgentRecord | undefined, owner: string, version: number): Refused | null {
  if (!current) return { ok: false, error: "not_found", current: null };
  if (current.owner !== owner) return { ok: false, error: "not_owner", current: null };
  if (current.status !== "active") return { ok: false, error: "off", current };
  if (current.version !== version) return { ok: false, error: "version", current };
  return null;
}

type KeyRow = { hash: string; agentId: string; owner: string; sealed: string; limitUsd: number; madeAt: number; retiredAt: number | null; disabledAt: number | null };

/** One instance's memory: for tests and a developer's machine. Never what a deployment opens on. */
export function createMemoryRingStore() {
  const agents = new Map<string, AgentRecord>();
  const keys = new Map<string, KeyRow>();
  const drops = new Map<string, { owner: string; madeAt: number; disabledAt: number | null }>();
  const ratings = new Map<string, RatingRecord>();
  const answers = new Map<string, { body: unknown; until: number }>();
  const copy = <T>(value: T): T => structuredClone(value);
  const ratingKey = (agentId: string, format: RingFormat, brain: Pick<Brain, "id" | "provider">) => `${agentId}|${format}|${brain.id}|${brain.provider}`;

  const active = (quarterId: string, slot: number) => [...agents.values()].find((a) => a.status === "active" && a.quarterId === quarterId && a.slot === slot);

  function keep(agent: AgentRecord, key: MadeKey, now: number) {
    keys.set(key.hash, { hash: key.hash, agentId: agent.id, owner: agent.owner, sealed: key.sealed, limitUsd: key.limitUsd, madeAt: now, retiredAt: null, disabledAt: null });
  }

  function retire(hash: string | null, now: number) {
    const row = hash ? keys.get(hash) : undefined;
    if (row && row.retiredAt === null) row.retiredAt = now;
  }

  const store = {
    durable: false,
    async agentAt(quarterId: string, slot: number) {
      const found = active(quarterId, slot);
      return found ? copy(found) : null;
    },
    async agent(id: string) {
      const found = agents.get(id);
      return found ? copy(found) : null;
    },
    async ratings(agentId: string, brain: Pick<Brain, "id" | "provider">) {
      return [...ratings.entries()].filter(([key]) => key.startsWith(`${agentId}|`) && key.endsWith(`|${brain.id}|${brain.provider}`)).map(([, row]) => copy(row));
    },
    async made(owner: string, since: number) {
      return {
        agents: [...agents.values()].filter((a) => a.owner === owner && Date.parse(a.createdAt) >= since).length,
        keys: [...keys.values(), ...drops.values()].filter((k) => k.owner === owner && k.madeAt >= since).length,
      };
    },
    async create(agent: AgentRecord, key: MadeKey | null, now: number) {
      // Check and write in one turn of the event loop: two creates at once give the slot to one.
      if (active(agent.quarterId, agent.slot)) return { ok: false as const, error: "slot_taken" as const };
      while (agents.size >= KEEP) agents.delete(agents.keys().next().value as string);
      const kept: AgentRecord = { ...copy(agent), key: key ? { state: "live", hash: key.hash, limitUsd: key.limitUsd } : { state: "quiet", hash: null, limitUsd: null }, version: 1, createdAt: iso(now), updatedAt: iso(now) };
      agents.set(kept.id, kept);
      if (key) keep(kept, key, now);
      return { ok: true as const, agent: copy(kept) };
    },
    async change(input: { id: string; owner: string; version: number; next: AgentNext; key: MadeKey | null }, now: number): Promise<Changed> {
      const current = agents.get(input.id);
      const refused = refusal(current, input.owner, input.version);
      if (refused) return { ...refused, current: refused.current && copy(refused.current) };
      const agent = current!;
      let retired: string | null = null;
      if (input.key) {
        retired = agent.key.state === "live" ? agent.key.hash : null;
        retire(retired, now);
        keep(agent, input.key, now);
        agent.key = { state: "live", hash: input.key.hash, limitUsd: input.key.limitUsd };
      }
      Object.assign(agent, copy(input.next), { version: agent.version + 1, updatedAt: iso(now) });
      return { ok: true, agent: copy(agent), retired };
    },
    async off(input: { id: string; owner: string; version: number }, now: number): Promise<Changed> {
      const current = agents.get(input.id);
      const refused = refusal(current, input.owner, input.version);
      if (refused) return { ...refused, current: refused.current && copy(refused.current) };
      const agent = current!;
      const retired = agent.key.state === "live" ? agent.key.hash : null;
      retire(retired, now);
      Object.assign(agent, { status: "off", key: { ...agent.key, state: "off" }, version: agent.version + 1, updatedAt: iso(now) });
      return { ok: true, agent: copy(agent), retired };
    },
    async keyDisabled(hash: string, now: number) {
      const row = keys.get(hash);
      if (row && row.disabledAt === null) row.disabledAt = now;
    },
    async keyDropped(input: { hash: string; owner: string; disabled: boolean }, now: number) {
      if (keys.has(input.hash)) return;
      const row = drops.get(input.hash);
      if (row) row.disabledAt ??= input.disabled ? now : null;
      else drops.set(input.hash, { owner: input.owner, madeAt: now, disabledAt: input.disabled ? now : null });
    },
    async answer(key: string, now: number) {
      const kept = answers.get(key);
      return kept && kept.until > now ? copy(kept.body) : null;
    },
    async keepAnswer(key: string, body: unknown, now: number) {
      for (const [k, v] of answers) if (v.until <= now) answers.delete(k);
      while (answers.size >= KEEP) answers.delete(answers.keys().next().value as string);
      answers.set(key, { body: copy(body), until: now + ANSWER_MS });
    },
    async mine(owner: string) {
      return [...agents.values()].filter((a) => a.owner === owner && a.status === "active").map(copy);
    },
    async rivals(input: { owner: string; weight: Weight; format: RingFormat; near: number; limit: number }) {
      const ranked = [...agents.values()]
        .filter((a) => a.status === "active" && a.owner !== input.owner && a.brain.weight === input.weight && a.formats.includes(input.format))
        .map((a) => ({ agent: copy(a), rating: ratings.has(ratingKey(a.id, input.format, a.brain)) ? copy(ratings.get(ratingKey(a.id, input.format, a.brain))!) : null }));
      const gap = (r: Ranked) => Math.abs((r.rating?.rating ?? 1_200) - input.near);
      return ranked.sort((a, b) => gap(a) - gap(b) || a.agent.createdAt.localeCompare(b.agent.createdAt)).slice(0, input.limit);
    },
    async board(format: RingFormat, limit: number) {
      return [...agents.values()]
        .filter((a) => a.status === "active")
        .flatMap((a) => {
          const row = ratings.get(ratingKey(a.id, format, a.brain));
          return row && row.games > 0 ? [{ agent: copy(a), rating: copy(row) }] : [];
        })
        .sort((a, b) => b.rating.rating - a.rating.rating || b.rating.games - a.rating.games)
        .slice(0, limit);
    },
    async rate(input: RateInput, _now: number) {
      const key = ratingKey(input.agentId, input.row.format, input.brain);
      // Check and write in one turn of the event loop, as the database does under the row's lock.
      if ((ratings.get(key)?.games ?? 0) !== input.before) return false;
      ratings.set(key, copy(input.row));
      return true;
    },
    async sealedKey(agentId: string, hash: string) {
      const row = keys.get(hash);
      return row && row.agentId === agentId && row.retiredAt === null ? row.sealed : null;
    },
    /** Tests only: a rating row put in place, as a past duel would have left it. */
    seedRating(agentId: string, brain: Pick<Brain, "id" | "provider">, row: RatingRecord) {
      ratings.set(ratingKey(agentId, row.format, brain), copy(row));
    },
    /** Tests only: the key rows, sealed text included. */
    keyRows: () => [...keys.values()].map((row) => copy(row)),
  };
  return store satisfies RingStore;
}
