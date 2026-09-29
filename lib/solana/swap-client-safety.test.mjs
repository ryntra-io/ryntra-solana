import { test } from "node:test";
import assert from "node:assert/strict";

test("a quote cannot be reused after a pair flip, amount edit, or cleared input", async () => {
  const subjectModule = await subject();
  const order = { inputMint: "SOL", outputMint: "USDC", inAmountRaw: "5000000" };
  for (const [inputMint, outputMint, amountRaw, wanted] of [
    ["SOL", "USDC", "5000000", true],
    ["USDC", "SOL", "5000000", false],
    ["SOL", "USDC", "6000000", false],
    ["SOL", "USDC", null, false],
  ]) assert.equal(subjectModule.swapQuoteMatches?.(order, { inputMint, outputMint, amountRaw }), wanted);
});

test("a pre-submit rejection invalidates an otherwise ready review", async () => {
  const subjectModule = await subject();
  assert.equal(subjectModule.assessSwapClientReview(executableReview({ invalidated: true })).ready, false);
});

import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

async function subject() {
  try {
    return await import("./swap-client-safety.ts");
  } catch {
    return {};
  }
}

import { SWAP_POLICY_RULES } from "./swap-policy-rules.ts";

const RULES = [...SWAP_POLICY_RULES];
const TAKER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SIGNATURE = "N3zXBD2bcRWyRh5bVxs2Tr1z6aWKoobLpTkkxRvoSCJCBZv9z5joMjayx4pPSCz5sGt1UyfLkTQthDLEtS8aVwJ";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const BLOCKHASH = "So11111111111111111111111111111111111111112";

function verdict(overrides = {}) {
  const findings = RULES.map((rule) => ({
    rule,
    /* A REVIEW finding is information for the person about to sign — a wider
       slippage, an unpriced leg — and must not stop the wallet. Only a BLOCK
       does, and every BLOCK is structural. */
    outcome: rule === "PRICE_IMPACT_DISCLOSED" ? "REVIEW" : "PASS",
    detail: `${rule} fixture`,
  }));
  return {
    decision: "REVIEW",
    findings,
    ...overrides,
  };
}

function executableReview(overrides = {}) {
  return {
    verdict: verdict(),
    proofStatus: "SIGNED",
    simulationStatus: "OK",
    ownerEffectsStatus: "VERIFIED",
    expiresAt: "2026-08-30T12:00:15.000Z",
    now: new Date("2026-08-30T12:00:00.000Z"),
    ...overrides,
  };
}

test("pre-sign review opens when nothing structural blocks, review findings and all", async () => {
  const subjectModule = await subject();
  const result = subjectModule.assessSwapClientReview?.(executableReview());
  assert.deepEqual(result, {
    ready: true,
    code: "READY_FOR_HUMAN_APPROVAL",
    reason: "The exact reviewed order is ready for the wallet's visible approval.",
  });
});

test("pre-sign review refuses policy, proof, simulation and freshness defects before a wallet", async () => {
  const subjectModule = await subject();
  const blockedRule = verdict({
    findings: verdict().findings.map((finding) =>
      finding.rule === "OWNER_EFFECTS_PROVEN" ? { ...finding, outcome: "BLOCK" } : finding,
    ),
  });
  const incomplete = verdict({ findings: verdict().findings.slice(1) });
  const cases = [
    [executableReview({ verdict: blockedRule }), "POLICY_BLOCKED"],
    [executableReview({ verdict: verdict({ decision: "BLOCK" }) }), "POLICY_BLOCKED"],
    [executableReview({ verdict: incomplete }), "POLICY_BLOCKED"],
    [executableReview({ proofStatus: "UNSIGNED" }), "PROOF_NOT_SIGNED"],
    [executableReview({ simulationStatus: "FAILED" }), "SIMULATION_NOT_CLEAR"],
    [executableReview({ ownerEffectsStatus: "MISSING" }), "EFFECTS_NOT_VERIFIED"],
    [executableReview({ now: new Date("2026-08-30T12:00:16.000Z") }), "ORDER_EXPIRED"],
  ];
  for (const [input, code] of cases) {
    const result = subjectModule.assessSwapClientReview?.(input);
    assert.equal(result?.ready, false, code);
    assert.equal(result?.code, code);
  }
});

