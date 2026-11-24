/**
 * The sets' three answers, the routes' whole logic with every outside thing handed in:
 *
 * - **read** — the most used sets of this network, Ryntra's own among them; open to anyone, no wallet;
 * - **save** — a creator's set, kept only with their wallet's signature over the save's text (a message, never a
 *   transaction), checked here before the store sees it;
 * - **use** — one landed Ryntra launch counted for the set it started from, once per coin, only where the launch's own
 *   numbers are the set's.
 *
 * Without the store (no database, a migration not yet applied) the read stands on Ryntra's own sets and a save says the
 * store is not open. Nothing here builds, signs or moves value; the launch itself is not touched.
 */

import { z } from "zod";

import { SNIPER_FEES, type AdvancedBounds, type AdvancedTerms } from "../../core/launch/advanced.ts";
import type { LaunchPresetId } from "../../core/venues/meteora-dbc/presets.ts";
import { setUseFeeLamports } from "./price.ts";
import {
  PRESET_CURVES,
  cleanSetName,
  rankSets,
  ryntraSetTerms,
  ryntraSets,
  sameTerms,
  saveProblems,
  setSaveText,
  setTermsOf,
  termsOfPreset,
  type CurveSet,
  type PresetCurve,
  type SetNetwork,
  type SetsResponse,
  type SetTerms,
} from "./set.ts";
import { isSetId, type SetStore, type StoreNetwork } from "./store.ts";

export const SETS_LIMIT_DEFAULT = 12;
export const SETS_LIMIT_MAX = 50;
/** A launch counts for a set only while it is this fresh — the page that started it reports it as it lands. */
export const USE_FRESH_MS = 24 * 60 * 60 * 1000;
/** How long one read of the store serves every request of an instance. */
export const TOP_CACHE_MS = 60 * 1000;

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const SetTermsSchema = z
  .object({
    curve: z.enum(["classic", "protected", "community", "micro", "own"]),
    startMarketCapUsd: z.number().finite().positive(),
    graduationMarketCapUsd: z.number().finite().positive(),
    sniperFee: z.object({ startBps: z.number().int().min(0).max(10_000), endBps: z.number().int().min(0).max(10_000), seconds: z.number().int().min(0).max(86_400) }).strict(),
    creatorTradingFeePct: z.number().finite().min(0).max(100),
  })
  .strict();

export const SetSaveRequestSchema = z
  .object({
    name: z.string().max(200),
    author: z.string().regex(BASE58_ADDRESS),
    terms: SetTermsSchema,
    issuedAt: z.string().max(40),
    signature: z.string().min(64).max(100),
  })
  .strict();
export type SetSaveRequest = z.infer<typeof SetSaveRequestSchema>;

export const SetUseRequestSchema = z.object({ mint: z.string().regex(BASE58_ADDRESS) }).strict();

/** The part of a launch's record a use is judged on. */
export type LaunchSeen = Readonly<{ cluster: string; preset: LaunchPresetId; advanced?: AdvancedTerms | null; launchedAt: string }>;

export type SetsDeps = Readonly<{
  network: Readonly<{ chain: SetNetwork; cluster: StoreNetwork }>;
  /** The presets this network serves to people. */
  served: readonly string[];
  /** The bounds of an own curve here; null — not offered. */
  bounds: AdvancedBounds | null;
  store: SetStore;
  now: () => number;
  verify: (text: string, author: string, signature: string) => boolean;
  readLaunch: (mint: string) => Promise<LaunchSeen | null>;
  env?: Readonly<Record<string, string | undefined>>;
}>;

export type Refused = Readonly<{ ok: false; code: "VALIDATION_ERROR" | "SIGNATURE_INVALID" | "UNAVAILABLE" | "LAUNCH_NOT_FOUND"; message: string }>;

/* ------------------------------------------------------------------- the read */

const TOP_CACHE = new Map<string, Readonly<{ at: number; read: Awaited<ReturnType<SetStore["top"]>> }>>();

/** The cache of the store's read — let go after a save, so its author sees the set at once. */
export function forgetTopRead(): void {
  TOP_CACHE.clear();
}

/** The most used sets here: Ryntra's own with their launches and creators' sets, at most `limit`. */
export async function listSets(deps: SetsDeps, limit: number = SETS_LIMIT_DEFAULT): Promise<SetsResponse> {
  const count = Math.max(1, Math.min(SETS_LIMIT_MAX, Math.floor(Number.isFinite(limit) ? limit : SETS_LIMIT_DEFAULT)));
  const key = deps.network.cluster;
  const cached = TOP_CACHE.get(key);
  const now = deps.now();
  let read = cached && now - cached.at < TOP_CACHE_MS ? cached.read : undefined;
  if (read === undefined) {
    read = await deps.store.top(deps.network.cluster, SETS_LIMIT_MAX);
    TOP_CACHE.set(key, { at: now, read });
  }
  const own = ryntraSets(deps.served, read?.ryntraUses ?? {});
  /* A creator's set on a curve this network does not serve is not offered here. */
  const creators = (read?.sets ?? []).filter((set) => usableHere(set.terms, deps));
  return { network: deps.network.chain, sets: rankSets([...own, ...creators], count), use: { feeLamports: setUseFeeLamports(deps.env) }, stored: read !== null };
}

