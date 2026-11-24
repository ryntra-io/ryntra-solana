// Run from repo root: node --test lib/autopay/autopay.test.mjs
//
// Autopay: the schedule's windows, the one policy the person signs, the transactions they sign, and the
// executor's signer. Every prohibition the independent review names has its own test here, at both layers that hold
// it — the policy's rule as the program reads it (`../mandate/judge.ts`) and the executor's signer reading the message:
//   * another address (and another coin, another source, another program);
//   * a larger sum (and a smaller one — the amount is exact);
//   * more often than the schedule (a second payment in the same window; a window asked early);
//   * after the end (and before the start; a stopped autopay).
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { carePolicyExecuteInstruction, readCarePolicyExecute } from "../care/ssa-care.ts";
import { instructionRefusal } from "../mandate/judge.ts";
import { MAX_TRANSACTION_BYTES, unsignedTransaction, wireSize } from "../mandate/human.ts";
import { SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, ssaAddress } from "../mandate/ssa.ts";
import { PAYMENT_COMPUTE_UNITS, PAYMENT_UNIT_PRICE_MAX, paymentInstructions, paymentTransfer, planAutopayEnable, planAutopayStop } from "./enable.ts";
import { eventOf } from "./events.ts";
import { AUTOPAY_VAULT_FIRST, NATIVE_LIMIT_MINT, USDC_MINT, autopayPolicy, autopayRefusal, landingOf, paymentConstraint, paymentLimit, policyCarriesTerms } from "./policy.ts";
import { autopayOf, doneWindows, paidOf, recordFrom, recordOf } from "./record.ts";
import { COUNT_MAX, PAYMENT_MIN, PERIOD_SECONDS, amountOf, countUntil, dueAt, endsAt, formatAmount, missedBefore, networkOf, scheduleIssue, standingAt, totalOf, windowAt } from "./schedule.ts";
import { AutopaySignerRefused, autopaySigner, paymentRefusal, scheduleRefusal } from "./signer.server.ts";
import { autopayGate, autopayMinute, carriesPolicyCreate, chainRefusal, submitAutopay } from "./service.server.ts";
import { AutopayUnavailable, autopayStore, readAutopayEvents } from "./store.server.ts";
import { settingsAccount } from "./testing/chain.mjs";

const key = () => Keypair.generate().publicKey;
const human = key();
const agentKeypair = Keypair.generate();
const agent = agentKeypair.publicKey;
const friend = key();
const attacker = key();
const START = 1_800_000_000n;
const DAY = PERIOD_SECONDS.day;
const settings = ssaAddress.settings(42n);
const vaultIndex = AUTOPAY_VAULT_FIRST;
const vault = ssaAddress.vault(settings, vaultIndex);
const NO_FACTS = new Map();

function termsFor(coin = "SOL", extra = {}) {
  return {
    network: "devnet",
    human,
    agent,
    recipient: friend,
    schedule: { coin, amount: coin === "SOL" ? 50_000_000n : 25_000_000n, every: "week", count: 4, startAt: START, ...extra },
  };
}

function autopayFor(coin = "SOL", extra = {}) {
  const terms = termsFor(coin, extra);
  return { terms, settings, vaultIndex, vault, policy: ssaAddress.policy(settings, 3n), policySeed: 3n };
}

const present = { kind: "present", settings, state: { signers: [{ key: human, permissions: 7 }], threshold: 1, timeLock: 0, policySeed: 2n } };

/** The executor's payment message, as the executor builds it — or with the inner transfer swapped. */
function paymentMessage(autopay, inner = paymentTransfer(autopay), extra = []) {
  const execution = carePolicyExecuteInstruction({ policy: autopay.policy, signer: agent, instructions: [inner], constraintIndices: [0], accountIndex: autopay.vaultIndex });
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: PAYMENT_COMPUTE_UNITS }), ...extra, execution];
  return unsignedTransaction(agent, instructions, PublicKey.default.toBase58()).message.serialize();
}

const due = (window, nowSeconds, fields = {}) => ({ window, nowSeconds, status: "working", done: new Set(), ...fields });

/* ------------------------------------------------------------------ schedule */

