// Run from repo root: node --test lib/autopay/runner.test.mjs
//
// The executor's pass, after the independent review of 21.11: payments must never quietly vanish. Each
// scenario the review names has its test here, against a book that keeps the database's rules
// (`supabase/migrations/20261121090000_contacts_autopay_v1.sql`, proved on PostgreSQL by
// `scripts/autopay/migration-check.sql`) and a chain that answers as told:
//   * 500 autopays that start in years never hold up the one due now (the queue is the book's, by `next_at`);
//   * a pass killed after its claim, before or after signing — the window is paid later, once;
//   * a 429 or a cut network before signing — retried in the same window, never «failed»;
//   * a payment sent but not yet seen — read back by its signature, given back only once its blockhash is past;
//   * the pass's budget is kept between autopays;
//   * someone else's policy is never written into a wallet's book; the vaults of other policies are never an autopay's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Keypair, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";

import { unsignedTransaction } from "../mandate/human.ts";
import { ssaAddress } from "../mandate/ssa.ts";
import { planAutopayEnable } from "./enable.ts";
import { AUTOPAY_VAULT_FIRST, policyVaultIndex } from "./policy.ts";
import { recordFrom } from "./record.ts";
import { PERIOD_SECONDS, dueAt, endsAt } from "./schedule.ts";
import { PASS, autopayMinute, carriesFunding, carriesPolicyCreate, chainRefusal, policyVaults, retrySeconds, submitAutopay } from "./service.server.ts";
import { contactsOpen } from "../contacts/service.server.ts";
import { memoryBook } from "./testing/book.mjs";
import { policyAccount, settingsAccount } from "./testing/chain.mjs";

const key = () => Keypair.generate().publicKey;
const human = key();
const agentKeypair = Keypair.generate();
const agent = agentKeypair.publicKey;
const friend = key();
const DAY = PERIOD_SECONDS.day;
const T0 = 1_800_000_000n;
const settings = ssaAddress.settings(42n);
const DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const ENV = { RYNTRA_AUTOPAY: "devnet", RYNTRA_AUTOPAY_AGENT: agent.toBase58() };
const GUARD = { durability: "DURABLE_MULTI_WRITER", collection: () => ({ insertIfAbsent: async () => true }) };

const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(agentKeypair.secretKey.subarray(0, 32))]);
const KEY = {
  mode: "env",
  keyRef: null,
  sign: async (message) => {
    const crypto = await import("node:crypto");
    return crypto.sign(null, Buffer.from(message), crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }));
  },
};

let ids = 0;
/** An autopay record: daily, `count` payments, the first at `startAt`. */
function recordAt(startAt, count = 5, seed = 3n) {
  const vaultIndex = AUTOPAY_VAULT_FIRST;
  const terms = { network: "devnet", human, agent, recipient: friend, schedule: { coin: "SOL", amount: 2_000_000n, every: "day", count, startAt } };
  const autopay = { terms, settings, vaultIndex, vault: ssaAddress.vault(settings, vaultIndex), policy: ssaAddress.policy(settings, seed), policySeed: seed };
  ids += 1;
  return recordFrom({ id: `1b4e28ba-2fa1-41d2-883f-${String(ids).padStart(12, "0")}`, autopay, label: null, at: "2026-11-21T00:00:00.000Z" });
}

/** The chain: what each call answers is the test's to say. */
function fakeChain(over = {}) {
  const sent = [];
  const landed = new Map();
  const chain = {
    sent,
    landed,
    height: 1_000,
    getGenesisHash: async () => DEVNET,
    getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: chain.height + 150 }),
    getBlockHeight: async () => chain.height,
    sendRawTransaction: async (wire) => {
      const tx = VersionedTransaction.deserialize(wire);
      sent.push(tx);
      return "sig";
    },
    getTransaction: async (signature) => (landed.has(signature) ? { meta: { err: landed.get(signature) ? null : { InstructionError: [0, "x"] }, logMessages: [], computeUnitsConsumed: 1, fee: 5000 } } : null),
    ...over,
  };
  return chain;
}

const sigOf = (tx) => (async () => (await import("@solana/kit")).getBase58Decoder().decode(tx.signatures[0]))();

/** The pass at chain time `seconds` (the wall clock the same moment), with no real pauses. */
function passAt(seconds, store, connection, extra = {}) {
  const at = Number(seconds) * 1000;
  return autopayMinute(ENV, { key: KEY, guard: GUARD, store, connection, now: () => at, clock: extra.clock ?? (() => at), sleep: async () => undefined, log: () => undefined, ...extra });
}

