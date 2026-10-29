// Run from repo root: node --test lib/assistant/credits-ai12.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getProgramDerivedAddress } from "@solana/kit";

import { createMemoryGuardStore } from "../guard/store.ts";
import { listPaymentRequestsByWallet, readPaymentRequest, readRequestIdByReference } from "../pay/store.ts";
import { accountHolder, mergeHolders, readBalance, readEntries, walletHolder, grantCredits } from "./credits/ledger.ts";
import { orderView, purchaseView } from "./credits/order-view.ts";
import {
  CREDIT_PACKAGES,
  creditsForPaid,
  listOrders,
  openOrder,
  ORDER_TTL_MS,
  ORDERS_PER_HOUR,
  orderStatus,
  packageOf,
  readOrder,
  settleOrder,
  sweepOrders,
  treasuryFrom,
  PURCHASE_ENV,
} from "./credits/purchase.ts";
import { standChain, standChainOn, STAND_CHAIN_ENV } from "./credits/purchase.server.ts";

/**
 * AI-12 «Купівля кредитів за USDC»: an order is paid to the treasury under its
 * own reference and credited once — whatever repeats, races, foreign tokens,
 * short or long payments and a silent RPC do. The chain is the test's hand.
 */

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TREASURY = "HFyXAjx2PqNb6VwmaFAGCv3ZeEvpHxKAkQEHkomswA4J";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const ACCOUNT = "4b1c2d3e-0000-4000-8000-00000000abcd";
const holder = walletHolder(WALLET);

let sigSeed = 0;
/** A distinct base58 signature of 88 characters. */
function sig() {
  sigSeed += 1;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = sigSeed * 7919 + 104729;
  let out = "";
  for (let i = 0; i < 88; i += 1) {
    out += alphabet[n % 58];
    n = Math.floor(n / 58) + i * 31 + sigSeed;
  }
  return out;
}

const usdc = (amount) => String(Math.round(amount * 1_000_000));

/** A chain the test writes: payments by reference, and a switch to make the read fail. */
function chain() {
  const byReference = new Map();
  const state = { calls: 0, fail: false };
  return {
    state,
    pay(order, payment) {
      const list = byReference.get(order.reference) ?? [];
      list.push({ signature: payment.signature ?? sig(), creditedRaw: payment.raw, mint: "mint" in payment ? payment.mint : USDC, payer: OTHER, blockTime: new Date(NOW + 60_000).toISOString() });
      byReference.set(order.reference, list);
      return list.at(-1).signature;
    },
    /** One transaction carrying two references: the same signature under both. */
    payBoth(first, second, raw) {
      const signature = sig();
      for (const order of [first, second]) this.pay(order, { signature, raw });
      return signature;
    },
    read: async (request) => {
      state.calls += 1;
      if (state.fail) return { ok: false, reason: "The RPC did not answer in 6 s." };
      return { ok: true, payments: [...(byReference.get(request.reference) ?? [])] };
    },
  };
}

async function open(store, patch = {}) {
  const opened = await openOrder(store, { wallet: WALLET, holder, packageId: "usdc-2", treasury: TREASURY, locale: "uk", nowMs: NOW, ...patch });
  assert.equal(opened.ok, true, opened.reason);
  return opened.order;
}

async function paid(store, who = holder) {
  return (await readBalance(store, who))?.paid ?? 0;
}

/** The entries replay to the balance, and every purchase entry is one grant. */
async function assertReplays(store, who) {
  const balance = await readBalance(store, who);
  const entries = await readEntries(store, who, 100_000);
  assert.equal(entries.reduce((sum, entry) => sum + entry.delta.paid, 0), balance?.paid ?? 0, "the bought credits replay from the entries");
}

test("the packages are the plan's table; what an order is worth never falls as more arrives", () => {
  assert.deepEqual(CREDIT_PACKAGES.map((entry) => [entry.usdc, entry.credits]), [[2, 2_000], [5, 5_250], [10, 11_000], [25, 28_750]]);
  const five = packageOf("usdc-5");
  assert.equal(creditsForPaid(five, 5_000_000n), 5_250, "exact: the package with its bonus");
  assert.equal(creditsForPaid(five, 3_000_000n), 3_000, "short: what arrived at 1 000 for 1 USDC, no bonus");
  assert.equal(creditsForPaid(five, 6_000_000n), 6_250, "over: the package and the rest at the base rate");
  assert.equal(creditsForPaid(five, 999n), 0, "less than a credit's worth is no credit");
  for (const pkg of CREDIT_PACKAGES) {
    let last = 0;
    for (let raw = 0n; raw <= BigInt(pkg.usdc) * 2_000_000n; raw += 250_000n) {
      const credits = creditsForPaid(pkg, raw);
      assert.ok(credits >= last, `${pkg.id}: ${raw} gives ${credits} after ${last}`);
      last = credits;
    }
  }
});

