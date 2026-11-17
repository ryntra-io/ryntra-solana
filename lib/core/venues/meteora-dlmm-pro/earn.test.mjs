/**
 * Earning on DLMM Pro and an agent's care, with no network: the goals' arithmetic, and the venue's own
 * reads and builds replayed on moments the rehearsal froze (`scripts/launch-qa/dlmm-pro-earn-rehearsal.mjs --write`,
 * the build deployed on mainnet in LiteSVM) — and the care's rules held to the very bytes the rehearsal sent: the
 * three the agent may sign, which the program took, and every one it may not, which the program refused.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { VersionedTransaction } from "@solana/web3.js";

import { readFixture, rpcConnection, snapshotSource } from "./fixture-kit.mjs";

const { EARN_GOALS, EARN_STYLES, GOAL_BAND_SHARE, GOAL_MAX_RANGES, STYLE_STEPS, goalBandBps, goalPlanOf, isEarnGoal, isEarnStyle } = await import("./goals.ts");
const { CARE_RIGHTS, MAX_EARN_BAND_BPS } = await import("./earn.server.ts");
const { careCallOf, careRefusalOf } = await import("./care-rules.server.ts");
const { createDlmmProVenue } = await import("./venue.server.ts");
const { DlmmProRefusal } = await import("./sdk.server.ts");
const { MAX_TICK_ID, MIN_TICK_ID } = await import("./ticks.ts");

const fixture = readFixture(new URL("./fixtures/earn-rehearsal.json.gz", import.meta.url));
const { who, addresses, kept } = fixture;
const lands = () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null });
const at = (moment) => {
  const connection = rpcConnection(snapshotSource(fixture.snapshots[moment], {}, lands));
  return createDlmmProVenue({ connection, referralOwner: who.referral });
};
const refused = (work) => work().then(() => null, (error) => (error instanceof DlmmProRefusal ? error.code : `not a refusal: ${error}`));
const messageOf = (name) => VersionedTransaction.deserialize(Buffer.from(fixture.wires[name], "base64")).message.serialize();
const care = { agent: who.agent, owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition };

/* ------------------------------------------------------------------ the goals */

test("a goal and a width become a shape around the price: the city's own words, the city's own counts", () => {
  assert.deepEqual([...EARN_GOALS], ["even", "near", "edges"]);
  assert.deepEqual([...EARN_STYLES], ["calm", "balanced", "dense"]);
  assert.deepEqual({ ...STYLE_STEPS }, { calm: 34, balanced: 16, dense: 5 });
  assert.equal(isEarnGoal("near") && isEarnStyle("dense") && !isEarnGoal("moon") && !isEarnStyle(""), true);
  const pool = { tickSpacing: 10, tickCurrentId: -18_934 };
  for (const goal of EARN_GOALS) {
    for (const style of EARN_STYLES) {
      const plan = goalPlanOf(goal, style, pool);
      const steps = STYLE_STEPS[style];
      /* The step the price stands in, and the style's steps on each side of it. */
      assert.equal(plan.shape.minTickId, -18_940 - steps * 10);
      assert.equal(plan.shape.maxTickId, -18_940 + steps * 10);
      assert.equal(plan.tickUpperId, plan.shape.maxTickId + 10);
      assert.equal(plan.maxRanges, GOAL_MAX_RANGES[goal]);
      /* A tick is a ten-thousandth: the whole range is the style's steps on each side and the step the price stands in. */
      assert.ok(plan.downBps > 0 && plan.upBps > 0 && Math.abs(plan.downBps + plan.upBps - (2 * steps + 1) * 10) <= steps, `${goal}/${style}: ±${plan.downBps}/${plan.upBps} bps`);
    }
  }
  assert.equal(goalPlanOf("even", "calm", pool).maxRanges, 1, "an even shape is one range whatever its width");
  assert.equal(goalPlanOf("near", "calm", pool).shape.strategy, "curve");
  assert.equal(goalPlanOf("edges", "calm", pool).shape.strategy, "bidAsk");
});

test("at the program's last ticks a goal's range is cut there, and refused where a side is gone", () => {
  const spacing = 100;
  const high = goalPlanOf("even", "calm", { tickSpacing: spacing, tickCurrentId: MAX_TICK_ID - 1_050 });
  assert.ok(high.tickUpperId <= MAX_TICK_ID && high.shape.minTickId < high.shape.maxTickId);
  assert.equal(goalPlanOf("even", "calm", { tickSpacing: spacing, tickCurrentId: MAX_TICK_ID - 50 }), null);
  assert.equal(goalPlanOf("even", "calm", { tickSpacing: spacing, tickCurrentId: MIN_TICK_ID + 20 }), null);
  assert.equal(goalPlanOf("even", "calm", { tickSpacing: 0, tickCurrentId: 0 }), null);
});

