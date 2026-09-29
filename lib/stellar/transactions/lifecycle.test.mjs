// Run from repo root: node --test lib/stellar/transactions/lifecycle.test.mjs
//
// The half of the lifecycle that happens after a signature: submission, what
// the ledger actually did, expected against actual, and a receipt somebody who
// does not trust Ryntra can recompute.
//
// Three of these are proven by breaking the thing they guard — a receipt with
// one byte changed, a ledger that reports a different amount, a submission
// whose answer never arrives — because a gate that has never failed is a gate
// nobody has tested.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

import { hashCanonical } from "../../guard/canonical.ts";
import { canonicalJson } from "../../guard/canonical-json.ts";
import { isResolved } from "../evidence.ts";
import { STELLAR_MAINNET, STELLAR_TESTNET } from "../network.ts";
import { parseAsset } from "../asset.ts";
import { buildPayment } from "./build.ts";
import { hashCanonicalAsync } from "./digest.ts";
import { fingerprintXdr, verifySignedTransaction } from "./fingerprint.ts";
import { canonicalAsset, decodeOutcome, expectedFromFingerprint, observeActualEffects, toStroops } from "./effects.ts";
import { reconcile } from "./reconcile.ts";
import { awaitInclusion, submitCleared } from "./submit.ts";
import { finalizeReceipt, parseReceipt, verifyReceipt, STELLAR_RECEIPT_LIMITATIONS } from "./receipt.ts";
import { preflightPayment } from "./preflight.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const DESTINATION = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = parseAsset(`USDC:${ISSUER}`).asset;
const HASH_RE = /^0x[0-9a-f]{64}$/;

/** A cleared transaction: built, signed, and through the gate. */
function cleared(over = {}) {
  const built = buildPayment({
    network: STELLAR_TESTNET,
    source: SOURCE.publicKey(),
    sequence: "100",
    destination: DESTINATION,
    asset: USDC,
    amount: "3.0000000",
    now: 1_760_000_000,
    ...over,
  });
  const tx = TransactionBuilder.fromXDR(built.unsignedXdr, (over.network ?? STELLAR_TESTNET).passphrase);
  tx.sign(SOURCE);
  const verdict = verifySignedTransaction({ authorized: built.fingerprint, signedXdr: tx.toXDR() });
  assert.equal(verdict.allowed, true, "the fixture must actually clear the gate");
  return verdict;
}

/**
 * Horizon, as it actually answered on 2026-08-13.
 *
 * Copied from the live probe rather than invented: a payment produces exactly
 * two effects, credit and debit, and no effect for the fee.
 *
 * One value is deliberately not the probe's. That transaction was fee-bumped by
 * whoever submitted it and was charged 200 stroops against a 100-stroop base,
 * and the first run of these tests reported it as a deviation — correctly, on a
 * fixture whose authorization only ever covered 100. A transaction this product
 * builds carries its own fee, so the baseline is a fee inside the ceiling and
 * the overcharge is its own case below.
 */
const horizonTransaction = (over = {}) => ({
  hash: "6b4108df7464672a4687af135489bab467b9f2b3dd12bf97fcea5b558f929878",
  ledger: 4_123_515,
  created_at: "2026-08-13T16:35:15Z",
  successful: true,
  fee_charged: "100",
  ...over,
});

const horizonEffects = (records) => ({ _embedded: { records } });

const paymentEffects = (amount = "3.0000000") => [
  { type: "account_credited", account: DESTINATION, amount, asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER },
  { type: "account_debited", account: SOURCE.publicKey(), amount, asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER },
];

