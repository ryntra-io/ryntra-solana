import { test } from "node:test";
import assert from "node:assert/strict";

import { CP_AMM_PROGRAM_ID, MAX_SQRT_PRICE, MIN_SQRT_PRICE, validateCustomizablePoolParams, CollectFeeMode, ActivationType } from "@meteora-ag/cp-amm-sdk";
import { MintLayout, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { reviewLiquidityAction, submitLiquidityAction } from "../../../lib/liquidity/studio/actions.ts";
import { createDammV2Venue } from "../../../lib/liquidity/studio/damm-v2.ts";
import { priceAgrees, reviewStockBuild } from "./stock-pier-door.ts";
import { createStockPierVenue, priceString, stockPierAddress, stockPierFees, STOCK_BUILD_COMPUTE_UNITS } from "./stock-pier-venue.ts";
import { pair } from "./stock-pier-fixtures.mjs";

const OWNER = Keypair.fromSeed(new Uint8Array(32).fill(3));
const STOCK = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey;
const SOL = NATIVE_MINT;
const ENV = {
  RYNTRA_LIQUIDITY_ACTIONS: "OPEN",
  BETA_TOKEN_SECRET: "stock-pier-test-secret-0123456789",
};

function mintData(decimals) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 10n ** 15n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return data;
}

/** A Solana endpoint that answers from memory: no pool yet, no token accounts, the two mints, a live blockhash. */
function fakeChain({ poolExists = false, simulationErr = null } = {}) {
  const sent = [];
  const pool = new PublicKey(stockPierAddress(STOCK.toBase58(), SOL.toBase58()));
  const mints = new Map([
    [
      STOCK.toBase58(),
      {
        owner: TOKEN_PROGRAM_ID,
        data: mintData(8),
        lamports: 1_461_600,
        executable: false,
      },
    ],
    [
      SOL.toBase58(),
      {
        owner: TOKEN_PROGRAM_ID,
        data: mintData(9),
        lamports: 1_461_600,
        executable: false,
      },
    ],
  ]);
  const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();
  const connection = {
    rpcEndpoint: "memory://",
    commitment: "confirmed",
    sent,
    async getAccountInfo(key) {
      if (poolExists && key.equals(pool))
        return {
          owner: CP_AMM_PROGRAM_ID,
          data: Buffer.alloc(1112),
          lamports: 8_630_000,
          executable: false,
        };
      return mints.get(key.toBase58()) ?? null;
    },
    async getMultipleAccountsInfo(keys) {
      return keys.map((key) => mints.get(key.toBase58()) ?? null);
    },
    async getMinimumBalanceForRentExemption(size) {
      return (size + 128) * 6_960;
    },
    async getLatestBlockhash() {
      return { blockhash, lastValidBlockHeight: 1_150 };
    },
    async getEpochInfo() {
      return { epoch: 870, blockHeight: 1_000, absoluteSlot: 2_000 };
    },
    async getRecentPerformanceSamples() {
      return [
        {
          numSlots: 150,
          samplePeriodSecs: 60,
          numTransactions: 1,
          slot: 2_000,
        },
      ];
    },
    async getSlot() {
      return 2_000;
    },
    async simulateTransaction() {
      return { value: { err: simulationErr, logs: [] } };
    },
    async sendRawTransaction(bytes) {
      sent.push(Buffer.from(bytes).toString("base64"));
      return "sig";
    },
    async getSignatureStatuses(signatures) {
      return {
        value: signatures.map(() => ({
          confirmationStatus: "confirmed",
          err: null,
        })),
      };
    },
  };
  return { connection, pool };
}

