import type { FeedEntry, FeedOutcome } from "./store";
import type { Title, VaultId } from "./levels";
import type { EncodingKind } from "./screen";

/**
 * The shapes of `/api/vault`: what the routes take and give, for the server and the city alike.
 *
 *   POST /api/vault/attempt   { vault, text }  + Idempotency-Key   → AttemptResponse (429 RESTING while the guards rest)
 *   GET  /api/vault/state                                          → VaultState
 *   GET  /api/vault/feed?vault=&before=                             → FeedResponse
 *
 * Errors are `{ error: { code, message } }`, as in `/api/v1`.
 */

export type { FeedOutcome, Title, VaultId, EncodingKind };

export type VaultView = {
  id: VaultId;
  kind: "practice" | "daily";
  level: 1 | 2 | 3;
  /** Words in today's phrase. */
  words: number;
  points: number;
  guard: { name: string; line: string };
  /** Open to this person: the level before it is cracked. */
  open: boolean;
  /** Cracked by this person: ever for a practice level, today for the daily vault. */
  cracked: boolean;
};

export type Limits = Record<"minute" | "day", { left: number; resetS: number }>;

/**
 * Whether the guards answer this person now. They rest when the day's ceiling on their model is reached (until
 * midnight UTC) or when the model needs a person (a few minutes); the door still opens to the phrase while they rest.
 */
export type Guards = {
  awake: boolean;
  /** When they answer again; null while awake. */
  wakesAt: string | null;
  /** The guests' share of the day is used up, but a person signed in with a wallet still finds them awake. */
  walletsAwake: boolean;
};

export type VaultState = {
  /** The UTC day; phrases and the daily guard change at its end. */
  day: string;
  resetsAt: string;
  vaults: VaultView[];
  me: { points: number; title: Title | null; limits: Limits };
  guards: Guards;
};

export type AttemptRequest = { vault: VaultId; text: string };

/**
 * held — the guard answered and gave nothing away; leaked — its reply gives words away (the person who asked sees
 * them); caught — it gave words away and the vault's second line masked them; cracked — the attempt was the phrase;
 * screened — encoded text, which the guard never hears.
 */
export type AttemptOutcome = FeedOutcome;

export type PublicEntry = Omit<FeedEntry, "attempt"> & {
  /** The attempt, masked, once it is ten minutes old; null before. */
  attempt: string | null;
};

export type AttemptResponse = {
  outcome: AttemptOutcome;
  /**
   * What the guard said to this person; null when it heard nothing (screened, cracked). From level 3 every word of the
   * vault's dictionary in it is masked, as in the feed.
   */
  reply: string | null;
  /** The share of the phrase the reply gave away, counting only words this person did not bring themselves. */
  pressure: number;
  /** The encoding found, when screened. */
  encoding: EncodingKind | null;
  /** What this crack earned, when it earned something. */
  award: { points: number; title: Title | null } | null;
  /** The attempt as the feed shows it now. */
  entry: PublicEntry;
  state: VaultState;
};

export type FeedResponse = { vault: VaultId; entries: PublicEntry[]; next: string | null };

export const VAULT_ERROR_CODES = [
  "BAD_REQUEST",
  "FORBIDDEN",
  "IDEMPOTENCY_KEY_REQUIRED",
  "PAYLOAD_TOO_LARGE",
  "NOT_FOUND",
  "CLOSED",
  "LOCKED",
  "EMPTY",
  "TOO_LONG",
  "RATE_LIMITED",
  "RESTING",
  "GUARD_SILENT",
  "UNAVAILABLE",
] as const;
export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[number];

export type VaultError = {
  error: { code: VaultErrorCode; message: string; retryAfterS?: number; window?: "minute" | "day"; guards?: Guards };
};
