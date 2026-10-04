// Run from repo root: node --test lib/solana/jupiter-build.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

import {
  BUILD_QUOTE_STAND_IN_TAKER,
  PRIORITY_FEE_CEILING_LAMPORTS,
  assembleJupiterBuildOrder,
  cappedComputeUnitPrice,
  fetchJupiterBuild,
  priorityFeeLamports,
  statedComputeUnitPrice,
} from "./jupiter-build.ts";
import { JUPITER_SWAP_V2_BASE_URL } from "./quotes.ts";

/* A real /build answer (2026-10-05): 0.01 SOL → USDC, 10 bps into the fee wallet's wSOL account. */
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/jupiter-build-sol-usdc.json", import.meta.url), "utf8"));
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const FEE_WALLET = "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne";
const FEE_ACCOUNT = "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578";
const FEE = { bps: 10, side: "INPUT", mint: WSOL, owner: FEE_WALLET, account: FEE_ACCOUNT, decimals: 9, symbol: "SOL" };
const REQUEST = { inputMint: WSOL, outputMint: USDC, amountRaw: "10000000", taker: TAKER, fee: FEE };
const ENDPOINT = {
  ok: true,
  access: "production",
  tier: "pro",
  baseUrl: JUPITER_SWAP_V2_BASE_URL,
  orderUrl: `${JUPITER_SWAP_V2_BASE_URL}/order`,
  buildUrl: `${JUPITER_SWAP_V2_BASE_URL}/build`,
  executeUrl: `${JUPITER_SWAP_V2_BASE_URL}/execute`,
  label: "Jupiter Swap API V2, keyed production",
  authorizationHeaders: () => ({ "x-api-key": "test" }),
};
const answering = (body, status = 200, seen = []) => async (url) => {
  seen.push(new URL(url));
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};
const NOW = () => new Date("2026-10-05T12:00:00.000Z");

test("a /build answer is the order shape every guard step checks: path BUILD_SUBMIT, the fee exact on the input side, Jupiter's own fee zero", async () => {
  const seen = [];
  const result = await fetchJupiterBuild(REQUEST, ENDPOINT, { fetchImpl: answering(FIXTURE, 200, seen), now: NOW });
  assert.equal(result.ok, true, result.reason);
  const url = seen[0];
  assert.equal(url.origin + url.pathname, `${JUPITER_SWAP_V2_BASE_URL}/build`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    inputMint: WSOL,
    outputMint: USDC,
    amount: "10000000",
    taker: TAKER,
    slippageBps: "rtse",
    platformFeeBps: "10",
    feeAccount: FEE_ACCOUNT,
  });
  const quote = result.answer.quote;
  assert.equal(quote.path, "BUILD_SUBMIT");
  assert.equal(quote.router, "metis");
  assert.equal(quote.requestId.startsWith("build:"), true);
  assert.deepEqual(quote.ryntraFeeAccount, { owner: FEE_WALLET, account: FEE_ACCOUNT });
  assert.deepEqual(
    [quote.ryntraFee.mechanism, quote.ryntraFee.state, quote.ryntraFee.basisPoints, quote.ryntraFee.amountRaw, quote.ryntraFee.asset, quote.ryntraFee.accrual, quote.ryntraFee.providerRetainedPercent],
    ["JUPITER_PLATFORM_FEE", "QUOTED", 10, "10000", WSOL, "FEE_WALLET_TOKEN_ACCOUNT", 0],
  );
  assert.deepEqual([quote.totalFeeBasisPoints, quote.platformFee.basisPoints, quote.providerReferralAccount], [10, 0, null]);
  assert.deepEqual([quote.inUsdValue, quote.outUsdValue], [null, null], "/build states no dollar figure and none is invented");
  assert.equal(quote.reviewExpiresAt, "2026-10-05T12:00:45.000Z");
});

