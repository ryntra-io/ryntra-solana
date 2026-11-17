/**
 * A pool's liquidity by price, with no network: the one answer's own rules, and a DLMM pool's read on a
 * pool handed in — its bins as the SDK gives them, the cost of a new position's accounts, the market's price beside.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

const { EARN_BINS_HALF, EARN_BINS_MAX_HALF, binsHalfOf, gapPctOf, isEarnBinsAnswer, isPoolAddress, marketPriceOf } = await import("./bins.ts");
const { readDlmmBinsAnswer } = await import("./dlmm-bins.ts");
const { jupiterUsd } = await import("./market-price.ts");
const { EarnBinsResponseSchema } = await import("../api/v1/contract.ts");

const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = () => 1_763_000_000_000;

/** A pool of SOL against USDC, step 4, the price in bin `active`: USDC under the price, SOL over it, both in the bin it stands in. */
function pair(active, { missing = false } = {}) {
  const priceOf = (id) => 150 * 1.0004 ** (id - active);
  return {
    lbPair: { activeId: active, binStep: 4 },
    tokenX: { publicKey: new PublicKey(SOL), mint: { decimals: 9 } },
    tokenY: { publicKey: new PublicKey(USDC), mint: { decimals: 6 } },
    async getBinsAroundActiveBin(left, right) {
      const bins = [];
      // As the SDK does: one bin past each end comes back too.
      for (let id = active - left - 1; id <= active + right + 1; id += 1) {
        if (missing && id === active) continue;
        bins.push({ binId: id, xAmount: BigInt(id >= active ? 2_000_000_000 : 0), yAmount: BigInt(id <= active ? 300_000_000 : 0), pricePerToken: priceOf(id).toFixed(9) });
      }
      return { activeBin: active, bins };
    },
  };
}

/** The ledgers of seventy bins that hold a range, as the SDK counts them; each one's account is a key of its own. */
function ledgers(_pool, lower, upper) {
  const out = [];
  for (let index = Math.floor(lower / 70); index <= Math.floor(upper / 70); index += 1) {
    const seed = Buffer.alloc(32);
    seed.writeInt32LE(index, 0);
    out.push({ key: new PublicKey(seed), lower: index * 70, upper: index * 70 + 69 });
  }
  return out;
}

const deps = (over = {}) => ({
  open: async () => pair(-4_290),
  ledgers,
  exist: async (keys) => keys.map((_, index) => index === 0),
  rentOf: async (account) => (account === "positionV2" ? 57_406_080n : 71_437_440n),
  market: async () => ({ [SOL]: 151.5, [USDC]: 1 }),
  ...over,
});

test("a request names a pool's address and a width within bounds; the default stands when it names none", () => {
  assert.equal(isPoolAddress(POOL) && !isPoolAddress("0x12") && !isPoolAddress(null) && !isPoolAddress(""), true);
  assert.equal(binsHalfOf(null), EARN_BINS_HALF);
  assert.equal(binsHalfOf(""), EARN_BINS_HALF);
  assert.deepEqual(["1", "34", String(EARN_BINS_MAX_HALF)].map(binsHalfOf), [1, 34, EARN_BINS_MAX_HALF]);
  assert.deepEqual(["0", "71", "-3", "1.5", "ten", "1e2"].map(binsHalfOf), [null, null, null, null, null, null]);
});

test("the market's price is X in Y from the two dollar prices; the gap is the pool's price against it, and none without both", () => {
  assert.equal(marketPriceOf(150, 1), 150);
  assert.equal(marketPriceOf(150, null), null);
  assert.equal(marketPriceOf(0, 1), null);
  assert.ok(Math.abs(gapPctOf(151.5, 150) - 1) < 1e-9);
  assert.ok(Math.abs(gapPctOf(148.5, 150) + 1) < 1e-9);
  assert.equal(gapPctOf(150, null), null);
});