test("nothing is sold without the treasury; a package that does not exist and the treasury buying from itself are refused", async () => {
  const store = createMemoryGuardStore();
  assert.equal(treasuryFrom({}), null);
  assert.equal(treasuryFrom({ [PURCHASE_ENV.treasury]: "not-an-address" }), null);
  assert.equal(treasuryFrom({ [PURCHASE_ENV.treasury]: ` ${TREASURY} ` }), TREASURY);
  const [pda] = await getProgramDerivedAddress({ programAddress: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", seeds: [new TextEncoder().encode("ryntra")] });
  assert.equal(treasuryFrom({ [PURCHASE_ENV.treasury]: pda }), null, "a program's address or a token account is never the treasury");
  assert.equal((await openOrder(store, { wallet: WALLET, holder, packageId: "usdc-2", treasury: null, locale: "en", nowMs: NOW })).code, "PURCHASE_CLOSED");
  assert.equal((await openOrder(store, { wallet: WALLET, holder, packageId: "usdc-3", treasury: TREASURY, locale: "en", nowMs: NOW })).code, "PACKAGE_UNKNOWN");
  assert.equal((await openOrder(store, { wallet: TREASURY, holder: walletHolder(TREASURY), packageId: "usdc-2", treasury: TREASURY, locale: "en", nowMs: NOW })).code, "SELF_PAYMENT");
  assert.deepEqual(purchaseView(null), { available: false, packages: CREDIT_PACKAGES.map((p) => ({ id: p.id, usdc: String(p.usdc), credits: p.credits, bonusPercent: p.bonusPercent })), treasury: null, orderMinutes: 15 });
});

test("an order is a payment request to the treasury in USDC with its own reference for 15 minutes, shown in no wallet's listing", async () => {
  const store = createMemoryGuardStore();
  const order = await open(store);
  const request = await readPaymentRequest(store, order.id);
  assert.equal(request.recipient, TREASURY);
  assert.equal(request.mint, USDC);
  assert.equal(request.amountRaw, "2000000");
  assert.equal(request.description, "Кредити Ryntra · 2 000");
  assert.equal(Date.parse(request.expiresAt) - NOW, ORDER_TTL_MS);
  assert.equal(await readRequestIdByReference(store, order.reference), order.id);
  assert.deepEqual(await listPaymentRequestsByWallet(store, { network: "mainnet", wallet: TREASURY }), [], "the treasury's «Отримати» does not list people's orders");
  assert.equal(orderStatus(order, NOW), "awaiting");
  assert.equal(orderStatus(order, NOW + ORDER_TTL_MS), "expired");
  const view = orderView(order, "https://ryntra.io", NOW);
  assert.equal(view.payPage, `https://ryntra.io/pay/${order.id}`);
  assert.match(view.payUrl, new RegExp(`^solana:${TREASURY}\\?amount=2&spl-token=${USDC}&reference=${order.reference}`));
  assert.deepEqual(await listOrders(store, OTHER), [], "another wallet reads none of them");
});

test("paid exactly: the package credited once; a repeat read adds nothing; the history says «purchase»", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const order = await open(store);
  net.pay(order, { raw: usdc(2) });
  const settled = await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 60_000 });
  assert.equal(settled.credited, 2_000);
  assert.equal(orderStatus(settled, NOW + 60_000), "paid");
  assert.equal(await paid(store), 2_000);
  for (let i = 0; i < 3; i += 1) await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 120_000 + i * 10_000, force: true });
  assert.equal(await paid(store), 2_000, "the same payment is never credited twice");
  const [entry] = await readEntries(store, holder, 5);
  assert.deepEqual([entry.kind, entry.reason, entry.delta.paid], ["grant", "purchase", 2_000]);
  await assertReplays(store, holder);
  const view = orderView(await readOrder(store, order.id), "https://ryntra.io", NOW + 200_000);
  assert.equal(view.payments.length, 1);
  assert.equal(view.payments[0].amount, "2");
  assert.equal(view.received.display, "2");
});

test("double call: many reads at once credit once", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const order = await open(store, { packageId: "usdc-10" });
  net.pay(order, { raw: usdc(10) });
  await Promise.all(Array.from({ length: 8 }, () => settleOrder(store, order.id, { read: net.read, nowMs: NOW + 60_000, force: true })));
  assert.equal(await paid(store), 11_000);
  assert.equal((await readOrder(store, order.id)).credited, 11_000);
  await assertReplays(store, holder);
});