/** A stub that answers each matched route in order, so polling can be tested. */
function sequencedFetch(routes) {
  const queues = new Map();
  for (const route of routes) queues.set(route.match, [...route.answers]);
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = typeof init?.body === "string" ? (JSON.parse(init.body).method ?? "") : "";
    for (const [match, answers] of queues) {
      if (!url.includes(match) && method !== match) continue;
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer.throws) throw new Error(answer.throws);
      const body = method ? { jsonrpc: "2.0", id: 1, ...answer.envelope } : answer.body;
      return new Response(JSON.stringify(body), {
        status: answer.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not stubbed", { status: 404 });
  };
}

const ledgerFetch = (over = {}) =>
  sequencedFetch([
    { match: `transactions/${horizonTransaction().hash}/effects`, answers: [{ body: horizonEffects(over.effects ?? paymentEffects()) }] },
    { match: `transactions/${horizonTransaction().hash}`, answers: [{ body: horizonTransaction(over.transaction) }] },
  ]);

const OBSERVED_AT = new Date("2026-08-13T16:35:30Z");

async function observed(over = {}) {
  const evidence = await observeActualEffects(STELLAR_TESTNET, horizonTransaction().hash, {
    fetchImpl: ledgerFetch(over),
    now: OBSERVED_AT,
  });
  assert.ok(isResolved(evidence), `the fixture read must resolve: ${evidence.reason ?? ""}`);
  return evidence;
}

// -------------------------------------------------------------- hashing --

test("the browser hasher and the kernel hasher produce the same bytes", async () => {
  /*
   * Two digests over one canonicalizer. This is the assertion that makes the
   * split safe: if they ever disagree, a receipt finalized in a browser stops
   * verifying against a hash recomputed anywhere else, and the failure would
   * look like tampering rather than like a refactor.
   */
  const values = [
    { b: 1, a: 2 },
    { nested: { z: [1, 2, { y: null }], a: "x" }, dropped: undefined },
    [],
    "plain",
    { unicode: "issuer · Ærø", empty: {} },
  ];
  for (const value of values) {
    assert.equal(await hashCanonicalAsync(value), hashCanonical(value), `disagreed on ${canonicalJson(value)}`);
  }
});

test("canonicalization still sorts keys and drops undefined, so the kernel's hashes did not move", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ a: 1, gone: undefined }), '{"a":1}');
  assert.match(hashCanonical({ a: 1 }), HASH_RE);
});

// ----------------------------------------------------------- the verdict --

test("a cleared transaction carries the exact bytes and the hash they produce", () => {
  const verdict = cleared();
  const tx = TransactionBuilder.fromXDR(verdict.signedXdr, STELLAR_TESTNET.passphrase);

  assert.equal(verdict.transactionHash, tx.hash().toString("hex"));
  assert.match(verdict.transactionHash, /^[0-9a-f]{64}$/);
  /* The hash exists before anything is submitted, which is what makes an
     unanswered submission recoverable rather than lost. */
  assert.ok(verdict.signedXdr.length > 0);
});

test("a fee-bump is refused by name, not by crashing on the next property", () => {
  /*
   * Found by loading the Receipts page and pasting a real testnet hash.
   *
   * `FeeBumpTransaction` in SDK 16.2.0 exposes an `operations` array delegating
   * to the transaction it wraps, so the guard that asked "does it have
   * operations" said yes, the written refusal never ran, and the first read of
   * `.memo` threw `Cannot read properties of undefined`. The gate failed closed
   * by crashing — which is luck, and would have read as a broken page rather
   * than as a refusal.
   */
  const inner = buildPayment({
    network: STELLAR_TESTNET,
    source: SOURCE.publicKey(),
    sequence: "100",
    destination: DESTINATION,
    asset: USDC,
    amount: "3.0000000",
    now: 1_760_000_000,
  });
  const signedInner = TransactionBuilder.fromXDR(inner.unsignedXdr, STELLAR_TESTNET.passphrase);
  signedInner.sign(SOURCE);
  const bumped = TransactionBuilder.buildFeeBumpTransaction(SOURCE, "200", signedInner, STELLAR_TESTNET.passphrase);
  bumped.sign(SOURCE);

  assert.throws(
    () => fingerprintXdr(bumped.toXDR(), STELLAR_TESTNET.passphrase),
    /fee-bump transaction cannot be fingerprinted/,
    "a fee-bump must be refused by name",
  );

  const verdict = verifySignedTransaction({ authorized: inner.fingerprint, signedXdr: bumped.toXDR() });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /fee-bump|could not be read/);
});

// ------------------------------------------------------------ submission --

test("a transaction authorized for one network is refused before it can reach another", async () => {
  let called = false;
  const outcome = await submitCleared(STELLAR_MAINNET, cleared(), {
    fetchImpl: async () => {
      called = true;
      return new Response("{}");
    },
  });
  assert.equal(outcome.kind, "REJECTED");
  assert.equal(outcome.code, "NETWORK_MISMATCH");
  assert.equal(called, false, "the refusal must happen before the request, not after it");
});

test("every submission answer maps to exactly one honest outcome", async () => {
  const cases = [
    { status: "PENDING", kind: "SUBMITTED" },
    { status: "DUPLICATE", kind: "SUBMITTED" },
    { status: "TRY_AGAIN_LATER", kind: "UNKNOWN" },
    { status: "ERROR", kind: "REJECTED" },
    { status: "SOMETHING_NEW", kind: "UNKNOWN" },
  ];
  for (const testCase of cases) {
    const outcome = await submitCleared(STELLAR_TESTNET, cleared(), {
      fetchImpl: sequencedFetch([{ match: "sendTransaction", answers: [{ envelope: { result: { status: testCase.status } } }] }]),
      now: () => OBSERVED_AT,
    });
    assert.equal(outcome.kind, testCase.kind, `${testCase.status} became ${outcome.kind}`);
    assert.match(outcome.transactionHash, /^[0-9a-f]{64}$/, "every outcome must carry the hash");
  }
});

