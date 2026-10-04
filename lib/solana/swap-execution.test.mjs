import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import {
  executeJupiterOrder,
  fetchJupiterExecutableOrder,
  resolveJupiterSwapEndpoint,
} from "./quotes.ts";
import { inspectJupiterSwapTransaction } from "./swap-transaction-check.ts";

const FIXTURE_PATH = join("lib", "solana", "fixtures", "jupiter-order-v2-sol-usdc.json");
const loadOrder = () => JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

const TAKER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OTHER_WALLET = "JUPhop9E8ZfdJ5FNHhxQt4uAih822Vs4QpqsWcewFbq";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TEMP_WSOL = "2TH1jDxy2tv8HwXdMMXwWaw4sT9VYCDLWHKGqDgjrdiv";
const BLOCKHASH = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const keyedSelection = () => resolveJupiterSwapEndpoint({ access: "production", apiKey: "jup_test_key" });

function executableBody(overrides = {}) {
  return { ...loadOrder(), taker: TAKER, transaction: "AQIDBAUGBwg=", lastValidBlockHeight: 443000000, ...overrides };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

test("executable order: key absent refuses before any request", async () => {
  let calls = 0;
  const result = await fetchJupiterExecutableOrder(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000", taker: TAKER },
    resolveJupiterSwapEndpoint({ access: "production", apiKey: null }),
    { fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } },
  );
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "PRODUCTION_KEY_REQUIRED");
});

test("executable order: success carries the taker, the signable bytes and the taker query parameter", async () => {
  let requestedUrl = null;
  const result = await fetchJupiterExecutableOrder(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000", taker: TAKER },
    keyedSelection(),
    {
      fetchImpl: async (url) => {
        requestedUrl = new URL(url);
        return jsonResponse(executableBody());
      },
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    },
  );
  assert.equal(requestedUrl.searchParams.get("taker"), TAKER);
  assert.equal(requestedUrl.searchParams.get("excludeRouters"), "jupiterz");
  assert.equal(result.ok, true);
  assert.equal(result.order.schema, "ryntra.solana.jupiter-executable-order");
  assert.equal(result.order.execution, "EXECUTABLE_NOT_SUBMITTED");
  assert.equal(result.order.taker, TAKER);
  assert.equal(result.order.transactionBase64, "AQIDBAUGBwg=");
  assert.equal(result.order.inAmountRaw, "1000000");
  assert.equal(result.order.requestId, "11111111-2222-4333-8444-555555555555");
  assert.equal(result.order.lastValidBlockHeight, "443000000");
  assert.deepEqual(result.order.routeAffectingOptions, ["excludeRouters=jupiterz"]);
});

test("executable order: a refusal for rate is one request and carries the provider's short pause — the route asks again, never this fetch", async () => {
  const nowS = Math.floor(Date.now() / 1000);
  for (const [headers, expected] of [
    [{ "retry-after": "1" }, 1000],
    /* The refusal of 2026-09-28: the reset 4 s away — a person's order waits for it (a read would not). */
    [{ "retry-after": "4" }, 4000],
    [{ "x-ratelimit-reset": String(nowS + 40) }, null],
    [{}, null],
  ]) {
    let calls = 0;
    const result = await fetchJupiterExecutableOrder(
      { inputMint: USDC, outputMint: WSOL, amountRaw: "1000000", taker: TAKER },
      keyedSelection(),
      {
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { "content-type": "application/json", ...headers } });
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.code, "RATE_LIMITED");
    assert.equal(result.retryWaitMs, expected);
  }
});

