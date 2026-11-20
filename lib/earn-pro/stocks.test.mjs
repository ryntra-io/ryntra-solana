/**
 * A position in a DLMM Pro pool of SOL against a checked stock: the shelf's rule, the switch, the pier the
 * engine serves and what it refuses. No network.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ExtensionType, MintLayout, TOKEN_2022_PROGRAM_ID, getMintLen } from "@solana/spl-token";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { readFixture, rpcConnection, snapshotSource, toBase58 } from "../core/venues/meteora-dlmm-pro/fixture-kit.mjs";

const { NO_STOCKS, stockSeatOf, stockSeatsOf } = await import("./stocks.ts");
const { earnProStocks } = await import("./gate.ts");
const { pausedMintsOf, readBoats, readPier, readPiers } = await import("./piers.server.ts");
const { reviewEarnPro } = await import("./actions.server.ts");
const { earnProPiersAnswer } = await import("./service.server.ts");
const { earnProVenue } = await import("./venue.server.ts");
const { EarnProPiersResponseSchema } = await import("../api/v1/contract.ts");

const fixture = readFixture(new URL("../core/venues/meteora-dlmm-pro/fixtures/earn-rehearsal.json.gz", import.meta.url));
const { who, addresses } = fixture;

/* The door asks the deployment's own gate: this test is a devnet deployment that names no coin of its own. */
process.env.RYNTRA_EARN_PRO = "devnet";
process.env.RYNTRA_EARN_PRO_DEVNET_REFERRAL = who.referral;
const agent = Keypair.fromSeed(createHash("sha256").update("city-249/agent").digest());
assert.equal(agent.publicKey.toBase58(), who.agent);
/* An agent's care is open on this deployment: what refuses it in a stock's pool is the coin, not the switch. */
const PLAIN = Object.freeze({ RYNTRA_EARN_PRO: "devnet", BETA_TOKEN_SECRET: "a-test-secret-of-enough-length", RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: who.agent, RYNTRA_AGENT_MANDATE_KEY: JSON.stringify([...agent.secretKey]) });
const STOCKS = Object.freeze({ ...PLAIN, RYNTRA_EARN_PRO_STOCKS: "open" });

/* The stand's second coin, read as the shelf would read a listed company's token: «ANT», issued by Backpack Securities. */
const STOCK = addresses.usdc;
const row = (changes = {}) => ({
  representation: { mint: STOCK, symbol: "ANT", issuer: { label: "Backpack Securities" }, instrument: { class: "listed-equity" }, tradingHalted: null, ...(changes.representation ?? {}) },
  lifecycle: { state: "unknown", tradable: true, ...(changes.lifecycle ?? {}) },
});
const shelf = (rows = [row()]) => {
  const asked = [];
  const stocks = async (mints) => {
    asked.push(...mints);
    return stockSeatsOf(rows, mints);
  };
  return { stocks, asked };
};

function at(moment, extra = {}) {
  const snapshot = { ...fixture.snapshots[moment], accounts: { ...fixture.snapshots[moment].accounts, ...extra } };
  const source = {
    ...snapshotSource(snapshot, {}, () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null })),
    send: (bytes) => toBase58(VersionedTransaction.deserialize(bytes).signatures[0]),
    status: () => ({ slot: 1, confirmations: null, err: null, confirmationStatus: "confirmed" }),
  };
  const connection = rpcConnection(source);
  return { connection, venue: earnProVenue("devnet", connection) };
}

/** A Token-2022 mint with a pausable config, paused or not — as an issuer like Backpack Securities sets one. */
function pausableMint(paused) {
  const size = getMintLen([ExtensionType.PausableConfig]);
  const data = Buffer.alloc(size);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 0n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  data.writeUInt8(1, 165); /* the account type: a mint */
  data.writeUInt16LE(ExtensionType.PausableConfig, 166);
  data.writeUInt16LE(33, 168);
  Keypair.generate().publicKey.toBuffer().copy(data, 170);
  data.writeUInt8(paused ? 1 : 0, 202);
  return { owner: TOKEN_2022_PROGRAM_ID, data, lamports: 1, executable: false };
}

/* ------------------------------------------------------------------ the shelf's rule */