test("the schedule: windows of the period from the start, one payment each, ended after the last", () => {
  const schedule = termsFor().schedule;
  const week = PERIOD_SECONDS.week;
  assert.equal(dueAt(schedule, 0), START);
  assert.equal(dueAt(schedule, 3), START + 3n * week);
  assert.equal(endsAt(schedule), START + 4n * week);
  assert.equal(totalOf(schedule), 200_000_000n, "the signature moves every payment, no more");
  assert.equal(networkOf(schedule), 40_000n);
  assert.equal(windowAt(schedule, START - 1n), null);
  assert.equal(windowAt(schedule, START), 0);
  assert.equal(windowAt(schedule, START + week - 1n), 0);
  assert.equal(windowAt(schedule, START + week), 1);
  assert.equal(windowAt(schedule, endsAt(schedule)), null);
  assert.deepEqual(standingAt(schedule, START - 10n, new Set()), { kind: "wait", at: START });
  assert.deepEqual(standingAt(schedule, START + 5n, new Set()), { kind: "due", window: 0 });
  assert.deepEqual(standingAt(schedule, START + 5n, new Set([0])), { kind: "wait", at: START + week });
  assert.deepEqual(standingAt(schedule, START + 3n * week + 5n, new Set([3])), { kind: "ended" });
  assert.deepEqual(standingAt(schedule, endsAt(schedule), new Set()), { kind: "ended" });
  assert.deepEqual(missedBefore(3, new Set([0, 2])), [1]);
  assert.equal(countUntil({ every: "day", startAt: START }, START + 9n * DAY), 10);
  assert.equal(countUntil({ every: "day", startAt: START }, START - 1n), 1);
  assert.equal(countUntil({ every: "day", startAt: START }, START + 10_000n * DAY), COUNT_MAX);
});

test("the schedule's bounds are technical — no ceiling on money", () => {
  const ok = termsFor().schedule;
  assert.equal(scheduleIssue(ok, START), null);
  assert.equal(scheduleIssue({ ...ok, amount: 10n ** 15n }, START), null, "a thousand thousand SOL a week is the person's to choose");
  assert.equal(scheduleIssue({ ...ok, amount: PAYMENT_MIN.SOL - 1n }, START), "amount", "under the network's rent minimum");
  assert.equal(scheduleIssue({ ...ok, coin: "USDC", amount: PAYMENT_MIN.USDC - 1n }, START), "amount");
  assert.equal(scheduleIssue({ ...ok, count: 0 }, START), "count");
  assert.equal(scheduleIssue({ ...ok, count: COUNT_MAX + 1 }, START), "count");
  assert.equal(scheduleIssue({ ...ok, every: "hour" }, START), "every");
  assert.equal(scheduleIssue({ ...ok, coin: "BONK" }, START), "coin");
  assert.equal(scheduleIssue({ ...ok, startAt: START - 7_200n }, START), "start");
  assert.equal(scheduleIssue({ ...ok, every: "month", count: 400 }, START), "term");
  assert.equal(scheduleIssue({ ...ok, amount: 2n ** 63n, count: 4 }, START), "tooLarge");
  assert.equal(amountOf("0.05", "SOL"), 50_000_000n);
  assert.equal(amountOf("25", "USDC"), 25_000_000n);
  assert.equal(amountOf("0.0000001", "USDC"), null, "more places than the coin has are refused, never rounded");
  assert.equal(amountOf("0", "SOL"), null);
  assert.equal(amountOf("1e3", "SOL"), null);
  assert.equal(formatAmount(50_000_000n, "SOL"), "0.05");
  assert.equal(formatAmount(25_000_000n, "USDC"), "25");
});

/* ------------------------------------------------------------------ the policy */

test("the policy: one rule, one limit, on the autopay's own vault — never vault 0 or a care's", () => {
  const terms = termsFor();
  const policy = autopayPolicy(terms, { vault, vaultIndex });
  assert.equal(policy.accountIndex, vaultIndex);
  assert.equal(policy.constraints.length, 1);
  assert.equal(policy.spendingLimits.length, 1);
  const [limit] = policy.spendingLimits;
  assert.ok(limit.mint.equals(NATIVE_LIMIT_MINT));
  assert.equal(limit.maxPerPeriod, terms.schedule.amount, "one payment's sum per window");
  assert.deepEqual(limit.period, { customSeconds: PERIOD_SECONDS.week });
  assert.equal(limit.start, START);
  assert.equal(limit.expiration, endsAt(terms.schedule));
  assert.throws(() => autopayPolicy(terms, { vault: ssaAddress.vault(settings, 0), vaultIndex: 0 }), /vault 128 to 255/);
  assert.throws(() => autopayPolicy(terms, { vault: ssaAddress.vault(settings, 1), vaultIndex: 1 }), /vault 128 to 255/);
  const usdc = paymentLimit(termsFor("USDC"));
  assert.ok(usdc.mint.equals(USDC_MINT.devnet));
});