test("a submission whose answer never arrives is unknown, never failed", async () => {
  /*
   * The one that costs money to get wrong. A POST that times out may already
   * have been broadcast; calling that a failure invites a second signature for
   * the same intent, and two payments where one was authorized.
   */
  for (const broken of [
    { throws: "network down" },
    { status: 502, envelope: {} },
    { envelope: { error: { message: "overloaded" } } },
  ]) {
    const outcome = await submitCleared(STELLAR_TESTNET, cleared(), {
      fetchImpl: sequencedFetch([{ match: "sendTransaction", answers: [broken] }]),
    });
    assert.equal(outcome.kind, "UNKNOWN", `${JSON.stringify(broken)} must not be reported as rejected`);
    assert.match(outcome.reason, /may or may not have been broadcast/);
    assert.match(outcome.transactionHash, /^[0-9a-f]{64}$/);
  }
});

test("waiting for a ledger tolerates not-found and stops without inventing a failure", async () => {
  const hash = cleared().transactionHash;
  const included = await awaitInclusion(STELLAR_TESTNET, hash, {
    fetchImpl: sequencedFetch([
      {
        match: "getTransaction",
        answers: [
          { envelope: { result: { status: "NOT_FOUND" } } },
          { envelope: { result: { status: "SUCCESS", ledger: 4_123_515, createdAt: "1786638915" } } },
        ],
      },
    ]),
    sleep: async () => {},
    intervalMs: 1,
    timeoutMs: 1_000,
  });
  assert.equal(included.kind, "INCLUDED");
  assert.equal(included.inclusion.ledger, 4_123_515);
  assert.equal(included.inclusion.closedAt, "2026-08-13T16:35:15.000Z");
  assert.equal(included.inclusion.status, "SUCCESS");

  const never = await awaitInclusion(STELLAR_TESTNET, hash, {
    fetchImpl: sequencedFetch([{ match: "getTransaction", answers: [{ envelope: { result: { status: "NOT_FOUND" } } }] }]),
    sleep: async () => {},
    intervalMs: 1,
    timeoutMs: 10,
  });
  assert.equal(never.kind, "PENDING", "not on a ledger yet is not the same as rejected");
  assert.match(never.reason, /no longer retains|No ledger holds/);
});

// ---------------------------------------------------------------- amounts --

test("amounts are compared in stroops, so one amount written two ways is one amount", () => {
  assert.equal(toStroops("3"), "30000000");
  assert.equal(toStroops("3.0000000"), "30000000");
  assert.equal(toStroops("0.0000001"), "1");
  assert.equal(toStroops("922337203685.4775807"), "9223372036854775807");
  for (const bad of ["3.12345678", "-1", "1e5", "", "abc"]) {
    assert.equal(toStroops(bad), null, `"${bad}" must not parse`);
  }
});

test("one spelling for an asset, whichever side named it", () => {
  assert.equal(canonicalAsset("native"), "native");
  assert.equal(canonicalAsset({ assetType: "native" }), "native");
  assert.equal(canonicalAsset({ assetType: "credit_alphanum4", code: "USDC", issuer: ISSUER }), `USDC:${ISSUER}`);
  assert.equal(canonicalAsset(`USDC:${ISSUER}`), `USDC:${ISSUER}`);
});

// -------------------------------------------------------------- expected --

test("the expectation comes from what was signed, not from what was typed", () => {
  const expected = expectedFromFingerprint(cleared().fingerprint);
  assert.equal(expected.source, SOURCE.publicKey());
  assert.deepEqual(
    expected.movements.map((movement) => `${movement.kind} ${movement.account} ${movement.asset} ${movement.stroops}`),
    [`CREDIT ${DESTINATION} USDC:${ISSUER} 30000000`, `DEBIT ${SOURCE.publicKey()} USDC:${ISSUER} 30000000`],
  );
  assert.deepEqual(expected.unprojectedOperations, []);
});

test("an operation this projection does not model is named rather than dropped", () => {
  const fingerprint = { ...cleared().fingerprint };
  const expected = expectedFromFingerprint({
    ...fingerprint,
    operations: [...fingerprint.operations, { type: "changeTrust", source: null, fields: { line: "X", limit: "1" } }],
  });
  assert.deepEqual(expected.unprojectedOperations, ["changeTrust"]);
});

// ---------------------------------------------------------------- actual --

test("the ledger read carries its sources and the transaction's own close time", async () => {
  const evidence = await observed();
  assert.equal(evidence.state, "FRESH");
  assert.equal(evidence.data.ledger, 4_123_515);
  assert.equal(evidence.data.closedAt, "2026-08-13T16:35:15.000Z");
  assert.equal(evidence.data.feeChargedStroops, "100");
  assert.equal(evidence.data.movements.length, 2);
  assert.equal(evidence.sources.length, 2);
  for (const source of evidence.sources) assert.match(source.ref, /^stellar:testnet:horizon:/);
});

