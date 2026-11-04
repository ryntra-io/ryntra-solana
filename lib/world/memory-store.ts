import { randomUUID } from "node:crypto";

import { ARRIVALS, LEVEL_POINTS, quarterLevelFor } from "./catalog";
import type {
  AwayConsent, BuildingKind, DailyTask, DailyTaskKind, District, PointsEntry, PublicBuilding, PublicChainLink, Quarter,
  QuarterSketch, Resident, Visit, WorldEvent, WorldVersion,
} from "./contract";
import { isPointsReason } from "./rules";
import type {
  AwardInput, ClaimResult, CommitBuild, ConsentInput, ConsentResult, CommitBuildResult, CommitLink, CommitLinkResult, MeData, MergeResult,
  Progress, QuarterState, RecordEventInput, RequestGate, RequestRef, StoredResident, VisitInput, VisitResult, WorldStore,
} from "./store";

/**
 * The world in memory: the same answers as the database, for tests and for
 * running the city without one. Every method finishes its writes before it
 * awaits anything, so one call is one atomic step, as one database function
 * is. Kept data does not survive a restart.
 */

type ResidentRow = { id: string; accountId: string | null; guestSalt: string | null; displayName: string | null; homeQuarterId: string; createdAt: number };
type QuarterRow = { id: string; ownerId: string; district: District; street: string; x: number; z: number; level: number; version: number; createdAt: number; updatedAt: number };
type BuildingRow = { id: string; quarterId: string; slot: number; kind: BuildingKind; level: number; modules: string[]; link: Record<string, string> | null; updatedAt: number };
type PointsRow = { seq: number; residentId: string; delta: number; reason: PointsEntry["reason"]; sourceRef: string; key: string; at: number };
type TaskRow = { residentId: string; day: string; kind: DailyTaskKind; progress: number; goal: number; doneAt: number | null };
type VisitRow = { visitorId: string; quarterId: string; day: string; verifiedHuman: boolean; at: number };
type EventRow = { id: string; at: number; source: WorldEvent["source"]; kind: WorldEvent["kind"]; subject: string; sourceAt: number | null; district: District | null; actorId: string | null; payload: Record<string, unknown> };
type RequestRow = { hash: string; status: number | null; body: unknown; createdAt: number; completedAt: number | null };

const iso = (ms: number) => new Date(ms).toISOString();
const DAY_MS = 86_400_000;

function linkKey(link: Record<string, string> | null): string | null {
  if (!link || link.kind === "prediction_book") return null;
  return `${link.kind}:${link.mint ?? link.position ?? link.strategyId ?? link.teamId ?? link.agentId}`;
}

export class MemoryWorldStore implements WorldStore {
  private readonly residents = new Map<string, ResidentRow>();
  private readonly quarters = new Map<string, QuarterRow>();
  private readonly buildings = new Map<string, BuildingRow>();
  private readonly points: PointsRow[] = [];
  private readonly tasks: TaskRow[] = [];
  private readonly visits: VisitRow[] = [];
  private readonly events: EventRow[] = [];
  private readonly versions = new Map<string, { id: string; day: string; seed: string; towers: unknown[]; createdAt: number }>();
  private readonly requests = new Map<string, RequestRow>();
  private readonly limits = new Map<string, number>();
  private readonly consents = new Map<string, { telegram: boolean; push: boolean; updatedAt: number }>();
  private arrivals = 0;
  private seq = 0;
  /** Streets of Arrivals a crew holds (CITY-20), as rows: a newcomer's claim never lands on one. */
  private readonly crewRows = new Set<number>();

  /** Accounts that exist, as `public.beta_users` would say. */
  readonly accounts = new Set<string>();

  /* ------------------------------------------------------------ shapes -- */

  private residentOut(r: ResidentRow): Resident {
    return { id: r.id, accountId: r.accountId, displayName: r.displayName, homeQuarterId: r.homeQuarterId, createdAt: iso(r.createdAt) };
  }

