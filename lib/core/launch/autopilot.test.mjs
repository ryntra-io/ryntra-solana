import assert from "node:assert/strict";
import test from "node:test";

import {
  EXECUTOR_JOURNALED_STATES,
  GRADUATION_RETRY_MAX_SECONDS,
  graduationRetryDelaySeconds,
  FLOOR_RULE,
  JOURNAL_KINDS,
  METEORA_MIGRATION_KEEPERS,
  binOfPrice,
  creatorBoughtEvents,
  isPoolEntry,
  creatorSoldEvents,
  floorBudgetRaw,
  floorLadder,
  floorRaise,
  graduationActor,
  journal,
  journalEvent,
  partnerEarnedRaw,
  priceOfBin,
  addSample,
  readyToPlace,
  referenceBin,
} from "./autopilot.ts";

/* Synthetic addresses only: nothing here names a real account. */
const EXECUTOR = "Exec111111111111111111111111111111111111111";
const OTHER = "Other11111111111111111111111111111111111111";

test("a bin and its price are each other's inverse at steps of 1 %", () => {
  for (const price of [0.000005, 0.0000754, 0.012, 1, 3.5]) {
    const bin = binOfPrice(price, 100, 6, 6);
    assert.ok(priceOfBin(bin, 100, 6, 6) <= price * (1 + 1e-9), `${price}: the bin's price is at or below it`);
    assert.ok(priceOfBin(bin + 1, 100, 6, 6) > price, `${price}: the next bin's price is above it`);
  }
  /* A price exactly on a bin is that bin, not the one below. */
  assert.equal(binOfPrice(priceOfBin(-954, 100, 6, 6), 100, 6, 6), -954);
  assert.throws(() => binOfPrice(0, 100, 6, 6));
});

test("the steps start five below the price's bin and go forty-five deep: about −5 % to −39 %", () => {
  const ladder = floorLadder(-954);
  assert.deepEqual(ladder, { lowerBinId: -1003, upperBinId: -959 });
  assert.equal(ladder.upperBinId - ladder.lowerBinId + 1, FLOOR_RULE.depthBins);
  const top = priceOfBin(ladder.upperBinId, 100, 6, 6) / priceOfBin(-954, 100, 6, 6);
  const bottom = priceOfBin(ladder.lowerBinId, 100, 6, 6) / priceOfBin(-954, 100, 6, 6);
  assert.ok(top > 0.95 && top < 0.952, `top ${top}`);
  assert.ok(bottom > 0.61 && bottom < 0.62, `bottom ${bottom}`);
});

test("the executor's reads: one at most every 45 s, none older than the window; a placement needs five spanning ten minutes", () => {
  let samples = [];
  samples = addSample(samples, 1_000, -950);
  samples = addSample(samples, 1_010, -900);
  assert.deepEqual(samples, [{ at: 1_000, bin: -950 }], "a read ten seconds after the last is not a new read");
  for (let at = 1_060; at <= 1_300; at += 60) samples = addSample(samples, at, -950);
  assert.equal(samples.length, 6);
  assert.equal(readyToPlace(samples, 1_300), false, "five reads in five minutes are not ten minutes of a price");
  for (let at = 1_360; at <= 1_600; at += 60) samples = addSample(samples, at, -950);
  assert.equal(readyToPlace(samples, 1_600), true);
  samples = addSample(samples, 1_000 + 31 * 60, -950);
  assert.ok(samples.every((sample) => sample.at >= 1_000 + 31 * 60 - 30 * 60), "reads older than the window are dropped");
});

test("the bin the steps are set from: the lower of now and the window's median — a spike lifts nothing", () => {
  const calm = [-950, -951, -949, -950, -950].map((bin, index) => ({ at: index * 60, bin }));
  assert.equal(referenceBin(-900, calm), -950, "a price pushed up now is not the price that held");
  assert.equal(referenceBin(-960, calm), -960, "a price below the median is the price");
  assert.equal(referenceBin(-900, calm.slice(0, 2)), -900, "with fewer than three reads, the bin now");
  assert.equal(referenceBin(-900, [-950, -940, -930, -920].map((bin, index) => ({ at: index * 60, bin }))), -940, "an even count takes the lower middle");
});

