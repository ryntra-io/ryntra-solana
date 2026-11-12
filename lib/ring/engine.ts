import { agentName, type AgentDraft } from "./agent.ts";
import { FORMATS, type AgentView, type BoardResponse, type Brain, type GarageResponse, type MineResponse, type ModelOption, type RingErrorCode, type RingFormat } from "./contract.ts";
import { KeyFailed, type MadeKey, type RingKeys } from "./keys.ts";
import type { RingModels } from "./models.ts";
import { emptyRating, ratingView } from "./rating.ts";
import { RingStoreUnavailable, type AgentRecord, type Changed, type RingStore } from "./store.ts";

/**
 * The Ring's agents (CITY-50, decision 72): make one in a garage of your quarter, change its body, brain or script,
 * switch it off. Written against plain values so every rule is tested without a server; `api.ts` puts it on HTTP.
 *
 * - One active agent to a garage slot; the slot must be a garage of the asker's own quarter (the world's word).
 * - The brain is the model as `quote` pins it: one provider, no fallbacks, its class and match price from that
 *   provider's own price. A changed model is quoted again; an unchanged one keeps its brain as it was.
 * - Each agent has its own OpenRouter key with its class's monthly limit — made on the server, sealed at once; a brain
 *   of another class gets a new key and the old one is switched off. Quiet (no management key): no key at all.
 * - A person makes at most `OWNER_LIMITS` agents and keys a day: each key is a call to OpenRouter's key API.
 */

export const OWNER_LIMITS = { agentsPerDay: 12, keysPerDay: 12 } as const;
const DAY_MS = 86_400_000;

/** What the world says of a garage slot for this account. */
export type GarageCheck = "ok" | "not_yours" | "not_garage" | "unavailable";

export type RingEngineDeps = {
  store: RingStore;
  models: RingModels;
  keys: RingKeys;
  garage: (input: { accountId: string; quarterId: string; slot: number }) => Promise<GarageCheck>;
  /** The account's own garage in the Arena (CITY-217, `garage.ts`); absent, the Arena offers none. */
  bay?: (accountId: string) => { quarterId: string; slot: number };
  now?: () => number;
  newId?: () => string;
};

export type Failure = { ok: false; code: RingErrorCode; message: string; current?: AgentView };
export type Outcome<T> = { ok: true; value: T } | Failure;

const fail = (code: RingErrorCode, message: string, current?: AgentView): Failure => ({ ok: false, code, message, ...(current ? { current } : {}) });

const ownerOf = (accountId: string) => `a:${accountId}`;

/** How many lines a board shows. */
export const BOARD_SIZE = 50;