  private quarterOut(q: QuarterRow): Quarter {
    return { id: q.id, ownerId: q.ownerId, district: q.district, street: q.street, cell: { x: q.x, z: q.z }, level: q.level, version: q.version, updatedAt: iso(q.updatedAt) };
  }

  private buildingOut(b: BuildingRow): PublicBuilding {
    return { id: b.id, quarterId: b.quarterId, slot: b.slot, kind: b.kind, level: b.level, modules: [...b.modules], link: b.link ? ({ ...b.link } as PublicChainLink) : null, updatedAt: iso(b.updatedAt) };
  }

  private buildingsOf(quarterId: string): PublicBuilding[] {
    return [...this.buildings.values()].filter((b) => b.quarterId === quarterId).sort((a, b) => a.slot - b.slot).map((b) => this.buildingOut(b));
  }

  private tasksOf(residentId: string, day: string): DailyTask[] {
    return this.tasks
      .filter((t) => t.residentId === residentId && t.day === day)
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
      .map((t) => ({ residentId: t.residentId, day: t.day, kind: t.kind, progress: t.progress, goal: t.goal, doneAt: t.doneAt === null ? null : iso(t.doneAt) }));
  }

  private total(residentId: string): number {
    return this.points.filter((p) => p.residentId === residentId).reduce((sum, p) => sum + p.delta, 0);
  }

  private eventOut(e: EventRow): WorldEvent {
    return { id: e.id, at: iso(e.at), source: e.source, kind: e.kind, subject: e.subject, sourceAt: e.sourceAt === null ? (null as unknown as string) : iso(e.sourceAt), payload: { ...e.payload } };
  }

  /* ----------------------------------------------------------- helpers -- */

  private relevel(residentId: string, now: number): void {
    const level = Math.min(LEVEL_POINTS.length, quarterLevelFor(this.total(residentId)));
    for (const q of this.quarters.values()) {
      if (q.ownerId === residentId && q.level < level) {
        q.level = level;
        q.updatedAt = now;
      }
    }
  }

  private awardRow(residentId: string, reason: PointsEntry["reason"], delta: number, sourceRef: string, key: string, now: number): boolean {
    if (!isPointsReason(reason) || !Number.isInteger(delta) || delta < 1 || delta > 10_000) throw new Error("points refused by the ledger");
    if (this.points.some((p) => p.residentId === residentId && p.key === key)) return false;
    this.points.push({ seq: ++this.seq, residentId, delta, reason, sourceRef, key, at: now });
    this.relevel(residentId, now);
    return true;
  }

  private progress(residentId: string, day: string, item: Progress, points: number, now: number): void {
    if (!(item.delta > 0)) return;
    let t = this.tasks.find((x) => x.residentId === residentId && x.day === day && x.kind === item.kind);
    if (!t) {
      t = { residentId, day, kind: item.kind, progress: Math.min(item.delta, item.goal), goal: item.goal, doneAt: null };
      this.tasks.push(t);
    } else {
      t.progress = Math.min(t.goal, t.progress + item.delta);
    }
    if (t.progress >= t.goal && t.doneAt === null) {
      t.doneAt = now;
      this.awardRow(residentId, "task_done", points, item.kind, `task_done:${day}:${item.kind}`, now);
    }
  }

  private event(row: Omit<EventRow, "id">): WorldEvent {
    const e = { id: randomUUID(), ...row };
    this.events.push(e);
    return this.eventOut(e);
  }

  /** The next newcomer's lot as a running number, past every street a crew holds. */
  private nextArrival(): number {
    const length = ARRIVALS.streetLength;
    let k = this.arrivals;
    while (this.crewRows.has(Math.floor(k / length))) k = (Math.floor(k / length) + 1) * length;
    this.arrivals = k + 1;
    return k;
  }

  /* ----------------------------------------- crews (`crew-store.ts`) -- */