test("executable order: a named slippage bound goes out as a fixed slippageBps and is a route-affecting option; absent, none goes out", async () => {
  let requestedUrl = null;
  const bound = await fetchJupiterExecutableOrder(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000", taker: TAKER, slippageBps: 50 },
    keyedSelection(),
    {
      fetchImpl: async (url) => {
        requestedUrl = new URL(url);
        return jsonResponse(executableBody({ slippageBps: 50 }));
      },
    },
  );
  assert.equal(requestedUrl.searchParams.get("slippageBps"), "50");
  assert.equal(bound.ok, true);
  assert.deepEqual(bound.order.routeAffectingOptions, ["excludeRouters=jupiterz", "slippageBps=50"]);

  const unbound = await fetchJupiterExecutableOrder(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000", taker: TAKER },
    keyedSelection(),
    {
      fetchImpl: async (url) => {
        requestedUrl = new URL(url);
        return jsonResponse(executableBody());
      },
    },
  );
  assert.equal(requestedUrl.searchParams.has("slippageBps"), false);
  assert.equal(unbound.ok, true);
});

test("executable order: a slippage bound that is not whole basis points in the venue's range is MALFORMED before any request", async () => {
  for (const slippageBps of [0, 0.5, 10_001, Number.NaN]) {
    let calls = 0;
    const result = await fetchJupiterExecutableOrder(
      { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000", taker: TAKER, slippageBps },
      keyedSelection(),
      { fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } },
    );
    assert.equal(calls, 0, `no request for ${slippageBps}`);
    assert.equal(result.ok, false);
    assert.equal(result.code, "MALFORMED");
    assert.match(result.reason, /basis points/);
  }
});

