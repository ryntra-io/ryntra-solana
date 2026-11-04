import { randomUUID } from "node:crypto";

import { ARRIVALS } from "./catalog";
import type { CrewColour, Quarter } from "./contract";
import { memberLot } from "./crew";
import type { MemoryWorldStore } from "./memory-store";
import { WorldStoreUnavailable } from "./store";
import type { WorldRpc } from "./supabase-store";

/**
 * Where crews are kept (CITY-20). Two stores answer the same way, like the world's own: the database through the
 * server's secret-gated functions (`supabase/migrations/20261031090000_world_crews.sql`), and memory for tests and
 * local work. A member is a quarter, not a resident, so a guest's crew follows their quarter into an account.
 *
 * Every step that can race is one atomic step here: a crew is made with its street and its first member, a join takes
 * the next free lot only while the crew has room, a gift of points never gives more than the giver has left, and each
 * kind of gift counts once a person a day.
 */

export type CrewRow = { id: string; name: string; colour: CrewColour; street: string; row: number; invite: string; createdAt: string };

export type CrewMemberRow = {
  quarterId: string;
  residentId: string;
  displayName: string | null;
  verified: boolean;
  lot: number;
  level: number;
  joinedAt: string;
};

/** A crew as anyone may read it: no people, no invite beyond what found it. */
export type CrewStreetRead = { crew: CrewRow; members: number; units: number; given: string[] };

/** My crew: its people, the headquarters, my own standing and the actions of the week. */
export type MyCrewRead = {
  crew: CrewRow;
  people: CrewMemberRow[];
  units: number;
  /** Modules given to the headquarters, newest first. */
  given: string[];
  me: { residentId: string; quarterId: string; quarterLevel: number; pointsTotal: number; pointsGiven: number; gave: { module: boolean; points: boolean } };
  /** The members' builds, counted visits and gifts since the week began. */
  actions: { residentId: string; day: string; kind: string }[];
};

export type CreateCrew = { residentId: string; name: string; colour: CrewColour; invite: string; now: Date };
export type JoinCrew = { residentId: string; invite: string; limit: number; now: Date };
export type GiftCrew = { residentId: string; kind: "module" | "points"; module: string | null; points: number; units: number; day: string; now: Date };

export type CrewStepResult = { ok: true; quarter: Quarter } | { ok: false; error: "not_found" | "in_crew" | "full" | "invite_taken" | "not_in_crew" };
export type GiftResult = { ok: true } | { ok: false; error: "not_in_crew" | "today" | "points" };

export interface CrewStore {
  /** The crew my home quarter is in, read for me; null while it is in none, or there is no such resident. */
  mine(input: { residentId: string; day: string; since: Date }): Promise<MyCrewRead | null>;
  /** Every crew street, nearest the island first. */
  streets(): Promise<CrewStreetRead[]>;
  byInvite(invite: string): Promise<CrewStreetRead | null>;
  /** A new crew on a street of its own, with my home quarter moved to its first lot. */
  create(input: CreateCrew): Promise<CrewStepResult>;
  /** My home quarter moved to the next free lot of the crew's row. */
  join(input: JoinCrew): Promise<CrewStepResult>;
  /** My home quarter back on a newcomers' street; the last one out ends the crew. */
  leave(input: { residentId: string; now: Date }): Promise<CrewStepResult>;
  gift(input: GiftCrew): Promise<GiftResult>;
}

/* ---------------------------------------------------------------- memory -- */

type MemberRow = { crewId: string; quarterId: string; joinedAt: number };
type GiftRow = { crewId: string | null; residentId: string; kind: "module" | "points"; module: string | null; points: number; units: number; day: string; at: number };

const iso = (ms: number) => new Date(ms).toISOString();

/** Crews in memory, next to a memory world that knows the residents and their quarters and moves them. */
export class MemoryCrewStore implements CrewStore {
  private readonly crews = new Map<string, CrewRow>();
  private readonly members = new Map<string, MemberRow>();
  private readonly gifts: GiftRow[] = [];
  private readonly world: MemoryWorldStore;

  constructor(world: MemoryWorldStore) {
    this.world = world;
  }

  private async home(residentId: string): Promise<{ quarterId: string; quarter: Quarter; verified: boolean; name: string | null } | null> {
    const r = await this.world.resident({ id: residentId });
    if (!r) return null;
    const state = await this.world.quarter(r.homeQuarterId);
    return state ? { quarterId: r.homeQuarterId, quarter: state.quarter, verified: r.accountId !== null, name: r.displayName } : null;
  }

  /** The crew a resident is in through any of their quarters. */
  private async crewOfResident(residentId: string): Promise<MemberRow | null> {
    for (const m of this.members.values()) {
      const state = await this.world.quarter(m.quarterId);
      if (state?.quarter.ownerId === residentId) return m;
    }
    return null;
  }

