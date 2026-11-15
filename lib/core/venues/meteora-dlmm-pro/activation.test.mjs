// When a DLMM Pro pool is open, and to whom — held to the bytes the SDK encodes.
import assert from "node:assert/strict";
import test from "node:test";

import { bondingCurveActivationParameters, openActivationParameters, timeBasedActivationParameters } from "@meteora-ag/dlmm-pro-sdk";
import BN from "bn.js";

const { DEFAULT_KEY, actionGateOf, activationRulesOf, activationStateOf, bondingCurveTargetSqrtPrice, decodeActivationSlot, pausedBy } = await import("./activation.ts");

const CREATOR = "CReAtoR111111111111111111111111111111111111";
const STRANGER = "StRanGeR11111111111111111111111111111111111";
const slotOf = (parameters) => decodeActivationSlot(parameters.activationMode, parameters.data);

test("an activation slot decodes from the bytes the SDK encodes, in every mode", () => {
  assert.deepEqual(slotOf(openActivationParameters()), { mode: "open" });
  assert.deepEqual(slotOf(timeBasedActivationParameters({ swapPoint: new BN(1_794_661_200), addLiquidityPoint: new BN(1_794_661_260), removeLiquidityPoint: new BN(1_794_747_600) })), {
    mode: "timeBased",
    swapPoint: 1_794_661_200,
    addLiquidityPoint: 1_794_661_260,
    removeLiquidityPoint: 1_794_747_600,
  });
  /* Five bytes a point: the largest still reads whole. */
  assert.equal(slotOf(timeBasedActivationParameters({ swapPoint: new BN("1099511627775"), addLiquidityPoint: new BN(0), removeLiquidityPoint: new BN(1) })).swapPoint, 1_099_511_627_775);
  assert.deepEqual(slotOf(bondingCurveActivationParameters({ targetIncreaseBps: 20_000 })), { mode: "bondingCurve", reached: false, targetIncreaseBps: 20_000n });
  const reached = bondingCurveActivationParameters({ targetIncreaseBps: 15_000 });
  assert.equal(decodeActivationSlot(reached.activationMode, [1, ...reached.data.slice(1)]).reached, true);
  assert.throws(() => decodeActivationSlot(3, new Array(15).fill(0)), /Unknown activation mode/);
  assert.throws(() => decodeActivationSlot(0, new Array(14).fill(0)), /15 bytes/);
});

const timed = (overrides = {}) =>
  activationRulesOf({
    whitelistedSwap: DEFAULT_KEY,
    whitelistedAddLiquidity: CREATOR,
    whitelistedRemoveLiquidity: DEFAULT_KEY,
    activations: [openActivationParameters(), timeBasedActivationParameters({ swapPoint: new BN(1_000), addLiquidityPoint: new BN(1_000), removeLiquidityPoint: new BN(2_000) })],
    ...overrides,
  });

test("a timed launch: closed to everyone before its time, open to the one early depositor, open to all after", () => {
  const rules = timed();
  assert.equal(rules.whitelistedSwap, null, "the default key is nobody");
  assert.equal(rules.whitelistedAddLiquidity, CREATOR);
  const before = (wallet) => activationStateOf({ rules, poolStatus: 0, point: 999, wallet });
  assert.deepEqual(before(STRANGER).swap, { open: false, reason: "time", opensAt: 1_000 });
  assert.deepEqual(before(STRANGER).addLiquidity, { open: false, reason: "time", opensAt: 1_000 });
  assert.deepEqual(before(CREATOR).addLiquidity, { open: true, reason: "whitelisted", opensAt: 1_000 });
  assert.deepEqual(before(CREATOR).swap, { open: false, reason: "time", opensAt: 1_000 }, "the depositor's exemption is for deposits alone");
  assert.deepEqual(before(null).addLiquidity, { open: false, reason: "time", opensAt: 1_000 }, "asked for everyone, a whitelist opens nothing");
  const at = activationStateOf({ rules, poolStatus: 0, point: 1_000, wallet: STRANGER });
  assert.deepEqual(at.swap, { open: true, reason: "open", opensAt: 1_000 });
  assert.deepEqual(at.addLiquidity, { open: true, reason: "open", opensAt: 1_000 });
  assert.deepEqual(at.removeLiquidity, { open: false, reason: "time", opensAt: 2_000 }, "each action has its own point");
  assert.equal(activationStateOf({ rules, poolStatus: 0, point: 2_000, wallet: STRANGER }).removeLiquidity.open, true);
});