export function createRingEngine(deps: RingEngineDeps) {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  /** An agent as the routes show it; its owner also sees the script and the key. */
  async function view(record: AgentRecord, mine: boolean): Promise<AgentView> {
    const rows = await deps.store.ratings(record.id, record.brain);
    const ratings = record.formats.map((format) => ratingView(rows.find((row) => row.format === format) ?? emptyRating(format)));
    const base: AgentView = {
      id: record.id,
      quarterId: record.quarterId,
      slot: record.slot,
      name: agentName(record.archetype, record.id),
      archetype: record.archetype,
      brain: { ...record.brain },
      formats: FORMATS.filter((format) => record.formats.includes(format)),
      ratings,
      status: record.status,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    if (!mine) return base;
    return { ...base, scenario: record.scenario, key: { state: record.key.state, limitUsd: record.key.limitUsd, reset: record.key.state === "quiet" ? null : "monthly" } };
  }

  /** The world's word on the slot, as a refusal or nothing. */
  async function garageRefusal(accountId: string, quarterId: string, slot: number): Promise<Failure | null> {
    const check = await deps.garage({ accountId, quarterId, slot }).catch((): GarageCheck => "unavailable");
    if (check === "unavailable") throw new RingStoreUnavailable("the world did not answer");
    if (check === "not_yours") return fail("NOT_YOURS", "This garage is not in your quarter.");
    if (check === "not_garage") return fail("NOT_GARAGE", "An agent lives in a garage. Build one on this plot first.");
    return null;
  }

  async function limited(owner: string, needsKey: boolean, newAgent: boolean): Promise<Failure | null> {
    if (!newAgent && !needsKey) return null;
    const made = await deps.store.made(owner, now() - DAY_MS);
    if (newAgent && made.agents >= OWNER_LIMITS.agentsPerDay) return fail("RATE_LIMITED", `That's ${OWNER_LIMITS.agentsPerDay} agents today. Try again tomorrow.`);
    if (needsKey && made.keys >= OWNER_LIMITS.keysPerDay) return fail("RATE_LIMITED", `That's ${OWNER_LIMITS.keysPerDay} new keys today. Try again tomorrow.`);
    return null;
  }

  /** The brain a model id gives, from OpenRouter's catalog now. */
  async function brainOf(model: string): Promise<{ ok: true; brain: Brain; formats: AgentRecord["formats"] } | Failure> {
    const quoted = await deps.models.quote(model);
    if (!quoted.ok) return quoted.reason === "unavailable" ? fail("MODELS_UNAVAILABLE", quoted.message) : fail("MODEL_REFUSED", quoted.message);
    const { quote } = quoted;
    return { ok: true, brain: { id: quote.id, name: quote.name, provider: quote.provider, providerName: quote.providerName, weight: quote.weight, matchMicroUsd: quote.matchMicroUsd }, formats: quote.formats };
  }

  /** A key made for nothing (the write was refused or did not land): switched off at once and counted toward the limit. */
  async function drop(key: MadeKey | null, owner: string): Promise<void> {
    if (!key) return;
    const disabled = await deps.keys.retire(key.hash);
    await deps.store.keyDropped({ hash: key.hash, owner, disabled }, now()).catch(() => undefined);
  }

  /**
   * A write that threw may still have landed (the database committed, the answer was lost): the agent is read back.
   * `undefined` — the store still does not answer, so nothing is known and the key is kept, never switched off blind.
   */
  async function readBack(id: string): Promise<AgentRecord | null | undefined> {
    return deps.store.agent(id).catch(() => undefined);
  }

  /** The key the write replaced: switched off once the write holds. */
  async function retire(hash: string | null): Promise<void> {
    if (hash && (await deps.keys.retire(hash))) await deps.store.keyDisabled(hash, now()).catch(() => undefined);
  }

  async function makeKey(agentId: string, weight: Brain["weight"]): Promise<{ ok: true; key: MadeKey | null } | Failure> {
    try {
      return { ok: true, key: await deps.keys.make(agentId, weight) };
    } catch (error) {
      if (error instanceof KeyFailed) {
        console.error("[ring] key not made", error.kind);
        return fail("KEY_FAILED", "The agent's own key could not be made. Nothing was saved.");
      }
      throw error;
    }
  }

  async function refused(result: Exclude<Changed, { ok: true }>, accountId: string): Promise<Outcome<AgentView>> {
    if (result.error === "not_found") return fail("NOT_FOUND", "There is no such agent.");
    if (result.error === "not_owner") return fail("NOT_YOURS", "This agent is not yours.");
    const current = result.current ? await view(result.current, result.current.owner === ownerOf(accountId)) : undefined;
    if (result.error === "off") return fail("OFF", "This agent is switched off.", current);
    return fail("VERSION", "The agent changed since you opened it.", current);
  }

  return {
    /** The model list for the brain picker. Throws when OpenRouter's catalog cannot be read and nothing is kept. */
    async models(): Promise<{ models: ModelOption[]; readAt: string; stale: boolean }> {
      return deps.models.list();
    },

    quote: (id: string) => deps.models.quote(id),

    /** The asker's agents as their owner sees them, and their garage in the Arena (CITY-217). */
    async mine(accountId: string | null): Promise<MineResponse> {
      if (!accountId) return { signedIn: false, agents: [], bay: null };
      const records = await deps.store.mine(ownerOf(accountId));
      const bay = deps.bay?.(accountId) ?? null;
      return { signedIn: true, agents: await Promise.all(records.map((record) => view(record, true))), bay: bay ? { quarter: bay.quarterId, slot: bay.slot } : null };
    },

    /** A format's board, best first; the asker's own agents marked. */
    async board(format: RingFormat, accountId: string | null): Promise<BoardResponse> {
      const rows = await deps.store.board(format, BOARD_SIZE);
      const owner = accountId ? ownerOf(accountId) : null;
      return {
        format,
        rows: rows.map(({ agent, rating }, i) => ({
          rank: i + 1,
          id: agent.id,
          name: agentName(agent.archetype, agent.id),
          archetype: agent.archetype,
          weight: agent.brain.weight,
          brain: agent.brain.name,
          rating: ratingView(rating),
          mine: owner !== null && agent.owner === owner,
        })),
      };
    },

    /** The active agent in a garage slot, as the asker may see it. */
    async garage(quarterId: string, slot: number, accountId: string | null): Promise<GarageResponse> {
      const record = await deps.store.agentAt(quarterId, slot);
      if (!record) return { agent: null, mine: false };
      const mine = accountId !== null && record.owner === ownerOf(accountId);
      return { agent: await view(record, mine), mine };
    },

    async create(accountId: string, draft: AgentDraft & { quarterId: string; slot: number }): Promise<Outcome<AgentView>> {
      const owner = ownerOf(accountId);
      const notHere = await garageRefusal(accountId, draft.quarterId, draft.slot);
      if (notHere) return notHere;
      if (await deps.store.agentAt(draft.quarterId, draft.slot)) return fail("SLOT_TAKEN", "This garage already has an agent.");
      const cap = await limited(owner, deps.keys.mode === "live", true);
      if (cap) return cap;
      const brain = await brainOf(draft.model);
      if (!brain.ok) return brain;

      const id = newId();
      const made = await makeKey(id, brain.brain.weight);
      if (!made.ok) return made;
      const at = new Date(now()).toISOString();
      const record: AgentRecord = {
        id,
        owner,
        quarterId: draft.quarterId,
        slot: draft.slot,
        archetype: draft.archetype,
        brain: brain.brain,
        formats: brain.formats,
        scenario: draft.scenario,
        status: "active",
        key: { state: "quiet", hash: null, limitUsd: null },
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      let created;
      try {
        created = await deps.store.create(record, made.key, now());
      } catch (error) {
        const after = await readBack(id);
        if (after) return { ok: true, value: await view(after, true) };
        if (after === null) await drop(made.key, owner);
        throw error;
      }
      if (!created.ok) {
        await drop(made.key, owner);
        return fail("SLOT_TAKEN", "This garage already has an agent.");
      }
      return { ok: true, value: await view(created.agent, true) };
    },

    async change(accountId: string, draft: AgentDraft & { id: string; version: number }): Promise<Outcome<AgentView>> {
      const owner = ownerOf(accountId);
      const current = await deps.store.agent(draft.id);
      // The same checks the store makes atomically, first here: nothing is quoted and no key made for a refused change.
      if (!current || current.owner !== owner || current.status !== "active" || current.version !== draft.version) {
        return refused({ ok: false, error: !current ? "not_found" : current.owner !== owner ? "not_owner" : current.status !== "active" ? "off" : "version", current }, accountId);
      }
      const notHere = await garageRefusal(accountId, current.quarterId, current.slot);
      if (notHere) return notHere;

      let brain = { brain: current.brain, formats: current.formats };
      if (draft.model !== current.brain.id) {
        const quoted = await brainOf(draft.model);
        if (!quoted.ok) return quoted;
        brain = quoted;
      }
      // A brain of another class needs a key with that class's limit; a quiet agent gets its first key once the server can make one.
      const needsKey = deps.keys.mode === "live" && (brain.brain.weight !== current.brain.weight || current.key.state !== "live");
      const cap = await limited(owner, needsKey, false);
      if (cap) return cap;
      let key: MadeKey | null = null;
      if (needsKey) {
        const made = await makeKey(current.id, brain.brain.weight);
        if (!made.ok) return made;
        key = made.key;
      }

      let result: Changed;
      try {
        result = await deps.store.change({ id: current.id, owner, version: draft.version, next: { archetype: draft.archetype, brain: brain.brain, formats: brain.formats, scenario: draft.scenario }, key }, now());
      } catch (error) {
        if (key) {
          const after = await readBack(current.id);
          if (after && after.key.hash === key.hash) {
            await retire(current.key.state === "live" ? current.key.hash : null);
            return { ok: true, value: await view(after, true) };
          }
          if (after !== undefined) await drop(key, owner);
        }
        throw error;
      }
      if (!result.ok) {
        await drop(key, owner);
        return refused(result, accountId);
      }
      await retire(result.retired);
      return { ok: true, value: await view(result.agent, true) };
    },

    async off(accountId: string, input: { id: string; version: number }): Promise<Outcome<AgentView>> {
      const result = await deps.store.off({ id: input.id, owner: ownerOf(accountId), version: input.version }, now());
      if (!result.ok) return refused(result, accountId);
      await retire(result.retired);
      return { ok: true, value: await view(result.agent, true) };
    },
  };
}

export type RingEngine = ReturnType<typeof createRingEngine>;

/** One line for the server's log: never the script, never a key. */
export function errorLine(error: unknown): string {
  if (error instanceof RingStoreUnavailable) return `store: ${error.message.slice(0, 160)}`;
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 160)}`;
  return "unknown";
}
