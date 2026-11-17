/**
 * A launch straight into a pool: the terms, the steps and the honest-launch check — pure, no network.
 */

import assert from "node:assert/strict";
import test from "node:test";

const { DLMM_PRO_LAUNCH_TERMS: TERMS, DLMM_PRO_SUPPLY_RAW, DLMM_PRO_SUPPLY_DUST_RAW, dlmmProHonestProblems, dlmmProLadderRaw, dlmmProNextStage, dlmmProOpensAt, dlmmProPhase, dlmmProStartPrice, dlmmProSupplyParts, feePercent } = await import("./dlmm-pro.ts");

test("the terms are the ones the rehearsal passed on the program: 50 % → 1 % by four times the price, a billion coins, 40 : 60", () => {
  assert.deepEqual({ ...TERMS.fee }, { kind: "marketCap", curve: "exponential", startBps: 5_000, endBps: 100, periods: 60, priceMultiple: 4, expiresAfter: 86_400 });
  assert.deepEqual({ ...TERMS.coin }, { decimals: 6, supply: 1_000_000_000 });
  assert.equal(TERMS.split.creatorBps + TERMS.split.ryntraBps, 10_000);
  assert.equal(TERMS.split.creatorBps, 4_000, "D-M2: the creator's part");
  assert.equal(TERMS.maxRanges, 14);
  assert.equal(DLMM_PRO_SUPPLY_RAW, 1_000_000_000_000_000n);
});

test("the first price is the start market cap over the supply, in the pair's own coin — no price feed", () => {
  assert.equal(dlmmProStartPrice("SOL"), "0.000000030000");
  assert.equal(dlmmProStartPrice("USDC"), "0.000005000000");
});

test("the supply's two parts add up to the whole supply, to the atom", () => {
  const split = dlmmProSupplyParts(true);
  assert.equal(split.creatorRaw + split.ryntraRaw, DLMM_PRO_SUPPLY_RAW);
  assert.equal(split.creatorRaw * 10_000n, DLMM_PRO_SUPPLY_RAW * 4_000n);
  assert.deepEqual(dlmmProSupplyParts(false), { creatorRaw: DLMM_PRO_SUPPLY_RAW, ryntraRaw: 0n, ladderRaw: 0n });
});

test("the creator's ladder is a twentieth of the supply, off unless asked; the locked parts are the rest, to the atom", () => {
  assert.deepEqual({ ...TERMS.ladder }, { shareBps: 500, nearBps: 10_000, farBps: 90_000, rungs: 5, spread: "further", lowestMultiple: 1.95 });
  assert.equal(dlmmProLadderRaw(false), 0n);
  assert.equal(dlmmProLadderRaw(true), DLMM_PRO_SUPPLY_RAW / 20n);
  for (const split of [true, false]) {
    const parts = dlmmProSupplyParts(split, true);
    assert.equal(parts.ladderRaw, DLMM_PRO_SUPPLY_RAW / 20n);
    assert.equal(parts.creatorRaw + parts.ryntraRaw + parts.ladderRaw, DLMM_PRO_SUPPLY_RAW, `split ${split}`);
  }
  const split = dlmmProSupplyParts(true, true);
  assert.equal(split.creatorRaw * 10_000n, (DLMM_PRO_SUPPLY_RAW - split.ladderRaw) * 4_000n, "40 : 60 of what is locked");
  assert.deepEqual(dlmmProSupplyParts(true, false), { ...dlmmProSupplyParts(true), ladderRaw: 0n });
});

test("the opening: a quarter of an hour by default; a named moment inside the program's room for it, or none", () => {
  const now = 1_800_000_000;
  assert.equal(dlmmProOpensAt(now, null), now + 900);
  assert.equal(dlmmProOpensAt(now, undefined), now + 900);
  assert.equal(dlmmProOpensAt(now, now + 300), now + 300, "five minutes is the least");
  assert.equal(dlmmProOpensAt(now, now + 299), null);
  assert.equal(dlmmProOpensAt(now, now + 29 * 86_400), now + 29 * 86_400);
  assert.equal(dlmmProOpensAt(now, now + 29 * 86_400 + 1), null);
  assert.equal(dlmmProOpensAt(now, now - 1), null, "never behind the clock");
  assert.equal(dlmmProOpensAt(now, 1.5), null);
});

