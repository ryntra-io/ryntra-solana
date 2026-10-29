/**
 * Team Launch — one whole cycle of a team's launch (MOS-2; spec §7.2–§7.9, §8, PR-5, D6).
 *
 * Quick Launch is a creator alone in two to four steps and stays exactly that. Team Launch is the same market opened
 * by a team: eight steps in one column, every number whole, every rule written before the signature rather than after
 * it, and the market's own documents — the Constitution of MOS-1, its budget, the fee ledger and its chronicle — made
 * inside the steps, not on a page of their own:
 *
 * `01 Проєкт → 02 Токен → 03 Розподіл → 04 Крива → 05 Ліквідність → 06 Права → 07 Автоматика ринку → 08 Симуляція,
 * комісії, підпис`.
 *
 * What this module holds:
 * - **the steps** (`TEAM_LAUNCH_STEPS`) — each one's number and the TEAM-1 rights it needs, so a step never happens
 *   without a right and never happens unrecorded: the server opens one EXE-2 action per step, keyed by the step;
 * - **the draft** (`TeamLaunchDraft`) — the whole of the eight steps in one object: going back and forward loses
 *   nothing because nothing is kept per step;
 * - **the tokenomics** (`allocationUnits`) — whole per cent that add up to 100 and whole base units that add up to the
 *   supply exactly. Shares are never floating point and never «99,99 %»: the largest remainder takes what rounding
 *   leaves, so the sum is the supply itself;
 * - **what step 08 shows before the signature** — the simulation (`teamLaunchSimulation`), every fee as its own row
 *   (`teamLaunchFees`), the market's budget (`teamLaunchBudget`), the Constitution's fields with each one's
 *   enforcement source (`teamLaunchConstitution`) and the chronicle the market will write (`teamLaunchChronicle`);
 * - **the switch** — Team Launch is closed on every deployment until the owner says the word in the moment of the
 *   action: `RYNTRA_TEAM_LAUNCH` (`CLOSED` by default) and the wallets of `RYNTRA_TEAM_LAUNCH_WALLETS`.
 *
 * Pure and client-safe: numbers, rules and words only — no chain, no store, no clock, no signature. The form checks by
 * these rules and the server checks again by the same ones (`lib/launch/team-launch.server.ts`).
 */

import { BUDGET_RULE, BUDGET_SOURCES, type BudgetSource } from "./budget.ts";
import { CONSTITUTION_SECTIONS, DBC_PROGRAM, MARKET_CONSTITUTION_SCHEMA, MARKET_CONSTITUTION_VERSION, type ConstitutionEnforcement, type ConstitutionSection } from "./constitution.ts";
import { FEE_SHARE_TOTAL_BPS, feeShareProblems, withCreatorShare, type FeeShare } from "./fee-shares.ts";
import { termsOf, type PresetTerms } from "./preset-terms.ts";
import { LAUNCH_PRESETS, type LaunchPresetId } from "../venues/meteora-dbc/presets.ts";
import { isTeamId, type TeamPermission } from "../team/roles.ts";

/* ------------------------------------------------------------------- steps */

export const TEAM_LAUNCH_STEP_KEYS = ["project", "token", "allocation", "curve", "liquidity", "rights", "automation", "review"] as const;
export type TeamLaunchStepKey = (typeof TEAM_LAUNCH_STEP_KEYS)[number];

export type TeamLaunchStep = Readonly<{
  /** `01` … `08`, as the column numbers them. */
  n: number;
  key: TeamLaunchStepKey;
  /**
   * The TEAM-1 rights the step needs — every one of them, not the first (spec §9.2). Drafting the market is `draft`;
   * the rights the market will hold are the rules money obeys, so step 06 is `policy` and the multisig's; naming what
   * the automation may do is the market operator's `submit`; the signature itself is `sign`, and opening the market is
   * `deploy` — both of them the treasury's.
   */
  permissions: readonly TeamPermission[];
  name: Readonly<{ uk: string; en: string }>;
}>;

export const TEAM_LAUNCH_STEPS: readonly TeamLaunchStep[] = Object.freeze([
  { n: 1, key: "project", permissions: ["draft"], name: { uk: "Проєкт", en: "Project" } },
  { n: 2, key: "token", permissions: ["draft"], name: { uk: "Токен", en: "Token" } },
  { n: 3, key: "allocation", permissions: ["draft"], name: { uk: "Розподіл", en: "Allocation" } },
  { n: 4, key: "curve", permissions: ["draft"], name: { uk: "Крива", en: "Curve" } },
  { n: 5, key: "liquidity", permissions: ["draft"], name: { uk: "Ліквідність", en: "Liquidity" } },
  { n: 6, key: "rights", permissions: ["policy"], name: { uk: "Права", en: "Rights" } },
  { n: 7, key: "automation", permissions: ["submit"], name: { uk: "Автоматика ринку", en: "Market automation" } },
  { n: 8, key: "review", permissions: ["sign", "deploy"], name: { uk: "Симуляція, комісії, підпис", en: "Simulation, fees, signature" } },
]);

export const TEAM_LAUNCH_STEP_COUNT = TEAM_LAUNCH_STEPS.length;

/** The EXE-1 row every Team Launch action runs through — the row TEAM-1 left for `deploy` to be named by MOS-2. */
export const TEAM_LAUNCH_AUTHORITY = "ryntra.team-launch";

export function teamLaunchStep(n: number): TeamLaunchStep | null {
  return TEAM_LAUNCH_STEPS.find((step) => step.n === n) ?? null;
}

export function teamLaunchStepByKey(key: string): TeamLaunchStep | null {
  return TEAM_LAUNCH_STEPS.find((step) => step.key === key) ?? null;
}

/* -------------------------------------------------------------- the switch */

