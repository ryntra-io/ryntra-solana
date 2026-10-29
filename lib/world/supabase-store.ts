import { ARRIVALS, LEVEL_POINTS } from "./catalog";
import type { AwayConsent, DailyTask, PublicBuilding, Quarter, QuarterSketch, Resident, Visit, WorldEvent, WorldVersion } from "./contract";
import {
  WorldStoreUnavailable,
  type AwardInput, type ClaimResult, type CommitBuild, type CommitBuildResult, type CommitLink, type CommitLinkResult, type ConsentInput, type ConsentResult,
  type MeData, type MergeResult, type QuarterState, type RecordEventInput, type RequestGate, type RequestRef,
  type StoredResident, type VisitInput, type VisitResult, type WorldStore,
} from "./store";

/**
 * The world in the database: one call to one `public.world_*` function per
 * question, each gated by the app secret and each one transaction. The
 * transport is the server's usual one (`rpcResult`, which adds the secret);
 * a test passes its own transport to a throwaway database.
 */

export type WorldRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown> & { ok?: unknown; error?: unknown };

const levels = [...LEVEL_POINTS];

export class SupabaseWorldStore implements WorldStore {
  private readonly rpc: WorldRpc;

  constructor(rpc: WorldRpc) {
    this.rpc = rpc;
  }

  /** One call; a transport failure or a malformed answer is `WorldStoreUnavailable`. */
  private async call(fn: string, args: Record<string, unknown>): Promise<Answer> {
    const answer = await this.rpc(fn, args);
    if (!answer.ok) throw new WorldStoreUnavailable(`${fn}: ${answer.error}`);
    const data = answer.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new WorldStoreUnavailable(`${fn}: no answer`);
    return data as Answer;
  }

  /** A call whose answer is always `ok: true`. */
  private async ok(fn: string, args: Record<string, unknown>): Promise<Answer> {
    const data = await this.call(fn, args);
    if (data.ok !== true) throw new WorldStoreUnavailable(`${fn}: ${String(data.error ?? "refused")}`);
    return data;
  }

  async resident(by: { id: string } | { accountId: string }): Promise<StoredResident | null> {
    const data = await this.ok("world_resident", "id" in by ? { p_id: by.id } : { p_account_id: by.accountId });
    return (data.resident as StoredResident | null) ?? null;
  }

  async claim(input: { accountId: string | null; guestSalt: string | null; displayName: string | null; now: Date }): Promise<ClaimResult> {
    const data = await this.call("world_claim", {
      p_account_id: input.accountId, p_guest_salt: input.guestSalt, p_display_name: input.displayName,
      p_street_length: ARRIVALS.streetLength, p_now: input.now.toISOString(),
    });
    if (data.ok === true) return { ok: true, created: data.created === true, resident: data.resident as Resident, quarter: data.quarter as Quarter };
    if (data.error === "no_account") return { ok: false, error: "no_account" };
    throw new WorldStoreUnavailable(`world_claim: ${String(data.error)}`);
  }

  async mergeGuest(input: { guestId: string; accountId: string; now: Date }): Promise<MergeResult> {
    const data = await this.call("world_merge_guest", { p_guest_id: input.guestId, p_account_id: input.accountId, p_levels: levels, p_now: input.now.toISOString() });
    if (data.ok === true) return { ok: true, merged: data.merged === true, resident: (data.resident as Resident | null) ?? null };
    if (data.error === "no_account") return { ok: false, error: "no_account" };
    throw new WorldStoreUnavailable(`world_merge_guest: ${String(data.error)}`);
  }

  async quarter(id: string): Promise<QuarterState | null> {
    const data = await this.ok("world_quarter", { p_id: id });
    return data.quarter ? { quarter: data.quarter as Quarter, buildings: data.buildings as PublicBuilding[] } : null;
  }

  async district(input: { district: string; after: string | null; limit: number }): Promise<{ quarters: QuarterSketch[]; nextCursor: string | null }> {
    const data = await this.ok("world_district", { p_district: input.district, p_after: input.after, p_limit: input.limit });
    return { quarters: data.quarters as QuarterSketch[], nextCursor: (data.nextCursor as string | null) ?? null };
  }

  async me(input: { residentId: string; day: string }): Promise<MeData | null> {
    const data = await this.ok("world_me", { p_resident_id: input.residentId, p_day: input.day });
    return (data.me as MeData | null) ?? null;
  }

  async commitBuild(input: CommitBuild): Promise<CommitBuildResult> {
    const data = await this.call("world_commit_build", {
      p_resident_id: input.residentId, p_quarter_id: input.quarterId, p_version: input.version, p_slot: input.slot,
      p_kind: input.kind, p_level: input.level, p_modules: input.modules, p_day: input.day, p_progress: input.progress,
      p_task_points: input.taskPoints, p_levels: levels, p_now: input.now.toISOString(),
    });
    if (data.ok === true) {
      return { ok: true, quarter: data.quarter as Quarter, building: data.building as PublicBuilding, tasks: data.tasks as DailyTask[], pointsTotal: Number(data.pointsTotal) };
    }
    if (data.error === "version") return { ok: false, error: "version", quarter: data.quarter as Quarter, buildings: data.buildings as PublicBuilding[] };
    if (data.error === "not_found" || data.error === "not_owner" || data.error === "linked") return { ok: false, error: data.error };
    throw new WorldStoreUnavailable(`world_commit_build: ${String(data.error)}`);
  }

