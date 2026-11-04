import assert from "node:assert/strict";
import test from "node:test";

import * as sdk from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";

import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS } from "../../../lib/core/venues/meteora-dbc/presets.ts";
import { presetCurve } from "../../../lib/core/venues/meteora-dbc/launch.server.ts";
import { CITY_DEFAULT_PRESET, cityPreset } from "./gate.ts";
import { CITY_SHIELD, CITY_SHIELD_MAINNET, CITY_SHIELD_SWITCH, cityShieldOpen, cityStartPreset, creatorVests, shieldServed, shieldsBots, towerHalo } from "./shield.ts";
import { STUB_PRESETS, STUB_PRESETS_ANSWER } from "./stub.ts";
import { reviewRows } from "./terms.ts";

const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, usdPrice: 1 };

test("the shield stays closed until the deployment opens it, and mainnet waits for a release decision", () => {
  /* Nothing in the code opens it: the switch is the deployment's variable, the mainnet default the operator's one line. */
  assert.equal(CITY_SHIELD_SWITCH, process.env.NEXT_PUBLIC_RYNTRA_CITY_SHIELD === "open");
  assert.equal(CITY_SHIELD_MAINNET, false);
  assert.equal(cityShieldOpen("solana:devnet", false, false), false);
  assert.equal(cityShieldOpen("solana:mainnet", true, false), false);
  assert.equal(cityShieldOpen("solana:devnet", false, true), true);
  assert.equal(cityShieldOpen("solana:mainnet", false, true), false);
  assert.equal(cityShieldOpen("solana:mainnet", true, true), true);
  assert.equal(cityShieldOpen(null, true, true), false);
});

test("the sheet opens on the shield where it is open, and on the city's default elsewhere", () => {
  assert.equal(cityStartPreset("solana:devnet", false), CITY_DEFAULT_PRESET);
  assert.equal(cityStartPreset("solana:devnet", true), "classic");
  assert.equal(cityPreset(STUB_PRESETS_ANSWER, cityStartPreset("solana:devnet", true))?.id, "classic");
  /* Closed, nothing moves: the city keeps the preset it opened on before the shield. */
  assert.equal(cityPreset(STUB_PRESETS_ANSWER, cityStartPreset("solana:devnet", false))?.id, "protected");
});

test("the shield is the engine's Classic: 20 % → 1 % over 2 min on the DBC fee scheduler", () => {
  const table = LAUNCH_PRESETS[CITY_SHIELD.preset];
  assert.ok(PEOPLE_PRESET_IDS.includes(CITY_SHIELD.preset));
  assert.deepEqual(CITY_SHIELD.sniperFee, { startBps: 2_000, endBps: 100, seconds: 120 });
  assert.equal(table.sniperFee.startBps, CITY_SHIELD.sniperFee.startBps);
  assert.equal(table.sniperFee.endBps, CITY_SHIELD.sniperFee.endBps);
  assert.equal(table.sniperFee.seconds, CITY_SHIELD.sniperFee.seconds);
  /* The creator's first purchase, if any, pays the end fee, and no tokens are allocated outside the curve. */
  const curve = presetCurve(table, USDC);
  assert.equal(curve.enableFirstSwapWithMinFee, true);
  assert.equal(curve.lockedVesting.amountPerPeriod.toString(), "0");
  /* The fee a buy pays, as Meteora's own SDK counts it from the config the engine signs, second by second. */
  const fee = curve.poolFees.baseFee;
  assert.equal(fee.baseFeeMode, sdk.BaseFeeMode.FeeSchedulerExponential);
  const at = (seconds) => sdk.feeNumeratorToBps(sdk.getBaseFeeNumerator(fee.cliffFeeNumerator, new BN(fee.firstFactor), fee.secondFactor, fee.thirdFactor, fee.baseFeeMode, new BN(seconds), new BN(0)));
  assert.equal(at(0), 2_000);
  const falling = [0, 4, 30, 60, 90, 116, 120].map(at);
  for (let i = 1; i < falling.length; i += 1) assert.ok(falling[i] < falling[i - 1], `falls: ${falling}`);
  assert.equal(at(120), 100);
  assert.equal(at(600), 100);
  assert.ok(at(116) > 100, "still above 1 % just before 2 min");
});