  private async people(crewId: string): Promise<CrewMemberRow[]> {
    const out: CrewMemberRow[] = [];
    for (const m of this.members.values()) {
      if (m.crewId !== crewId) continue;
      const state = await this.world.quarter(m.quarterId);
      if (!state) continue;
      const r = await this.world.resident({ id: state.quarter.ownerId });
      out.push({
        quarterId: m.quarterId, residentId: state.quarter.ownerId, displayName: r?.displayName ?? null, verified: !!r?.accountId,
        lot: state.quarter.cell.x, level: state.quarter.level, joinedAt: iso(m.joinedAt),
      });
    }
    return out.sort((a, b) => a.lot - b.lot);
  }

  private street(crew: CrewRow): CrewStreetRead {
    const gifts = this.gifts.filter((g) => g.crewId === crew.id);
    return {
      crew: { ...crew },
      members: [...this.members.values()].filter((m) => m.crewId === crew.id).length,
      units: gifts.reduce((sum, g) => sum + g.units, 0),
      given: gifts.filter((g) => g.module).sort((a, b) => b.at - a.at).slice(0, 16).map((g) => g.module!),
    };
  }

  async mine(input: { residentId: string; day: string; since: Date }): Promise<MyCrewRead | null> {
    const home = await this.home(input.residentId);
    if (!home) return null;
    const m = await this.crewOfResident(input.residentId);
    const crew = m ? this.crews.get(m.crewId) : null;
    if (!m || !crew) return null;
    const people = await this.people(crew.id);
    const street = this.street(crew);
    const mine = this.gifts.filter((g) => g.residentId === input.residentId);
    const ids = people.map((p) => p.residentId);
    const from = input.since.getTime();
    return {
      crew: street.crew,
      people,
      units: street.units,
      given: street.given,
      me: {
        residentId: input.residentId, quarterId: home.quarterId, quarterLevel: home.quarter.level,
        pointsTotal: this.world.pointsOf(input.residentId),
        pointsGiven: mine.reduce((sum, g) => sum + g.points, 0),
        gave: { module: mine.some((g) => g.day === input.day && g.kind === "module"), points: mine.some((g) => g.day === input.day && g.kind === "points") },
      },
      actions: [
        ...this.world.actionsOf(ids, input.since),
        ...this.gifts.filter((g) => g.crewId === crew.id && g.at >= from).map((g) => ({ residentId: g.residentId, day: g.day, kind: "gift" })),
      ],
    };
  }

  async streets(): Promise<CrewStreetRead[]> {
    return [...this.crews.values()].sort((a, b) => a.row - b.row).map((c) => this.street(c));
  }

  async byInvite(invite: string): Promise<CrewStreetRead | null> {
    const crew = [...this.crews.values()].find((c) => c.invite === invite);
    return crew ? this.street(crew) : null;
  }

  async create(input: CreateCrew): Promise<CrewStepResult> {
    const home = await this.home(input.residentId);
    if (!home) return { ok: false, error: "not_found" };
    if (await this.crewOfResident(input.residentId)) return { ok: false, error: "in_crew" };
    if ([...this.crews.values()].some((c) => c.invite === input.invite)) return { ok: false, error: "invite_taken" };
    const row = this.world.reserveCrewRow();
    const crew: CrewRow = { id: randomUUID(), name: input.name, colour: input.colour, street: `arrivals-${row + 1}`, row, invite: input.invite, createdAt: input.now.toISOString() };
    this.crews.set(crew.id, crew);
    const lot = memberLot([])!;
    this.members.set(home.quarterId, { crewId: crew.id, quarterId: home.quarterId, joinedAt: input.now.getTime() });
    const quarter = this.world.moveQuarter(home.quarterId, { x: lot, z: row }, input.now)!;
    return { ok: true, quarter };
  }

  async join(input: JoinCrew): Promise<CrewStepResult> {
    const home = await this.home(input.residentId);
    if (!home) return { ok: false, error: "not_found" };
    const crew = [...this.crews.values()].find((c) => c.invite === input.invite);
    if (!crew) return { ok: false, error: "not_found" };
    if (await this.crewOfResident(input.residentId)) return { ok: false, error: "in_crew" };
    const people = await this.people(crew.id);
    const lot = people.length < input.limit ? memberLot(people.map((p) => p.lot)) : null;
    if (lot === null) return { ok: false, error: "full" };
    this.members.set(home.quarterId, { crewId: crew.id, quarterId: home.quarterId, joinedAt: input.now.getTime() });
    const quarter = this.world.moveQuarter(home.quarterId, { x: lot, z: crew.row }, input.now)!;
    return { ok: true, quarter };
  }

  async leave(input: { residentId: string; now: Date }): Promise<CrewStepResult> {
    const m = await this.crewOfResident(input.residentId);
    if (!m) return { ok: false, error: "not_in_crew" };
    this.members.delete(m.quarterId);
    if (![...this.members.values()].some((x) => x.crewId === m.crewId)) {
      // The last one out ends the crew and frees its street. The gifts stay counted against their givers, so points
      // once given are never given again.
      const ended = this.crews.get(m.crewId);
      this.crews.delete(m.crewId);
      if (ended) this.world.releaseCrewRow(ended.row);
      for (const g of this.gifts) if (g.crewId === m.crewId) g.crewId = null;
    }
    const quarter = this.world.rehomeQuarter(m.quarterId, input.now);
    return quarter ? { ok: true, quarter } : { ok: false, error: "not_found" };
  }

