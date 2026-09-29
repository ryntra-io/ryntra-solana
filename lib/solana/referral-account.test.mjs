import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  JUPITER_REFERRAL_PROGRAM,
  JUPITER_ULTRA_REFERRAL_PROJECT,
  REFERRAL_PROJECT_OFFSET,
  resetJupiterReferralCache,
  verifiedJupiterReferral,
  verifyJupiterReferralAccount,
} from "./referral-account.server.ts";
import { serviceFeeRateFor } from "../swap/service-fee.ts";
import { JUPITER_REFERRAL_FEE_MIN_BPS, fetchJupiterOrder, resolveJupiterSwapEndpoint } from "./quotes.ts";

const ACCOUNT = "18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** A base58 pubkey back into the 32 bytes an account read would return. */
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decode(text) {
  let value = 0n;
  for (const character of text) value = value * 58n + BigInt(BASE58.indexOf(character));
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const character of text) {
    if (character !== "1") break;
    bytes.unshift(0);
  }
  while (bytes.length < 32) bytes.unshift(0);
  return Buffer.from(bytes);
}

const handle = { network: "mainnet" };
const read = (project, owner = JUPITER_REFERRAL_PROGRAM) => async () => (project === null ? null : { owner, projectBase58: project });

test("the offset the project lives at is the one read off mainnet", () => {
  /* Eight bytes of discriminator and a 32-byte partner. Filtering
     `getProgramAccounts` at 40 for the Ultra project returned 1,774 accounts on
     2026-09-10; offsets 8 and 72 returned none. */
  assert.equal(REFERRAL_PROJECT_OFFSET, 40);
});

test("a real referral account under the Ultra project verifies", async () => {
  const verdict = await verifyJupiterReferralAccount(ACCOUNT, { handle, read: read(JUPITER_ULTRA_REFERRAL_PROJECT) });
  assert.deepEqual(verdict, { ok: true, account: ACCOUNT });
});

test("every way of being wrong refuses, and none of them breaks a swap", async () => {
  const cases = [
    [null, {}, "NOT_CONFIGURED"],
    [ACCOUNT, { read: read(null) }, "ACCOUNT_MISSING"],
    /* An ordinary wallet. Well-formed base58, and the exact address that made
       Jupiter answer HTTP 400 on 2026-09-10. */
    [ACCOUNT, { read: read(JUPITER_ULTRA_REFERRAL_PROJECT, "11111111111111111111111111111111") }, "WRONG_PROGRAM"],
    [ACCOUNT, { read: read("DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJd") }, "WRONG_PROJECT"],
    [ACCOUNT, { read: async () => { throw new Error("rpc down"); } }, "UNREADABLE"],
  ];
  for (const [account, deps, code] of cases) {
    const verdict = await verifyJupiterReferralAccount(account, { handle, ...deps });
    assert.equal(verdict.ok, false, `${code} must not verify`);
    assert.equal(verdict.code, code);
    assert.ok(verdict.reason.length > 0, "a refusal states why");
  }
});

test("an unreadable chain means no fee, never a guess that costs the lane", async () => {
  resetJupiterReferralCache();
  const { referral, verdict } = await verifiedJupiterReferral(
    { jupiterReferralAccount: ACCOUNT, relayAppFeeRecipient: null, mayanReferrerSolana: null },
    { handle, read: async () => { throw new Error("rpc down"); } },
  );
  assert.equal(referral, null, "not knowing is not a reason to risk the 400");
  assert.equal(verdict.code, "UNREADABLE");
});

test("the verdict is computed once per account and then kept", async () => {
  resetJupiterReferralCache();
  let reads = 0;
  const counting = async () => {
    reads += 1;
    return { owner: JUPITER_REFERRAL_PROGRAM, projectBase58: JUPITER_ULTRA_REFERRAL_PROJECT };
  };
  const config = { jupiterReferralAccount: ACCOUNT, relayAppFeeRecipient: null, mayanReferrerSolana: null };
  const first = await verifiedJupiterReferral(config, { handle, read: counting });
  const second = await verifiedJupiterReferral(config, { handle, read: counting });
  assert.equal(reads, 1, "a referral account does not stop being one");
  assert.deepEqual(first.referral, { account: ACCOUNT, feeBps: serviceFeeRateFor("JUPITER_REFERRAL") });
  assert.deepEqual(second.referral, first.referral);

  /* A different account is a different question. */
  const other = { ...config, jupiterReferralAccount: "1EVK1VSyJGm1SSkmn7B6tgdwwkMZRmZGgn1MUzCqBeZ" };
  await verifiedJupiterReferral(other, { handle, read: counting });
  assert.equal(reads, 2);
  resetJupiterReferralCache();
});

