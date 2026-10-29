import assert from "node:assert/strict";
import test from "node:test";

import { findAuthority, resolveAuthority } from "../authority-matrix.ts";
import { TEAM_PERMISSIONS, TEAM_PERMISSION_AUTHORITY, TEAM_PERMISSION_RISK, decideTeamPermission, grantOf } from "../team/roles.ts";
import { BUDGET_RULE, BUDGET_SOURCES } from "./budget.ts";
import { CONSTITUTION_SECTIONS } from "./constitution.ts";
import { FEE_SHARE_TOTAL_BPS } from "./fee-shares.ts";
import { termsOf } from "./preset-terms.ts";
import { LAUNCH_PRESETS } from "../venues/meteora-dbc/presets.ts";
import {
  ALLOCATION_CATEGORIES,
  ALLOCATION_TOTAL_PCT,
  EMPTY_TEAM_LAUNCH_DRAFT,
  TEAM_LAUNCH_AUTHORITY,
  TEAM_LAUNCH_OWNER_WORD,
  TEAM_LAUNCH_STEPS,
  TEAM_LAUNCH_STEP_COUNT,
  TEAM_LAUNCH_STEP_KEYS,
  AUTHORITY_KEPT_SUMMARY_MIN,
  FEE_SHARE_PRESETS,
  allocationProblems,
  allocationSupply,
  allocationUnits,
  ladderRuns,
  constitutionSectionsKnown,
  feeLinesHold,
  supplyRawOf,
  teamLaunchBudget,
  teamLaunchChronicle,
  teamLaunchConstitution,
  teamLaunchFees,
  teamLaunchGate,
  teamLaunchProgress,
  teamLaunchReview,
  teamLaunchServedFor,
  teamLaunchStep,
  teamLaunchStepByKey,
  teamLaunchStepProblems,
  teamLaunchWallets,
  teamLaunchWhitelisted,
} from "./team-launch.ts";

