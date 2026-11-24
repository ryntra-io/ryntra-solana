// «У парі з акцією» on the server — the register read with the shelf beside it, the offer, and the config of
// one stock-paired launch with Meteora's badge in it. The stocks are mainnet's own bytes (ANT and SPCX, with their DBC
// badges — `../core/launch/fixtures/stock-quote-mainnet.json`); the node answers only what a build asks. Behind the flag:
// closed, the shelf is never read and nothing of this is offered.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { STOCK_PAIR_FLAG } from "../core/launch/stock-pair.ts";
import { mintProfileOf } from "../solana/mint-profile.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { launchNetwork } from "./config.server.ts";
import { forgetQuoteAssets, readQuoteAssets } from "./quote-asset.server.ts";
import { LaunchStockPairBuildResponseSchema, LaunchStockPairResponseSchema } from "../api/v1/contract.ts";
import { STOCK_PAIR_PRESET_VIEW, honestyPlain, offerPlain, prepareStockPairConfig, readStockPairOffers, stockPairOfferOf } from "./stock-pair.server.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("../core/launch/fixtures/stock-quote-mainnet.json", import.meta.url), "utf8"));
const ANT = FIXTURE.stocks.ANT;
const SPCX = FIXTURE.stocks.SPCX;
const STAND = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" };
const SECRET = { BETA_TOKEN_SECRET: "a-secret-of-thirty-two-characters!" };
const NOW = new Date("2026-11-19T19:10:00.000Z");
const PRICE_AT = "2026-11-19T19:09:30.000Z";
const accountOf = (address) => {
  const raw = FIXTURE.accounts[address];
  return raw ? { owner: new PublicKey(raw.owner), data: Buffer.from(raw.data, "base64"), lamports: raw.lamports, executable: false } : null;
};

/** The register's record of a stock as `quote-asset-check.mjs` prints it for the operator. */
const recordOf = (symbol) => {
  const { mint } = FIXTURE.stocks[symbol];
  const facts = mintProfileOf(mint, accountOf(mint));
  return {
    mint,
    symbol,
    program: facts.program,
    decimals: facts.decimals,
    extensions: facts.extensions.map(Number),
    transferFee: null,
    authorities: { mint: facts.mintAuthority, freeze: facts.freezeAuthority, permanentDelegate: facts.permanentDelegate, close: facts.closeAuthority, transferHook: facts.transferHook?.authority ?? null },
    defaultAccountState: facts.defaultAccountState,
    multiplier: 1,
    badge: true,
    priceMaxAgeSeconds: 300,
    note: null,
  };
};
const registry = { RYNTRA_LAUNCH_QUOTE_ASSETS: "open", RYNTRA_LAUNCH_QUOTE_ASSETS_REGISTRY: JSON.stringify([recordOf("ANT"), recordOf("SPCX")]) };
const OPEN = { ...registry, [STOCK_PAIR_FLAG]: "open" };

/** A node with the stocks and their badges where mainnet keeps them; a build's own reads answered plainly. */
const node = () => ({
  getMultipleAccountsInfo: async (keys) => keys.map((key) => accountOf(key.toBase58())),
  getEpochInfo: async () => ({ epoch: FIXTURE.epoch, blockHeight: 900, absoluteSlot: 9_000 }),
  getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1_000 }),
  getBalance: async () => 1_000_000_000,
  simulateTransaction: async () => ({ value: { err: null, accounts: [{ lamports: 1_000_000_000 - 7_000_000 }] } }),
  getRecentPerformanceSamples: async () => [{ numSlots: 150, samplePeriodSecs: 60 }],
  getAccountInfo: async () => null,
});
const price = async () => ({ usdByMint: { [ANT.mint]: 94.2, [SPCX.mint]: 137.56 }, observedAt: PRICE_AT });
const entry = (symbol, over = {}) => ({
  mint: FIXTURE.stocks[symbol].mint,
  symbol,
  issuer: { id: "backpack", label: "Backpack Securities" },
  liquidityUsd: symbol === "ANT" ? 2_200_000 : 2_525_000,
  priceUsd: symbol === "ANT" ? 94.2 : 137.56,
  session: "open",
  nextChangeAt: "2026-11-19T21:00:00.000Z",
  termsUrl: "https://learn.backpack.exchange/articles/what-is-backpack-securities",
  ...over,
});
const shelf = (entries = [entry("ANT"), entry("SPCX")]) => async () => entries;
const read = (env, reader = shelf()) => {
  forgetQuoteAssets();
  return readQuoteAssets({ cluster: "devnet", connection: node(), env, now: () => NOW, price, shelf: reader });
};