/* ------------------------------------------------------------------ the queue */

test("500 cheap autopays that start in years never hold up the one due now", async () => {
  const now = T0 + 3n * DAY + 60n;
  const future = Array.from({ length: 500 }, () => recordAt(T0 + 3n * 365n * DAY, 3));
  const due = recordAt(T0, 5);
  const store = memoryBook(() => Number(now) * 1000, [...future, due]);
  const chain = fakeChain({ getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 5000 } }) });
  const answer = await passAt(now, store, chain);
  assert.deepEqual(answer.lines, [{ id: due.id, did: "paid" }], "only the due autopay is taken, and it is paid");
  assert.deepEqual(store.calls[0], ["due", PASS.batch, PASS.holdSeconds], "the pass asks the book for what is due, not for the oldest");
  assert.equal(chain.sent.length, 1);
  const migration = readFileSync("supabase/migrations/20261121090000_contacts_autopay_v1.sql", "utf8");
  assert.match(migration, /create index autopays_due_idx on private\.autopays \(network, next_at\) where next_at is not null;/);
  assert.match(migration, /x\.next_at <= v_now\s+order by x\.next_at, x\.id/, "the database's queue: due only, the earliest first");
  assert.doesNotMatch(migration, /autopay_working|order by x\.created_at limit 500/, "no queue by age is left");
});

test("one window, one payment: the next pass waits, the window after it is paid, the windows never reached are missed, then the end", async () => {
  const record = recordAt(T0, 4);
  let now = T0 + 30n;
  const store = memoryBook(() => Number(now) * 1000, [record]);
  const chain = fakeChain({ getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 5000 } }) });
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "paid" }]);
  now += 60n;
  assert.deepEqual((await passAt(now, store, chain)).lines, [], "a paid window: the autopay is not even due");
  now = T0 + 2n * DAY + 5n;
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "paid" }]);
  assert.deepEqual(store.event.filter(([kind]) => kind === "missed").map(([, w]) => w), [1], "window 1 was never reached — said once, as missed");
  now = endsAt(record_schedule(record)) + 10n;
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "ended" }]);
  assert.deepEqual(store.event.filter(([kind]) => kind === "missed").map(([, w]) => w), [1, 3], "the last window never reached is said before the end");
  assert.equal(chain.sent.length, 2, "two windows, two payments, never more");
});

function record_schedule(record) {
  return { every: record.every, startAt: BigInt(record.startAt), count: record.count };
}

test("the opening second of a window: the program renews the allowance only after it, so the executor waits a few seconds", async () => {
  const record = recordAt(T0, 3);
  let now = T0 + 30n;
  const store = memoryBook(() => Number(now) * 1000, [record]);
  const chain = fakeChain({ getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 5000 } }) });
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "paid" }]);
  const claims = () => store.calls.filter(([kind]) => kind === "claim").length;
  for (const offset of [0n, 1n, BigInt(PASS.openMarginSeconds) - 1n]) {
    now = T0 + DAY + offset;
    assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "waited" }], `${offset} s after the window opened: not yet`);
    store.rows.get(record.id).nextAt = Number(now) * 1000;
  }
  assert.equal(claims(), 1, "no claim is taken in the opening seconds");
  now = T0 + DAY + BigInt(PASS.openMarginSeconds);
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "paid" }], "past the margin: paid, in the same window");
  assert.equal(chain.sent.length, 2);
});

test("the chain's clock not answering: the pass goes by the wall clock and waits longer past a window's opening", async () => {
  const record = recordAt(T0, 3);
  let wall = Number(T0 + BigInt(PASS.openMarginWallSeconds)) * 1000;
  const store = memoryBook(() => wall, [record]);
  const chain = fakeChain({
    getSlot: async () => Promise.reject(new Error("429")),
    getBlockTime: async () => Promise.reject(new Error("429")),
    getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 5000 } }),
  });
  const pass = () => autopayMinute(ENV, { key: KEY, guard: GUARD, store, connection: chain, clock: () => wall, sleep: async () => undefined, log: () => undefined });
  assert.deepEqual((await pass()).lines, [{ id: record.id, did: "paid" }], "window 0, past the wall-clock margin");
  wall = Number(T0 + DAY + BigInt(PASS.openMarginSeconds) + 10n) * 1000;
  assert.deepEqual((await pass()).lines, [{ id: record.id, did: "waited" }], "the chain's margin is not enough by the wall clock");
  store.rows.get(record.id).nextAt = wall;
  wall = Number(T0 + DAY + BigInt(PASS.openMarginWallSeconds)) * 1000;
  assert.deepEqual((await pass()).lines, [{ id: record.id, did: "paid" }]);
  assert.equal(chain.sent.length, 2);
});