test("a read-only quote asks under the stand-in taker and names no payer", async () => {
  const seen = [];
  const result = await fetchJupiterBuild({ ...REQUEST, taker: null }, ENDPOINT, { fetchImpl: answering(FIXTURE, 200, seen), now: NOW });
  assert.equal(result.ok, true);
  assert.equal(seen[0].searchParams.get("taker"), BUILD_QUOTE_STAND_IN_TAKER);
  assert.equal(result.answer.quote.signatureFeePayer, null);
});

test("an output-side fee carries the rate and no amount until the chain says", async () => {
  const result = await fetchJupiterBuild({ ...REQUEST, fee: { ...FEE, side: "OUTPUT" } }, ENDPOINT, { fetchImpl: answering(FIXTURE), now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.answer.quote.ryntraFee.amountRaw, null);
});

test("no fee asked is a stated zero: dollar to dollar", async () => {
  const seen = [];
  const result = await fetchJupiterBuild({ ...REQUEST, fee: null }, ENDPOINT, { fetchImpl: answering(FIXTURE, 200, seen), now: NOW });
  assert.equal(result.ok, true);
  assert.equal(seen[0].searchParams.has("platformFeeBps"), false);
  assert.equal(seen[0].searchParams.has("feeAccount"), false);
  assert.deepEqual([result.answer.quote.ryntraFee.mechanism, result.answer.quote.ryntraFee.basisPoints, result.answer.quote.ryntraFeeAccount], ["NONE", 0, undefined]);
});

test("a /build answer this lane cannot vouch for is refused, never repaired", async () => {
  const otherAccount = await fetchJupiterBuild({ ...REQUEST, fee: { ...FEE, account: "GfZQv5L2fAmqNgMsUv97ecV3MUF8GYs7rE7K4ySJDhod" } }, ENDPOINT, { fetchImpl: answering(FIXTURE), now: NOW });
  assert.equal(otherAccount.ok, false);
  assert.match(otherAccount.reason, /does not pay the fee account/);
  const tipped = await fetchJupiterBuild(REQUEST, ENDPOINT, { fetchImpl: answering({ ...FIXTURE, tipInstruction: FIXTURE.swapInstruction }), now: NOW });
  assert.match(tipped.reason, /tip was not asked for/);
  const otherAmount = await fetchJupiterBuild({ ...REQUEST, amountRaw: "20000000" }, ENDPOINT, { fetchImpl: answering(FIXTURE), now: NOW });
  assert.match(otherAmount.reason, /input amount/);
  const otherProgram = await fetchJupiterBuild(REQUEST, ENDPOINT, { fetchImpl: answering({ ...FIXTURE, swapInstruction: { ...FIXTURE.swapInstruction, programId: "11111111111111111111111111111111" } }), now: NOW });
  assert.match(otherProgram.reason, /not Jupiter's program/);
  const keyless = await fetchJupiterBuild(REQUEST, { ...ENDPOINT, access: "degraded", tier: "lite" }, { fetchImpl: answering(FIXTURE), now: NOW });
  assert.match(keyless.reason, /keyed production endpoint only/);
});

test("a refusal is the venue's own answer: rate, no route, a stated reason", async () => {
  const limited = await fetchJupiterBuild(REQUEST, ENDPOINT, { fetchImpl: answering({ error: "Too many requests" }, 429) });
  assert.equal(limited.code, "RATE_LIMITED");
  const noRoute = await fetchJupiterBuild(REQUEST, ENDPOINT, { fetchImpl: answering({ error: "No routes found" }, 400) });
  assert.equal(noRoute.code, "NO_ROUTE");
  const refused = await fetchJupiterBuild(REQUEST, ENDPOINT, { fetchImpl: answering({ error: "feeAccount is invalid" }, 400) });
  assert.deepEqual([refused.code, refused.reason], ["REFUSED", "Jupiter refused the build with HTTP 400: feeAccount is invalid"]);
});

test("the priority fee is clamped to its ceiling at the limit the simulation sized", () => {
  assert.equal(statedComputeUnitPrice([{ programId: "ComputeBudget111111111111111111111111111111", accounts: [], data: Buffer.from([3, 64, 66, 15, 0, 0, 0, 0, 0]).toString("base64") }]), 1_000_000n);
  const limit = 200_000;
  assert.equal(cappedComputeUnitPrice(10_000n, limit), 10_000n);
  const capped = cappedComputeUnitPrice(100_000_000n, limit);
  assert.equal(priorityFeeLamports(capped, limit) <= PRIORITY_FEE_CEILING_LAMPORTS, true);
  assert.equal(priorityFeeLamports(1n, 1), 1n, "a part of a lamport rounds up, as the runtime rounds");
});

test("the person's order: bytes for their wallet, compute sized by simulation, the fee account a static account, rent estimated for what the setup opens", async () => {
  const answer = (await fetchJupiterBuild(REQUEST, ENDPOINT, { fetchImpl: answering(FIXTURE), now: NOW })).answer;
  const calls = [];
  const handle = {
    timeoutMs: 1_000,
    retries: 0,
    endpoints: [{}],
    rpc: {
      simulateTransaction: (wire, config) => ({ send: async () => (calls.push(["simulate", config]), { value: { err: null, unitsConsumed: 100_000n } }) }),
      getMultipleAccounts: (addresses) => ({ send: async () => (calls.push(["accounts", addresses]), { value: addresses.map(() => null) }) }),
    },
  };
  const assembled = await assembleJupiterBuildOrder(answer, handle);
  assert.equal(assembled.ok, true, assembled.reason);
  const order = assembled.order;
  assert.deepEqual([order.schema, order.execution, order.taker, order.path], ["ryntra.solana.jupiter-executable-order", "EXECUTABLE_NOT_SUBMITTED", TAKER, "BUILD_SUBMIT"]);
  assert.equal(calls[0][1].sigVerify, false);
  const wire = Buffer.from(order.transactionBase64, "base64");
  assert.ok(wire.length <= 1232);
  const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes);
  assert.equal(message.staticAccounts[0], TAKER, "the person pays the network");
  assert.ok(message.staticAccounts.includes(FEE_ACCOUNT), "the fee account is the message's own, where the fee proof can see it");
  const budget = message.instructions[0];
  assert.equal(message.staticAccounts[budget.programAddressIndex], "ComputeBudget111111111111111111111111111111");
  assert.equal(Buffer.from(budget.data).readUInt32LE(1), 120_000, "the simulated units × 1.2");
  const stated = statedComputeUnitPrice(answer.computeBudget);
  assert.equal(order.priorityFeeLamports, priorityFeeLamports(cappedComputeUnitPrice(stated, 120_000), 120_000).toString());
  const opened = calls.find(([name]) => name === "accounts");
  assert.ok(opened, "the accounts the setup opens are read");
  assert.equal(BigInt(order.rentFeeLamports) % 2_039_280n, 0n);
});

test("assembly refuses a read-only quote and a signer that is not the wallet", async () => {
  const quoteOnly = (await fetchJupiterBuild({ ...REQUEST, taker: null }, ENDPOINT, { fetchImpl: answering(FIXTURE), now: NOW })).answer;
  assert.match((await assembleJupiterBuildOrder(quoteOnly, {})).reason, /no wallet/);
  const answer = (await fetchJupiterBuild(REQUEST, ENDPOINT, { fetchImpl: answering(FIXTURE), now: NOW })).answer;
  const foreign = { ...answer, setup: [{ programId: "11111111111111111111111111111111", accounts: [{ pubkey: FEE_WALLET, isSigner: true, isWritable: true }], data: "" }] };
  assert.match((await assembleJupiterBuildOrder(foreign, {})).reason, /signer other than the person's wallet/);
});
