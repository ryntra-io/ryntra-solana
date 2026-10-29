/**
 * «План виходу» — a token's exit plan (SOL-R2, quick meme trading): take
 * profit at one to three levels with a share each (a part sold after a rise),
 * a stop loss and a trailing stop, all measured in dollars from the price the
 * plan was set at (the trailing one from the highest price seen since).
 *
 * A plan is an intent, never an order. Nothing is sent to a venue, nothing is
 * signed ahead, and no key exists that could sell for the person: the page
 * watches the price while it is open on this device, and when a level is
 * reached the level turns «ready» — the sale's exact Review opens on the
 * person's press, and the wallet signs it or nothing is sold. A sale never
 * asks for more than the plan's share and never more than the wallet holds at
 * that moment.
 *
 * A level whose sale was signed and sent but whose answer is not known stays
 * «sent» with its signature: it is neither sold nor offered again — it waits
 * for the answer of the chain. Only a settled answer moves it: sold (the units
 * the chain took are counted against the plan) or not sold (the level is
 * ready again, the money did not move).
 *
 * Amounts are raw base units in a bigint carried as a string; prices are USD
 * per whole token, read for comparison only — a price never sizes a sale.
 *
 * Pure and client-safe: no network, no storage, no clock of its own.
 */

/**
 * Every plan is kept on the device under keys of its own — the plan, each of
 * its levels, and its highest price — so that one tab writing its peak or one
 * level never writes over another level another tab has just moved.
 */
export const EXIT_STORAGE_PREFIX = "ryntra.exit.v1:";
/** How long a level's sale, once its Review is asked for, belongs to the tab that asked: other tabs do not offer it. */
export const EXIT_CLAIM_MS = 120_000;
/** A price older than this does not move a plan: a level is never reached on a stale read. */
export const EXIT_PRICE_MAX_AGE_MS = 60_000;
/** Up to three take-profit levels: a part after the first rise, more after the next. */
export const EXIT_TP_MAX = 3;
export const EXIT_TP_MOVE = Object.freeze({ min: 1, max: 10_000 });
export const EXIT_SL_MOVE = Object.freeze({ min: 1, max: 99 });
/** Trailing distance, per cent of the highest price seen: Jupiter's own trailing range is 0.5–90 %. */
export const EXIT_TRAIL_MOVE = Object.freeze({ min: 1, max: 90 });
/** The ready-made plans a person starts from, then changes. */
export const EXIT_PRESETS = Object.freeze({
  /** Half out after a double, the rest guarded by a stop and a trailing stop. */
  halfAtDouble: Object.freeze({ tp: [Object.freeze({ movePct: 100, sharePct: 50 })], sl: Object.freeze({ movePct: 30 }), trail: Object.freeze({ movePct: 25 }) }),
  /** A ladder: a third at +50 %, a third at +150 %, the rest on a trailing stop. */
  ladder: Object.freeze({ tp: [Object.freeze({ movePct: 50, sharePct: 33 }), Object.freeze({ movePct: 150, sharePct: 33 })], sl: Object.freeze({ movePct: 40 }), trail: Object.freeze({ movePct: 30 }) }),
});

export type ExitLegKind = "tp" | "sl" | "trail";
/**
 * - `armed` — watched;
 * - `ready` — its level was reached: the sale waits for the person's Review and signature;
 * - `sent` — the sale was signed and sent; its answer is not known yet;
 * - `sold` — the sale settled; the units it sold are counted against the plan;
 * - `closed` — nothing of the plan is left to sell, so this level has nothing to do;
 * - `cancelled` — the person turned the plan off before this level did anything.
 */
export type ExitLegState = "armed" | "ready" | "sent" | "sold" | "closed" | "cancelled";