test("one signature carrying two orders' references pays one of them — also when both are read at once", async () => {
  for (const together of [false, true]) {
    const store = createMemoryGuardStore();
    const net = chain();
    const first = await open(store);
    const second = await open(store);
    net.payBoth(first, second, usdc(2));
    const settle = (order) => settleOrder(store, order.id, { read: net.read, nowMs: NOW + 60_000, force: true });
    if (together) await Promise.all([settle(first), settle(second)]);
    else {
      await settle(first);
      await settle(second);
    }
    assert.equal(await paid(store), 2_000, together ? "read at once" : "read in turn");
    const credited = [(await readOrder(store, first.id)).credited, (await readOrder(store, second.id)).credited].sort();
    assert.deepEqual(credited, [0, 2_000]);
  }
});

test("another mint: recorded, not credited, said; USDC beside it still counts", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const order = await open(store);
  net.pay(order, { raw: "5000000000", mint: BONK });
  let settled = await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 60_000 });
  assert.equal(settled.credited, 0);
  assert.equal(await paid(store), 0);
  assert.equal(orderView(settled, "https://ryntra.io", NOW + 60_000).wrongToken, true);
  assert.equal(orderStatus(settled, NOW + 60_000), "awaiting");
  net.pay(order, { raw: "1000000000", mint: null });
  net.pay(order, { raw: usdc(2) });
  settled = await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 120_000 });
  assert.equal(settled.credited, 2_000);
  assert.equal(settled.foreign.length, 2, "SOL and BONK are both recorded and neither is credited");
});

test("short: what arrived at the base rate, without the bonus; the rest paid later completes the package; over: the package and the rest", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const order = await open(store, { packageId: "usdc-5" });
  net.pay(order, { raw: usdc(3) });
  let settled = await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 60_000 });
  assert.equal(settled.credited, 3_000);
  assert.equal(orderStatus(settled, NOW + 60_000), "underpaid");
  net.pay(order, { raw: usdc(2) });
  settled = await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 120_000 });
  assert.equal(settled.credited, 5_250, "the package with its bonus once the whole price is in");
  assert.equal(await paid(store), 5_250);
  net.pay(order, { raw: usdc(1) });
  settled = await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 180_000 });
  assert.equal(settled.credited, 6_250, "a second payment over the price at 1 000 for 1 USDC");
  assert.equal(await paid(store), 6_250);
  await assertReplays(store, holder);
});

test("RPC timeout: nothing credited, said as «checking»; the next read that answers credits once", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const order = await open(store);
  net.pay(order, { raw: usdc(2) });
  net.state.fail = true;
  let settled = await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 60_000 });
  assert.equal(settled.credited, 0);
  assert.equal(settled.failures, 1);
  assert.equal(orderStatus(settled, NOW + 60_000), "checking");
  assert.equal(await paid(store), 0);
  const thrower = async () => {
    throw new Error("fetch failed");
  };
  settled = await settleOrder(store, order.id, { read: thrower, nowMs: NOW + 70_000 });
  assert.equal(settled.failures, 2, "a reader that throws is a failed read, not a crash");
  net.state.fail = false;
  settled = await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 80_000 });
  assert.equal(settled.credited, 2_000);
  assert.equal(settled.failures, 0);
  assert.equal(await paid(store), 2_000);
});

test("a read younger than eight seconds is reused; a payment after the order's 15 minutes still counts", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const order = await open(store);
  await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 1_000 });
  await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 5_000 });
  assert.equal(net.state.calls, 1);
  const late = NOW + ORDER_TTL_MS + 5 * 60_000;
  assert.equal(orderStatus(await readOrder(store, order.id), late), "expired");
  net.pay(order, { raw: usdc(2) });
  const settled = await settleOrder(store, order.id, { read: net.read, nowMs: late });
  assert.equal(settled.credited, 2_000);
  assert.equal(orderStatus(settled, late), "paid");
});

test("at most six orders an hour per wallet; the next hour opens again", async () => {
  const store = createMemoryGuardStore();
  for (let i = 0; i < ORDERS_PER_HOUR; i += 1) await open(store, { nowMs: NOW + i * 1_000 });
  const refused = await openOrder(store, { wallet: WALLET, holder, packageId: "usdc-2", treasury: TREASURY, locale: "en", nowMs: NOW + 10_000 });
  assert.equal(refused.code, "ORDERS_LIMIT");
  const other = await openOrder(store, { wallet: OTHER, holder: walletHolder(OTHER), packageId: "usdc-2", treasury: TREASURY, locale: "en", nowMs: NOW + 10_000 });
  assert.equal(other.ok, true, "another wallet's hour is its own");
  assert.equal((await openOrder(store, { wallet: WALLET, holder, packageId: "usdc-2", treasury: TREASURY, locale: "en", nowMs: NOW + 61 * 60_000 })).ok, true);
  assert.equal((await listOrders(store, WALLET)).length, ORDERS_PER_HOUR + 1);
});