  async gift(input: GiftCrew): Promise<GiftResult> {
    const m = await this.crewOfResident(input.residentId);
    if (!m) return { ok: false, error: "not_in_crew" };
    const mine = this.gifts.filter((g) => g.residentId === input.residentId);
    if (mine.some((g) => g.day === input.day && g.kind === input.kind)) return { ok: false, error: "today" };
    if (input.kind === "points" && mine.reduce((sum, g) => sum + g.points, 0) + input.points > this.world.pointsOf(input.residentId)) return { ok: false, error: "points" };
    this.gifts.push({ crewId: m.crewId, residentId: input.residentId, kind: input.kind, module: input.module, points: input.points, units: input.units, day: input.day, at: input.now.getTime() });
    return { ok: true };
  }
}

/* -------------------------------------------------------------- database -- */

type Answer = Record<string, unknown> & { ok?: unknown; error?: unknown };

/** Crews in the database: `public.world_crew_*`, each one transaction. */
export class SupabaseCrewStore implements CrewStore {
  private readonly rpc: WorldRpc;

  constructor(rpc: WorldRpc) {
    this.rpc = rpc;
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<Answer> {
    const answer = await this.rpc(fn, args);
    if (!answer.ok) throw new WorldStoreUnavailable(`${fn}: ${answer.error}`);
    const data = answer.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new WorldStoreUnavailable(`${fn}: no answer`);
    return data as Answer;
  }

  private static step(fn: string, data: Answer, errors: readonly string[]): CrewStepResult {
    if (data.ok === true) return { ok: true, quarter: data.quarter as Quarter };
    if (typeof data.error === "string" && errors.includes(data.error)) return { ok: false, error: data.error as Exclude<CrewStepResult, { ok: true }>["error"] };
    throw new WorldStoreUnavailable(`${fn}: ${String(data.error)}`);
  }

  async mine(input: { residentId: string; day: string; since: Date }): Promise<MyCrewRead | null> {
    const data = await this.call("world_crew_mine", { p_resident_id: input.residentId, p_day: input.day, p_since: input.since.toISOString() });
    if (data.ok !== true) throw new WorldStoreUnavailable(`world_crew_mine: ${String(data.error)}`);
    return (data.crew as MyCrewRead | null) ?? null;
  }

  async streets(): Promise<CrewStreetRead[]> {
    const data = await this.call("world_crew_streets", {});
    if (data.ok !== true) throw new WorldStoreUnavailable(`world_crew_streets: ${String(data.error)}`);
    return data.streets as CrewStreetRead[];
  }

  async byInvite(invite: string): Promise<CrewStreetRead | null> {
    const data = await this.call("world_crew_by_invite", { p_invite: invite });
    if (data.ok !== true) throw new WorldStoreUnavailable(`world_crew_by_invite: ${String(data.error)}`);
    return (data.street as CrewStreetRead | null) ?? null;
  }

  async create(input: CreateCrew): Promise<CrewStepResult> {
    const data = await this.call("world_crew_create", {
      p_resident_id: input.residentId, p_name: input.name, p_colour: input.colour, p_invite: input.invite,
      p_lot: memberLot([]), p_street_length: ARRIVALS.streetLength, p_now: input.now.toISOString(),
    });
    return SupabaseCrewStore.step("world_crew_create", data, ["not_found", "in_crew", "invite_taken"]);
  }

  async join(input: JoinCrew): Promise<CrewStepResult> {
    const data = await this.call("world_crew_join", { p_resident_id: input.residentId, p_invite: input.invite, p_limit: input.limit, p_now: input.now.toISOString() });
    return SupabaseCrewStore.step("world_crew_join", data, ["not_found", "in_crew", "full"]);
  }

  async leave(input: { residentId: string; now: Date }): Promise<CrewStepResult> {
    const data = await this.call("world_crew_leave", { p_resident_id: input.residentId, p_street_length: ARRIVALS.streetLength, p_now: input.now.toISOString() });
    return SupabaseCrewStore.step("world_crew_leave", data, ["not_found", "not_in_crew"]);
  }

  async gift(input: GiftCrew): Promise<GiftResult> {
    const data = await this.call("world_crew_gift", {
      p_resident_id: input.residentId, p_kind: input.kind, p_module: input.module, p_points: input.points,
      p_units: input.units, p_day: input.day, p_now: input.now.toISOString(),
    });
    if (data.ok === true) return { ok: true };
    if (data.error === "not_in_crew" || data.error === "today" || data.error === "points") return { ok: false, error: data.error };
    throw new WorldStoreUnavailable(`world_crew_gift: ${String(data.error)}`);
  }
}