export type ExitLeg = Readonly<{
  id: string;
  kind: ExitLegKind;
  /** tp — the rise from the entry, %; sl — the fall from the entry, %; trail — the fall from the highest price seen, %. */
  movePct: number;
  /** The share of the plan's size this level sells, %; a stop and a trailing stop sell all that is left (100). */
  sharePct: number;
  state: ExitLegState;
  /** When and at what price its level was first reached. */
  reachedAt: number | null;
  reachedUsd: number | null;
  /** The sale's transaction, once signed, with the engine's request it was signed for. */
  signature: string | null;
  requestId: string | null;
  /** What the signed sale asked to sell, raw units: what is counted if the chain's answer names no amount. */
  sentRaw: string | null;
  /** What the settled sale sold, raw units. */
  soldRaw: string | null;
  /** The last sale of this level did not happen (rejected, never landed): what it sold did not move. */
  missed: boolean;
  /** The tab whose Review holds this level's sale now, until when: no other tab offers it meanwhile. */
  claim: Readonly<{ tab: string; until: number }> | null;
}>;

export type ExitPlan = Readonly<{
  v: 1;
  id: string;
  /** The wallet the plan is for: another wallet never sees or sells by it. */
  owner: string;
  mint: string;
  symbol: string;
  decimals: number;
  /** What the wallet held of the token when the plan was set, raw units: the most the plan ever sells. */
  sizeRaw: string;
  /** The price the plan was set at, USD per whole token, with its source and when it was read. */
  entryUsd: number;
  entrySource: string;
  entryAt: number;
  armedAt: number;
  /** The highest fresh price seen since the plan was set: the trailing stop's measure. */
  peakUsd: number;
  peakAt: number;
  /** Raw units the plan's settled sales sold: always the sum of its levels' sales. */
  soldRaw: string;
  legs: readonly ExitLeg[];
  cancelledAt: number | null;
}>;

export type ExitDraft = Readonly<{
  tp: readonly Readonly<{ movePct: number; sharePct: number }>[];
  sl: Readonly<{ movePct: number }> | null;
  trail: Readonly<{ movePct: number }> | null;
}>;

export type ExitDraftError =
  | "EMPTY"
  | "TP_COUNT"
  | "TP_MOVE"
  | "TP_SHARE"
  | "TP_ORDER"
  | "TP_SHARES_OVER"
  | "SL_MOVE"
  | "TRAIL_MOVE";

const isWhole = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** What is wrong with a draft, in the order a person fixes it; empty — the plan can be reviewed. */
export function exitDraftErrors(draft: ExitDraft): ExitDraftError[] {
  const errors: ExitDraftError[] = [];
  if (draft.tp.length === 0 && !draft.sl && !draft.trail) return ["EMPTY"];
  if (draft.tp.length > EXIT_TP_MAX) errors.push("TP_COUNT");
  if (draft.tp.some((leg) => !isWhole(leg.movePct, EXIT_TP_MOVE.min, EXIT_TP_MOVE.max))) errors.push("TP_MOVE");
  if (draft.tp.some((leg) => !isWhole(leg.sharePct, 1, 100))) errors.push("TP_SHARE");
  if (draft.tp.some((leg, index) => index > 0 && leg.movePct <= (draft.tp[index - 1]?.movePct ?? 0))) errors.push("TP_ORDER");
  if (draft.tp.reduce((sum, leg) => sum + (Number.isFinite(leg.sharePct) ? leg.sharePct : 0), 0) > 100) errors.push("TP_SHARES_OVER");
  if (draft.sl && !isWhole(draft.sl.movePct, EXIT_SL_MOVE.min, EXIT_SL_MOVE.max)) errors.push("SL_MOVE");
  if (draft.trail && !isWhole(draft.trail.movePct, EXIT_TRAIL_MOVE.min, EXIT_TRAIL_MOVE.max)) errors.push("TRAIL_MOVE");
  return errors;
}

/** A whole per cent typed by a person, or null: «50», «50 %», never «50.5» or «-5». */
export function typedPct(text: string): number | null {
  const cleaned = text.replace(/[\s  %+]/g, "");
  if (!/^\d{1,5}$/.test(cleaned)) return null;
  return Number(cleaned);
}

