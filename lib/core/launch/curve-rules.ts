/**
 * «Правила на кривій» — the one set of Token-2022 transfer-hook rules Ryntra allows on a launch's curve.
 *
 * A transfer hook runs a program of someone's on every transfer of a token. That is the sharpest tool a launchpad can
 * hand a creator and the easiest way to lock a buyer in: a hook can refuse the holder's own sale and nobody can take it
 * off the mint afterwards. So Ryntra holds four rules and no more, each of them a protection of the buyer, and the rest
 * is refused here, in code, not in a form:
 *
 * - **`WALLET_CAP`** — one wallet holds at most a share of the supply, so no one wallet takes the curve;
 * - **`ANTI_BUNDLE`** — one wallet buys at most so many times inside a window, and the mint takes at most so many
 *   purchases in one slot, so a bundle of wallets cannot sweep the opening;
 * - **`CREATOR_VESTING`** — the creator's own purchase does not move until the token is on the DEX;
 * - **`SNIPER_CEILING`** — in the curve's first minutes one wallet takes at most a smaller share than the wallet's cap.
 *
 * Three things hold the rules inside what a buyer can live with, and each is checked here rather than drawn in an
 * interface:
 *
 * 1. **Every rule but one acts on a purchase alone** — a transfer out of the curve's own base vault. A transfer a
 *    holder sends is never refused, so no rule of this set can hold anyone in the token. The one exception is
 *    `CREATOR_VESTING`, which holds the creator's own purchase, and only until the DEX: the creator agreed to it by
 *    launching. `curveRulesRefusal` is the reference semantics of that — the behaviour the audited program must match.
 * 2. **The rules end at the DEX.** The scope is `UNTIL_DEX` and nothing else: the hook is the curve's, the move to the
 *    DEX takes the program off the mint and leaves no authority able to put one back (`curveHookTimeline`).
 * 3. **A rule program nobody can quietly change.** Its upgrade authority is revoked (`FROZEN`) or it is one of
 *    Ryntra's Squads multisigs, and it carries an independent audit (SEC-3). A program outside that is refused, and the
 *    launch's passport says which of the two holds it (`CURVE_RULES_PROGRAM_GOVERNED`).
 *
 * A launch with these rules is a preset of its own (`rules`, «Правила на кривій»), because the mark «Без правил на
 * переказах» would be a lie on it: its receipt draws `CURVE_RULES_UNTIL_DEX` in that mark's place
 * (`../venues/meteora-dbc/receipt.ts`), and the market's rules, the proof of launch and the token page follow the
 * receipt.
 *
 * Nothing here is offered to anyone yet. The preset needs `RYNTRA_LAUNCH_CURVE_RULES=open`, the audited program's
 * address and the audit's report, all three of the operator's giving, and the flag opens only after the independent audit
 * (SEC-3) and the operator's own word. Default — closed.
 *
 * Pure and client-safe: the set, its bounds, the refusals, the reference semantics and the timeline read from a mint.
 * The venue builds no hook config until the
 * program exists.
 */

/** The environment variable that offers the preset; `open` — offered, anything else — not. */
export const CURVE_RULES_FLAG = "RYNTRA_LAUNCH_CURVE_RULES";
/** The audited rule program's address on this network; without it the preset is never offered. */
export const CURVE_RULES_PROGRAM_ENV = "RYNTRA_LAUNCH_CURVE_RULES_PROGRAM";
/** Where the independent audit of that program is published (SEC-3); without it the preset is never offered. */
export const CURVE_RULES_AUDIT_ENV = "RYNTRA_LAUNCH_CURVE_RULES_AUDIT";

/** The preset such a launch goes on — its own, because «Без правил на переказах» does not hold on it. */
export const CURVE_RULES_PRESET_ID = "rules" as const;

/** The only scope Ryntra allows: the rules run on the curve and the move to the DEX takes them off. */
export const CURVE_RULES_SCOPE = "UNTIL_DEX" as const;

/** The side a rule may act on: a purchase — a transfer out of the curve's own base vault. */
export const CURVE_RULES_SIDE = "PURCHASE" as const;

/** The rules of Ryntra's verified set, in the order a person reads them. */
export const CURVE_RULE_IDS = ["WALLET_CAP", "ANTI_BUNDLE", "CREATOR_VESTING", "SNIPER_CEILING"] as const;
export type CurveRuleId = (typeof CURVE_RULE_IDS)[number];

type Range = Readonly<{ min: number; max: number }>;