/* ------------------------------------------------------------------ a pass killed */

test("a pass killed after its claim, before signing: the claim lapses and the window is paid by a later pass, once", async () => {
  const record = recordAt(T0, 3);
  let now = T0 + 10n;
  const store = memoryBook(() => Number(now) * 1000, [record]);
  // The pass dies right after the claim: the claim is in the book, nothing signed, nothing sent.
  assert.equal(await store.claim("devnet", record.id, 0, PASS.claimSeconds), 1);
  const chain = fakeChain({ getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 5000 } }) });
  now += 60n;
  assert.deepEqual((await passAt(now, store, chain)).lines, [], "a live claim is held: the autopay is not due until it lapses");
  now += BigInt(PASS.claimSeconds);
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "paid" }], "the lapsed claim is claimed again and paid");
  assert.equal(store.rows.get(record.id).payments.get(0).attempts, 2);
  assert.equal(chain.sent.length, 1);
});

test("a pass killed after signing, before reading back: the signature is read on chain — paid, never sent again", async () => {
  const record = recordAt(T0, 3);
  let now = T0 + 10n;
  const store = memoryBook(() => Number(now) * 1000, [record]);
  const chain = fakeChain();
  // The first pass sends and the function is killed before it reads anything back (no time left to read).
  const first = await passAt(now, store, chain, { pass: { readAfterMs: 10 ** 9 } });
  assert.deepEqual(first.lines, [{ id: record.id, did: "sent" }]);
  const row = store.rows.get(record.id).payments.get(0);
  assert.equal(row.state, "sending");
  assert.equal(row.signature, await sigOf(chain.sent[0]), "the signature was in the book before the payment left");
  assert.ok(row.validHeight > 0);
  chain.landed.set(row.signature, true);
  now += 60n;
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "waited" }], "read back and settled; the window is done");
  assert.equal(store.rows.get(record.id).payments.get(0).state, "paid");
  assert.equal(chain.sent.length, 1, "never sent again");
});

test("a signature the chain never saw is given back only once its blockhash is past — then tried again in the same window", async () => {
  const record = recordAt(T0, 3);
  let now = T0 + 10n;
  const store = memoryBook(() => Number(now) * 1000, [record]);
  const chain = fakeChain({ sendRawTransaction: async () => Promise.reject(new Error("fetch failed")) });
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "sent" }], "a cut connection is «sent, maybe»");
  const signature = store.rows.get(record.id).payments.get(0).signature;
  now += 60n;
  chain.height += 100;
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "waited" }], "absent, but its blockhash may still land it: wait");
  assert.equal(store.rows.get(record.id).payments.get(0).signature, signature);
  now += BigInt(PASS.holdSeconds);
  chain.height += 200;
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "waited" }], "past its blockhash: given back, the pause first");
  const back = store.rows.get(record.id).payments.get(0);
  assert.equal(back.signature, null);
  assert.equal(back.state, "sending");
  assert.ok(store.calls.some(([fn, , by]) => fn === "release" && by.signature === signature), "released by its own signature");
  // The next try lands.
  const sent = [];
  chain.sendRawTransaction = async (wire) => void sent.push(VersionedTransaction.deserialize(wire));
  chain.getTransaction = async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 5000 } });
  now += BigInt(retrySeconds(1)) + 1n;
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "paid" }]);
  assert.equal(sent.length, 1);
});