test("the band of the price is the person's own, never wider than an eighth of the way to the range's nearer edge, never nothing", () => {
  assert.equal(GOAL_BAND_SHARE, 8);
  assert.equal(goalBandBps({ downBps: 160, upBps: 172 }, 100), 20);
  assert.equal(goalBandBps({ downBps: 160, upBps: 172 }, 10), 10);
  assert.equal(goalBandBps({ downBps: 50, upBps: 61 }, 100), 6);
  assert.equal(goalBandBps({ downBps: 4, upBps: 4 }, 100), 1);
  assert.equal(goalBandBps({ downBps: 340, upBps: 350 }, 0), 1);
  assert.ok(MAX_EARN_BAND_BPS === 500);
});

/* ------------------------------------------------------------------ a position from a goal, on a frozen moment */

test("paid in SOL alone: the swap first, then the opening built for the price that swap ends at — as the rehearsal sent it", async () => {
  const venue = at("poolOpen");
  const nft = "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss";
  const build = await venue.earn.open({ pool: addresses.pool, wallet: who.person, nftMint: nft, goal: "near", style: "balanced", pay: { mint: addresses.sol, amountRaw: "2000000000" }, slippageBps: 100 });
  assert.deepEqual(build.steps.map((step) => step.roles.join("+")), ["SWAP", "OPEN+DEPOSIT"]);
  assert.deepEqual(build.steps.map((step) => step.cosigners), [[], [nft]], "the fresh key signs the opening alone");
  assert.equal(build.bandBps, kept.open.bandBps);
  assert.equal(build.shape.ranges.length, kept.open.ranges);
  /* The rehearsal's own numbers, to the atom: what the swap took and paid, and what the deposit took at the swap's end price. */
  assert.equal(build.swap.amountInRaw, kept.open.swap.inLamports);
  assert.equal(build.swap.expectedOutRaw, kept.open.swap.outUsdcRaw);
  assert.equal(build.deposit.xRaw, kept.open.deposit.lamports);
  assert.equal(build.deposit.yRaw, kept.open.deposit.usdcRaw);
  assert.equal(build.swap.referral, true);
  assert.ok(BigInt(build.swap.amountInRaw) + BigInt(build.deposit.maximumXRaw) <= 2_000_000_000n, "never more SOL than was named");
  assert.ok(BigInt(build.deposit.maximumYRaw) <= BigInt(build.swap.minimumOutRaw), "never more of the other coin than the swap surely pays");
  assert.equal(build.feeLamports, kept.open.feeLamports);
  assert.equal(build.rentLamports - build.rentReturnedLamports, kept.open.rentToldLamports);
});

test("paid in both coins there is no swap; a goal that is not one, a coin that is not the pool's, nothing, and a wallet that cannot pay are refused before a signature", async () => {
  const venue = at("poolOpen");
  const nft = "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss";
  const request = { pool: addresses.pool, wallet: who.holder, nftMint: nft, goal: "even", style: "calm", slippageBps: 100 };
  const both = await venue.earn.open({ ...request, pay: { amountXRaw: "3000000000", amountYRaw: "450000000" } });
  assert.equal(both.swap, null);
  assert.deepEqual(both.steps.map((step) => step.roles.join("+")), ["OPEN+DEPOSIT"]);
  assert.equal(both.shape.ranges.length, 1);
  assert.equal(await refused(() => venue.earn.open({ ...request, goal: "moon", pay: { mint: addresses.sol, amountRaw: "1000000000" } })), "BAD_INPUT");
  assert.equal(await refused(() => venue.earn.open({ ...request, style: "wide", pay: { mint: addresses.sol, amountRaw: "1000000000" } })), "BAD_INPUT");
  assert.equal(await refused(() => venue.earn.open({ ...request, pay: { mint: who.stranger, amountRaw: "1000000000" } })), "BAD_INPUT");
  assert.equal(await refused(() => venue.earn.open({ ...request, pay: { mint: addresses.sol, amountRaw: "0" } })), "AMOUNT_ZERO");
  assert.equal(await refused(() => venue.earn.open({ ...request, slippageBps: MAX_EARN_BAND_BPS + 1, pay: { mint: addresses.sol, amountRaw: "1000000000" } })), "BAD_INPUT");
  assert.equal(await refused(() => venue.earn.open({ ...request, wallet: who.stranger, pay: { mint: addresses.usdc, amountRaw: "100000000" } })), "BALANCE_LOW");
  assert.equal(await refused(() => venue.earn.open({ ...request, wallet: who.stranger, pay: { mint: addresses.sol, amountRaw: "60000000000" } })), "BALANCE_LOW");
});