test("a window that has not expired is not the same as a window somebody can use", async () => {
  /* `RYN-SOL-M3` recorded the defect this closes: a Review lives about ninety
     seconds, so reading it carefully produced a refusal *after* the wallet
     prompt. The old check was `now >= expiry`, true only once the order was
     already dead — so at one second left the card still opened the wallet, the
     person confirmed, and the venue refused bytes that expired while the prompt
     was on screen. The signature was real and so was the refusal.

     The fixture expires at 12:00:15. Nine seconds left is not enough to raise a
     prompt and read it; eleven is. */
  const subjectModule = await subject();

  const tooShort = subjectModule.assessSwapClientReview?.(
    executableReview({ now: new Date("2026-08-30T12:00:06.000Z") }),
  );
  assert.equal(tooShort?.ready, false, "Nine seconds is offered as signable.");
  assert.equal(tooShort?.code, "ORDER_TOO_SHORT");

  const usable = subjectModule.assessSwapClientReview?.(
    executableReview({ now: new Date("2026-08-30T12:00:04.000Z") }),
  );
  assert.equal(usable?.ready, true, "Eleven seconds is refused, so the floor is too high to sign inside.");

  /* The floor is a stated constant rather than a number buried in a comparison,
     because it is a product decision about how long a person needs. */
  assert.equal(subjectModule.SWAP_MIN_ACTIONABLE_REVIEW_MS, 10_000);
});

function staleIdleQuote(overrides = {}) {
  return {
    hasQuote: true,
    secondsLeft: 0,
    reviewOpen: false,
    attemptOpen: false,
    phase: "IDLE",
    documentVisible: true,
    quoting: false,
    chased: 0,
    ...overrides,
  };
}

test("an expired price is refreshed without being asked, and a live one is left alone", async () => {
  const subjectModule = await subject();
  const decide = subjectModule.shouldAutoRefreshQuote;

  assert.equal(decide(staleIdleQuote()), true, "A dead price is left on screen for somebody to notice.");
  assert.equal(decide(staleIdleQuote({ secondsLeft: 1 })), false, "A live price is replaced underneath the reader.");
  assert.equal(decide(staleIdleQuote({ secondsLeft: null })), false);
  assert.equal(decide(staleIdleQuote({ hasQuote: false })), false, "There is nothing to replace.");
});

test("nothing is refreshed under a person's hands, behind their back, or after a signature", async () => {
  const subjectModule = await subject();
  const decide = subjectModule.shouldAutoRefreshQuote;

  /* The worst of the four: exact bytes are in front of somebody and the card
     swaps them for different ones while they read. */
  assert.equal(decide(staleIdleQuote({ reviewOpen: true })), false);
  /* Once bytes are out, every uncertain result is a recovery state for that
     signature — never permission to fetch new ones. */
  assert.equal(decide(staleIdleQuote({ attemptOpen: true })), false);
  /* A background card spending sixty reads a minute is how a budget built to
     protect the action path gets spent by nobody. */
  assert.equal(decide(staleIdleQuote({ documentVisible: false })), false);
  assert.equal(decide(staleIdleQuote({ quoting: true })), false);
  for (const phase of ["PREPARING", "REVIEW", "SIGNING", "EXECUTING", "RECOVERING", "SETTLED", "RECOVERY"]) {
    assert.equal(decide(staleIdleQuote({ phase })), false, `${phase} is treated as rest.`);
  }
});

test("the chase terminates rather than usually stopping", async () => {
  const subjectModule = await subject();
  const decide = subjectModule.shouldAutoRefreshQuote;
  const limit = subjectModule.SWAP_AUTO_REFRESH_CHASE_LIMIT;
  assert.equal(limit, 3);

  /* The hostile case the bound exists for: a venue answering slower than its
     own window, so every refresh returns something already expired. Simulated
     exactly as the card runs it — decide, then count the attempt — and it must
     stop on its own, not merely become unlikely. */
  let chased = 0;
  let refreshes = 0;
  for (let tick = 0; tick < 1000; tick += 1) {
    if (!decide(staleIdleQuote({ chased }))) break;
    chased += 1;
    refreshes += 1;
  }
  assert.equal(refreshes, limit, "The card kept asking a venue that never answered in time.");
  assert.equal(decide(staleIdleQuote({ chased })), false);

  /* And a venue that does answer in time clears it, so a slow minute cannot
     permanently disable the behaviour. */
  assert.equal(decide(staleIdleQuote({ chased: 0 })), true);
});

