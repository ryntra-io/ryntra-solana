// Run from repo root: node --test lib/stellar/transactions/transactions.test.mjs
//
// A signature is not consent to whatever comes back. These guard the one check
// that makes that true: the bytes a wallet returns are compared against what a
// person authorized, before anything reaches the network.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

import { buildPayment } from "./build.ts";
import { compareFingerprints, fingerprintXdr, verifySignedTransaction } from "./fingerprint.ts";
import { STELLAR_MAINNET, STELLAR_TESTNET } from "../network.ts";
import { parseAsset } from "../asset.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

/* Derived from a fixed seed rather than a pasted secret: deterministic across
   runs, and no string that looks like a credential ever enters the repository
   for `scan-tracked-credentials.mjs` — or a human reader — to worry about. */
const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const DESTINATION = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER = "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2";
const USDC = parseAsset(`USDC:${DESTINATION}`).asset;

/**
 * A signed transaction that is not the one authorized.
 *
 * The realistic shape of the attack: a wallet returns something properly signed
 * that simply is not what the person read. An unsigned tamper is blocked one
 * step earlier, on "no signature", and would never exercise the field
 * comparison this is here to prove.
 */
const signedTamper = (over) => {
  const built = buildPayment(intent(over));
  const tx = TransactionBuilder.fromXDR(built.unsignedXdr, (over.network ?? STELLAR_TESTNET).passphrase);
  tx.sign(SOURCE);
  return tx.toXDR();
};

const intent = (over = {}) => ({
  network: STELLAR_TESTNET,
  source: SOURCE.publicKey(),
  sequence: "100",
  destination: DESTINATION,
  asset: USDC,
  amount: "12.5000000",
  now: 1_760_000_000,
  ...over,
});

test("a built transaction carries the fingerprint of what it does", () => {
  const built = buildPayment(intent());

  assert.match(built.unsignedXdr, /^[A-Za-z0-9+/=]+$/, "the XDR must be base64");
  assert.equal(built.fingerprint.networkPassphrase, STELLAR_TESTNET.passphrase);
  assert.equal(built.fingerprint.source, SOURCE.publicKey());
  assert.equal(built.fingerprint.operations.length, 1);
  assert.equal(built.fingerprint.operations[0].type, "payment");
  assert.equal(built.fingerprint.operations[0].fields.destination, DESTINATION);
  assert.equal(built.fingerprint.operations[0].fields.amount, "12.5000000");

  /* Round trip: reading the bytes back must produce the same intent, or the
     fingerprint describes the builder rather than the transaction. */
  assert.deepEqual(fingerprintXdr(built.unsignedXdr, STELLAR_TESTNET.passphrase), built.fingerprint);
});

test("an honest signature passes, because the comparison is semantic and not byte-equality", () => {
  /* Signing appends signatures, so the bytes necessarily change. A byte
     comparison would reject every real signature and accept none. */
  const built = buildPayment(intent());
  const signed = TransactionBuilder.fromXDR(built.unsignedXdr, STELLAR_TESTNET.passphrase);
  signed.sign(SOURCE);
  const signedXdr = signed.toXDR();

  assert.notEqual(signedXdr, built.unsignedXdr, "signing must actually change the bytes");

  const verdict = verifySignedTransaction({ authorized: built.fingerprint, signedXdr });
  assert.equal(verdict.allowed, true, "an honest signature over the authorized intent must pass");
});

test("a changed destination is blocked, and the block names the field", () => {
  const authorized = buildPayment(intent()).fingerprint;
  const tampered = signedTamper({ destination: OTHER });

  const verdict = verifySignedTransaction({ authorized, signedXdr: tampered });
  assert.equal(verdict.allowed, false);
  assert.ok(
    verdict.mismatches.some(
      (m) => m.field === "operations[0].destination" && m.authorized === DESTINATION && m.signed === OTHER,
    ),
    `the mismatch must name the field and both values, got ${JSON.stringify(verdict.mismatches)}`,
  );
});

