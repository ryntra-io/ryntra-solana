import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* The swap steps import the app's modules by their `@/` alias; resolve it the way the routes' tests do. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = pathResolve(specifier.slice(2));
      for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts"]) if (existsSync(base + ext)) return nextResolve(pathToFileURL(base + ext).href, context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && context.parentURL) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const ext of [".ts", ".tsx", ".js", "/index.ts"]) if (existsSync(base + ext)) return nextResolve(pathToFileURL(base + ext).href, context);
      }
      /* Next's bundler resolves `next/headers` without an extension; Node's resolver needs `next/headers.js`. */
      if (!specifier.startsWith(".") && !specifier.startsWith("node:") && specifier.includes("/") && !/\.[cm]?js$/.test(specifier)) {
        return nextResolve(`${specifier}.js`, context);
      }
      throw error;
    }
  },
});

import assert from "node:assert/strict";
import { test } from "node:test";

const { INTENT_STAGES, NEXT, definePipeline, need, runPipeline, pipelineStages } = await import("./pipeline.ts");
const {
  CAPABILITY_REGISTRY,
  capabilityFeeBps,
  capabilityKey,
  findCapability,
  openVenues,
  resolveCapabilityState,
  resolveFeeIdentity,
  validateCapabilityRegistry,
} = await import("./capabilities.ts");
const { NETWORK_IDS, VENUE_IDS, CAPABILITY_IDS } = await import("./contracts.ts");
const { settlementOf, createSolanaNetwork } = await import("./networks/solana.ts");
const { quoteFromJupiterOrder, createJupiterSwapVenue } = await import("./venues/jupiter.ts");
const { SOLANA_SWAP_PREPARE } = await import("./solana-swap/prepare.ts");
const { SOLANA_SWAP_SETTLE } = await import("./solana-swap/settle.ts");
const { SOLANA_SWAP_REVIEW_GUARD, SOLANA_SWAP_SIGNED_GUARD, ownerLockFreeStep } = await import("./solana-swap/guard.ts");
const { RYNTRA_SERVICE_FEE_POLICY } = await import("../swap/service-fee.ts");
const { FEE_FLOWS, FEE_POLICY_V2 } = await import("./fee-policy.ts");
const { SOLANA_LANE_STATE_ENV } = await import("../solana/lane-state.ts");

const step = (stage, name, run = () => NEXT) => ({ stage, name, run });

/* ------------------------------------------------------------------ pipeline */

test("the stages are the intent's, in order, with the guard before the signature", () => {
  assert.deepEqual(INTENT_STAGES, ["quote", "build", "guard", "sign", "submit", "settle", "receipt", "fee", "rewards"]);
});

test("a line that builds bytes cannot be defined without a guard after the build", () => {
  assert.throws(
    () => definePipeline({ line: "x", part: "prepare", steps: [step("quote", "q"), step("build", "b")] }),
    /nothing guards its bytes before the wallet/,
  );
  /* A guard before the venue alone is not enough: the bytes are what it must see. */
  assert.throws(
    () => definePipeline({ line: "x", part: "prepare", steps: [step("guard", "lock"), step("build", "b")] }),
    /nothing guards its bytes before the wallet/,
  );
  /* A venue that answers with the bytes inside its price is guarded the same way. */
  assert.throws(
    () => definePipeline({ line: "x", part: "prepare", steps: [step("guard", "lock"), step("quote", "q")] }),
    /nothing guards its bytes before the wallet/,
  );
  assert.doesNotThrow(() => definePipeline({ line: "x", part: "prepare", steps: [step("guard", "lock"), step("build", "b"), step("guard", "check")] }));
});

test("a settle run sends exactly once", () => {
  assert.throws(() => definePipeline({ line: "x", part: "settle", steps: [step("guard", "g"), step("receipt", "r")] }), /exactly once; found 0/);
  assert.throws(
    () => definePipeline({ line: "x", part: "settle", steps: [step("guard", "g"), step("submit", "a"), step("submit", "b")] }),
    /exactly once; found 2/,
  );
});

test("a step that reads what an earlier step did not leave fails loudly, naming it", () => {
  assert.equal(need("x", "order"), "x");
  assert.throws(() => need(null, "order"), /before its order was ready/);
  assert.throws(() => need(undefined, "signature"), /before its signature was ready/);
});