test("a step is never offered before the one it stands on; the supply is one step until every position is where it belongs", () => {
  const chain = (over) => ({ coin: true, pool: true, creatorPosition: true, ryntraPosition: { made: true, handed: true }, ladder: null, ...over });
  assert.equal(dlmmProNextStage(chain({ coin: false, pool: false, creatorPosition: false, ryntraPosition: { made: false, handed: false } })), "COIN");
  assert.equal(dlmmProNextStage(chain({ pool: false, creatorPosition: false })), "POOL");
  assert.equal(dlmmProNextStage(chain({ creatorPosition: false })), "SUPPLY");
  assert.equal(dlmmProNextStage(chain({ ryntraPosition: { made: false, handed: false } })), "SUPPLY");
  assert.equal(dlmmProNextStage(chain({ ryntraPosition: { made: true, handed: false } })), "SUPPLY", "made and not handed over is not done");
  assert.equal(dlmmProNextStage(chain({})), null);
  assert.equal(dlmmProNextStage(chain({ ryntraPosition: null })), null, "a launch without a split has one position");
  /* A coin that is not there is the first step whatever else a read says. */
  assert.equal(dlmmProNextStage(chain({ coin: false })), "COIN");
  /* The creator's ladder is part of the supply's step: the launch is not whole until it rests. */
  assert.equal(dlmmProNextStage(chain({ ladder: false })), "SUPPLY");
  assert.equal(dlmmProNextStage(chain({ ladder: true })), null);
  assert.equal(dlmmProNextStage(chain({ ladder: false, pool: false })), "POOL");
});

test("the phase: being built until every step is on chain, then a countdown, then open", () => {
  assert.equal(dlmmProPhase({ next: "POOL", opensAt: 100, now: 500 }), "BUILDING", "past its opening and not whole is still not a launch");
  assert.equal(dlmmProPhase({ next: null, opensAt: 100, now: 99 }), "COUNTDOWN");
  assert.equal(dlmmProPhase({ next: null, opensAt: 100, now: 100 }), "OPEN");
});

const CREATOR = "Creator1111111111111111111111111111111111111";
const RYNTRA = "Ryntra11111111111111111111111111111111111111";
const QUOTE = "So11111111111111111111111111111111111111112";
const honest = () => ({
  creator: CREATOR,
  terms: { pair: "SOL", quoteMint: QUOTE, opensAt: 2_000, initialTickId: -173_200, endFeeBps: 100.13, settlesAtPriceMultiple: 3.98, dynamicCeilingBps: 20, ryntra: RYNTRA, poolSource: "launch", config: null },
  mint: { token2022: true, mintAuthority: null, freezeAuthority: null, supplyRaw: DLMM_PRO_SUPPLY_RAW.toString(), decimals: 6, extensions: ["MetadataPointer", "TokenMetadata"], metadataAuthority: null },
  pool: {
    kind: "launch",
    creator: CREATOR,
    tokenX: "Mint",
    tokenY: QUOTE,
    tickSpacing: 100,
    initialTickId: -173_200,
    feeMode: "marketCapExponential",
    periods: 60,
    settlesAfter: 86_401,
    settlesAtPriceMultiple: 3.9801,
    liquidityMining: false,
    dynamicCeilingBps: 20,
    startBps: 5_000,
    endBps: 100.13,
    collectedIn: "tokenY",
    partner: null,
    rules: { swapAt: 2_000, withdrawAt: 2_000, depositor: CREATOR, swapper: null, withdrawer: null },
    suppliedRaw: (DLMM_PRO_SUPPLY_RAW - 12n).toString(),
  },
  positions: [
    { role: "creator", holder: CREATOR, lockedBps: 10_000, liquidity: "4000000" },
    { role: "ryntra", holder: RYNTRA, lockedBps: 10_000, liquidity: "6000000" },
  ],
});
const problems = (change) => {
  const facts = structuredClone(honest());
  change(facts);
  return dlmmProHonestProblems(facts);
};

test("the launch its creator was shown is honest; a few atoms of rounding left with the creator are dust", () => {
  assert.deepEqual(dlmmProHonestProblems(honest()), []);
  assert.deepEqual(problems((facts) => (facts.pool.suppliedRaw = (DLMM_PRO_SUPPLY_RAW - DLMM_PRO_SUPPLY_DUST_RAW).toString())), []);
});

