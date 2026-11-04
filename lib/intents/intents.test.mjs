// Run from repo root: node --test lib/intents/intents.test.mjs
//
// Prepared actions (CITY-161) against the memory store: an intent is frozen (its digest is checked on every read and
// echoed by every step), used once (the wallet's signed bytes mark the claim before they can leave; only a receipt for
// that signature ends it), lives only until its deadline, and never names anything the creator wrote for the person to
// read beyond who prepared it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalJson, intentDigest } from "./digest.ts";
import { CLAIM_LEASE_MS, INTENT_EXPIRY, OPEN_PER_WALLET, PAY_MINTS, originNameRefusal, statusOf, swapLeg } from "./model.ts";
import { cancelIntent, claimIntent, createIntent, hashKey, markIntent, movesFit, readIntent, receiptIntent, releaseIntent } from "./service.ts";
import { MemoryIntentStore } from "./store.ts";
import { intentLinks, projectIntent, publicIntentOrigin } from "./view.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const USDC = PAY_MINTS.USDC;
const SOL = PAY_MINTS.SOL;
const PERSON = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const FRIEND = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
const SIG = "3vZ8sRkd2kN9mEJcVJbW7K1yC6p8oQGJ4fH2Lr9aT5XqBnU8wYeD3sP6mZ1cR4tV7hK9jN2gF5xL8bQ3dW6eA1s";
const SIG2 = "5vZ8sRkd2kN9mEJcVJbW7K1yC6p8oQGJ4fH2Lr9aT5XqBnU8wYeD3sP6mZ1cR4tV7hK9jN2gF5xL8bQ3dW6eA1s";
const T0 = Date.parse("2026-10-31T12:00:00.000Z");

const SWAP = { action: "swap", coin: BONK, side: "buy", pay: "SOL", amountRaw: "250000000" };
const TRANSFER = { action: "transfer", coin: USDC, amountRaw: "25000000", to: FRIEND };
const AGENT = { kind: "agent", name: "Atlas" };

/**
 * Signed bytes as the test's reader sees them: `signed:<payer>:<signature>` stands for bytes that payer signed (the real
 * ed25519 reader is `signed.ts`, tested in `signed.test.mjs`); anything else is not signed.
 */
const signedBy = (payer, signature) => `signed:${payer}:${signature}`;
const readSigned = (wire) => {
  const [tag, feePayer, signature] = String(wire).split(":");
  return tag === "signed" && feePayer && signature ? { ok: true, feePayer, signature } : { ok: false, reason: "not signed" };
};

/** The stand's world: memory, a clock the test moves, ids and keys counted. Transfers open only where a test says so. */
function world({ chain = null, transfers = true } = {}) {
  let now = T0;
  let n = 0;
  const store = new MemoryIntentStore({ now: () => now });
  const deps = {
    store,
    now: () => new Date(now),
    newId: () => `intent${String(++n).padStart(16, "0")}`,
    newKey: () => `key${String(n).padStart(29, "0")}`,
    chain,
    transfers,
    readSigned,
  };
  return { store, deps, advance: (ms) => (now += ms), at: () => now };
}

async function made(w, spec = SWAP, more = {}) {
  const created = await createIntent(w.deps, { spec, origin: AGENT, ...more });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.record;
}

/** Claim, mark with signed bytes, and receipt — the whole person's path. */
async function signAndSend(w, record, wallet = PERSON, signature = SIG) {
  const step = { digest: record.digest, wallet };
  assert.equal((await claimIntent(w.deps, record.body.id, step)).status, "CLAIMED");
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(wallet, signature) })).ok, true);
  return receiptIntent(w.deps, record.body.id, { ...step, signature });
}