test("a signature given back after its window closed is missed — never paid in the next window", async () => {
  const record = recordAt(T0, 3);
  let now = T0 + DAY - 30n;
  const store = memoryBook(() => Number(now) * 1000, [record]);
  const chain = fakeChain({ sendRawTransaction: async () => Promise.reject(new Error("timeout")) });
  await passAt(now, store, chain);
  now = T0 + DAY + 120n;
  chain.height += 1_000;
  chain.sendRawTransaction = async (wire) => void chain.sent.push(VersionedTransaction.deserialize(wire));
  chain.getTransaction = async (signature) => (signature === store.rows.get(record.id).payments.get(1)?.signature ? { meta: { err: null, logMessages: [] } } : null);
  const answer = await passAt(now, store, chain);
  assert.equal(store.rows.get(record.id).payments.get(0).state, "missed", "window 0 closed with nothing landed: missed");
  assert.deepEqual(answer.lines, [{ id: record.id, did: "paid" }], "window 1 is paid as its own");
  assert.equal(chain.sent.length, 1);
});

/* ------------------------------------------------------------------ passing failures */

for (const [what, over] of [
  ["a 429 on the blockhash", { getLatestBlockhash: async () => Promise.reject(Object.assign(new Error("429 Too Many Requests"), { code: 429 })) }],
  ["a cut network on the blockhash", { getLatestBlockhash: async () => Promise.reject(new TypeError("fetch failed")) }],
  ["a blockhash that never answers", { getLatestBlockhash: () => new Promise(() => undefined) }],
]) {
  test(`${what}: the window goes back after a pause and is paid in the same window — never «failed»`, async () => {
    const record = recordAt(T0, 3);
    let now = T0 + 10n;
    const store = memoryBook(() => Number(now) * 1000, [record]);
    const chain = fakeChain({ ...over, getTransaction: async () => ({ meta: { err: null, logMessages: [] } }) });
    const first = await passAt(now, store, chain);
    assert.deepEqual(first.lines, [{ id: record.id, did: "retry" }]);
    const row = store.rows.get(record.id).payments.get(0);
    assert.equal(row.state, "sending", "not failed");
    assert.ok(store.calls.some(([fn, , by, retry]) => fn === "release" && by.attempt === 1 && retry === retrySeconds(1)));
    assert.ok(!store.event.some(([kind]) => kind === "failed"));
    now += 10n;
    assert.deepEqual((await passAt(now, store, chain)).lines, [], "not before the pause");
    delete chain.getLatestBlockhash;
    chain.getLatestBlockhash = fakeChain().getLatestBlockhash;
    now += BigInt(retrySeconds(1));
    assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "paid" }]);
    assert.equal(store.rows.get(record.id).payments.get(0).attempts, 2);
  });
}

test("the key or the journal not answering is a passing failure too; the pause grows with each attempt", async () => {
  assert.deepEqual([1, 2, 3, 6, 20].map(retrySeconds), [30, 60, 120, 900, 900]);
  const record = recordAt(T0, 3);
  const now = T0 + 10n;
  const store = memoryBook(() => Number(now) * 1000, [record]);
  const chain = fakeChain();
  const answer = await passAt(now, store, chain, { key: { ...KEY, sign: async () => Promise.reject(new Error("KMS unavailable")) } });
  assert.deepEqual(answer.lines, [{ id: record.id, did: "retry" }]);
  const journalDown = memoryBook(() => Number(now) * 1000, [recordAt(T0, 3)]);
  const down = await passAt(now, journalDown, chain, { guard: { durability: "DURABLE_MULTI_WRITER", collection: () => ({ insertIfAbsent: async () => Promise.reject(new Error("down")) }) } });
  assert.equal(down.lines[0].did, "retry");
  assert.equal(chain.sent.length, 0, "nothing signed leaves");
});

test("the book not taking the signature: nothing is sent; another attempt holding the window: nothing is sent", async () => {
  const record = recordAt(T0, 3);
  const now = T0 + 10n;
  const chain = fakeChain();
  const store = memoryBook(() => Number(now) * 1000, [record]);
  store.sign = async () => Promise.reject(new Error("rpc autopay_sign failed"));
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "retry" }]);
  const fenced = memoryBook(() => Number(now) * 1000, [recordAt(T0, 3)]);
  fenced.sign = async () => false;
  assert.deepEqual((await passAt(now, fenced, chain)).lines.map((line) => line.did), ["claimed-before"]);
  assert.equal(chain.sent.length, 0);
});