function deps(connection, plan, extra = {}) {
  const keys = new Map();
  const newKeypair = () => {
    const key = Keypair.generate();
    keys.set(key.publicKey.toBase58(), key);
    return key;
  };
  const base = createDammV2Venue({ connection, newKeypair, actionsOpen: true });
  return {
    env: ENV,
    connections: [connection],
    venuesFor: () => ({
      "meteora-damm2":
        extra.venue ??
        createStockPierVenue({
          connection,
          base: extra.base ?? base,
          plan,
          newKeypair,
        }),
      "meteora-dlmm": base,
    }),
    pricesOf: async () => ({
      x: 431.2,
      y: 184.2,
      xMint: plan.stock,
      yMint: plan.quote,
    }),
    forget: () => {},
    takeFreshKey: (publicKey) => {
      const key = keys.get(publicKey) ?? null;
      keys.delete(publicKey);
      return key;
    },
    relayMs: 2_000,
    pollMs: 1,
    ...extra.deps,
  };
}

const PLAN = {
  owner: OWNER.publicKey.toBase58(),
  stock: STOCK.toBase58(),
  quote: SOL.toBase58(),
  price: 2.3409,
};
const body = (pool, amountX = "21360000", amountY = "500000000") => ({
  action: "add",
  venue: "meteora-damm2",
  request: {
    pool,
    owner: OWNER.publicKey.toBase58(),
    amountX,
    amountY,
    slippageBps: 100,
  },
});

test("the template is one the venue takes: a static 0.30 % with the volatility part, the whole curve, fees in the quote coin", () => {
  const fees = stockPierFees();
  assert.ok(fees.dynamicFee, "the volatility part is on");
  assert.equal(fees.compoundingFeeBps, 0);
  assert.doesNotThrow(() =>
    validateCustomizablePoolParams({
      collectFeeMode: CollectFeeMode.OnlyB,
      activationType: ActivationType.Timestamp,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      initSqrtPrice: new BN("28234990632740470000"),
      liquidityDelta: new BN(1_000_000),
      tokenAAmount: new BN(1),
      tokenBAmount: new BN(1),
      tokenAMint: STOCK,
      tokenBMint: SOL,
      poolFees: fees,
    }),
  );
});

test("a price reads as a plain decimal, never an exponent", () => {
  assert.equal(priceString(2.3409), "2.340900000000");
  assert.equal(priceString(0.00000123), "0.000001230000000000");
  assert.throws(() => priceString(0));
});

test("the pier's address is the pair's own, whichever way round the mints come", () => {
  assert.equal(stockPierAddress(STOCK.toBase58(), SOL.toBase58()), stockPierAddress(SOL.toBase58(), STOCK.toBase58()));
});

test("a new pier is built under the engine's own Review: one transaction, the venue and the wallet's plumbing only, the fresh key sealed", async () => {
  const { connection, pool } = fakeChain();
  const reviewed = await reviewLiquidityAction(body(pool.toBase58()), deps(connection, PLAN));
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  const review = reviewed.value;
  assert.equal(review.transactions.length, 1);
  assert.equal(review.preview.pool, pool.toBase58());
  assert.equal(review.preview.opensPosition, true);
  // What goes in never passes what was asked.
  assert.ok(BigInt(review.preview.deposit.x.units) <= 21_360_000n);
  assert.ok(BigInt(review.preview.deposit.y.units) <= 500_000_000n);
  assert.equal(review.preview.deposit.x.asset, STOCK.toBase58());
  assert.equal(review.preview.deposit.y.asset, SOL.toBase58());
  // The pool's own rent stays the pool's; the position's comes back.
  const poolRent = review.preview.rent.find((row) => row.what === "pool");
  const positionRent = review.preview.rent.find((row) => row.what === "position");
  assert.equal(poolRent.refundable, false);
  assert.equal(positionRent.refundable, true);
  assert.equal(BigInt(poolRent.lamports), BigInt((1112 + 128) * 6960 + 2 * (165 + 128) * 6960));

  const tx = Transaction.from(Buffer.from(review.transactions[0].wireBase64, "base64"));
  const programs = new Set(tx.instructions.map((ix) => ix.programId.toBase58()));
  assert.ok(programs.has(CP_AMM_PROGRAM_ID.toBase58()));
  for (const program of programs)
    assert.ok(
      [
        "ComputeBudget111111111111111111111111111111",
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        "11111111111111111111111111111111",
        TOKEN_PROGRAM_ID.toBase58(),
        CP_AMM_PROGRAM_ID.toBase58(),
      ].includes(program),
      program,
    );
  assert.equal(tx.instructions[0].data.readUInt32LE(1), STOCK_BUILD_COMPUTE_UNITS);
  assert.equal(tx.feePayer.toBase58(), OWNER.publicKey.toBase58());
  // The wallet sees bytes nobody has signed: the NFT's slot is empty until the relay.
  assert.ok(tx.signatures.every((entry) => entry.signature === null || entry.signature.every((byte) => byte === 0)));
  assert.equal(tx.signatures.length, 2);
});