test("an intent is made with its frozen fields, their digest and a deadline fifteen minutes on", async () => {
  const w = world();
  const created = await createIntent(w.deps, { spec: SWAP, origin: AGENT });
  const record = created.record;
  // The creator's key is answered once; only its SHA-256 is kept.
  assert.match(created.creatorKey, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(record.creatorKeyHash, hashKey(created.creatorKey));
  assert.equal(JSON.stringify(record).includes(created.creatorKey), false);
  assert.equal(record.body.for, null);
  assert.equal(record.body.id.length, 22);
  assert.equal(record.body.network, "solana:mainnet");
  assert.deepEqual(record.body.spec, SWAP);
  assert.deepEqual(record.body.origin, AGENT);
  assert.equal(record.body.createdAt, new Date(T0).toISOString());
  assert.equal(record.body.expiresAt, new Date(T0 + INTENT_EXPIRY.defaultSeconds * 1000).toISOString());
  assert.equal(record.digest, intentDigest(record.body));
  assert.match(record.digest, /^[0-9a-f]{64}$/);
  assert.equal(statusOf(record, new Date(T0)), "OPEN");
});

test("the digest is canonical: key order never changes it, any field does", async () => {
  const w = world();
  const record = await made(w);
  const reordered = JSON.parse(JSON.stringify({ origin: record.body.origin, spec: record.body.spec, ...record.body }));
  assert.equal(intentDigest(reordered), record.digest);
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  for (const edit of [
    (b) => ({ ...b, spec: { ...b.spec, amountRaw: "250000001" } }),
    (b) => ({ ...b, spec: { ...b.spec, side: "sell" } }),
    (b) => ({ ...b, spec: { ...b.spec, coin: USDC } }),
    (b) => ({ ...b, origin: { ...b.origin, name: "Atlas2" } }),
    (b) => ({ ...b, for: OTHER }),
    (b) => ({ ...b, expiresAt: new Date(T0 + 86_400_000).toISOString() }),
  ]) {
    assert.notEqual(intentDigest(edit(record.body)), record.digest);
  }
});

test("a swap is priced against SOL or USDC: buy spends the pay asset, sell spends the coin", () => {
  assert.deepEqual(swapLeg({ ...SWAP, side: "buy" }), { inputMint: SOL, outputMint: BONK, amountRaw: "250000000" });
  assert.deepEqual(swapLeg({ ...SWAP, side: "sell", pay: "USDC" }), { inputMint: BONK, outputMint: USDC, amountRaw: "250000000" });
});

test("what cannot be an intent is refused before anything is stored", async () => {
  const w = world();
  const cases = [
    [{ ...SWAP, coin: "not-a-mint" }, "VALIDATION_ERROR"],
    [{ ...SWAP, coin: "1111111111111111111111111111111111111111111" }, "VALIDATION_ERROR"],
    [{ ...SWAP, coin: SOL, pay: "SOL" }, "VALIDATION_ERROR"],
    [{ ...SWAP, amountRaw: "0" }, "VALIDATION_ERROR"],
    [{ ...SWAP, amountRaw: "18446744073709551616" }, "VALIDATION_ERROR"],
    [{ ...SWAP, amountRaw: "1.5" }, "VALIDATION_ERROR"],
    [{ ...TRANSFER, to: "x" }, "VALIDATION_ERROR"],
    [{ ...TRANSFER, to: USDC }, "VALIDATION_ERROR"],
  ];
  for (const [spec, code] of cases) {
    const answer = await createIntent(w.deps, { spec, origin: AGENT });
    assert.equal(answer.ok, false, JSON.stringify(spec));
    assert.equal(answer.code, code);
  }
  for (const expiresIn of [59, 86_401, 1.5]) {
    assert.equal((await createIntent(w.deps, { spec: SWAP, origin: AGENT, expiresIn })).code, "VALIDATION_ERROR");
  }
});

test("who prepared it is a plain short name — never a link or an address, never Ryntra's or a wallet's, digits or not", async () => {
  const w = world();
  for (const name of ["https://evil.example", "www.ryntra-io", "evil.com", "jup.ag", "pump.fun", "claim.gg", "a\nb", "two  spaces", " Atlas", "Атлас", "x".repeat(33), ""]) {
    assert.equal(originNameRefusal(name) !== null, true, name);
    assert.equal((await createIntent(w.deps, { spec: SWAP, origin: { kind: "chat", name } })).code, "VALIDATION_ERROR", name);
  }
  for (const name of ["Ryntra", "Ryntra Support", "PHANTOM", "Sol-flare", "Jupiter Bot", "Official Desk", "My Wallet", "Phant0m", "Ryntr4 Supp0rt", "S0lfl4re", "0fficial"]) {
    assert.equal((await createIntent(w.deps, { spec: SWAP, origin: { kind: "partner", name } })).code, "INTENT_ORIGIN_REFUSED", name);
  }
  for (const name of ["Atlas", "Nova", "ChatGPT", "Acme Pay", "desk_7", "a.b-c", "Agent 007"]) assert.equal(originNameRefusal(name), null, name);
});

test("replay: the marked signature's receipt ends the intent, and nothing opens it again", async () => {
  const w = world();
  const record = await made(w, TRANSFER);
  const step = { digest: record.digest, wallet: PERSON };
  const claimed = await claimIntent(w.deps, record.body.id, step);
  assert.equal(claimed.record.claim.wallet, PERSON);
  assert.equal(claimed.record.claim.until, new Date(T0 + CLAIM_LEASE_MS).toISOString());
  assert.equal(claimed.record.claim.signature, null);
  assert.equal((await claimIntent(w.deps, record.body.id, { ...step, wallet: OTHER })).code, "INTENT_BUSY");
  // A receipt before any bytes were marked is not this claim's.
  assert.equal((await receiptIntent(w.deps, record.body.id, { ...step, signature: SIG })).code, "INTENT_RECEIPT_MISMATCH");

  const marked = await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG) });
  assert.equal(marked.record.claim.signature, SIG);
  assert.equal((await receiptIntent(w.deps, record.body.id, { ...step, signature: SIG2 })).code, "INTENT_RECEIPT_MISMATCH");
  assert.equal((await receiptIntent(w.deps, record.body.id, { ...step, wallet: OTHER, signature: SIG })).code, "INTENT_BUSY");

  const done = await receiptIntent(w.deps, record.body.id, { ...step, signature: SIG });
  assert.equal(done.status, "DONE");
  assert.deepEqual(done.record.receipt, { wallet: PERSON, signature: SIG, at: new Date(T0).toISOString(), chain: "UNCHECKED" });
  assert.equal((await receiptIntent(w.deps, record.body.id, { ...step, signature: SIG })).status, "DONE");
  assert.equal((await receiptIntent(w.deps, record.body.id, { ...step, signature: SIG2 })).code, "INTENT_USED");
  for (const wallet of [PERSON, OTHER]) assert.equal((await claimIntent(w.deps, record.body.id, { ...step, wallet })).code, "INTENT_USED");
  assert.equal((await releaseIntent(w.deps, record.body.id, step)).code, "INTENT_USED");
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG2) })).code, "INTENT_USED");
  w.advance(10 * 86_400_000);
  assert.equal((await readIntent(w.deps, record.body.id)).status, "DONE");
});