test("with the flag closed the stocks are refused as before, and the shelf is never read", async () => {
  let asked = 0;
  const states = await read(registry, async () => {
    asked += 1;
    return [];
  });
  assert.deepEqual(states.map((state) => state.problems), [["EXTENSION_FORBIDDEN"], ["EXTENSION_FORBIDDEN"]]);
  assert.equal(asked, 0);
  assert.equal(states[0].facts, undefined, "nothing new in the state either");
  assert.equal(await readStockPairOffers({ cluster: "devnet", connection: node(), env: registry, now: () => NOW, price, shelf: shelf() }), null);
});

test("open, ANT and SPCX read open — the badge on chain, the empty hook, the shelf by mint", async () => {
  const states = await read(OPEN);
  assert.deepEqual(states.map((state) => [state.record.symbol, state.state, state.problems.length]), [["ANT", "OPEN", 0], ["SPCX", "OPEN", 0]]);
  assert.equal(states[0].shelf?.issuer.id, "backpack");
  assert.ok(states[0].facts?.permanentDelegate);
  const [ant] = states.map(stockPairOfferOf);
  assert.equal(ant.state, "OPEN");
  assert.deepEqual(ant.threshold, { raw: "160000000", units: "160", usd: 15072, basis: "ceiling" });
  assert.ok(Math.abs(ant.marketCaps.start.units - 51.7652) < 0.001);
  assert.deepEqual(ant.honesty.risks, ["ISSUER_CAN_PAUSE", "ISSUER_CAN_TAKE", "ISSUER_CAN_FREEZE", "ISSUER_CAN_SET_HOOK"]);
  /* The answer the route gives is the contract's, field for field. */
  const answer = { network: "solana:devnet", preset: STOCK_PAIR_PRESET_VIEW, stocks: states.map(stockPairOfferOf).map(offerPlain), checkedAt: NOW.toISOString() };
  assert.equal(LaunchStockPairResponseSchema.safeParse(answer).success, true, JSON.stringify(LaunchStockPairResponseSchema.safeParse(answer).error?.issues));
});

test("off the shelf, the shelf unread, a stock too thin — each closes it with its reason", async () => {
  /* The shelf without ANT: the register's record alone is not enough. */
  const [antOff] = await read(OPEN, shelf([entry("SPCX")]));
  assert.deepEqual(antOff.problems, ["STOCK_NOT_ON_SHELF"]);
  /* A token borrowing the symbol is no entry of ANT's: the shelf goes by the mint. */
  const [antFake] = await read(OPEN, shelf([entry("SPCX"), entry("ANT", { mint: "4WdnZ7TGnSRtTrJ3sZ1hk5NzTZd6sVuxx1vrFdUtbpmp" })]));
  assert.deepEqual(antFake.problems, ["STOCK_NOT_ON_SHELF"]);
  const [unread] = await read(OPEN, async () => null);
  assert.deepEqual(unread.problems, ["SHELF_NOT_READ"]);
  /* On the shelf and open in the register, but too thin to size a curve. */
  const [thin] = (await read(OPEN, shelf([entry("ANT", { liquidityUsd: 20_000 })]))).map(stockPairOfferOf);
  assert.deepEqual([thin.state, thin.sizing, thin.threshold], ["CLOSED", "TOO_THIN", null]);
});