/**
 * What each rule's numbers may be. The floors matter as much as the ceilings: a wallet cap of a few basis points or a
 * window of a whole hour would stop ordinary buying, which is a lock-in by another name.
 */
export const CURVE_RULE_BOUNDS: Readonly<Record<CurveRuleId, Readonly<Record<string, Range>>>> = Object.freeze({
  /** 0.25 %–5 % of the supply in one wallet. */
  WALLET_CAP: Object.freeze({ capBps: { min: 25, max: 500 } }),
  /** A window of seconds, purchases of one wallet in it, and purchases of the whole mint in one slot. */
  ANTI_BUNDLE: Object.freeze({ windowSeconds: { min: 1, max: 60 }, buysPerWallet: { min: 1, max: 10 }, buysPerSlot: { min: 4, max: 64 } }),
  CREATOR_VESTING: Object.freeze({}),
  /** The first minutes of the curve, and 0.05 %–2 % of the supply in one wallet inside them. */
  SNIPER_CEILING: Object.freeze({ seconds: { min: 30, max: 900 }, capBps: { min: 5, max: 200 } }),
});

export type CurveRule =
  | Readonly<{ id: "WALLET_CAP"; capBps: number }>
  | Readonly<{ id: "ANTI_BUNDLE"; windowSeconds: number; buysPerWallet: number; buysPerSlot: number }>
  | Readonly<{ id: "CREATOR_VESTING" }>
  | Readonly<{ id: "SNIPER_CEILING"; seconds: number; capBps: number }>;

/**
 * The rules that lock a buyer in. Each is refused by name, with the reason said plainly, so a config that carries one
 * is turned away with a word rather than with a code. A rule outside both this list and the set above is refused too:
 * the set is a list of what is allowed, never a list of what is banned.
 */
export const LOCKED_IN_RULE_IDS = [
  "SELL_FORBIDDEN",
  "SELL_ALLOWLIST",
  "SELL_CAP_PER_PERIOD",
  "TRANSFER_ALLOWLIST",
  "TRANSFER_BLOCKLIST",
  "TRANSFERS_PAUSABLE",
  "FORCED_TRANSFER",
  "BALANCE_FREEZE",
] as const;
export type LockedInRuleId = (typeof LOCKED_IN_RULE_IDS)[number];

export const LOCKED_IN_REASONS: Readonly<Record<LockedInRuleId, string>> = Object.freeze({
  SELL_FORBIDDEN: "a rule that forbids selling locks the buyer in the token",
  SELL_ALLOWLIST: "a list of who may sell locks everyone outside it in",
  SELL_CAP_PER_PERIOD: "a ceiling on selling holds a holder's own tokens for a time they did not choose",
  TRANSFER_ALLOWLIST: "a list of who may receive the token locks every other holder in",
  TRANSFER_BLOCKLIST: "a list of who may not transfer takes a holder's own tokens out of their hands",
  TRANSFERS_PAUSABLE: "a switch that stops transfers can hold every holder at any moment",
  FORCED_TRANSFER: "a rule that moves a holder's tokens without them is a confiscation",
  BALANCE_FREEZE: "a rule that freezes a balance is a freeze authority under another name",
});

/* ------------------------------------------------------------- the rule program */

/** How a rule program may be changed after it is deployed, and nothing else. */
export const CURVE_RULES_UPGRADE = ["FROZEN", "MULTISIG"] as const;
export type CurveRulesUpgrade = (typeof CURVE_RULES_UPGRADE)[number];

/** The audited program that enforces the rules, and who may change it. */
export type CurveRulesProgram = Readonly<{
  /** The rule program's address. */
  program: string;
  upgrade: CurveRulesUpgrade;
  /** The multisig that may upgrade it; null when the authority is revoked (`FROZEN`). */
  upgradeAuthority: string | null;
  /** Where the independent audit of this program is published (SEC-3). */
  audit: string;
}>;

/** A launch's whole set: the rules, the scope they run in and the program that enforces them. */
export type CurveRuleSet = Readonly<{ rules: readonly CurveRule[]; scope: typeof CURVE_RULES_SCOPE; program: CurveRulesProgram }>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const within = (value: unknown, range: Range): boolean => typeof value === "number" && Number.isInteger(value) && value >= range.min && value <= range.max;

/**
 * Why a rule is not one of Ryntra's, each in a plain line; empty — it is. A rule that locks a buyer in is named by its
 * own reason; anything else is turned away because the set does not hold it.
 */