test("replay after a reload: once bytes are marked, the claim is never let go and the same wallet is told to read them back", async () => {
  const w = world();
  const record = await made(w);
  const step = { digest: record.digest, wallet: PERSON };
  await claimIntent(w.deps, record.body.id, step);
  await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG) });
  assert.equal((await releaseIntent(w.deps, record.body.id, step)).code, "INTENT_SENT");
  // The same wallet pressing again (a reload, another device) gets the mark back, never a fresh claim.
  const again = await claimIntent(w.deps, record.body.id, step);
  assert.equal(again.status, "CLAIMED");
  assert.equal(again.record.claim.signature, SIG);
  assert.equal(projectIntent(again.record, again.status, "https://ryntra.io", { sent: true }).sentSignature, SIG);
  assert.equal(projectIntent(again.record, again.status, "https://ryntra.io").sentSignature, null);
  // Its lease runs out: the intent is final — and that marked signature still receipts it, the bytes left in time.
  w.advance(CLAIM_LEASE_MS);
  assert.equal((await readIntent(w.deps, record.body.id)).status, "LAPSED");
  for (const wallet of [PERSON, OTHER]) assert.equal((await claimIntent(w.deps, record.body.id, { ...step, wallet })).code, "INTENT_USED");
  assert.equal((await receiptIntent(w.deps, record.body.id, { ...step, signature: SIG2 })).code, "INTENT_RECEIPT_MISMATCH");
  assert.equal((await receiptIntent(w.deps, record.body.id, { ...step, signature: SIG })).status, "DONE");
});

