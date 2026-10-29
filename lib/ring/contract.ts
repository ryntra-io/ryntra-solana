/**
 * The shapes of `/api/ring` (CITY-50, decision 72): what the routes take and give, for the server and the city alike.
 *
 *   GET  /api/ring/models                                   → ModelsResponse
 *   GET  /api/ring/model?id=                                → QuoteResponse
 *   GET  /api/ring/garage?quarter=&slot=                    → GarageResponse
 *   POST /api/ring/create  CreateRequest  + Idempotency-Key → AgentResponse (201)
 *   POST /api/ring/change  ChangeRequest  + Idempotency-Key → AgentResponse
 *   POST /api/ring/off     OffRequest     + Idempotency-Key → AgentResponse
 *
 * Errors are `{ error: { code, message } }`, as in `/api/v1`. An agent is a body (an archetype), a brain (one model
 * of OpenRouter's catalog pinned to one provider) and a script of up to 2 000 characters; it lives in a garage of its
 * owner's quarter, one agent to a garage slot. Matches (CITY-51) and money (CITY-52) are not here.
 *
 * Pure: types and lists only.
 */

/** The six bodies of decision 72; the characters line (CITY-57) draws them, the Ring keeps only the name. */
export const ARCHETYPES = ["guardian", "fighter", "tactician", "scout", "engineer", "host"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** Weight classes by the price of the brain: a match pairs two agents of one class. */
export const WEIGHTS = ["light", "middle", "heavy"] as const;
export type Weight = (typeof WEIGHTS)[number];

/** The formats with an objective verdict (decision 72): Duo Crack, Code, Market Replay. Each has its own rating. */
export const FORMATS = ["duo-crack", "code", "market-replay"] as const;
export type RingFormat = (typeof FORMATS)[number];

/** A script is at most this many characters (Unicode code points, as the city counts them). */
export const SCENARIO_MAX = 2_000;

export const isArchetype = (value: unknown): value is Archetype => typeof value === "string" && (ARCHETYPES as readonly string[]).includes(value);
export const isWeight = (value: unknown): value is Weight => typeof value === "string" && (WEIGHTS as readonly string[]).includes(value);
export const isFormat = (value: unknown): value is RingFormat => typeof value === "string" && (FORMATS as readonly string[]).includes(value);

/** One model as the brain picker lists it, priced before anyone picks it. */
export type ModelOption = {
  /** OpenRouter's exact id, e.g. `anthropic/claude-sonnet-5.5`. */
  id: string;
  name: string;
  weight: Weight;
  /** What one standard match costs this agent, at the model's catalog price — micro-dollars, rounded up. */
  matchMicroUsd: number;
  /** Dollars per 1M tokens, as OpenRouter lists the model. */
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

export type ModelsResponse = {
  models: ModelOption[];
  /** When the catalog was read; `stale` when OpenRouter could not be reached and an older copy is served. */
  readAt: string;
  stale: boolean;
};

/** The model as it will be pinned: one provider, that provider's own price, the class it falls in, what it can play. */
export type ModelQuote = {
  id: string;
  name: string;
  /** The one provider slug the agent is pinned to (`provider.only`, no fallbacks). */
  provider: string;
  providerName: string;
  weight: Weight;
  matchMicroUsd: number;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  /** The formats this brain can play with that provider. */
  formats: RingFormat[];
  stale: boolean;
};

export type QuoteResponse = { quote: ModelQuote };

/** A rating as shown: Elo with its 95 % interval; `provisional` until the agent has played enough to trust it. */
export type RatingView = {
  format: RingFormat;
  rating: number;
  low: number;
  high: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  provisional: boolean;
};

export type Brain = {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  weight: Weight;
  matchMicroUsd: number;
};

/**
 * An agent as the routes show it. Anyone may see the body, the brain, the class and the ratings; the script and the
 * key's state only its owner.
 */
export type AgentView = {
  id: string;
  quarterId: string;
  slot: number;
  /** A name made from the body and the id — no free text anyone else reads. */
  name: string;
  archetype: Archetype;
  brain: Brain;
  formats: RingFormat[];
  ratings: RatingView[];
  status: "active" | "off";
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Owner only. */
  scenario?: string;
  /**
   * Owner only: `live` — its own OpenRouter key with a dollar limit; `quiet` — no key (the server has no management
   * key, nothing was made); `off` — switched off with the agent.
   */
  key?: { state: "live" | "quiet" | "off"; limitUsd: number | null; reset: "monthly" | null };
};

export type GarageResponse = {
  /** The active agent in this garage slot, or null. */
  agent: AgentView | null;
  /** Whether the agent is the asker's own. */
  mine: boolean;
};

export type AgentResponse = { agent: AgentView };

export type CreateRequest = { quarter: string; slot: number; archetype: Archetype; model: string; scenario: string };

/** The whole agent as it should be, at the version the person saw. */
export type ChangeRequest = { agent: string; version: number; archetype: Archetype; model: string; scenario: string };

export type OffRequest = { agent: string; version: number };

export type RingErrorCode =
  | "CLOSED"
  | "UNAVAILABLE"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "SIGN_IN"
  | "NOT_FOUND"
  | "NOT_YOURS"
  | "NOT_GARAGE"
  | "SLOT_TAKEN"
  | "VERSION"
  | "OFF"
  | "TOO_LONG"
  | "MODEL_REFUSED"
  | "MODELS_UNAVAILABLE"
  | "KEY_FAILED"
  | "RATE_LIMITED";
