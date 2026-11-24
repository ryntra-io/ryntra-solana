/**
 * The door in front of the engine's own DLMM add for a pool of a checked stock against USDC or SOL:
 * the switch and its canary, the pair read from the pool's own bytes, the shelf's rule, the issuer's pause, the range
 * around the price, and the check of what the engine built. The chain, the shelf and the engine are stand-ins: no network.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionType, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMintLen } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";

const { stockSeatsOf } = await import("../earn-pro/stocks.ts");
const { DLMM_PROGRAM, LB_PAIR, STOCK_QUOTES, admitDlmmStockAdd, binPrice, dlmmStocksMode, lbPairOf, pairOf, readPairOn, readStockPool, reviewDlmmStockAdd, sideOf, stockPoolOf, stockReadOf } = await import("./stocks.ts");

const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const USDC = STOCK_QUOTES.usdc;
const SOL = STOCK_QUOTES.sol;
const POOL = Keypair.generate().publicKey.toBase58();
const PERSON = Keypair.generate().publicKey.toBase58();
const OWNER = Keypair.generate().publicKey.toBase58();

/** A DLMM pair's account as the program keeps it: the bytes the door reads, the rest empty. */
function lbPair({ x, y, activeId = 0, binStep = 20, status = 0 }) {
  const data = Buffer.alloc(904);
  data.writeInt32LE(activeId, LB_PAIR.activeId);
  data.writeUInt16LE(binStep, LB_PAIR.binStep);
  data.writeUInt8(status, LB_PAIR.status);
  new PublicKey(x).toBuffer().copy(data, LB_PAIR.mintX);
  new PublicKey(y).toBuffer().copy(data, LB_PAIR.mintY);
  return { owner: DLMM_PROGRAM, data };
}
const plainMint = (decimals) => {
  const data = Buffer.alloc(82);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 0n, decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  return { owner: TOKEN_PROGRAM_ID.toBase58(), data };
};
/** A Token-2022 mint with a pausable config, as Backpack Securities sets ANT's — paused or not. */
function stockMint(paused = false) {
  const data = Buffer.alloc(getMintLen([ExtensionType.PausableConfig]));
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 0n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  data.writeUInt8(1, 165);
  data.writeUInt16LE(ExtensionType.PausableConfig, 166);
  data.writeUInt16LE(33, 168);
  Keypair.generate().publicKey.toBuffer().copy(data, 170);
  data.writeUInt8(paused ? 1 : 0, 202);
  return { owner: TOKEN_2022_PROGRAM_ID.toBase58(), data };
}

/* ANT priced ~95 USDC: with 6 and 6 decimals and a 20 bps step, bin 2280 is (1.002)^2280 ≈ 95.15. */
const ACTIVE = 2280;
const MINTS = { [ANT]: stockMint(false), [USDC]: plainMint(6), [SOL]: plainMint(9) };
const chain = ({ x = ANT, y = USDC, paused = false, status = 0, activeId = ACTIVE } = {}) => pairOf(POOL, lbPair({ x, y, activeId, status }), (mint) => (mint === ANT ? stockMint(paused) : (MINTS[mint] ?? null)));

const ROWS = [{ representation: { mint: ANT, symbol: "ANT", issuer: { label: "Backpack Securities" }, instrument: { class: "listed-equity" }, tradingHalted: null }, lifecycle: { state: "unknown", tradable: true } }];
const seats = async (mints) => stockSeatsOf(ROWS, mints);
const OPEN = Object.freeze({ RYNTRA_EARN_DLMM_STOCKS: "open", RYNTRA_LIQUIDITY_ACTIONS: "OPEN" });

const body = (changes = {}) => ({
  action: "add",
  venue: "meteora-dlmm",
  range: { place: "around", half: 16 },
  ...changes.top,
  request: { pool: POOL, owner: PERSON, amountX: "1000000", amountY: "95000000", shape: "spot", slippageBps: 100, ...changes.request },
});