test("the steps move up only after the price held high on two reads apart, only up, only holding none of the token", () => {
  const ladder = floorLadder(-954);
  const at = 50_000;
  /* Not high enough: nothing, and nothing remembered. */
  assert.deepEqual(floorRaise({ ladder, marketBinId: -950, holdsToken: false, seen: null, at }), { raise: false, seen: null });
  /* Down: never. */
  assert.deepEqual(floorRaise({ ladder, marketBinId: -1100, holdsToken: false, seen: null, at }), { raise: false, seen: null });
  /* High once: remembered, not moved. */
  const first = floorRaise({ ladder, marketBinId: -940, holdsToken: false, seen: null, at });
  assert.deepEqual(first, { raise: false, seen: { at, marketBinId: -940 } });
  /* High again too soon: still not moved. */
  assert.deepEqual(floorRaise({ ladder, marketBinId: -938, holdsToken: false, seen: { at, marketBinId: -940 }, at: at + 60 }), { raise: false, seen: { at, marketBinId: -940 } });
  /* High again after five minutes: moved — to the lower of the two reads. */
  assert.deepEqual(floorRaise({ ladder, marketBinId: -930, holdsToken: false, seen: { at, marketBinId: -940 }, at: at + 301 }), { raise: true, ladder: floorLadder(-940) });
  /* A first read older than fifteen minutes confirms nothing: it is replaced by this read. */
  assert.deepEqual(floorRaise({ ladder, marketBinId: -930, holdsToken: false, seen: { at, marketBinId: -940 }, at: at + 16 * 60 }), { raise: false, seen: { at: at + 16 * 60, marketBinId: -930 } });
  /* Holding the token it bought: what was bought stays where it was bought. */
  assert.deepEqual(floorRaise({ ladder, marketBinId: -930, holdsToken: true, seen: { at, marketBinId: -940 }, at: at + 301 }), { raise: false, seen: null });
});

test("Ryntra's share of a launch: the partner's part of the curve's fee and, once graduated, of the graduation fee", () => {
  const read = (migrated) => ({
    curve: { totalTradingRaw: "1000000000", creatorPct: 40, unclaimedRaw: "0" },
    graduation: { migrated, thresholdRaw: "15454410000", feePct: 2, creatorPct: 40, withdrawn: false },
  });
  assert.equal(partnerEarnedRaw(read(false)), 600_000_000n);
  /* 2 % of the threshold is the graduation fee; 60 % of it is the partner's. */
  const fee = 15_454_410_000n - (15_454_410_000n * 98n) / 100n;
  assert.equal(partnerEarnedRaw(read(true)), 600_000_000n + (fee * 60n) / 100n);
});

test("the liquidity's amount: a quarter of the partner's fees, less what was placed, within what is free, nothing under ten", () => {
  assert.equal(floorBudgetRaw({ partnerEarnedRaw: 400_000_000n, placedRaw: 0n, freeRaw: 1_000_000_000n }), 100_000_000n);
  assert.equal(floorBudgetRaw({ partnerEarnedRaw: 400_000_000n, placedRaw: 0n, freeRaw: 30_000_000n }), 30_000_000n, "never more than is free");
  assert.equal(floorBudgetRaw({ partnerEarnedRaw: 400_000_000n, placedRaw: 95_000_000n, freeRaw: 1_000_000_000n }), 0n, "five left is below the minimum");
  assert.equal(floorBudgetRaw({ partnerEarnedRaw: 400_000_000n, placedRaw: 0n, freeRaw: 0n }), 0n, "nothing on the executor, nothing placed");
});

