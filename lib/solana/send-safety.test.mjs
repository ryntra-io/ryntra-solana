import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assessSendReadiness } from "./send-readiness.ts";
import {
  canSubmitSendAction,
  evaluateSendSafety,
  resolveSendState,
} from "./send-safety.ts";

/**
 * The gate between a reviewed transaction and a wallet prompt, owned by the
 * server.
 *
 * It used to be two separate things that both had to be true and neither of
 * which was about this transfer: an action-kind allowlist admitting exactly
 * `TOKEN_ATA_CREATE` on mainnet, and an owner-canary envelope allowlisting one
 * recipient and one amount. Both were correct for the single canary they were
 * written for and refuse every ordinary transfer, which is what a manual test
 * saw on the production Send screen.
 *
 * What replaces them is not a wider allowlist. It is a decision derived from
 * what this exact transfer was proven to be.
 */

const base = {
  plan: { baseFeeLamports: "5000" },
  preflight: { simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "450" } },
  support: { decision: "SUPPORTED", findings: [] },
  reviewProof: { status: "SIGNED" },
  requireReviewProof: true,
};

const safetyInput = (overrides = {}) => ({
  network: "mainnet",
  state: "OPEN",
  support: { decision: "SUPPORTED", findings: [] },
  simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "450" },
  baseFeeLamports: "5000",
  ataRentLamports: null,
  createsRecipientAccount: false,
  programs: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
  reviewProof: { status: "SIGNED" },
  requireReviewProof: true,
  /* What this deployment can do with a signed transfer. Both are facts about
     the deployment rather than the transfer, and both used to be discovered by
     the submit route after a wallet had already been opened. */
  settlementStore: "DURABLE_MULTI_WRITER",
  independentReadback: true,
  ...overrides,
});

/**
 * A deployment that cannot finish the transfer never opens a wallet for it.
 *
 * Neither of these is a property of the transaction, so neither can be fixed
 * by trying again — and both used to be found only by `../settle`, one 503
 * after a person had approved real bytes in their own wallet.
 */
test("a deployment that cannot record a submit or read it back never reaches a wallet", () => {
  const noStore = evaluateSendSafety(safetyInput({ settlementStore: "NOT_DURABLE" }));
  assert.equal(noStore.decision, "UNKNOWN");
  assert.equal(canSubmitSendAction({ network: "mainnet", safety: noStore }), false);
  assert.equal(
    noStore.findings.find((finding) => finding.code === "SETTLEMENT_STORE")?.outcome,
    "UNKNOWN",
  );

  const oneOperator = evaluateSendSafety(safetyInput({ independentReadback: false }));
  assert.equal(oneOperator.decision, "UNKNOWN");
  assert.equal(canSubmitSendAction({ network: "mainnet", safety: oneOperator }), false);
  assert.equal(
    oneOperator.findings.find((finding) => finding.code === "INDEPENDENT_READBACK")?.outcome,
    "UNKNOWN",
  );

  const capable = evaluateSendSafety(safetyInput());
  assert.equal(capable.decision, "ALLOW");
  for (const code of ["SETTLEMENT_STORE", "INDEPENDENT_READBACK"]) {
    assert.equal(capable.findings.find((finding) => finding.code === code)?.outcome, "PASS");
  }
});

test("a supported, simulated, priced and proofed transfer is allowed", () => {
  const verdict = evaluateSendSafety(safetyInput());
  assert.equal(verdict.decision, "ALLOW");
  assert.ok(verdict.findings.every((finding) => finding.outcome === "PASS"));
});

test("the submit gate follows the safety decision, not the action kind", () => {
  assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision: "ALLOW" } }), true);
  /* A named risk a person can weigh still reaches the wallet — that is what
     REVIEW means. The wallet confirmation is the authorization. */
  assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision: "REVIEW" } }), true);
  assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision: "BLOCK" } }), false);
  assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision: "UNKNOWN" } }), false);
  assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision: "PAUSE" } }), false);
});

test("a blocked or unknown capability never becomes an allowed send", () => {
  assert.equal(evaluateSendSafety(safetyInput({ support: { decision: "BLOCKED", findings: [] } })).decision, "BLOCK");
  assert.equal(evaluateSendSafety(safetyInput({ support: { decision: "UNKNOWN", findings: [] } })).decision, "UNKNOWN");
  assert.equal(
    evaluateSendSafety(safetyInput({ support: { decision: "REVIEW_REQUIRED", findings: [] } })).decision,
    "REVIEW",
  );
});