test("the city claims the shield only when the engine serves it number for number", () => {
  const classic = STUB_PRESETS.find((preset) => preset.id === "classic");
  const shielded = STUB_PRESETS.find((preset) => preset.id === "protected");
  assert.equal(shieldServed(classic), true);
  assert.equal(shieldServed(shielded), false);
  assert.equal(shieldServed({ ...classic, sniperFee: { startBps: 1_500, endBps: 100, seconds: 120 } }), false);
  assert.equal(shieldServed(null), false);
  /* Protected is at least as hard on bots, so its towers wear the halo too; a softer schedule does not. */
  assert.equal(shieldsBots(classic.sniperFee), true);
  assert.equal(shieldsBots(shielded.sniperFee), true);
  assert.equal(shieldsBots({ startBps: 1_000, endBps: 100, seconds: 120 }), false);
  assert.equal(shieldsBots({ startBps: 2_000, endBps: 200, seconds: 120 }), false);
  assert.equal(shieldsBots({ startBps: 2_000, endBps: 100, seconds: 60 }), false);
  assert.equal(shieldsBots(null), false);
});

test("«i» on the shield says what keeps the halo; closed, the review is as it was", () => {
  const classic = STUB_PRESETS.find((preset) => preset.id === "classic");
  const closed = reviewRows(classic, "solana:devnet");
  assert.equal(closed.some((row) => row.id === "halo"), false);
  const open = reviewRows(classic, "solana:devnet", null, true);
  const halo = open.find((row) => row.id === "halo");
  assert.ok(halo);
  assert.equal(halo.lines.length, 2);
  assert.deepEqual(open.map((row) => row.id), ["line", "fees", "halo", "yours", "pool", "forever", "route", "cost", "network"]);
  /* The cost and the fee before the signature stay first and unchanged. */
  assert.deepEqual(open[0], closed[0]);
  assert.match(open[0].lines[0], /1%/);
});

const TOWER = {
  network: "solana:devnet",
  ryntraTest: false,
  hidden: false,
  preset: "classic",
  mine: false,
  flow: null,
  creatorLocked: false,
  creatorSold: false,
};

test("the halo: born on the shield, the creator holds nothing to dump and has not sold", () => {
  /* A launch from this city buys nothing at birth. */
  assert.equal(towerHalo({ ...TOWER, mine: true }, true), true);
  /* The creator's first purchase under the creator's lock. */
  assert.equal(towerHalo({ ...TOWER, creatorLocked: true }, true), true);
  /* The flow read whole: the creator's wallet bought nothing here. */
  assert.equal(towerHalo({ ...TOWER, flow: { creatorBoughtBps: 0 } }, true), true);
  /* Protected is harder on bots still. */
  assert.equal(towerHalo({ ...TOWER, preset: "protected", creatorLocked: true }, true), true);
});

test("no halo on a guess, on a sale, or where the shield is closed", () => {
  /* Nothing known of the creator's tokens: not taken for a fact. */
  assert.equal(towerHalo(TOWER, true), false);
  assert.equal(towerHalo({ ...TOWER, flow: { creatorBoughtBps: null } }, true), false);
  assert.equal(towerHalo({ ...TOWER, flow: { creatorBoughtBps: 120 } }, true), false);
  /* The creator sold: the halo goes out, lock or not. */
  assert.equal(towerHalo({ ...TOWER, mine: true, creatorSold: true }, true), false);
  assert.equal(towerHalo({ ...TOWER, creatorLocked: true, creatorSold: true }, true), false);
  /* A sale not read whole does not put it out — and does not light it either without the creator's facts. */
  assert.equal(towerHalo({ ...TOWER, creatorLocked: true, creatorSold: null }, true), true);
  /* Ryntra's own check, a coin taken down, a preset the shield is not, an unknown preset. */
  assert.equal(towerHalo({ ...TOWER, mine: true, ryntraTest: true }, true), false);
  assert.equal(towerHalo({ ...TOWER, mine: true, hidden: true }, true), false);
  assert.equal(towerHalo({ ...TOWER, mine: true, preset: "advanced" }, true), true, "Розширений's template is Захищений's schedule");
  assert.equal(towerHalo({ ...TOWER, mine: true, preset: null }, true), false);
  assert.equal(towerHalo({ ...TOWER, mine: true, preset: "pump" }, true), false);
  /* Closed: no halo anywhere. */
  assert.equal(towerHalo({ ...TOWER, mine: true }, false), false);
  assert.equal(towerHalo({ ...TOWER, mine: true, network: "solana:mainnet" }), cityShieldOpen("solana:mainnet"));
});

test("creatorVests reads only facts", () => {
  assert.equal(creatorVests({ mine: false, flow: null }), false);
  assert.equal(creatorVests({ mine: false, flow: null, creatorLocked: true }), true);
  assert.equal(creatorVests({ mine: true, flow: null }), true);
  assert.equal(creatorVests({ mine: false, flow: { creatorBoughtBps: 0 } }), true);
});