test("a REVIEW finding is information for the signer, never a refusal", async () => {
  const subjectModule = await subject();
  for (const rule of ["SLIPPAGE_BOUNDED", "PRICE_IMPACT_DISCLOSED", "VALUE_DISCLOSED", "OUTPUT_ASSET_REVIEWED"]) {
    const reviewed = verdict({
      findings: verdict().findings.map((finding) =>
        finding.rule === rule ? { ...finding, outcome: "REVIEW" } : finding,
      ),
    });
    assert.equal(
      subjectModule.assessSwapClientReview?.(executableReview({ verdict: reviewed }))?.ready,
      true,
      `${rule} at REVIEW must not stop the wallet`,
    );
  }
});

test("once signed, any execute ambiguity locks the client to recovery by the same signature", async () => {
  const subjectModule = await subject();
  const attempt = {
    schema: "ryntra.solana.swap-client-attempt",
    schemaVersion: "1.0.0",
    requestId: "req-1",
    signature: SIGNATURE,
    taker: TAKER,
    state: "SIGNED_NOT_SENT",
    recordedAt: "2026-08-30T12:00:00.000Z",
  };
  assert.equal(
    subjectModule.transitionSwapClientAttempt?.(attempt, { kind: "FAILURE" }).state,
    "SUBMITTED_UNKNOWN",
  );
  assert.equal(
    subjectModule.transitionSwapClientAttempt?.(attempt, { kind: "SUCCESS", serverState: "RECOVERY_PENDING" }).state,
    "SUBMITTED_UNKNOWN",
  );
  assert.equal(
    subjectModule.transitionSwapClientAttempt?.(attempt, { kind: "SUCCESS", serverState: "MATCHED" }).state,
    "SETTLED",
  );
});

test("persisted attempt parsing fails closed and never clears an unknown signed attempt", async () => {
  const subjectModule = await subject();
  const encoded = JSON.stringify({
    schema: "ryntra.solana.swap-client-attempt",
    schemaVersion: "1.0.0",
    requestId: "req-2",
    signature: SIGNATURE,
    taker: TAKER,
    state: "SUBMITTED_UNKNOWN",
    recordedAt: "2026-08-30T12:00:00.000Z",
  });
  assert.equal(subjectModule.parseSwapClientAttempt?.(encoded).state, "SUBMITTED_UNKNOWN");
  assert.equal(subjectModule.parseSwapClientAttempt?.("not-json"), null);
  assert.equal(subjectModule.parseSwapClientAttempt?.(JSON.stringify({ state: "IDLE" })), null);
});

test("the client records the taker's real wire signature before execute", async () => {
  const subjectModule = await subject();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(TAKER, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, value),
    (value) => appendTransactionMessageInstructions(
      [{ programAddress: MEMO_PROGRAM, accounts: [], data: new Uint8Array([1]) }],
      value,
    ),
  );
  const unsigned = compileTransaction(message);
  const wire = getBase64EncodedWireTransaction({
    ...unsigned,
    signatures: { ...unsigned.signatures, [TAKER]: new Uint8Array(64).fill(7) },
  });
  assert.equal(
    subjectModule.readSwapClientSignature?.({ signedWireBase64: wire, expectedTaker: TAKER }),
    "99eUso3aSbE9tqGSTXzo3TLfKb9RkMTURrHKQ1K7Zh3BbeqPevr5E1iCbpTjqHuTFLtfxTTD5ekfVuZFzQyEQf8",
  );
  assert.equal(subjectModule.readSwapClientSignature?.({ signedWireBase64: wire, expectedTaker: "11111111111111111111111111111111" }), null);
});
