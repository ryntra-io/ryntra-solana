/**
 * The words of the pre-sign check (CITY-152, working name «ward»; never «Guard», never «Safe»).
 *
 * Three verdicts and nothing between them: `allow` — nothing known stands against the transaction and every core
 * reading happened; `warn` — something a person should look at, or a core reading that did not happen; `block` — a
 * known dangerous effect. There is no score: every verdict is the worst of its named reasons, and every reason says
 * which check produced it. «Unknown» is a level of its own and is never quietly a pass.
 *
 * Pure word lists, no imports: the published contract reads them in a browser.
 */

export const WARD_VERDICTS = ["allow", "warn", "block"] as const;
export type WardVerdict = (typeof WARD_VERDICTS)[number];

/** How heavy one reason is. `unknown` is a reading that did not happen; `info` changes nothing. */
export const WARD_LEVELS = ["block", "warn", "unknown", "info"] as const;
export type WardLevel = (typeof WARD_LEVELS)[number];

/** Which check produced a reason. */
export const WARD_CHECKS = ["input", "simulation", "authority", "nonce", "recipient", "token", "intent", "program"] as const;
export type WardCheck = (typeof WARD_CHECKS)[number];

/** What was pasted. */
export const WARD_INPUTS = ["transaction", "link"] as const;
export type WardInput = (typeof WARD_INPUTS)[number];

export const WARD_NETWORKS = ["mainnet", "devnet"] as const;
export type WardNetwork = (typeof WARD_NETWORKS)[number];

/** Who holds a changed balance. */
export const WARD_HOLDERS = ["you", "wallet", "program"] as const;
export type WardHolder = (typeof WARD_HOLDERS)[number];

/**
 * Every reason the check can give, with its check and default level. The level may only be lowered for a named
 * cause (a known issuer's compliance power reads as `info`), never raised past `block`.
 */
export const WARD_REASONS = {
  /* input */
  LINK_NOT_READ: { check: "input", level: "unknown" },
  TX_SIGNER_ABSENT: { check: "input", level: "info" },
  /* simulation */
  SIMULATION_FAILED: { check: "simulation", level: "warn" },
  SIMULATION_UNAVAILABLE: { check: "simulation", level: "unknown" },
  LOOKUPS_UNREAD: { check: "simulation", level: "unknown" },
  SWEEPS_ASSETS: { check: "simulation", level: "block" },
  /* authority */
  OWNER_CHANGED: { check: "authority", level: "block" },
  TOKEN_OWNER_CHANGED: { check: "authority", level: "block" },
  CLOSE_AUTHORITY_CHANGED: { check: "authority", level: "block" },
  CLOSE_TO_OTHER: { check: "authority", level: "block" },
  DELEGATE_UNLIMITED: { check: "authority", level: "block" },
  DELEGATE_SET: { check: "authority", level: "warn" },
  STAKE_AUTHORITY_CHANGED: { check: "authority", level: "block" },
  UPGRADE_AUTHORITY_CHANGED: { check: "authority", level: "block" },
  MINT_AUTHORITY_CHANGED: { check: "authority", level: "warn" },
  NONCE_AUTHORITY_CHANGED: { check: "authority", level: "warn" },
  /* nonce */
  DURABLE_NONCE: { check: "nonce", level: "warn" },
  /* recipient */
  RECIPIENT_KNOWN_THREAT: { check: "recipient", level: "block" },
  RECIPIENT_SANCTIONED: { check: "recipient", level: "block" },
  RECIPIENT_LOOKALIKE: { check: "recipient", level: "block" },
  RECIPIENT_REFUSED: { check: "recipient", level: "block" },
  RECIPIENT_FLAGGED: { check: "recipient", level: "warn" },
  RECIPIENT_NEW: { check: "recipient", level: "warn" },
  RECIPIENT_LINK: { check: "recipient", level: "warn" },
  RECIPIENT_UNREAD: { check: "recipient", level: "unknown" },
  RECIPIENT_PROGRAM: { check: "recipient", level: "info" },
  /* token */
  TOKEN_NON_TRANSFERABLE: { check: "token", level: "block" },
  TOKEN_FROZEN_ON_ARRIVAL: { check: "token", level: "block" },
  TOKEN_PAUSED: { check: "token", level: "block" },
  TOKEN_PERMANENT_DELEGATE: { check: "token", level: "warn" },
  TOKEN_TRANSFER_HOOK: { check: "token", level: "warn" },
  TOKEN_FREEZE_AUTHORITY: { check: "token", level: "warn" },
  TOKEN_MINT_AUTHORITY: { check: "token", level: "warn" },
  TOKEN_PAUSABLE: { check: "token", level: "warn" },
  TOKEN_TRANSFER_FEE: { check: "token", level: "warn" },
  TOKEN_CONCENTRATED: { check: "token", level: "warn" },
  TOKEN_UNREAD: { check: "token", level: "unknown" },
  TOKEN_FACTS_UNREAD: { check: "token", level: "unknown" },
  /* intent */
  INTENT_AMOUNT_OVER: { check: "intent", level: "block" },
  INTENT_RECIPIENT: { check: "intent", level: "block" },
  INTENT_ASSET: { check: "intent", level: "block" },
  INTENT_AMOUNT_UNDER: { check: "intent", level: "warn" },
  INTENT_NOT_RECEIVED: { check: "intent", level: "warn" },
  INTENT_UNREADABLE: { check: "intent", level: "unknown" },
  INTENT_UNCHECKED: { check: "intent", level: "unknown" },
  INTENT_MATCH: { check: "intent", level: "info" },
  /* program */
  PROGRAMS_UNKNOWN: { check: "program", level: "info" },
} as const satisfies Readonly<Record<string, Readonly<{ check: WardCheck; level: WardLevel }>>>;

export type WardReasonCode = keyof typeof WARD_REASONS;
export const WARD_REASON_CODES = Object.keys(WARD_REASONS) as WardReasonCode[];

/**
 * The unknowns that keep a verdict off `allow`: without them nothing about the transaction's effect was read. The
 * rest (a security source, the market gateway, a recipient's history) are named in the answer and counted in its
 * line, but they cannot make a transaction worse than what was read of it.
 */
export const WARD_CORE_UNKNOWNS: ReadonlySet<WardReasonCode> = new Set<WardReasonCode>([
  "LINK_NOT_READ",
  "SIMULATION_UNAVAILABLE",
  "LOOKUPS_UNREAD",
  "TOKEN_UNREAD",
  "INTENT_UNCHECKED",
  "INTENT_UNREADABLE",
]);

/** The order reasons are listed in: the heaviest first. */
export const WARD_LEVEL_RANK: Readonly<Record<WardLevel, number>> = { block: 0, warn: 1, unknown: 2, info: 3 };