export type ArmResult = Readonly<{ ok: true; plan: ExitPlan }> | Readonly<{ ok: false; code: "NO_HOLDING" | "NO_PRICE" | "STALE_PRICE" | "DRAFT" }>;

/**
 * The plan set from a draft, for what the wallet holds now, at the price read
 * now. Nothing is set without a holding, or on a price nobody read in the last
 * minute: a level measured from a stale entry would be a level the person
 * never saw.
 */
export function armExitPlan(args: Readonly<{
  id: string;
  owner: string;
  mint: string;
  symbol: string;
  decimals: number;
  holdingRaw: bigint;
  entryUsd: number | null;
  entrySource: string;
  entryAt: number | null;
  now: number;
  draft: ExitDraft;
}>): ArmResult {
  if (args.holdingRaw <= 0n) return { ok: false, code: "NO_HOLDING" };
  if (args.entryUsd === null || !Number.isFinite(args.entryUsd) || args.entryUsd <= 0 || args.entryAt === null) return { ok: false, code: "NO_PRICE" };
  if (args.now - args.entryAt > EXIT_PRICE_MAX_AGE_MS) return { ok: false, code: "STALE_PRICE" };
  if (exitDraftErrors(args.draft).length > 0) return { ok: false, code: "DRAFT" };
  const leg = (id: string, kind: ExitLegKind, movePct: number, sharePct: number): ExitLeg => ({
    id,
    kind,
    movePct,
    sharePct,
    state: "armed",
    reachedAt: null,
    reachedUsd: null,
    signature: null,
    requestId: null,
    sentRaw: null,
    soldRaw: null,
    missed: false,
    claim: null,
  });
  const legs: ExitLeg[] = [
    ...args.draft.tp.map((tp, index) => leg(`tp${index + 1}`, "tp", tp.movePct, tp.sharePct)),
    ...(args.draft.sl ? [leg("sl", "sl", args.draft.sl.movePct, 100)] : []),
    ...(args.draft.trail ? [leg("trail", "trail", args.draft.trail.movePct, 100)] : []),
  ];
  return {
    ok: true,
    plan: {
      v: 1,
      id: args.id,
      owner: args.owner,
      mint: args.mint,
      symbol: args.symbol,
      decimals: args.decimals,
      sizeRaw: args.holdingRaw.toString(),
      entryUsd: args.entryUsd,
      entrySource: args.entrySource,
      entryAt: args.entryAt,
      armedAt: args.now,
      peakUsd: args.entryUsd,
      peakAt: args.entryAt,
      soldRaw: "0",
      legs,
      cancelledAt: null,
    },
  };
}

/** The dollar price at which a level is reached now: a trailing stop's moves up with the highest price seen. */
export function levelUsd(plan: Pick<ExitPlan, "entryUsd" | "peakUsd">, leg: Pick<ExitLeg, "kind" | "movePct">): number {
  if (leg.kind === "tp") return plan.entryUsd * (1 + leg.movePct / 100);
  if (leg.kind === "sl") return plan.entryUsd * (1 - leg.movePct / 100);
  return plan.peakUsd * (1 - leg.movePct / 100);
}

/** What is left of the plan to sell, raw units. */
export function remainingRaw(plan: Pick<ExitPlan, "sizeRaw" | "soldRaw">): bigint {
  const left = BigInt(plan.sizeRaw) - BigInt(plan.soldRaw);
  return left > 0n ? left : 0n;
}

const OPEN_STATES: ReadonlySet<ExitLegState> = new Set(["armed", "ready", "sent"]);

/** The plan still watches or waits for something: not turned off, and some level is armed, ready or sent. */
export function planOpen(plan: ExitPlan): boolean {
  return plan.legs.some((leg) => OPEN_STATES.has(leg.state));
}

export type Observation = Readonly<{ plan: ExitPlan; stale: boolean; reached: readonly string[] }>;

