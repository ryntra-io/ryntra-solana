// L7 (CITY-144): a launch's tower joins the skyline only when its graduation passed the city's rule — enough
// independent buyers filled its curve and it spent enough time on it; below the bar it stays in the Docks as a «Fast
// exit» or «Graduated with N buyers». The rings of days 7, 30 and 90 burn on its crown only on a trade traced outside
// the creator's party. Read on fixed engine answers (`silhouette.fixture.json`): made-up, in the shape of
// `GET /api/v1/launch/{mint}/flow` (contract 1.89.0) and checked against its schema — the production engine is not
// reachable from a cloud session, so nothing here was captured from it.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { LaunchFlowResponseSchema } from "../../../lib/api/v1/contract.ts";
import { cityMoment } from "./moments.ts";
import { crownRings, FLOW_FRESH_MS, FLOW_SETTLED_MS, flowBehind, flowFreshMs, litRings, mergeFlow, needsFlow, omitGraduationPill, SILHOUETTE_RULE, silhouetteOf, towerFlowOf } from "./silhouette.ts";
import { stubEngine } from "./stub.ts";
import { shownLaunches, towerOf } from "./towers.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./silhouette.fixture.json", import.meta.url), "utf8"));
const MIN = 60_000;

/** A graduated launch tower carrying one of the fixed flows. */
function graduated(name, over = {}) {
  const flow = towerFlowOf(LaunchFlowResponseSchema.parse(FIXTURE[name]));
  return {
    token: FIXTURE[name].token,
    symbol: name.toUpperCase().slice(0, 8),
    name,
    image: null,
    launchedAt: FIXTURE[name].launchSlot.at,
    creator: FIXTURE[name].creator,
    preset: "protected",
    graduationUsd: 75_000,
    progress: 100,
    migrated: true,
    marketCapUsd: 120_000,
    liquidityUsd: 30_000,
    holders: 120,
    holdersAtLeast: false,
    checks: FIXTURE[name].survival.map((check) => check.state),
    phase: "orbit",
    crew: 0,
    ryntraTest: false,
    network: "solana:devnet",
    mine: false,
    hidden: false,
    flow,
    awaitingFlow: false,
    ...over,
  };
}

/** The same flow with its graduation moved: `minutes` after the creation, `buyers` independent buyers. */
function edited(name, { minutes, buyers, atLeast }) {
  const flow = towerFlowOf(LaunchFlowResponseSchema.parse(FIXTURE[name]));
  const at = minutes === undefined ? flow.graduatedAt : new Date(Date.parse(flow.createdAt) + minutes * MIN).toISOString();
  return { ...flow, graduatedAt: at, buyers: buyers ?? flow.buyers, atLeast: atLeast ?? flow.atLeast };
}

test("the fixed flows fit the contract", () => {
  for (const answer of Object.values(FIXTURE)) LaunchFlowResponseSchema.parse(answer);
});

test("the thresholds are the session's proposal, waiting for a decision on the numbers", () => {
  assert.equal(SILHOUETTE_RULE.minBuyers, 50);
  assert.equal(SILHOUETTE_RULE.minCurveMinutes, 15);
  assert.equal(SILHOUETTE_RULE.ownerWord, false, "turns true only once the numbers are decided");
  assert.ok(Object.isFrozen(SILHOUETTE_RULE));
});

test("a graduation with 64 independent buyers after 2 h 10 min on its curve stands in the skyline", () => {
  const tower = graduated("skyline");
  assert.deepEqual(silhouetteOf(tower), { stand: "skyline", status: "skyline", buyers: 64, atLeast: false, curveMinutes: 130 });
  assert.equal(towerOf(tower).district, "strip");
});

test("a curve filled in 6 minutes is a fast exit and stays in the Docks, whatever its buyers", () => {
  const tower = graduated("fast");
  const silhouette = silhouetteOf(tower);
  assert.equal(silhouette.stand, "docks");
  assert.equal(silhouette.status, "fast");
  assert.equal(silhouette.curveMinutes, 6);
  assert.equal(towerOf(tower).district, "docks");
  assert.equal(silhouetteOf({ ...tower, flow: edited("fast", { buyers: 400 }) }).status, "fast", "time is a bar of its own");
});

test("too few independent buyers: «graduated with N buyers», a floor said as one, in the Docks", () => {
  const silhouette = silhouetteOf(graduated("few"));
  assert.deepEqual(silhouette, { stand: "docks", status: "few", buyers: 22, atLeast: true, curveMinutes: 180 });
  /* A floor already above the bar is enough: the true count is at least that. */
  assert.equal(silhouetteOf(graduated("few", { flow: edited("few", { buyers: 57, atLeast: true }) })).status, "skyline");
});

