/**
 * Ready launch sets — the market of curve settings other creators and launchpads start from.
 *
 * A set is a named shape of a launch on Meteora DBC with an author: the curve it stands on, the market cap at the start,
 * the market cap at which the curve moves into its pool, the fee the first buyers pay, and the creator's share of the
 * curve's fees. Ryntra's own sets are the presets people launch on; a creator's set is saved with their wallet's signature
 * over the text `setSaveText` writes — a message, never a transaction.
 *
 * Every set stays inside what Launch can build: on a preset's curve its numbers are the preset's own (a DBC config never
 * changes, so a preset has exactly one shape); on its own curve («Розширений», SOL-L5) they lie within the bounds the
 * operator approved for the network. Nothing here builds, signs or moves value.
 *
 * Pure and client-safe: the terminal's form and the server run the same rules.
 */

import { SNIPER_FEES, type AdvancedBounds, type SniperStrength } from "../../core/launch/advanced.ts";
import { launchNameHits } from "../../core/launch/moderation.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS } from "../../core/venues/meteora-dbc/presets.ts";
import { isOffensiveName } from "../../spot/offensive-names.ts";

/** The curves a set stands on: a preset people launch on, or its own numbers («Розширений»). */
export const SET_CURVES = ["classic", "protected", "community", "micro", "own"] as const;
export type SetCurve = (typeof SET_CURVES)[number];
export type PresetCurve = Exclude<SetCurve, "own">;

/** The fee the first buyers pay: from `startBps`, falling to `endBps` over `seconds`. */
export type SetSniperFee = Readonly<{ startBps: number; endBps: number; seconds: number }>;

/** The numbers of a set — the five a launch is read by. */
export type SetTerms = Readonly<{
  curve: SetCurve;
  startMarketCapUsd: number;
  graduationMarketCapUsd: number;
  sniperFee: SetSniperFee;
  /** The creator's share of the curve's fee after Meteora's 20 %, percent. */
  creatorTradingFeePct: number;
}>;

export type CurveSet = Readonly<{
  /** `ryntra-<preset>` for Ryntra's own; the store's id for a creator's. */
  id: string;
  /** As its author wrote it. */
  name: string;
  /** Ryntra's own sets carry their name in both languages; a creator's set has the one name it was saved with. */
  names: Readonly<{ uk: string; en: string }> | null;
  /** The author's wallet; null — Ryntra. */
  author: string | null;
  terms: SetTerms;
  /** Launches made from the set. */
  uses: number;
  createdAt: string | null;
}>;

export const SET_NAME_MIN = 3;
export const SET_NAME_MAX = 32;
/** Sets one wallet may keep. */
export const SETS_PER_AUTHOR = 20;
/** How old a signed save may be when it reaches the server. */
export const SAVE_FRESH_MS = 10 * 60 * 1000;
/** The prefix of Ryntra's own sets: never a creator's id, never the start of a creator's name. */
export const RYNTRA_SET_PREFIX = "ryntra-";

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const isPresetCurve = (curve: SetCurve): curve is PresetCurve => curve !== "own";

/* --------------------------------------------------------------- Ryntra's own */

/** A preset's five numbers. */
export function termsOfPreset(id: PresetCurve): SetTerms {
  const preset = LAUNCH_PRESETS[id];
  return {
    curve: id,
    startMarketCapUsd: preset.curve.startMarketCapUsd,
    graduationMarketCapUsd: preset.curve.graduationMarketCapUsd,
    sniperFee: { startBps: preset.sniperFee.startBps, endBps: preset.sniperFee.endBps, seconds: preset.sniperFee.seconds },
    creatorTradingFeePct: preset.creatorTradingFeePct,
  };
}

/** The presets a set may stand on: every one people launch on (`PEOPLE_PRESET_IDS`). */
export const PRESET_CURVES: readonly PresetCurve[] = PEOPLE_PRESET_IDS.filter((id): id is PresetCurve => (SET_CURVES as readonly string[]).includes(id));

/** Ryntra's own sets — one per preset this network serves, in the order presets are listed. */
export function ryntraSets(served: readonly string[], uses: Readonly<Record<string, number>> = {}): readonly CurveSet[] {
  return PRESET_CURVES.filter((id) => served.includes(id)).map((id) => {
    const preset = LAUNCH_PRESETS[id];
    const setId = `${RYNTRA_SET_PREFIX}${id}`;
    return { id: setId, name: preset.name.en, names: { uk: preset.name.uk, en: preset.name.en }, author: null, terms: termsOfPreset(id), uses: Math.max(0, Math.floor(uses[setId] ?? 0)), createdAt: null };
  });
}

/** Ryntra's own set by its id, whatever the network serves; null for any other id. */
export function ryntraSetTerms(id: string): SetTerms | null {
  if (!id.startsWith(RYNTRA_SET_PREFIX)) return null;
  const curve = id.slice(RYNTRA_SET_PREFIX.length);
  return (PRESET_CURVES as readonly string[]).includes(curve) ? termsOfPreset(curve as PresetCurve) : null;
}