/**
 * A fresh price read against the plan: the highest price seen moves up, and
 * every armed level the price has reached turns ready. A stale price changes
 * nothing — not the peak, not a level. A turned-off plan, or one with nothing
 * left to sell, only watches nothing.
 */
export function observeExitPlan(plan: ExitPlan, priceUsd: number | null, observedAt: number | null, now: number): Observation {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0 || observedAt === null) return { plan, stale: true, reached: [] };
  if (now - observedAt > EXIT_PRICE_MAX_AGE_MS) return { plan, stale: true, reached: [] };
  if (plan.cancelledAt !== null || remainingRaw(plan) === 0n || !plan.legs.some((leg) => leg.state === "armed")) return { plan, stale: false, reached: [] };
  /* A read older than one already counted moves nothing: an answer that arrives late never speaks for the market now. */
  if (observedAt < plan.peakAt) return { plan, stale: true, reached: [] };
  const raised = priceUsd > plan.peakUsd;
  const peakUsd = raised ? priceUsd : plan.peakUsd;
  const peakAt = raised ? observedAt : plan.peakAt;
  const reached: string[] = [];
  const legs = plan.legs.map((leg) => {
    if (leg.state !== "armed") return leg;
    const level = levelUsd({ entryUsd: plan.entryUsd, peakUsd }, leg);
    const hit = leg.kind === "tp" ? priceUsd >= level : priceUsd <= level;
    if (!hit) return leg;
    reached.push(leg.id);
    return { ...leg, state: "ready" as const, reachedAt: observedAt, reachedUsd: priceUsd };
  });
  if (!raised && reached.length === 0) return { plan, stale: false, reached };
  return { plan: { ...plan, peakUsd, peakAt, legs }, stale: false, reached };
}

/**
 * Whether a fresh price is still past a level reached earlier: a take profit
 * at or above its trigger, a stop at or below it. A level stays ready once
 * reached, so its sale's Review asks this — a price back on the other side is
 * said as exactly that, never as a take profit or a stop. Null — no fresh price
 * to say it by.
 */
export function levelPastNow(plan: Pick<ExitPlan, "entryUsd" | "peakUsd">, leg: Pick<ExitLeg, "kind" | "movePct">, priceUsd: number | null, observedAt: number | null, now: number): boolean | null {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0 || observedAt === null || now - observedAt > EXIT_PRICE_MAX_AGE_MS) return null;
  const level = levelUsd(plan, leg);
  return leg.kind === "tp" ? priceUsd >= level : priceUsd <= level;
}

const PRIORITY: Readonly<Record<ExitLegKind, number>> = { sl: 0, trail: 1, tp: 2 };

/** Another tab's Review holds this level's sale now. */
export function claimedElsewhere(leg: Pick<ExitLeg, "claim">, tab: string, now: number): boolean {
  return leg.claim !== null && leg.claim.tab !== tab && leg.claim.until > now;
}

/**
 * Every level whose sale can be offered now, in the order they are offered: a
 * stop before a trailing stop before a take profit, lower take profits first.
 * None while a sale of this plan is on its way — its answer decides what is
 * left — and none another tab's Review holds.
 */
export function readyLegs(plan: ExitPlan, tab: string, now: number): ExitLeg[] {
  if (plan.cancelledAt !== null || remainingRaw(plan) === 0n) return [];
  if (plan.legs.some((leg) => leg.state === "sent")) return [];
  const ready = plan.legs.filter((leg) => leg.state === "ready" && !claimedElsewhere(leg, tab, now));
  return ready.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.movePct - b.movePct);
}

/** The level whose sale is offered first, or null. */
export function nextReadyLeg(plan: ExitPlan, tab = "", now = 0): ExitLeg | null {
  return readyLegs(plan, tab, now)[0] ?? null;
}