  /**
   * A street for a new crew: the first one no newcomer has reached and no crew holds. Claims step over it from now on.
   * One atomic step, like the database's under its lock.
   */
  reserveCrewRow(): number {
    const length = ARRIVALS.streetLength;
    let row = Math.ceil(this.arrivals / length);
    while (this.crewRows.has(row)) row += 1;
    this.crewRows.add(row);
    return row;
  }

  /** The street of a crew that ended: a newcomer may land there again. */
  releaseCrewRow(row: number): void {
    this.crewRows.delete(row);
  }

  /** Moves a quarter to a lot of Arrivals: only its street and cell change, and its version, so a stale build meets the move. */
  moveQuarter(quarterId: string, cell: { x: number; z: number }, now: Date): Quarter | null {
    const q = this.quarters.get(quarterId);
    if (!q) return null;
    q.district = "arrivals";
    q.street = `arrivals-${cell.z + 1}`;
    q.x = cell.x;
    q.z = cell.z;
    q.version += 1;
    q.updatedAt = now.getTime();
    return this.quarterOut(q);
  }

  /** A quarter back on a newcomers' street, on the next free lot. */
  rehomeQuarter(quarterId: string, now: Date): Quarter | null {
    if (!this.quarters.has(quarterId)) return null;
    const k = this.nextArrival();
    const length = ARRIVALS.streetLength;
    return this.moveQuarter(quarterId, { x: k % length, z: Math.floor(k / length) }, now);
  }

  /** The builds and counted visits of these residents since a moment: what a crew's score counts. */
  actionsOf(residentIds: readonly string[], since: Date): { residentId: string; day: string; kind: string }[] {
    const who = new Set(residentIds);
    const from = since.getTime();
    return this.events
      .filter((e) => e.actorId !== null && who.has(e.actorId) && e.at >= from && (e.kind === "build" || e.kind === "visit"))
      .map((e) => ({ residentId: e.actorId!, day: iso(e.at).slice(0, 10), kind: e.kind }));
  }

  /** A resident's points, all of them. */
  pointsOf(residentId: string): number {
    return this.total(residentId);
  }

  /* -------------------------------------------------------------- API -- */

  async resident(by: { id: string } | { accountId: string }): Promise<StoredResident | null> {
    const r = "id" in by ? this.residents.get(by.id) : [...this.residents.values()].find((x) => x.accountId === by.accountId);
    return r ? { ...this.residentOut(r), guestSalt: r.guestSalt } : null;
  }

  async claim(input: { accountId: string | null; guestSalt: string | null; displayName: string | null; now: Date }): Promise<ClaimResult> {
    if ((input.accountId === null) === (input.guestSalt === null)) throw new Error("a claim is for an account or for a guest");
    if (input.guestSalt !== null && !/^[0-9a-f]{32}$/.test(input.guestSalt)) throw new Error("bad guest salt");
    const now = input.now.getTime();
    if (input.accountId) {
      const existing = [...this.residents.values()].find((r) => r.accountId === input.accountId);
      if (existing) return { ok: true, created: false, resident: this.residentOut(existing), quarter: this.quarterOut(this.quarters.get(existing.homeQuarterId)!) };
      if (!this.accounts.has(input.accountId)) return { ok: false, error: "no_account" };
    }
    const k = this.nextArrival();
    const length = ARRIVALS.streetLength;
    const resident: ResidentRow = { id: randomUUID(), accountId: input.accountId, guestSalt: input.guestSalt, displayName: input.displayName?.trim() || null, homeQuarterId: "", createdAt: now };
    const quarter: QuarterRow = { id: randomUUID(), ownerId: resident.id, district: "arrivals", street: `arrivals-${Math.floor(k / length) + 1}`, x: k % length, z: Math.floor(k / length), level: 1, version: 1, createdAt: now, updatedAt: now };
    resident.homeQuarterId = quarter.id;
    this.residents.set(resident.id, resident);
    this.quarters.set(quarter.id, quarter);
    this.event({ at: now, source: "world", kind: "claim", subject: quarter.id, sourceAt: now, district: quarter.district, actorId: resident.id, payload: { street: quarter.street } });
    return { ok: true, created: true, resident: this.residentOut(resident), quarter: this.quarterOut(quarter) };
  }