export function curveRuleProblems(value: unknown): readonly string[] {
  if (!value || typeof value !== "object") return ["a rule that is not a rule"];
  const row = value as Record<string, unknown>;
  const id = row.id;
  if (typeof id !== "string") return ["a rule with no name"];
  if ((LOCKED_IN_RULE_IDS as readonly string[]).includes(id)) return [`${id} is forbidden on Ryntra: ${LOCKED_IN_REASONS[id as LockedInRuleId]}`];
  if (!(CURVE_RULE_IDS as readonly string[]).includes(id)) return [`${id} is not one of the four rules Ryntra allows`];
  const bounds = CURVE_RULE_BOUNDS[id as CurveRuleId];
  const problems: string[] = [];
  for (const [name, range] of Object.entries(bounds)) {
    if (!within(row[name], range)) problems.push(`${id}: ${name} must be a whole number from ${range.min} to ${range.max}`);
  }
  for (const name of Object.keys(row)) {
    if (name !== "id" && !(name in bounds)) problems.push(`${id}: ${name} is not a number this rule takes`);
  }
  return problems;
}

/** A rule as it arrives from a request or the store; null for anything outside Ryntra's set. */
export function curveRuleOf(value: unknown): CurveRule | null {
  return curveRuleProblems(value).length === 0 ? (value as CurveRule) : null;
}

/** Why a rule program is not one Ryntra runs rules on, each in a plain line; empty — it is. */
export function curveRulesProgramProblems(program: unknown, options: Readonly<{ multisigs: readonly string[] }>): readonly string[] {
  if (!program || typeof program !== "object") return ["the rules name no program"];
  const row = program as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof row.program !== "string" || !BASE58.test(row.program)) problems.push("the rule program's address is not an address");
  if (typeof row.audit !== "string" || row.audit.trim() === "") problems.push("the rule program carries no independent audit");
  if (row.upgrade === "FROZEN") {
    if (row.upgradeAuthority !== null) problems.push("a frozen rule program has no upgrade authority");
  } else if (row.upgrade === "MULTISIG") {
    if (typeof row.upgradeAuthority !== "string" || !BASE58.test(row.upgradeAuthority)) problems.push("the rule program names no multisig that may upgrade it");
    else if (!options.multisigs.includes(row.upgradeAuthority)) problems.push("the rule program's upgrade authority is not one of Ryntra's multisigs");
  } else {
    problems.push("a rule program is either frozen or upgraded by one of Ryntra's multisigs, and nothing else");
  }
  return problems;
}

/**
 * Why a set is not Ryntra's, each in a plain line; empty — it is. The last guard before a config is offered for
 * signature and again on the config read back from the chain: a set with a rule that locks a buyer in, a rule the set
 * does not hold, a scope that would outlive the DEX or a program anyone could change is refused here.
 */
export function curveRuleSetProblems(set: unknown, options: Readonly<{ multisigs: readonly string[] }>): readonly string[] {
  if (!set || typeof set !== "object") return ["a set of rules that is not a set"];
  const row = set as Record<string, unknown>;
  const problems: string[] = [];
  if (row.scope !== CURVE_RULES_SCOPE) problems.push("the rules would outlive the move to the DEX: the only scope Ryntra allows is UNTIL_DEX");
  const rules = row.rules;
  if (!Array.isArray(rules) || rules.length === 0) problems.push("a launch with rules on the curve and no rule in them");
  else {
    const seen = new Set<string>();
    for (const rule of rules) {
      for (const line of curveRuleProblems(rule)) problems.push(line);
      const id = (rule as Record<string, unknown>)?.id;
      if (typeof id === "string") {
        if (seen.has(id)) problems.push(`${id} is named twice`);
        seen.add(id);
      }
    }
    /* A ceiling for the first minutes above the wallet's own cap would never bite: the numbers must say what they mean. */
    const cap = rules.find((rule) => (rule as Record<string, unknown>)?.id === "WALLET_CAP") as Extract<CurveRule, { id: "WALLET_CAP" }> | undefined;
    const sniper = rules.find((rule) => (rule as Record<string, unknown>)?.id === "SNIPER_CEILING") as Extract<CurveRule, { id: "SNIPER_CEILING" }> | undefined;
    if (cap && sniper && sniper.capBps > cap.capBps) problems.push("SNIPER_CEILING: its cap is above the wallet's own cap, so it would never hold");
  }
  for (const line of curveRulesProgramProblems(row.program, options)) problems.push(line);
  for (const name of Object.keys(row)) {
    if (!["rules", "scope", "program"].includes(name)) problems.push(`${name} is not a part of a set of rules`);
  }
  return problems;
}