test("an opening built for a price a swap ends at is held to that price's own tick, and to numbers that are numbers", async () => {
  const venue = at("poolOpen");
  const pool = await venue.pools.read(addresses.pool);
  const base = { pool: addresses.pool, wallet: who.holder, nftMint: "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss", shape: { strategy: "spot", minTickId: pool.tickId - 200 - (((pool.tickId % 10) + 10) % 10), maxTickId: pool.tickId + 200 - (((pool.tickId % 10) + 10) % 10) }, amountXRaw: "1000000000", amountYRaw: "150000000", slippageBps: 10 };
  const ahead = { sqrtPriceX64: pool.sqrtPriceX64, tickId: pool.tickId, spendsXRaw: "0", spendsYRaw: "0", bringsXRaw: "0", bringsYRaw: "0", lamports: 0 };
  assert.equal((await venue.positions.open({ ...base, ahead })).packed.length, 1);
  assert.equal(await refused(() => venue.positions.open({ ...base, ahead: { ...ahead, tickId: pool.tickId + 1 } })), "BAD_INPUT");
  assert.equal(await refused(() => venue.positions.open({ ...base, ahead: { ...ahead, sqrtPriceX64: "0x10" } })), "BAD_INPUT");
  assert.equal(await refused(() => venue.positions.open({ ...base, ahead: { ...ahead, lamports: -1 } })), "BAD_INPUT");
  /* What the swap takes ahead is asked of the wallet beside the deposit: more than it holds is refused. */
  assert.equal(await refused(() => venue.positions.open({ ...base, ahead: { ...ahead, spendsYRaw: "999000000000" } })), "BALANCE_LOW");
});

/* ------------------------------------------------------------------ income in two lines, and who looks after a position */

test("a position's income reads in two lines — the fees, and the pool's reward — and says whether it is earning", async () => {
  const venue = at("caring");
  const income = await venue.earn.income({ pool: addresses.pool, nftMint: addresses.personPosition });
  assert.equal(income.inRange, true);
  assert.ok(BigInt(income.fees.xRaw) > 0n && BigInt(income.fees.yRaw) > 0n, JSON.stringify(income.fees));
  assert.deepEqual(income.rewards.map((reward) => [reward.index, reward.mint, reward.running]), [[0, addresses.usdc, true]]);
  /* What the agent then collected for the owner is what was read here. */
  assert.equal(income.fees.xRaw, kept.careFees.toOwner.lamportsWrapped);
  assert.equal(income.fees.yRaw, kept.careFees.toOwner.usdcRaw);
  assert.equal(await refused(() => venue.earn.income({ pool: addresses.pool, nftMint: who.stranger })), "BAD_INPUT");
});

test("a care is the agent approved with exactly the three rights — and to anyone else, or once taken back, nobody's", async () => {
  assert.deepEqual([...CARE_RIGHTS], ["claimFee", "claimReward", "removeLiquidity"]);
  const venue = at("caring");
  const person = { pool: addresses.pool, nftMint: addresses.personPosition, owner: who.person };
  const cared = await venue.earn.care({ ...person, agent: who.agent });
  assert.deepEqual({ delegate: cared.delegate, cares: cared.cares, may: [...cared.may].sort() }, { delegate: who.agent, cares: true, may: [...CARE_RIGHTS].sort() });
  assert.equal((await venue.earn.care({ ...person, agent: who.stranger })).cares, false);
  assert.equal((await venue.earn.care({ ...person, agent: null })).cares, false);
  assert.equal(await refused(() => venue.earn.care({ ...person, owner: who.holder, agent: who.agent })), "BAD_INPUT", "the wallet that does not hold the NFT has no care to read");
  const back = await at("careTakenBack").earn.care({ pool: addresses.pool, nftMint: addresses.holderPosition, owner: who.holder, agent: who.agent });
  assert.deepEqual({ delegate: back.delegate, cares: back.cares, may: [...back.may] }, { delegate: null, cares: false, may: [] });
});