test("«Творець продав» — each sale with the share of what the creator bought sold by then, of the supply beyond it", () => {
  const trades = [
    { signature: "s1", at: 100, side: "buy", tokensRaw: "1000", pairRaw: "50" },
    { signature: "s2", at: 200, side: "sell", tokensRaw: "300", pairRaw: "20" },
    { signature: "s3", at: 300, side: "sell", tokensRaw: "700", pairRaw: "30" },
    { signature: "s4", at: 400, side: "sell", tokensRaw: "500", pairRaw: "5" },
  ];
  const events = creatorSoldEvents(trades, 1_000_000n);
  assert.deepEqual(events.map((entry) => [entry.signature, entry.soldBps, entry.soldOf]), [
    ["s2", 3000, "bought"],
    ["s3", 10000, "bought"],
    ["s4", 15, "supply"],
  ]);
  assert.ok(events.every((entry) => entry.kind === "CREATOR_SOLD" && entry.actor === "creator" && entry.at));
  assert.deepEqual(creatorSoldEvents([{ signature: "b", at: 1, side: "buy", tokensRaw: "5", pairRaw: "1" }], 1_000n), [], "a creator who only bought sold nothing");
  /* Two sales in one transaction are one entry, added up. */
  const twice = creatorSoldEvents(
    [
      { signature: "b", at: 1, side: "buy", tokensRaw: "1000", pairRaw: "10" },
      { signature: "t", at: 2, side: "sell", tokensRaw: "100", pairRaw: "1" },
      { signature: "t", at: 2, side: "sell", tokensRaw: "200", pairRaw: "2" },
    ],
    1_000_000n,
  );
  assert.deepEqual(twice.map((entry) => [entry.signature, entry.tokensRaw, entry.pairRaw, entry.soldBps]), [["t", "300", "3", 3000]]);
});

test("a graduation is named by who sent it: the executor, Meteora's keeper, or another wallet", () => {
  assert.equal(graduationActor(EXECUTOR, EXECUTOR), "ryntra");
  assert.equal(graduationActor(METEORA_MIGRATION_KEEPERS[0], EXECUTOR), "meteora");
  assert.equal(graduationActor(OTHER, EXECUTOR), "other");
  assert.equal(graduationActor(EXECUTOR, null), "other", "without an executor nothing is Ryntra's");
});

test("the log: the newest first, one entry per transaction and kind", () => {
  const entries = journal([
    journalEvent({ kind: "LAUNCHED", at: "2026-10-07T06:04:09.000Z", signature: "a", actor: "creator" }),
    journalEvent({ kind: "CREATOR_SOLD", at: "2026-10-07T07:00:00.000Z", signature: "b", actor: "creator" }),
    journalEvent({ kind: "CREATOR_SOLD", at: "2026-10-07T07:00:00.000Z", signature: "b", actor: "creator" }),
    journalEvent({ kind: "GRADUATED", at: "2026-10-07T08:00:00.000Z", signature: "c", actor: "ryntra" }),
  ]);
  assert.deepEqual(entries.map((entry) => entry.signature), ["c", "b", "a"]);
  /* On the same second, the entry written later stands above: the lock above its launch. */
  const same = journal([
    journalEvent({ kind: "LAUNCHED", at: "2026-10-07T06:04:09.000Z", signature: "l", actor: "creator" }),
    journalEvent({ kind: "CREATOR_LOCKED", at: "2026-10-07T06:04:09.000Z", signature: "k", actor: "creator" }),
  ]);
  assert.deepEqual(same.map((entry) => entry.kind), ["CREATOR_LOCKED", "LAUNCHED"]);
  assert.ok(JOURNAL_KINDS.includes("CREATOR_SOLD"));
});