function usableHere(terms: SetTerms, deps: SetsDeps): boolean {
  return terms.curve === "own" ? deps.bounds !== null : deps.served.includes(terms.curve);
}

/* ------------------------------------------------------------------- the save */

const NAME_WORDS: Readonly<Record<string, string>> = {
  REQUIRED: "A set needs a name.",
  TOO_SHORT: "The name is too short.",
  TOO_LONG: "The name is too long.",
  CHARS: "The name may hold letters, digits, spaces and . , ' & + -.",
  RESERVED: "Names starting with Ryntra are Ryntra's own.",
  BORROWED: "The name reads as a known brand or person.",
  OFFENSIVE: "Choose another name.",
};

const STORE_WORDS: Readonly<Record<string, string>> = {
  NAME_TAKEN: "A set with this name is already there.",
  SAME_TERMS: "This wallet already keeps a set with these numbers.",
  AUTHOR_FULL: "This wallet keeps as many sets as one wallet may.",
  BAD_REQUEST: "The set could not be kept.",
};

/** A creator's set kept: every rule first, then the wallet's signature over the exact text, then the store. */
export async function saveSet(deps: SetsDeps, body: SetSaveRequest): Promise<Readonly<{ ok: true; set: CurveSet }> | Refused> {
  const terms = setTermsOf(body.terms);
  if (!terms) return { ok: false, code: "VALIDATION_ERROR", message: "terms: not a set." };
  const save = { network: deps.network.chain, name: cleanSetName(body.name), author: body.author, terms, issuedAt: body.issuedAt };
  const problem = saveProblems(save, deps.bounds, deps.now())[0];
  if (problem) {
    const words = problem.field === "name" ? NAME_WORDS[problem.code] : problem.field === "issuedAt" && problem.code === "STALE" ? "The signature is too old; sign again." : `${problem.field}: ${problem.code}`;
    return { ok: false, code: "VALIDATION_ERROR", message: words ?? `${problem.field}: ${problem.code}` };
  }
  if (!usableHere(terms, deps)) return { ok: false, code: "VALIDATION_ERROR", message: "terms: this curve is not served here." };
  const message = setSaveText(save);
  if (!deps.verify(message, save.author, body.signature)) return { ok: false, code: "SIGNATURE_INVALID", message: "The signature is not this wallet's over this set." };
  const kept = await deps.store.save(deps.network.cluster, { name: save.name, author: save.author, terms, message, signature: body.signature });
  if (!kept) return { ok: false, code: "UNAVAILABLE", message: "Sets cannot be saved here yet; nothing was kept." };
  if (!kept.ok) return { ok: false, code: "VALIDATION_ERROR", message: STORE_WORDS[kept.code] ?? STORE_WORDS.BAD_REQUEST! };
  forgetTopRead();
  return { ok: true, set: kept.set };
}

/* -------------------------------------------------------------------- the use */

/** A launch's own five numbers, as its record keeps them; null for a launch no set can describe. */
export function launchTerms(record: Pick<LaunchSeen, "preset" | "advanced">): SetTerms | null {
  if ((PRESET_CURVES as readonly string[]).includes(record.preset)) return termsOfPreset(record.preset as PresetCurve);
  const own = record.preset === "advanced" ? (record.advanced ?? null) : null;
  if (!own) return null;
  const fee = SNIPER_FEES[own.sniper];
  if (!fee) return null;
  return {
    curve: "own",
    startMarketCapUsd: own.startMarketCapUsd,
    graduationMarketCapUsd: own.graduationMarketCapUsd,
    sniperFee: { startBps: fee.startBps, endBps: fee.endBps, seconds: fee.seconds },
    creatorTradingFeePct: own.creatorTradingFeePct,
  };
}

/**
 * A landed launch counted for the set it started from: a launch of this network Ryntra made within the day, whose own
 * numbers are the set's; one coin counts once, for one set.
 */
export async function countSetUse(deps: SetsDeps, id: string, mint: string): Promise<Readonly<{ ok: true; counted: boolean }> | Refused> {
  if (!isSetId(id)) return { ok: false, code: "VALIDATION_ERROR", message: "Not a set." };
  if (!BASE58_ADDRESS.test(mint)) return { ok: false, code: "VALIDATION_ERROR", message: "mint: not an address." };
  const record = await deps.readLaunch(mint).catch(() => null);
  const launched = record ? Date.parse(record.launchedAt) : Number.NaN;
  if (!record || record.cluster !== deps.network.cluster || !Number.isFinite(launched) || deps.now() - launched > USE_FRESH_MS || launched - deps.now() > 60_000) {
    return { ok: false, code: "LAUNCH_NOT_FOUND", message: "No fresh launch of this coin here." };
  }
  const terms = launchTerms(record);
  if (!terms) return { ok: true, counted: false };
  const own = ryntraSetTerms(id);
  if (own && !sameTerms(own, terms)) return { ok: true, counted: false };
  const counted = await deps.store.use(deps.network.cluster, id, mint, terms);
  if (!counted) return { ok: false, code: "UNAVAILABLE", message: "Launches from sets are not counted here yet." };
  if (counted.counted) forgetTopRead();
  return { ok: true, counted: counted.counted };
}