test("a half-readable ledger is unavailable rather than half-reported", async () => {
  const noEffects = await observeActualEffects(STELLAR_TESTNET, horizonTransaction().hash, {
    now: OBSERVED_AT,
    fetchImpl: sequencedFetch([
      { match: "/effects", answers: [{ status: 503, body: {} }] },
      { match: "transactions/", answers: [{ body: horizonTransaction() }] },
    ]),
  });
  assert.equal(noEffects.state, "UNAVAILABLE");
  assert.match(noEffects.reason, /effects could not be read/);

  const noFee = await observeActualEffects(STELLAR_TESTNET, horizonTransaction().hash, {
    now: OBSERVED_AT,
    fetchImpl: ledgerFetch({ transaction: { fee_charged: undefined } }),
  });
  assert.equal(noFee.state, "UNAVAILABLE", "a missing fee must never become a zero on a receipt");

  const missing = await observeActualEffects(STELLAR_TESTNET, horizonTransaction().hash, {
    now: OBSERVED_AT,
    fetchImpl: sequencedFetch([{ match: "transactions/", answers: [{ status: 404, body: {} }] }]),
  });
  assert.equal(missing.state, "UNKNOWN", "a transaction Horizon has never seen is unknown, not broken");
});

// -------------------------------------------------------- reconciliation --

test("an honest payment reconciles, and the same amount written differently still reconciles", async () => {
  const expected = expectedFromFingerprint(cleared().fingerprint);
  assert.equal(reconcile(expected, (await observed()).data).status, "MATCHED");

  const shortForm = await observed({ effects: paymentEffects("3") });
  assert.equal(reconcile(expected, shortForm.data).status, "MATCHED", "3 and 3.0000000 are one amount");
});

test("a ledger that did something else is a recorded deviation that names both sides", async () => {
  const expected = expectedFromFingerprint(cleared().fingerprint);
  const wrong = await observed({ effects: paymentEffects("5.0000000") });

  const result = reconcile(expected, wrong.data);
  assert.equal(result.status, "DEVIATION_RECORDED");
  const deviation = result.checks.find((check) => check.outcome === "DEVIATION");
  assert.match(deviation.expected, /3\.0000000/);
  assert.match(deviation.actual, /5\.0000000/);
});

test("a movement nobody authorized is a deviation even when everything expected happened", async () => {
  const expected = expectedFromFingerprint(cleared().fingerprint);
  const extra = await observed({
    effects: [
      ...paymentEffects(),
      { type: "account_credited", account: ISSUER, amount: "1.0000000", asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER },
    ],
  });
  const result = reconcile(expected, extra.data);
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.ok(result.checks.some((check) => check.label.includes("nobody authorized")));
});

test("the fee is a ceiling, and only exceeding it is a deviation", async () => {
  const expected = expectedFromFingerprint(cleared().fingerprint);
  assert.equal(reconcile(expected, (await observed()).data).status, "MATCHED", "charging less than authorized is normal");

  const overcharged = await observed({ transaction: { fee_charged: "999999" } });
  const result = reconcile(expected, overcharged.data);
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.ok(result.checks.some((check) => check.id === "fee.ceiling" && check.outcome === "DEVIATION"));
});

test("a failed transaction never reconciles as matched", async () => {
  const expected = expectedFromFingerprint(cleared().fingerprint);
  const failed = await observed({ transaction: { successful: false }, effects: [] });
  assert.equal(reconcile(expected, failed.data).status, "DEVIATION_RECORDED");
});

test("something that could not be checked is never reported as agreement", async () => {
  /* The third answer. A ledger effect this projection does not model means the
     transaction was partially examined — and a green tick over a partial
     examination is the exact failure this vocabulary exists to prevent. */
  const expected = expectedFromFingerprint(cleared().fingerprint);
  const strange = await observed({
    effects: [...paymentEffects(), { type: "data_created", account: SOURCE.publicKey() }],
  });
  const result = reconcile(expected, strange.data);
  assert.equal(result.status, "RECONCILIATION_REQUIRED");
  assert.ok(result.checks.some((check) => check.outcome === "UNCHECKABLE"));

  const nothing = reconcile({ ...expected, movements: [] }, (await observed()).data);
  assert.notEqual(nothing.status, "MATCHED", "having compared nothing is not agreement");
});

// --------------------------------------------------------------- receipt --