/** The engine's Review as it answers an add: what goes in is exactly the request's, on the pool asked. */
function engine(change = (preview) => preview) {
  const asked = [];
  const review = async (given) => {
    asked.push(given);
    const r = given.request;
    const preview = change({
      action: "add",
      venue: "meteora-dlmm",
      pool: r.pool,
      request: r,
      opensPosition: true,
      range: { kind: "bins", lowerBin: ACTIVE - 16, upperBin: ACTIVE + 16, lowerPrice: "92.3", upperPrice: "98.4" },
      rangeState: "in_range",
      deposit: { x: { asset: ANT, units: r.amountX, decimals: 6 }, y: { asset: USDC, units: r.amountY, decimals: 6 } },
      fees: [],
      rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }],
      transactions: 1,
      notices: [],
      price: "95.3",
      at: 1,
      expiresAt: 2,
    });
    return { ok: true, value: { preview, transactions: [{ wireBase64: "AA==", presigned: [] }], position: Keypair.generate().publicKey.toBase58(), ticket: "t", expiresAt: 3, signableMs: 20_000, networkFeeLamports: "10000", depositUsd: null } };
  };
  return { review, asked };
}
const deps = (over = {}) => ({ env: OPEN, pair: async () => chain(), seats, review: engine().review, ...over });

/* ------------------------------------------------------------------ the switch */

test("the switch: open or canary exactly as written, anything else closed; the canary admits only its wallet; the Harbor's stop stops new money", () => {
  assert.equal(dlmmStocksMode({}), "closed");
  assert.equal(dlmmStocksMode({ RYNTRA_EARN_DLMM_STOCKS: "OPEN" }), "closed");
  assert.equal(dlmmStocksMode({ RYNTRA_EARN_DLMM_STOCKS: " open " }), "open");
  assert.deepEqual(admitDlmmStockAdd(PERSON, {}), { ok: false, code: "DLMM_STOCKS_CLOSED" });
  assert.deepEqual(admitDlmmStockAdd(PERSON, { RYNTRA_EARN_DLMM_STOCKS: "open" }), { ok: true, mode: "open" });
  const canary = { RYNTRA_EARN_DLMM_STOCKS: "canary", RYNTRA_EARN_DLMM_STOCKS_CANARY_WALLET: OWNER };
  assert.deepEqual(admitDlmmStockAdd(OWNER, canary), { ok: true, mode: "canary" });
  assert.deepEqual(admitDlmmStockAdd(PERSON, canary), { ok: false, code: "DLMM_STOCKS_CLOSED" }, "a stranger is told it is closed");
  assert.deepEqual(admitDlmmStockAdd(OWNER, { RYNTRA_EARN_DLMM_STOCKS: "canary" }), { ok: false, code: "DLMM_STOCKS_CLOSED" }, "a canary without a wallet admits nobody");
  assert.deepEqual(admitDlmmStockAdd(PERSON, { RYNTRA_EARN_DLMM_STOCKS: "open", RYNTRA_CITY_HARBOR_STOP: "1" }), { ok: false, code: "DLMM_STOCKS_STOPPED" });
  assert.deepEqual(admitDlmmStockAdd(PERSON, { RYNTRA_EARN_DLMM_STOCKS: "open", RYNTRA_CITY_HARBOR_STOP: "off" }), { ok: true, mode: "open" });
});

/* ------------------------------------------------------------------ the pair from the chain */

test("the pair is read from the pool's own bytes and its mints' — the token program, decimals and the issuer's pause of each side", () => {
  const pair = chain();
  assert.equal(pair.x.mint, ANT);
  assert.equal(pair.x.program, TOKEN_2022_PROGRAM_ID.toBase58());
  assert.equal(pair.y.program, TOKEN_PROGRAM_ID.toBase58());
  assert.equal(pair.x.decimals, 6);
  assert.equal(pair.x.paused, false);
  assert.equal(chain({ paused: true }).x.paused, true);
  assert.equal(pair.activeId, ACTIVE);
  assert.equal(pair.binStep, 20);
  assert.equal(pair.enabled, true);
  assert.equal(chain({ status: 1 }).enabled, false);
  assert.equal(lbPairOf({ owner: "11111111111111111111111111111111", data: lbPair({ x: ANT, y: USDC }).data }), null, "an account of another program is no pair");
  assert.equal(lbPairOf({ owner: DLMM_PROGRAM, data: Buffer.alloc(100) }), null, "too short to be a pair");
  assert.equal(sideOf(ANT, null), null);
  assert.equal(pairOf(POOL, lbPair({ x: ANT, y: USDC }), () => null), null, "a mint that did not read makes no pair");
  assert.ok(Math.abs(binPrice(ACTIVE, 20, 6, 6) - 95.15) < 0.1);
});