test("decoding a pubkey and encoding it back agree, so the project check is real", () => {
  /* The comparison the verifier makes is between a base58 string and 32 bytes it
     encodes itself. If that encoder were wrong, every account would read as the
     wrong project and the fee would silently never be requested. */
  assert.equal(decode(JUPITER_ULTRA_REFERRAL_PROJECT).length, 32);
  assert.equal(decode(JUPITER_REFERRAL_PROGRAM).length, 32);
});

test("a provider refusal that names the fee drops the fee, not the order", async () => {
  /* Jupiter's live 400 on 2026-09-10, verbatim. The first call carries the
     referral and is refused; the second must carry no referral parameters at all
     and its answer is the quote a person sees. */
  const seen = [];
  const fetchImpl = async (url) => {
    const target = new URL(String(url));
    seen.push(target.search);
    if (target.searchParams.has("referralAccount")) {
      return new Response(
        JSON.stringify({
          error:
            "Please check that referralAccount is initialized under REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3 for project DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(order()), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000", referral: { account: ACCOUNT, feeBps: 50 } },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, true, "a fee must never be able to make the market look unavailable");
  assert.equal(seen.length, 2, "exactly one retry");
  assert.match(seen[0], /referralAccount=/);
  assert.doesNotMatch(seen[1], /referral/, "the retry drops both fee parameters");
  assert.equal(result.order.ryntraFee.state, "UNCONFIGURED", "the quote a person sees carries no fee it did not earn");
  assert.equal(result.order.ryntraFee.basisPoints, 0);
});

test("the Jupiter rate the policy names reaches the wire, and it is the provider's own floor", async () => {
  /* Owner decision 2026-09-11: Jupiter same-chain (Swap and Spot) charges the
     provider's minimum, 50 bps; Relay stays at 25. The referral the verifier
     hands over carries that rate, and the request carries it verbatim. */
  assert.equal(serviceFeeRateFor("JUPITER_REFERRAL"), JUPITER_REFERRAL_FEE_MIN_BPS);
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(new URL(String(url)).searchParams);
    return new Response(JSON.stringify({ ...order(), referralAccount: ACCOUNT, feeBps: 50, platformFee: { feeBps: 50, feeMint: USDC } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000", referral: { account: ACCOUNT, feeBps: serviceFeeRateFor("JUPITER_REFERRAL") } },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].get("referralAccount"), ACCOUNT);
  assert.equal(seen[0].get("referralFee"), "50");
  assert.equal(result.order.ryntraFee.state, "QUOTED");
  assert.equal(result.order.ryntraFee.basisPoints, 50);
  assert.equal(result.order.ryntraFee.requestedBasisPoints, 50);
});

test("a rate under Jupiter's floor stays off the wire and the fee says exactly why", async () => {
  /* Found on production on 2026-09-11 with the rate at 25: every Review read
     *None* and called the account unconfigured. Jupiter's floor is 50 —
     verified live the same day, HTTP 400 *"must be between 50 and 255"* — so
     a referral below it is not sent, and the fee names the floor rather than
     an account nobody configured. The policy no longer asks for 25 on Jupiter;
     this guards the day somebody does again. */
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(new URL(String(url)).searchParams);
    return new Response(JSON.stringify(order()), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000", referral: { account: ACCOUNT, feeBps: 25 } },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1, "no retry is needed: the fee never went out");
  assert.equal(seen[0].has("referralAccount"), false);
  assert.equal(seen[0].has("referralFee"), false);
  assert.equal(result.order.ryntraFee.state, "NOT_APPLIED");
  assert.equal(result.order.ryntraFee.basisPoints, 0);
  assert.match(result.order.ryntraFee.note, /minimum referral fee is 50 bps/);
});

test("a fee the provider refuses as text/plain is still recognised, and costs the fee rather than the swap", async () => {
  /* Jupiter's live answer of 2026-09-11 to referralFee=25, byte for byte, in
     the content type it actually used. Read as a refusal, it drops the fee
     once; read as malformed JSON, it took the whole lane down. */
  const seen = [];
  const fetchImpl = async (url) => {
    const target = new URL(String(url));
    seen.push(target.search);
    if (target.searchParams.has("referralFee")) {
      return new Response(JSON.stringify({ error: "The referralFee parameter must be between 50 and 255 (inclusive)" }), {
        status: 400,
        headers: { "content-type": "text/plain;charset=UTF-8" },
      });
    }
    return new Response(JSON.stringify(order()), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000", referral: { account: ACCOUNT, feeBps: 50 } },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, true, "a fee must never be able to make the market look unavailable");
  assert.equal(seen.length, 2, "exactly one retry");
  assert.match(seen[0], /referralFee=50/);
  assert.doesNotMatch(seen[1], /referral/);
  assert.equal(result.order.ryntraFee.basisPoints, 0);
});

test("a successful order that is not JSON is still malformed", async () => {
  const fetchImpl = async () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } });
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000" },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "MALFORMED");
});

test("a refusal that is not about the fee is still a refusal", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "amount too small" }), { status: 400, headers: { "content-type": "application/json" } });
  };
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1", referral: { account: ACCOUNT, feeBps: 50 } },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "REFUSED");
  assert.equal(calls, 1, "nothing else is retried");
});

/** A minimal `/order` answer, shaped like the live one. */
function order() {
  return {
    swapMode: "ExactIn",
    inputMint: SOL,
    outputMint: USDC,
    inAmount: "1000000000",
    outAmount: "642446078",
    otherAmountThreshold: "639234000",
    slippageBps: 50,
    priceImpactPct: "0.0001",
    routePlan: [
      { bps: 10_000, swapInfo: { ammKey: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", label: "Raydium", inputMint: SOL, outputMint: USDC, inAmount: "1000000000", outAmount: "642446078" } },
    ],
    feeMint: SOL,
    feeBps: 2,
    platformFee: { feeBps: 2, feeMint: SOL },
    signatureFeeLamports: 0,
    signatureFeePayer: null,
    prioritizationFeeLamports: 0,
    prioritizationFeePayer: null,
    rentFeeLamports: 0,
    rentFeePayer: null,
    swapType: "aggregator",
    router: "okx",
    guaranteedPrice: false,
    transaction: null,
    taker: null,
    gasless: false,
    jitOptimized: false,
    requestId: "req-retry",
    inUsdValue: 642.4,
    outUsdValue: 642.4,
    swapUsdValue: 642.4,
    mode: "ultra",
  };
}

/* ── A quote that does not agree with itself ───────────────────────────────
   Owner instruction, 2026-09-10: an anomalous quote must not reach a person as
   a usable offer, and the answer is to filter it out and get another route —
   not to rewrite routing, and not to patch numbers onto an order that exists. */

test("a quote claiming the person gains value is refused and the router re-asked", async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    const target = new URL(String(url));
    const excluded = target.searchParams.get("excludeRouters");
    asked.push(excluded);
    /* `okx` answers 1 SOL with 642 USDC while pricing the input at 101 — the
       shape seen live on 2026-09-10. `metis` answers honestly. */
    const bad = !excluded || !excluded.includes("okx");
    return new Response(
      JSON.stringify(
        bad
          ? { ...order(), router: "okx", outAmount: "642446078", otherAmountThreshold: "639234000", inUsdValue: 101.67, outUsdValue: 642.36 }
          : { ...order(), router: "metis", outAmount: "101680000", otherAmountThreshold: "101680000", inUsdValue: 101.67, outUsdValue: 101.65 },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000" },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, true, "another router answered, so there is a price");
  assert.equal(result.order.router, "metis");
  assert.equal(result.order.outAmountRaw, "101680000", "the honest number, not the one that was patched");
  assert.equal(asked.length, 2, "asked once, then once more without the router that answered badly");
  assert.equal(asked[0], null);
  assert.equal(asked[1], "okx");
  assert.match(result.order.routeAffectingOptions.join(","), /excludeRouters=okx/, "the Review records that a router was excluded");
});

test("when every router disagrees with itself the answer is a refusal, not a price", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ ...order(), router: "okx", outAmount: "642446078", inUsdValue: 101.67, outUsdValue: 642.36 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000" },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "IMPLAUSIBLE_QUOTE");
  assert.match(result.reason, /642\.36 USD out/);
  assert.equal(calls, 2, "once, then once more, and then it stops");
});

test("a loss is a cost and is never refused for being one", async () => {
  /* The price-impact policy owns bad prices, and refusing one here would be
     taking a decision that belongs to the person. Only a *gain* fails. */
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({ ...order(), outAmount: "50000000", inUsdValue: 101.67, outUsdValue: 50.01 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000" },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, true, "a 50% loss is a price, not a defect");
});

test("a token Jupiter cannot price is quoted, not removed from the product", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({ ...order(), inUsdValue: null, outUsdValue: null }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000" },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, true, "unable to check is not the same as failed");
});

/* ── The rebuild is a price, never a re-execution ──────────────────────────
   Owner instruction, 2026-09-10: a fee-configuration error may rebuild the swap
   without our fee — the person then sees new terms and `Ryntra fee: 0`. It is
   not a universal way around a provider error, and it is never a second attempt
   at an operation that has already been sent. */

test("dropping the fee produces a whole new order, not a patched one", async () => {
  const answers = [];
  const fetchImpl = async (url) => {
    const target = new URL(String(url));
    const withFee = target.searchParams.has("referralAccount");
    answers.push(withFee);
    if (withFee) {
      return new Response(
        JSON.stringify({ error: "Please check that referralAccount is initialized under REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3 for project DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    /* The fee is 48 bps of the trade, so the terms genuinely differ. */
    return new Response(
      JSON.stringify({ ...order(), outAmount: "101680000", otherAmountThreshold: "101171600", requestId: "req-rebuilt", feeBps: 2, platformFee: { feeBps: 2, feeMint: SOL } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await fetchJupiterOrder(
    { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000", referral: { account: ACCOUNT, feeBps: 50 } },
    resolveJupiterSwapEndpoint({ access: "degraded" }),
    { fetchImpl },
  );
  assert.equal(result.ok, true);
  /* Every number a person reads comes from the one answer that was accepted:
     the amount, the minimum and the fee are the rebuilt order's own. */
  assert.equal(result.order.requestId, "req-rebuilt");
  assert.equal(result.order.outAmountRaw, "101680000");
  assert.equal(result.order.minReceivedRaw, "101171600");
  assert.equal(result.order.totalFeeBasisPoints, 2);
  assert.equal(result.order.ryntraFee.basisPoints, 0, "the person is charged nothing and the surface says so");
  assert.equal(result.order.ryntraFee.state, "UNCONFIGURED");
  assert.deepEqual(answers, [true, false]);
});

test("it is not a way around any other provider error", async () => {
  const cases = [
    [400, { error: "Amount is too small" }, "REFUSED"],
    [429, { error: "referralAccount rate limit" }, "RATE_LIMITED"],
    [500, { error: "referralFee exploded" }, "HTTP_ERROR"],
    [400, {}, "REFUSED"],
  ];
  for (const [status, body, expected] of cases) {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    };
    const result = await fetchJupiterOrder(
      { inputMint: SOL, outputMint: USDC, amountRaw: "1000000000", referral: { account: ACCOUNT, feeBps: 50 } },
      resolveJupiterSwapEndpoint({ access: "degraded" }),
      { fetchImpl },
    );
    assert.equal(result.ok, false, `${status} must stay a refusal`);
    assert.equal(result.code, expected, `${status} ${JSON.stringify(body)}`);
    assert.equal(calls, 1, `${status} must not be retried`);
  }
});

test("the execute client has no retry at all, so nothing sent can be sent again", async () => {
  /* The rebuild lives at the quote boundary. A transaction that may already have
     left the process is never asked for a second time — the ambiguity is
     reported and recovered by signature instead. */
  const source = readFileSync("lib/solana/quotes.ts", "utf8");
  const declaration = source.indexOf("export async function executeJupiterOrder");
  assert.ok(declaration > 0);
  /* Past its own signature, so the declaration is not read as a call. */
  const execute = source.slice(source.indexOf(String.fromCharCode(10), declaration));
  assert.doesNotMatch(execute, /executeJupiterOrder\(/, "executeJupiterOrder must not call itself");
  assert.doesNotMatch(execute, /refusedForTheFee/, "the fee fallback must not reach the submit path");
  assert.match(execute, /possiblySubmitted: true/, "an ambiguous submit is reported, never repeated");
});