async function receiptFixture(over = {}) {
  const verdict = cleared();
  const evidence = await observed(over.ledger);
  return finalizeReceipt({
    network: STELLAR_TESTNET,
    fingerprint: verdict.fingerprint,
    subject: SOURCE.publicKey(),
    authorizedAt: "2026-08-13T16:34:00.000Z",
    expiresAtUnix: 1_760_000_300,
    submittedAt: "2026-08-13T16:34:30.000Z",
    expected: expectedFromFingerprint(verdict.fingerprint),
    actual: evidence.data,
    sources: evidence.sources,
    observedAt: evidence.observedAt,
    finalizedAt: "2026-08-13T16:35:31.000Z",
  });
}

test("the receipt chains intent to authorization to transaction to effects to itself", async () => {
  const receipt = await receiptFixture();

  for (const hash of [receipt.intent.hash, receipt.authorization.hash, receipt.actualEffectsHash, receipt.receiptHash]) {
    assert.match(hash, HASH_RE);
  }
  assert.equal(receipt.reconciliation.status, "MATCHED");
  assert.equal(receipt.execution.transactionHash, horizonTransaction().hash);
  assert.match(receipt.execution.explorerUrl, /^https:\/\/stellar\.expert\/explorer\/testnet\/tx\//);
  assert.equal(receipt.authorization.expiresAt, new Date(1_760_000_300 * 1000).toISOString());

  /* The layers that are not built are present and null, with a reason. A field
     removed from a receipt reads as a field taken out of one. */
  assert.equal(receipt.decision.policyVersion, null);
  assert.match(receipt.decision.reason, /RYN-STELLAR-006/);
  for (const limitation of STELLAR_RECEIPT_LIMITATIONS) assert.ok(receipt.limitations.includes(limitation));
});

test("a receipt verifies against the ledger without trusting anything in it", async () => {
  const receipt = await receiptFixture();
  const verification = await verifyReceipt(receipt, STELLAR_TESTNET, { fetchImpl: ledgerFetch(), now: OBSERVED_AT });

  assert.equal(verification.verdict, "CONFIRMED", JSON.stringify(verification.findings, null, 1));
  assert.ok(verification.findings.length >= 6);
  assert.ok(verification.findings.every((finding) => finding.outcome === "CONFIRMED"));
});

test("one edited byte makes the receipt read as altered — proven by editing one", async () => {
  const receipt = await receiptFixture();

  /* The realistic forgery: change the amount the receipt claims was received
     and leave every hash where it was. */
  const forged = {
    ...receipt,
    actual: {
      ...receipt.actual,
      movements: receipt.actual.movements.map((movement) =>
        movement.kind === "CREDIT" ? { ...movement, amount: "300.0000000", stroops: "3000000000" } : movement,
      ),
    },
  };
  const verification = await verifyReceipt(forged, STELLAR_TESTNET, { fetchImpl: ledgerFetch(), now: OBSERVED_AT });
  assert.equal(verification.verdict, "ALTERED");
  assert.ok(verification.findings.some((finding) => finding.id === "hash.receipt" && finding.outcome === "FAILED"));

  /*
   * The competent forgery, and the reason the ledger is read again at all.
   *
   * Restamping only the receipt hash is not enough — the effects hash still
   * describes the old effects, and the document contradicts itself. So this
   * rewrites the claim, its effects hash and its receipt hash, producing a
   * document that is internally perfect. Every hash check passes. The ledger is
   * the only thing left that can refuse it, and it does.
   */
  const consistent = { ...forged, actualEffectsHash: await hashCanonicalAsync({ kind: "stellar.actualEffects", actual: forged.actual }) };
  const restamped = { ...consistent, receiptHash: await hashCanonicalAsync({ ...consistent, receiptHash: undefined }) };

  const reread = await verifyReceipt(restamped, STELLAR_TESTNET, { fetchImpl: ledgerFetch(), now: OBSERVED_AT });
  assert.equal(reread.verdict, "ALTERED");
  assert.ok(
    reread.findings.filter((finding) => finding.id.startsWith("hash.")).every((finding) => finding.outcome === "CONFIRMED"),
    "the forgery must be internally consistent, or this proves nothing about the ledger check",
  );
  assert.ok(reread.findings.some((finding) => finding.id === "ledger.reread" && finding.outcome === "FAILED"));
});

test("a receipt checked against the wrong network fails rather than passing quietly", async () => {
  const receipt = await receiptFixture();
  const verification = await verifyReceipt(receipt, STELLAR_MAINNET, { fetchImpl: ledgerFetch(), now: OBSERVED_AT });
  assert.equal(verification.verdict, "ALTERED");
  assert.ok(verification.findings.some((finding) => finding.id === "network"));
});

test("a ledger that cannot be read leaves the receipt unconfirmed, not confirmed and not altered", async () => {
  const receipt = await receiptFixture();
  const verification = await verifyReceipt(receipt, STELLAR_TESTNET, {
    now: OBSERVED_AT,
    fetchImpl: sequencedFetch([{ match: "transactions/", answers: [{ throws: "horizon unreachable" }] }]),
  });
  assert.equal(verification.verdict, "UNCONFIRMED");
  assert.ok(verification.findings.some((finding) => finding.outcome === "UNCHECKABLE"));
  assert.ok(!verification.findings.some((finding) => finding.outcome === "FAILED"));
});

test("an untrusted receipt is read narrowly and fails closed", async () => {
  const receipt = await receiptFixture();
  const parsed = parseReceipt(JSON.stringify(receipt));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.receipt.receiptHash, receipt.receiptHash);

  for (const [text, reason] of [
    ["not json", /not JSON/],
    ["[]", /not a Ryntra Stellar lifecycle receipt/],
    [JSON.stringify({ ...receipt, schemaVersion: "other" }), /not a Ryntra Stellar lifecycle receipt/],
    [JSON.stringify({ ...receipt, receiptHash: "0xnope" }), /no SHA-256 receipt hash/],
    [JSON.stringify({ ...receipt, execution: { ...receipt.execution, transactionHash: "abc" } }), /names no Stellar transaction/],
    [JSON.stringify({ ...receipt, expected: undefined }), /missing a section/],
  ]) {
    const result = parseReceipt(text);
    assert.equal(result.ok, false, `"${String(text).slice(0, 30)}" was accepted`);
    assert.match(result.reason, reason);
  }
});