test("only the program's own refusal is final: «failed» for the window, with its signature", async () => {
  const record = recordAt(T0, 3);
  const now = T0 + 10n;
  const store = memoryBook(() => Number(now) * 1000, [record]);
  const refusal = Object.assign(new Error("Simulation failed"), { logs: ["Program SMRT invoke [1]", "Program log: AnchorError occurred. Error Code: ProgramInteractionInsufficientLamportAllowance.", "Program SMRT failed: custom program error: 0x1"] });
  const chain = fakeChain({ sendRawTransaction: async () => Promise.reject(refusal) });
  assert.deepEqual((await passAt(now, store, chain)).lines, [{ id: record.id, did: "failed" }]);
  const row = store.rows.get(record.id).payments.get(0);
  assert.equal(row.state, "failed");
  assert.ok(row.signature);
  // A preflight error with no program in it (no fee SOL, a stale blockhash) is not a refusal: read back, then given back.
  const other = memoryBook(() => Number(now) * 1000, [recordAt(T0, 3)]);
  const noLogs = fakeChain({ sendRawTransaction: async () => Promise.reject(Object.assign(new Error("Attempt to debit an account but found no record of a prior credit."), { logs: [] })) });
  assert.equal((await passAt(now, other, noLogs)).lines[0].did, "sent");
});

/* ------------------------------------------------------------------ the budget */

test("the budget is kept between autopays: no turn begins without a whole turn's time left", async () => {
  const records = Array.from({ length: 6 }, () => recordAt(T0, 3));
  const at = Number(T0 + 10n) * 1000;
  let wall = at;
  const store = memoryBook(() => wall, records);
  const chain = fakeChain({
    getTransaction: async () => ({ meta: { err: null, logMessages: [] } }),
    sendRawTransaction: async (wire) => {
      wall += 9_000; // a slow network: each payment takes nine seconds
      chain.sent.push(VersionedTransaction.deserialize(wire));
    },
  });
  const answer = await passAt(T0 + 10n, store, chain, { clock: () => wall });
  const did = answer.lines.map((line) => line.did);
  assert.equal(did.length, 6);
  assert.ok(did.includes("later"), `some autopays wait for the next pass: ${did}`);
  assert.ok(wall - at <= PASS.budgetMs, "the pass ends inside its budget");
  assert.equal(chain.sent.length, did.filter((d) => d !== "later").length);
  // The ones left come back: the next pass pays them.
  wall += PASS.holdSeconds * 1000;
  const next = await passAt(T0 + 10n + BigInt(PASS.holdSeconds), store, chain, { clock: () => wall });
  assert.ok(next.lines.some((line) => line.did === "paid" || line.did === "sent"));
});

test("the cron: every minute in vercel.json, behind CRON_SECRET, the pass only — and nothing runs while the switch is off", async () => {
  const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons;
  assert.ok(crons.some((row) => row.path === "/api/cron/autopay" && row.schedule === "* * * * *"));
  const route = readFileSync("app/api/cron/autopay/route.ts", "utf8");
  assert.match(route, /decideBearerAuth\(.*process\.env\.CRON_SECRET\)/s);
  assert.match(route, /autopayMinute\(process\.env\)/);
  assert.match(route, /export const maxDuration = 60;/);
  assert.ok(PASS.budgetMs + 10_000 <= 60_000, "the pass's budget leaves room inside the route's 60 s");
  assert.deepEqual(await autopayMinute({}), { ran: false, why: "closed" });
  assert.deepEqual(await autopayMinute({ RYNTRA_AUTOPAY: "off", RYNTRA_AUTOPAY_AGENT: agent.toBase58() }), { ran: false, why: "closed" });
});

/* ------------------------------------------------------------------ someone else's policy */