test("a stock's pool: one side a seat on the shelf, the other USDC or SOL — the price is the other coin for one stock, either way round", () => {
  const shelf = stockSeatsOf(ROWS, [ANT]);
  const usdc = stockPoolOf(chain(), shelf);
  assert.equal(usdc.stock.symbol, "ANT");
  assert.equal(usdc.stock.issuer, "Backpack Securities");
  assert.equal(usdc.stock.side, "x");
  assert.equal(usdc.quote.kind, "usdc");
  assert.ok(Math.abs(usdc.price - 95.15) < 0.1);
  const flipped = stockPoolOf(chain({ x: USDC, y: ANT, activeId: -ACTIVE }), shelf);
  assert.equal(flipped.stock.side, "y");
  assert.ok(Math.abs(flipped.price - 95.15) < 0.1, "USDC per ANT whichever side ANT is on");
  assert.equal(stockPoolOf(chain({ x: ANT, y: SOL, activeId: -400 }), shelf).quote.kind, "sol");
  assert.equal(stockPoolOf(chain(), new Map()), null, "a coin the shelf does not seat is no stock");
  const other = Keypair.generate().publicKey.toBase58();
  MINTS[other] = plainMint(6);
  assert.equal(stockPoolOf(chain({ x: ANT, y: other }), shelf), null, "a stock against a coin other than USDC or SOL is not this path's");
  assert.equal(stockPoolOf(chain({ x: USDC, y: SOL }), shelf), null, "no stock at all");
});

test("the screen's read: may add only where the switch admits the wallet, the engine's gate is on, the coin is not paused and the pool is enabled", async () => {
  const read = await readStockPool(POOL, deps());
  assert.ok(read.ok);
  assert.equal(stockReadOf(read.value, PERSON, OPEN).add, "on");
  assert.equal(stockReadOf(read.value, PERSON, { RYNTRA_EARN_DLMM_STOCKS: "open" }).add, "off", "the engine's own gate closed");
  assert.equal(stockReadOf(read.value, PERSON, { RYNTRA_LIQUIDITY_ACTIONS: "OPEN" }).add, "off", "the switch closed");
  const stopped = stockReadOf(read.value, PERSON, { ...OPEN, RYNTRA_CITY_HARBOR_STOP: "yes" });
  assert.equal(stopped.add, "off");
  assert.equal(stopped.stopped, true);
  const paused = await readStockPool(POOL, deps({ pair: async () => chain({ paused: true }) }));
  assert.equal(stockReadOf(paused.value, PERSON, OPEN).add, "off");
  assert.equal(stockReadOf(paused.value, PERSON, OPEN).paused, true);
  assert.deepEqual(await readStockPool(POOL, deps({ pair: async () => null })), { ok: false, status: 404, code: "POOL_NOT_FOUND", reason: "No DLMM pool at the address." });
  assert.equal((await readStockPool(POOL, deps({ pair: async () => Promise.reject(new Error("down")) }))).code, "UNAVAILABLE");
  assert.equal((await readStockPool(POOL, deps({ seats: async () => Promise.reject(new Error("shelf")) }))).code, "DLMM_STOCK_PAIR", "a shelf that did not read seats nothing");
});

/* ------------------------------------------------------------------ the door */