// ------------------------------------------------------------- boundaries --

test("submission lives in exactly one file, and the read adapter still refuses it", () => {
  /*
   * The boundary moved and did not disappear. Before this lifecycle existed, no
   * file in `lib/stellar` could submit anything. Now exactly one can, and the
   * read adapter every page uses still refuses `sendTransaction` by name — so
   * the property being asserted is "one door", not "no door", and a second one
   * opened anywhere else fails here.
   */
  const walk = (dir, found = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, found);
      else if (/\.tsx?$/.test(entry.name)) found.push(path);
    }
    return found;
  };

  const submitters = walk(join(REPO, "lib", "stellar"))
    .filter((file) => {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      return /"sendTransaction"|'sendTransaction'/.test(code);
    })
    .map((file) => file.slice(REPO.length + 1).replace(/\\/g, "/"));

  assert.deepEqual(
    submitters.sort(),
    ["lib/stellar/client.ts", "lib/stellar/transactions/submit.ts"],
    "sendTransaction must appear only where it is refused and where it is the declared write boundary",
  );

  const client = readFileSync(join(REPO, "lib", "stellar", "client.ts"), "utf8");
  assert.match(client, /REFUSED_RPC_METHODS/, "the read client must keep naming what it refuses");
});

test("the browser is allowed to reach testnet Stellar, and is not allowed to reach mainnet", () => {
  /*
   * The defect this exists to prevent had already shipped.
   *
   * `/stellar/workspace/authorize` reads the signer's account sequence from the
   * browser, and the site's `connect-src` named no Stellar origin — so on the
   * deployed page the very first action failed with a CSP violation and no
   * transaction could be built. Typecheck, lint, 1,478 tests and a production
   * build all passed; the page even failed honestly, printing the reason. Only
   * loading it in a browser showed it.
   *
   * The second half is not symmetry for its own sake. Every mainnet read here
   * happens in a server component, so leaving the mainnet origins out turns the
   * header into an enforcement of the testnet-only claim rather than a
   * restatement of it.
   */
  const config = readFileSync(join(REPO, "next.config.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const directive = config.match(/connect-src[^`]*/);
  assert.ok(directive, "next.config.ts no longer declares a connect-src directive.");

  for (const origin of [STELLAR_TESTNET.horizonUrl, STELLAR_TESTNET.rpcUrl]) {
    assert.ok(
      directive[0].includes(origin),
      `The browser cannot reach ${origin}, so the Send and Receipts surfaces cannot work on the deployed site.`,
    );
  }
  for (const origin of [STELLAR_MAINNET.horizonUrl, STELLAR_MAINNET.rpcUrl]) {
    assert.ok(
      !directive[0].includes(origin),
      `${origin} is reachable from the browser. Mainnet Stellar is read in server components only, and the header is what makes the testnet-only claim enforceable.`,
    );
  }

  /* And the surfaces that do the reaching must be the testnet ones. */
  for (const surface of ["send/send-console.tsx", "receipts/verify-console.tsx"]) {
    const source = readFileSync(join(REPO, "app", "stellar", "workspace", ...surface.split("/")), "utf8");
    assert.match(source, /STELLAR_TESTNET/, `${surface} does not pin itself to testnet.`);
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /STELLAR_MAINNET/, `${surface} reaches for mainnet.`);
  }
});

test("no surface claims the workspace cannot submit, now that one can", () => {
  /*
   * Rule nine, as a test: a boundary sentence that outlives its boundary is
   * worse than none. These strings were true until this lifecycle shipped, and
   * a regression that reinstates one is a false claim on a live page.
   */
  const stale = [/no submission step/i, /has no submit step/i, /nothing submits to any network/i, /stops before submission/i];
  const surfaces = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) surfaces.push(path);
    }
  };
  walk(join(REPO, "app", "stellar"));

  for (const path of surfaces) {
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const pattern of stale) {
      assert.doesNotMatch(source, pattern, `${path.slice(REPO.length + 1)} still says the workspace cannot submit.`);
    }
  }
});