  async mergeGuest(input: { guestId: string; accountId: string; now: Date }): Promise<MergeResult> {
    const now = input.now.getTime();
    const g = this.residents.get(input.guestId);
    let r = [...this.residents.values()].find((x) => x.accountId === input.accountId);
    if (!g || g.accountId !== null || g.guestSalt === null) return { ok: true, merged: false, resident: r ? this.residentOut(r) : null };
    if (!r) {
      if (!this.accounts.has(input.accountId)) return { ok: false, error: "no_account" };
      g.accountId = input.accountId;
      g.guestSalt = null;
      return { ok: true, merged: true, resident: this.residentOut(g) };
    }
    r = r as ResidentRow;
    for (const p of this.points) {
      if (p.residentId === g.id && !this.points.some((x) => x.residentId === r!.id && x.key === p.key)) p.residentId = r.id;
    }
    for (const t of this.tasks.filter((x) => x.residentId === g.id)) {
      const mine = this.tasks.find((x) => x.residentId === r!.id && x.day === t.day && x.kind === t.kind);
      if (mine) {
        mine.progress = Math.max(mine.progress, t.progress);
        mine.doneAt = mine.doneAt === null ? t.doneAt : t.doneAt === null ? mine.doneAt : Math.min(mine.doneAt, t.doneAt);
      } else {
        t.residentId = r.id;
      }
    }
    for (const v of this.visits) {
      if (v.visitorId === g.id && !this.visits.some((x) => x.visitorId === r!.id && x.quarterId === v.quarterId && x.day === v.day)) v.visitorId = r.id;
    }
    for (const q of this.quarters.values()) {
      if (q.ownerId === g.id) {
        q.ownerId = r.id;
        q.updatedAt = now;
      }
    }
    for (const e of this.events) if (e.actorId === g.id) e.actorId = r.id;
    const count = (quarterId: string) => [...this.buildings.values()].filter((b) => b.quarterId === quarterId).length;
    if (count(g.homeQuarterId) > count(r.homeQuarterId)) r.homeQuarterId = g.homeQuarterId;
    this.residents.delete(g.id);
    this.removeResidentRows(g.id);
    this.relevel(r.id, now);
    return { ok: true, merged: true, resident: this.residentOut(r) };
  }

  /** What the database's cascade removes with a resident. */
  private removeResidentRows(residentId: string): void {
    const keep = <T,>(rows: T[], drop: (row: T) => boolean) => {
      for (let i = rows.length - 1; i >= 0; i -= 1) if (drop(rows[i])) rows.splice(i, 1);
    };
    keep(this.points, (p) => p.residentId === residentId);
    keep(this.tasks, (t) => t.residentId === residentId);
    keep(this.visits, (v) => v.visitorId === residentId);
    this.consents.delete(residentId);
    for (const e of this.events) if (e.actorId === residentId) e.actorId = null;
  }

  async quarter(id: string): Promise<QuarterState | null> {
    const q = this.quarters.get(id);
    return q ? { quarter: this.quarterOut(q), buildings: this.buildingsOf(q.id) } : null;
  }