test("the wallet's signature goes through the engine's relay once, and the fresh key signs after it", async () => {
  const { connection, pool } = fakeChain();
  const d = deps(connection, PLAN);
  const reviewed = await reviewLiquidityAction(body(pool.toBase58()), d);
  assert.equal(reviewed.ok, true);
  const unsigned = VersionedTransaction.deserialize(Buffer.from(reviewed.value.transactions[0].wireBase64, "base64"));
  unsigned.sign([OWNER]);
  const signed = Buffer.from(unsigned.serialize()).toString("base64");
  const relayed = await submitLiquidityAction({ ticket: reviewed.value.ticket, signed: [signed] }, d);
  assert.equal(relayed.ok, true, JSON.stringify(relayed));
  assert.equal(relayed.value.settled, true);
  assert.equal(connection.sent.length, 1);
  const landed = VersionedTransaction.deserialize(Buffer.from(connection.sent[0], "base64"));
  assert.ok(
    landed.signatures.every((signature) => signature.some((byte) => byte !== 0)),
    "both signatures are real",
  );
  // Other bytes than the Review's are refused.
  const other = VersionedTransaction.deserialize(Buffer.from(reviewed.value.transactions[0].wireBase64, "base64"));
  const again = await submitLiquidityAction(
    {
      ticket: reviewed.value.ticket,
      signed: [Buffer.from(other.serialize()).toString("base64")],
    },
    d,
  );
  assert.equal(again.ok, false);
});

test("a standing pier is the engine's own add: the Stock Pier's venue hands it over untouched", async () => {
  const { connection, pool } = fakeChain({ poolExists: true });
  const calls = [];
  const engine = createDammV2Venue({ connection, actionsOpen: true });
  const base = {
    ...engine,
    previewAdd: async (request) => (calls.push(request), Promise.reject(new Error("engine add asked"))),
  };
  const venue = createStockPierVenue({ connection, base, plan: PLAN });
  await assert.rejects(venue.previewAdd(body(pool.toBase58()).request), /engine add asked/);
  assert.equal(calls.length, 1);
});

test("a build for another wallet, an empty side or a refused simulation never reaches a signature", async () => {
  const { connection, pool } = fakeChain();
  const venue = createStockPierVenue({
    connection,
    base: createDammV2Venue({ connection }),
    plan: PLAN,
  });
  await assert.rejects(
    venue.previewAdd({
      ...body(pool.toBase58()).request,
      owner: Keypair.generate().publicKey.toBase58(),
    }),
    (error) => error.code === "NOT_OWNER",
  );
  await assert.rejects(venue.previewAdd({ ...body(pool.toBase58()).request, amountX: "0" }), (error) => error.code === "AMOUNT_ZERO");
  const refused = fakeChain({
    simulationErr: { InstructionError: [3, { Custom: 6012 }] },
  });
  const answer = await reviewLiquidityAction(body(refused.pool.toBase58()), deps(refused.connection, PLAN));
  assert.equal(answer.ok, false);
  assert.equal(answer.code, "SIMULATION_FAILED");
  // The engine's gate still decides.
  const closed = await reviewLiquidityAction(body(pool.toBase58()), {
    ...deps(connection, PLAN),
    env: { ...ENV, RYNTRA_LIQUIDITY_ACTIONS: "CLOSED" },
  });
  assert.equal(closed.code, "ACTIONS_CLOSED");
});

