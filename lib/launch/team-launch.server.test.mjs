// MOS-2 — Team Launch on the server: the switch, the TEAM-1 rights of every step, and the one EXE-2 actionId each
// step writes. Run: node --test lib/launch/team-launch.server.test.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { ACTION_COLLECTIONS } from "../core/actions/model.ts";
import { readAction } from "../core/actions/ledger.ts";
import { EMPTY_TEAM_LAUNCH_DRAFT, TEAM_LAUNCH_STEPS, teamLaunchStepByKey } from "../core/launch/team-launch.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { createMemoryTeamStore } from "../team/store.ts";
import { changeMember, createTeam, inviteMember, linkTreasury } from "../team/service.server.ts";
import { TEAM_LAUNCH_CLOSED_MESSAGE, commitTeamLaunchStep, stepIdempotencyKey } from "./team-launch.server.ts";

const OWNER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const OPERATOR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const VIEWER = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const STRANGER = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const TREASURY = "AmKrrLoHrYr7EUu5zMzAvYYADCiZ8SNFjd85uwjSSUVo";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** A multisig on which the operator may propose and the operator may not. */
const SIGNERS = [
  { address: OWNER, initiate: true, vote: true, execute: true },
  { address: OPERATOR, initiate: false, vote: true, execute: false },
];

const NETWORK = {
  cluster: "mainnet",
  chain: "solana:mainnet",
  configs: {},
  pairs: { classic: { mint: USDC, symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true }, micro: { mint: USDC, symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true } },
  communities: [],
  advanced: null,
  explorer: () => "",
  origin: "https://ryntra.io",
};