// ------------------------------------------------------- the ledger's reason --

test("a refused transaction carries the network's own reason, not just a refusal", () => {
  /*
   * The fixture is a refused testnet run: a payment to an account that does not
   * exist on testnet. The result XDR below was read from Horizon, not composed.
   *
   * That run is why this exists. The lifecycle worked, the reconciliation
   * correctly recorded a deviation, and the surface said "the ledger recorded no
   * such movement" — true, and it left the person with no idea what to do. The
   * answer was `paymentNoDestination`, sitting in bytes nothing decoded.
   */
  const REAL_FAILURE = "AAAAAAAAAGT/////AAAAAQAAAAAAAAAB////+wAAAAA=";

  const outcome = decodeOutcome(REAL_FAILURE);
  assert.equal(outcome.code, "txFailed");
  assert.deepEqual(outcome.operations, ["paymentNoDestination"]);
  assert.match(outcome.explanation, /destination account does not exist/);
  assert.match(outcome.explanation, /has to exist first/, "the explanation must name the next action, not only the fault");
});

test("an unreadable result is an unknown outcome, never an exception", () => {
  /* This runs while somebody is looking at a failed payment. The only thing
     worse than an unexplained failure is a blank screen where the explanation
     was meant to be. */
  for (const rubbish of ["", "not-base64", "AAAA"]) {
    const outcome = decodeOutcome(rubbish);
    assert.equal(outcome.code, "UNREADABLE");
    assert.deepEqual(outcome.operations, []);
    assert.match(outcome.explanation, /could not be decoded/);
  }
});

test("reconciliation names the refusal code, so a deviation is diagnosable", async () => {
  const expected = expectedFromFingerprint(cleared().fingerprint);
  const refused = await observed({
    transaction: { successful: false, result_xdr: "AAAAAAAAAGT/////AAAAAQAAAAAAAAAB////+wAAAAA=" },
    effects: [],
  });

  const result = reconcile(expected, refused.data);
  assert.equal(result.status, "DEVIATION_RECORDED");
  const outcome = result.checks.find((check) => check.id === "ledger.outcome");
  assert.match(outcome.actual, /rejected in ledger/);
  assert.match(outcome.actual, /paymentNoDestination/, "the check must carry the code, not only the fact of refusal");
});

test("a receipt from an earlier shape reads as unconfirmed, never as altered", async () => {
  /*
   * Version drift is a limit of the reader, not evidence about the document.
   * A fresh ledger read produces the current shape, so its hash cannot equal one
   * taken over an earlier shape — and calling that `ALTERED` would accuse
   * somebody of tampering with a receipt nobody touched.
   */
  const current = await receiptFixture();
  const legacy = { ...current, schemaVersion: "stellar-lifecycle-1.0.0" };
  const restamped = { ...legacy, receiptHash: await hashCanonicalAsync({ ...legacy, receiptHash: undefined }) };

  const verification = await verifyReceipt(restamped, STELLAR_TESTNET, { fetchImpl: ledgerFetch(), now: OBSERVED_AT });
  assert.equal(verification.verdict, "UNCONFIRMED");
  const reread = verification.findings.find((finding) => finding.id === "ledger.reread");
  assert.equal(reread.outcome, "UNCHECKABLE");
  assert.match(reread.detail, /stellar-lifecycle-1\.0\.0/);
  assert.ok(
    verification.findings.filter((finding) => finding.id.startsWith("hash.")).every((finding) => finding.outcome === "CONFIRMED"),
    "its own hashes must still hold — that is what makes this drift rather than damage",
  );
});

// ------------------------------------------------------------- preflight --

const accountFetch = (routes) =>
  sequencedFetch(Object.entries(routes).map(([account, answer]) => ({ match: `accounts/${account}`, answers: [answer] })));

const FUNDED = { body: { balances: [{ asset_type: "native", balance: "9999.9999800" }] } };
const MISSING = { status: 404, body: {} };

