import { isArchetype, isFormat, isWeight, type Brain } from "./contract.ts";
import type { MadeKey } from "./keys.ts";
import type { RatingRecord } from "./rating.ts";
import { RingStoreUnavailable, type AgentNext, type AgentRecord, type Changed, type KeyState, type Ranked, type RingStore } from "./store.ts";

/**
 * The Ring in the database: one call to one `public.ring_*` function per question, each gated by the app secret and
 * each one transaction (`supabase/migrations/20261027230000_ring_v1.sql`, and for the Arena — «my agent», rivals, the
 * board, rating writes and a sealed key read back for a match — `20261108120100_ring_v2_arena.sql`). Every server
 * instance reads and writes the same rows, so a garage slot holds one active agent however many creates arrive at once,
 * and a change or a switch-off happens at the version its owner saw, under the row's lock. The transport is the server's usual one
 * (`rpcResult`, which adds the secret); a test passes its own.
 */

export type RingRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown>;

const iso = (ms: number) => new Date(ms).toISOString();
const isRecord = (value: unknown): value is Answer => !!value && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const KEY_STATES: readonly KeyState[] = ["live", "quiet", "off"];
const text = (value: unknown, fn: string, what: string): string => {
  if (typeof value !== "string") throw new RingStoreUnavailable(`${fn}: no ${what}`);
  return value;
};

/** An agent row as the database's `private.ring_agent_json` writes it; anything else is unreadable. */
export function agentOf(value: unknown, fn: string): AgentRecord {
  if (!isRecord(value) || !isRecord(value.brain) || !isRecord(value.key) || !Array.isArray(value.formats)) throw new RingStoreUnavailable(`${fn}: no agent`);
  const brain = value.brain;
  const key = value.key;
  if (!isArchetype(value.archetype) || !isWeight(brain.weight) || !isCount(brain.matchMicroUsd) || !isCount(value.slot) || !isCount(value.version)) throw new RingStoreUnavailable(`${fn}: unreadable agent`);
  if (value.status !== "active" && value.status !== "off") throw new RingStoreUnavailable(`${fn}: unreadable status`);
  if (!KEY_STATES.includes(key.state as KeyState)) throw new RingStoreUnavailable(`${fn}: unreadable key`);
  return {
    id: text(value.id, fn, "id"),
    owner: text(value.owner, fn, "owner"),
    quarterId: text(value.quarterId, fn, "quarter"),
    slot: value.slot,
    archetype: value.archetype,
    brain: {
      id: text(brain.id, fn, "model"),
      name: text(brain.name, fn, "model name"),
      provider: text(brain.provider, fn, "provider"),
      providerName: typeof brain.providerName === "string" ? brain.providerName : "",
      weight: brain.weight,
      matchMicroUsd: brain.matchMicroUsd,
    },
    formats: value.formats.filter(isFormat),
    scenario: typeof value.scenario === "string" ? value.scenario : "",
    status: value.status,
    key: { state: key.state as KeyState, hash: typeof key.hash === "string" ? key.hash : null, limitUsd: isCount(key.limitUsd) ? key.limitUsd : null },
    version: value.version,
    createdAt: text(value.createdAt, fn, "createdAt"),
    updatedAt: text(value.updatedAt, fn, "updatedAt"),
  };
}

function ratingOf(value: unknown): RatingRecord | null {
  if (!isRecord(value) || !isFormat(value.format)) return null;
  const { rating, games, wins, draws, losses, info } = value;
  if (typeof rating !== "number" || !Number.isFinite(rating) || ![games, wins, draws, losses, info].every(isCount)) return null;
  return { format: value.format, rating, games: games as number, wins: wins as number, draws: draws as number, losses: losses as number, info: info as number };
}

/** An agent with its rating in one format, as `ring_rivals` and `ring_board` give it. */
function rankedOf(value: unknown, fn: string): Ranked {
  if (!isRecord(value)) throw new RingStoreUnavailable(`${fn}: unreadable row`);
  return { agent: agentOf(value.agent, fn), rating: value.rating === null || value.rating === undefined ? null : ratingOf(value.rating) };
}

const rowsOf = (data: Answer, fn: string): unknown[] => {
  if (!Array.isArray(data.rows)) throw new RingStoreUnavailable(`${fn}: unreadable`);
  return data.rows;
};

const brainArgs = (next: AgentNext) => ({
  p_archetype: next.archetype,
  p_model_id: next.brain.id,
  p_model_name: next.brain.name,
  p_provider: next.brain.provider,
  p_provider_name: next.brain.providerName,
  p_weight: next.brain.weight,
  p_match_micro_usd: next.brain.matchMicroUsd,
  p_formats: next.formats,
  p_scenario: next.scenario,
});

const keyArgs = (key: MadeKey | null) => ({ p_key_hash: key?.hash ?? null, p_key_sealed: key?.sealed ?? null, p_key_limit_usd: key?.limitUsd ?? null });