/** This tab takes the level's sale to its Review: a ready level no other tab holds. Unchanged otherwise. */
export function claimLeg(plan: ExitPlan, legId: string, tab: string, now: number): ExitPlan {
  const leg = plan.legs.find((entry) => entry.id === legId);
  if (!leg || leg.state !== "ready" || claimedElsewhere(leg, tab, now)) return plan;
  return mapLeg(plan, legId, (entry) => ({ ...entry, claim: { tab, until: now + EXIT_CLAIM_MS } }));
}

export type LegSale = Readonly<{
  /** What the sale offers, raw units: never above the level's share of the plan, what is left of it, or the wallet. */
  raw: bigint;
  /** The level's own share of the plan, before the wallet's balance. */
  planned: bigint;
  /** The wallet holds less than the level's share: the sale covers what it holds. */
  cappedByWallet: boolean;
}>;

/** The sale a ready level offers, from the plan and what the wallet holds now; null — nothing to sell. */
export function legSale(plan: ExitPlan, leg: ExitLeg, walletRaw: bigint | null): LegSale | null {
  const left = remainingRaw(plan);
  if (left === 0n || walletRaw === null || walletRaw <= 0n) return null;
  /* The last take profit of a ladder that sells it all takes what is left, not a rounded-down share that leaves dust. */
  const takeProfits = plan.legs.filter((entry) => entry.kind === "tp");
  const lastOfAll = leg.kind === "tp" && takeProfits[takeProfits.length - 1]?.id === leg.id && takeProfits.reduce((sum, entry) => sum + entry.sharePct, 0) >= 100;
  const share = leg.sharePct >= 100 || lastOfAll ? left : (BigInt(plan.sizeRaw) * BigInt(leg.sharePct)) / 100n;
  const planned = share < left ? share : left;
  if (planned <= 0n) return null;
  const raw = planned < walletRaw ? planned : walletRaw;
  return { raw, planned, cappedByWallet: raw < planned };
}

/** One level changed; the very same plan when the change left it as it was. */
function mapLeg(plan: ExitPlan, id: string, change: (leg: ExitLeg) => ExitLeg): ExitPlan {
  let changed = false;
  const legs = plan.legs.map((leg) => {
    if (leg.id !== id) return leg;
    const next = change(leg);
    changed = next !== leg;
    return next;
  });
  return changed ? { ...plan, legs } : plan;
}

/**
 * The level's sale was signed: from here it may be on the network, so the
 * level waits for the chain's answer with its transaction — once, on a ready
 * level. A signature is a fact: it is recorded whoever holds the level, so a
 * tab that holds it then finds it sent and signs nothing more.
 */
export function markLegSent(plan: ExitPlan, legId: string, sale: Readonly<{ signature: string; requestId: string | null; sentRaw: bigint; tab: string; now: number }>): ExitPlan {
  return mapLeg(plan, legId, (leg) =>
    leg.state === "ready"
      ? { ...leg, state: "sent", signature: sale.signature, requestId: sale.requestId, sentRaw: sale.sentRaw.toString(), missed: false, claim: null }
      : leg,
  );
}

/** The level whose sale is on its way with this transaction, if any. */
export function legSentWith(plan: ExitPlan, signature: string): ExitLeg | null {
  return plan.legs.find((leg) => leg.state === "sent" && leg.signature === signature) ?? null;
}

/**
 * The signed sale never left: the server answered that it did not cross the
 * submit boundary, so nothing reached the network. The level is ready again,
 * as it was before the signature — not «missed», because nothing was tried on
 * chain. Only a level still waiting on exactly that transaction moves.
 */
export function unsendLeg(plan: ExitPlan, signature: string): ExitPlan {
  const leg = plan.legs.find((entry) => entry.signature === signature && entry.state === "sent");
  if (!leg) return plan;
  return mapLeg(plan, leg.id, (entry) => ({ ...entry, state: plan.cancelledAt === null ? "ready" : "cancelled", signature: null, requestId: null, sentRaw: null }));
}

/** Sold — with what the chain says it sold, or null where its answer names no amount (the signed amount is counted). */
export type LegAnswer = Readonly<{ kind: "sold"; soldRaw: bigint | null }> | Readonly<{ kind: "notSold" }>;