test("closed, nothing is built; open, the engine's own Review builds exactly the two coins asked and the answer names the stock", async () => {
  const closed = engine();
  const refused = await reviewDlmmStockAdd(body(), deps({ env: { RYNTRA_LIQUIDITY_ACTIONS: "OPEN" }, review: closed.review }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "DLMM_STOCKS_CLOSED");
  assert.equal(closed.asked.length, 0, "the engine is not asked");

  const open = engine();
  const answer = await reviewDlmmStockAdd(body(), deps({ review: open.review }));
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.equal(open.asked.length, 1);
  assert.deepEqual(answer.value.stock, { mint: ANT, symbol: "ANT", issuer: "Backpack Securities", side: "x", decimals: 6 });
  assert.equal(answer.value.quote.kind, "usdc");
  assert.equal(answer.value.preview.deposit.x.units, "1000000");
  assert.equal(answer.value.preview.deposit.y.units, "95000000");
});

test("what the door refuses before the engine is asked: a pool not of a stock, a paused coin, a disabled pool, an existing position, a range off the price", async () => {
  const cases = [
    [{ pair: async () => chain({ x: USDC, y: SOL }) }, body(), "DLMM_STOCK_PAIR"],
    [{ pair: async () => chain({ paused: true }) }, body(), "DLMM_STOCK_PAUSED"],
    [{ pair: async () => chain({ status: 1 }) }, body(), "POOL_DISABLED"],
    [{}, body({ request: { position: Keypair.generate().publicKey.toBase58() } }), "BAD_REQUEST"],
    [{}, body({ top: { range: { place: "above", half: 16 } } }), "BAD_REQUEST"],
    [{}, body({ top: { range: undefined } }), "BAD_REQUEST"],
    [{}, { ...body(), action: "remove" }, "BAD_REQUEST"],
    [{}, { ...body(), venue: "meteora-damm2" }, "BAD_REQUEST"],
    [{ env: { ...OPEN, RYNTRA_CITY_HARBOR_STOP: "1" } }, body(), "DLMM_STOCKS_STOPPED"],
  ];
  for (const [over, given, code] of cases) {
    const spy = engine();
    const answer = await reviewDlmmStockAdd(given, deps({ ...over, review: spy.review }));
    assert.equal(answer.ok, false, code);
    assert.equal(answer.code, code);
    assert.equal(spy.asked.length, 0, `${code}: the engine is not asked`);
  }
});

test("what the engine built must be a new position on that very pool, of those very coins, of exactly what was asked — or the ticket is dropped", async () => {
  const bent = [
    (p) => ({ ...p, pool: Keypair.generate().publicKey.toBase58() }),
    (p) => ({ ...p, opensPosition: false }),
    (p) => ({ ...p, deposit: { ...p.deposit, x: { ...p.deposit.x, asset: SOL } } }),
    (p) => ({ ...p, deposit: { ...p.deposit, y: { ...p.deposit.y, units: "95000001" } } }),
    (p) => ({ ...p, action: "remove" }),
  ];
  for (const change of bent) {
    const answer = await reviewDlmmStockAdd(body(), deps({ review: engine(change).review }));
    assert.equal(answer.ok, false);
    assert.equal(answer.code, "DLMM_STOCK_PAIR");
  }
  const failed = await reviewDlmmStockAdd(body(), deps({ review: async () => ({ ok: false, status: 422, code: "SIMULATION_FAILED", reason: "no" }) }));
  assert.deepEqual(failed, { ok: false, status: 422, code: "SIMULATION_FAILED", reason: "no" }, "the engine's own refusal passes as it is");
});

test("the read of a pair from a node: the pool's account first, then its two mints", async () => {
  const accounts = { [POOL]: lbPair({ x: ANT, y: USDC, activeId: ACTIVE }), ...MINTS };
  const connection = {
    getMultipleAccountsInfo: async (keys) => keys.map((key) => {
      const info = accounts[key.toBase58()];
      return info ? { owner: new PublicKey(info.owner), data: info.data, lamports: 1, executable: false } : null;
    }),
  };
  const pair = await readPairOn(connection, POOL);
  assert.equal(pair.x.mint, ANT);
  assert.equal(pair.y.mint, USDC);
  assert.equal(await readPairOn(connection, Keypair.generate().publicKey.toBase58()), null);
});