test("the emergency stop pauses every send and cannot be read as open by accident", () => {
  assert.equal(evaluateSendSafety(safetyInput({ state: "PAUSED" })).decision, "PAUSE");
  /* Missing, blank, misspelled or any other value is PAUSED. A stop that
     opens when its configuration is wrong is not a stop. */
  assert.equal(resolveSendState({}), "PAUSED");
  assert.equal(resolveSendState({ RYNTRA_SOLANA_SEND_STATE: "" }), "PAUSED");
  assert.equal(resolveSendState({ RYNTRA_SOLANA_SEND_STATE: "open " }), "OPEN");
  assert.equal(resolveSendState({ RYNTRA_SOLANA_SEND_STATE: "yes" }), "PAUSED");
  assert.equal(resolveSendState({ RYNTRA_SOLANA_SEND_STATE: "OPEN" }), "OPEN");
});

test("a missing or failed simulation is never signed over", () => {
  assert.equal(
    evaluateSendSafety(safetyInput({ simulation: { status: "SKIPPED", reason: "no endpoint" } })).decision,
    "UNKNOWN",
  );
  assert.equal(
    evaluateSendSafety(
      safetyInput({ simulation: { status: "PRESENT", succeeded: false, error: "0x1", unitsConsumed: null } }),
    ).decision,
    "BLOCK",
  );
});

test("an unpriced fee or an invisible rent cost blocks the prompt", () => {
  assert.equal(evaluateSendSafety(safetyInput({ baseFeeLamports: null })).decision, "UNKNOWN");
  assert.equal(
    evaluateSendSafety(safetyInput({ createsRecipientAccount: true, ataRentLamports: null })).decision,
    "UNKNOWN",
  );
  assert.equal(
    evaluateSendSafety(safetyInput({ createsRecipientAccount: true, ataRentLamports: "2039280" })).decision,
    "ALLOW",
  );
});

test("an unknown program in the reviewed message is refused", () => {
  const verdict = evaluateSendSafety(safetyInput({ programs: ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"] }));
  assert.equal(verdict.decision, "BLOCK");
  assert.ok(verdict.findings.some((finding) => finding.code === "PROGRAMS_SUPPORTED"));
});

test("an unsigned Review proof cannot reach a wallet where one is required", () => {
  assert.equal(
    evaluateSendSafety(safetyInput({ reviewProof: { status: "UNSIGNED" } })).decision,
    "BLOCK",
  );
  assert.equal(
    evaluateSendSafety(safetyInput({ reviewProof: { status: "UNSIGNED" }, requireReviewProof: false })).decision,
    "ALLOW",
  );
});

test("readiness admits a reviewed risk and refuses an unproven one", () => {
  assert.equal(assessSendReadiness({ ...base }).ready, true);
  assert.equal(
    assessSendReadiness({ ...base, support: { decision: "REVIEW_REQUIRED", findings: [] } }).ready,
    true,
  );
  const unknown = assessSendReadiness({ ...base, support: { decision: "UNKNOWN", findings: [] } });
  assert.equal(unknown.ready, false);
  assert.equal(unknown.code, "SUPPORT_NOT_ESTABLISHED");
  const blocked = assessSendReadiness({ ...base, support: { decision: "BLOCKED", findings: [] } });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.code, "SUPPORT_BLOCKED");
});

test("no Send path judges readiness by the owner canary", () => {
  /* The regression for the last gate to fall, and the most expensive one to
     find: the wallet signed, the returned bytes checked clean, and adoption
     then refused with "Owner-canary policy returned BLOCK" — a policy about a
     different transaction, consulted after a person had already approved this
     one. The canary verdict still travels as M1B evidence; it decides nothing
     about an ordinary transfer. */
  for (const path of [
    "../../app/api/solana/transfer/adopt/route.ts",
    "./settlement.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    for (const call of source.matchAll(/assessSendReadiness\(\{[\s\S]*?\}\)/g)) {
      assert.ok(
        !/canaryVerdict:/.test(call[0]),
        `${path} still gates readiness on the owner canary:\n${call[0]}`,
      );
      assert.match(call[0], /support:/, `${path} must judge readiness by proven capability`);
    }
  }
});

test("the plan route refuses a client-posted policy and builds its own safety", () => {
  const source = readFileSync(new URL("../../app/api/solana/transfer/plan/route.ts", import.meta.url), "utf8");
  assert.match(source, /evaluateSendSafety/, "the route must build its own safety verdict");
  assert.ok(
    !/policy:\s*SolanaOwnerPolicySchema/.test(source),
    "the route must not accept a policy object from the client",
  );
});