test("the terms: never the person, never the executor", () => {
  assert.equal(autopayRefusal(termsFor(), START), null);
  assert.match(autopayRefusal({ ...termsFor(), recipient: human }, START), /someone else/);
  assert.match(autopayRefusal({ ...termsFor(), recipient: agent }, START), /executor/);
  assert.match(autopayRefusal({ ...termsFor(), agent: human }, START), /not the person's wallet/);
  assert.match(autopayRefusal({ ...termsFor(), recipient: PublicKey.default }, START), /person's address/);
});

for (const coin of ["SOL", "USDC"]) {
  test(`${coin}: the rule lets exactly the payment through, and nothing else`, () => {
    const autopay = autopayFor(coin);
    const rule = paymentConstraint(autopay.terms, vault);
    const read = (instruction) => instructionRefusal({ programId: instruction.programId, accounts: instruction.keys.map((k) => k.pubkey), data: Uint8Array.from(instruction.data) }, rule, NO_FACTS);
    const amount = autopay.terms.schedule.amount;
    const mint = USDC_MINT.devnet;
    const vaultUsdc = getAssociatedTokenAddressSync(mint, vault, true);
    const transfer = (to, value) =>
      coin === "SOL" ? SystemProgram.transfer({ fromPubkey: vault, toPubkey: to, lamports: value }) : createTransferCheckedInstruction(vaultUsdc, mint, getAssociatedTokenAddressSync(mint, to, true), vault, value, 6, [], TOKEN_PROGRAM_ID);

    assert.equal(read(paymentTransfer(autopay)), null, "the payment itself");
    // Another address.
    assert.match(read(transfer(attacker, amount)), /not a pinned one/);
    // A larger sum, and a smaller one: the amount is exact.
    assert.match(read(transfer(friend, amount + 1n)), /breaks equals/);
    assert.match(read(transfer(friend, amount * 2n)), /breaks equals/);
    assert.match(read(transfer(friend, amount - 1n)), /breaks equals/);
    if (coin === "USDC") {
      // Another coin's account, the recipient's account of another mint, a source that is not the vault's.
      const other = key();
      assert.match(read(createTransferCheckedInstruction(getAssociatedTokenAddressSync(other, vault, true), other, getAssociatedTokenAddressSync(other, friend, true), vault, amount, 6)), /not a pinned one/);
      assert.match(read(createTransferCheckedInstruction(vaultUsdc, mint, getAssociatedTokenAddressSync(mint, friend, true), vault, amount, 9)), /breaks equals/, "the decimals are pinned");
      assert.match(read(createTransferCheckedInstruction(vaultUsdc, mint, friend, vault, amount, 6)), /not a pinned one/, "the recipient's wallet is not their USDC account");
    } else {
      // A transfer from anyone but the vault, or a System instruction other than Transfer.
      assert.match(read(SystemProgram.transfer({ fromPubkey: attacker, toPubkey: friend, lamports: amount })), /not a pinned one/);
      assert.match(read(SystemProgram.assign({ accountPubkey: vault, programId: attacker })), /./);
    }
    // Another program altogether.
    assert.match(read({ programId: TOKEN_PROGRAM_ID === rule.programId ? SystemProgram.programId : TOKEN_PROGRAM_ID, keys: [], data: Buffer.alloc(12) }), /outside the mandate/);
  });
}

test("the chain's policy carries the record's terms, or the book does not keep it", () => {
  const autopay = autopayFor("USDC");
  const plan = planAutopayEnable({ terms: autopay.terms, account: present, vaultIndex, nowSeconds: START });
  const create = plan.transactions.flat().find((ix) => ix.programId.equals(SSA_PROGRAM_ID));
  assert.equal(policyCarriesTerms(create.data, autopay.terms), true);
  assert.equal(policyCarriesTerms(create.data, { ...autopay.terms, recipient: attacker }), false);
  assert.equal(policyCarriesTerms(create.data, { ...autopay.terms, schedule: { ...autopay.terms.schedule, amount: 26_000_000n } }), false);
});

/* ------------------------------------------------------------------ what the person signs */

for (const coin of ["SOL", "USDC"]) {
  test(`${coin}: turning it on is one approval — the vault funded with every payment, the executor's fees, the policy`, () => {
    const terms = termsFor(coin);
    const plan = planAutopayEnable({ terms, account: present, vaultIndex, nowSeconds: START });
    assert.ok(plan.autopay.vault.equals(vault));
    assert.ok(plan.autopay.policy.equals(ssaAddress.policy(settings, 3n)), "the next policy of the person's account");
    assert.equal(plan.fund, totalOf(terms.schedule));
    for (const instructions of plan.transactions) assert.ok(wireSize(unsignedTransaction(human, instructions, PublicKey.default.toBase58())) <= MAX_TRANSACTION_BYTES);
    const all = plan.transactions.flat();
    const programs = new Set(all.map((ix) => ix.programId.toBase58()));
    for (const program of programs) assert.ok([SystemProgram.programId.toBase58(), SSA_PROGRAM_ID.toBase58(), TOKEN_PROGRAM_ID.toBase58(), "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"].includes(program), program);
    if (coin === "USDC") assert.ok(all.some((ix) => ix.keys.some((k) => k.pubkey.equals(landingOf(terms)))), "the recipient's USDC account is opened once");
    assert.ok(all.some((ix) => ix.programId.equals(SystemProgram.programId) && ix.keys[1]?.pubkey.equals(agent)), "the executor's network fees");
    const fresh = planAutopayEnable({ terms, account: { kind: "absent", config: { smartAccountIndex: 41n, creationFee: 0n, treasury: key() } }, vaultIndex, nowSeconds: START });
    assert.ok(fresh.autopay.settings.equals(settings), "a new smart account when there is none");
    assert.throws(() => planAutopayEnable({ terms, account: present, vaultIndex: 0, nowSeconds: START }), /vault 128 to 255/);
    assert.throws(() => planAutopayEnable({ terms: { ...terms, recipient: human }, account: present, vaultIndex, nowSeconds: START }), /someone else/);
    assert.throws(
      () => planAutopayEnable({ terms, account: { ...present, state: { ...present.state, threshold: 2 } }, vaultIndex, nowSeconds: START }),
      /alone controls/,
    );
  });

  test(`${coin}: stop is one transaction — the policy removed and the rest back to the person`, () => {
    const autopay = autopayFor(coin);
    const balance = coin === "SOL" ? { lamports: 150_000_000n, usdc: 0n, usdcAccountOpen: false } : { lamports: 0n, usdc: 75_000_000n, usdcAccountOpen: true };
    const stop = planAutopayStop(autopay, balance);
    assert.ok(stop[0].programId.equals(SSA_PROGRAM_ID), "the policy goes first");
    assert.ok(wireSize(unsignedTransaction(human, stop, PublicKey.default.toBase58())) <= MAX_TRANSACTION_BYTES);
    const execute = stop.at(-1);
    const view = (() => {
      const data = Buffer.from(execute.data);
      return { accountIndex: data[8] };
    })();
    assert.equal(view.accountIndex, vaultIndex, "the person takes back from the autopay's own vault");
    assert.ok(execute.keys[2].pubkey.equals(human) && execute.keys[2].isSigner, "as the settings signer, with no policy and no executor");
    const ended = planAutopayStop(autopay, balance, { policyLive: false });
    assert.ok(!ended[0].programId.equals(SSA_PROGRAM_ID) || ended.length === 1, "an ended policy is not removed twice");
    assert.deepEqual(planAutopayStop(autopay, { lamports: 0n, usdc: 0n, usdcAccountOpen: false }, { policyLive: false }), []);
  });
}

/* ------------------------------------------------------------------ the executor's signer */

for (const coin of ["SOL", "USDC"]) {
  test(`${coin}: the executor signs the payment of the window due now, and nothing else`, () => {
    const autopay = autopayFor(coin);
    const amount = autopay.terms.schedule.amount;
    const week = PERIOD_SECONDS.week;
    const mint = USDC_MINT.devnet;
    const vaultUsdc = getAssociatedTokenAddressSync(mint, vault, true);
    const transfer = (to, value) =>
      coin === "SOL" ? SystemProgram.transfer({ fromPubkey: vault, toPubkey: to, lamports: value }) : createTransferCheckedInstruction(vaultUsdc, mint, getAssociatedTokenAddressSync(mint, to, true), vault, value, 6, [], TOKEN_PROGRAM_ID);
    const message = paymentMessage(autopay);
    assert.equal(paymentRefusal(message, autopay, due(0, START + 60n)), null, "the payment of the open window");
    assert.equal(paymentRefusal(message, autopay, due(2, START + 2n * week + 1n)), null);

    // Another address.
    assert.match(paymentRefusal(paymentMessage(autopay, transfer(attacker, amount)), autopay, due(0, START)), /breaks the autopay's rule/);
    // A larger sum.
    assert.match(paymentRefusal(paymentMessage(autopay, transfer(friend, amount + 1n)), autopay, due(0, START)), /breaks the autopay's rule/);
    // More often than the schedule: the same window again, a window asked before it opens.
    assert.match(paymentRefusal(message, autopay, due(0, START + 60n, { done: new Set([0]) })), /made already/);
    assert.match(paymentRefusal(message, autopay, due(1, START + 60n)), /not the one due now/);
    // After the end, before the start, once stopped.
    assert.match(paymentRefusal(message, autopay, due(3, endsAt(autopay.terms.schedule))), /ended/);
    assert.match(paymentRefusal(message, autopay, due(4, endsAt(autopay.terms.schedule) + week)), /ended/);
    assert.match(paymentRefusal(message, autopay, due(0, START - 1n)), /not due yet/);
    assert.match(paymentRefusal(message, autopay, due(0, START, { status: "stopped" })), /not working/);

    // The transaction's shape: who pays, who signs, what else rides along.
    const otherPayer = unsignedTransaction(attacker, [carePolicyExecuteInstruction({ policy: autopay.policy, signer: agent, instructions: [paymentTransfer(autopay)], constraintIndices: [0], accountIndex: vaultIndex })], PublicKey.default.toBase58());
    assert.match(paymentRefusal(otherPayer.message.serialize(), autopay, due(0, START)), /signers other than the executor|does not pay/);
    assert.match(paymentRefusal(paymentMessage(autopay, paymentTransfer(autopay), [SystemProgram.transfer({ fromPubkey: agent, toPubkey: attacker, lamports: 1n })]), autopay, due(0, START)), /outside the payment/);
    assert.match(paymentRefusal(paymentMessage(autopay, paymentTransfer(autopay), [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PAYMENT_UNIT_PRICE_MAX + 1n })]), autopay, due(0, START)), /compute budget/);
    const twice = unsignedTransaction(agent, [...paymentInstructions(autopay), paymentInstructions(autopay).at(-1)], PublicKey.default.toBase58());
    assert.match(paymentRefusal(twice.message.serialize(), autopay, due(0, START)), /not exactly one payment/);
    const otherVault = { ...autopay, vaultIndex: vaultIndex + 1 };
    assert.match(paymentRefusal(paymentMessage(otherVault), autopay, due(0, START)), /another vault/);
    const otherPolicy = { ...autopay, policy: ssaAddress.policy(settings, 9n) };
    assert.match(paymentRefusal(paymentMessage(otherPolicy), autopay, due(0, START)), /not this autopay's/);
    assert.match(paymentRefusal(Uint8Array.of(1, 2, 3), autopay, due(0, START)), /not a transaction message/);
  });
}

test("the executor's payment reads back as one transfer through the autopay's policy, within the packet", () => {
  const autopay = autopayFor("USDC");
  const instructions = paymentInstructions(autopay, 10n ** 9n);
  const tx = unsignedTransaction(agent, instructions, PublicKey.default.toBase58());
  assert.ok(wireSize(tx) <= MAX_TRANSACTION_BYTES);
  const execution = instructions.at(-1);
  const view = readCarePolicyExecute({ programId: execution.programId, keys: execution.keys.map((k) => k.pubkey), data: execution.data });
  assert.equal(view.accountIndex, vaultIndex);
  assert.deepEqual(view.constraintIndices, [0]);
  assert.equal(view.instructions.length, 1);
  assert.equal(paymentRefusal(tx.message.serialize(), autopay, due(0, START)), null, "the unit price is clamped to the ceiling");
});

test("the signer: no journal row, no signature; a refusal is journaled and thrown", async () => {
  const autopay = autopayFor("SOL");
  const rows = [];
  const keySigner = { mode: "env", keyRef: null, sign: async (message) => (await import("node:crypto")).sign(null, Buffer.from(message), (await import("node:crypto")).createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(agentKeypair.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" })) };
  const signer = autopaySigner(keySigner, { autopay, journal: async (row) => void rows.push(row) });
  const signature = await signer.signMessage(paymentMessage(autopay), due(0, START + 1n));
  assert.equal(signature.length, 64);
  assert.equal(rows.at(-1).outcome, "SIGNED");
  await assert.rejects(signer.signMessage(paymentMessage(autopay), due(0, START + 1n, { done: new Set([0]) })), AutopaySignerRefused);
  assert.equal(rows.at(-1).outcome, "REFUSED");
  const noJournal = autopaySigner(keySigner, { autopay, journal: async () => { throw new Error("down"); } });
  await assert.rejects(noJournal.signMessage(paymentMessage(autopay), due(0, START + 1n)), /down/);
  const wrongKey = autopaySigner({ ...keySigner, sign: async () => new Uint8Array(64) }, { autopay, journal: async () => undefined });
  await assert.rejects(wrongKey.signMessage(paymentMessage(autopay), due(0, START + 1n)), /does not verify/);
  assert.equal(scheduleRefusal(autopay, due(0, START)), null);
});

/* ------------------------------------------------------------------ the record, the book, the gate */

test("a record reads back to the same terms, and a forged one does not", () => {
  const autopay = autopayFor("USDC");
  const record = recordFrom({ id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", autopay, label: "Landlord", at: "2026-11-20T12:00:00.000Z" });
  const read = recordOf(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(read, record);
  const back = autopayOf(read);
  assert.ok(back.vault.equals(vault) && back.policy.equals(autopay.policy));
  assert.equal(back.terms.schedule.amount, autopay.terms.schedule.amount);
  assert.equal(autopayOf({ ...record, vault: key().toBase58() }), null, "a vault that is not the account's");
  assert.equal(autopayOf({ ...record, endsAt: record.endsAt + 1 }), null, "an end the schedule does not make");
  assert.equal(recordOf({ ...record, vaultIndex: 0 }), null, "vault 0 is the agent's budget");
  assert.equal(recordOf({ ...record, amount: "0" }), null);
  assert.equal(recordOf({ ...record, label: "x".repeat(65) }).label, null, "a name longer than a contact's is not kept");
  const paid = { ...record, payments: [{ window: 0, state: "paid", signature: null, at: "" }, { window: 1, state: "missed", signature: null, at: "" }, { window: 2, state: "sending", signature: null, at: "" }] };
  assert.deepEqual([...doneWindows(paid)].sort(), [0, 2]);
  assert.deepEqual(paidOf(paid), { count: 1, total: 25_000_000n });
});

test("submit: the signed transactions must carry this draft's policy", () => {
  const autopay = autopayFor("SOL");
  const plan = planAutopayEnable({ terms: autopay.terms, account: present, vaultIndex, nowSeconds: START });
  const wire = plan.transactions.map((ixs) => Buffer.from(unsignedTransaction(human, ixs, PublicKey.default.toBase58()).serialize()).toString("base64"));
  assert.equal(carriesPolicyCreate(wire, plan.autopay), true);
  const louder = { ...plan.autopay, terms: { ...plan.autopay.terms, schedule: { ...plan.autopay.terms.schedule, amount: 60_000_000n } } };
  assert.equal(carriesPolicyCreate(wire, louder), false, "a draft whose numbers the signed policy does not hold");
  const elsewhere = { ...plan.autopay, terms: { ...plan.autopay.terms, recipient: attacker } };
  assert.equal(carriesPolicyCreate(wire, elsewhere), false);
});

test("submit refuses a draft for another wallet or another executor before anything is sent", async () => {
  const gate = { open: true, network: "devnet", agent };
  const autopay = autopayFor("SOL");
  const record = recordFrom({ id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", autopay, label: null, at: "2026-11-20T12:00:00.000Z" });
  const never = { getAccountInfo: async () => assert.fail("nothing is read"), sendRawTransaction: async () => assert.fail("nothing is sent") };
  const other = await submitAutopay({ owner: attacker.toBase58(), draft: record, transactions: ["AA=="] }, gate, { connection: never });
  assert.equal(other.ok, false);
  const otherAgent = await submitAutopay({ owner: human.toBase58(), draft: record, transactions: ["AA=="] }, { ...gate, agent: key() }, { connection: never });
  assert.equal(otherAgent.ok, false);
  const unsigned = await submitAutopay({ owner: human.toBase58(), draft: record, transactions: ["AA=="] }, gate, { connection: never });
  assert.deepEqual([unsigned.ok, unsigned.code], [false, "REFUSED"]);
});

test("the chain check reads the policy's head and its bytes", async () => {
  const autopay = autopayFor("SOL");
  const ours = settingsAccount([human]);
  const chain = (policy) => ({ getAccountInfo: async (address) => (address.equals(autopay.settings) ? ours : policy) });
  assert.equal(await chainRefusal(autopay, chain(null)), "no such autopay on chain");
  assert.equal(await chainRefusal(autopay, chain({ owner: SystemProgram.programId, data: Buffer.alloc(0) })), "no such autopay on chain");
  assert.equal(await chainRefusal(autopay, chain({ owner: SSA_PROGRAM_ID, data: Buffer.alloc(80) })), "not an autopay");
});

test("the gate: closed unless the switch names a network and the executor is known; mainnet takes the registry's only", () => {
  assert.deepEqual(autopayGate({}), { open: false });
  assert.deepEqual(autopayGate({ RYNTRA_AUTOPAY: "devnet" }), { open: false });
  assert.deepEqual(autopayGate({ RYNTRA_AUTOPAY: "yes", RYNTRA_AUTOPAY_AGENT: agent.toBase58() }), { open: false });
  const open = autopayGate({ RYNTRA_AUTOPAY: "devnet", RYNTRA_AUTOPAY_AGENT: agent.toBase58() });
  assert.equal(open.open, true);
  assert.ok(open.agent.equals(agent));
  const mainnet = autopayGate({ RYNTRA_AUTOPAY: "mainnet", RYNTRA_AUTOPAY_AGENT: key().toBase58() });
  assert.deepEqual(mainnet, { open: false }, "on mainnet a named executor must be the registry's");
});

test("the executor's pass sits still when closed, keyless or without a durable store", async () => {
  assert.deepEqual(await autopayMinute({}), { ran: false, why: "closed" });
  const env = { RYNTRA_AUTOPAY: "devnet", RYNTRA_AUTOPAY_AGENT: agent.toBase58() };
  assert.deepEqual(await autopayMinute(env, { key: null }), { ran: false, why: "no-key" });
  assert.deepEqual(await autopayMinute(env, { key: { mode: "env", keyRef: null, sign: async () => new Uint8Array(64) }, guard: { durability: "EPHEMERAL_SINGLE_INSTANCE" } }), { ran: false, why: "store" });
});

test("the store: a function that is not there is a book that did not answer; events read back for the drive", async () => {
  const silent = autopayStore(async () => ({ ok: false, error: "rpc autopay_list failed" }));
  await assert.rejects(silent.list("devnet", human.toBase58()), AutopayUnavailable);
  const calls = [];
  const store = autopayStore(async (fn, args) => {
    calls.push([fn, args]);
    if (fn === "autopay_claim") return { ok: true, data: args.p_window === 0 ? { ok: true, claimed: true, attempt: 1 } : { ok: true, claimed: false } };
    if (fn === "autopay_events") return { ok: true, data: { ok: true, events: [{ id: 7, network: "devnet", kind: "paid", autopayId: "x", owner: human.toBase58(), recipient: friend.toBase58(), label: "Mom", coin: "SOL", amount: "50000000", window: 0, signature: null, at: "2026-11-20T12:00:00.000Z" }, { id: 0 }] } };
    return { ok: true, data: { ok: true } };
  });
  assert.equal(await store.claim("devnet", "id", 0, 120), 1, "the claim names its attempt");
  assert.equal(await store.claim("devnet", "id", 1, 120), null, "a window claimed before is not claimed again");
  const events = await readAutopayEvents("devnet", -5, 10_000, store);
  assert.equal(events.length, 1);
  assert.deepEqual(calls.at(-1), ["autopay_events", { p_network: "devnet", p_after: 0, p_limit: 500 }]);
  assert.equal(eventOf({ id: 1 }), null);
});