const payment = (over = {}) => ({
  network: STELLAR_TESTNET,
  source: SOURCE.publicKey(),
  destination: DESTINATION,
  asset: parseAsset("XLM").asset,
  amount: "1.0000000",
  feeStroops: "100",
  ...over,
});

test("a payment to an account that does not exist is blocked before anything is built", async () => {
  /*
   * The defect this closes.
   *
   * The destination was never created on testnet. The surface built, authorized,
   * signed and submitted a payment to it twice, and the network refused both
   * with `paymentNoDestination` — reported correctly, after a signature had
   * already been spent. Everything needed to know that was one read away.
   */
  const result = await preflightPayment(
    payment({ destination: "GCJTLHYY6O6JI35UJDNCSWXVPEFOQBHMKIFD7WXWS3UT6KUPPRSWV7ZJ" }),
    { fetchImpl: accountFetch({ GCJTLHYY6O6JI35UJDNCSWXVPEFOQBHMKIFD7WXWS3UT6KUPPRSWV7ZJ: MISSING, [SOURCE.publicKey()]: FUNDED }) },
  );

  assert.equal(result.state, "BLOCKED");
  const exists = result.checks.find((check) => check.id === "destination.exists");
  assert.equal(exists.outcome, "BLOCK");
  assert.match(exists.detail, /will not create an account by paying it/);
  assert.match(exists.detail, /friendbot/i, "on an ephemeral network it must name the way to fix it");
});

test("an honest payment passes every check", async () => {
  const result = await preflightPayment(payment(), {
    fetchImpl: accountFetch({ [DESTINATION]: FUNDED, [SOURCE.publicKey()]: FUNDED }),
  });
  assert.equal(result.state, "READY");
  assert.ok(result.checks.every((check) => check.outcome === "PASS"));
});

test("a preflight blocks only what is certain, and reports the rest", async () => {
  /*
   * The rule this module holds to. A check that stops a payment which would
   * have succeeded is a check people learn to click past, and then it protects
   * nobody — so an unreadable source is `UNCONFIRMED`, never `BLOCKED`.
   */
  const unreadable = await preflightPayment(payment(), {
    fetchImpl: sequencedFetch([
      { match: `accounts/${DESTINATION}`, answers: [FUNDED] },
      { match: `accounts/${SOURCE.publicKey()}`, answers: [{ status: 503, body: {} }] },
    ]),
  });
  assert.equal(unreadable.state, "UNCONFIRMED");
  assert.equal(unreadable.checks.find((check) => check.id === "source.balance").outcome, "UNKNOWN");

  /* And the native reserve is deliberately not modelled, so a balance that
     covers the amount passes and the network decides the rest. */
  const thin = await preflightPayment(payment({ amount: "9999.0000000" }), {
    fetchImpl: accountFetch({ [DESTINATION]: FUNDED, [SOURCE.publicKey()]: FUNDED }),
  });
  assert.equal(thin.state, "READY", "a balance that covers the amount is not blocked on an estimated reserve");
});

test("what is certainly impossible is blocked, and says what to do", async () => {
  const cases = [
    [payment({ amount: "0" }), "amount", /moves nothing/],
    [payment({ amount: "1.12345678" }), "amount", /at most seven places/],
    [payment({ destination: "not-an-address" }), "destination.format", /must be a G-address/],
    [payment({ amount: "50000.0000000" }), "source.balance", /does not cover/],
  ];
  for (const [input, id, expected] of cases) {
    const result = await preflightPayment(input, {
      fetchImpl: accountFetch({ [DESTINATION]: FUNDED, [SOURCE.publicKey()]: FUNDED }),
    });
    assert.equal(result.state, "BLOCKED", `${id} should have blocked ${JSON.stringify(input.amount ?? input.destination)}`);
    assert.match(result.checks.find((check) => check.id === id).detail, expected);
  }
});

test("a source that does not exist is blocked, because it cannot send anything", async () => {
  const result = await preflightPayment(payment(), {
    fetchImpl: accountFetch({ [DESTINATION]: FUNDED, [SOURCE.publicKey()]: MISSING }),
  });
  assert.equal(result.state, "BLOCKED");
  assert.match(result.checks.find((check) => check.id === "source.balance").detail, /created and funded/);
});

test("the preflight is not a policy decision, and does not describe itself as one", () => {
  /* `RYN-STELLAR-006` owns policy. Four deterministic reads are not a rule set,
     and a surface that calls them one would be claiming a layer that does not
     exist. */
  const source = readFileSync(join(REPO, "lib", "stellar", "transactions", "preflight.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [/\bpolicyVersion\b/, /\bpolicyDecision\b/, /\bALLOWED_BY_POLICY\b/, /\bREVIEW_REQUIRED\b/]) {
    assert.doesNotMatch(code, forbidden, "preflight must not borrow the policy engine's vocabulary");
  }
});