test("the approval and the taking back are one transaction of the owner's each, and the agent's builds name the agent as their payer", async () => {
  const venue = at("caring");
  const approval = await venue.earn.approveCare({ nftMint: addresses.holderPosition, owner: who.holder, agent: who.agent });
  assert.equal(approval.cosigners.length, 0);
  const taken = await venue.earn.endCare({ nftMint: addresses.personPosition, owner: who.person });
  assert.equal(taken.cosigners.length, 0);
  assert.equal(await refused(() => venue.earn.approveCare({ nftMint: addresses.holderPosition, owner: who.person, agent: who.agent })), "BAD_INPUT", "only the holder approves");
  for (const build of [
    await venue.positions.collect({ pool: addresses.pool, nftMint: addresses.personPosition, owner: who.person, signer: who.agent }),
    await venue.rewards.collect({ pool: addresses.pool, nftMint: addresses.personPosition, owner: who.person, signer: who.agent }),
    await venue.positions.remove({ pool: addresses.pool, nftMint: addresses.personPosition, owner: who.person, signer: who.agent, bps: 10_000, slippageBps: 500 }),
  ]) {
    const message = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64")).message;
    assert.equal(message.staticAccountKeys[0].toBase58(), who.agent);
    assert.equal(careRefusalOf(message.serialize(), care), null, "what the venue builds for the agent is what the agent signs");
  }
});

/* ------------------------------------------------------------------ what the agent's key signs */

test("the agent signs the three things a care is — the very bytes the program took in the rehearsal", () => {
  for (const name of ["agentCollectsFees", "agentCollectsReward", "agentTakesLiquidityOut"]) assert.equal(careRefusalOf(messageOf(name), care), null, name);
  assert.equal(careCallOf(Uint8Array.of(169, 32, 79, 137, 136, 232, 70, 137)), "claimFee");
  assert.equal(careCallOf(Uint8Array.of(79, 227, 79, 141, 141, 165, 202, 20)), "refresh");
  assert.equal(careCallOf(Uint8Array.of(1, 2, 3)), null);
});

test("and nothing else — every walk around the venue the program refused in the rehearsal, the agent's key refuses to sign", () => {
  const reasons = {
    agentFeesToItself: "a call that pays an account other than the owner's own",
    agentRewardToItself: "a call that pays an account other than the owner's own",
    agentLiquidityToItself: "a call that pays an account other than the owner's own",
    agentAdds: "a call of the program that is not a care's: only the fees, the reward and the liquidity are taken",
    agentWidens: "a call of the program that is not a care's: only the fees, the reward and the liquidity are taken",
    agentLocksForEver: "a call of the program that is not a care's: only the fees, the reward and the liquidity are taken",
    agentTakesMoreRights: "a call of the program that is not a care's: only the fees, the reward and the liquidity are taken",
    agentCloses: "a call of the program that is not a care's: only the fees, the reward and the liquidity are taken",
    agentMovesTheNft: "a token account opened for someone other than the owner",
    agentCompounds: "a call of the program that is not a care's: only the fees, the reward and the liquidity are taken",
    strangerCollectsFees: "the agent is not the one payer and signer",
    /* Bytes for another person's position, signed by the same agent: not this care's — from the first account it opens. */
    agentCollectsAnotherPosition: "a token account opened for someone other than the owner",
  };
  for (const [name, reason] of Object.entries(reasons)) assert.equal(careRefusalOf(messageOf(name), care), reason, name);
  /* «Take and put back» is the owner's alone: its claim is a care's call, its deposit is not. */
  assert.deepEqual(Object.keys(reasons).filter((name) => !(name in fixture.wires)), [], "every walk is in the fixture");
});

test("a care for one position signs nothing for another, for another pool, or as its own owner", () => {
  const fees = messageOf("agentCollectsFees");
  assert.equal(careRefusalOf(fees, { ...care, nftMint: addresses.holderPosition }), "a call on another position");
  assert.equal(careRefusalOf(fees, { ...care, pool: addresses.usdc }), "a call on another pool");
  assert.equal(careRefusalOf(fees, { ...care, owner: who.holder }), "a token account opened for someone other than the owner");
  assert.equal(careRefusalOf(fees, { ...care, agent: who.stranger }), "the agent is not the one payer and signer");
  assert.equal(careRefusalOf(fees, { ...care, owner: who.agent }), "the agent is not the position's owner");
  assert.equal(careRefusalOf(Uint8Array.of(1, 2, 3), care), "not a transaction message");
  /* With the pool's coins named, an owner's account of any other coin is not the agent's to pay for. */
  assert.equal(careRefusalOf(fees, { ...care, mints: [addresses.usdc] }), "a token account of a coin that is not the pool's");
  assert.equal(careRefusalOf(fees, { ...care, mints: [addresses.usdc, addresses.sol] }), null);
});
