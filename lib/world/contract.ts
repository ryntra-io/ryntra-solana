/**
 * The living world's data, exactly as `docs/city/WORLD-CONTRACT.md` states it.
 *
 * Pure and client-safe: no clock, no store, no `process.env`. The server
 * routes under `/api/world` answer these shapes, and the city's front reads
 * them through its own `WorldClient`.
 *
 * The world never counts or moves money. A building keeps only a reference to
 * an object of the engine or the chain; a number on it appears only after a
 * read from the engine.
 */

export type Id = string; // uuid
export type Day = string; // YYYY-MM-DD, UTC

export const DISTRICTS = ["docks", "downtown", "harbor", "heights", "arrivals"] as const;
export type District = (typeof DISTRICTS)[number];

export const BUILDING_KINDS = [
  "home", "coin_tower", "harbor", "workshop", "crew_hq",
  "garage", "oracle", "showcase", "billboard", "decor",
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export const LINK_KINDS = ["mint", "lp_position", "strategy", "team", "agent", "prediction_book"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export type ChainLink =
  | { kind: "mint"; mint: string } // a coin from Ryntra Launch
  | { kind: "lp_position"; position: string } // a DLMM or DAMM v2 position
  | { kind: "strategy"; strategyId: Id } // Strategy Lab
  | { kind: "team"; teamId: Id } // an engine team (/api/v1/teams)
  | { kind: "agent"; agentId: Id }
  | { kind: "prediction_book"; accountId: Id }; // predictions on paper

/**
 * A link as anyone may read it. The paper prediction book is named by the
 * owner's account, and an account id is never shown to other people, so a
 * public read carries only its kind. The owner reads the full link in `me`.
 */
export type PublicChainLink = Exclude<ChainLink, { kind: "prediction_book" }> | { kind: "prediction_book" };

export const POINTS_REASONS = [
  "task_done", "survival_7", "survival_30", "survival_90", "holders_kept",
  "lp_in_range_days", "visitors_verified", "coop_contribution", "war_participation", "vault_crack",
] as const;
export type PointsReason = (typeof POINTS_REASONS)[number];

export const DAILY_TASK_KINDS = ["add_floor", "light_street", "run", "visit_quarters", "coop_build"] as const;
export type DailyTaskKind = (typeof DAILY_TASK_KINDS)[number];

export const EVENT_SOURCES = ["market", "engine", "world"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const EVENT_KINDS = ["pump", "flare", "launch", "graduate", "survival", "claim", "build", "visit", "war"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type Resident = {
  id: Id;
  accountId: Id | null; // the Ryntra account after a wallet sign-in; null for a guest
  displayName: string | null;
  homeQuarterId: Id;
  createdAt: string;
};

export type Quarter = {
  id: Id;
  ownerId: Id; // Resident.id
  district: District;
  street: string; // a street is a place in the district; moving a quarter changes only district and street
  cell: { x: number; z: number };
  level: number; // 1..10
  version: number; // every write sends the version it saw
  updatedAt: string;
};

export type Building = {
  id: Id;
  quarterId: Id;
  slot: number; // a place in the quarter's grid
  kind: BuildingKind;
  level: number; // 1..5
  modules: string[]; // module ids of the kit: "base.stone", "floor.glass", "roof.garden", "light.amber"
  link: ChainLink | null; // only for buildings on the engine
  updatedAt: string;
};

/** A building as anyone may read it (see `PublicChainLink`). */
export type PublicBuilding = Omit<Building, "link"> & { link: PublicChainLink | null };

export type PointsEntry = { residentId: Id; delta: number; reason: PointsReason; sourceRef: string; idempotencyKey: string; at: string };

export type DailyTask = {
  residentId: Id;
  day: Day;
  kind: DailyTaskKind;
  progress: number;
  goal: number;
  doneAt: string | null;
};

export type Visit = { visitorId: Id; quarterId: Id; day: Day; verifiedHuman: boolean }; // one per visitor, quarter and day

export type Crew = { id: Id; name: string; street: string; hqBuildingId: Id | null; teamId: Id | null };

export type WorldEvent = {
  id: Id;
  at: string;
  source: EventSource;
  kind: EventKind;
  subject: string; // a mint, a quarterId or a crewId
  sourceAt: string; // the time at the source; an event without it is never shown
  payload: Record<string, unknown>;
};

export type WorldVersion = { id: Id; day: Day; seed: string; towers: unknown[]; createdAt: string }; // the frozen city of a day

/* ---------------------------------------------------------------- bodies -- */

export type ClaimRequest = { displayName?: string };
export type BuildRequest = { quarterId: Id; slot: number; kind: BuildingKind; modules: string[]; version: number };
export type LinkRequest = { quarterId: Id; slot: number; link: ChainLink | null; version: number };
export type VisitRequest = { quarterId: Id };

/** `POST /api/world/claim` — 201 when the place was just made, 200 when it already existed. */
export type ClaimResponse = { resident: Resident; quarter: Quarter; created: boolean };

/** `GET /api/world/me`. `quarters` lists every quarter the resident owns, the home one first. */
export type MeResponse = {
  resident: Resident;
  quarter: Quarter;
  buildings: Building[];
  quarters: Quarter[];
  points: { total: number; recent: PointsEntry[] };
  tasks: DailyTask[];
};

/** `GET /api/world/quarter/:id`. */
export type QuarterResponse = { quarter: Quarter; buildings: PublicBuilding[] };

/** One quarter of a district, small enough to draw from far away. */
export type QuarterSketch = {
  id: Id;
  ownerId: Id;
  street: string;
  cell: { x: number; z: number };
  level: number;
  buildings: { slot: number; kind: BuildingKind; level: number }[];
};

/** `GET /api/world/district/:id?cursor=` — `nextCursor` is null on the last page. */
export type DistrictResponse = { district: District; quarters: QuarterSketch[]; nextCursor: string | null };

/** `POST /api/world/build` and `POST /api/world/link`. */
export type BuildResponse = { quarter: Quarter; building: Building; tasks: DailyTask[]; points: { total: number } };
export type LinkResponse = { quarter: Quarter; building: Building };

/** What a line of «While you were away» is about: my quarter, an engine object my building shows, my district, the city. */
export const AWAY_ABOUT = ["quarter", "object", "district", "city"] as const;
export type AwayAbout = (typeof AWAY_ABOUT)[number];

/**
 * One line of «While you were away»: the events of one kind about one thing, folded into one, with where they came
 * from and when. `at` is the newest source time, `from` the oldest; `eventIds` name the events it folds, newest first.
 * `detail` carries only plain figures the events themselves gave (a visit count, a market change); never money the
 * world counted.
 */
export type AwayBeat = {
  id: Id;
  about: AwayAbout;
  kind: EventKind;
  source: EventSource;
  subject: string;
  count: number;
  at: string;
  from: string;
  street: string | null;
  detail: Record<string, string | number | boolean | null>;
  eventIds: Id[];
};

/** The report the city plays: the lines worth twenty seconds, most personal first, and how many events stood behind each kind. */
export type AwayReport = { beats: AwayBeat[]; counts: Record<AwayAbout, number> };

/** `GET /api/world/away?since=` — `events` newest first; `until` is the next `since`; `report` folds them for the screen. */
export type AwayResponse = { since: string; until: string; events: WorldEvent[]; report: AwayReport };

/** The channels «While you were away» may also reach, only with the person's consent: the assistant in Telegram and push. */
export const AWAY_CHANNELS = ["telegram", "push"] as const;
export type AwayChannel = (typeof AWAY_CHANNELS)[number];

/** Off until the person turns a channel on; `updatedAt` is null while they never chose. */
export type AwayConsent = { telegram: boolean; push: boolean; updatedAt: string | null };

/** `POST /api/world/consent` — the channels to change; one left out stays as it is. */
export type ConsentRequest = { telegram?: boolean; push?: boolean };

/** `GET` and `POST /api/world/consent`. `canConsent` is false for a guest: consent is kept under a Ryntra account. */
export type ConsentResponse = { consent: AwayConsent; canConsent: boolean };

/** `POST /api/world/visit` — `counted` is false for a repeat on the same day or for one's own quarter. */
export type VisitResponse = { visit: Visit | null; counted: boolean; reason: "counted" | "already_today" | "own_quarter" };

/* ----------------------------------------------------------------- crews -- */

/**
 * A crew is a street (CITY-20): its members' quarters stand in one row of one street of Arrivals, and they build its
 * headquarters together, with modules and points — never money. The rules are `lib/world/crew.ts`.
 */

/** The street's colour, one of the city's player lights (`city/lib/trade/colour.ts`): never amber, mint or red. */
export const CREW_COLOURS = ["cyan", "sky", "periwinkle", "lilac", "orchid", "rose", "lime", "pearl"] as const;
export type CrewColour = (typeof CREW_COLOURS)[number];

/** The headquarters as everyone sees it: its level, the units given towards it, the units the next level needs, its modules. */
export type CrewHq = { level: number; units: number; next: number | null; modules: string[] };

/** A crew's street as anyone may read it: on the terrace, and behind an invite. */
export type CrewStreet = {
  id: Id;
  name: string;
  colour: CrewColour;
  street: string; // the Arrivals street the crew holds, «arrivals-7»
  row: number; // that street as a row of the terrace, from 0
  members: number;
  limit: number;
  hq: CrewHq;
};

/** A member as the crew sees them. `verified` — signed in to a Ryntra account, not a guest. */
export type CrewMember = { quarterId: Id; name: string | null; lot: number; level: number; verified: boolean; joinedAt: string };

/**
 * The war of districts (CITY-21) counts a street by what its people do and how many of them are real: actions of the
 * week (builds, visits, gifts — at most a few a person a day) and verified members. Nothing bought counts.
 */
export type CrewScore = { week: Day; actions: number; verified: number; total: number };

/** What I may still give today, and how many of my points are not given yet. */
export type CrewMe = { quarterId: Id; gave: { module: boolean; points: boolean }; points: number };

/** My crew, as a member reads it: the street, its people, its invite, its score and what I can give. */
export type MyCrew = CrewStreet & { invite: string; people: CrewMember[]; score: CrewScore; me: CrewMe };

export type CreateCrewRequest = { name: string; colour: CrewColour };
export type JoinCrewRequest = { code: string };
export type GiftRequest = { kind: "module"; module: string } | { kind: "points"; points: number };

/** `GET /api/world/crew` — null while I am in no crew. */
export type CrewResponse = { crew: MyCrew | null };
/** `GET /api/world/crews` — every crew street of Arrivals. */
export type CrewsResponse = { crews: CrewStreet[] };
/** `GET /api/world/crew/invite/:code`. */
export type InviteResponse = { crew: CrewStreet };
/** `POST /api/world/crew`, `/crew/join` and `/crew/gift`; `quarter` is my home quarter where it stands now. */
export type CrewWriteResponse = { crew: MyCrew; quarter: Quarter };
/** `POST /api/world/crew/leave` — my quarter back on a newcomers' street. */
export type LeaveCrewResponse = { quarter: Quarter };

/** Why a crew step was refused. */
export type CrewRefusal =
  | "name" // the name cannot be shown
  | "full" // the crew has as many members as it may
  | "in_crew" // I am in a crew already
  | "not_in_crew"
  | "today" // this kind of gift was already given today
  | "points" // more points than I have left to give
  | "module"; // a module my quarter's level does not open

/* ---------------------------------------------------------------- errors -- */

/**
 * Every refusal is `{ error: { code, message } }` with an HTTP status; `code`
 * is stable, `message` is for a log. A version conflict also carries the
 * quarter as it is now; a closed module also carries the reason and what
 * opens it.
 */
export const WORLD_ERROR_CODES = [
  "BAD_REQUEST", // 400
  "UNKNOWN_MODULE", // 400
  "IDEMPOTENCY_KEY_REQUIRED", // 400
  "NO_RESIDENT", // 401: no guest key and no resident for the signed-in account
  "WALLET_REQUIRED", // 401: linking needs a wallet the person signed with
  "FORBIDDEN", // 403: a write from another site
  "NOT_OWNER", // 403
  "NOT_FOUND", // 404
  "VERSION_CONFLICT", // 409, with the current quarter and buildings
  "REQUEST_IN_PROGRESS", // 409: the same Idempotency-Key is still running
  "LINK_TAKEN", // 409: another building already shows this object
  "LOCKED", // 422, with `reason` and `need`
  "LINK_REFUSED", // 422, with `reason`
  "CREW_REFUSED", // 422, with `reason` (`CrewRefusal`)
  "IDEMPOTENCY_KEY_REUSED", // 422: the same key with a different request
  "PAYLOAD_TOO_LARGE", // 413
  "RATE_LIMITED", // 429
  "UNAVAILABLE", // 503
] as const;
export type WorldErrorCode = (typeof WORLD_ERROR_CODES)[number];

/** Why a module, slot, building kind or level is still closed. */
export type LockReason = "slot" | "kind" | "module" | "level" | "limit" | "linked";

/** Why a link was refused. */
export type LinkRefusal = "kind_mismatch" | "not_yours" | "unverifiable" | "account_required";

export type WorldError = {
  error: {
    code: WorldErrorCode;
    message: string;
    reason?: LockReason | LinkRefusal | CrewRefusal;
    need?: { quarterLevel?: number };
    module?: string;
  };
  quarter?: Quarter;
  buildings?: Building[];
};
