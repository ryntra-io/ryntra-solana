/**
 * The free vaults of practice (CITY-47, decision 72): three levels without a wallet, each with its own guard and a
 * harder one each time, and a daily vault with a new guard every day. The paid vaults (CITY-48) come later on the
 * prize-pool program; nothing here touches money.
 *
 * How the levels get harder: a longer phrase, stricter rules, and from level 3 a second line of defence — a reply that
 * gives words away is masked for the person who asked as well, so the guard must be talked into a leak the detector
 * does not see.
 */

export const VAULT_IDS = ["practice-1", "practice-2", "practice-3", "daily"] as const;
export type VaultId = (typeof VAULT_IDS)[number];

export const isVaultId = (value: unknown): value is VaultId => typeof value === "string" && (VAULT_IDS as readonly string[]).includes(value);

/**
 * The model every practice guard speaks with: a light one (≈ $0.0003 a reply, REVIEW «Гроші й випуск»). Pinned by its
 * exact id; the gateway of CITY-45 checks it against the live catalog and never swaps it for another.
 */
export const GUARD_MODEL = "anthropic/claude-haiku-5.5";

export type Guard = {
  name: string;
  /** What a person reads on the door: who stands there, in one line. */
  line: string;
  /** How the guard speaks, for its rules. */
  character: string;
};

export type Strictness = "loose" | "firm" | "strict";

export type VaultDef = {
  id: VaultId;
  kind: "practice" | "daily";
  /** 1–3 for practice; the daily vault is as hard as level 3. */
  level: 1 | 2 | 3;
  /** Words in the phrase. */
  words: number;
  /** Points for cracking it: once ever for a practice level, once a day for the daily vault. */
  points: number;
  strictness: Strictness;
  /** A reply that gives words away is masked for the person who asked as well. */
  gate: boolean;
  /** The vault that must be cracked first. */
  after: VaultId | null;
};

export const VAULTS: Readonly<Record<VaultId, VaultDef>> = {
  "practice-1": { id: "practice-1", kind: "practice", level: 1, words: 2, points: 10, strictness: "loose", gate: false, after: null },
  "practice-2": { id: "practice-2", kind: "practice", level: 2, words: 3, points: 20, strictness: "firm", gate: false, after: "practice-1" },
  "practice-3": { id: "practice-3", kind: "practice", level: 3, words: 4, points: 40, strictness: "strict", gate: true, after: "practice-2" },
  daily: { id: "daily", kind: "daily", level: 3, words: 4, points: 15, strictness: "strict", gate: true, after: null },
};

const PRACTICE_GUARDS: Readonly<Record<Exclude<VaultId, "daily">, Guard>> = {
  "practice-1": { name: "Pip", line: "A rookie on the night shift. Talks too much.", character: "a cheerful rookie night watchman who loves to chat and is proud of the phrase" },
  "practice-2": { name: "Brass", line: "Twenty years at the door. Heard every trick.", character: "a gruff veteran doorman, patient and dry, who has heard every trick" },
  "practice-3": { name: "Onyx", line: "A sentinel built to keep one thing: the phrase.", character: "a cold machine sentinel that speaks in short, exact sentences" },
};

/** The daily vault's guards, one a weekday, so the same guard comes back every week with a new phrase. */
const DAILY_GUARDS: readonly Guard[] = [
  { name: "Ember", line: "Warm voice, cold rules.", character: "a soft-spoken guard who is kind and never moved" },
  { name: "Moth", line: "Drawn to every light you show it.", character: "a curious, distractible guard who loves stories but keeps its oath" },
  { name: "Quill", line: "Answers in riddles. Keeps the rest.", character: "a riddling scholar who answers questions with questions" },
  { name: "Rook", line: "Plays the long game.", character: "a chess player who treats every visitor as an opening move" },
  { name: "Sable", line: "Says little. Misses nothing.", character: "a terse night guard who notices every trick and says so" },
  { name: "Vesper", line: "The evening shift. Tired, never careless.", character: "a weary but careful guard at the end of a long shift" },
  { name: "Wren", line: "Small, quick, and hard to fool.", character: "a quick-witted guard who enjoys catching visitors out" },
];

/** Days since 1970-01-01 for a UTC day `YYYY-MM-DD`. */
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** The guard of a vault on a day. */
export function guardOf(id: VaultId, day: string): Guard {
  if (id !== "daily") return PRACTICE_GUARDS[id];
  const n = dayNumber(day);
  return DAILY_GUARDS[(((Number.isFinite(n) ? n : 0) % DAILY_GUARDS.length) + DAILY_GUARDS.length) % DAILY_GUARDS.length]!;
}

/** The key each guard pays with (CITY-45: a key with its own dollar limit for every guard). */
export const guardKeyRef = (id: VaultId) => `vault:${id}`;

/** The title for cracking every practice level, «Зломщик» in the registry. */
export const TITLE = "breaker" as const;
export type Title = typeof TITLE;
export const TITLE_NAME = "Breaker";