test("someone else's smart account: its policy is never written into a wallet's book", async () => {
  const record = recordAt(T0, 3);
  const { autopayOf } = await import("./record.ts");
  const autopay = autopayOf(record);
  const policyData = (() => {
    const plan = planAutopayEnable({ terms: autopay.terms, account: { kind: "present", settings, state: { signers: [{ key: human, permissions: 7 }], threshold: 1, timeLock: 0, policySeed: 2n } }, vaultIndex: AUTOPAY_VAULT_FIRST, nowSeconds: T0 });
    return { plan, data: Buffer.concat([policyAccount({ settings, seed: 3n, signer: agent, accountIndex: AUTOPAY_VAULT_FIRST }).data, plan.transactions.flat().at(-1).data]) };
  })();
  const chainFor = (settingsAccountData) => ({
    getAccountInfo: async (address) => (address.equals(settings) ? settingsAccountData : address.equals(autopay.policy) ? { owner: policyAccount({ settings, seed: 3n, signer: agent, accountIndex: 128 }).owner, data: policyData.data } : null),
  });
  assert.equal(await chainRefusal(autopay, chainFor(settingsAccount([human]))), null, "the person's own account and policy");
  assert.equal(await chainRefusal(autopay, chainFor(settingsAccount([key()]))), "the smart account is not the person's alone", "another wallet's account");
  assert.equal(await chainRefusal(autopay, chainFor(settingsAccount([human, key()], { threshold: 2 }))), "the smart account is not the person's alone");
  assert.equal(await chainRefusal(autopay, chainFor(null)), "no such smart account on chain");

  // The same policy bytes under someone else's settings, or with another wallet signing, do not carry this autopay.
  const { plan } = policyData;
  const wire = (instructions, payer = human) => Buffer.from(unsignedTransaction(payer, instructions, PublicKey.default.toBase58()).serialize()).toString("base64");
  assert.equal(carriesPolicyCreate(plan.transactions.map((ixs) => wire(ixs)), plan.autopay), true);
  const create = plan.transactions.flat().at(-1);
  const elsewhere = { ...create, keys: create.keys.map((meta, i) => (i === 0 ? { ...meta, pubkey: key() } : meta)) };
  assert.equal(carriesPolicyCreate([wire([elsewhere])], plan.autopay), false, "another account's settings");
  const stranger = key();
  const signedByOther = { ...create, keys: create.keys.map((meta) => (meta.pubkey.equals(human) ? { ...meta, pubkey: stranger } : meta)) };
  assert.equal(carriesPolicyCreate([wire([signedByOther], stranger)], plan.autopay), false, "another wallet signing the settings");
});

test("submit reads the terms again: a draft that pays the executor or the person is refused before anything is sent", async () => {
  const gate = { open: true, network: "devnet", agent };
  const never = { getAccountInfo: async () => assert.fail("nothing is read"), sendRawTransaction: async () => assert.fail("nothing is sent") };
  const base = recordAt(T0, 3);
  for (const recipient of [agent.toBase58(), human.toBase58(), SystemProgram.programId.toBase58()]) {
    const draft = { ...base, recipient };
    const answer = await submitAutopay({ owner: human.toBase58(), draft, transactions: ["AA=="] }, gate, { connection: never });
    assert.equal(answer.ok, false);
    assert.equal(answer.code, "VALIDATION_ERROR", recipient);
    assert.match(answer.reason, /Not an autopay/);
  }
});

test("submit: signed transactions that leave out the payments or the executor's network fee are refused before anything is sent", async () => {
  const record = recordAt(T0, 3);
  const { autopayOf } = await import("./record.ts");
  const autopay = autopayOf(record);
  const account = { kind: "present", settings, state: { signers: [{ key: human, permissions: 7 }], threshold: 1, timeLock: 0, policySeed: 2n } };
  const plan = planAutopayEnable({ terms: autopay.terms, account, vaultIndex: AUTOPAY_VAULT_FIRST, nowSeconds: T0 });
  const wire = (instructions) => Buffer.from(unsignedTransaction(human, instructions, PublicKey.default.toBase58()).serialize()).toString("base64");
  const all = plan.transactions.flat();
  const isTransfer = (to) => (ix) => ix.programId.equals(SystemProgram.programId) && ix.keys[1]?.pubkey.equals(to);
  assert.equal(carriesFunding([wire(all)], plan.autopay), true, "the review's own transactions");
  const noFund = all.filter((ix) => !isTransfer(plan.autopay.vault)(ix));
  const noFee = all.filter((ix) => !isTransfer(agent)(ix));
  assert.equal(noFund.length, all.length - 1);
  assert.equal(noFee.length, all.length - 1);
  assert.equal(carriesFunding([wire(noFund)], plan.autopay), false, "no payments moved into the vault");
  assert.equal(carriesFunding([wire(noFee)], plan.autopay), false, "no network fee for the executor");
  const short = all.map((ix) => (isTransfer(plan.autopay.vault)(ix) ? SystemProgram.transfer({ fromPubkey: human, toPubkey: plan.autopay.vault, lamports: 1n }) : ix));
  assert.equal(carriesFunding([wire(short)], plan.autopay), false, "one lamport for the whole schedule");
  const draft = recordFrom({ id: record.id, autopay: plan.autopay, label: null, at: "2026-11-21T00:00:00.000Z" });
  const never = { getAccountInfo: async () => assert.fail("nothing is read"), sendRawTransaction: async () => assert.fail("nothing is sent") };
  const answer = await submitAutopay({ owner: human.toBase58(), draft, transactions: [wire(noFee)] }, { open: true, network: "devnet", agent }, { connection: never });
  assert.equal(answer.ok, false);
  assert.equal(answer.code, "REFUSED");
  assert.match(answer.reason, /payments and the network fee/);

  // USDC: the person's USDC account to the vault's, every payment — the review's own transactions pass, without it not.
  const usdcTerms = { ...autopay.terms, schedule: { ...autopay.terms.schedule, coin: "USDC", amount: 1_000_000n } };
  const usdc = planAutopayEnable({ terms: usdcTerms, account, vaultIndex: AUTOPAY_VAULT_FIRST, nowSeconds: T0 });
  const usdcAll = usdc.transactions.flat();
  assert.equal(carriesFunding(usdc.transactions.map((ixs) => wire(ixs)), usdc.autopay), true, "USDC: the review's own transactions");
  const usdcNoFund = usdcAll.filter((ix) => !(ix.programId.equals(usdcAll.find((one) => one.data[0] === 12 && one.keys.length === 4)?.programId ?? PublicKey.default) && ix.data[0] === 12));
  assert.equal(usdcNoFund.length, usdcAll.length - 1, "one TransferChecked moves the USDC in");
  assert.equal(carriesFunding([wire(usdcNoFund)], usdc.autopay), false, "USDC: no payments moved into the vault");
});