test("a wallet linked to an account after the order: the credits go to the account", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const order = await open(store);
  await grantCredits(store, holder, { credits: 10, bucket: "paid", reason: "adjust", idem: "seed", nowMs: NOW });
  const account = accountHolder(ACCOUNT);
  assert.equal((await mergeHolders(store, holder, account, NOW + 1_000)).ok, true);
  net.pay(order, { raw: usdc(2) });
  await settleOrder(store, order.id, { read: net.read, nowMs: NOW + 60_000 });
  assert.equal(await paid(store, account), 2_010);
  assert.equal(await paid(store, holder), 0);
});

test("the sweep reads the orders that may still be paid, a few at a time, and credits them", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const order = await open(store, { packageId: "usdc-5" });
  net.pay(order, { raw: usdc(5) });
  const orders = await sweepOrders(store, WALLET, { read: net.read, nowMs: NOW + 60_000 });
  assert.equal(orders[0].credited, 5_250);
  assert.equal(await paid(store), 5_250);
  const calls = net.state.calls;
  await sweepOrders(store, WALLET, { read: net.read, nowMs: NOW + 30 * 60_000 });
  assert.equal(net.state.calls, calls, "a paid order past its window is not read again by the sweep");
});

test("nothing that moves money: the purchase files import no signer, no transaction builder and no key", () => {
  for (const file of ["purchase.ts", "purchase.server.ts", "order-view.ts"]) {
    const source = readFileSync(new URL(`./credits/${file}`, import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^import\b/.test(line)).join("\n");
    assert.doesNotMatch(imports, /sign|submit|transaction|keypair|secret|wallet\.client/i, `${file} imports only readers and the store`);
  }
});

test("the stand's pretend chain is never on a production build or a Vercel deployment, and pays only after twenty seconds", async () => {
  assert.equal(standChainOn({}), false);
  assert.equal(standChainOn({ [STAND_CHAIN_ENV]: "1", NODE_ENV: "production" }), false);
  assert.equal(standChainOn({ [STAND_CHAIN_ENV]: "1", VERCEL: "1" }), false);
  assert.equal(standChainOn({ [STAND_CHAIN_ENV]: "1", VERCEL_ENV: "preview" }), false);
  assert.equal(standChainOn({ [STAND_CHAIN_ENV]: "1", NODE_ENV: "development" }), true);
  const store = createMemoryGuardStore();
  const order = await openOrder(store, { wallet: WALLET, holder, packageId: "usdc-2", treasury: TREASURY, locale: "en", nowMs: Date.now() });
  const request = await readPaymentRequest(store, order.order.id);
  assert.deepEqual((await standChain(request)).payments, []);
  const later = await standChain({ ...request, createdAt: new Date(Date.now() - 30_000).toISOString() });
  assert.equal(later.payments.length, 1);
  assert.equal(later.payments[0].creditedRaw, "2000000");
});

test("however many orders are open, each comes round: the sweep reads the least recently read first", async () => {
  const store = createMemoryGuardStore();
  const net = chain();
  const orders = [];
  for (let i = 0; i < 5; i += 1) orders.push(await open(store, { nowMs: NOW + i * 1_000 }));
  net.pay(orders[0], { raw: usdc(2) });
  let at = NOW + 60_000;
  for (let round = 0; round < 3 && (await readOrder(store, orders[0].id)).credited === 0; round += 1) {
    await sweepOrders(store, WALLET, { read: net.read, nowMs: at });
    at += 10_000;
  }
  assert.equal((await readOrder(store, orders[0].id)).credited, 2_000, "the oldest order is read within three sweeps");
  const late = NOW + 3 * 24 * 60 * 60 * 1_000;
  net.pay(orders[1], { raw: usdc(2) });
  for (let round = 0; round < 3 && (await readOrder(store, orders[1].id)).credited === 0; round += 1) {
    await sweepOrders(store, WALLET, { read: net.read, nowMs: late + round * 11 * 60_000 });
  }
  assert.equal((await readOrder(store, orders[1].id)).credited, 2_000, "a payment three days late is credited by the sweep");
  assert.equal(await paid(store), 4_000);
});