test("a seat is a listed company's token whose issuer still takes new money — never a pre-IPO token, a halted, paused, retired or converting one", () => {
  assert.deepEqual(stockSeatOf(row()), { mint: STOCK, symbol: "ANT", issuer: "Backpack Securities" });
  assert.deepEqual(stockSeatOf(row({ lifecycle: { state: "active" } })).symbol, "ANT");
  assert.equal(stockSeatOf(row({ representation: { instrument: { class: "pre-ipo" } } })), null, "a private company's token prices a token, not a share");
  assert.equal(stockSeatOf(row({ representation: { tradingHalted: true } })), null);
  for (const state of ["paused", "redeem-only", "expired", "conversion-open"]) assert.equal(stockSeatOf(row({ lifecycle: { state } })), null, state);
  assert.equal(stockSeatOf(row({ lifecycle: { tradable: false } })), null);
  assert.equal(stockSeatOf(row({ representation: { symbol: "<b>ANT</b>" } })), null, "a ticker the contract does not carry");
  assert.equal(stockSeatOf(row({ representation: { issuer: { label: " " } } })), null);
  const seats = stockSeatsOf([row(), row({ representation: { mint: who.stranger, symbol: "NVDAx" } })], [STOCK]);
  assert.deepEqual([...seats.keys()], [STOCK], "only the mints asked for");
});

test("the stocks' switch opens only on «open», exactly; no shelf names no stock", async () => {
  assert.equal(earnProStocks({}), false);
  assert.equal(earnProStocks({ RYNTRA_EARN_PRO_STOCKS: "1" }), false);
  assert.equal(earnProStocks({ RYNTRA_EARN_PRO_STOCKS: " open " }), true);
  assert.equal((await NO_STOCKS(["a"])).size, 0);
});

/* ------------------------------------------------------------------ the pier */

test("a pool of SOL against a checked stock is a pier only where stock pools are open — named by its ticker, carrying its issuer", async () => {
  const { connection } = at("caring");
  const { stocks, asked } = shelf();
  assert.deepEqual((await readPiers("devnet", { env: PLAIN, connection, stocks })).piers, [], "closed: no pier");
  assert.deepEqual(asked, [], "closed: the shelf is not even asked");
  const { piers } = await readPiers("devnet", { env: STOCKS, connection, stocks });
  assert.equal(piers.length, 1);
  assert.deepEqual([piers[0].address, piers[0].x.symbol, piers[0].y.symbol, piers[0].solIsX, piers[0].takesDeposits], [addresses.pool, "SOL", "ANT", true, true]);
  assert.deepEqual(piers[0].stock, { issuer: "Backpack Securities" });
  assert.deepEqual(asked, [STOCK], "only the coins Earn does not know are asked for");
  /* A coin the shelf does not hold, a shelf that failed, no shelf at all: no pier — new money never on a guess. */
  assert.deepEqual((await readPiers("devnet", { env: STOCKS, connection, stocks: shelf([row({ representation: { instrument: { class: "pre-ipo" } } })]).stocks })).piers, []);
  assert.deepEqual((await readPiers("devnet", { env: STOCKS, connection, stocks: async () => { throw new Error("down"); } })).piers, []);
  assert.deepEqual((await readPiers("devnet", { env: STOCKS, connection })).piers, []);
  /* Stocks open is not every pool open: a coin nobody checked stays out, whatever the catalogue calls it. */
  assert.deepEqual((await readPiers("devnet", { env: STOCKS, connection, stocks: NO_STOCKS, names: async () => ({ [STOCK]: { symbol: "MET", name: "Meteora" } }) })).piers, []);
  /* Every pool open too: the stock still carries its ticker and its issuer, ahead of the catalogue's name. */
  const both = await readPiers("devnet", { env: { ...STOCKS, RYNTRA_EARN_PRO_ANY_POOL: "open" }, connection, stocks, names: async () => ({ [STOCK]: { symbol: "USDC", name: "USD Coin" } }) });
  assert.deepEqual([both.piers[0].y.symbol, both.piers[0].stock], ["ANT", { issuer: "Backpack Securities" }]);
  /* The routes' answer carries it in the contract's own shape. */
  const answer = await earnProPiersAnswer(STOCKS, { connection, stocks });
  assert.equal(EarnProPiersResponseSchema.safeParse(answer).success, true, JSON.stringify(EarnProPiersResponseSchema.safeParse(answer).error?.issues));
  assert.deepEqual(answer.piers[0].stock, { issuer: "Backpack Securities" });
});