/* ------------------------------------------------------------------ the city's door */

const OPEN = { NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER: "open" };
const doorBody = (over = {}) => ({
  action: "build",
  stock: pair().mint,
  quote: "sol",
  owner: OWNER.publicKey.toBase58(),
  amountA: "116000",
  amountB: "250000000",
  ...over,
});

function doorDeps(over = {}) {
  const calls = [];
  const verified = pair();
  return {
    calls,
    deps: {
      env: OPEN,
      pairOf: async (mint) => (mint === verified.mint ? verified : null),
      quoteUsd: async () => 184.2,
      now: () => Date.UTC(2026, 9, 30, 17),
      review: async (engineBody, plan) => {
        calls.push({ engineBody, plan });
        return {
          ok: true,
          value: {
            preview: {
              action: "add",
              pool: engineBody.request.pool,
              price: String(plan.price),
              rangeState: "in_range",
              deposit: {
                x: {
                  asset: plan.stock,
                  units: engineBody.request.amountX,
                  decimals: 8,
                },
                y: {
                  asset: plan.quote,
                  units: engineBody.request.amountY,
                  decimals: 9,
                },
              },
              rent: [
                {
                  what: "pool",
                  direction: "pay",
                  lamports: "13000000",
                  refundable: false,
                },
              ],
            },
            transactions: [],
            ticket: "t",
          },
        };
      },
      ...over,
    },
  };
}

test("the door prices the pool from the live market, per base token, and lets the engine build", async () => {
  const { deps: d, calls } = doorDeps();
  const answer = await reviewStockBuild(doorBody(), d);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.builds, true);
  assert.equal(calls.length, 1);
  assert.ok(Math.abs(calls[0].plan.price - 431.2 / 184.2) < 1e-12);
  assert.equal(calls[0].engineBody.request.pool, pair().piers.sol.address);
  assert.equal(calls[0].engineBody.request.amountX, "116000");
  assert.equal(calls[0].engineBody.venue, "meteora-damm2");
});