test("signed bytes cannot be submitted unguarded, and nothing settles before the send", () => {
  assert.throws(() => definePipeline({ line: "x", part: "settle", steps: [step("submit", "send")] }), /nothing guards them first/);
  assert.throws(
    () => definePipeline({ line: "x", part: "settle", steps: [step("guard", "g"), step("submit", "send"), step("guard", "late")] }),
    /a guard runs after the bytes were submitted/,
  );
  assert.throws(
    () => definePipeline({ line: "x", part: "settle", steps: [step("guard", "g"), step("receipt", "r"), step("submit", "send")] }),
    /a receipt step runs before the submit/,
  );
});

test("the signature is never a server step, and each half keeps to its side of it", () => {
  assert.throws(() => definePipeline({ line: "x", part: "prepare", steps: [step("sign", "s")] }), /never a server step/);
  assert.throws(() => definePipeline({ line: "x", part: "prepare", steps: [step("guard", "g"), step("submit", "send")] }), /belongs after the signature/);
  assert.throws(() => definePipeline({ line: "x", part: "settle", steps: [step("quote", "q")] }), /belongs before the signature/);
  assert.throws(() => definePipeline({ line: "x", part: "prepare", steps: [step("build", "b"), step("quote", "q"), step("guard", "g")] }), /quote step runs after the bytes were built/);
  assert.throws(() => definePipeline({ line: "x", part: "prepare", steps: [step("guard", "g"), step("guard", "g")] }), /defined twice/);
});

test("a run stops at the first step that stops, with that step's answer, and never runs the rest", async () => {
  const ran = [];
  const pipeline = definePipeline({
    line: "x",
    part: "prepare",
    steps: [
      step("quote", "a", () => { ran.push("a"); return NEXT; }),
      step("build", "b", async () => { ran.push("b"); return NEXT; }),
      step("guard", "c", () => { ran.push("c"); return { stop: { code: "REFUSED" } }; }),
      step("guard", "d", () => { ran.push("d"); return NEXT; }),
    ],
  });
  const run = await runPipeline(pipeline, {});
  assert.equal(run.completed, false);
  assert.deepEqual(run.stop, { code: "REFUSED" });
  assert.equal(run.stoppedAt, "c");
  assert.deepEqual(run.trace, ["a", "b", "c"]);
  assert.deepEqual(ran, ["a", "b", "c"]);
});

/* ------------------------------------------------------------------ the swap's pipeline */

test("the swap's prepare half is the venue between the owner lock and the shared safety chain", () => {
  assert.equal(SOLANA_SWAP_PREPARE.line, "solana-swap");
  assert.deepEqual(
    SOLANA_SWAP_PREPARE.steps.map((s) => `${s.stage}:${s.name}`),
    [
      "quote:intent-terms",
      "guard:owner-lock-free",
      "quote:venue-endpoint",
      "quote:asset-passports",
      "build:venue-order",
      "guard:transaction-check",
      "guard:effect-firewall",
      "guard:review-policy",
      "guard:plan-review",
      "guard:review-proof",
      "guard:owner-lock-reserve",
    ],
  );
  /* The safety chain is the shared one, by identity — not a copy with the same names. */
  for (const shared of [ownerLockFreeStep, ...SOLANA_SWAP_REVIEW_GUARD]) {
    assert.ok(SOLANA_SWAP_PREPARE.steps.includes(shared), `${shared.name} is not the shared step`);
  }
});

test("the swap's settle half is the shared chain over the signed bytes, one send, then the outcome", () => {
  assert.deepEqual(pipelineStages(SOLANA_SWAP_SETTLE), [
    "guard", "guard", "guard", "guard", "guard", "guard", "guard",
    "submit", "settle", "settle", "receipt", "receipt", "fee", "rewards", "receipt",
  ]);
  assert.deepEqual(
    SOLANA_SWAP_SETTLE.steps.slice(0, SOLANA_SWAP_SIGNED_GUARD.length).map((s) => s.name),
    SOLANA_SWAP_SIGNED_GUARD.map((s) => s.name),
  );
  assert.equal(SOLANA_SWAP_SETTLE.steps.filter((s) => s.stage === "submit").length, 1, "a signed transaction is sent once");
});