test("the bars are inclusive: 15 minutes and 50 buyers pass, a second or a buyer less does not", () => {
  const at = (minutes, buyers) => silhouetteOf(graduated("skyline", { flow: edited("skyline", { minutes, buyers }) })).status;
  assert.equal(at(15, 50), "skyline");
  assert.equal(at(15 - 1 / 60, 50), "fast");
  assert.equal(at(15, 49), "few");
  assert.equal(silhouetteOf(graduated("skyline", { flow: edited("skyline", { minutes: 30, buyers: 10 }) }), { minBuyers: 5, minCurveMinutes: 60 }).status, "fast", "the rule's numbers are the config's, nowhere else");
});

test("a graduation whose time was not read, or a flow read before it, is never put in the skyline", () => {
  const untimed = silhouetteOf(graduated("untimed"));
  assert.equal(untimed.stand, "docks");
  assert.equal(untimed.status, "unread");
  assert.equal(untimed.buyers, 233, "what was read is still said");
  const early = graduated("curve");
  assert.equal(silhouetteOf(early).status, "unread");
  assert.equal(silhouetteOf(early).stand, "docks");
  assert.ok(flowBehind(early, early.flow), "a flow read before the graduation is due again");
  assert.ok(!flowBehind(graduated("skyline"), graduated("skyline").flow));
});

test("a graduated tower seen for the first time waits for its flow; once asked and not given, it stands in the Docks", () => {
  const first = graduated("skyline", { flow: null, awaitingFlow: true });
  assert.equal(silhouetteOf(first).stand, "held");
  assert.equal(shownLaunches([first]).length, 0, "held back from the city, not placed and moved later");
  const missed = { ...first, awaitingFlow: false };
  assert.equal(silhouetteOf(missed).stand, "docks");
  assert.equal(towerOf(missed).district, "docks");
  /* On its curve the flow decides nothing. */
  assert.equal(silhouetteOf({ ...first, migrated: false }).stand, "docks");
  assert.equal(silhouetteOf({ ...first, migrated: false }).status, "curve");
});

test("the crown's rings: lit only on a trade outside the creator's party, and only once the flow confirmed it", () => {
  const skyline = graduated("skyline");
  assert.deepEqual(crownRings(skyline.checks, skyline.flow.survival), ["alive", "unread", "young"], "day 30's trader was not traced: not known to be outside the creator's party, not lit");
  assert.deepEqual(litRings(crownRings(skyline.checks, skyline.flow.survival)), [7]);
  const few = graduated("few");
  assert.deepEqual(crownRings(few.checks, few.flow.survival), ["unproven", "young", "young"], "day 7 only by the creator's own wallets");
  assert.deepEqual(litRings(crownRings(few.checks, few.flow.survival)), []);
  assert.deepEqual(crownRings(["alive", "alive", "alive"], null), ["unread", "unread", "unread"], "no flow, no ring");
  assert.deepEqual(crownRings(["alive", "young", "young"], graduated("curve").flow.survival), ["unread", "young", "young"], "a check passed since the flow was read waits for it");
  assert.ok(flowBehind({ migrated: false, checks: ["alive", "young", "young"] }, graduated("curve").flow));
  const old = graduated("untimed");
  assert.deepEqual(litRings(crownRings(old.checks, old.flow.survival)), [7, 30, 90]);
});

test("a count that is a floor never counts a tower down; one read whole is taken as it is", () => {
  const kept = edited("skyline", { buyers: 55, atLeast: true });
  assert.equal(mergeFlow(kept, { ...kept, buyers: 48, atLeast: true }).buyers, 55, "a smaller floor: fewer traced, not fewer bought");
  assert.equal(mergeFlow(kept, { ...kept, buyers: 61, atLeast: true }).buyers, 61);
  assert.equal(mergeFlow(kept, { ...kept, buyers: 41, atLeast: false }).buyers, 41, "counted whole: a cluster found since merges wallets");
  assert.equal(mergeFlow(null, kept), kept);
});

test("a flow rests once what the city shows from it cannot change; it is read again soon while it can", () => {
  const tower = { migrated: true, launchedAt: null };
  const traced = [{ state: "alive", independent: true }, { state: "young", independent: null }, { state: "young", independent: null }];
  const passing = { ...edited("skyline", { buyers: 140, atLeast: true }), survival: traced };
  assert.equal(flowFreshMs(tower, passing), FLOW_SETTLED_MS, "a floor already past the bar only rises");
  assert.equal(flowFreshMs(tower, { ...passing, buyers: 30 }), FLOW_FRESH_MS, "a floor below the bar may still pass it");
  assert.equal(flowFreshMs(tower, { ...edited("fast", { buyers: 3, atLeast: true }), survival: traced }), FLOW_SETTLED_MS, "a fast exit stays one");
  assert.equal(flowFreshMs(tower, { ...passing, buyers: 30, atLeast: false }), FLOW_SETTLED_MS, "counted whole");
  assert.equal(flowFreshMs({ migrated: false, launchedAt: null }, { ...passing, graduated: false }), FLOW_SETTLED_MS, "on its curve: only its rings matter");
  assert.equal(flowFreshMs(tower, edited("skyline", {})), FLOW_FRESH_MS, "day 30's trader not traced yet: read again soon");
});