test("the mark is the wallet's own: bytes not signed, or signed by another payer, mark nothing", async () => {
  const w = world();
  const record = await made(w);
  const step = { digest: record.digest, wallet: PERSON };
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG) })).code, "INTENT_NOT_CLAIMED");
  await claimIntent(w.deps, record.body.id, step);
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: "AQAB" })).code, "INTENT_SIGNATURE_INVALID");
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(OTHER, SIG) })).code, "INTENT_SIGNATURE_INVALID");
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, wallet: OTHER, signedWireBase64: signedBy(OTHER, SIG) })).code, "INTENT_BUSY");
  assert.equal((await readIntent(w.deps, record.body.id)).record.claim.signature, null);
  // Bytes rebuilt after the engine refused the earlier ones mark it again — only from the mark that press began on.
  await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG) });
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG2) })).code, "INTENT_SENT");
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG2), replaces: SIG2 })).code, "INTENT_SENT");
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG2), replaces: SIG })).record.claim.signature, SIG2);
  // The same bytes again are the same answer.
  assert.equal((await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG2) })).record.claim.signature, SIG2);
});

test("replay: one signature answers one intent", async () => {
  const w = world();
  const first = await made(w, TRANSFER);
  const second = await made(w, TRANSFER);
  assert.equal((await signAndSend(w, first)).status, "DONE");
  const step = { digest: second.digest, wallet: PERSON };
  await claimIntent(w.deps, second.body.id, step);
  await markIntent(w.deps, second.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG) });
  assert.equal((await receiptIntent(w.deps, second.body.id, { ...step, signature: SIG })).code, "INTENT_RECEIPT_MISMATCH");
  assert.equal((await readIntent(w.deps, second.body.id)).status, "CLAIMED");
});

test("a wallet that said no lets the intent go; a claim that runs out unmarked sent nothing and opens it again", async () => {
  const w = world();
  const record = await made(w);
  const step = { digest: record.digest, wallet: PERSON };
  await claimIntent(w.deps, record.body.id, step);
  assert.equal((await releaseIntent(w.deps, record.body.id, { ...step, wallet: OTHER })).code, "INTENT_BUSY");
  const released = await releaseIntent(w.deps, record.body.id, step);
  assert.equal(released.status, "OPEN");
  assert.equal(released.record.claim, null);
  // Another wallet takes it; pressing again never renews the lease, so nobody holds an intent by pressing.
  const taken = await claimIntent(w.deps, record.body.id, { ...step, wallet: OTHER });
  w.advance(60_000);
  assert.equal((await claimIntent(w.deps, record.body.id, { ...step, wallet: OTHER })).record.claim.until, taken.record.claim.until);
  w.advance(CLAIM_LEASE_MS - 60_000);
  // Nothing marked, nothing sent: open again for the rest of its time — a stranger's claim cannot end it.
  assert.equal((await readIntent(w.deps, record.body.id)).status, "OPEN");
  assert.equal((await claimIntent(w.deps, record.body.id, step)).status, "CLAIMED");
});

test("expiry: past its deadline nothing claims it; a claim ends at the deadline, and bytes marked in time still receipt it", async () => {
  const w = world();
  const late = await made(w, SWAP, { expiresIn: 60 });
  const inTime = await made(w, SWAP, { expiresIn: 60 });
  const step = { digest: inTime.digest, wallet: PERSON };
  const claimed = await claimIntent(w.deps, inTime.body.id, step);
  assert.equal(claimed.record.claim.until, inTime.body.expiresAt);
  await markIntent(w.deps, inTime.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG) });
  w.advance(60_000);
  assert.equal((await readIntent(w.deps, late.body.id)).status, "EXPIRED");
  assert.equal((await claimIntent(w.deps, late.body.id, { digest: late.digest, wallet: PERSON })).code, "INTENT_EXPIRED");
  assert.equal((await receiptIntent(w.deps, late.body.id, { digest: late.digest, wallet: PERSON, signature: SIG })).code, "INTENT_NOT_CLAIMED");
  // Marked before the deadline: lapsed now, and its own signature still ends it.
  assert.equal((await readIntent(w.deps, inTime.body.id)).status, "LAPSED");
  assert.equal((await receiptIntent(w.deps, inTime.body.id, { ...step, signature: SIG })).status, "DONE");
  // A claim that ran out unmarked at the deadline leaves it expired; a mark after that is refused.
  const third = await made(w, SWAP, { expiresIn: 60 });
  await claimIntent(w.deps, third.body.id, { digest: third.digest, wallet: PERSON });
  w.advance(60_000);
  assert.equal((await readIntent(w.deps, third.body.id)).status, "EXPIRED");
  assert.equal((await markIntent(w.deps, third.body.id, { digest: third.digest, wallet: PERSON, signedWireBase64: signedBy(PERSON, SIG2) })).code, "INTENT_NOT_CLAIMED");
});