/**
 * «Спочатку owner/whitelist canary, потім progressive rollout»).
 * Nothing about Team Launch is open on any deployment until the owner sets `RYNTRA_TEAM_LAUNCH=open`; the canary is
 * the whitelist beside it — while `RYNTRA_TEAM_LAUNCH_WALLETS` names wallets, the server serves those and nobody else,
 * and the progressive rollout is clearing that list.
 *
 * The switch is one variable because a team's rights hang on it: a high-risk right runs through the EXE-1 row
 * `ryntra.team-launch`, and TEAM-1 never widens a row that is open to fewer than everyone (`decideTeamPermission`).
 * A second, narrower gate on the row itself would refuse the owner's own canary — so the row is either open or closed,
 * and who is served is the whitelist's question, asked per wallet.
 *
 * What that means for what a stranger can read: while the switch is closed the row reads `DISABLED` and nothing says
 * Team Launch exists. Once the owner opens it the row is open and public — `GET /api/v1/teams/{id}/check` answers for
 * `deploy` as it does for any right, because that is a question about the team's rights, not about who Team Launch
 * serves. Who is served is the whitelist's answer, and a wallet it does not name is refused word for word as a closed
 * deployment refuses, so no refusal tells anyone whether a canary is running.
 */
export const TEAM_LAUNCH_OWNER_WORD = false;

export const TEAM_LAUNCH_GATE_KEY = "RYNTRA_TEAM_LAUNCH";
export const TEAM_LAUNCH_WALLETS_KEY = "RYNTRA_TEAM_LAUNCH_WALLETS";

export type TeamLaunchGate = "CLOSED" | "OPEN";