test("every way a launch can differ from the one shown is said in plain words", () => {
  const cases = [
    [(f) => (f.mint.token2022 = false), "the coin is not a Token-2022 coin"],
    [(f) => (f.mint.mintAuthority = CREATOR), "the coin can still be minted"],
    [(f) => (f.mint.freezeAuthority = CREATOR), "the coin's accounts can be frozen"],
    [(f) => (f.mint.metadataAuthority = CREATOR), "the coin's name can still be changed"],
    [(f) => (f.mint.supplyRaw = "1"), "the supply is not a billion coins"],
    [(f) => (f.mint.decimals = 9), "the supply is not a billion coins"],
    [(f) => f.mint.extensions.push("PermanentDelegate"), "the coin carries PermanentDelegate"],
    [(f) => f.mint.extensions.push("TransferFeeConfig"), "the coin carries TransferFeeConfig"],
    [(f) => (f.pool.kind = "static"), "the pool is not the kind the launch was built as"],
    [(f) => (f.pool.creator = RYNTRA), "the pool was made by another wallet"],
    [(f) => (f.pool.tokenY = "Other"), "the pool pairs with another coin"],
    [(f) => (f.pool.initialTickId = -173_100), "the pool starts at another price"],
    [(f) => (f.pool.tickSpacing = 80), "the pool starts at another price"],
    [(f) => (f.pool.feeMode = "fixed"), "the pool's fee is not the launch's schedule"],
    [(f) => (f.pool.startBps = 2_000), "the pool's fee is not the launch's schedule"],
    [(f) => (f.pool.endBps = 106.14), "the pool's fee is not the launch's schedule"],
    [(f) => (f.pool.periods = 1), "the pool's fee is not the launch's schedule"],
    [(f) => (f.pool.settlesAfter = 10 * 86_400), "the pool's fee is not the launch's schedule"],
    [(f) => (f.pool.settlesAfter = null), "the pool's fee is not the launch's schedule"],
    [(f) => (f.pool.settlesAtPriceMultiple = 100), "the pool's fee is not the launch's schedule"],
    [(f) => (f.pool.liquidityMining = true), "the pool pays rewards the launch was not built with"],
    [(f) => (f.pool.dynamicCeilingBps = 4_900), "the pool's volatility fee is not the launch's"],
    [(f) => (f.terms.dynamicCeilingBps = null), "the pool's volatility fee is not the launch's"],
    /* A pool its creator made some other way: the launch's own step never said where its schedule settles. */
    [(f) => (f.terms.endFeeBps = null), "the pool was not made by this launch's own step"],
    [(f) => (f.terms.endFeeBps = null), "the pool's fee is not the launch's schedule"],
    [(f) => (f.terms.endFeeBps = Number.NaN), "the pool's fee is not the launch's schedule"],
    [(f) => (f.pool.collectedIn = "output"), "the pool takes its fee in the coin itself"],
    [(f) => (f.pool.partner = RYNTRA), "the pool names a partner"],
    [(f) => (f.pool.rules = null), "the pool has no opening time"],
    [(f) => (f.pool.rules.swapAt = 1_000), "the pool opens at another time"],
    [(f) => (f.pool.rules.depositor = RYNTRA), "another wallet may put liquidity in before the opening"],
    [(f) => (f.pool.rules.swapper = CREATOR), "a wallet may trade before the opening"],
    [(f) => (f.pool.rules.withdrawer = CREATOR), "a wallet may take liquidity out before the opening"],
    [(f) => (f.pool.rules.withdrawAt = 1_999), "liquidity may be taken out before the opening"],
    [(f) => (f.pool.rules.withdrawAt = undefined), "liquidity may be taken out before the opening"],
    [(f) => (f.pool.suppliedRaw = (DLMM_PRO_SUPPLY_RAW / 2n).toString()), "the supply did not all go into the pool"],
    [(f) => (f.pool.suppliedRaw = "not a number"), "what went into the pool could not be read"],
    [(f) => (f.positions = f.positions.slice(1)), "the creator's position is not on chain"],
    [(f) => (f.positions[0].lockedBps = 9_999), "the creator's liquidity is not locked for ever"],
    [(f) => (f.positions[0].holder = RYNTRA), "the creator's position is held by another wallet"],
    [(f) => (f.positions = f.positions.slice(0, 1)), "Ryntra's position is not on chain"],
    [(f) => (f.positions[1].lockedBps = 0), "Ryntra's liquidity is not locked for ever"],
    [(f) => (f.positions[1].holder = CREATOR), "Ryntra's position was not handed over"],
    [(f) => (f.positions[1].liquidity = "4000000"), "the fees are not divided 40 : 60"],
    [(f) => (f.terms.ryntra = null), "the launch has a second position it was not built with"],
  ];
  for (const [change, said] of cases) assert.ok(problems(change).includes(said), `${said} — got ${JSON.stringify(problems(change))}`);
});