  async commitLink(input: CommitLink): Promise<CommitLinkResult> {
    const data = await this.call("world_commit_link", {
      p_resident_id: input.residentId, p_quarter_id: input.quarterId, p_version: input.version, p_slot: input.slot,
      p_link: input.link, p_now: input.now.toISOString(),
    });
    if (data.ok === true) return { ok: true, quarter: data.quarter as Quarter, building: data.building as PublicBuilding };
    if (data.error === "version") return { ok: false, error: "version", quarter: data.quarter as Quarter, buildings: data.buildings as PublicBuilding[] };
    if (data.error === "not_found" || data.error === "not_owner" || data.error === "no_building" || data.error === "link_taken") return { ok: false, error: data.error };
    throw new WorldStoreUnavailable(`world_commit_link: ${String(data.error)}`);
  }

  async visit(input: VisitInput): Promise<VisitResult> {
    const data = await this.call("world_visit", {
      p_visitor_id: input.visitorId, p_quarter_id: input.quarterId, p_day: input.day, p_verified: input.verifiedHuman,
      p_progress: input.progress, p_task_points: input.taskPoints, p_levels: levels, p_now: input.now.toISOString(),
    });
    if (data.ok === true) {
      const reason = data.reason === "counted" || data.reason === "already_today" || data.reason === "own_quarter" ? data.reason : "already_today";
      return { ok: true, counted: data.counted === true, reason, visit: (data.visit as Visit | null) ?? null };
    }
    if (data.error === "not_found") return { ok: false, error: "not_found" };
    throw new WorldStoreUnavailable(`world_visit: ${String(data.error)}`);
  }

  async award(input: AwardInput): Promise<{ ok: true; awarded: boolean; total: number } | { ok: false; error: "not_found" }> {
    const data = await this.call("world_award", {
      p_resident_id: input.residentId, p_reason: input.reason, p_delta: input.delta, p_source_ref: input.sourceRef,
      p_key: input.key, p_levels: levels, p_now: input.now.toISOString(),
    });
    if (data.ok === true) return { ok: true, awarded: data.awarded === true, total: Number(data.total) };
    if (data.error === "not_found") return { ok: false, error: "not_found" };
    throw new WorldStoreUnavailable(`world_award: ${String(data.error)}`);
  }

  async away(input: { residentId: string; since: Date; until: Date; limit: number }): Promise<WorldEvent[] | null> {
    const data = await this.ok("world_away", { p_resident_id: input.residentId, p_since: input.since.toISOString(), p_until: input.until.toISOString(), p_limit: input.limit });
    return (data.events as WorldEvent[] | null) ?? null;
  }

  async consent(residentId: string): Promise<AwayConsent | null> {
    const data = await this.ok("world_consent", { p_resident_id: residentId });
    return (data.consent as AwayConsent | null) ?? null;
  }

  async setConsent(input: ConsentInput): Promise<ConsentResult> {
    const data = await this.call("world_set_consent", { p_resident_id: input.residentId, p_telegram: input.telegram, p_push: input.push, p_now: input.now.toISOString() });
    if (data.ok === true) return { ok: true, consent: data.consent as AwayConsent };
    if (data.error === "not_found" || data.error === "account_required") return { ok: false, error: data.error };
    throw new WorldStoreUnavailable(`world_set_consent: ${String(data.error)}`);
  }

  async recordEvent(input: RecordEventInput): Promise<WorldEvent> {
    const data = await this.ok("world_record_event", {
      p_source: input.source, p_kind: input.kind, p_subject: input.subject, p_source_at: input.sourceAt ? input.sourceAt.toISOString() : null,
      p_district: input.district, p_payload: input.payload, p_now: input.now.toISOString(),
    });
    return data.event as WorldEvent;
  }

  async version(id: string): Promise<WorldVersion | null> {
    const data = await this.ok("world_version", { p_id: id });
    return (data.version as WorldVersion | null) ?? null;
  }

  async freezeVersion(input: { day: string; seed: string; towers: unknown[]; now: Date }): Promise<{ created: boolean; version: WorldVersion }> {
    const data = await this.ok("world_freeze_version", { p_day: input.day, p_seed: input.seed, p_towers: input.towers, p_now: input.now.toISOString() });
    return { created: data.created === true, version: data.version as WorldVersion };
  }

  async requestBegin(input: RequestRef & { hash: string; now: Date }): Promise<RequestGate> {
    const data = await this.ok("world_request_begin", { p_scope: input.scope, p_route: input.route, p_key: input.key, p_hash: input.hash, p_now: input.now.toISOString() });
    if (data.state === "new" || data.state === "mismatch" || data.state === "pending") return { state: data.state };
    if (data.state === "replay") return { state: "replay", status: Number(data.status), body: data.body };
    throw new WorldStoreUnavailable("world_request_begin: unknown state");
  }

  async requestFinish(input: RequestRef & { status: number; body: unknown; now: Date }): Promise<void> {
    await this.ok("world_request_finish", { p_scope: input.scope, p_route: input.route, p_key: input.key, p_status: input.status, p_body: input.body, p_now: input.now.toISOString() });
  }

  async requestAbandon(input: RequestRef): Promise<void> {
    await this.ok("world_request_abandon", { p_scope: input.scope, p_route: input.route, p_key: input.key });
  }

  async limitHit(input: { bucket: string; windowSeconds: number; max: number; now: Date }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const data = await this.ok("world_limit_hit", { p_bucket: input.bucket, p_window_seconds: input.windowSeconds, p_max: input.max, p_now: input.now.toISOString() });
    return { allowed: data.allowed === true, retryAfterSeconds: Number(data.retryAfterSeconds) };
  }
}