const TREASURY = "AmKrrLoHrYr7EUu5zMzAvYYADCiZ8SNFjd85uwjSSUVo";
const WALLET = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const OTHER = "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E";
const MAINNET = { NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" };

/** The same draft on «Спільнота», the one preset whose launch writes a vault of the creator's fees. */
function community(rights = {}) {
  return wholeDraft({ curve: { preset: "community", firstBuyQuoteRaw: "0", firstBuyLockDays: 0 }, rights: { treasury: TREASURY, feeShares: [], rulesChangeable: false, ...rights } });
}

/** A draft every step of which holds — the one the review may be taken of. */
function wholeDraft(over = {}) {
  return {
    ...EMPTY_TEAM_LAUNCH_DRAFT,
    teamId: "0123456789abcdef01234567",
    project: { name: "Ryntra Crew", summary: "Один ринок однієї команди, усі правила до підпису.", website: "https://ryntra.io", x: "@ryntra" },
    token: { ...EMPTY_TEAM_LAUNCH_DRAFT.token, name: "Crew", symbol: "CREW" },
    allocation: [
      { category: "community", pct: 60, recipient: WALLET, cliffDays: 0, unlockDays: 0 },
      { category: "team", pct: 20, recipient: OTHER, cliffDays: 180, unlockDays: 720 },
      { category: "treasury", pct: 20, recipient: TREASURY, cliffDays: 0, unlockDays: 360 },
    ],
    rights: { treasury: TREASURY, feeShares: [], rulesChangeable: false },
    ...over,
  };
}

/* ------------------------------------------------------------------- steps */

test("eight steps in the order of spec §7.3, each with the rights it needs", () => {
  assert.equal(TEAM_LAUNCH_STEP_COUNT, 8);
  assert.deepEqual([...TEAM_LAUNCH_STEP_KEYS], ["project", "token", "allocation", "curve", "liquidity", "rights", "automation", "review"]);
  assert.deepEqual(
    TEAM_LAUNCH_STEPS.map((step) => step.n),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  for (const step of TEAM_LAUNCH_STEPS) {
    assert.equal(teamLaunchStep(step.n), step);
    assert.equal(teamLaunchStepByKey(step.key), step);
    /* Every step names at least one right, and every right it names is one of the nine of spec §9.2. */
    assert.ok(step.permissions.length >= 1, step.key);
    for (const permission of step.permissions) assert.ok(TEAM_PERMISSIONS.includes(permission), `${step.key}: ${permission}`);
  }
  /* Every step is its own: the server keys its one EXE-2 action by the step, so no two steps share a record. */
  assert.equal(new Set(TEAM_LAUNCH_STEPS.map((step) => step.key)).size, 8);
  assert.equal(teamLaunchStep(9), null);
  assert.equal(teamLaunchStepByKey("nothing"), null);
});

test("the five roles of the task each hold their steps, and the signature is nobody's alone", () => {
  const stepsOf = (role) => TEAM_LAUNCH_STEPS.filter((step) => step.permissions.every((permission) => grantOf(role, permission) !== "DENY")).map((step) => step.key);
  const DRAFTING = ["project", "token", "allocation", "curve", "liquidity", "automation"];
  /* Drafting the market and naming what its automation may do is every operator's. */
  assert.deepEqual(stepsOf("MARKET_OPERATOR"), DRAFTING);
  assert.deepEqual(stepsOf("FINANCE"), DRAFTING);
  /* The rules money obeys (step 06) are the operator's and the Admin's; the launch itself (step 08) is theirs and the Launch Operator's — `deploy` is nobody else's. */
  assert.deepEqual(stepsOf("LAUNCH_OPERATOR"), [...DRAFTING, "review"]);
  assert.deepEqual(stepsOf("OWNER"), [...DRAFTING.slice(0, 5), "rights", "automation", "review"]);
  assert.deepEqual(stepsOf("ADMIN"), [...DRAFTING.slice(0, 5), "rights", "automation", "review"]);
  /* A viewer and an analyst draft nothing. */
  assert.deepEqual(stepsOf("VIEWER"), []);
  assert.deepEqual(stepsOf("ANALYST"), []);
  /* Step 08 is high risk, every right of it: no role holds it as its own `ALLOW`. */
  const review = teamLaunchStepByKey("review");
  for (const permission of review.permissions) assert.equal(TEAM_PERMISSION_RISK[permission], "HIGH");
  for (const permission of review.permissions) assert.notEqual(grantOf("OWNER", permission), "ALLOW");
});

test("the EXE-1 row of Team Launch: the multisig's, closed by default, `deploy`'s own path", () => {
  const row = findAuthority(TEAM_LAUNCH_AUTHORITY);
  assert.ok(row);
  assert.equal(row.signer, "MULTISIG");
  assert.equal(row.surface, "launch");
  /* Not announced on a deployment that has not set the switch: a stranger reads what a closed row reads. */
  assert.deepEqual(resolveAuthority(row, {}), { id: row.id, state: "DISABLED", eligibility: "NOBODY", gate: "CLOSED" });
  assert.equal(resolveAuthority(row, { RYNTRA_TEAM_LAUNCH: "canary" }).state, "DISABLED");
  assert.deepEqual(resolveAuthority(row, { RYNTRA_TEAM_LAUNCH: "open" }), { id: row.id, state: "PREVIEW", eligibility: "EVERYONE", gate: "OPEN" });
  /* A row with no proven mainnet cycle never reads LIVE. */
  assert.notEqual(row.ceiling, "LIVE");
  assert.deepEqual(TEAM_PERMISSION_AUTHORITY.deploy, [TEAM_LAUNCH_AUTHORITY]);
  const closed = decideTeamPermission({ member: { role: "OWNER", status: "ACTIVE" }, permission: "deploy", treasury: TREASURY, env: MAINNET });
  assert.equal(closed.allowed, false);
  assert.equal(closed.refusal, "AUTHORITY_CLOSED");
});

/* ------------------------------------------------------------- the switch */

test("Team Launch is closed until the owner says the word, and the canary is the whitelist beside it", () => {
  assert.equal(TEAM_LAUNCH_OWNER_WORD, false);
  assert.equal(teamLaunchGate({}), "CLOSED");
  assert.equal(teamLaunchGate({ RYNTRA_TEAM_LAUNCH: "" }), "CLOSED");
  assert.equal(teamLaunchGate({ RYNTRA_TEAM_LAUNCH: "yes" }), "CLOSED");
  assert.equal(teamLaunchGate({ RYNTRA_TEAM_LAUNCH: "canary" }), "CLOSED");
  assert.equal(teamLaunchGate({ RYNTRA_TEAM_LAUNCH: " open " }), "OPEN");

  assert.deepEqual(teamLaunchServedFor(WALLET, {}), { served: false, reason: "CLOSED" });
  /* A canary asked for fails closed: a whitelist written but naming no address serves nobody, never everybody. */
  assert.deepEqual(teamLaunchServedFor(WALLET, { RYNTRA_TEAM_LAUNCH: "open", RYNTRA_TEAM_LAUNCH_WALLETS: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4" }), { served: false, reason: "NOT_WHITELISTED" });
  assert.deepEqual(teamLaunchWhitelisted({ RYNTRA_TEAM_LAUNCH_WALLETS: " " }), false);
  assert.deepEqual(teamLaunchWhitelisted({ RYNTRA_TEAM_LAUNCH_WALLETS: "nonsense" }), true);
  /* The owner's canary: the switch open and the whitelist naming his wallet — and nobody else's. */
  const canary = { RYNTRA_TEAM_LAUNCH: "open", RYNTRA_TEAM_LAUNCH_WALLETS: `${WALLET}, nonsense ${WALLET}` };
  assert.deepEqual(teamLaunchWallets(canary), [WALLET]);
  assert.deepEqual(teamLaunchServedFor(WALLET, canary), { served: true, canary: true, whitelist: [WALLET] });
  assert.deepEqual(teamLaunchServedFor(OTHER, canary), { served: false, reason: "NOT_WHITELISTED" });
  assert.deepEqual(teamLaunchServedFor(null, canary), { served: false, reason: "NOT_WHITELISTED" });
  /* Clearing the list is the progressive rollout: every member whose rights allow the step. */
  assert.deepEqual(teamLaunchServedFor(OTHER, { RYNTRA_TEAM_LAUNCH: "open" }), { served: true, canary: false, whitelist: [] });
});

test("the canary's own step 08 completes: a row open to fewer than everyone would refuse the team itself", () => {
  const row = findAuthority(TEAM_LAUNCH_AUTHORITY);
  /* TEAM-1 never widens a row that is not open to everyone, so the row itself carries no canary — the whitelist does
     (`teamLaunchServedFor`). With the one switch open the operator passes both rights of step 08. */
  assert.equal(resolveAuthority(row, { RYNTRA_TEAM_LAUNCH: "open" }).eligibility, "EVERYONE");
  for (const permission of teamLaunchStepByKey("review").permissions) {
    const decision = decideTeamPermission({ member: { role: "OWNER", status: "ACTIVE" }, permission, treasury: TREASURY, env: { ...MAINNET, RYNTRA_TEAM_LAUNCH: "open" } });
    assert.equal(decision.allowed, true, permission);
    assert.equal(decision.requires, "MULTISIG", permission);
  }
});

/* --------------------------------------------------------- the tokenomics */

test("100 % in whole base units: the rows add up to the supply exactly, whatever the supply", () => {
  const rows = [
    { category: "community", pct: 33, recipient: null, cliffDays: 0, unlockDays: 0 },
    { category: "team", pct: 33, recipient: null, cliffDays: 30, unlockDays: 365 },
    { category: "treasury", pct: 34, recipient: null, cliffDays: 0, unlockDays: 0 },
  ];
  /* A supply that divides by a hundred, and three that do not: the sum is the supply in every one. */
  for (const token of [
    { supply: 1_000_000_000, decimals: 6 },
    { supply: 7, decimals: 0 },
    { supply: 333, decimals: 0 },
    { supply: 1, decimals: 2 },
  ]) {
    const supplyRaw = supplyRawOf(token);
    const units = allocationUnits(supplyRaw, rows);
    assert.equal(
      units.reduce((sum, unit) => sum + unit.unitsRaw, 0n),
      supplyRaw,
      `${token.supply}e${token.decimals}`,
    );
    /* Every row is a whole number of base units — bigint throughout, never a float. */
    for (const unit of units) assert.equal(typeof unit.unitsRaw, "bigint");
  }
  /* The remainder goes to the largest remainder first, and the same draft always gives the same units. */
  const seven = allocationUnits(7n, rows).map((unit) => unit.unitsRaw);
  assert.deepEqual(seven, [2n, 2n, 3n]);
  assert.deepEqual(allocationUnits(7n, rows).map((unit) => unit.unitsRaw), seven);
});

test("a draft whose rows do not yet add up says what it has, never calling the rest locked", () => {
  const supplyRaw = supplyRawOf({ supply: 1_000, decimals: 0 });
  assert.deepEqual(allocationSupply(supplyRaw, []), { circulatingRaw: 0n, lockedRaw: 0n, units: [] });
  const half = allocationSupply(supplyRaw, [{ category: "team", pct: 30, recipient: null, cliffDays: 90, unlockDays: 365 }]);
  assert.equal(half.circulatingRaw, 0n);
  assert.equal(half.lockedRaw, 300n);
  /* A share that is not a whole per cent above zero counts as none and throws nothing: the step refuses it instead. */
  const odd = allocationUnits(supplyRaw, [
    { category: "community", pct: 12.5, recipient: null, cliffDays: 0, unlockDays: 0 },
    { category: "team", pct: -5, recipient: null, cliffDays: 0, unlockDays: 0 },
    { category: "treasury", pct: 10, recipient: null, cliffDays: 0, unlockDays: 0 },
  ]).map((unit) => unit.unitsRaw);
  assert.deepEqual(odd, [0n, 0n, 100n]);
});

test("what circulates on day one is what no lock holds", () => {
  const supplyRaw = supplyRawOf({ supply: 1_000, decimals: 0 });
  const { circulatingRaw, lockedRaw, units } = allocationSupply(supplyRaw, [
    { category: "community", pct: 40, recipient: null, cliffDays: 0, unlockDays: 0 },
    { category: "team", pct: 60, recipient: null, cliffDays: 180, unlockDays: 720 },
  ]);
  assert.equal(circulatingRaw, 400n);
  assert.equal(lockedRaw, 600n);
  assert.deepEqual(units.map((unit) => unit.circulating), [true, false]);
});

test("the allocation's rules, every one said at once", () => {
  assert.deepEqual(allocationProblems([]), ["EMPTY"]);
  const one = (over) => allocationProblems([{ category: "community", pct: 100, recipient: null, cliffDays: 0, unlockDays: 0, ...over }]);
  assert.deepEqual(one({}), []);
  /* Not whole, not summing, repeated, a recipient that is no address, a cliff past the end. */
  assert.ok(one({ pct: 99.5 }).includes("PCT_NOT_WHOLE"));
  assert.ok(one({ pct: 99 }).includes("PCT_SUM"));
  assert.ok(one({ pct: 0 }).includes("PCT_ZERO"));
  assert.ok(one({ recipient: "nope" }).includes("RECIPIENT_INVALID"));
  assert.ok(one({ cliffDays: 400, unlockDays: 300 }).includes("CLIFF_AFTER_UNLOCK"));
  /* A cliff with no unlock end is a contradiction: nothing unlocks at day zero and everything is locked by the cliff. */
  assert.ok(one({ cliffDays: 180, unlockDays: 0 }).includes("CLIFF_AFTER_UNLOCK"));
  assert.deepEqual(one({ cliffDays: 180, unlockDays: 180 }), []);
  assert.ok(one({ cliffDays: -1 }).includes("CLIFF_INVALID"));
  assert.ok(one({ unlockDays: 1.5 }).includes("UNLOCK_INVALID"));
  const twice = allocationProblems([
    { category: "team", pct: 50, recipient: null, cliffDays: 0, unlockDays: 0 },
    { category: "team", pct: 50, recipient: null, cliffDays: 0, unlockDays: 0 },
  ]);
  assert.ok(twice.includes("CATEGORY_REPEATED"));
  /* The seven categories of spec §7.4. */
  assert.deepEqual([...ALLOCATION_CATEGORIES], ["community", "team", "investors", "treasury", "liquidity", "marketing", "partners"]);
  assert.equal(ALLOCATION_TOTAL_PCT, 100);
});

/* ------------------------------------------------------- a step's problems */

test("an empty draft holds no step, and a whole one holds every step", () => {
  const empty = teamLaunchProgress(EMPTY_TEAM_LAUNCH_DRAFT);
  assert.equal(empty.ready, false);
  /* Only the steps whose defaults already hold: the curve's preset, the liquidity's sources, the automation's bounds. */
  assert.deepEqual([...empty.done], ["curve", "liquidity", "automation"]);
  const whole = teamLaunchProgress(wholeDraft());
  assert.equal(whole.ready, true);
  assert.equal(whole.done.size, 8);
});

test("step 08 opens only over seven steps that hold, and every recipient named", () => {
  assert.deepEqual(teamLaunchStepProblems("review", wholeDraft()), []);
  /* A draft may leave a recipient unnamed; the signature may not. */
  const unnamed = wholeDraft({
    allocation: [
      { category: "community", pct: 60, recipient: null, cliffDays: 0, unlockDays: 0 },
      { category: "team", pct: 40, recipient: OTHER, cliffDays: 0, unlockDays: 0 },
    ],
  });
  assert.deepEqual(teamLaunchStepProblems("allocation", unnamed), []);
  assert.deepEqual(teamLaunchStepProblems("review", unnamed), ["RECIPIENTS_MISSING"]);
  const noTreasury = wholeDraft({ rights: { treasury: null, feeShares: [], rulesChangeable: false } });
  assert.deepEqual(teamLaunchStepProblems("rights", noTreasury), ["NO_TREASURY"]);
  assert.deepEqual(teamLaunchStepProblems("review", noTreasury), ["STEPS_BEFORE"]);
});

test("each step's own refusals", () => {
  assert.ok(teamLaunchStepProblems("project", { ...wholeDraft(), teamId: "" }).includes("TEAM_MISSING"));
  /* A team id is the one TEAM-1 and the contract know — 24 hexadecimal characters, not any text typed in the field. */
  assert.ok(teamLaunchStepProblems("project", { ...wholeDraft(), teamId: "Crew Labs" }).includes("TEAM_MISSING"));
  assert.ok(teamLaunchStepProblems("project", wholeDraft({ project: { name: "R", summary: "x", website: "ryntra.io", x: "n o" } })).length >= 4);
  assert.ok(teamLaunchStepProblems("token", wholeDraft({ token: { ...EMPTY_TEAM_LAUNCH_DRAFT.token, name: "Crew", symbol: "crew" } })).includes("SYMBOL"));
  assert.ok(teamLaunchStepProblems("token", wholeDraft({ token: { ...EMPTY_TEAM_LAUNCH_DRAFT.token, name: "Crew", symbol: "CREW", decimals: 12 } })).includes("DECIMALS"));
  assert.ok(teamLaunchStepProblems("token", wholeDraft({ token: { ...EMPTY_TEAM_LAUNCH_DRAFT.token, name: "Crew", symbol: "CREW", supply: 0 } })).includes("SUPPLY"));
  /*
   * A kept mint or freeze authority is the issuer's control over everybody's tokens: the project stands behind it with
   * a statement of its own and a public place to be asked at, or the step does not hold.
   */
  const kept = { ...EMPTY_TEAM_LAUNCH_DRAFT.token, name: "Crew", symbol: "CREW", authorities: { mint: "kept", freeze: "revoked", update: "revoked" } };
  const statement = "Емісію лишаємо за командою на перший рік, щоб відкрити ринки на інших майданчиках; після того право відкликаємо назавжди.";
  assert.ok(statement.length >= AUTHORITY_KEPT_SUMMARY_MIN);
  assert.deepEqual(teamLaunchStepProblems("token", wholeDraft({ token: kept, project: { name: "Crew", summary: statement, website: "https://ryntra.io", x: "" } })), []);
  /* The same statement with nowhere to be asked at, and a line instead of a statement — both refused. */
  assert.ok(teamLaunchStepProblems("token", wholeDraft({ token: kept, project: { name: "Crew", summary: statement, website: "", x: "" } })).includes("AUTHORITY_KEPT_UNDECLARED"));
  assert.ok(teamLaunchStepProblems("token", wholeDraft({ token: kept, project: { name: "Crew", summary: "Емісію лишаємо за командою.", website: "https://ryntra.io", x: "" } })).includes("AUTHORITY_KEPT_UNDECLARED"));
  /* A revoked mint and freeze need no such statement. */
  assert.deepEqual(teamLaunchStepProblems("token", wholeDraft()), []);
  /* The first purchase is whole base units of the pair currency, and a lock below the preset's own minimum is refused. */
  assert.ok(teamLaunchStepProblems("curve", wholeDraft({ curve: { preset: "classic", firstBuyQuoteRaw: "1.5", firstBuyLockDays: 0 } })).includes("FIRST_BUY"));
  assert.ok(teamLaunchStepProblems("curve", wholeDraft({ curve: { preset: "micro", firstBuyQuoteRaw: "1000000", firstBuyLockDays: 1 } })).includes("FIRST_BUY_LOCK"));
  /* A market opened with no trade of the team's own has nothing to lock: the preset's minimum holds over a purchase there is. */
  assert.deepEqual(teamLaunchStepProblems("curve", wholeDraft({ curve: { preset: "micro", firstBuyQuoteRaw: "0", firstBuyLockDays: 0 } })), []);
  assert.deepEqual(teamLaunchStepProblems("curve", wholeDraft({ curve: { preset: "micro", firstBuyQuoteRaw: "1000000", firstBuyLockDays: LAUNCH_PRESETS.micro.creatorLockMinDays } })), []);
  assert.ok(teamLaunchStepProblems("liquidity", wholeDraft({ liquidity: { lpLockedForEver: true, budgetSources: [] } })).includes("BUDGET_SOURCES"));
  /* The split is held to the program's own rule, by the one function that holds it — the creator's row included. */
  assert.ok(teamLaunchStepProblems("rights", community({ feeShares: [{ address: OTHER, bps: 9_990 }] })).includes("FEE_SHARES"));
  /* The same wallet twice is a vault the program refuses: the step refuses it too, rather than letting the review promise it. */
  assert.ok(teamLaunchStepProblems("rights", community({ feeShares: [{ address: OTHER, bps: 5_000 }, { address: OTHER, bps: 4_000 }] })).includes("FEE_SHARES"));
  assert.deepEqual(teamLaunchStepProblems("rights", community({ feeShares: [{ address: OTHER, bps: 2_000 }] })), []);
  /* Only «Спільнота» writes a vault of the creator's fees: on any other preset the split is refused here, not at the build. */
  assert.deepEqual(teamLaunchStepProblems("rights", wholeDraft({ rights: { treasury: TREASURY, feeShares: [{ address: OTHER, bps: 2_000 }], rulesChangeable: false } })), ["FEE_SHARES_PRESET"]);
  assert.deepEqual(FEE_SHARE_PRESETS, ["community"]);
  /* A launch with no split at all is every preset's. */
  assert.deepEqual(teamLaunchStepProblems("rights", wholeDraft()), []);
  assert.ok(teamLaunchStepProblems("automation", wholeDraft({ automation: { ...EMPTY_TEAM_LAUNCH_DRAFT.automation, deployedBpsMax: BUDGET_RULE.deployMaxBps + 1 } })).includes("LADDER_SHARE"));
  assert.ok(teamLaunchStepProblems("automation", wholeDraft({ automation: { ...EMPTY_TEAM_LAUNCH_DRAFT.automation, pauseOnDropBps: BUDGET_RULE.dropStopBps + 1 } })).includes("PAUSE_DROP"));
});

/* --------------------------------------------------- step 08: fees, budget */

test("every fee is its own row, and the rows of one moment are the whole of it", () => {
  for (const preset of Object.values(LAUNCH_PRESETS)) {
    const rows = teamLaunchFees(termsOf(preset));
    assert.ok(feeLinesHold(rows), preset.id);
    /* Nothing is summed into one «≈ 40 %»: the curve, the move to the DEX and the pool each have their rows. */
    for (const when of ["curve", "graduation", "pool"]) assert.ok(rows.some((row) => row.when === when), `${preset.id}: ${when}`);
    for (const row of rows) assert.ok(Number.isInteger(row.bps) && row.bps >= 0 && row.bps <= FEE_SHARE_TOTAL_BPS, `${preset.id}: ${row.key}`);
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  }
  /* Where Ryntra's executor holds the partner's role, its part of the graduation fee is the market's budget, not revenue. */
  const micro = teamLaunchFees(termsOf(LAUNCH_PRESETS.micro)).find((row) => row.key === "graduation.ryntra");
  assert.equal(micro.party, "budget");
  const classic = teamLaunchFees(termsOf(LAUNCH_PRESETS.classic)).find((row) => row.key === "graduation.ryntra");
  assert.equal(classic.party, "ryntra");
});

test("the market's budget never offers more than the executor's own rule, and is never a floor", () => {
  const draft = wholeDraft({ automation: { ladder: true, deployedBpsMax: BUDGET_RULE.deployMaxBps, pauseOnDropBps: BUDGET_RULE.dropStopBps, stopByHand: true } });
  /* The budget the executor actually claims: on people's markets the fees wait in Meteora's pool while the operator
     keeps them closed (`waitsInPool`), so «Micro» funds nothing yet and the ladder is not promised on it. */
  assert.equal(teamLaunchBudget(draft, termsOf(LAUNCH_PRESETS.micro)).fundable, false);
  assert.equal(teamLaunchBudget(draft, termsOf(LAUNCH_PRESETS.micro, { peopleServed: true })).fundable, true);
  const budget = teamLaunchBudget(draft, termsOf(LAUNCH_PRESETS.demo));
  assert.equal(budget.deployedBpsMax, BUDGET_RULE.deployMaxBps);
  assert.equal(budget.pauseOnDropBps, BUDGET_RULE.dropStopBps);
  assert.equal(budget.minStepRaw, BUDGET_RULE.minStepRaw);
  assert.equal(budget.maxSteps, BUDGET_RULE.maxSteps);
  assert.equal(budget.notAFloor, true);
  assert.equal(budget.feeShareBps, BUDGET_RULE.feeShareBps);
  assert.equal(budget.fundable, true);
  assert.equal(budget.ladder, true);
  /* A preset whose partner is the multisig has no market budget: said as null, not as zero — and the ladder does not run. */
  const unfunded = teamLaunchBudget(draft, termsOf(LAUNCH_PRESETS.classic));
  assert.equal(unfunded.feeShareBps, null);
  assert.equal(unfunded.fundable, false);
  assert.equal(unfunded.ladder, false);
  /* Every source the team may choose is one the rule knows. */
  for (const source of budget.sources) assert.ok(BUDGET_SOURCES.includes(source));
});

/* --------------------------------- the Constitution and the chronicle in the steps */

test("the Constitution lives in the steps, with every field's enforcement source and «unknown» said as unknown", () => {
  const rows = teamLaunchConstitution(wholeDraft(), termsOf(LAUNCH_PRESETS.classic));
  assert.ok(constitutionSectionsKnown(rows));
  for (const row of rows) assert.ok(CONSTITUTION_SECTIONS.includes(row.section), row.key);
  /* Every row of the vault the program will write, the creator's own among them — what nobody else takes is theirs. */
  const vault = teamLaunchConstitution(community({ feeShares: [{ address: OTHER, bps: 2_000 }] }), termsOf(LAUNCH_PRESETS.community)).find((row) => row.key === "feeVault");
  assert.equal(vault.value, `${TREASURY}:8000 ${OTHER}:2000`);
  /* No field claims more than it has: the incident channel is not built, and it says so. */
  const incidents = rows.find((row) => row.key === "incidents");
  assert.equal(incidents.enforcement, "NOT_IMPLEMENTED");
  assert.equal(incidents.value, null);
  /* A field the team has not named reads null, never zero. */
  const empty = teamLaunchConstitution(EMPTY_TEAM_LAUNCH_DRAFT, termsOf(LAUNCH_PRESETS.classic));
  assert.equal(empty.find((row) => row.key === "treasury").value, null);
  assert.equal(empty.find((row) => row.key === "team").value, null);
  /* No price is promised anywhere. */
  assert.equal(rows.find((row) => row.key === "promise").value, "none");
  /* The rules are read after the launch, never rewritten. */
  assert.equal(rows.find((row) => row.key === "rulesChangeable").value, "no");
});

test("the chronicle says who writes each row, and promises no ladder nothing funds", () => {
  /* The demo market is Ryntra's own: its executor claims the budget there, so the ladder may be promised on it. */
  const micro = termsOf(LAUNCH_PRESETS.demo);
  const off = teamLaunchChronicle(wholeDraft(), micro);
  assert.ok(!off.some((row) => row.key === "LIQUIDITY_REBALANCING"));
  const on = wholeDraft({ curve: { preset: "demo", firstBuyQuoteRaw: "0", firstBuyLockDays: 0 }, automation: { ladder: true, deployedBpsMax: 1_000, pauseOnDropBps: 1_000, stopByHand: false } });
  const rows = teamLaunchChronicle(on, micro);
  assert.ok(rows.some((row) => row.key === "LIQUIDITY_REBALANCING"));
  assert.ok(!rows.some((row) => row.key === "STOPPED_BY_TEAM"));
  assert.equal(rows.find((row) => row.key === "INCIDENTS").enforcement, "NOT_IMPLEMENTED");
  for (const row of rows) assert.ok(["team", "venue", "executor"].includes(row.by), row.key);
  /* Where nothing funds the budget — the partner's role on the multisig, or fees still waiting in the pool — the
     ladder is not promised, however step 07 was filled. */
  for (const terms of [termsOf(LAUNCH_PRESETS.classic), termsOf(LAUNCH_PRESETS.micro)]) {
    assert.equal(ladderRuns(on, terms), false, terms.id);
    assert.ok(!teamLaunchChronicle(on, terms).some((row) => row.key === "LIQUIDITY_REBALANCING"), terms.id);
    assert.equal(teamLaunchConstitution(on, terms).find((row) => row.key === "ladder").value, "off", terms.id);
  }
  assert.equal(teamLaunchConstitution(on, micro).find((row) => row.key === "ladder").value, "on");
});

/* ------------------------------------------------------------ the review */

test("the review is one call: simulation, fees, budget, Constitution, chronicle", () => {
  const draft = wholeDraft();
  const review = teamLaunchReview(draft);
  assert.deepEqual(review.problems, []);
  assert.ok(feeLinesHold(review.fees));
  assert.equal(review.simulation.supplyRaw, supplyRawOf(draft.token));
  assert.equal(review.simulation.circulatingRaw + review.simulation.lockedRaw, review.simulation.supplyRaw);
  assert.equal(
    review.simulation.allocation.reduce((sum, unit) => sum + unit.unitsRaw, 0n),
    review.simulation.supplyRaw,
  );
  /* 60 % circulating on day one becomes 60 % of the whole once every lock has opened: arithmetic, not a forecast. */
  assert.equal(review.simulation.dilutionBps, 6_000);
  assert.ok(review.constitution.length > 0);
  assert.ok(review.chronicle.length > 0);
  /* A preset nobody registered falls back to Classic rather than throwing — and the step says the preset is wrong. */
  const wrong = teamLaunchReview({ ...draft, curve: { ...draft.curve, preset: "nothing" } });
  assert.equal(wrong.simulation.preset, "classic");
  assert.deepEqual(wrong.problems, ["STEPS_BEFORE"]);
});