test("a launch without a split is honest with the creator's position alone; a pool from Ryntra's config may name its partner", () => {
  assert.deepEqual(
    problems((f) => {
      f.terms.ryntra = null;
      f.positions = f.positions.slice(0, 1);
    }),
    [],
  );
  assert.deepEqual(
    problems((f) => {
      f.terms.poolSource = "config";
      f.terms.config = "Config";
      f.pool.kind = "dynamic";
      f.pool.partner = RYNTRA;
    }),
    [],
  );
  assert.ok(problems((f) => (f.terms.poolSource = "config")).includes("the pool is not the kind the launch was built as"));
});

/** A launch with the creator's ladder: the locked positions hold the rest, and the order rests whole on five prices from twice the first. */
const laddered = (over = {}) => {
  const facts = structuredClone(honest());
  const share = DLMM_PRO_SUPPLY_RAW / 20n;
  facts.terms.ladder = true;
  facts.pool.suppliedRaw = (DLMM_PRO_SUPPLY_RAW - share - 12n).toString();
  facts.ladder = { amountRaw: (share - 3n).toString(), nearestTickId: -173_200 + 6_900, resting: true, holder: CREATOR };
  facts.open = false;
  return Object.assign(facts, over);
};

test("a launch with the creator's ladder is honest while the ladder rests whole above twice the first price", () => {
  assert.deepEqual(dlmmProHonestProblems(laddered()), []);
  /* The ladder's share is not in the pool, and is not missing from it. */
  assert.deepEqual(dlmmProHonestProblems({ ...laddered(), terms: { ...laddered().terms, ladder: false }, ladder: undefined }).filter((p) => p.includes("supply")), ["the supply did not all go into the pool"]);
  /* Once trading is open the order is its owner's: filled, collected or closed, the launch stays the one shown. */
  assert.deepEqual(dlmmProHonestProblems(laddered({ open: true, ladder: null })), []);
  assert.deepEqual(dlmmProHonestProblems(laddered({ open: true, ladder: { amountRaw: "0", nearestTickId: -173_200 + 6_900, resting: false, holder: null } })), []);
});

test("every way the creator's ladder can differ from the one shown is said in plain words", () => {
  const cases = [
    [{ ladder: null }, "the creator's ladder is not resting"],
    [{ ladder: { amountRaw: "1000", nearestTickId: -173_200 + 6_900, resting: true, holder: CREATOR } }, "the creator's ladder is not resting"],
    [{ ladder: { amountRaw: (DLMM_PRO_SUPPLY_RAW / 20n).toString(), nearestTickId: -173_200 + 6_900, resting: false, holder: CREATOR } }, "the creator's ladder is not resting"],
    [{ ladder: { amountRaw: (DLMM_PRO_SUPPLY_RAW / 10n).toString(), nearestTickId: -173_200 + 6_900, resting: true, holder: CREATOR } }, "the creator's ladder holds more than its share of the supply"],
    [{ ladder: { amountRaw: "x", nearestTickId: -173_200 + 6_900, resting: true, holder: CREATOR } }, "what rests in the creator's ladder could not be read"],
    [{ ladder: { amountRaw: (DLMM_PRO_SUPPLY_RAW / 20n).toString(), nearestTickId: -173_200 + 100, resting: true, holder: CREATOR } }, "the creator's ladder sells below twice the first price"],
    [{ ladder: { amountRaw: (DLMM_PRO_SUPPLY_RAW / 20n).toString(), nearestTickId: -173_200 + 6_900, resting: true, holder: null } }, "the creator's ladder is held by another wallet"],
    [{ open: true, ladder: { amountRaw: "0", nearestTickId: -173_200 + 6_000, resting: false, holder: CREATOR } }, "the creator's ladder sells below twice the first price"],
  ];
  for (const [over, said] of cases) {
    const got = dlmmProHonestProblems(laddered(over));
    assert.ok(got.includes(said), `${said} — got ${JSON.stringify(got)}`);
  }
  /* The locked positions still hold the rest of the supply. */
  const short = laddered();
  short.pool.suppliedRaw = (DLMM_PRO_SUPPLY_RAW / 2n).toString();
  assert.ok(dlmmProHonestProblems(short).includes("the supply did not all go into the pool"));
});

test("a fee is shown as a person reads it, the real one — never rounded to the one asked for", () => {
  assert.equal(feePercent(5_000), "50 %");
  assert.equal(feePercent(100), "1 %");
  assert.equal(feePercent(100.13), "1 %");
  assert.equal(feePercent(106.14), "1.06 %");
  assert.equal(feePercent(1_292), "12.92 %");
  assert.equal(feePercent(4_000), "40 %");
  assert.equal(feePercent(250), "2.5 %");
});