test("the Review: new money in a stock's pool only where stock pools are open; taking out wherever the person holds; no agent's care", async () => {
  const { connection } = at("caring");
  const { stocks } = shelf();
  const base = { owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition };
  const served = await readPier("devnet", addresses.pool, { env: STOCKS, connection, stocks });
  assert.deepEqual([served.served, served.pier.y.symbol, served.pier.stock], [true, "ANT", { issuer: "Backpack Securities" }]);
  assert.equal((await readPier("devnet", addresses.pool, { env: PLAIN, connection, stocks })).served, false);
  assert.equal((await readPier("devnet", addresses.pool, { env: STOCKS, connection })).served, false, "no shelf: not served");
  /* Closed: no new money, no compound — but collect, leave and close stand. */
  const opened = { action: "open", owner: who.person, pool: addresses.pool, goal: "even", style: "balanced", lamports: "1000000000" };
  assert.deepEqual([(await reviewEarnPro(opened, { env: PLAIN, connection, stocks })).code], ["NOT_A_PIER"]);
  assert.equal((await reviewEarnPro({ action: "compound", ...base }, { env: PLAIN, connection, stocks })).code, "NOT_A_PIER");
  for (const action of ["collect", "leave"]) {
    const out = await reviewEarnPro({ action, ...base }, { env: PLAIN, connection, stocks });
    assert.equal(out.ok, true, `${action} with the switch closed: ${JSON.stringify(out)}`);
  }
  /* Open: the person's own actions stand as on any pier; an agent's care is refused — the person looks after it. */
  for (const action of ["compound", "collect", "leave"]) {
    const out = await reviewEarnPro({ action, ...base }, { env: STOCKS, connection, stocks });
    assert.equal(out.ok, true, `${action}: ${JSON.stringify(out)}`);
  }
  const care = await reviewEarnPro({ action: "care_on", ...base, stopPct: 10 }, { env: STOCKS, connection, stocks });
  assert.deepEqual([care.ok, care.code], [false, "CARE_CLOSED"]);
  assert.match(care.reason, /yours to look after/);
  const boats = await readBoats("devnet", who.person, null, { env: PLAIN, connection });
  assert.deepEqual(boats.map((boat) => boat.nftMint), [addresses.personPosition], "what the person holds there is shown whatever the switch says");
});

test("an opening from SOL alone in a stock's pool is built as on any pier — two transactions, the pool's own swap then the deposit", async () => {
  const { connection } = at("poolOpen");
  const { stocks } = shelf();
  const fresh = Keypair.generate();
  const reviewed = await reviewEarnPro({ action: "open", owner: who.person, pool: addresses.pool, goal: "near", style: "balanced", lamports: "2000000000" }, { env: STOCKS, connection, now: () => 5_000_000, freshKey: () => fresh, stocks });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  assert.equal(reviewed.value.transactions.length, 2);
  assert.equal(reviewed.value.summary.nftMint, fresh.publicKey.toBase58());
  assert.ok(BigInt(reviewed.value.summary.goesIn.yRaw) > 0n, "some of the SOL became the stock");
});

/* ------------------------------------------------------------------ the issuer's pause */

test("a stock its issuer paused takes no deposit while the pause holds — read from the mint's own pausable config", async () => {
  const live = pausableMint(false);
  const held = pausableMint(true);
  const mints = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
  const fake = { getMultipleAccountsInfo: async (keys) => keys.map((key) => (key.toBase58() === mints[0] ? live : key.toBase58() === mints[1] ? held : null)) };
  assert.deepEqual([...(await pausedMintsOf(fake, mints))], [mints[1]], "only the paused one; a mint that did not read is not called paused");

  /* The stand's pool, its second coin read as a paused stock: the pier stands — taking out stays — but takes no deposit. */
  const { connection } = at("poolOpen");
  const paused = new Proxy(connection, {
    get(target, prop) {
      if (prop !== "getMultipleAccountsInfo") return Reflect.get(target, prop);
      return async (keys, ...rest) => (keys.length === 1 && keys[0].toBase58() === STOCK ? [held] : target.getMultipleAccountsInfo(keys, ...rest));
    },
  });
  const { stocks } = shelf();
  const { piers } = await readPiers("devnet", { env: STOCKS, connection: paused, stocks });
  assert.deepEqual([piers.length, piers[0].takesDeposits], [1, false]);
  const refused = await reviewEarnPro({ action: "open", owner: who.person, pool: addresses.pool, goal: "near", style: "balanced", lamports: "2000000000" }, { env: STOCKS, connection: paused, now: () => 5_000_000, stocks });
  assert.deepEqual([refused.ok, refused.code], [false, "PIER_NOT_OPEN"]);
});