test("tamper: a step names the digest it was shown, and a record changed in storage is refused, not shown", async () => {
  const w = world();
  const record = await made(w, TRANSFER);
  const wrong = "0".repeat(64);
  assert.equal((await claimIntent(w.deps, record.body.id, { digest: wrong, wallet: PERSON })).code, "INTENT_CHANGED");
  assert.equal((await readIntent(w.deps, record.body.id)).record.claim, null);
  // Someone with the database swaps the recipient (or the amount) and leaves the digest.
  w.store.tamper(record.body.id, (r) => ({ ...r, body: { ...r.body, spec: { ...r.body.spec, to: OTHER } } }));
  assert.equal((await readIntent(w.deps, record.body.id)).code, "INTENT_CHANGED");
  assert.equal((await claimIntent(w.deps, record.body.id, { digest: record.digest, wallet: PERSON })).code, "INTENT_CHANGED");
  // …and recomputes the digest too: the sheet's digest no longer matches, so the person's step is refused.
  w.store.tamper(record.body.id, (r) => ({ ...r, digest: intentDigest(r.body) }));
  assert.equal((await readIntent(w.deps, record.body.id)).ok, true);
  assert.equal((await claimIntent(w.deps, record.body.id, { digest: record.digest, wallet: PERSON })).code, "INTENT_CHANGED");
  // A record filed under another id is not this intent.
  const other = await made(w);
  w.store.tamper(other.body.id, (r) => ({ ...r, body: { ...r.body, id: record.body.id } }));
  assert.equal((await readIntent(w.deps, other.body.id)).code, "INTENT_NOT_FOUND");
});

test("a malformed step changes nothing, and an unknown id is not found", async () => {
  const w = world();
  const record = await made(w);
  assert.equal((await claimIntent(w.deps, record.body.id, { digest: "abc", wallet: PERSON })).code, "VALIDATION_ERROR");
  assert.equal((await claimIntent(w.deps, record.body.id, { digest: record.digest, wallet: "nope" })).code, "VALIDATION_ERROR");
  assert.equal((await receiptIntent(w.deps, record.body.id, { digest: record.digest, wallet: PERSON, signature: "short" })).code, "VALIDATION_ERROR");
  assert.equal((await readIntent(w.deps, "../../etc/passwd")).code, "INTENT_NOT_FOUND");
  assert.equal((await readIntent(w.deps, "A".repeat(22))).code, "INTENT_NOT_FOUND");
  assert.equal((await readIntent(w.deps, record.body.id)).record.version, 0);
});

test("two tabs pressing at once: exactly one wallet holds the claim", async () => {
  const w = world();
  const record = await made(w);
  const answers = await Promise.all([PERSON, OTHER].map((wallet) => claimIntent(w.deps, record.body.id, { digest: record.digest, wallet })));
  assert.equal(answers.filter((a) => a.ok).length, 1);
  assert.deepEqual(answers.filter((a) => !a.ok).map((a) => a.code), ["INTENT_BUSY"]);
});

/** A landed transaction as the chain reader says it, for the claiming wallet. */
function landed({ feePayer = PERSON, failed = false, blockTime = T0 / 1000 + 5, lamports = { pre: 5_000_000_000n, post: 4_740_000_000n, fee: 10_000n }, tokens = [[BONK, 0n, 53_000_000n]] } = {}) {
  return { state: "LANDED", feePayer, failed, blockTime, moves: { lamports, tokens: new Map(tokens.map(([mint, pre, post]) => [mint, { pre, post }])) } };
}