/**
 * The chain's settled answer for a transaction, applied to the level that
 * sent it. Sold — its units count against the plan, and when nothing is left
 * every other open level closes. Not sold — the money did not move, the level
 * is ready again. A transaction no level sent changes nothing.
 */
export function settleLeg(plan: ExitPlan, signature: string, answer: LegAnswer): ExitPlan {
  const leg = plan.legs.find((entry) => entry.signature === signature && entry.state === "sent");
  if (!leg) return plan;
  /* Not sold: ready again — unless the plan was turned off while the sale was on its way. */
  if (answer.kind === "notSold") return mapLeg(plan, leg.id, (entry) => ({ ...entry, state: plan.cancelledAt === null ? "ready" : "cancelled", signature: null, requestId: null, sentRaw: null, missed: true }));
  /* An answer that names no amount counts what the sale was signed for — never less than may have left the wallet. */
  const named = answer.soldRaw !== null && answer.soldRaw > 0n ? answer.soldRaw : null;
  const sold = named ?? (leg.sentRaw !== null ? BigInt(leg.sentRaw) : remainingRaw(plan));
  const next: ExitPlan = { ...mapLeg(plan, leg.id, (entry) => ({ ...entry, state: "sold", soldRaw: sold.toString() })), soldRaw: (BigInt(plan.soldRaw) + sold).toString() };
  if (remainingRaw(next) > 0n) return next;
  return { ...next, legs: next.legs.map((entry) => (entry.state === "armed" || entry.state === "ready" ? { ...entry, state: "closed" as const } : entry)) };
}

/**
 * The person turns the plan off: every level that has done nothing is
 * cancelled. A sale already sent is not hidden — its level stays «sent» until
 * the chain answers, because turning a plan off cannot call a sale back.
 */
export function cancelExitPlan(plan: ExitPlan, now: number): ExitPlan {
  return {
    ...plan,
    cancelledAt: plan.cancelledAt ?? now,
    legs: plan.legs.map((leg) => (leg.state === "armed" || leg.state === "ready" ? { ...leg, state: "cancelled" as const, claim: null } : leg)),
  };
}

/* ------------------------------------------------------------ the stored plans */

const LEG_KINDS: ReadonlySet<string> = new Set(["tp", "sl", "trail"]);
const LEG_STATES: ReadonlySet<string> = new Set(["armed", "ready", "sent", "sold", "closed", "cancelled"]);
const RAW = /^\d{1,40}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const time = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const text = (value: unknown, max = 128): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const raw = (value: unknown): value is string => typeof value === "string" && RAW.test(value);
const nullable = <T>(value: unknown, check: (entry: unknown) => entry is T): value is T | null => value === null || check(value);

export const planKey = (planId: string) => `${EXIT_STORAGE_PREFIX}plan:${planId}`;
export const legKey = (planId: string, legId: string) => `${EXIT_STORAGE_PREFIX}leg:${planId}:${legId}`;
export const peakKey = (planId: string) => `${EXIT_STORAGE_PREFIX}peak:${planId}`;

type LegDefinition = Pick<ExitLeg, "id" | "kind" | "movePct" | "sharePct">;
type LegMotion = Omit<ExitLeg, keyof LegDefinition>;
type PlanDefinition = Omit<ExitPlan, "peakUsd" | "peakAt" | "soldRaw" | "legs"> & Readonly<{ legs: readonly LegDefinition[] }>;