test("no swap route carries its own copy of the safety chain", () => {
  /* The routes admit a request and render the answer; the chain runs in the pipeline. */
  for (const path of ["app/api/solana/swap/order/route.ts", "app/api/solana/swap/execute/route.ts"]) {
    const source = readFileSync(path, "utf8");
    for (const guard of [
      "inspectJupiterSwapTransaction",
      "assessSwapSimulationEffects",
      "evaluateSwapPolicy",
      "createSwapExecutionProof",
      "verifySwapExecutionProof",
      "reserveSwapOwnerReview",
      "claimSwapOwnerSignature",
      "withSendAttemptBoundary",
    ]) {
      assert.ok(!source.includes(guard), `${path} calls ${guard} itself`);
    }
  }
});

/* ------------------------------------------------------------------ capability registry v2 */

test("the registry is valid, one row per network × venue × capability", () => {
  assert.deepEqual(validateCapabilityRegistry(), []);
  const keys = CAPABILITY_REGISTRY.map(capabilityKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const row of CAPABILITY_REGISTRY) {
    assert.ok(NETWORK_IDS.includes(row.network));
    assert.ok(VENUE_IDS.includes(row.venue));
    assert.ok(CAPABILITY_IDS.includes(row.capability));
  }
});

test("the registry refuses the rows it was written to refuse", () => {
  const live = findCapability("solana", "jupiter", "swap");
  const problems = (row) => validateCapabilityRegistry([row]);
  assert.match(problems({ ...live, fee: { kind: "NOT_SET" } }).join(), /A live row needs its fee/);
  assert.match(problems({ ...live, state: "PLANNED", pipeline: null }).join(), /Only a live row charges a fee/);
  assert.match(problems({ ...live, lane: null }).join(), /operator stop/);
  assert.match(problems({ ...live, attribution: null }).join(), /configured identity/);
  assert.match(problems({ ...findCapability("solana", "phoenix", "perps"), pipeline: "solana-swap" }).join(), /Only a live row runs through a pipeline/);
  assert.match(validateCapabilityRegistry([live, live]).join(), /registered twice/);
});

test("what is live today is the Jupiter swap on the pipeline and the Relay bridge on its own routes; the rest is planned", () => {
  const live = CAPABILITY_REGISTRY.filter((row) => row.state === "LIVE").map(capabilityKey);
  assert.deepEqual(live, ["solana:jupiter:swap", "solana:relay:bridge"]);
  assert.equal(findCapability("solana", "jupiter", "swap").pipeline, "solana-swap");
  assert.equal(findCapability("solana", "relay", "bridge").pipeline, null);
  for (const row of CAPABILITY_REGISTRY.filter((r) => r.state !== "LIVE")) {
    assert.equal(row.fee.kind, "NOT_SET", `${capabilityKey(row)} has a rate before it opens`);
    assert.equal(capabilityFeeBps(row), null);
  }
});

test("a live rate is the fee policy's own number, never a copy — on the Jupiter swap, the flow's", () => {
  const swap = findCapability("solana", "jupiter", "swap");
  assert.deepEqual(swap.fee, { kind: "POLICY", policy: "fee-policy-v2", mechanisms: ["JUPITER_PLATFORM_FEE", "JUPITER_REFERRAL"] });
  assert.equal(capabilityFeeBps(swap), RYNTRA_SERVICE_FEE_POLICY.JUPITER_REFERRAL, "a flow the table does not name pays as before");
  for (const flow of FEE_FLOWS) assert.equal(capabilityFeeBps(swap, flow), FEE_POLICY_V2[flow].bps);
  assert.equal(capabilityFeeBps(findCapability("solana", "relay", "bridge")), RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE);
});

test("a live row behind its closed operator stop reads paused, and is not offered", () => {
  const swap = findCapability("solana", "jupiter", "swap");
  const open = { [SOLANA_LANE_STATE_ENV.SWAP]: "OPEN" };
  assert.equal(resolveCapabilityState(swap, open), "LIVE");
  assert.equal(resolveCapabilityState(swap, {}), "PAUSED");
  assert.deepEqual(openVenues("solana", "swap", open).map(capabilityKey), ["solana:jupiter:swap"]);
  assert.deepEqual(openVenues("solana", "swap", {}), []);
  assert.equal(resolveCapabilityState(findCapability("solana", "phoenix", "perps"), open), "PLANNED");
});