test("the operator's pause stands above the rules — the whitelisted wallet too — and taking out is never paused", () => {
  const rules = timed();
  assert.equal(pausedBy(1, "swap"), true);
  assert.equal(pausedBy(2, "swap"), false);
  assert.equal(pausedBy(2, "addLiquidity"), true);
  assert.equal(pausedBy(3, "removeLiquidity"), false);
  assert.deepEqual(actionGateOf({ rules, poolStatus: 2, action: "addLiquidity", point: 999, wallet: CREATOR }), { open: false, reason: "paused", opensAt: 1_000 });
  assert.deepEqual(actionGateOf({ rules, poolStatus: 2, action: "addLiquidity", point: 5_000, wallet: STRANGER }), { open: false, reason: "paused", opensAt: 1_000 });
  assert.deepEqual(actionGateOf({ rules: null, poolStatus: 1, action: "swap", point: 0, wallet: null }), { open: false, reason: "paused", opensAt: null });
  assert.equal(actionGateOf({ rules, poolStatus: 3, action: "removeLiquidity", point: 2_000, wallet: STRANGER }).open, true);
});

test("a pool without the extension is open from its first block", () => {
  const state = activationStateOf({ rules: null, poolStatus: 0, point: 0, wallet: null });
  for (const gate of Object.values(state)) assert.deepEqual(gate, { open: true, reason: "open", opensAt: null });
});

test("a bonding-curve slot: swaps always, liquidity only once the price has reached the target — named as a price, since no clock opens it", () => {
  const curve = (reachedByte) => {
    const parameters = bondingCurveActivationParameters({ targetIncreaseBps: 20_000 });
    return activationRulesOf({ whitelistedSwap: DEFAULT_KEY, whitelistedAddLiquidity: CREATOR, whitelistedRemoveLiquidity: DEFAULT_KEY, activations: [openActivationParameters(), { activationMode: parameters.activationMode, data: [reachedByte, ...parameters.data.slice(1)] }] });
  };
  const waiting = (wallet) => activationStateOf({ rules: curve(0), poolStatus: 0, point: 10, wallet });
  assert.deepEqual(waiting(STRANGER).swap, { open: true, reason: "open", opensAt: null });
  assert.deepEqual(waiting(STRANGER).addLiquidity, { open: false, reason: "price", opensAt: null });
  assert.deepEqual(waiting(STRANGER).removeLiquidity, { open: false, reason: "price", opensAt: null });
  assert.deepEqual(waiting(CREATOR).addLiquidity, { open: true, reason: "whitelisted", opensAt: null });
  assert.equal(activationStateOf({ rules: curve(1), poolStatus: 0, point: 10, wallet: STRANGER }).addLiquidity.open, true);
  /* The basis points are of the square-root price: 20 000 is twice the square root — four times the price. */
  assert.equal(bondingCurveTargetSqrtPrice(1n << 64n, 20_000n), 2n << 64n);
});

test("a pool has exactly two slots", () => {
  assert.throws(() => activationRulesOf({ whitelistedSwap: DEFAULT_KEY, whitelistedAddLiquidity: DEFAULT_KEY, whitelistedRemoveLiquidity: DEFAULT_KEY, activations: [openActivationParameters()] }), /two activation slots/);
});