/* ------------------------------------------------------------------ vaults */

test("a vault another policy acts on (a pool care counts from 1 up) is never an autopay's", async () => {
  const care = policyAccount({ settings, seed: 1n, signer: agent, accountIndex: 128 });
  assert.equal(policyVaultIndex(care.data), 128);
  assert.equal(policyVaultIndex(policyAccount({ settings, seed: 2n, signer: agent, variant: 1, accountIndex: 129 }).data), null, "another kind of policy");
  assert.equal(policyVaultIndex(Buffer.alloc(120)), null, "not a policy");
  const accounts = new Map([
    [ssaAddress.policy(settings, 1n).toBase58(), policyAccount({ settings, seed: 1n, signer: agent, accountIndex: 1 })],
    [ssaAddress.policy(settings, 2n).toBase58(), policyAccount({ settings, seed: 2n, signer: agent, accountIndex: 128 })],
    [ssaAddress.policy(settings, 4n).toBase58(), policyAccount({ settings, seed: 4n, signer: agent, accountIndex: 130 })],
  ]);
  const asked = [];
  const chain = { getMultipleAccountsInfo: async (keys) => (asked.push(keys.length), keys.map((k) => accounts.get(k.toBase58()) ?? null)) };
  assert.deepEqual([...(await policyVaults(chain, settings, 4n))].sort((a, b) => a - b), [1, 128, 130], "a removed policy (seed 3) holds nothing");
  assert.deepEqual(asked, [4]);
  assert.deepEqual([...(await policyVaults(chain, settings, null))], [], "no policy yet");
});

/* ------------------------------------------------------------------ contacts' switch */

test("contacts: closed on the server unless RYNTRA_CONTACTS is on", () => {
  assert.equal(contactsOpen({}), false);
  assert.equal(contactsOpen({ RYNTRA_CONTACTS: "off" }), false);
  assert.equal(contactsOpen({ NEXT_PUBLIC_RYNTRA_CONTACTS: "1" }), false, "the screen's switch does not open the server");
  for (const on of ["1", "on", "true", " TRUE "]) assert.equal(contactsOpen({ RYNTRA_CONTACTS: on }), true);
  const route = readFileSync("app/api/v1/contacts/route.ts", "utf8");
  assert.equal(route.match(/if \(!contactsOpen\(\)\) return apiFailure\("CAPABILITY_UNAVAILABLE"/g)?.length, 2, "both GET and POST");
});

test("the person is told the network fee stays with the executor; nothing says «everything not paid comes back»", () => {
  const words = readFileSync("terminal/money/autopay/words.ts", "utf8");
  assert.doesNotMatch(words, /everything not yet paid|все, що ще не сплачено/);
  assert.match(words, /stays with the executor/);
  assert.match(words, /лишається виконавцю/);
  assert.doesNotMatch(readFileSync("lib/autopay/service.server.ts", "utf8"), /Ryntra takes no fee/);
  void dueAt;
});