const OPEN = { RYNTRA_TEAM_LAUNCH: "open", NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" };

function depsOf(over = {}) {
  const store = createMemoryGuardStore();
  /* One deployment, one env: the team's checks and the Team Launch switch read the same variables (`process.env`). */
  const env = over.env ?? OPEN;
  const team = {
    store: createMemoryTeamStore(),
    network: "solana:mainnet",
    now: () => new Date("2026-10-26T12:00:00Z"),
    readSigners: async (address) => {
      if (address === TREASURY) return SIGNERS;
      throw Object.assign(new Error("No multisig"), { code: "TREASURY_NOT_FOUND" });
    },
    env,
    newId: () => randomBytes(12).toString("hex"),
  };
  return { team, store, network: NETWORK, now: () => new Date("2026-10-26T12:00:00Z"), ...over, env };
}

/** A team with a linked treasury, an Owner, a Launch Operator and a Viewer. */
async function teamWith(deps, { treasury = true } = {}) {
  const made = await createTeam(deps.team, { wallet: OWNER, name: "Crew Labs", kind: "PROJECT_TEAM" });
  assert.equal(made.ok, true);
  const id = made.state.team.id;
  for (const [wallet, role] of [
    [OPERATOR, "LAUNCH_OPERATOR"],
    [VIEWER, "VIEWER"],
  ]) {
    assert.equal((await inviteMember(deps.team, { id, actor: OWNER, wallet, role })).ok, true);
    assert.equal((await changeMember(deps.team, { id, actor: wallet, wallet, change: { action: "accept" } })).ok, true);
  }
  if (treasury) assert.equal((await linkTreasury(deps.team, { id, actor: OWNER, multisig: TREASURY })).ok, true);
  return id;
}

/** A draft every step of which holds, for one team. */
const draftOf = (teamId, over = {}) => ({
  ...EMPTY_TEAM_LAUNCH_DRAFT,
  teamId,
  project: { name: "Crew Labs", summary: "Один ринок однієї команди, усі правила до підпису.", website: "https://ryntra.io", x: "@ryntra" },
  token: { ...EMPTY_TEAM_LAUNCH_DRAFT.token, name: "Crew", symbol: "CREW" },
  allocation: [
    { category: "community", pct: 70, recipient: OPERATOR, cliffDays: 0, unlockDays: 0 },
    { category: "team", pct: 30, recipient: TREASURY, cliffDays: 180, unlockDays: 720 },
  ],
  rights: { treasury: TREASURY, feeShares: [], rulesChangeable: false },
  ...over,
});

const step = (key) => teamLaunchStepByKey(key);

test("closed by default: nothing of Team Launch happens on a deployment that has not set the switch", async () => {
  const deps = depsOf({ env: { NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" } });
  const id = await teamWith(deps);
  const refused = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("project"), draft: draftOf(id) });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "CLOSED");
  /* Nothing was written: a closed deployment keeps no journal row for a step it did not take. */
  assert.deepEqual(await deps.store.collection(ACTION_COLLECTIONS.intents).valuesWithPrefix(""), []);
});

test("the canary serves the wallets it names and nobody else, and says nothing of itself", () => {
  const canary = depsOf({ env: { RYNTRA_TEAM_LAUNCH: "open", RYNTRA_TEAM_LAUNCH_WALLETS: OWNER, NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" } });
  return (async () => {
    const id = await teamWith(canary);
    const owner = await commitTeamLaunchStep(canary, { wallet: OWNER, step: step("project"), draft: draftOf(id) });
    assert.equal(owner.ok, true);
    const other = await commitTeamLaunchStep(canary, { wallet: OPERATOR, step: step("project"), draft: draftOf(id) });
    assert.equal(other.ok, false);
    assert.equal(other.code, "NOT_WHITELISTED");
    /* Word for word what a closed deployment says: the refusal never tells a stranger a canary is running. */
    const closed = depsOf({ env: { NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" } });
    const shut = await commitTeamLaunchStep(closed, { wallet: OPERATOR, step: step("project"), draft: draftOf(await teamWith(closed)) });
    assert.equal(shut.code, "CLOSED");
    assert.equal(other.message, shut.message);
    assert.equal(other.message, TEAM_LAUNCH_CLOSED_MESSAGE);
  })();
});

test("the canary's own step 08 goes through: the switch opens the EXE-1 row, the whitelist says who", async () => {
  const canary = depsOf({ env: { RYNTRA_TEAM_LAUNCH: "open", RYNTRA_TEAM_LAUNCH_WALLETS: OWNER, NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" } });
  const id = await teamWith(canary);
  const signed = await commitTeamLaunchStep(canary, { wallet: OWNER, step: step("review"), draft: draftOf(id) });
  assert.equal(signed.ok, true, signed.ok ? "" : signed.message);
  assert.equal(signed.decisions.deploy.allowed, true);
  assert.equal(signed.decisions.sign.allowed, true);
  assert.ok(signed.review);
});

test("every step writes one actionId, and the same step with the same fields replays it", async () => {
  const deps = depsOf();
  const id = await teamWith(deps);
  const draft = draftOf(id);
  const seen = new Map();
  for (const entry of TEAM_LAUNCH_STEPS) {
    /* The operator holds every step; the operator's own steps are checked below. */
    const committed = await commitTeamLaunchStep(deps, { wallet: OWNER, step: entry, draft });
    assert.equal(committed.ok, true, `${entry.key}: ${committed.ok ? "" : committed.message}`);
    assert.equal(committed.replay, false, entry.key);
    assert.match(committed.actionId, /^act_[0-9a-f]{32}$/);
    seen.set(entry.key, committed.actionId);
    /* The journal holds it, under the EXE-1 row of Team Launch, as this team's action by this member. */
    const read = await readAction(deps.store, committed.actionId);
    assert.equal(read.action.authorityId, "ryntra.team-launch");
    assert.equal(read.action.orgId, id);
    assert.deepEqual(read.action.actor, { kind: "TEAM_MEMBER", id: OWNER });
    assert.equal(read.action.status, "OPENED");
    /* A draft spends nothing; step 08 names what the signature would spend. */
    assert.equal(read.action.spend.amountRaw, entry.key === "review" ? draft.curve.firstBuyQuoteRaw : "0");
    assert.equal(read.action.spend.mint, USDC);
  }
  /* Eight steps, eight actions — no step shares another's row. */
  assert.equal(new Set(seen.values()).size, 8);

  /* «Далі» pressed twice: the one action replays rather than a second one opening. */
  const again = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("project"), draft });
  assert.equal(again.ok, true);
  assert.equal(again.replay, true);
  assert.equal(again.actionId, seen.get("project"));

  /* A step whose own fields changed opens its own action; a step the team did not touch still replays. */
  const renamed = draftOf(id, { project: { name: "Crew Labs II", summary: "Той самий ринок, інша назва проєкту.", website: "", x: "" } });
  const changed = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("project"), draft: renamed });
  assert.equal(changed.ok, true);
  assert.equal(changed.replay, false);
  assert.notEqual(changed.actionId, seen.get("project"));
  const untouched = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("token"), draft: renamed });
  assert.equal(untouched.replay, true);
  assert.equal(untouched.actionId, seen.get("token"));
  assert.notEqual(stepIdempotencyKey({ step: step("project"), draft, wallet: OWNER, recipient: TREASURY, spendRaw: "0" }), stepIdempotencyKey({ step: step("project"), draft: renamed, wallet: OWNER, recipient: TREASURY, spendRaw: "0" }));

  /* Two members committing the same step are two actions, not a conflict: the key carries whose step it is. */
  const keyOf = (key, wallet, over = {}) => stepIdempotencyKey({ step: step(key), draft, wallet, recipient: TREASURY, spendRaw: "0", ...over });
  assert.notEqual(keyOf("token", OWNER), keyOf("token", OPERATOR));
  /* Everything the action's own digest covers is in the key: naming the treasury at step 06 must not turn an earlier
     step's record into an `IDEMPOTENCY_CONFLICT`. */
  assert.notEqual(keyOf("token", OWNER), keyOf("token", OWNER, { recipient: OWNER }));
  assert.notEqual(keyOf("review", OWNER), keyOf("review", OWNER, { spendRaw: "5" }));
  const second = await commitTeamLaunchStep(deps, { wallet: OPERATOR, step: step("token"), draft });
  assert.equal(second.ok, true, second.ok ? "" : second.message);
  assert.equal(second.replay, false);
  assert.notEqual(second.actionId, seen.get("token"));
});

test("naming the treasury later does not turn an earlier step's record into a conflict", async () => {
  const deps = depsOf();
  const id = await teamWith(deps);
  /* Steps 01–05 are drafted before step 06 names the treasury — and then walked again, as the wizard allows. */
  const before = draftOf(id, { rights: { treasury: null, feeShares: [], rulesChangeable: false } });
  const first = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("token"), draft: before });
  assert.equal(first.ok, true);
  const after = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("token"), draft: draftOf(id) });
  assert.equal(after.ok, true, after.ok ? "" : after.message);
  assert.equal(after.replay, false);
  assert.notEqual(after.actionId, first.actionId);
  /* And the same step with the same draft still replays rather than opening a third. */
  const again = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("token"), draft: draftOf(id) });
  assert.equal(again.replay, true);
  assert.equal(again.actionId, after.actionId);
});