test("a changed amount and a changed asset are each blocked", () => {
  const authorized = buildPayment(intent()).fingerprint;

  const moreMoney = verifySignedTransaction({
    authorized,
    signedXdr: signedTamper({ amount: "125.0000000" }),
  });
  assert.equal(moreMoney.allowed, false);
  assert.ok(moreMoney.mismatches.some((m) => m.field === "operations[0].amount"));

  const otherAsset = verifySignedTransaction({
    authorized,
    signedXdr: signedTamper({ asset: parseAsset(`EURC:${OTHER}`).asset }),
  });
  assert.equal(otherAsset.allowed, false);
  assert.ok(otherAsset.mismatches.some((m) => m.field === "operations[0].asset"));
});

test("the same transaction signed against another network is blocked", () => {
  /*
   * The substitution that leaves every visible field identical. Destination,
   * amount and asset all match; only the ledger the signature is valid over has
   * changed. Without the passphrase in the fingerprint this passes, and a
   * mainnet signature is submitted for a testnet intent.
   */
  const authorized = buildPayment(intent()).fingerprint;

  const onMainnet = buildPayment(intent({ network: STELLAR_MAINNET }));
  const mainnetSigned = TransactionBuilder.fromXDR(onMainnet.unsignedXdr, STELLAR_MAINNET.passphrase);
  mainnetSigned.sign(SOURCE);

  const verdict = verifySignedTransaction({ authorized, signedXdr: mainnetSigned.toXDR() });
  assert.equal(verdict.allowed, false, "a signature over another network must never be submitted");
  assert.match(verdict.reason, /another network|another key/);
});

test("an unreadable transaction fails closed", () => {
  const authorized = buildPayment(intent()).fingerprint;
  for (const rubbish of ["", "not-base64", "AAAAAgAAAA"]) {
    const verdict = verifySignedTransaction({ authorized, signedXdr: rubbish });
    assert.equal(verdict.allowed, false, `"${rubbish}" must not be submitted`);
    assert.match(verdict.reason, /could not be read/);
  }
});

test("an amount that is not a Stellar amount is refused before it is built", () => {
  /* Seven decimals is the ledger's precision. A float would round at the
     fifteenth digit — a rounding nobody asked for, applied to money. */
  for (const bad of ["12.12345678", "-1", "1e5", "", "abc", "1.2.3"]) {
    assert.throws(() => buildPayment(intent({ amount: bad })), /not a Stellar amount/, `"${bad}" was accepted`);
  }
  assert.doesNotThrow(() => buildPayment(intent({ amount: "0.0000001" })));
});

test("identical intents compare equal, so the gate cannot be noisy", () => {
  /* A comparison that reports differences between a transaction and itself
     would make every block meaningless. */
  const a = buildPayment(intent()).fingerprint;
  const b = buildPayment(intent()).fingerprint;
  assert.deepEqual(compareFingerprints(a, b), []);
});

test("the SDK stays inside the transaction layer", () => {
  /*
   * The read adapter added no dependency and refuses XDR; that property is why
   * the whole public surface is plain fetch. The SDK is allowed here and
   * nowhere above.
   */
  const sources = (dir, found = []) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) sources(path, found);
      else if (/\.tsx?$/.test(entry)) found.push(path);
    }
    return found;
  };

  const importers = sources(join(REPO, "lib"))
    .concat(sources(join(REPO, "app")))
    .filter((file) => {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      return /from ["']@stellar\/stellar-sdk["']/.test(code);
    })
    .map((file) => file.slice(REPO.length + 1).replace(/\\/g, "/"));

  for (const file of importers) {
    assert.ok(
      file.startsWith("lib/stellar/transactions/"),
      `${file} imports the Stellar SDK outside the transaction layer`,
    );
  }
  assert.ok(importers.length >= 2, "the transaction layer should be the one that uses it");
});