/* ------------------------------------------------------------------- reading */

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A set's numbers from JSON — a request's body or a stored row; null for anything that is not one. */
export function setTermsOf(value: unknown): SetTerms | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const fee = v.sniperFee as Record<string, unknown> | null | undefined;
  if (typeof v.curve !== "string" || !(SET_CURVES as readonly string[]).includes(v.curve)) return null;
  if (!finite(v.startMarketCapUsd) || !finite(v.graduationMarketCapUsd) || !finite(v.creatorTradingFeePct)) return null;
  if (!fee || typeof fee !== "object" || !finite(fee.startBps) || !finite(fee.endBps) || !finite(fee.seconds)) return null;
  return {
    curve: v.curve as SetCurve,
    startMarketCapUsd: v.startMarketCapUsd,
    graduationMarketCapUsd: v.graduationMarketCapUsd,
    sniperFee: { startBps: fee.startBps, endBps: fee.endBps, seconds: fee.seconds },
    creatorTradingFeePct: v.creatorTradingFeePct,
  };
}

/** The numbers as one line — two sets with the same line are the same launch. */
export function termsKey(terms: SetTerms): string {
  const fee = terms.sniperFee;
  return [terms.curve, terms.startMarketCapUsd, terms.graduationMarketCapUsd, `${fee.startBps}-${fee.endBps}-${fee.seconds}`, terms.creatorTradingFeePct].join("|");
}

export const sameTerms = (a: SetTerms, b: SetTerms): boolean => termsKey(a) === termsKey(b);

/** Which of the two strengths a fee is, or null for a fee Launch does not build. */
export function sniperStrengthOf(fee: SetSniperFee): SniperStrength | null {
  for (const [strength, known] of Object.entries(SNIPER_FEES) as [SniperStrength, (typeof SNIPER_FEES)[SniperStrength]][]) {
    if (known.startBps === fee.startBps && known.endBps === fee.endBps && known.seconds === fee.seconds) return strength;
  }
  return null;
}

/* ------------------------------------------------------------------ the rules */

export type TermsProblem = "NOT_PRESET" | "OWN_CLOSED" | "START_CAP" | "GRADUATION_CAP" | "MULTIPLE" | "CREATOR_SHARE" | "SNIPER";

/**
 * Where a set leaves what Launch builds here, each by its code; empty — it holds. On a preset's curve the numbers must
 * be the preset's; on its own curve, within the network's bounds — null bounds mean the network offers no own curve.
 */
export function termsProblems(terms: SetTerms, bounds: AdvancedBounds | null): readonly TermsProblem[] {
  if (isPresetCurve(terms.curve)) return (PRESET_CURVES as readonly string[]).includes(terms.curve) && sameTerms(terms, termsOfPreset(terms.curve)) ? [] : ["NOT_PRESET"];
  if (!bounds) return ["OWN_CLOSED"];
  const problems: TermsProblem[] = [];
  const within = (value: number, range: Readonly<{ min: number; max: number }>) => value >= range.min && value <= range.max;
  if (!within(terms.startMarketCapUsd, bounds.startMarketCapUsd)) problems.push("START_CAP");
  if (!within(terms.graduationMarketCapUsd, bounds.graduationMarketCapUsd)) problems.push("GRADUATION_CAP");
  if (!(terms.startMarketCapUsd > 0) || !within(terms.graduationMarketCapUsd / terms.startMarketCapUsd, bounds.multiple)) problems.push("MULTIPLE");
  if (!Number.isInteger(terms.creatorTradingFeePct) || !within(terms.creatorTradingFeePct, bounds.creatorTradingFeePct)) problems.push("CREATOR_SHARE");
  const strength = sniperStrengthOf(terms.sniperFee);
  if (!strength || !bounds.snipers.includes(strength)) problems.push("SNIPER");
  return problems;
}

export type NameProblem = "REQUIRED" | "TOO_SHORT" | "TOO_LONG" | "CHARS" | "RESERVED" | "BORROWED" | "OFFENSIVE";

/** A set's name as it is kept: trimmed, one space between words. */
export const cleanSetName = (raw: string): string => raw.trim().replace(/\s+/g, " ");

/**
 * What is wrong with a set's name, or null. Letters of any language, digits, spaces and a few marks; never Ryntra's own
 * prefix, a known brand or person, or a hate word — the same guards a coin's name passes.
 */
