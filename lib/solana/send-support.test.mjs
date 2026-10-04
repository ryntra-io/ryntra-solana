import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPassport } from "./passport.ts";
import { buildTransferPreflight } from "./preflight.ts";
import { decodeRawMintAccount } from "./mint.ts";
import { SPL_TRANSFER_ACTION_REF } from "../agent-control/adapters/solana-token-2022.ts";
import {
  classifySendSupport,
  SEND_SUPPORT_DECISIONS,
  sendSupportInputFromFacts,
} from "./send-support.ts";

/**
 * Whether this exact transfer is one the product can build, explain and
 * reconcile — decided from fresh chain facts, never from a mint's reputation.
 *
 * "Any token" is a promise about *selection*, not about execution. A person may
 * pick anything their wallet holds; whether it can move is a separate question
 * with four honest answers. The two that matter most are the ones this product
 * used not to have: `BLOCKED`, which refuses without opening a wallet, and
 * `UNKNOWN`, which refuses because the extension has no written semantics here
 * rather than pretending the absence of a rule is a passing rule.
 */

function input(overrides = {}) {
  return {
    actionKind: "SPL_TRANSFER_CHECKED",
    tokenProgram: "SPL_TOKEN",
    unsupportedKinds: [],
    freezeAuthority: null,
    permanentDelegate: null,
    sourceStates: ["INITIALIZED"],
    destination: { createsAccount: false, state: "INITIALIZED" },
    transferHook: null,
    transferFeeBasisPoints: null,
    paused: false,
    nonTransferable: false,
    defaultAccountStateFrozen: false,
    confidentialTransfer: null,
    memoTransferRequired: false,
    informationalExtensions: [],
    ...overrides,
  };
}

const decisionOf = (overrides) => classifySendSupport(input(overrides)).decision;
const codes = (overrides) =>
  classifySendSupport(input(overrides)).findings.map((finding) => finding.code);

test("the four decisions are exactly these, in this order of severity", () => {
  assert.deepEqual([...SEND_SUPPORT_DECISIONS], [
    "SUPPORTED",
    "REVIEW_REQUIRED",
    "BLOCKED",
    "UNKNOWN",
  ]);
});

test("native SOL and plain classic SPL are supported", () => {
  assert.equal(decisionOf({ actionKind: "NATIVE_SOL", tokenProgram: "SYSTEM" }), "SUPPORTED");
  assert.equal(decisionOf({}), "SUPPORTED");
});

test("a transfer-fee mint is supported, because the fee is computed and shown", () => {
  assert.equal(
    decisionOf({ tokenProgram: "TOKEN_2022", actionKind: "TOKEN_2022", transferFeeBasisPoints: 50 }),
    "SUPPORTED",
  );
});

test("a permanent delegate is a review, never a silent pass", () => {
  const verdict = classifySendSupport(
    input({
      tokenProgram: "TOKEN_2022",
      actionKind: "TOKEN_2022",
      permanentDelegate: "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM",
    }),
  );
  assert.equal(verdict.decision, "REVIEW_REQUIRED");
  const delegate = verdict.findings.find((finding) => finding.code === "PERMANENT_DELEGATE");
  assert.equal(delegate.outcome, "REVIEW");
  assert.match(delegate.detail, /move|take|any/i);
});

test("a freeze authority is disclosed as a review, and a frozen account is a block", () => {
  assert.equal(
    decisionOf({ freezeAuthority: "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM" }),
    "REVIEW_REQUIRED",
  );
  assert.equal(decisionOf({ sourceStates: ["FROZEN"] }), "BLOCKED");
  assert.equal(decisionOf({ destination: { createsAccount: false, state: "FROZEN" } }), "BLOCKED");
});