/** The switch's position: anything but the one word below is closed, so a typo never opens a market. */
export function teamLaunchGate(env: Readonly<Record<string, string | undefined>> = {}): TeamLaunchGate {
  return env[TEAM_LAUNCH_GATE_KEY]?.trim().toUpperCase() === "OPEN" ? "OPEN" : "CLOSED";
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The canary's wallets: addresses only, duplicates and noise dropped. Empty — the list names nobody. */
export function teamLaunchWallets(env: Readonly<Record<string, string | undefined>> = {}): readonly string[] {
  const raw = env[TEAM_LAUNCH_WALLETS_KEY] ?? "";
  return Object.freeze([...new Set(raw.split(/[\s,]+/).filter((entry) => BASE58.test(entry)))]);
}

/** Whether a canary was asked for at all: the variable written, whatever it ended up naming. */
export function teamLaunchWhitelisted(env: Readonly<Record<string, string | undefined>> = {}): boolean {
  return (env[TEAM_LAUNCH_WALLETS_KEY] ?? "").trim().length > 0;
}

export type TeamLaunchServed =
  | Readonly<{ served: true; canary: boolean; whitelist: readonly string[] }>
  | Readonly<{ served: false; reason: "CLOSED" | "NOT_WHITELISTED" }>;

/**
 * Whether this deployment serves Team Launch to one wallet now. Closed is the default and says nothing of itself; with
 * the switch open and a whitelist, only the named wallets are served — the owner's own canary — and clearing the list
 * serves every member of a team whose rights allow the step. `canary` is said so a surface can draw «open to the
 * wallets named here»; a refusal never says which of the two reasons it was.
 */
export function teamLaunchServedFor(wallet: string | null, env: Readonly<Record<string, string | undefined>> = {}): TeamLaunchServed {
  if (teamLaunchGate(env) === "CLOSED") return { served: false, reason: "CLOSED" };
  /* A canary asked for fails closed: a whitelist written but naming no address serves nobody, never everybody — one
     mistyped character must not open Team Launch to every team. Clearing the variable is the rollout, not emptying it. */
  if (!teamLaunchWhitelisted(env)) return { served: true, canary: false, whitelist: [] };
  const whitelist = teamLaunchWallets(env);
  if (wallet === null || !whitelist.includes(wallet)) return { served: false, reason: "NOT_WHITELISTED" };
  return { served: true, canary: true, whitelist };
}

/* -------------------------------------------------------------- the tokenomics */

/** Spec §7.4's categories, in the order a reader meets them. */
export const ALLOCATION_CATEGORIES = ["community", "team", "investors", "treasury", "liquidity", "marketing", "partners"] as const;
export type AllocationCategory = (typeof ALLOCATION_CATEGORIES)[number];

export const ALLOCATION_CATEGORY_NAMES: Readonly<Record<AllocationCategory, Readonly<{ uk: string; en: string }>>> = Object.freeze({
  community: { uk: "Спільнота", en: "Community" },
  team: { uk: "Команда", en: "Team" },
  investors: { uk: "Інвестори", en: "Investors" },
  treasury: { uk: "Казна", en: "Treasury" },
  liquidity: { uk: "Ліквідність", en: "Liquidity" },
  marketing: { uk: "Маркетинг", en: "Marketing" },
  partners: { uk: "Партнери", en: "Partners" },
});

/** Shares are whole per cent of the supply: no row is a fraction, and `ALLOCATION_TOTAL_PCT` is the whole of it. */
export const ALLOCATION_TOTAL_PCT = 100;
/** The unlock of one row: nothing before the cliff, then evenly to the end. Both in whole days, so no row hides hours. */
export const ALLOCATION_MAX_DAYS = 10 * 365;

export type AllocationRow = Readonly<{
  category: AllocationCategory;
  /** Whole per cent of the supply. */
  pct: number;
  /** Where it goes — a wallet, or null while the team has not named one (the draft says so, the signature does not). */
  recipient: string | null;
  /** Nothing unlocks before this many whole days; `0` — unlocked at the launch. */
  cliffDays: number;
  /** Everything is unlocked by this many whole days after the launch; `0` — nothing is locked. */
  unlockDays: number;
}>;

export type AllocationUnit = Readonly<{
  category: AllocationCategory;
  pct: number;
  /** Whole base units of the mint, and the rows add up to the supply exactly. */
  unitsRaw: bigint;
  recipient: string | null;
  cliffDays: number;
  unlockDays: number;
  /** Unlocked at the launch — what circulates on day one. */
  circulating: boolean;
}>;

/**
 * The rows as whole base units of the supply. Whole per cent of a supply that does not divide by a hundred leaves a
 * remainder; it is never dropped and never split — the rows that lost most to rounding take one unit each, largest
 * remainder first, so `sum(unitsRaw) === supplyRaw` always and the shares the page shows are the shares the mint holds.
 */
export function allocationUnits(supplyRaw: bigint, rows: readonly AllocationRow[]): readonly AllocationUnit[] {
  const total = BigInt(ALLOCATION_TOTAL_PCT);
  /* A share that is not a whole per cent above zero is no share: it counts as none here, and the step refuses it. */
  const whole = (pct: number): bigint => (Number.isInteger(pct) && pct > 0 ? BigInt(pct) : 0n);
  const floors = rows.map((row) => {
    const exact = supplyRaw * whole(row.pct);
    return { row, units: exact / total, remainder: exact % total };
  });
  /* What the rows claim between them, whole: with 100 % that is the supply itself, and with less it is less — a draft
     still being filled never has the rest handed to its rows. */
  const claimed = (supplyRaw * rows.reduce((sum, row) => sum + whole(row.pct), 0n)) / total;
  let left = claimed - floors.reduce((sum, entry) => sum + entry.units, 0n);
  /* Largest remainder first; a tie goes to the row written first, so the same draft always gives the same units. */
  const order = [...floors.keys()].sort((a, b) => {
    const diff = floors[b]!.remainder - floors[a]!.remainder;
    return diff > 0n ? 1 : diff < 0n ? -1 : a - b;
  });
  for (const index of order) {
    if (left <= 0n) break;
    floors[index]!.units += 1n;
    left -= 1n;
  }
  return Object.freeze(
    floors.map(({ row, units }) =>
      Object.freeze({ category: row.category, pct: row.pct, unitsRaw: units, recipient: row.recipient, cliffDays: row.cliffDays, unlockDays: row.unlockDays, circulating: row.cliffDays === 0 && row.unlockDays === 0 }),
    ),
  );
}

/**
 * What circulates on day one and what is locked, in base units — the two halves of the supply spec §7.4 asks for.
 * Both are counted from the rows themselves, so a draft whose rows do not yet add up to 100 % says what it has rather
 * than calling the rest «locked»; once the rows hold, the two add up to the supply exactly.
 */
export function allocationSupply(supplyRaw: bigint, rows: readonly AllocationRow[]): Readonly<{ circulatingRaw: bigint; lockedRaw: bigint; units: readonly AllocationUnit[] }> {
  const units = allocationUnits(supplyRaw, rows);
  let circulating = 0n;
  let locked = 0n;
  for (const unit of units) if (unit.circulating) circulating += unit.unitsRaw;
  else locked += unit.unitsRaw;
  return Object.freeze({ circulatingRaw: circulating, lockedRaw: locked, units });
}

export const ALLOCATION_PROBLEMS = ["EMPTY", "CATEGORY_REPEATED", "PCT_NOT_WHOLE", "PCT_ZERO", "PCT_SUM", "RECIPIENT_INVALID", "CLIFF_INVALID", "UNLOCK_INVALID", "CLIFF_AFTER_UNLOCK"] as const;
export type AllocationProblem = (typeof ALLOCATION_PROBLEMS)[number];

/** Every rule of the allocation at once — a form shows them all rather than one at a time. */
export function allocationProblems(rows: readonly AllocationRow[]): readonly AllocationProblem[] {
  const problems = new Set<AllocationProblem>();
  if (rows.length === 0) problems.add("EMPTY");
  const seen = new Set<AllocationCategory>();
  let sum = 0;
  for (const row of rows) {
    if (seen.has(row.category)) problems.add("CATEGORY_REPEATED");
    seen.add(row.category);
    if (!Number.isInteger(row.pct)) problems.add("PCT_NOT_WHOLE");
    else if (row.pct <= 0) problems.add("PCT_ZERO");
    else if (row.pct > ALLOCATION_TOTAL_PCT) problems.add("PCT_SUM");
    sum += Number.isInteger(row.pct) ? row.pct : 0;
    if (row.recipient !== null && !BASE58.test(row.recipient)) problems.add("RECIPIENT_INVALID");
    if (!Number.isInteger(row.cliffDays) || row.cliffDays < 0 || row.cliffDays > ALLOCATION_MAX_DAYS) problems.add("CLIFF_INVALID");
    if (!Number.isInteger(row.unlockDays) || row.unlockDays < 0 || row.unlockDays > ALLOCATION_MAX_DAYS) problems.add("UNLOCK_INVALID");
    /* A cliff with no unlock end is a contradiction: nothing unlocks at day zero and everything is locked by it. */
    if (Number.isInteger(row.cliffDays) && Number.isInteger(row.unlockDays) && row.cliffDays > 0 && row.unlockDays < row.cliffDays) problems.add("CLIFF_AFTER_UNLOCK");
  }
  if (rows.length > 0 && sum !== ALLOCATION_TOTAL_PCT) problems.add("PCT_SUM");
  return Object.freeze([...problems]);
}

/* --------------------------------------------------------------- the draft */

/** Which of the mint's three authorities the team keeps. Keeping one is not a fault — it is a fact the Passport says. */
export type MintAuthorities = Readonly<{ mint: "revoked" | "kept"; freeze: "revoked" | "kept"; update: "revoked" | "kept" }>;

/** Step 07: what the market's automation may do once the market is on the DEX, and what stops it. */
export type MarketAutomationDraft = Readonly<{
  /** The Fee-Funded Liquidity Ladder (spec §8.5) — off unless the team turns it on. It is depth, never a price floor. */
  ladder: boolean;
  /** The most of the market's earned budget deployed at once, whole basis points; `BUDGET_RULE.deployMaxBps` is the ceiling. */
  deployedBpsMax: number;
  /** The fall within an hour, whole basis points, that stops new money going into the steps. */
  pauseOnDropBps: number;
  /** Who may stop the market by hand, beside the rules: the team's own rights say who, this names whether it is offered. */
  stopByHand: boolean;
}>;

/** Step 06: who in the team acts, and on what. */
export type RightsDraft = Readonly<{
  /** The team's Squads multisig, as the team linked it; null while it has none — step 06 then cannot be committed. */
  treasury: string | null;
  /** The wallets of the launch's fee vault beside the team: Meteora's Dynamic Fee Sharing writes them once, for ever. */
  feeShares: readonly FeeShare[];
  /** Whether the market's rules may be changed after the launch. They cannot: the Constitution is read after it, never rewritten. */
  rulesChangeable: false;
}>;

export type TeamLaunchDraft = Readonly<{
  /** The team whose launch this is (TEAM-1's id). */
  teamId: string;
  /* 01 Проєкт */
  project: Readonly<{ name: string; summary: string; website: string; x: string }>;
  /* 02 Токен */
  token: Readonly<{ name: string; symbol: string; decimals: number; supply: number; authorities: MintAuthorities }>;
  /* 03 Розподіл */
  allocation: readonly AllocationRow[];
  /* 04 Крива */
  curve: Readonly<{
    preset: LaunchPresetId;
    /** The team's first purchase, in whole base units of the pair currency it spends; `"0"` — the market opens with no trade. */
    firstBuyQuoteRaw: string;
    /** How long the first purchase is locked, in whole days; the preset's own minimum is the floor. */
    firstBuyLockDays: number;
  }>;
  /* 05 Ліквідність */
  liquidity: Readonly<{ lpLockedForEver: true; budgetSources: readonly BudgetSource[] }>;
  /* 06 Права */
  rights: RightsDraft;
  /* 07 Автоматика ринку */
  automation: MarketAutomationDraft;
}>;

export const EMPTY_TEAM_LAUNCH_DRAFT: TeamLaunchDraft = Object.freeze({
  teamId: "",
  project: { name: "", summary: "", website: "", x: "" },
  token: { name: "", symbol: "", decimals: 6, supply: 1_000_000_000, authorities: { mint: "revoked", freeze: "revoked", update: "revoked" } },
  allocation: [],
  curve: { preset: "classic", firstBuyQuoteRaw: "0", firstBuyLockDays: 0 },
  liquidity: { lpLockedForEver: true, budgetSources: ["migration", "surplus"] },
  rights: { treasury: null, feeShares: [], rulesChangeable: false },
  automation: { ladder: false, deployedBpsMax: BUDGET_RULE.deployMaxBps, pauseOnDropBps: BUDGET_RULE.dropStopBps, stopByHand: true },
} as const);

/** The supply in whole base units: whole tokens by the mint's decimals, so no fraction of a unit exists anywhere. */
export function supplyRawOf(token: Readonly<{ supply: number; decimals: number }>): bigint {
  return BigInt(token.supply) * 10n ** BigInt(token.decimals);
}

/* ------------------------------------------------------- a step's problems */

export const TEAM_LAUNCH_PROBLEMS = [
  "TEAM_MISSING",
  "NAME",
  "SUMMARY",
  "WEBSITE",
  "X",
  "TOKEN_NAME",
  "SYMBOL",
  "DECIMALS",
  "SUPPLY",
  "AUTHORITY_KEPT_UNDECLARED",
  "ALLOCATION",
  "RECIPIENTS_MISSING",
  "PRESET",
  "FIRST_BUY",
  "FIRST_BUY_LOCK",
  "BUDGET_SOURCES",
  "NO_TREASURY",
  "FEE_SHARES",
  "FEE_SHARES_PRESET",
  "LADDER_SHARE",
  "PAUSE_DROP",
  "STEPS_BEFORE",
] as const;
export type TeamLaunchProblem = (typeof TEAM_LAUNCH_PROBLEMS)[number];

/**
 * The presets whose launch writes a vault of the creator's fees (`lib/launch/flow.server.ts`): «Спільнота» only. On
 * any other one a split named here could not be created, so step 06 refuses it rather than letting the review promise it.
 */
export const FEE_SHARE_PRESETS: readonly LaunchPresetId[] = Object.freeze(["community"]);

/** A kept mint or freeze authority needs a statement of its own, not the line a project with none may give. */
export const AUTHORITY_KEPT_SUMMARY_MIN = 80;

const RAW = /^(0|[1-9][0-9]*)$/;
const SYMBOL = /^[A-Z0-9]{2,10}$/;
const HTTPS = /^https:\/\/[^\s]{4,200}$/;
const X_HANDLE = /^@?[A-Za-z0-9_]{1,15}$/;

/** The problems of one step, every one of them at once. An empty list is a step that may be committed. */
export function teamLaunchStepProblems(key: TeamLaunchStepKey, draft: TeamLaunchDraft): readonly TeamLaunchProblem[] {
  const problems = new Set<TeamLaunchProblem>();
  const preset = LAUNCH_PRESETS[draft.curve.preset] ?? null;
  switch (key) {
    case "project": {
      if (!isTeamId(draft.teamId)) problems.add("TEAM_MISSING");
      const name = draft.project.name.trim();
      if (name.length < 2 || name.length > 64) problems.add("NAME");
      if (draft.project.summary.trim().length < 16 || draft.project.summary.trim().length > 600) problems.add("SUMMARY");
      if (draft.project.website.length > 0 && !HTTPS.test(draft.project.website.trim())) problems.add("WEBSITE");
      if (draft.project.x.length > 0 && !X_HANDLE.test(draft.project.x.trim())) problems.add("X");
      break;
    }
    case "token": {
      if (draft.token.name.trim().length < 2 || draft.token.name.trim().length > 32) problems.add("TOKEN_NAME");
      if (!SYMBOL.test(draft.token.symbol.trim())) problems.add("SYMBOL");
      if (!Number.isInteger(draft.token.decimals) || draft.token.decimals < 0 || draft.token.decimals > 9) problems.add("DECIMALS");
      if (!Number.isInteger(draft.token.supply) || draft.token.supply < 1 || draft.token.supply > 1_000_000_000_000) problems.add("SUPPLY");
      /*
       * A kept mint or freeze authority is the issuer's control over everybody's tokens. The Passport says it either
       * way (spec §7.8), so the project must stand behind it: a statement of its own rather than a line, and a public
       * place — a site or an X account — where the issuer can be asked about it.
       */
      if (draft.token.authorities.mint === "kept" || draft.token.authorities.freeze === "kept") {
        const answerable = draft.project.website.trim().length > 0 || draft.project.x.trim().length > 0;
        if (draft.project.summary.trim().length < AUTHORITY_KEPT_SUMMARY_MIN || !answerable) problems.add("AUTHORITY_KEPT_UNDECLARED");
      }
      break;
    }
    case "allocation": {
      if (allocationProblems(draft.allocation).length > 0) problems.add("ALLOCATION");
      break;
    }
    case "curve": {
      if (preset === null) problems.add("PRESET");
      /* A whole number of base units, nothing else: a fraction of a unit does not exist on the chain. */
      if (!RAW.test(draft.curve.firstBuyQuoteRaw) || draft.curve.firstBuyQuoteRaw.length > 40) problems.add("FIRST_BUY");
      if (!Number.isInteger(draft.curve.firstBuyLockDays) || draft.curve.firstBuyLockDays < 0 || draft.curve.firstBuyLockDays > ALLOCATION_MAX_DAYS) problems.add("FIRST_BUY_LOCK");
      /* The preset's own minimum lock holds over a purchase there is: a market opened with no trade of the team's own
         has nothing to lock. */
      else if (preset !== null && preset.creatorLockMinDays !== null && draft.curve.firstBuyQuoteRaw !== "0" && draft.curve.firstBuyLockDays < preset.creatorLockMinDays) problems.add("FIRST_BUY_LOCK");
      break;
    }
    case "liquidity": {
      if (draft.liquidity.budgetSources.length === 0) problems.add("BUDGET_SOURCES");
      if (draft.liquidity.budgetSources.some((source) => !(BUDGET_SOURCES as readonly string[]).includes(source))) problems.add("BUDGET_SOURCES");
      break;
    }
    case "rights": {
      /* A high-risk right runs through the team's own Squads multisig: with none there is nothing to approve the launch. */
      const treasury = draft.rights.treasury !== null && BASE58.test(draft.rights.treasury) ? draft.rights.treasury : null;
      if (treasury === null) problems.add("NO_TREASURY");
      if (draft.rights.feeShares.length > 0) {
        /* Only «Спільнота» writes a vault of the creator's fees (`lib/launch/flow.server.ts`): on any other preset the
           launch could not carry the split the review would promise. */
        if (!FEE_SHARE_PRESETS.includes(draft.curve.preset)) problems.add("FEE_SHARES_PRESET");
        /* The program's own rule, by the one function that holds it — the creator's row included, as the vault is written. */
        if (treasury === null || feeShareProblems(treasury, withCreatorShare(treasury, draft.rights.feeShares)).length > 0) problems.add("FEE_SHARES");
      }
      break;
    }
    case "automation": {
      if (!Number.isInteger(draft.automation.deployedBpsMax) || draft.automation.deployedBpsMax < 1 || draft.automation.deployedBpsMax > BUDGET_RULE.deployMaxBps) problems.add("LADDER_SHARE");
      if (!Number.isInteger(draft.automation.pauseOnDropBps) || draft.automation.pauseOnDropBps < 1 || draft.automation.pauseOnDropBps > BUDGET_RULE.dropStopBps) problems.add("PAUSE_DROP");
      break;
    }
    case "review": {
      /* Nothing is simulated, let alone signed, over a step that does not hold: the review is the seven steps together. */
      for (const step of TEAM_LAUNCH_STEPS) {
        if (step.key === "review") continue;
        if (teamLaunchStepProblems(step.key, draft).length > 0) problems.add("STEPS_BEFORE");
      }
      /* A draft may leave a recipient unnamed; the signature may not — the mint sends the supply somewhere. */
      if (draft.allocation.some((row) => row.recipient === null || !BASE58.test(row.recipient))) problems.add("RECIPIENTS_MISSING");
      break;
    }
  }
  return Object.freeze([...problems]);
}

/**
 * What a step's own record is keyed by — the part of the draft the step owns, so re-committing a step the team did not
 * touch replays its one `actionId` rather than opening a second action, while a step whose own fields changed opens a
 * new one. Step 08 owns the whole draft: the signature is over everything.
 */
export function teamLaunchStepSubject(key: TeamLaunchStepKey, draft: TeamLaunchDraft): unknown {
  const of = { team: draft.teamId, step: key };
  switch (key) {
    case "project":
      return { ...of, project: draft.project };
    case "token":
      return { ...of, token: draft.token };
    case "allocation":
      return { ...of, allocation: draft.allocation };
    case "curve":
      return { ...of, curve: draft.curve };
    case "liquidity":
      return { ...of, liquidity: draft.liquidity };
    case "rights":
      return { ...of, rights: draft.rights };
    case "automation":
      return { ...of, automation: draft.automation };
    case "review":
      return { ...of, draft };
  }
}

/** What a step would spend: nothing while the market is a draft, and on step 08 the team's own first purchase. */
export function stepSpendRaw(key: TeamLaunchStepKey, draft: TeamLaunchDraft): string {
  return key === "review" ? draft.curve.firstBuyQuoteRaw : "0";
}

/** Which steps hold — what the column marks done, and whether step 08 may be opened at all. */
export function teamLaunchProgress(draft: TeamLaunchDraft): Readonly<{ done: ReadonlySet<TeamLaunchStepKey>; ready: boolean }> {
  const done = new Set<TeamLaunchStepKey>();
  for (const step of TEAM_LAUNCH_STEPS) if (teamLaunchStepProblems(step.key, draft).length === 0) done.add(step.key);
  return Object.freeze({ done, ready: done.has("review") });
}

/* ------------------------------------------------------- step 08: the fees */

/** Where one fee's share goes. `budget` — Ryntra's part is the market's own budget, not Ryntra's revenue. */
export type FeePartyKind = "creator" | "team" | "ryntra" | "meteora" | "budget" | "pool" | "positions";

export type FeeLine = Readonly<{
  /** `curve` — every trade on the curve; `graduation` — once, at the move to the DEX; `pool` — every trade after it. */
  when: "curve" | "graduation" | "pool";
  key: string;
  name: Readonly<{ uk: string; en: string }>;
  /** Basis points of the fee this row divides; `ofBps` says of what. */
  bps: number;
  party: FeePartyKind;
  /** Of what the row's `bps` are: the trade's fee, the amount the curve raised, the liquidity moving to the pool. */
  of: "fee" | "raised" | "liquidity";
}>;

const line = (when: FeeLine["when"], key: string, uk: string, en: string, bps: number, party: FeePartyKind, of: FeeLine["of"]): FeeLine =>
  Object.freeze({ when, key, name: Object.freeze({ uk, en }), bps, party, of });

/**
 * Every fee of the launch as its own row — what step 08 shows before the signature (spec §7.7): nothing summed into
 * «≈ 40 %», nothing counted twice, each row naming of what it is a share. The numbers are the preset's own terms
 * (`preset-terms.ts`), which read them from the config Meteora's programs hold.
 */
export function teamLaunchFees(terms: PresetTerms): readonly FeeLine[] {
  const rows: FeeLine[] = [
    line("curve", "curve.creator", "Комісія кривої — творцю", "Curve fee — to the creator", terms.curve.split.creatorBps, "creator", "fee"),
    line("curve", "curve.ryntra", "Комісія кривої — Ryntra", "Curve fee — to Ryntra", terms.curve.split.ryntraBps, "ryntra", "fee"),
    line("curve", "curve.meteora", "Комісія кривої — Meteora", "Curve fee — to Meteora", terms.curve.split.meteoraBps, "meteora", "fee"),
    line("graduation", "graduation.fee", "Комісія виходу на DEX — із зібраного", "Graduation fee — of what the curve raised", terms.graduation.feeBps, "pool", "raised"),
    line("graduation", "graduation.creator", "Комісія виходу на DEX — творцю", "Graduation fee — to the creator", terms.graduation.creatorBps, "creator", "fee"),
    line(
      "graduation",
      "graduation.ryntra",
      terms.graduation.toBudget ? "Комісія виходу на DEX — у бюджет ринку" : "Комісія виходу на DEX — Ryntra",
      terms.graduation.toBudget ? "Graduation fee — to the market's budget" : "Graduation fee — to Ryntra",
      terms.graduation.ryntraBps,
      terms.graduation.toBudget ? "budget" : "ryntra",
      "fee",
    ),
    line("graduation", "graduation.meteora", "Ліквідність у пул — частка Meteora", "Liquidity into the pool — Meteora's part", terms.graduation.meteoraLiquidityBps, "meteora", "liquidity"),
    line("pool", "pool.meteora", "Комісія пулу — Meteora", "Pool fee — to Meteora", terms.pool.meteoraBps, "meteora", "fee"),
    line("pool", "pool.compounding", "Комісія пулу — назад у ліквідність", "Pool fee — compounded into the pool", terms.pool.compoundingBps, "pool", "fee"),
    line("pool", "pool.positions", "Комісія пулу — позиціям пулу", "Pool fee — to the pool's positions", terms.pool.positionsBps, "positions", "fee"),
  ];
  return Object.freeze(rows);
}

/** The rows of one moment add up to the whole of what they divide — the check a page never has to repeat. */
export function feeLinesHold(rows: readonly FeeLine[]): boolean {
  for (const when of ["curve", "pool"] as const) {
    const sum = rows.filter((row) => row.when === when && row.of === "fee").reduce((total, row) => total + row.bps, 0);
    if (sum !== FEE_SHARE_TOTAL_BPS) return false;
  }
  const graduation = rows.filter((row) => row.when === "graduation" && row.of === "fee").reduce((total, row) => total + row.bps, 0);
  return graduation === FEE_SHARE_TOTAL_BPS;
}

/* -------------------------------------------------- step 08: the simulation */

export type TeamLaunchSimulation = Readonly<{
  preset: LaunchPresetId;
  /** The mint's whole supply in base units, and the two halves of it on day one. */
  supplyRaw: bigint;
  circulatingRaw: bigint;
  lockedRaw: bigint;
  /** The rows as whole base units: `sum(unitsRaw) === supplyRaw`. */
  allocation: readonly AllocationUnit[];
  /** The market cap in dollars the curve opens at and moves to the DEX at — the preset's own curve. */
  startMarketCapUsd: number;
  graduationMarketCapUsd: number;
  /** The pair currency the curve must raise before the move to the DEX, where the preset is named by it; null — by its market cap. */
  graduationQuote: number | null;
  /** The team's first purchase, in base units of the pair currency it spends. */
  firstBuyQuoteRaw: bigint;
  /** The most of the supply that first purchase may receive — the preset's own rule, in base units of the token. */
  firstBuyCapRaw: bigint;
  /** The fee the first buyers pay: from `startBps` falling to `endBps` over `seconds`. */
  sniperFee: Readonly<{ startBps: number; endBps: number; seconds: number }>;
  /** The two locked positions the move to the DEX opens, in per cent of the liquidity that moves. */
  exitLiquidity: Readonly<{ creatorPct: number; ryntraPct: number }>;
  /** Of the dilution spec §7.4 asks for: what a day-one holder's share becomes once everything has unlocked. */
  dilutionBps: number;
}>;

/**
 * What step 08 simulates — the launch as the chain will hold it, from the draft and the preset's terms alone. No price
 * is promised anywhere: the curve's market caps are the config's own, and the dilution is arithmetic, not a forecast.
 */
export function teamLaunchSimulation(draft: TeamLaunchDraft, terms: PresetTerms): TeamLaunchSimulation {
  const supplyRaw = supplyRawOf(draft.token);
  const { circulatingRaw, lockedRaw, units } = allocationSupply(supplyRaw, draft.allocation);
  const preset = LAUNCH_PRESETS[draft.curve.preset];
  const firstBuyCapRaw = (supplyRaw * BigInt(preset.creatorFirstBuyCapBps)) / BigInt(FEE_SHARE_TOTAL_BPS);
  /* A share of the circulating supply on day one becomes this share of the whole once every lock has opened. */
  const dilutionBps = circulatingRaw === 0n ? 0 : Number((circulatingRaw * BigInt(FEE_SHARE_TOTAL_BPS)) / supplyRaw);
  return Object.freeze({
    preset: draft.curve.preset,
    supplyRaw,
    circulatingRaw,
    lockedRaw,
    allocation: units,
    startMarketCapUsd: terms.curve.startMarketCapUsd,
    graduationMarketCapUsd: terms.curve.graduationMarketCapUsd,
    graduationQuote: terms.curve.graduationQuote,
    firstBuyQuoteRaw: BigInt(draft.curve.firstBuyQuoteRaw),
    firstBuyCapRaw,
    sniperFee: terms.curve.sniperFee,
    exitLiquidity: terms.exitLiquidity,
    dilutionBps,
  });
}

/* ----------------------------------------------------- the market's budget */

export type TeamLaunchBudget = Readonly<{
  /** Where the money may come from, as the team chose in step 05 — collected fees only, never anybody else's. */
  sources: readonly BudgetSource[];
  /** Ryntra's executor's share of the curve's and the locked position's fees that goes to the budget; null — the preset has no budget. */
  feeShareBps: number | null;
  /**
   * Whether anything funds this market's budget on this preset: only where Ryntra's executor holds the partner's role
   * does it claim the fees the ladder stands on. False — the ladder does not run whatever step 07 says, and nothing
   * here or in the Constitution promises it.
   */
  fundable: boolean;
  /** The most of what the budget earned that stands in the steps at once, whole basis points. */
  deployedBpsMax: number;
  /** The least one step holds, in whole base units of the budget's pair currency, and the most steps the ladder has. */
  minStepRaw: bigint;
  maxSteps: number;
  /** What stops new money going into the steps, whole basis points of a fall within an hour. */
  pauseOnDropBps: number;
  /** Whether the ladder runs at all: off unless the team turned it on in step 07. */
  ladder: boolean;
  /** Said in the step, not in a footnote: the ladder is depth that can be eaten, never a floor under the price. */
  notAFloor: true;
}>;

/**
 * Whether the ladder runs at all: the team has to turn it on *and* something has to fund it. On a preset whose
 * partner is the multisig there is no market budget for Ryntra's executor to claim (`preset-terms.ts`), so the ladder
 * does not run — and neither the budget, nor the Constitution, nor the chronicle says it does.
 */
export function ladderRuns(draft: TeamLaunchDraft, terms: PresetTerms): boolean {
  return draft.automation.ladder && budgetFundable(terms);
}

/**
 * Whether anything funds this market's budget now. Two things have to hold: Ryntra's executor must hold the partner's
 * role on the preset at all (`terms.budget`), and it must actually be claiming it on this kind of market — while
 * Ryntra's operator keeps people's markets closed the fees wait in Meteora's pool and the ladder has
 * nothing to stand on (`terms.budget.waitsInPool`). Either way the answer here is «not now», never a promise.
 */
export function budgetFundable(terms: PresetTerms): boolean {
  return terms.budget !== null && !terms.budget.waitsInPool;
}

/**
 * The market's budget as step 05 and step 07 set it, bounded by `BUDGET_RULE` — the same rule the executor obeys, so
 * the step never offers a market something the executor would refuse.
 */
export function teamLaunchBudget(draft: TeamLaunchDraft, terms: PresetTerms): TeamLaunchBudget {
  return Object.freeze({
    sources: draft.liquidity.budgetSources,
    feeShareBps: terms.budget?.feeShareBps ?? null,
    fundable: budgetFundable(terms),
    deployedBpsMax: Math.min(draft.automation.deployedBpsMax, BUDGET_RULE.deployMaxBps),
    minStepRaw: BUDGET_RULE.minStepRaw,
    maxSteps: BUDGET_RULE.maxSteps,
    pauseOnDropBps: Math.min(draft.automation.pauseOnDropBps, BUDGET_RULE.dropStopBps),
    ladder: ladderRuns(draft, terms),
    notAFloor: true,
  });
}

/* --------------------------------------------- the Constitution in the step */

export type ConstitutionDraftField = Readonly<{
  section: ConstitutionSection;
  key: string;
  /** What the draft says, as a line a person reads; null — the team has not named it yet. */
  value: string | null;
  /** Spec §8.2: what makes the field hold — the program, Ryntra's server, a statement, or nothing yet. */
  enforcement: ConstitutionEnforcement;
}>;

const field = (section: ConstitutionSection, key: string, value: string | null, enforcement: ConstitutionEnforcement): ConstitutionDraftField => Object.freeze({ section, key, value, enforcement });

/**
 * The Market Constitution (MOS-1) as the draft fills it — inside the steps, not on a page of its own. It is the
 * document's shape and its enforcement grades, written from the draft: a field the team has not named reads null
 * rather than zero, and nothing here claims the chain was read. The signed document itself is MOS-1's own
 * `buildMarketConstitution`, built from the accounts once the market exists.
 */
export function teamLaunchConstitution(draft: TeamLaunchDraft, terms: PresetTerms): readonly ConstitutionDraftField[] {
  const supplyRaw = supplyRawOf(draft.token);
  const { circulatingRaw, lockedRaw } = allocationSupply(supplyRaw, draft.allocation);
  const authorities = `mint: ${draft.token.authorities.mint}, freeze: ${draft.token.authorities.freeze}, update: ${draft.token.authorities.update}`;
  return Object.freeze([
    field("issuer", "team", draft.teamId.length > 0 ? draft.teamId : null, "SERVER_POLICY"),
    field("issuer", "treasury", draft.rights.treasury, "ONCHAIN_RULE"),
    field("issuer", "project", draft.project.name.trim() || null, "INFORMATIONAL"),
    field("token", "symbol", draft.token.symbol.trim() || null, "ONCHAIN_RULE"),
    field("token", "decimals", String(draft.token.decimals), "ONCHAIN_RULE"),
    field("token", "program", DBC_PROGRAM, "ONCHAIN_RULE"),
    field("token", "authorities", authorities, "ONCHAIN_RULE"),
    field("distribution", "total", supplyRaw.toString(10), "ONCHAIN_RULE"),
    field("distribution", "circulating", circulatingRaw.toString(10), "SERVER_POLICY"),
    field("distribution", "locked", lockedRaw.toString(10), "SERVER_POLICY"),
    field("curve", "preset", draft.curve.preset, "ONCHAIN_RULE"),
    field("curve", "startMarketCapUsd", String(terms.curve.startMarketCapUsd), "ONCHAIN_RULE"),
    field("migration", "target", "DAMM_V2", "ONCHAIN_RULE"),
    field("lp", "locked", draft.liquidity.lpLockedForEver ? "forever" : "unlocked", "ONCHAIN_RULE"),
    field("fees", "curveCreatorBps", String(terms.curve.split.creatorBps), "ONCHAIN_RULE"),
    /* Every row of the vault as the program will write it — the creator's own row, which takes what nobody else does, among them. */
    field(
      "recipients",
      "feeVault",
      draft.rights.feeShares.length > 0 && draft.rights.treasury !== null
        ? withCreatorShare(draft.rights.treasury, draft.rights.feeShares)
            .map((share) => `${share.address}:${share.bps}`)
            .join(" ")
        : null,
      "ONCHAIN_RULE",
    ),
    field("budget", "sources", draft.liquidity.budgetSources.join(" ") || null, "SERVER_POLICY"),
    field("operations", "ladder", ladderRuns(draft, terms) ? "on" : "off", "SERVER_POLICY"),
    field("limits", "deployedBpsMax", String(Math.min(draft.automation.deployedBpsMax, BUDGET_RULE.deployMaxBps)), "SERVER_POLICY"),
    field("stops", "dropBps", String(Math.min(draft.automation.pauseOnDropBps, BUDGET_RULE.dropStopBps)), "SERVER_POLICY"),
    field("stops", "byHand", draft.automation.stopByHand ? "team" : "rules only", "SERVER_POLICY"),
    field("changelog", "rulesChangeable", "no", "SERVER_POLICY"),
    field("channels", "incidents", null, "NOT_IMPLEMENTED"),
    field("anchor", "schema", `${MARKET_CONSTITUTION_SCHEMA} v${MARKET_CONSTITUTION_VERSION}`, "SERVER_POLICY"),
    field("price", "promise", "none", "INFORMATIONAL"),
  ] satisfies readonly ConstitutionDraftField[]);
}

/** Every section the draft touches is a section the Constitution knows — the check the tests hold. */
export function constitutionSectionsKnown(rows: readonly ConstitutionDraftField[]): boolean {
  return rows.every((row) => (CONSTITUTION_SECTIONS as readonly string[]).includes(row.section));
}

/* ------------------------------------------------------ the market's chronicle */

export type ChronicleRow = Readonly<{
  key: string;
  name: Readonly<{ uk: string; en: string }>;
  /** Who writes the row: the team's signature, the venue's own program, or Ryntra's executor. */
  by: "team" | "venue" | "executor";
  /** `NOT_IMPLEMENTED` — the row is in the chronicle's shape and nothing writes it yet; said as that, never as done. */
  enforcement: ConstitutionEnforcement;
}>;

const chronicle = (key: string, uk: string, en: string, by: ChronicleRow["by"], enforcement: ConstitutionEnforcement): ChronicleRow => Object.freeze({ key, name: Object.freeze({ uk, en }), by, enforcement });

/**
 * The market's chronicle as the wizard promises it (spec §8.3, §8.6) — the rows the market will write, each with who
 * writes it and whether anything writes it yet. Shown in step 07 beside the automation, so the team sees what the
 * market records before it signs, not after.
 */
export function teamLaunchChronicle(draft: TeamLaunchDraft, terms: PresetTerms): readonly ChronicleRow[] {
  const rows: ChronicleRow[] = [
    chronicle("CREATED", "Ринок створено", "Market created", "team", "ONCHAIN_RULE"),
    chronicle("ON_CURVE", "Угоди на кривій", "Trades on the curve", "venue", "ONCHAIN_RULE"),
    chronicle("READY_TO_GRADUATE", "Крива зібрала поріг", "The curve raised its threshold", "venue", "ONCHAIN_RULE"),
    chronicle("GRADUATING", "Вихід на DEX", "Moving to the DEX", "venue", "ONCHAIN_RULE"),
    chronicle("ON_DEX", "Пул на DEX, LP замкнено", "The DEX pool, its LP locked", "venue", "ONCHAIN_RULE"),
    chronicle("FEES", "Облік комісій", "The fee ledger", "executor", "SERVER_POLICY"),
    chronicle("BUDGET", "Бюджет ринку поповнено", "The market's budget topped up", "executor", "SERVER_POLICY"),
  ];
  if (ladderRuns(draft, terms)) rows.push(chronicle("LIQUIDITY_REBALANCING", "Драбину переставлено", "The ladder moved", "executor", "SERVER_POLICY"));
  rows.push(chronicle("PAUSED", "Пауза за межею", "Paused by a bound", "executor", "SERVER_POLICY"));
  if (draft.automation.stopByHand) rows.push(chronicle("STOPPED_BY_TEAM", "Зупинено командою", "Stopped by the team", "team", "SERVER_POLICY"));
  rows.push(chronicle("INCIDENTS", "Інциденти й спори", "Incidents and disputes", "team", "NOT_IMPLEMENTED"));
  return Object.freeze(rows);
}

/* ------------------------------------------------------------ the whole review */

export type TeamLaunchReview = Readonly<{
  simulation: TeamLaunchSimulation;
  fees: readonly FeeLine[];
  budget: TeamLaunchBudget;
  constitution: readonly ConstitutionDraftField[];
  chronicle: readonly ChronicleRow[];
  /** The problems left; step 08 signs nothing while this is not empty. */
  problems: readonly TeamLaunchProblem[];
}>;

/**
 * Step 08 in one call: the simulation, every fee as its own row, the budget, the Constitution and the chronicle.
 * `peopleServed` — whether Ryntra's executor claims the market's budget on people's markets on this network now
 * (SOL-L6, the operator's own switch): unknown is read as «not now», so the ladder is never promised on a guess.
 */
export function teamLaunchReview(draft: TeamLaunchDraft, options: Readonly<{ peopleServed?: boolean }> = {}): TeamLaunchReview {
  const preset = LAUNCH_PRESETS[draft.curve.preset] ?? LAUNCH_PRESETS.classic;
  const terms = termsOf(preset, options);
  return Object.freeze({
    simulation: teamLaunchSimulation({ ...draft, curve: { ...draft.curve, preset: preset.id } }, terms),
    fees: teamLaunchFees(terms),
    budget: teamLaunchBudget(draft, terms),
    constitution: teamLaunchConstitution(draft, terms),
    chronicle: teamLaunchChronicle(draft, terms),
    problems: teamLaunchStepProblems("review", draft),
  });
}