test("on chain: a receipt counts only for a transaction after the intent, paid by the wallet, that did what it asks", async () => {
  const reads = new Map();
  const w = world({ chain: async (signature) => reads.get(signature) ?? { state: "UNSEEN" } });
  const record = await made(w);
  const step = { digest: record.digest, wallet: PERSON };
  await claimIntent(w.deps, record.body.id, step);
  await markIntent(w.deps, record.body.id, { ...step, signedWireBase64: signedBy(PERSON, SIG) });
  const send = () => receiptIntent(w.deps, record.body.id, { ...step, signature: SIG });
  assert.equal((await send()).code, "INTENT_RECEIPT_UNSEEN");
  reads.set(SIG, { state: "UNREADABLE" });
  assert.equal((await send()).code, "UNAVAILABLE");
  reads.set(SIG, landed({ feePayer: OTHER }));
  assert.equal((await send()).code, "INTENT_RECEIPT_MISMATCH");
  // An old transaction of the same wallet — before the intent existed — is not this intent's.
  reads.set(SIG, landed({ blockTime: T0 / 1000 - 3600 }));
  assert.equal((await send()).code, "INTENT_RECEIPT_MISMATCH");
  // A transaction that spent less, or brought nothing of the coin, is not this intent's either.
  reads.set(SIG, landed({ lamports: { pre: 5_000_000_000n, post: 4_990_000_000n, fee: 10_000n } }));
  assert.equal((await send()).code, "INTENT_RECEIPT_MISMATCH");
  reads.set(SIG, landed({ tokens: [] }));
  assert.equal((await send()).code, "INTENT_RECEIPT_MISMATCH");
  assert.equal((await readIntent(w.deps, record.body.id)).status, "CLAIMED");
  reads.set(SIG, landed());
  const done = await send();
  assert.equal(done.status, "DONE");
  assert.equal(done.record.receipt.chain, "CONFIRMED");

  const failed = await made(w);
  const third = "4" + SIG.slice(1);
  reads.set(third, landed({ failed: true, tokens: [] }));
  const failedStep = { digest: failed.digest, wallet: PERSON };
  await claimIntent(w.deps, failed.body.id, failedStep);
  await markIntent(w.deps, failed.body.id, { ...failedStep, signedWireBase64: signedBy(PERSON, third) });
  assert.equal((await receiptIntent(w.deps, failed.body.id, { ...failedStep, signature: third })).record.receipt.chain, "FAILED");
});

test("the chain's legs: a sale into USDC spends the coin and brings USDC; a SOL transfer spends its amount", () => {
  const record = (spec) => ({ body: { spec, createdAt: new Date(T0).toISOString() } });
  const sale = record({ action: "swap", coin: BONK, side: "sell", pay: "USDC", amountRaw: "1000" });
  assert.equal(movesFit(sale, PERSON, landed({ lamports: { pre: 10n ** 9n, post: 10n ** 9n - 10_000n, fee: 10_000n }, tokens: [[BONK, 5_000n, 4_000n], [USDC, 0n, 70n]] })), true);
  assert.equal(movesFit(sale, PERSON, landed({ tokens: [[BONK, 5_000n, 4_500n], [USDC, 0n, 70n]] })), false);
  const intoSol = record({ action: "swap", coin: BONK, side: "sell", pay: "SOL", amountRaw: "1000" });
  assert.equal(movesFit(intoSol, PERSON, landed({ lamports: { pre: 10n ** 9n, post: 10n ** 9n + 30_000n, fee: 10_000n }, tokens: [[BONK, 5_000n, 4_000n]] })), true);
  const pay = record({ action: "transfer", coin: "SOL", amountRaw: "1000000", to: FRIEND });
  assert.equal(movesFit(pay, PERSON, landed({ lamports: { pre: 10n ** 9n, post: 10n ** 9n - 1_010_000n, fee: 10_000n }, tokens: [] })), true);
  assert.equal(movesFit(pay, PERSON, landed({ lamports: { pre: 10n ** 9n, post: 10n ** 9n - 510_000n, fee: 10_000n }, tokens: [] })), false);
});

test("a store that cannot answer is UNAVAILABLE, never «not found», and nothing is half-written", async () => {
  const w = world();
  const record = await made(w);
  w.store.down = true;
  assert.equal((await readIntent(w.deps, record.body.id)).code, "UNAVAILABLE");
  assert.equal((await claimIntent(w.deps, record.body.id, { digest: record.digest, wallet: PERSON })).code, "UNAVAILABLE");
  assert.equal((await createIntent(w.deps, { spec: SWAP, origin: AGENT })).code, "UNAVAILABLE");
  w.store.down = false;
  assert.equal((await readIntent(w.deps, record.body.id)).status, "OPEN");
});

