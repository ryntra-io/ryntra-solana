// Run from repo root: node --test terminal/money/autopay/autopay-view.test.mjs
//
// «Autopay» on screen: the form's numbers, the check of the engine's answer before the wallet opens, the
// transactions read from their own bytes, and how a row reads.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { planAutopayEnable, planAutopayStop } from "../../../lib/autopay/enable.ts";
import { AUTOPAY_VAULT_FIRST } from "../../../lib/autopay/policy.ts";
import { recordFrom } from "../../../lib/autopay/record.ts";
import { PERIOD_SECONDS } from "../../../lib/autopay/schedule.ts";
import { unsignedTransaction } from "../../../lib/mandate/human.ts";
import { ssaAddress } from "../../../lib/mandate/ssa.ts";
import { checkAutopayUnsigned, chainOf, dayOf, defaultUntil, listOf, planOf, reviewMatches, reviewOf, rowOf, untilOf, whoOf } from "./autopay-view.ts";

const human = Keypair.generate().publicKey;
const agent = Keypair.generate().publicKey;
const friend = Keypair.generate().publicKey;
const NOW = 1_800_000_000n;
const settings = ssaAddress.settings(7n);
const present = { kind: "present", settings, state: { signers: [{ key: human, permissions: 7 }], threshold: 1, timeLock: 0, policySeed: 0n } };

const form = (fields = {}) => ({ to: friend.toBase58(), coin: "SOL", amount: "0.05", every: "week", until: dayOf(NOW + 11n * PERIOD_SECONDS.week), ...fields });

test("the form: payments from now to the date, the total one signature moves, the executor's fee, the last day", () => {
  const plan = planOf(form(), NOW);
  assert.equal(plan.count, 12);
  assert.equal(plan.amount, 50_000_000n);
  assert.equal(plan.total, 600_000_000n);
  assert.equal(plan.network, 120_000n);
  assert.equal(plan.lastAt, NOW + 11n * PERIOD_SECONDS.week);
  assert.equal(planOf(form({ amount: "abc" }), NOW), null);
  assert.equal(planOf(form({ until: "yesterday" }), NOW), null);
  assert.equal(planOf(form({ until: dayOf(NOW - 2n * 86_400n) }), NOW), null, "a date in the past");
  assert.equal(planOf(form({ until: dayOf(NOW) }), NOW).count, 1, "until today — one payment, now");
  assert.equal(untilOf("2026-12-01"), BigInt(Date.parse("2026-12-01T23:59:59Z") / 1000));
  assert.equal(untilOf("12/01/2026"), null);
  assert.equal(defaultUntil("day", NOW), dayOf(NOW + 29n * 86_400n));
  assert.equal(chainOf("devnet"), "solana:devnet");
  assert.equal(chainOf("mainnet"), "solana:mainnet");
});

test("the wallet is asked only for the numbers the form showed", () => {
  const plan = planOf(form(), NOW);
  const terms = { network: "devnet", human, agent, recipient: friend, schedule: { coin: "SOL", amount: plan.amount, every: "week", count: plan.count, startAt: NOW } };
  const built = planAutopayEnable({ terms, account: present, vaultIndex: AUTOPAY_VAULT_FIRST, nowSeconds: NOW });
  const draft = recordFrom({ id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", autopay: built.autopay, label: null, at: "2026-11-20T12:00:00.000Z" });
  const wire = built.transactions.map((ixs) => Buffer.from(unsignedTransaction(human, ixs, PublicKey.default.toBase58()).serialize()).toString("base64"));
  const review = reviewOf({ draft, transactions: wire, fund: built.fund.toString(), network: built.network.toString(), recipient: friend.toBase58() });
  const input = { owner: human.toBase58(), coin: "SOL", every: "week", plan, address: friend.toBase58() };
  assert.equal(reviewMatches(review, input), true);
  assert.equal(reviewMatches(review, { ...input, owner: agent.toBase58() }), false, "another wallet");
  assert.equal(reviewMatches(review, { ...input, address: agent.toBase58() }), false, "another recipient than typed");
  assert.equal(reviewMatches({ ...review, fund: (built.fund + 1n).toString() }, input), false, "a larger total");
  assert.equal(reviewMatches(review, { ...input, plan: { ...plan, count: plan.count + 1 } }), false, "more payments");
  assert.equal(reviewMatches(review, { ...input, every: "day" }), false, "more often");
  assert.equal(reviewMatches(review, { ...input, address: null }), true, "a .skr name: the engine says where it points");
  assert.equal(reviewOf({ draft: {}, transactions: [] }), null);

  assert.equal(checkAutopayUnsigned(wire, human.toBase58()), true, "the person pays and signs alone, known programs only");
  assert.equal(checkAutopayUnsigned(wire, agent.toBase58()), false);
  const stray = Buffer.from(unsignedTransaction(human, [SystemProgram.transfer({ fromPubkey: human, toPubkey: agent, lamports: 1n })], PublicKey.default.toBase58()).serialize()).toString("base64");
  assert.equal(checkAutopayUnsigned([stray], human.toBase58()), false, "no smart account's instruction — not an autopay");
  const stop = Buffer.from(unsignedTransaction(human, planAutopayStop(built.autopay, { lamports: 10n, usdc: 0n, usdcAccountOpen: false }), PublicKey.default.toBase58()).serialize()).toString("base64");
  assert.equal(checkAutopayUnsigned([stop], human.toBase58()), true);
  assert.equal(checkAutopayUnsigned(["not base64!"], human.toBase58()), false);
});

test("a row: paid so far, the next payment, the state and its tone", () => {
  const terms = { network: "devnet", human, agent, recipient: friend, schedule: { coin: "USDC", amount: 25_000_000n, every: "month", count: 6, startAt: NOW } };
  const built = planAutopayEnable({ terms, account: present, vaultIndex: AUTOPAY_VAULT_FIRST, nowSeconds: NOW });
  const record = recordFrom({ id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", autopay: built.autopay, label: "Landlord", at: "2026-11-20T12:00:00.000Z" });
  const month = PERIOD_SECONDS.month;
  const paid = { ...record, payments: [{ window: 0, state: "paid", signature: null, at: "" }] };
  assert.deepEqual(rowOf(paid, NOW + 10n), { paid: 1, of: 6, next: NOW + month, state: "working", tone: "ok" });
  assert.deepEqual(rowOf(record, NOW + 10n), { paid: 0, of: 6, next: NOW, state: "working", tone: "ok" }, "due now");
  const missed = { ...record, payments: [{ window: 0, state: "missed", signature: null, at: "" }] };
  assert.equal(rowOf(missed, NOW + month + 5n).state, "lastFailed");
  assert.equal(rowOf({ ...record, status: "stopped" }, NOW).state, "stopped");
  assert.equal(rowOf(record, NOW + 6n * month).state, "ended", "past the last window");
  assert.equal(whoOf(record), "Landlord");
  assert.equal(whoOf({ ...record, label: null }), `${friend.toBase58().slice(0, 4)}…${friend.toBase58().slice(-4)}`);
  assert.deepEqual(listOf(200, { address: human.toBase58(), autopays: [record, { id: 1 }] }, human.toBase58()).autopays.length, 1);
  assert.deepEqual(listOf(401, null, human.toBase58()), { state: "locked" });
  assert.deepEqual(listOf(200, { address: agent.toBase58(), autopays: [] }, human.toBase58()), { state: "locked" });
});