  async district(input: { district: District; after: string | null; limit: number }): Promise<{ quarters: QuarterSketch[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.min(input.limit || 100, 500));
    const rows = [...this.quarters.values()]
      .filter((q) => q.district === input.district && (input.after === null || q.id > input.after))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const page = rows.slice(0, limit).map((q) => ({
      id: q.id, ownerId: q.ownerId, street: q.street, cell: { x: q.x, z: q.z }, level: q.level,
      buildings: this.buildingsOf(q.id).map((b) => ({ slot: b.slot, kind: b.kind, level: b.level })),
    }));
    return { quarters: page, nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  async me(input: { residentId: string; day: string }): Promise<MeData | null> {
    const r = this.residents.get(input.residentId);
    if (!r) return null;
    const home = this.quarters.get(r.homeQuarterId)!;
    const owned = [...this.quarters.values()]
      .filter((q) => q.ownerId === r.id)
      .sort((a, b) => Number(b.id === r.homeQuarterId) - Number(a.id === r.homeQuarterId) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const recent = this.points
      .filter((p) => p.residentId === r.id)
      .sort((a, b) => b.at - a.at || b.seq - a.seq)
      .slice(0, 20)
      .map((p) => ({ residentId: p.residentId, delta: p.delta, reason: p.reason, sourceRef: p.sourceRef, idempotencyKey: p.key, at: iso(p.at) }));
    return {
      resident: this.residentOut(r),
      quarter: this.quarterOut(home),
      buildings: this.buildingsOf(home.id),
      quarters: owned.map((q) => this.quarterOut(q)),
      points: { total: this.total(r.id), recent },
      tasks: this.tasksOf(r.id, input.day),
    };
  }

  private gate(quarterId: string, residentId: string, version: number):
    | { ok: true; q: QuarterRow }
    | { ok: false; error: "not_found" | "not_owner" }
    | { ok: false; error: "version"; quarter: Quarter; buildings: PublicBuilding[] } {
    const q = this.quarters.get(quarterId);
    if (!q) return { ok: false, error: "not_found" };
    if (q.ownerId !== residentId) return { ok: false, error: "not_owner" };
    if (q.version !== version) return { ok: false, error: "version", quarter: this.quarterOut(q), buildings: this.buildingsOf(q.id) };
    return { ok: true, q };
  }

  async commitBuild(input: CommitBuild): Promise<CommitBuildResult> {
    const now = input.now.getTime();
    const gate = this.gate(input.quarterId, input.residentId, input.version);
    if (!gate.ok) return gate;
    const q = gate.q;
    let b = [...this.buildings.values()].find((x) => x.quarterId === q.id && x.slot === input.slot);
    if (b && b.kind !== input.kind && b.link) return { ok: false, error: "linked" };
    q.version += 1;
    q.updatedAt = now;
    if (b) {
      if (b.kind !== input.kind) b.link = null;
      b.kind = input.kind as BuildingKind;
      b.level = input.level;
      b.modules = [...input.modules];
      b.updatedAt = now;
    } else {
      b = { id: randomUUID(), quarterId: q.id, slot: input.slot, kind: input.kind as BuildingKind, level: input.level, modules: [...input.modules], link: null, updatedAt: now };
      this.buildings.set(b.id, b);
    }
    for (const item of input.progress) this.progress(input.residentId, input.day, item, input.taskPoints, now);
    this.event({ at: now, source: "world", kind: "build", subject: q.id, sourceAt: now, district: q.district, actorId: input.residentId, payload: { street: q.street, slot: b.slot, kind: b.kind, level: b.level } });
    return { ok: true, quarter: this.quarterOut(q), building: this.buildingOut(b), tasks: this.tasksOf(input.residentId, input.day), pointsTotal: this.total(input.residentId) };
  }

  async commitLink(input: CommitLink): Promise<CommitLinkResult> {
    const now = input.now.getTime();
    const gate = this.gate(input.quarterId, input.residentId, input.version);
    if (!gate.ok) return gate;
    const q = gate.q;
    const b = [...this.buildings.values()].find((x) => x.quarterId === q.id && x.slot === input.slot);
    if (!b) return { ok: false, error: "no_building" };
    const key = linkKey(input.link);
    if (key && [...this.buildings.values()].some((x) => x.id !== b.id && linkKey(x.link) === key)) return { ok: false, error: "link_taken" };
    b.link = input.link ? { ...input.link } : null;
    b.updatedAt = now;
    q.version += 1;
    q.updatedAt = now;
    this.event({ at: now, source: "world", kind: "build", subject: q.id, sourceAt: now, district: q.district, actorId: input.residentId, payload: { street: q.street, slot: b.slot, action: "link", linkKind: b.link?.kind ?? null } });
    return { ok: true, quarter: this.quarterOut(q), building: this.buildingOut(b) };
  }

  async visit(input: VisitInput): Promise<VisitResult> {
    const now = input.now.getTime();
    const q = this.quarters.get(input.quarterId);
    if (!q) return { ok: false, error: "not_found" };
    if (q.ownerId === input.visitorId) return { ok: true, counted: false, reason: "own_quarter", visit: null };
    let v = this.visits.find((x) => x.visitorId === input.visitorId && x.quarterId === input.quarterId && x.day === input.day);
    const counted = !v;
    if (!v) {
      v = { visitorId: input.visitorId, quarterId: input.quarterId, day: input.day, verifiedHuman: input.verifiedHuman, at: now };
      this.visits.push(v);
      if (input.progress) this.progress(input.visitorId, input.day, input.progress, input.taskPoints, now);
      this.event({ at: now, source: "world", kind: "visit", subject: q.id, sourceAt: now, district: q.district, actorId: input.visitorId, payload: { street: q.street, verifiedHuman: v.verifiedHuman } });
    }
    const visit: Visit = { visitorId: v.visitorId, quarterId: v.quarterId, day: v.day, verifiedHuman: v.verifiedHuman };
    return { ok: true, counted, reason: counted ? "counted" : "already_today", visit };
  }

  async award(input: AwardInput): Promise<{ ok: true; awarded: boolean; total: number } | { ok: false; error: "not_found" }> {
    if (!this.residents.has(input.residentId)) return { ok: false, error: "not_found" };
    const awarded = this.awardRow(input.residentId, input.reason, input.delta, input.sourceRef, input.key, input.now.getTime());
    return { ok: true, awarded, total: this.total(input.residentId) };
  }

  async away(input: { residentId: string; since: Date; until: Date; limit: number }): Promise<WorldEvent[] | null> {
    const r = this.residents.get(input.residentId);
    if (!r) return null;
    const district = this.quarters.get(r.homeQuarterId)?.district ?? null;
    const quarters = new Set([...this.quarters.values()].filter((q) => q.ownerId === r.id).map((q) => q.id));
    // The engine objects my buildings show, by the subject their events carry.
    const objects = new Set([...this.buildings.values()].filter((b) => quarters.has(b.quarterId)).map((b) => linkKey(b.link)?.split(":")[1]).filter((s): s is string => !!s));
    const mine = (e: EventRow) => quarters.has(e.subject) || objects.has(e.subject);
    const since = input.since.getTime();
    const until = input.until.getTime();
    const limit = Math.max(1, Math.min(input.limit || 100, 200));
    const newest = (a: EventRow, b: EventRow) => b.sourceAt! - a.sourceAt! || (a.id < b.id ? -1 : 1);
    return this.events
      .filter((e) => e.sourceAt !== null && e.sourceAt > since && e.sourceAt <= until && e.actorId !== r.id
        && (mine(e) || (e.district !== null && e.district === district) || (e.district === null && e.source !== "world")))
      // What is mine is never crowded out by the city: it comes first, then the rest fills the limit.
      .sort((a, b) => Number(mine(b)) - Number(mine(a)) || newest(a, b))
      .slice(0, limit)
      .sort(newest)
      .map((e) => this.eventOut(e));
  }

  async consent(residentId: string): Promise<AwayConsent | null> {
    if (!this.residents.has(residentId)) return null;
    const c = this.consents.get(residentId);
    return c ? { telegram: c.telegram, push: c.push, updatedAt: iso(c.updatedAt) } : { telegram: false, push: false, updatedAt: null };
  }

  async setConsent(input: ConsentInput): Promise<ConsentResult> {
    const r = this.residents.get(input.residentId);
    if (!r) return { ok: false, error: "not_found" };
    if (r.accountId === null) return { ok: false, error: "account_required" };
    const before = this.consents.get(r.id) ?? { telegram: false, push: false, updatedAt: 0 };
    const c = { telegram: input.telegram ?? before.telegram, push: input.push ?? before.push, updatedAt: input.now.getTime() };
    this.consents.set(r.id, c);
    return { ok: true, consent: { telegram: c.telegram, push: c.push, updatedAt: iso(c.updatedAt) } };
  }

  async recordEvent(input: RecordEventInput): Promise<WorldEvent> {
    return this.event({ at: input.now.getTime(), source: input.source, kind: input.kind, subject: input.subject, sourceAt: input.sourceAt ? input.sourceAt.getTime() : null, district: input.district, actorId: null, payload: { ...input.payload } });
  }

  async version(id: string): Promise<WorldVersion | null> {
    const v = this.versions.get(id);
    return v ? { id: v.id, day: v.day, seed: v.seed, towers: structuredClone(v.towers), createdAt: iso(v.createdAt) } : null;
  }

  async freezeVersion(input: { day: string; seed: string; towers: unknown[]; now: Date }): Promise<{ created: boolean; version: WorldVersion }> {
    let v = [...this.versions.values()].find((x) => x.day === input.day && x.seed === input.seed);
    const created = !v;
    if (!v) {
      v = { id: randomUUID(), day: input.day, seed: input.seed, towers: structuredClone(input.towers), createdAt: input.now.getTime() };
      this.versions.set(v.id, v);
    }
    return { created, version: (await this.version(v.id))! };
  }

  async requestBegin(input: RequestRef & { hash: string; now: Date }): Promise<RequestGate> {
    const now = input.now.getTime();
    const id = `${input.scope}\u0000${input.route}\u0000${input.key}`;
    for (const [k, row] of this.requests) if (row.createdAt < now - DAY_MS) this.requests.delete(k);
    const x = this.requests.get(id);
    if (!x) {
      this.requests.set(id, { hash: input.hash, status: null, body: null, createdAt: now, completedAt: null });
      return { state: "new" };
    }
    if (x.hash !== input.hash) return { state: "mismatch" };
    if (x.completedAt === null) {
      if (x.createdAt < now - 60_000) {
        x.createdAt = now;
        return { state: "new" };
      }
      return { state: "pending" };
    }
    return { state: "replay", status: x.status!, body: structuredClone(x.body) };
  }

  async requestFinish(input: RequestRef & { status: number; body: unknown; now: Date }): Promise<void> {
    const x = this.requests.get(`${input.scope}\u0000${input.route}\u0000${input.key}`);
    if (x && x.completedAt === null) {
      x.status = input.status;
      x.body = structuredClone(input.body);
      x.completedAt = input.now.getTime();
    }
  }

  async requestAbandon(input: RequestRef): Promise<void> {
    const id = `${input.scope}\u0000${input.route}\u0000${input.key}`;
    if (this.requests.get(id)?.completedAt === null) this.requests.delete(id);
  }

  async limitHit(input: { bucket: string; windowSeconds: number; max: number; now: Date }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const windowMs = input.windowSeconds * 1000;
    const now = input.now.getTime();
    const start = Math.floor(now / windowMs) * windowMs;
    for (const k of this.limits.keys()) if (Number(k.slice(k.lastIndexOf("\u0000") + 1)) < now - DAY_MS) this.limits.delete(k);
    const id = `${input.bucket}\u0000${start}`;
    const hits = (this.limits.get(id) ?? 0) + 1;
    this.limits.set(id, hits);
    return { allowed: hits <= input.max, retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
  }
}