test("the executor claims a partner's fee only where it is the config's fee claimer; it pays no holder and funds no pool's rewards", async () => {
  const { readFileSync } = await import("node:fs");
  /* The executor's own code builds no partner claim: only the partner module does, and only for its fee claimer. */
  const source = ["lib/launch/autopilot.server.ts", "lib/launch/autopilot-chain.server.ts", "lib/core/venues/meteora-dlmm/floor.server.ts"].map((path) => readFileSync(path, "utf8")).join("\n");
  for (const call of ["claimPartnerTradingFee", "partnerWithdrawMigrationFee", "partnerWithdrawSurplus", "claimFeeInstructions", "claimPositionFee", "fundReward", "initializeReward", "createTransferCheckedInstruction", "SystemProgram.transfer"]) {
    assert.equal(source.includes(call), false, `the executor's code calls ${call}`);
  }
  const partner = readFileSync("lib/core/venues/meteora-dbc/partner.server.ts", "utf8");
  const builder = partner.slice(partner.indexOf("export async function buildPartnerClaim"));
  assert.ok(builder.indexOf('read.feeClaimer !== args.claimer') > 0 && builder.indexOf('read.feeClaimer !== args.claimer') < builder.indexOf("client.partner"), "the claim is refused before it is built unless the config's fee claimer is the signer");
  for (const call of ["fundReward", "initializeReward", "SystemProgram.transfer", "createTransfer"]) assert.equal(partner.includes(call), false, `the partner module calls ${call}`);
  /* What the pass does on each config is proven on a chain that answers on purpose: lib/launch/budget.test.mjs. */
});

test("a failed graduation is sent again at once, then after two, four, eight minutes — never more than half an hour apart", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 12].map(graduationRetryDelaySeconds), [0, 0, 120, 240, 480, 960, 1_800, 1_800]);
  assert.equal(GRADUATION_RETRY_MAX_SECONDS, 1_800);
  assert.equal(graduationRetryDelaySeconds(Number.NaN), 0);
});

test("the executor writes down the market's states from the move to the DEX on, a risk limit's pause among them; the curve's are not its marks", () => {
  assert.deepEqual([...EXECUTOR_JOURNALED_STATES].sort(), ["CORE_MARKET_LIVE", "ENDOWMENT_EXHAUSTED", "ENDOWMENT_FUNDED", "LADDER_ACTIVE", "MAINTAINING", "MATURE", "MIGRATING", "MIGRATION_FAILED", "PAUSED_RISK"]);
});

test("«Творець купив»: every purchase from the creator's wallet after the launch, one entry a transaction — the creation's own purchase stays the launch's", () => {
  /* $STAIR, 10.10: the operator's buys to the demo market's threshold were nowhere in its flight log. */
  const trades = [
    { signature: "create", at: 100, side: "buy", tokensRaw: "19784300", pairRaw: "310000" },
    { signature: "b1", at: 300, side: "buy", tokensRaw: "500", pairRaw: "20000000" },
    { signature: "b2", at: 400, side: "buy", tokensRaw: "200", pairRaw: "5000000" },
    { signature: "b2", at: 400, side: "buy", tokensRaw: "100", pairRaw: "5000000" },
    { signature: "s1", at: 500, side: "sell", tokensRaw: "50", pairRaw: "1000000" },
  ];
  const bought = creatorBoughtEvents(trades, "create");
  assert.deepEqual(bought.map((entry) => [entry.kind, entry.signature, entry.tokensRaw, entry.pairRaw, entry.actor]), [
    ["CREATOR_BOUGHT", "b1", "500", "20000000", "creator"],
    ["CREATOR_BOUGHT", "b2", "300", "10000000", "creator"],
  ]);
  assert.equal(bought[0].at, new Date(300_000).toISOString());
  assert.deepEqual(creatorBoughtEvents([{ signature: "s", at: 1, side: "sell", tokensRaw: "1", pairRaw: "1" }], "create"), [], "a sale is never a purchase");
  assert.ok(JOURNAL_KINDS.includes("CREATOR_BOUGHT"));
});

test("a holder's entry into a pool is not the creator's purchase: its tokens go into the position", () => {
  assert.equal(isPoolEntry(["Program log: Instruction: CreatePosition", "Program log: Instruction: ZapInDammV2", "Program log: Instruction: Swap2"]), true, "Zap's entry");
  assert.equal(isPoolEntry(["Program log: Instruction: Swap2", "Program log: Instruction: AddLiquidity"]), true, "a swap and an add of both sides");
  assert.equal(isPoolEntry(["Program log: Instruction: Swap2", "Program log: Instruction: TransferChecked"]), false, "a purchase on the curve or in the pool");
  assert.equal(isPoolEntry(["Program log: Instruction: AddLiquidityByStrategy2"]), false, "Ryntra's ladder is its own entry kind, never a creator's");
});