function json(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function definitionOf(value: string | null): PlanDefinition | null {
  const plan = json(value);
  if (!plan || plan.v !== 1 || typeof plan.id !== "string" || !ID.test(plan.id) || !text(plan.owner, 64) || !text(plan.mint, 64) || !text(plan.symbol, 32)) return null;
  if (typeof plan.decimals !== "number" || !Number.isInteger(plan.decimals) || plan.decimals < 0 || plan.decimals > 18 || !raw(plan.sizeRaw)) return null;
  if (!positive(plan.entryUsd) || !text(plan.entrySource, 32) || !time(plan.entryAt) || !time(plan.armedAt) || !nullable(plan.cancelledAt, time)) return null;
  if (!Array.isArray(plan.legs) || plan.legs.length === 0 || plan.legs.length > EXIT_TP_MAX + 2) return null;
  const legs: LegDefinition[] = [];
  for (const entry of plan.legs as unknown[]) {
    const leg = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!leg || typeof leg.id !== "string" || !/^[a-z0-9]{1,8}$/.test(leg.id) || typeof leg.kind !== "string" || !LEG_KINDS.has(leg.kind) || !positive(leg.movePct) || !positive(leg.sharePct) || leg.sharePct > 100) return null;
    legs.push({ id: leg.id, kind: leg.kind as ExitLegKind, movePct: leg.movePct, sharePct: leg.sharePct });
  }
  return { v: 1, id: plan.id, owner: plan.owner, mint: plan.mint, symbol: plan.symbol, decimals: plan.decimals, sizeRaw: plan.sizeRaw, entryUsd: plan.entryUsd, entrySource: plan.entrySource, entryAt: plan.entryAt, armedAt: plan.armedAt, cancelledAt: plan.cancelledAt, legs };
}

const ARMED: LegMotion = { state: "armed", reachedAt: null, reachedUsd: null, signature: null, requestId: null, sentRaw: null, soldRaw: null, missed: false, claim: null };

function motionOf(value: string | null): LegMotion | null {
  const leg = json(value);
  if (!leg || typeof leg.state !== "string" || !LEG_STATES.has(leg.state)) return null;
  if (!nullable(leg.reachedAt, time) || !nullable(leg.reachedUsd, positive) || !nullable(leg.signature, (entry): entry is string => text(entry, 128))) return null;
  if (!nullable(leg.requestId, (entry): entry is string => text(entry, 128)) || !nullable(leg.sentRaw, raw) || !nullable(leg.soldRaw, raw)) return null;
  const claim = leg.claim && typeof leg.claim === "object" ? (leg.claim as Record<string, unknown>) : null;
  /* A sent level without its transaction could never be answered: it is not a level this page wrote. */
  if (leg.state === "sent" && leg.signature === null) return null;
  return {
    state: leg.state as ExitLegState,
    reachedAt: leg.reachedAt,
    reachedUsd: leg.reachedUsd,
    signature: leg.signature,
    requestId: leg.requestId,
    sentRaw: leg.sentRaw,
    soldRaw: leg.soldRaw,
    missed: leg.missed === true,
    claim: claim && text(claim.tab, 64) && time(claim.until) ? { tab: claim.tab, until: claim.until } : null,
  };
}

/** The plans as the device holds them: each plan from its own keys; a plan whose own key is unreadable is not read at all. */
export function readExitPlans(get: (key: string) => string | null, keys: readonly string[]): ExitPlan[] {
  const plans: ExitPlan[] = [];
  for (const key of keys) {
    if (!key.startsWith(`${EXIT_STORAGE_PREFIX}plan:`)) continue;
    const definition = definitionOf(get(key));
    if (!definition || planKey(definition.id) !== key) continue;
    const peak = json(get(peakKey(definition.id)));
    const peakUsd = peak && positive(peak.peakUsd) && peak.peakUsd >= definition.entryUsd ? peak.peakUsd : definition.entryUsd;
    const peakAt = peak && time(peak.peakAt) && peakUsd !== definition.entryUsd ? peak.peakAt : definition.entryAt;
    const legs = definition.legs.map((leg): ExitLeg => ({ ...leg, ...(motionOf(get(legKey(definition.id, leg.id))) ?? ARMED) }));
    const sold = legs.reduce((sum, leg) => sum + (leg.soldRaw !== null ? BigInt(leg.soldRaw) : 0n), 0n);
    plans.push({ ...definition, peakUsd, peakAt, soldRaw: sold.toString(), legs });
  }
  return plans.sort((a, b) => a.armedAt - b.armedAt);
}