/** A set under Ryntra's rule. Throws, naming every line, on a set outside it — the refusal a form and a route both say. */
export function curveRuleSetOf(set: unknown, options: Readonly<{ multisigs: readonly string[] }>): CurveRuleSet {
  const problems = curveRuleSetProblems(set, options);
  if (problems.length) throw new Error(`Rules on the curve outside Ryntra's set: ${problems.join("; ")}.`);
  return set as CurveRuleSet;
}

/** A set as it comes back from the store or a response; null for anything outside Ryntra's rule. */
export function curveRuleSetFrom(value: unknown, options: Readonly<{ multisigs: readonly string[] }>): CurveRuleSet | null {
  return curveRuleSetProblems(value, options).length === 0 ? (value as CurveRuleSet) : null;
}

/* ------------------------------------------------------------- the reference semantics */

/** One transfer of the token, as a hook sees it. */
export type CurveTransfer = Readonly<{
  /** Whether it comes out of the curve's own base vault — a purchase on the curve, not a holder's own transfer. */
  purchase: boolean;
  /** Who sends it: for a purchase the curve, otherwise the holder. */
  from: string;
  /** Who receives it. */
  to: string;
  amountRaw: bigint;
  /** Seconds since the curve opened. */
  sinceStartSeconds: number;
  slot: number;
}>;

/** What the rules are judged against — the token and the two wallets of the transfer as the chain holds them. */
export type CurveRulesState = Readonly<{
  supplyRaw: bigint;
  /** What the receiving wallet already holds, raw. */
  toHeldRaw: bigint;
  /** Purchases the receiving wallet already made inside the anti-bundle window. */
  toPurchasesInWindow: number;
  /** Purchases of this token already made in this slot. */
  purchasesInSlot: number;
  /** The launch's creator — the one wallet whose own transfer a rule may hold. */
  creator: string;
  /** Whether the token is on the DEX: there the hook is off the mint and no rule runs. */
  migrated: boolean;
}>;

/**
 * The rule that refuses this transfer, or null when every rule of the set lets it through — the behaviour the audited
 * program must implement, held to by `curve-rules.test.mjs`.
 *
 * Two things are true of it whatever the set says, and they are what keeps a buyer free: after the move to the DEX
 * nothing refuses anything, and a transfer a holder other than the creator sends is never refused.
 */
export function curveRulesRefusal(set: CurveRuleSet, transfer: CurveTransfer, state: CurveRulesState): CurveRuleId | null {
  if (state.migrated) return null;
  const share = (bps: number) => (state.supplyRaw * BigInt(bps)) / 10_000n;
  for (const rule of set.rules) {
    switch (rule.id) {
      case "CREATOR_VESTING":
        /* The creator's own purchase does not move until the DEX; everyone else's transfers are not this rule's business. */
        if (!transfer.purchase && transfer.from === state.creator) return rule.id;
        break;
      case "WALLET_CAP":
        if (transfer.purchase && state.toHeldRaw + transfer.amountRaw > share(rule.capBps)) return rule.id;
        break;
      case "ANTI_BUNDLE":
        if (!transfer.purchase) break;
        if (state.toPurchasesInWindow + 1 > rule.buysPerWallet) return rule.id;
        if (state.purchasesInSlot + 1 > rule.buysPerSlot) return rule.id;
        break;
      case "SNIPER_CEILING":
        if (transfer.purchase && transfer.sinceStartSeconds < rule.seconds && state.toHeldRaw + transfer.amountRaw > share(rule.capBps)) return rule.id;
        break;
    }
  }
  return null;
}

/* ------------------------------------------------------------- the mint, read */

/** A mint's `TransferHook` extension, plain: the program that runs on a transfer and who may change it. */
export type MintTransferHook = Readonly<{
  /** The program a transfer calls; null — none, the hook is off the mint. */
  program: string | null;
  /** Who may set a program; null — revoked. */
  authority: string | null;
}>;

export const CURVE_HOOK_PHASES = ["CURVE", "REMOVED", "OUTSIDE_RULE"] as const;
export type CurveHookPhase = (typeof CURVE_HOOK_PHASES)[number];