test("the door refuses before the engine: closed, not offered, a dividend in its window, no price, over the ceiling", async () => {
  const closed = doorDeps({ env: {} });
  assert.equal((await reviewStockBuild(doorBody(), closed.deps)).code, "STOCK_PIER_CLOSED");
  const stopped = doorDeps({
    env: { ...OPEN, RYNTRA_CITY_STOCK_PIER_STOP: "1" },
  });
  assert.equal((await reviewStockBuild(doorBody(), stopped.deps)).code, "STOCK_PIER_STOPPED");
  assert.equal((await reviewStockBuild(doorBody({ stock: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" }), doorDeps().deps)).code, "STOCK_PIER_PAIR");
  const at = Date.UTC(2026, 9, 30, 17) + 9 * 3_600_000;
  const dividend = doorDeps({
    pairOf: async () => pair({ step: { at: new Date(at).toISOString(), from: 1, to: 1.004 } }),
  });
  const held = await reviewStockBuild(doorBody(), dividend.deps);
  assert.equal(held.code, "STOCK_PIER_DIVIDEND");
  assert.equal(held.status, 409);
  assert.equal(dividend.calls.length, 0);
  assert.equal((await reviewStockBuild(doorBody(), doorDeps({ quoteUsd: async () => null }).deps)).code, "STOCK_PIER_UNPRICED");
  // $1,000 is the ceiling: 6 SOL is $1,105.
  assert.equal((await reviewStockBuild(doorBody({ amountB: "6000000000" }), doorDeps().deps)).code, "STOCK_PIER_CEILING");
  assert.equal((await reviewStockBuild({ action: "build" }, doorDeps().deps)).code, "BAD_REQUEST");
});

test("the door drops a Review that is not an add on that very pier with those very coins", async () => {
  const wrong = doorDeps({
    review: async (engineBody, plan) => ({
      ok: true,
      value: {
        preview: {
          action: "add",
          pool: engineBody.request.pool,
          deposit: { x: { asset: plan.quote }, y: { asset: plan.stock } },
          rent: [],
        },
        transactions: [],
        ticket: "t",
      },
    }),
  });
  assert.equal((await reviewStockBuild(doorBody(), wrong.deps)).code, "STOCK_PIER_PAIR");
});

test("a standing pier made the other way round takes the quote coin as its X", async () => {
  const reversed = pair({
    piers: {
      ...pair().piers,
      sol: { ...pair().piers.sol, built: true, stockIsA: false },
    },
  });
  const { deps: d, calls } = doorDeps({
    pairOf: async () => reversed,
    review: async (engineBody, plan) => {
      calls.push({ engineBody, plan });
      return {
        ok: true,
        value: {
          preview: {
            action: "add",
            pool: engineBody.request.pool,
            price: String(1 / plan.price),
            rangeState: "in_range",
            deposit: { x: { asset: plan.quote }, y: { asset: plan.stock } },
            rent: [],
          },
          transactions: [],
          ticket: "t",
        },
      };
    },
  });
  const answer = await reviewStockBuild(doorBody(), d);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.builds, false);
  assert.equal(calls[0].engineBody.request.amountX, "250000000");
  assert.equal(calls[0].engineBody.request.amountY, "116000");
});

test("a standing pier at a price that is not the market's is refused before the wallet is asked", async () => {
  const standing = pair({ piers: { ...pair().piers, sol: { ...pair().piers.sol, built: true } } });
  const at = (price, rangeState = "in_range") =>
    doorDeps({
      pairOf: async () => standing,
      review: async (engineBody, plan) => ({
        ok: true,
        value: {
          preview: { action: "add", pool: engineBody.request.pool, price: String(price(plan.price)), rangeState, deposit: { x: { asset: plan.stock }, y: { asset: plan.quote } }, rent: [] },
          transactions: [],
          ticket: "t",
        },
      }),
    }).deps;
  // Made at a tenth of the market: the add would hand the stock over at that price.
  const crooked = await reviewStockBuild(
    doorBody(),
    at((p) => p / 10),
  );
  assert.equal(crooked.code, "STOCK_PIER_PRICE");
  assert.equal(crooked.status, 409);
  assert.equal(
    (
      await reviewStockBuild(
        doorBody(),
        at((p) => p * 1.02),
      )
    ).code,
    "STOCK_PIER_PRICE",
  );
  assert.equal(
    (
      await reviewStockBuild(
        doorBody(),
        at((p) => p, "above"),
      )
    ).code,
    "STOCK_PIER_PRICE",
    "an add off the price is a resting order, not a mooring",
  );
  const fair = await reviewStockBuild(
    doorBody(),
    at((p) => p * 1.004),
  );
  assert.equal(fair.ok, true);
  assert.equal(fair.builds, false);
});

test("prices agree within a hundredth, and never on a figure that is not one", () => {
  assert.equal(priceAgrees("2.3409", 2.3409), true);
  assert.equal(priceAgrees("2.36", 2.3409), true);
  assert.equal(priceAgrees("2.4", 2.3409), false);
  assert.equal(priceAgrees("abc", 2.3409), false);
  assert.equal(priceAgrees("0", 2.3409), false);
  assert.equal(priceAgrees("2.3", 0), false);
});

test("lamports sent to the pier's address do not block it: an account that is not the program's is no pier", async () => {
  const { connection, pool } = fakeChain();
  const funded = {
    ...connection,
    getAccountInfo: async (key) =>
      key.equals(pool) ? { owner: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0), lamports: 1_000_000, executable: false } : connection.getAccountInfo(key),
  };
  const reviewed = await reviewLiquidityAction(body(pool.toBase58()), deps(funded, PLAN));
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  assert.ok(
    reviewed.value.preview.rent.some((row) => row.what === "pool"),
    "it builds the pier",
  );
});