test("the rights of TEAM-1 decide each step: a viewer none, a Launch Operator the draft", async () => {
  const deps = depsOf();
  const id = await teamWith(deps);
  const draft = draftOf(id);

  /* A viewer drafts nothing, and the refusal names the right, not «something went wrong». */
  const viewer = await commitTeamLaunchStep(deps, { wallet: VIEWER, step: step("project"), draft });
  assert.equal(viewer.ok, false);
  assert.equal(viewer.code, "FORBIDDEN");
  assert.equal(viewer.decision.refusal, "ROLE_DENIES");

  /* A stranger learns nothing of the team: the same refusal as a team that is not there. */
  const stranger = await commitTeamLaunchStep(deps, { wallet: STRANGER, step: step("project"), draft });
  assert.equal(stranger.ok, false);
  assert.equal(stranger.code, "NOT_FOUND");

  /* The Launch Operator drafts the market and names what the automation may do. */
  for (const key of ["project", "token", "allocation", "curve", "liquidity", "automation"]) {
    const committed = await commitTeamLaunchStep(deps, { wallet: OPERATOR, step: step(key), draft });
    assert.equal(committed.ok, true, key);
  }
  /* The rules money obeys are not the operator's: step 06 is `policy`, the operator's through the multisig. */
  const rules = await commitTeamLaunchStep(deps, { wallet: OPERATOR, step: step("rights"), draft });
  assert.equal(rules.ok, false);
  assert.equal(rules.decision.refusal, "ROLE_DENIES");
  const owner = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("rights"), draft });
  assert.equal(owner.ok, true);
  assert.equal(owner.decisions.policy.requires, "MULTISIG");
  assert.equal(owner.decisions.policy.multisig, TREASURY);

  /* Step 08 needs `sign` and `deploy`, both of them the treasury's: the operator proposes, the wallet that may not does not. */
  const signed = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("review"), draft });
  assert.equal(signed.ok, true);
  assert.equal(signed.decisions.sign.requires, "MULTISIG");
  assert.equal(signed.decisions.deploy.authority.id, "ryntra.team-launch");
  const operator = await commitTeamLaunchStep(deps, { wallet: OPERATOR, step: step("review"), draft });
  assert.equal(operator.ok, false);
  /* The operator votes but does not initiate: Squads itself refuses the proposal, read on chain. */
  assert.equal(operator.decision.refusal, "NOT_A_SIGNER");
});