test("the served view carries Ryntra's own https links, says who prepared it is unverified, and nothing the creator could point elsewhere", async () => {
  const w = world();
  const record = await made(w);
  const view = projectIntent(record, "OPEN", "https://ryntra.io");
  assert.deepEqual(view.links, { url: `https://ryntra.io/i/${record.body.id}`, qr: `https://ryntra.io/api/v1/intents/${record.body.id}/qr` });
  assert.equal(JSON.stringify(view).includes("ryntra://"), false);
  assert.deepEqual(view.origin, { kind: "agent", name: "Atlas", verified: false });
  assert.equal(view.claimedUntil, null);
  assert.deepEqual(Object.keys(view).sort(), ["claimedUntil", "createdAt", "digest", "expiresAt", "for", "id", "links", "network", "origin", "receipt", "sentSignature", "spec", "status"]);
  assert.deepEqual(intentLinks("abc", "http://localhost:3000").url, "http://localhost:3000/i/abc");
  assert.equal(publicIntentOrigin({}), "https://ryntra.io");
  assert.equal(publicIntentOrigin({ RYNTRA_PUBLIC_ORIGIN: "http://localhost:3000/" }), "http://localhost:3000");
  for (const bad of ["javascript:alert(1)", "https://ryntra.io/evil?x=1", "ftp://ryntra.io", "https://user:pw@ryntra.io", "http://ryntra.io", "http://evil.example"]) {
    assert.equal(publicIntentOrigin({ RYNTRA_PUBLIC_ORIGIN: bad }), "https://ryntra.io", bad);
  }
});

test("a busy stand forgets intents a day past their end before it refuses a new one", async () => {
  let now = T0;
  const store = new MemoryIntentStore({ now: () => now, limit: 2 });
  let n = 0;
  const deps = { store, now: () => new Date(now), newId: () => `memory${String(++n).padStart(16, "0")}`, newKey: () => "k".repeat(32), chain: null, transfers: false, readSigned };
  assert.equal((await createIntent(deps, { spec: SWAP, origin: AGENT, expiresIn: 60 })).ok, true);
  assert.equal((await createIntent(deps, { spec: SWAP, origin: AGENT, expiresIn: 60 })).ok, true);
  assert.equal((await createIntent(deps, { spec: SWAP, origin: AGENT })).code, "UNAVAILABLE");
  now += 2 * 86_400_000;
  assert.equal((await createIntent(deps, { spec: SWAP, origin: AGENT })).ok, true);
});

test("phase 1: a transfer to another address from an outside client is closed unless the deployment opens it", async () => {
  const closed = world({ transfers: false });
  const refused = await createIntent(closed.deps, { spec: TRANSFER, origin: AGENT });
  assert.equal(refused.code, "INTENT_ACTION_CLOSED");
  assert.equal(await closed.store.read("intent0000000000000001"), null);
  assert.equal((await createIntent(closed.deps, { spec: SWAP, origin: AGENT })).ok, true);
});

test("a bound intent: only the wallet it is for can confirm it — another wallet is refused before anything changes", async () => {
  const w = world();
  const created = await createIntent(w.deps, { spec: SWAP, origin: AGENT, for: PERSON });
  const record = created.record;
  assert.equal(record.body.for, PERSON);
  for (const step of [claimIntent, releaseIntent]) assert.equal((await step(w.deps, record.body.id, { digest: record.digest, wallet: OTHER })).code, "INTENT_WRONG_WALLET");
  assert.equal((await receiptIntent(w.deps, record.body.id, { digest: record.digest, wallet: OTHER, signature: SIG })).code, "INTENT_WRONG_WALLET");
  assert.equal((await markIntent(w.deps, record.body.id, { digest: record.digest, wallet: OTHER, signedWireBase64: signedBy(OTHER, SIG) })).code, "INTENT_WRONG_WALLET");
  assert.equal((await readIntent(w.deps, record.body.id)).record.version, 0);
  assert.equal((await claimIntent(w.deps, record.body.id, { digest: record.digest, wallet: PERSON })).status, "CLAIMED");
  // `for` is a frozen field: changing it in storage breaks the digest.
  w.store.tamper(record.body.id, (r) => ({ ...r, body: { ...r.body, for: OTHER } }));
  assert.equal((await readIntent(w.deps, record.body.id)).code, "INTENT_CHANGED");
  assert.equal((await createIntent(w.deps, { spec: SWAP, origin: AGENT, for: "nope" })).code, "VALIDATION_ERROR");
});