test("default-frozen mints separate a new account from an existing thawed one", () => {
  /* Creating an account under a default-frozen mint produces an account that
     cannot receive; sending into one somebody already thawed is fine, and
     saying so is a warning rather than a refusal. */
  assert.equal(
    decisionOf({
      tokenProgram: "TOKEN_2022",
      actionKind: "TOKEN_ATA_CREATE",
      defaultAccountStateFrozen: true,
      destination: { createsAccount: true, state: null },
    }),
    "BLOCKED",
  );
  assert.equal(
    decisionOf({
      tokenProgram: "TOKEN_2022",
      actionKind: "TOKEN_2022",
      defaultAccountStateFrozen: true,
      destination: { createsAccount: false, state: "INITIALIZED" },
    }),
    "REVIEW_REQUIRED",
  );
});

test("a paused mint and a non-transferable mint never reach the wallet", () => {
  assert.equal(decisionOf({ tokenProgram: "TOKEN_2022", paused: true }), "BLOCKED");
  assert.equal(decisionOf({ tokenProgram: "TOKEN_2022", nonTransferable: true }), "BLOCKED");
});

test("a transfer hook blocks while unresolved and reviews once its accounts are pinned", () => {
  const hook = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
  assert.equal(
    decisionOf({
      tokenProgram: "TOKEN_2022",
      actionKind: "TOKEN_2022",
      transferHook: { programId: hook, extraAccountsResolved: false },
    }),
    "BLOCKED",
  );
  assert.equal(
    decisionOf({
      tokenProgram: "TOKEN_2022",
      actionKind: "TOKEN_2022",
      transferHook: { programId: hook, extraAccountsResolved: true },
    }),
    "REVIEW_REQUIRED",
  );
});

test("confidential transfer requiring proof state is blocked", () => {
  assert.equal(
    decisionOf({
      tokenProgram: "TOKEN_2022",
      confidentialTransfer: { configured: true, proofRequired: true },
    }),
    "BLOCKED",
  );
  /* Configured but not requiring a proof for a transparent transfer is a
     disclosure, not a refusal. */
  assert.equal(
    decisionOf({
      tokenProgram: "TOKEN_2022",
      confidentialTransfer: { configured: true, proofRequired: false },
    }),
    "REVIEW_REQUIRED",
  );
});

test("an extension with no written semantics is UNKNOWN, never a pass", () => {
  const verdict = classifySendSupport(
    input({ tokenProgram: "TOKEN_2022", unsupportedKinds: ["SomeFutureExtension"] }),
  );
  assert.equal(verdict.decision, "UNKNOWN");
  const finding = verdict.findings.find((entry) => entry.code === "UNKNOWN_EXTENSION");
  assert.match(finding.detail, /SomeFutureExtension/);
});

test("a required memo is carried, and an unreadable requirement blocks", () => {
  assert.equal(
    decisionOf({ tokenProgram: "TOKEN_2022", memoTransferRequired: true }),
    "REVIEW_REQUIRED",
  );
  assert.equal(
    decisionOf({ tokenProgram: "TOKEN_2022", memoTransferRequired: "UNREADABLE" }),
    "BLOCKED",
  );
});

test("precedence is BLOCK over UNKNOWN over REVIEW over PASS", () => {
  /* All four present at once. A block must not be softened by an unknown, and
     an unknown must not be softened by a review that happens to sort later. */
  assert.equal(
    decisionOf({
      tokenProgram: "TOKEN_2022",
      nonTransferable: true,
      unsupportedKinds: ["Future"],
      permanentDelegate: "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM",
    }),
    "BLOCKED",
  );
  assert.equal(
    decisionOf({
      tokenProgram: "TOKEN_2022",
      unsupportedKinds: ["Future"],
      permanentDelegate: "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM",
    }),
    "UNKNOWN",
  );
});