test("executable order: an empty transaction is a BUILD_FAILED refusal, never a signable order", async () => {
  const result = await fetchJupiterExecutableOrder(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000", taker: TAKER },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse(executableBody({ transaction: "", errorCode: 2 })) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "BUILD_FAILED");
  assert.equal(result.router, "dflow");
  assert.equal(result.errorCode, "2");
});

test("executable order: a taker echo mismatch is MALFORMED", async () => {
  const result = await fetchJupiterExecutableOrder(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000", taker: OTHER_WALLET },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse(executableBody()) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "MALFORMED");
  assert.match(result.reason, /taker/);
});

test("executable order: 429 is RATE_LIMITED with no fallback", async () => {
  const result = await fetchJupiterExecutableOrder(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000", taker: TAKER },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse({}, { status: 429 }) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "RATE_LIMITED");
});

test("execute: refuses locally before any network when the payload is out of bound", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("must not fetch"); };
  const badBase64 = await executeJupiterOrder(
    { signedTransactionBase64: "not base64!!", requestId: "r-1" },
    keyedSelection(),
    { fetchImpl },
  );
  assert.equal(badBase64.ok, false);
  assert.equal(badBase64.code, "PINNED_CONTRACT");
  assert.equal(badBase64.possiblySubmitted, false);
  const emptyRequestId = await executeJupiterOrder(
    { signedTransactionBase64: "AQID", requestId: "" },
    keyedSelection(),
    { fetchImpl },
  );
  assert.equal(emptyRequestId.code, "PINNED_CONTRACT");
  assert.equal(calls, 0);
});

test("execute: a Success report carries signature and both amount families", async () => {
  let posted = null;
  let headers = null;
  const result = await executeJupiterOrder(
    { signedTransactionBase64: "AQIDBAUGBwg=", requestId: "req-42" },
    keyedSelection(),
    {
      fetchImpl: async (url, init) => {
        posted = JSON.parse(init.body);
        headers = init.headers;
        assert.equal(String(url), "https://api.jup.ag/swap/v2/execute");
        return jsonResponse({
          status: "Success",
          code: 0,
          signature: "5KtP3xW1yzYqUYy8VbDGmqM8kM9v9gPB5tSxgqiJ9m6cWn9wFhVwFq6cRt2Yc3T1P2mHrM4pTn7SxAqzKcXAmpler",
          totalInputAmount: "1000000",
          totalOutputAmount: "104400",
          inputAmountResult: "999800",
          outputAmountResult: "104497",
        });
      },
    },
  );
  assert.equal(posted.signedTransaction, "AQIDBAUGBwg=");
  assert.equal(posted.requestId, "req-42");
  assert.equal(headers["x-api-key"], "jup_test_key");
  assert.equal(result.ok, true);
  assert.equal(result.report.status, "Success");
  assert.equal(result.report.code, 0);
  assert.equal(result.report.totalInputAmountRaw, "1000000");
  assert.equal(result.report.outputAmountResultRaw, "104497");
});

test("execute: a Failed report with a negative provider code is still a definitive provider answer", async () => {
  const result = await executeJupiterOrder(
    { signedTransactionBase64: "AQIDBAUGBwg=", requestId: "req-43" },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse({ status: "Failed", code: -1000, error: "failed to land" }) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.report.status, "Failed");
  assert.equal(result.report.code, -1000);
  assert.equal(result.report.signature, null);
  assert.equal(result.report.providerError, "failed to land");
});

test("execute: a network failure after the POST is AMBIGUOUS and possibly submitted", async () => {
  const result = await executeJupiterOrder(
    { signedTransactionBase64: "AQIDBAUGBwg=", requestId: "req-44" },
    keyedSelection(),
    { fetchImpl: async () => { throw new Error("socket reset"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "AMBIGUOUS_NETWORK");
  assert.equal(result.possiblySubmitted, true);
  assert.match(result.reason, /Never execute again/i);
});

test("execute: HTTP and malformed answers stay ambiguous, never definitive", async () => {
  const http = await executeJupiterOrder(
    { signedTransactionBase64: "AQIDBAUGBwg=", requestId: "req-45" },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse({ error: "internal" }, { status: 500 }) },
  );
  assert.equal(http.code, "AMBIGUOUS_HTTP");
  assert.equal(http.possiblySubmitted, true);

  const weird = await executeJupiterOrder(
    { signedTransactionBase64: "AQIDBAUGBwg=", requestId: "req-46" },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse({ status: "Landed", code: 0 }) },
  );
  assert.equal(weird.code, "AMBIGUOUS_MALFORMED");
  assert.equal(weird.possiblySubmitted, true);

  const successWithoutSignature = await executeJupiterOrder(
    { signedTransactionBase64: "AQIDBAUGBwg=", requestId: "req-47" },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse({ status: "Success", code: 0 }) },
  );
  assert.equal(successWithoutSignature.code, "AMBIGUOUS_MALFORMED");

  const contradictorySuccess = await executeJupiterOrder(
    { signedTransactionBase64: "AQIDBAUGBwg=", requestId: "req-48" },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse({
      status: "Success",
      code: -1000,
      signature: "N3zXBD2bcRWyRh5bVxs2Tr1z6aWKoobLpTkkxRvoSCJCBZv9z5joMjayx4pPSCz5sGt1UyfLkTQthDLEtS8aVwJ",
    }) },
  );
  assert.equal(contradictorySuccess.code, "AMBIGUOUS_MALFORMED");

  const contradictoryFailure = await executeJupiterOrder(
    { signedTransactionBase64: "AQIDBAUGBwg=", requestId: "req-49" },
    keyedSelection(),
    { fetchImpl: async () => jsonResponse({ status: "Failed", code: 0 }) },
  );
  assert.equal(contradictoryFailure.code, "AMBIGUOUS_MALFORMED");
});

function buildWire({ version = 0, feePayer = TAKER, program = MEMO_PROGRAM, data = new Uint8Array([1, 2, 3]) } = {}) {
  const message = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000n }, m),
    (m) => appendTransactionMessageInstructions(
      [{ programAddress: program, accounts: [], data }],
      m,
    ),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