test("one wallet holds at most twenty open intents; an ended one frees its place", async () => {
  const w = world();
  const first = await createIntent(w.deps, { spec: SWAP, origin: AGENT, for: PERSON, expiresIn: 60 });
  for (let i = 1; i < OPEN_PER_WALLET; i += 1) assert.equal((await createIntent(w.deps, { spec: SWAP, origin: AGENT, for: PERSON })).ok, true);
  assert.equal((await createIntent(w.deps, { spec: SWAP, origin: AGENT, for: PERSON })).code, "INTENT_LIMIT");
  assert.equal((await createIntent(w.deps, { spec: SWAP, origin: AGENT, for: OTHER })).ok, true);
  assert.equal((await createIntent(w.deps, { spec: SWAP, origin: AGENT })).ok, true);
  w.advance(60_000);
  assert.equal((await readIntent(w.deps, first.record.body.id)).status, "EXPIRED");
  assert.equal((await createIntent(w.deps, { spec: SWAP, origin: AGENT, for: PERSON })).ok, true);
});

test("the receipt is the creator's: read with its key; anyone else with the link sees only where it stands", async () => {
  const w = world();
  const created = await createIntent(w.deps, { spec: TRANSFER, origin: AGENT });
  const { record, creatorKey } = created;
  await signAndSend(w, record);
  const stranger = await readIntent(w.deps, record.body.id);
  assert.equal(stranger.status, "DONE");
  assert.equal(stranger.creator, false);
  assert.equal(projectIntent(stranger.record, stranger.status, "https://ryntra.io", { receipt: stranger.creator }).receipt, null);
  assert.equal((await readIntent(w.deps, record.body.id, "x".repeat(32))).creator, false);
  const creator = await readIntent(w.deps, record.body.id, creatorKey);
  assert.equal(creator.creator, true);
  assert.equal(projectIntent(creator.record, creator.status, "https://ryntra.io", { receipt: creator.creator }).receipt.signature, SIG);
});

test("its creator withdraws an open intent with the key; the link then never opens, and a claim in progress is not cut", async () => {
  const w = world();
  const { record, creatorKey } = await createIntent(w.deps, { spec: SWAP, origin: AGENT });
  assert.equal((await cancelIntent(w.deps, record.body.id, null)).code, "INTENT_KEY_INVALID");
  assert.equal((await cancelIntent(w.deps, record.body.id, "y".repeat(32))).code, "INTENT_KEY_INVALID");
  const cancelled = await cancelIntent(w.deps, record.body.id, creatorKey);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal((await cancelIntent(w.deps, record.body.id, creatorKey)).status, "CANCELLED");
  for (const step of [claimIntent, releaseIntent]) assert.equal((await step(w.deps, record.body.id, { digest: record.digest, wallet: PERSON })).code, "INTENT_CANCELLED");
  assert.equal((await receiptIntent(w.deps, record.body.id, { digest: record.digest, wallet: PERSON, signature: SIG })).code, "INTENT_CANCELLED");

  const busy = await createIntent(w.deps, { spec: SWAP, origin: AGENT });
  await claimIntent(w.deps, busy.record.body.id, { digest: busy.record.digest, wallet: PERSON });
  assert.equal((await cancelIntent(w.deps, busy.record.body.id, busy.creatorKey)).code, "INTENT_BUSY");
  await markIntent(w.deps, busy.record.body.id, { digest: busy.record.digest, wallet: PERSON, signedWireBase64: signedBy(PERSON, SIG2) });
  await receiptIntent(w.deps, busy.record.body.id, { digest: busy.record.digest, wallet: PERSON, signature: SIG2 });
  assert.equal((await cancelIntent(w.deps, busy.record.body.id, busy.creatorKey)).code, "INTENT_USED");
});