test("the fee identity of a product is the configured address, or an honest null", () => {
  const swap = findCapability("solana", "jupiter", "swap");
  const config = { jupiterReferralAccount: "Ref1111111111111111111111111111111111111111", relayAppFeeRecipient: null, mayanReferrerSolana: null };
  /* The swap's fee wallet is a row of the public attribution registry; the referral account stays the identity of its /order lane. */
  assert.deepEqual(resolveFeeIdentity(swap, "stocks", config), { product: "stocks", kind: "FEE_WALLET", address: "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne" });
  assert.equal(resolveFeeIdentity(swap, "perps", config), null);
  assert.deepEqual(resolveFeeIdentity(findCapability("solana", "relay", "bridge"), "bridge", config), { product: "bridge", kind: "RELAY_APP_FEE_RECIPIENT", address: null });
});

/* ------------------------------------------------------------------ adapters */

test("a status read settles at the level the chain shows, and a silent operator is not a landing", () => {
  const read = (status) => ({ state: "READ", status: { confirmationStatus: null, err: null, seen: true, slot: "1", ...status } });
  assert.deepEqual(settlementOf("s", read({ confirmationStatus: "finalized" })), { state: "SETTLED", signature: "s", finality: "finalized" });
  assert.deepEqual(settlementOf("s", read({ confirmationStatus: "processed" })), { state: "SETTLED", signature: "s", finality: "confirmed" });
  assert.deepEqual(settlementOf("s", read({ confirmationStatus: "finalized", err: "InstructionError" })), { state: "LANDED_FAILED", signature: "s", reason: "InstructionError", finality: "finalized" });
  assert.deepEqual(settlementOf("s", read({ seen: false })), { state: "NOT_SEEN", signature: "s" });
  assert.deepEqual(settlementOf("s", { state: "UNKNOWN", status: { seen: false }, reason: "timeout" }), { state: "NOT_SEEN", signature: "s" });
});

test("the network sends once and says when it does not know", async (t) => {
  const handle = { endpoints: [{ url: "https://rpc.example.test" }], timeoutMs: 1000 };
  const network = createSolanaNetwork({ submitHandle: handle, readHandle: handle });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    throw new Error("socket hang up");
  });
  const submission = await network.submit({ network: "solana", wireBase64: "AQID", signature: "sig" }, "fast");
  assert.equal(calls, 1);
  assert.deepEqual(submission, { state: "UNKNOWN", signature: "sig", lane: "OWN_RPC", reason: "socket hang up" });
});

test("a Jupiter order is a quote of the core: price, minimum, the Ryntra fee and the review window", async () => {
  const intent = {
    network: "solana",
    inputAsset: "So11111111111111111111111111111111111111112",
    outputAsset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amountRaw: "1000000",
    account: { kind: "WALLET", network: "solana", address: "Taker111111111111111111111111111111111111111" },
  };
  const order = {
    inAmountRaw: "1000000",
    outAmountRaw: "150000",
    minReceivedRaw: "149000",
    priceImpactPct: "0.01",
    ryntraFee: { basisPoints: 50 },
    requestId: "req-1",
    reviewExpiresAt: "2026-10-04T12:00:45.000Z",
    taker: intent.account.address,
    transactionBase64: "AQID",
    lastValidBlockHeight: "100",
  };
  const quote = quoteFromJupiterOrder(intent, order);
  assert.deepEqual(
    { ...quote, native: undefined },
    {
      venue: "jupiter",
      intent,
      inputRaw: "1000000",
      quotedOutputRaw: "150000",
      minimumOutputRaw: "149000",
      priceImpactPct: "0.01",
      ryntraFeeBps: 50,
      requestId: "req-1",
      reviewExpiresAt: "2026-10-04T12:00:45.000Z",
      native: undefined,
    },
  );
  const venue = createJupiterSwapVenue({ endpoint: {}, referral: null, config: { jupiterReferralAccount: null, relayAppFeeRecipient: null, mayanReferrerSolana: null } });
  assert.deepEqual(await venue.build(quote, intent.account), { network: "solana", wireBase64: "AQID", validUntil: "100" });
  await assert.rejects(venue.build(quote, { ...intent.account, address: "Other11111111111111111111111111111111111111" }), /another wallet/);
  assert.deepEqual(venue.identity("memes"), { product: "memes", kind: "FEE_WALLET", address: "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne" });
});