export function createSupabaseRingStore(rpc: RingRpc): RingStore {
  /** One call; a transport failure, a refusal or a malformed answer is `RingStoreUnavailable`. */
  async function call(fn: string, args: Answer): Promise<Answer> {
    const answer = await rpc(fn, args);
    if (!answer.ok) throw new RingStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new RingStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new RingStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }

  function changed(data: Answer, fn: string): Changed {
    if (data.changed === true) return { ok: true, agent: agentOf(data.agent, fn), retired: typeof data.retired === "string" ? data.retired : null };
    const error = data.error;
    if (error === "not_found" || error === "not_owner") return { ok: false, error, current: null };
    if (error === "off" || error === "version") return { ok: false, error, current: agentOf(data.agent, fn) };
    throw new RingStoreUnavailable(`${fn}: unreadable`);
  }

  return {
    durable: true,

    async agentAt(quarterId, slot) {
      const data = await call("ring_garage", { p_quarter: quarterId, p_slot: slot });
      return data.agent === null || data.agent === undefined ? null : agentOf(data.agent, "ring_garage");
    },

    async agent(id) {
      const data = await call("ring_agent", { p_id: id });
      return data.agent === null || data.agent === undefined ? null : agentOf(data.agent, "ring_agent");
    },

    async ratings(agentId, brain: Pick<Brain, "id" | "provider">) {
      const data = await call("ring_ratings", { p_agent: agentId, p_model: brain.id, p_provider: brain.provider });
      if (!Array.isArray(data.ratings)) throw new RingStoreUnavailable("ring_ratings: unreadable");
      return data.ratings.map(ratingOf).filter((row): row is RatingRecord => row !== null);
    },

    async made(owner, since) {
      const data = await call("ring_made", { p_owner: owner, p_since: iso(since) });
      if (!isCount(data.agents) || !isCount(data.keys)) throw new RingStoreUnavailable("ring_made: unreadable");
      return { agents: data.agents, keys: data.keys };
    },

    async create(agent, key, now) {
      const data = await call("ring_create", {
        p_id: agent.id,
        p_owner: agent.owner,
        p_quarter: agent.quarterId,
        p_slot: agent.slot,
        ...brainArgs(agent),
        ...keyArgs(key),
        p_now: iso(now),
      });
      if (data.created === false && data.error === "slot_taken") return { ok: false, error: "slot_taken" };
      if (data.created !== true) throw new RingStoreUnavailable("ring_create: unreadable");
      return { ok: true, agent: agentOf(data.agent, "ring_create") };
    },

    async change(input, now) {
      const data = await call("ring_change", { p_id: input.id, p_owner: input.owner, p_version: input.version, ...brainArgs(input.next), ...keyArgs(input.key), p_now: iso(now) });
      return changed(data, "ring_change");
    },

    async off(input, now) {
      const data = await call("ring_off", { p_id: input.id, p_owner: input.owner, p_version: input.version, p_now: iso(now) });
      return changed(data, "ring_off");
    },

    async keyDisabled(hash, now) {
      await call("ring_key_disabled", { p_hash: hash, p_now: iso(now) });
    },

    async keyDropped(input, now) {
      await call("ring_key_dropped", { p_hash: input.hash, p_owner: input.owner, p_disabled: input.disabled, p_now: iso(now) });
    },

    async answer(key, now) {
      const data = await call("ring_answer", { p_key: key, p_now: iso(now) });
      return data.body ?? null;
    },

    async keepAnswer(key, body, now) {
      await call("ring_keep_answer", { p_key: key, p_body: body, p_now: iso(now) });
    },

    async mine(owner) {
      const data = await call("ring_mine", { p_owner: owner });
      return rowsOf(data, "ring_mine").map((row) => agentOf(row, "ring_mine"));
    },

    async rivals(input) {
      const data = await call("ring_rivals", { p_owner: input.owner, p_weight: input.weight, p_format: input.format, p_near: input.near, p_limit: input.limit });
      return rowsOf(data, "ring_rivals").map((row) => rankedOf(row, "ring_rivals"));
    },

    async board(format, limit) {
      const data = await call("ring_board", { p_format: format, p_limit: limit });
      return rowsOf(data, "ring_board")
        .map((row) => rankedOf(row, "ring_board"))
        .filter((row): row is Ranked & { rating: RatingRecord } => row.rating !== null);
    },

    async rate(input, now) {
      const { row } = input;
      const data = await call("ring_rate", {
        p_agent: input.agentId,
        p_format: row.format,
        p_model: input.brain.id,
        p_provider: input.brain.provider,
        p_before: input.before,
        p_rating: row.rating,
        p_games: row.games,
        p_wins: row.wins,
        p_draws: row.draws,
        p_losses: row.losses,
        p_info: row.info,
        p_now: iso(now),
      });
      if (typeof data.written !== "boolean") throw new RingStoreUnavailable("ring_rate: unreadable");
      return data.written;
    },

    async sealedKey(agentId, hash) {
      const data = await call("ring_key_sealed", { p_agent: agentId, p_hash: hash });
      return typeof data.sealed === "string" ? data.sealed : null;
    },
  };
}