/** Where a launch's rules stand now. */
export type CurveHookTimeline = Readonly<{
  phase: CurveHookPhase;
  /** The program running on a transfer now; null — none. */
  programNow: string | null;
  /** Whether anyone can still put a program on the mint. */
  authorityLive: boolean;
}>;

/**
 * The rules' timeline read from a mint. On the curve the mint carries exactly the audited program and DBC's pool
 * authority holds the hook, so only the curve's own program can change it; the move to the DEX takes the program off
 * and leaves no authority. Anything else — another program, an authority that is someone's wallet, a program still
 * there after the DEX — is outside the rule, and then no mark is drawn.
 */
export function curveHookTimeline(hook: MintTransferHook, args: Readonly<{ program: string; migrated: boolean; poolAuthority: string }>): CurveHookTimeline {
  const base = { programNow: hook.program, authorityLive: hook.authority !== null };
  if (!args.migrated) {
    const holds = hook.program === args.program && hook.authority === args.poolAuthority;
    return { ...base, phase: holds ? "CURVE" : "OUTSIDE_RULE" };
  }
  return { ...base, phase: hook.program === null && hook.authority === null ? "REMOVED" : "OUTSIDE_RULE" };
}

/**
 * Why a launch's mint is not the rules its config promised, each in a plain line; empty — it is. The receipt's check:
 * the audited program on the curve, the hook off the mint after the DEX, and never an authority of anyone's own.
 */
export function mintCurveRulesProblems(hook: MintTransferHook, args: Readonly<{ program: string; migrated: boolean; poolAuthority: string }>): readonly string[] {
  const timeline = curveHookTimeline(hook, args);
  if (timeline.phase !== "OUTSIDE_RULE") return [];
  if (!args.migrated) {
    const problems: string[] = [];
    if (hook.program !== args.program) problems.push("the mint's transfer hook is not the audited rule program");
    if (hook.authority !== args.poolAuthority) problems.push("the transfer hook is not held by the curve's own authority");
    return problems;
  }
  const problems: string[] = [];
  if (hook.program !== null) problems.push("the transfer hook was not taken off the mint at the move to the DEX");
  if (hook.authority !== null) problems.push("someone can still put a transfer hook on the mint after the DEX");
  return problems;
}

/* ------------------------------------------------------------- what is offered here */

/**
 * Whether the preset is offered on this deployment: the flag open, the venue on DBC SDK 2.0.0 (1.5.13 builds no hook
 * config), the audited program named and its audit published. Any one of them missing — not offered, and that is the
 * default everywhere.
 */
export function curveRulesProgramOf(env: Readonly<Record<string, string | undefined>>, sdk: string, options: Readonly<{ multisigs: readonly string[]; upgradeAuthority?: string | null }> = { multisigs: [] }): CurveRulesProgram | null {
  if ((env[CURVE_RULES_FLAG] ?? "").trim() !== "open" || sdk !== "2.0.0") return null;
  const program = (env[CURVE_RULES_PROGRAM_ENV] ?? "").trim();
  const audit = (env[CURVE_RULES_AUDIT_ENV] ?? "").trim();
  const authority = options.upgradeAuthority?.trim() || null;
  const candidate: CurveRulesProgram = authority
    ? { program, upgrade: "MULTISIG", upgradeAuthority: authority, audit }
    : { program, upgrade: "FROZEN", upgradeAuthority: null, audit };
  return curveRulesProgramProblems(candidate, { multisigs: options.multisigs }).length === 0 ? Object.freeze(candidate) : null;
}

/** What the format tells a form: the rules it may pick with their bounds, what is forbidden and why, and the program. */
export type CurveRulesFormat = Readonly<{
  rules: readonly Readonly<{ id: CurveRuleId; bounds: Readonly<Record<string, Range>> }>[];
  forbidden: readonly Readonly<{ id: LockedInRuleId; reason: string }>[];
  scope: typeof CURVE_RULES_SCOPE;
  side: typeof CURVE_RULES_SIDE;
  program: CurveRulesProgram;
}>;

export function curveRulesFormat(program: CurveRulesProgram | null): CurveRulesFormat | null {
  if (!program) return null;
  return {
    rules: CURVE_RULE_IDS.map((id) => ({ id, bounds: CURVE_RULE_BOUNDS[id] })),
    forbidden: LOCKED_IN_RULE_IDS.map((id) => ({ id, reason: LOCKED_IN_REASONS[id] })),
    scope: CURVE_RULES_SCOPE,
    side: CURVE_RULES_SIDE,
    program,
  };
}