test("a team with no treasury cannot pass step 06 or step 08, and the refusal says which", async () => {
  const deps = depsOf();
  const id = await teamWith(deps, { treasury: false });
  const draft = draftOf(id, { rights: { treasury: null, feeShares: [], rulesChangeable: false } });
  const rules = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("rights"), draft });
  assert.equal(rules.ok, false);
  assert.equal(rules.decision.refusal, "NO_TREASURY");
  const review = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("review"), draft });
  assert.equal(review.ok, false);
  assert.equal(review.decision.refusal, "NO_TREASURY");
  /* Drafting the market needs no treasury. */
  assert.equal((await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("token"), draft })).ok, true);
});

test("the server checks the step by the same rules the form did, and records nothing that does not hold", async () => {
  const deps = depsOf();
  const id = await teamWith(deps);
  /* Tokenomics that do not add up to 100 %: refused here even if a form let them through. */
  const broken = draftOf(id, { allocation: [{ category: "community", pct: 70, recipient: null, cliffDays: 0, unlockDays: 0 }] });
  const refused = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("allocation"), draft: broken });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "INVALID");
  assert.deepEqual(refused.problems, ["ALLOCATION"]);
  assert.deepEqual(await deps.store.collection(ACTION_COLLECTIONS.intents).valuesWithPrefix(""), []);
  /* Step 08 over a step that does not hold is refused before anything is simulated. */
  const review = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("review"), draft: broken });
  assert.equal(review.ok, false);
  assert.deepEqual(review.problems, ["STEPS_BEFORE", "RECIPIENTS_MISSING"]);
  /* A preset with no config on this network: said as the preset, never as a fault to retry. */
  const unserved = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("curve"), draft: draftOf(id, { curve: { preset: "protected", firstBuyQuoteRaw: "0", firstBuyLockDays: 0 } }) });
  assert.equal(unserved.ok, false);
  assert.deepEqual(unserved.problems, ["PRESET"]);
});

test("step 08 carries the review: the simulation, every fee as its own row, the budget, the Constitution, the chronicle", async () => {
  const deps = depsOf();
  const id = await teamWith(deps);
  const committed = await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("review"), draft: draftOf(id) });
  assert.equal(committed.ok, true);
  const { review } = committed;
  assert.deepEqual(review.problems, []);
  assert.equal(
    review.simulation.allocation.reduce((sum, unit) => sum + unit.unitsRaw, 0n),
    review.simulation.supplyRaw,
  );
  assert.ok(review.fees.length >= 10);
  /* Nothing funds the budget while Ryntra's executor does not claim it here: no ladder is promised on a guess. */
  assert.equal(review.budget.fundable, false);
  const served = await commitTeamLaunchStep({ ...deps, peopleServed: true }, { wallet: OWNER, step: step("review"), draft: draftOf(id, { curve: { preset: "micro", firstBuyQuoteRaw: "0", firstBuyLockDays: 180 } }) });
  assert.equal(served.ok, true, served.ok ? "" : served.message);
  assert.equal(served.review.budget.fundable, true);
  assert.ok(review.constitution.length > 0);
  assert.ok(review.chronicle.length > 0);
  /* Earlier steps carry no review: only step 08 shows what the signature would do. */
  assert.equal((await commitTeamLaunchStep(deps, { wallet: OWNER, step: step("token"), draft: draftOf(id) })).review, null);
});
