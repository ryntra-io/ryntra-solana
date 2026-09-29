import assert from "node:assert/strict";
import test from "node:test";

import { BASE58_PUBKEY, parseSolanaAddress } from "./address.ts";
import { SplTransferInputSchema } from "../agent-control/adapters/solana-token-2022.ts";

/* A real devnet pubkey, 44 characters. */
const VALID = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

test("a real address parses and keeps its exact bytes", () => {
  const parsed = parseSolanaAddress(VALID);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.address, VALID);
});

test("surrounding whitespace is trimmed rather than refused", () => {
  const parsed = parseSolanaAddress(`  ${VALID}\n`);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.address, VALID);
});

test("a pasted value with a label in front is refused, and the reason names why", () => {
  /* `wallet-opuATvsQx…` reached the network and came back as a schema refusal
     that named no field at all. The refusal now names the character. */
  const parsed = parseSolanaAddress("wallet-opuATvsQx9F1stmRoHhs1e7ipzvRB3gtUcDuy6mTFzvI", "recipient address");
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /recipient address/);
  /* The hyphen is the definite failure and must be reported ahead of the
     trailing `I`, which would read as a near miss on a string that was never
     an address. */
  assert.match(parsed.reason, /"-"/);
  assert.doesNotMatch(parsed.reason, /misread/);
});

test("each mistake gets its own sentence, because they send you to different places", () => {
  const confusable = parseSolanaAddress(VALID.slice(0, 43) + "O");
  assert.equal(confusable.ok, false);
  assert.match(confusable.reason, /misread|0, O, I and l/);

  const truncated = parseSolanaAddress(VALID.slice(0, 20));
  assert.equal(truncated.ok, false);
  assert.match(truncated.reason, /truncated paste/);
  assert.match(truncated.reason, /20/);

  const empty = parseSolanaAddress("   ");
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /^Enter the/);
  /* Even the empty case states the shape, so the first thing a reader learns
     is what to go and fetch rather than that they left a box blank. */
  assert.match(empty.reason, /32 to 44 base58/);
});

test("no refusal is the bare word the product forbids", () => {
  for (const bad of ["", "   ", "wallet-x", VALID.slice(0, 10), VALID + "ZZZZ"]) {
    const parsed = parseSolanaAddress(bad);
    assert.equal(parsed.ok, false);
    assert.notEqual(parsed.reason.trim(), "Invalid");
    assert.ok(parsed.reason.length > 20, `a refusal that says only "${parsed.reason}" names nothing`);
  }
});

test("the schema and this module hold one definition, not two that must agree", () => {
  /* The regex the transfer schema applies IS this constant — if the adapter
     ever grows its own copy, this fails rather than drifting quietly. */
  const source = SplTransferInputSchema.shape.recipient;
  for (const candidate of [VALID, "wallet-opuATvsQx", VALID.slice(0, 20), VALID.slice(0, 43) + "O"]) {
    assert.equal(
      source.safeParse(candidate).success,
      BASE58_PUBKEY.test(candidate),
      `the schema and BASE58_PUBKEY disagree about "${candidate}"`,
    );
  }
});

test("the schema's own refusal names the field's shape instead of saying Invalid", () => {
  const result = SplTransferInputSchema.safeParse({
    schemaVersion: "1.0.0",
    actionRef: "action:solana-token-2022/spl-transfer@1",
    network: "devnet",
    mint: VALID,
    sender: VALID,
    recipient: "wallet-opuATvsQx9F1stmRoHhs1e7ipzvRB3gtUcDuy6mTFzvI",
    amountRaw: "1",
  });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((entry) => entry.path.join(".") === "recipient");
  assert.ok(issue, "the recipient issue is what a caller needs and it must exist");
  assert.notEqual(issue.message, "Invalid");
  assert.match(issue.message, /base58 Solana address/);
});