test("informational extensions are recorded and never invent a warning", () => {
  const verdict = classifySendSupport(
    input({
      tokenProgram: "TOKEN_2022",
      informationalExtensions: ["ImmutableOwner", "MetadataPointer", "CpiGuard"],
    }),
  );
  assert.equal(verdict.decision, "SUPPORTED");
  assert.ok(verdict.findings.every((finding) => finding.outcome === "PASS"));
});

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function factsFor(name, overrides = {}) {
  const raw = fixture(name);
  const read = decodeRawMintAccount(raw);
  assert.equal(read.ok, true);
  const passport = buildPassport(raw);
  assert.equal(passport.ok, true);
  const preflight = buildTransferPreflight({
    read,
    passport: passport.passport,
    input: {
      schemaVersion: "1.0.0",
      actionRef: SPL_TRANSFER_ACTION_REF,
      network: raw.network,
      mint: raw.mint,
      sender: "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM",
      recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      amountRaw: "1000000",
    },
    epoch: 250n,
  });
  assert.equal(preflight.ok, true);
  return sendSupportInputFromFacts({
    actionKind: "SPL_TRANSFER_CHECKED",
    passport: passport.passport,
    preflight: preflight.preflight,
    sourceStates: ["INITIALIZED"],
    destination: { createsAccount: false, state: "INITIALIZED" },
    transferHookExtraAccountsResolved: false,
    memoTransferRequired: false,
    ...overrides,
  });
}

test("real USDC is sendable and still discloses that Circle can freeze the account", () => {
  const facts = factsFor("usdc-spl");
  const verdict = classifySendSupport(facts);

  /* Not `SUPPORTED`, and that is the honest answer rather than a hurdle: USDC
     carries a freeze authority, so the issuer can freeze the recipient's
     account after this transfer settles. The transfer proceeds — nothing is
     blocked — and the person is told who holds that power before they sign. */
  assert.equal(verdict.decision, "REVIEW_REQUIRED");
  assert.equal(verdict.findings.some((entry) => entry.outcome === "BLOCK"), false);
  assert.equal(verdict.findings.some((entry) => entry.outcome === "UNKNOWN"), false);
  const freeze = verdict.findings.find((entry) => entry.code === "FREEZE_AUTHORITY");
  assert.equal(freeze.detail.includes(facts.freezeAuthority), true);
});

test("a real Token-2022 mint's own facts drive the decision, not a guess about it", () => {
  const facts = factsFor("pyusd-t22");
  assert.equal(facts.tokenProgram, "TOKEN_2022");
  const verdict = classifySendSupport(facts);
  /* Whatever PYUSD's authorities are, they are read from the fixture rather
     than assumed; the assertion is that the classifier used them at all. */
  assert.ok(SEND_SUPPORT_DECISIONS.includes(verdict.decision));
  if (facts.freezeAuthority !== null) {
    assert.equal(verdict.decision, "REVIEW_REQUIRED");
  }
});

test("native SOL has no mint facts and says so rather than inventing empty ones", () => {
  const facts = sendSupportInputFromFacts({
    actionKind: "NATIVE_SOL",
    passport: null,
    preflight: null,
    sourceStates: [],
    destination: { createsAccount: true, state: null },
    transferHookExtraAccountsResolved: false,
    memoTransferRequired: false,
  });
  assert.equal(facts.tokenProgram, "SYSTEM");
  assert.deepEqual([...facts.unsupportedKinds], []);
  assert.equal(facts.freezeAuthority, null);
  assert.equal(classifySendSupport(facts).decision, "SUPPORTED");
});

test("every finding carries a stable code and a sentence a person can read", () => {
  const verdict = classifySendSupport(input({}));
  assert.ok(verdict.findings.length > 0);
  for (const finding of verdict.findings) {
    assert.match(finding.code, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(["PASS", "REVIEW", "BLOCK", "UNKNOWN"].includes(finding.outcome));
    assert.ok(finding.detail.length > 10, `${finding.code} needs a real explanation`);
  }
  assert.equal(new Set(codes({})).size, codes({}).length, "codes must not repeat");
});