test("the curve's time falls back to the engine's launch time; a time that reads backwards is not a time", () => {
  const flow = { ...edited("skyline", {}), createdAt: null };
  const at = (launchedAt) => silhouetteOf({ migrated: true, launchedAt, flow, awaitingFlow: false });
  const graduatedAt = Date.parse(flow.graduatedAt);
  assert.equal(at(new Date(graduatedAt - 40 * MIN).toISOString()).curveMinutes, 40);
  assert.equal(at(new Date(graduatedAt - 40 * MIN).toISOString()).status, "skyline");
  assert.equal(at(new Date(graduatedAt + 5 * MIN).toISOString()).status, "unread");
  assert.equal(at(null).status, "unread");
});

test("the window leaves out the flow's graduation pill under «graduated with N buyers» — never the one-buy warning", () => {
  const few = silhouetteOf(graduated("few"));
  assert.equal(omitGraduationPill(few, false), true);
  assert.equal(omitGraduationPill(few, true), false, "graduated on one buy: the warning stays");
  assert.equal(omitGraduationPill({ ...few, buyers: 0 }, false), false, "no figure on top: the pill says it");
  assert.equal(omitGraduationPill(silhouetteOf(graduated("fast")), false), false);
});

test("the feed reads a flow only for a graduated tower or one with a passed check", () => {
  assert.equal(needsFlow({ migrated: false, checks: ["young", "young", "young"] }), false);
  assert.equal(needsFlow({ migrated: false, checks: ["quiet", "young", "young"] }), false);
  assert.equal(needsFlow({ migrated: false, checks: ["alive", "young", "young"] }), true);
  assert.equal(needsFlow({ migrated: true, checks: ["young", "young", "young"] }), true);
});

test("the skyline takes the towers that passed, day-90 landmarks first; a graduation below the bar keeps the Docks", () => {
  const shown = shownLaunches([graduated("fast"), graduated("few"), graduated("skyline"), graduated("untimed")]);
  const where = Object.fromEntries(shown.map((launch) => [launch.name, towerOf(launch).district]));
  assert.deepEqual(where, { fast: "docks", few: "docks", untimed: "docks", skyline: "strip" });
  const landmark = graduated("skyline", { token: FIXTURE.untimed.token, name: "landmark", flow: { ...edited("untimed", { minutes: 200 }), createdAt: FIXTURE.untimed.launchSlot.at }, checks: ["alive", "alive", "alive"] });
  const skyline = shownLaunches([graduated("skyline"), landmark]).filter((launch) => towerOf(launch).district === "strip");
  assert.deepEqual(skyline.map((launch) => launch.name), ["landmark", "skyline"]);
});

test("a graduation is «into the skyline» only when it passed the rule; below it, «graduated»", () => {
  const orbit = (tower) => cityMoment({ type: "orbit", id: tower.token, at: null, payoutUsd: null, signature: null }, tower);
  assert.deepEqual(orbit(graduated("skyline")), { kind: "pump", towerId: FIXTURE.skyline.token, symbol: "SKYLINE", title: "Into the skyline", value: "$75K · POOL OPEN" });
  assert.equal(orbit(graduated("fast")).title, "Graduated");
  assert.equal(orbit(graduated("few")).title, "Graduated");
  assert.equal(orbit(graduated("skyline", { flow: null })).title, "Graduated", "facts not read yet: not claimed");
});

test("on the stand: Moth and Night Owl stand in the skyline, Zipline is a fast exit, Reef graduated with too few buyers", async () => {
  const engine = stubEngine({ now: () => Date.parse("2026-10-30T12:00:00Z") });
  const markets = await engine.markets();
  const at = {};
  for (const symbol of ["MOTH", "OWL", "ZIP", "REEF"]) {
    const row = markets.data.markets.find((market) => market.symbol === symbol);
    const answer = await engine.flow(row.token);
    const flow = towerFlowOf(LaunchFlowResponseSchema.parse(answer.data));
    at[symbol] = silhouetteOf({ migrated: true, launchedAt: row.launchedAt, flow, awaitingFlow: false }).status;
    if (symbol === "REEF") assert.deepEqual(litRings(crownRings(["alive", "young", "young"], flow.survival)), [], "Reef's day 7 was its creator's own trade");
    if (symbol === "OWL") assert.deepEqual(litRings(crownRings(["alive", "alive", "alive"], flow.survival)), [7, 30, 90]);
  }
  assert.deepEqual(at, { MOTH: "skyline", OWL: "skyline", ZIP: "fast", REEF: "few" });
});