function buildNativeWrapWire() {
  const transfer = new Uint8Array(12);
  const view = new DataView(transfer.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, 28_000_000n, true);
  const instructions = [
    {
      programAddress: ASSOCIATED_TOKEN_PROGRAM,
      accounts: [
        { address: TAKER, role: AccountRole.WRITABLE_SIGNER },
        { address: TEMP_WSOL, role: AccountRole.WRITABLE },
        { address: TAKER, role: AccountRole.READONLY_SIGNER },
        { address: WSOL, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
    },
    {
      programAddress: SYSTEM_PROGRAM,
      accounts: [
        { address: TAKER, role: AccountRole.WRITABLE_SIGNER },
        { address: TEMP_WSOL, role: AccountRole.WRITABLE },
      ],
      data: transfer,
    },
    {
      programAddress: TOKEN_PROGRAM,
      accounts: [{ address: TEMP_WSOL, role: AccountRole.WRITABLE }],
      data: new Uint8Array([17]),
    },
    {
      programAddress: TOKEN_PROGRAM,
      accounts: [
        { address: TEMP_WSOL, role: AccountRole.WRITABLE },
        { address: TAKER, role: AccountRole.WRITABLE_SIGNER },
        { address: TAKER, role: AccountRole.READONLY_SIGNER },
      ],
      data: new Uint8Array([9]),
    },
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(TAKER, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000n }, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

test("firewall: a v0 provider transaction with the taker as fee payer is inspected, hashed and enumerated", async () => {
  const wire = buildWire();
  const inspection = await inspectJupiterSwapTransaction({ wireBase64: wire, expectedTaker: TAKER });
  assert.equal(inspection.ok, true);
  assert.equal(inspection.version, 0);
  assert.equal(inspection.feePayer, TAKER);
  assert.deepEqual(inspection.signerAddresses, [TAKER]);
  assert.deepEqual(inspection.programs, [MEMO_PROGRAM]);
  assert.equal(inspection.providerPresignedCount, 0);
  assert.match(inspection.messageHashHex, /^[0-9a-f]{64}$/);
  assert.equal(inspection.blockhash, BLOCKHASH);

  const again = await inspectJupiterSwapTransaction({ wireBase64: wire, expectedTaker: TAKER });
  assert.equal(again.ok, true);
  assert.equal(again.messageHashHex, inspection.messageHashHex);
});

test("firewall: a fee payer other than the taker is refused before any wallet sees the bytes", async () => {
  const wire = buildWire({ feePayer: OTHER_WALLET });
  const inspection = await inspectJupiterSwapTransaction({ wireBase64: wire, expectedTaker: TAKER });
  assert.equal(inspection.ok, false);
  assert.equal(inspection.code, "FEE_PAYER_MISMATCH");
});

test("firewall: legacy messages and unreadable bytes are refused with named codes", async () => {
  const legacy = await inspectJupiterSwapTransaction({
    wireBase64: buildWire({ version: "legacy" }),
    expectedTaker: TAKER,
  });
  assert.equal(legacy.ok, false);
  assert.equal(legacy.code, "VERSION_UNSUPPORTED");

  const garbage = await inspectJupiterSwapTransaction({ wireBase64: "%%%", expectedTaker: TAKER });
  assert.equal(garbage.ok, false);
  assert.equal(garbage.code, "UNREADABLE");
});

test("firewall: a top-level token authority or approval mutation is refused even with zero balance delta", async () => {
  const approval = await inspectJupiterSwapTransaction({
    wireBase64: buildWire({ program: TOKEN_PROGRAM, data: new Uint8Array([4]) }),
    expectedTaker: TAKER,
  });
  assert.equal(approval.ok, false);
  assert.equal(approval.code, "DANGEROUS_TOKEN_INSTRUCTION");

  const unscopedClose = await inspectJupiterSwapTransaction({
    wireBase64: buildWire({ program: TOKEN_PROGRAM, data: new Uint8Array([9]) }),
    expectedTaker: TAKER,
  });
  assert.equal(unscopedClose.ok, false);
  assert.equal(unscopedClose.code, "DANGEROUS_TOKEN_INSTRUCTION");
});

test("firewall: ATA recovery and unscoped System mutation cannot hide beside a swap", async () => {
  const recoverNested = await inspectJupiterSwapTransaction({
    wireBase64: buildWire({ program: ASSOCIATED_TOKEN_PROGRAM, data: new Uint8Array([2]) }),
    expectedTaker: TAKER,
  });
  assert.equal(recoverNested.ok, false);
  assert.equal(recoverNested.code, "DANGEROUS_ACCOUNT_INSTRUCTION");

  const transfer = new Uint8Array(12);
  new DataView(transfer.buffer).setUint32(0, 2, true);
  const unscopedSystem = await inspectJupiterSwapTransaction({
    wireBase64: buildWire({ program: SYSTEM_PROGRAM, data: transfer }),
    expectedTaker: TAKER,
  });
  assert.equal(unscopedSystem.ok, false);
  assert.equal(unscopedSystem.code, "DANGEROUS_ACCOUNT_INSTRUCTION");
});

test("firewall: the only close lane is a created, funded, synced temporary wSOL account returning rent to taker", async () => {
  const inspection = await inspectJupiterSwapTransaction({
    wireBase64: buildNativeWrapWire(),
    expectedTaker: TAKER,
  });
  assert.equal(inspection.ok, true);
  assert.deepEqual(inspection.nativeWrapRoundTrip, {
    accountIndex: inspection.staticAccountCount > 1 ? 1 : -1,
    account: TEMP_WSOL,
    fundedLamportsRaw: "28000000",
    closesToTaker: true,
  });
});

/**
 * The same round trip with no funding and no sync — the shape a BUY of native
 * SOL produces, where the wSOL arrives as the swap's own output transfer.
 * `omitSync` splits the two so the funded-but-unsynced case can be refused
 * separately below.
 */
function buildBoughtSolWire({ fund = false, omitSync = true } = {}) {
  const transfer = new Uint8Array(12);
  const view = new DataView(transfer.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, 28_000_000n, true);
  const instructions = [
    {
      programAddress: ASSOCIATED_TOKEN_PROGRAM,
      accounts: [
        { address: TAKER, role: AccountRole.WRITABLE_SIGNER },
        { address: TEMP_WSOL, role: AccountRole.WRITABLE },
        { address: TAKER, role: AccountRole.READONLY_SIGNER },
        { address: WSOL, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
    },
    ...(fund
      ? [
          {
            programAddress: SYSTEM_PROGRAM,
            accounts: [
              { address: TAKER, role: AccountRole.WRITABLE_SIGNER },
              { address: TEMP_WSOL, role: AccountRole.WRITABLE },
            ],
            data: transfer,
          },
        ]
      : []),
    ...(omitSync
      ? []
      : [
          {
            programAddress: TOKEN_PROGRAM,
            accounts: [{ address: TEMP_WSOL, role: AccountRole.WRITABLE }],
            data: new Uint8Array([17]),
          },
        ]),
    {
      programAddress: TOKEN_PROGRAM,
      accounts: [
        { address: TEMP_WSOL, role: AccountRole.WRITABLE },
        { address: TAKER, role: AccountRole.WRITABLE_SIGNER },
        { address: TAKER, role: AccountRole.READONLY_SIGNER },
      ],
      data: new Uint8Array([9]),
    },
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(TAKER, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000n }, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

test("firewall: buying native SOL closes an unfunded temporary wSOL account, and syncNative is not demanded", async () => {
  /* Buying SOL never funds the account from the taker: the wSOL is the swap's
     own output. Demanding syncNative here refused every USDC → SOL order,
     which is half the canary pair. */
  const inspection = await inspectJupiterSwapTransaction({
    wireBase64: buildBoughtSolWire(),
    expectedTaker: TAKER,
  });
  assert.equal(inspection.ok, true);
  assert.equal(inspection.nativeWrapRoundTrip?.account, TEMP_WSOL);
  assert.equal(inspection.nativeWrapRoundTrip?.fundedLamportsRaw, "0");
  assert.equal(inspection.nativeWrapRoundTrip?.closesToTaker, true);
});

test("firewall: funding a temporary wSOL account without syncing it is still refused", async () => {
  /* The guard that was relaxed, held at its real boundary. Lamports moved into
     the account and never accounted for by syncNative is exactly the case the
     sync requirement exists for, and it stays refused. */
  const inspection = await inspectJupiterSwapTransaction({
    wireBase64: buildBoughtSolWire({ fund: true, omitSync: true }),
    expectedTaker: TAKER,
  });
  assert.equal(inspection.ok, false);
  assert.equal(inspection.code, "DANGEROUS_TOKEN_INSTRUCTION");
});