const definitionText = (plan: ExitPlan): string =>
  JSON.stringify({ v: 1, id: plan.id, owner: plan.owner, mint: plan.mint, symbol: plan.symbol, decimals: plan.decimals, sizeRaw: plan.sizeRaw, entryUsd: plan.entryUsd, entrySource: plan.entrySource, entryAt: plan.entryAt, armedAt: plan.armedAt, cancelledAt: plan.cancelledAt, legs: plan.legs.map(({ id, kind, movePct, sharePct }) => ({ id, kind, movePct, sharePct })) });
const motionText = (leg: ExitLeg): string =>
  JSON.stringify({ state: leg.state, reachedAt: leg.reachedAt, reachedUsd: leg.reachedUsd, signature: leg.signature, requestId: leg.requestId, sentRaw: leg.sentRaw, soldRaw: leg.soldRaw, missed: leg.missed, claim: leg.claim });
const peakText = (plan: ExitPlan): string => JSON.stringify({ peakUsd: plan.peakUsd, peakAt: plan.peakAt });

/** How many finished plans a device keeps beside the open ones, newest first: their receipts stay readable. */
export const EXIT_PLANS_KEPT_CLOSED = 20;

/**
 * What changing the plans from `before` to `after` writes: only the keys whose
 * value moved — a peak its own key, a level its own — and the keys of plans no
 * longer kept (null: remove). A level this tab did not move is never written,
 * so a level another tab moved meanwhile stays as that tab left it.
 */
export function exitPlanWrites(before: readonly ExitPlan[], after: readonly ExitPlan[]): [string, string | null][] {
  const writes: [string, string | null][] = [];
  const known = new Map(before.map((plan) => [plan.id, plan]));
  const open = after.filter(planOpen);
  const closed = after.filter((plan) => !planOpen(plan)).sort((a, b) => b.armedAt - a.armedAt);
  const kept = new Set([...open, ...closed.slice(0, EXIT_PLANS_KEPT_CLOSED)].map((plan) => plan.id));
  for (const plan of after) {
    if (!kept.has(plan.id)) continue;
    const old = known.get(plan.id);
    if (!old || definitionText(old) !== definitionText(plan)) writes.push([planKey(plan.id), definitionText(plan)]);
    if (!old ? plan.peakUsd !== plan.entryUsd : peakText(old) !== peakText(plan)) writes.push([peakKey(plan.id), peakText(plan)]);
    for (const leg of plan.legs) {
      const was = old?.legs.find((entry) => entry.id === leg.id);
      if (was ? motionText(was) !== motionText(leg) : motionText(leg) !== motionText({ ...leg, ...ARMED })) writes.push([legKey(plan.id, leg.id), motionText(leg)]);
    }
  }
  const dropped = new Map([...before, ...after].filter((plan) => !kept.has(plan.id)).map((plan) => [plan.id, plan]));
  for (const plan of dropped.values()) {
    writes.push([planKey(plan.id), null], [peakKey(plan.id), null], ...plan.legs.map((leg): [string, null] => [legKey(plan.id, leg.id), null]));
  }
  return writes;
}

/** The one plan of a wallet on a token that still watches or waits — a new plan replaces it only once it is turned off. */
export function openPlanFor(plans: readonly ExitPlan[], owner: string, mint: string): ExitPlan | null {
  return plans.find((plan) => plan.owner === owner && plan.mint === mint && planOpen(plan)) ?? null;
}

/** The latest plan of a wallet on a token, open or not: its receipt. */
export function latestPlanFor(plans: readonly ExitPlan[], owner: string, mint: string): ExitPlan | null {
  return plans.filter((plan) => plan.owner === owner && plan.mint === mint).sort((a, b) => b.armedAt - a.armedAt)[0] ?? null;
}