export function setNameProblem(raw: string): NameProblem | null {
  const name = cleanSetName(raw);
  if (!name) return "REQUIRED";
  if ([...name].length < SET_NAME_MIN) return "TOO_SHORT";
  if ([...name].length > SET_NAME_MAX) return "TOO_LONG";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .,'&+-]*$/u.test(name)) return "CHARS";
  if (/^ryntra/i.test(name.replace(/[^\p{L}\p{N}]/gu, ""))) return "RESERVED";
  if (launchNameHits({ name, symbol: "" }).length > 0) return "BORROWED";
  if (isOffensiveName(name)) return "OFFENSIVE";
  return null;
}

/* --------------------------------------------------------- the signed message */

export type SetNetwork = "solana:devnet" | "solana:mainnet";

/** What a creator's wallet signs to save a set. */
export type SetSave = Readonly<{ network: SetNetwork; name: string; author: string; terms: SetTerms; issuedAt: string }>;

const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/**
 * The exact text the author's wallet signs, UTF-8: every number of the set, the wallet, the network and the time, and
 * that it moves nothing. The server writes the same text from the request and checks the signature over it.
 */
export function setSaveText(save: SetSave): string {
  const { terms } = save;
  return [
    "Ryntra: save a launch set",
    `Name: ${cleanSetName(save.name)}`,
    `Curve: ${terms.curve}`,
    `Start: $${terms.startMarketCapUsd}`,
    `Moves to a pool at: $${terms.graduationMarketCapUsd}`,
    `First buyers pay: ${percent(terms.sniperFee.startBps)} to ${percent(terms.sniperFee.endBps)} over ${terms.sniperFee.seconds} s`,
    `Creator share of fees: ${terms.creatorTradingFeePct}%`,
    `Wallet: ${save.author}`,
    `Network: ${save.network}`,
    `Issued: ${save.issuedAt}`,
    "This signature moves no money and is not a transaction.",
  ].join("\n");
}

export type SaveProblem = Readonly<{ field: "name"; code: NameProblem }> | Readonly<{ field: "terms"; code: TermsProblem }> | Readonly<{ field: "author" | "issuedAt"; code: "INVALID" | "STALE" }>;

/** Everything a save must hold before its signature is checked; empty — it holds. */
export function saveProblems(save: SetSave, bounds: AdvancedBounds | null, now: number): readonly SaveProblem[] {
  const problems: SaveProblem[] = [];
  const name = setNameProblem(save.name);
  if (name) problems.push({ field: "name", code: name });
  for (const code of termsProblems(save.terms, bounds)) problems.push({ field: "terms", code });
  if (!BASE58_ADDRESS.test(save.author)) problems.push({ field: "author", code: "INVALID" });
  const issued = Date.parse(save.issuedAt);
  if (!Number.isFinite(issued) || new Date(issued).toISOString() !== save.issuedAt) problems.push({ field: "issuedAt", code: "INVALID" });
  else if (Math.abs(now - issued) > SAVE_FRESH_MS) problems.push({ field: "issuedAt", code: "STALE" });
  return problems;
}

/** The sets' read, as `GET /api/v1/launch/presets/sets` answers it. */
export type SetsResponse = Readonly<{
  network: SetNetwork;
  sets: readonly CurveSet[];
  /** The price of starting from a set — zero until the operator sets it (`./price.ts`); the terminal never shows it. */
  use: Readonly<{ feeLamports: number }>;
  /** Whether creators' sets were read; false — Ryntra's own only. */
  stored: boolean;
}>;

/* ------------------------------------------------------------- what it changes */

export const SET_FIELDS = ["start", "graduation", "sniper", "creator"] as const;
export type SetField = (typeof SET_FIELDS)[number];

/** The numbers in which a set differs from the launch the form starts with, in the order the form reads them. */
export function setChanges(terms: SetTerms, base: SetTerms): readonly SetField[] {
  const changed: SetField[] = [];
  if (terms.startMarketCapUsd !== base.startMarketCapUsd) changed.push("start");
  if (terms.graduationMarketCapUsd !== base.graduationMarketCapUsd) changed.push("graduation");
  const a = terms.sniperFee;
  const b = base.sniperFee;
  if (a.startBps !== b.startBps || a.endBps !== b.endBps || a.seconds !== b.seconds) changed.push("sniper");
  if (terms.creatorTradingFeePct !== base.creatorTradingFeePct) changed.push("creator");
  return changed;
}

/* ---------------------------------------------------------------- the ranking */

/**
 * The most used first: Ryntra's own and creators' sets together, by launches made from them; on a tie Ryntra's own first,
 * then the newest. At most `limit`.
 */
export function rankSets(sets: readonly CurveSet[], limit: number): readonly CurveSet[] {
  const created = (set: CurveSet) => (set.createdAt ? Date.parse(set.createdAt) || 0 : 0);
  return [...sets]
    .sort((a, b) => b.uses - a.uses || Number(a.author !== null) - Number(b.author !== null) || created(b) - created(a))
    .slice(0, Math.max(0, limit));
}

/** A wallet as a short mark — its first and last four characters. */
export const shortWallet = (address: string): string => (address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);
