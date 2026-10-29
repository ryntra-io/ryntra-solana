import type {
  AwayConsent, DailyTask, DailyTaskKind, District, EventKind, EventSource, PointsEntry, PointsReason, PublicBuilding,
  Quarter, QuarterSketch, Resident, Visit, WorldEvent, WorldVersion,
} from "./contract";

/**
 * Where the world is kept. Two stores answer the same questions the same way:
 * the database through the server's functions (`supabase-store.ts`) and
 * memory (`memory-store.ts`) for tests and local work. One shared test
 * (`store.test.mjs`) holds both to the same behaviour.
 *
 * Every write that can race is a single atomic step here: a build or a link is
 * written only if the quarter is still at the version the person saw, a visit
 * counts once a day, points pay once per key. A store that cannot answer
 * throws `WorldStoreUnavailable`; a refusal is a value.
 */

export class WorldStoreUnavailable extends Error {
  constructor(message = "world store unavailable") {
    super(message);
    this.name = "WorldStoreUnavailable";
  }
}

/** A resident with the salt of its guest key; the salt never leaves the server. */
export type StoredResident = Resident & { guestSalt: string | null };

export type QuarterState = { quarter: Quarter; buildings: PublicBuilding[] };

export type ClaimResult =
  | { ok: true; created: boolean; resident: Resident; quarter: Quarter }
  | { ok: false; error: "no_account" };

export type MergeResult = { ok: true; merged: boolean; resident: Resident | null } | { ok: false; error: "no_account" };

export type MeData = {
  resident: Resident;
  quarter: Quarter;
  buildings: PublicBuilding[];
  quarters: Quarter[];
  points: { total: number; recent: PointsEntry[] };
  /** Only the tasks already stored for the day; the caller adds the rest at zero. */
  tasks: DailyTask[];
};

export type Progress = { kind: DailyTaskKind; delta: number; goal: number };

export type CommitBuild = {
  residentId: string;
  quarterId: string;
  version: number;
  slot: number;
  kind: string;
  level: number;
  modules: string[];
  day: string;
  progress: Progress[];
  taskPoints: number;
  now: Date;
};

export type CommitConflict = { ok: false; error: "version"; quarter: Quarter; buildings: PublicBuilding[] };

export type CommitBuildResult =
  | { ok: true; quarter: Quarter; building: PublicBuilding; tasks: DailyTask[]; pointsTotal: number }
  | CommitConflict
  | { ok: false; error: "not_found" | "not_owner" | "linked" };

export type CommitLink = {
  residentId: string;
  quarterId: string;
  version: number;
  slot: number;
  /** The public form (`storedLink`), or null to take the link off. */
  link: Record<string, string> | null;
  now: Date;
};

export type CommitLinkResult =
  | { ok: true; quarter: Quarter; building: PublicBuilding }
  | CommitConflict
  | { ok: false; error: "not_found" | "not_owner" | "no_building" | "link_taken" };

export type VisitInput = {
  visitorId: string;
  quarterId: string;
  day: string;
  verifiedHuman: boolean;
  progress: Progress | null;
  taskPoints: number;
  now: Date;
};

export type VisitResult =
  | { ok: true; counted: boolean; reason: "counted" | "already_today" | "own_quarter"; visit: Visit | null }
  | { ok: false; error: "not_found" };

export type AwardInput = {
  residentId: string;
  reason: PointsReason;
  delta: number;
  sourceRef: string;
  key: string;
  now: Date;
};

export type RecordEventInput = {
  source: EventSource;
  kind: EventKind;
  subject: string;
  sourceAt: Date | null;
  district: District | null;
  payload: Record<string, unknown>;
  now: Date;
};

export type ConsentInput = { residentId: string; telegram: boolean | null; push: boolean | null; now: Date };

export type ConsentResult = { ok: true; consent: AwayConsent } | { ok: false; error: "not_found" | "account_required" };

export type RequestGate =
  | { state: "new" }
  | { state: "replay"; status: number; body: unknown }
  | { state: "mismatch" }
  | { state: "pending" };

export type RequestRef = { scope: string; route: string; key: string };

export interface WorldStore {
  resident(by: { id: string } | { accountId: string }): Promise<StoredResident | null>;
  claim(input: { accountId: string | null; guestSalt: string | null; displayName: string | null; now: Date }): Promise<ClaimResult>;
  mergeGuest(input: { guestId: string; accountId: string; now: Date }): Promise<MergeResult>;
  quarter(id: string): Promise<QuarterState | null>;
  district(input: { district: District; after: string | null; limit: number }): Promise<{ quarters: QuarterSketch[]; nextCursor: string | null }>;
  me(input: { residentId: string; day: string }): Promise<MeData | null>;
  commitBuild(input: CommitBuild): Promise<CommitBuildResult>;
  commitLink(input: CommitLink): Promise<CommitLinkResult>;
  visit(input: VisitInput): Promise<VisitResult>;
  award(input: AwardInput): Promise<{ ok: true; awarded: boolean; total: number } | { ok: false; error: "not_found" }>;
  /**
   * Null when the resident does not exist. Events of my quarters and of the engine objects my buildings show come
   * first, up to the limit; my district and the city fill what is left. Newest first.
   */
  away(input: { residentId: string; since: Date; until: Date; limit: number }): Promise<WorldEvent[] | null>;
  /** The channels the resident let «While you were away» reach; null when the resident does not exist. */
  consent(residentId: string): Promise<AwayConsent | null>;
  /** Turns channels on or off (null leaves one as it is); only a resident with an account may consent. */
  setConsent(input: ConsentInput): Promise<ConsentResult>;
  recordEvent(input: RecordEventInput): Promise<WorldEvent>;
  version(id: string): Promise<WorldVersion | null>;
  freezeVersion(input: { day: string; seed: string; towers: unknown[]; now: Date }): Promise<{ created: boolean; version: WorldVersion }>;
  requestBegin(input: RequestRef & { hash: string; now: Date }): Promise<RequestGate>;
  requestFinish(input: RequestRef & { status: number; body: unknown; now: Date }): Promise<void>;
  requestAbandon(input: RequestRef): Promise<void>;
  limitHit(input: { bucket: string; windowSeconds: number; max: number; now: Date }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}