test("the config of one stock-paired launch — the curve in ANT, Meteora's badge in it, the line before the signature", async () => {
  const store = createMemoryGuardStore();
  const env = { ...SECRET, ...OPEN };
  const network = launchNetwork({ ...STAND, ...OPEN });
  const deps = { network, connection: node(), store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => NOW, env, quotePrice: price, stockShelf: shelf() };
  const creator = Keypair.generate().publicKey.toBase58();
  forgetQuoteAssets();
  const built = await prepareStockPairConfig(deps, { creator, quoteMint: ANT.mint });
  assert.equal(built.ok, true, built.message);
  assert.equal(built.terms.quoteMint, ANT.mint);
  assert.equal(built.quote.figures.threshold.raw, "160000000", "the config's own threshold: 160 ANT");
  assert.equal(built.quote.figures.threshold.units, "160.000000");
  assert.equal(built.quote.configVersion, "0.2.1", "ANT carries no fee: createConfig, not createConfig2");
  assert.deepEqual(built.stockPair.threshold, { raw: "160000000", units: "160", usd: 15072, basis: "ceiling" });
  assert.equal(built.stockPair.honesty.issuer.id, "backpack");
  assert.equal(built.stockPair.honesty.paused, false);
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  assert.equal(tx.feePayer?.toBase58(), creator, "the creator pays the config's rent");
  /* The badge is the first remaining account of the config's creation — without it the program refuses the mint. */
  const keys = tx.instructions.flatMap((instruction) => instruction.keys.map((meta) => meta.pubkey.toBase58()));
  assert.ok(keys.includes(ANT.badge), "Meteora's badge of ANT is named");
  /* The kept build is a config of one launch like any: `advanced/config/submit` sends it. */
  assert.ok(await store.collection("launchAdvancedBuilds").get(`devnet:${built.buildId}`));
  assert.equal(STOCK_PAIR_PRESET_VIEW.id, "stock-pair");
  /* As the route answers it — the contract's shape, field for field. */
  const answer = {
    buildId: built.buildId,
    network: "solana:devnet",
    config: built.config,
    unsignedWireBase64: built.wireBase64,
    terms: built.terms,
    creatorCostLamports: built.creatorCostLamports,
    quote: built.quote,
    stockPair: { ...built.stockPair, honesty: honestyPlain(built.stockPair.honesty) },
    expiresAt: built.expiresAt,
    signableMs: built.signableMs,
  };
  const parsed = LaunchStockPairBuildResponseSchema.safeParse(answer);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("the config refuses what the offer refuses, and nothing at all with the flag closed", async () => {
  const store = createMemoryGuardStore();
  const network = launchNetwork({ ...STAND, ...OPEN });
  const creator = Keypair.generate().publicKey.toBase58();
  const base = { network, connection: node(), store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => NOW, quotePrice: price, stockShelf: shelf() };
  forgetQuoteAssets();
  assert.equal((await prepareStockPairConfig({ ...base, env: { ...SECRET, ...registry } }, { creator, quoteMint: ANT.mint })).code, "PRESET_UNAVAILABLE");
  forgetQuoteAssets();
  const off = await prepareStockPairConfig({ ...base, env: { ...SECRET, ...OPEN }, stockShelf: shelf([entry("SPCX")]) }, { creator, quoteMint: ANT.mint });
  assert.equal(off.code, "QUOTE_PAUSED");
  assert.match(off.message, /shelf/);
  forgetQuoteAssets();
  const thin = await prepareStockPairConfig({ ...base, env: { ...SECRET, ...OPEN }, stockShelf: shelf([entry("ANT", { liquidityUsd: 20_000 })]) }, { creator, quoteMint: ANT.mint });
  assert.equal(thin.code, "QUOTE_PAUSED");
  assert.match(thin.message, /too thin/);
  forgetQuoteAssets();
  assert.equal((await prepareStockPairConfig({ ...base, env: { ...SECRET, ...OPEN } }, { creator, quoteMint: Keypair.generate().publicKey.toBase58() })).code, "ADVANCED_INVALID");
});