test("a DLMM pool's bins around the price: the contract's shape, each bin as the SDK read it, ascending from under the price", async () => {
  const read = await readDlmmBinsAnswer(POOL, 34, deps(), NOW);
  assert.equal(read.ok, true);
  const answer = read.value;
  assert.equal(EarnBinsResponseSchema.safeParse({ ...answer, bins: [...answer.bins], rent: { ...answer.rent, ledgers: [...answer.rent.ledgers] } }).success, true);
  assert.equal(isEarnBinsAnswer(JSON.parse(JSON.stringify(answer))), true);
  assert.deepEqual([answer.venue, answer.pool, answer.stepBps, answer.activeId, answer.at], ["dlmm", POOL, 4, -4_290, new Date(NOW()).toISOString()]);
  assert.deepEqual([answer.x, answer.y], [{ mint: SOL, decimals: 9 }, { mint: USDC, decimals: 6 }]);
  assert.equal(answer.bins.length, 69);
  assert.deepEqual(answer.bins.map((bin) => bin.offset), Array.from({ length: 69 }, (_, index) => index - 34));
  assert.deepEqual(answer.bins[34], { offset: 0, id: -4_290, price: 150, x: "2000000000", y: "300000000" });
  assert.deepEqual([answer.bins[0].x, answer.bins[0].y, answer.bins[68].x, answer.bins[68].y], ["0", "300000000", "2000000000", "0"]);
  assert.equal(answer.price, 150);
  assert.equal(answer.market.price, 151.5);
  assert.ok(Math.abs(answer.market.gapPct - (150 / 151.5 - 1) * 100) < 1e-9);
});

test("the accounts' cost: a position's own, a ledger's, and the pool's ledgers over the bins read with which of them are open", async () => {
  const asked = [];
  const exist = async (keys) => {
    asked.push(...keys.map((key) => key.toBase58()));
    return keys.map((_, index) => index === 0);
  };
  const read = await readDlmmBinsAnswer(POOL, 34, deps({ exist }), NOW);
  const { rent } = read.value;
  assert.deepEqual([rent.positionLamports, rent.ledgerLamports], ["57406080", "71437440"]);
  /* Bins -4324 … -4256, and one ledger of seventy past the highest: three ledgers, ascending. */
  assert.deepEqual(rent.ledgers, [
    { lower: -4_340, upper: -4_271, open: true },
    { lower: -4_270, upper: -4_201, open: false },
    { lower: -4_200, upper: -4_131, open: false },
  ]);
  assert.equal(asked.length, 3);
  assert.equal(new Set(asked).size, 3);
});

test("Jupiter silent, or a coin it does not price: the bins are served, the market's price is not made up", async () => {
  const silent = await readDlmmBinsAnswer(POOL, 10, deps({ market: async () => Promise.reject(new Error("down")) }), NOW);
  assert.deepEqual(silent.value.market, { price: null, gapPct: null });
  const half = await readDlmmBinsAnswer(POOL, 10, deps({ market: async () => ({ [SOL]: 150 }) }), NOW);
  assert.deepEqual(half.value.market, { price: null, gapPct: null });
  assert.equal(half.value.bins.length, 21);
});

test("no pool at the address is said so; a read without the bin the price stands in is not served as a pool", async () => {
  assert.deepEqual(await readDlmmBinsAnswer(POOL, 10, deps({ open: async () => null }), NOW), { ok: false, code: "NOT_A_POOL", reason: "No DLMM pool at the address." });
  /* A text of the right letters that is no key at all is no pool either — never «the chain did not answer». */
  assert.deepEqual((await readDlmmBinsAnswer("z".repeat(44), 10, deps(), NOW)).code, "NOT_A_POOL");
  const broken = await readDlmmBinsAnswer(POOL, 10, deps({ open: async () => pair(100, { missing: true }) }), NOW);
  assert.deepEqual([broken.ok, broken.code], [false, "UNAVAILABLE"]);
});

test("Jupiter's price is read for the mints asked, with the key where the server holds one; a refusal is no price", async () => {
  const seen = [];
  const answer = (body, ok = true) => async (url, init) => {
    seen.push([String(url), init.headers]);
    return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
  };
  const kept = process.env.RYNTRA_JUPITER_API_KEY;
  delete process.env.RYNTRA_JUPITER_API_KEY;
  try {
    assert.deepEqual(await jupiterUsd([SOL, USDC], answer({ [SOL]: { usdPrice: 150.25 }, [USDC]: { usdPrice: "1.0001" }, other: { usdPrice: 0 } })), { [SOL]: 150.25, [USDC]: 1.0001 });
    assert.equal(seen[0][0], `https://lite-api.jup.ag/price/v3?ids=${SOL},${USDC}`);
    assert.equal("x-api-key" in seen[0][1], false);
    assert.deepEqual(await jupiterUsd([SOL], answer({}, false)), {});
    process.env.RYNTRA_JUPITER_API_KEY = "test-key";
    await jupiterUsd([SOL], answer({}));
    assert.equal(seen[2][0].startsWith("https://api.jup.ag/price/v3?ids="), true);
    assert.equal(seen[2][1]["x-api-key"], "test-key");
  } finally {
    if (kept === undefined) delete process.env.RYNTRA_JUPITER_API_KEY;
    else process.env.RYNTRA_JUPITER_API_KEY = kept;
  }
});
