import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { exposureOf } from "../exposure.ts";
import { RING_SOL } from "../network.ts";
import { PAY_PATH, decodeInvoice, encodeInvoice, payUrl } from "./code.ts";
import {
  DEFAULT_EXPIRY,
  EXPIRIES,
  EXPIRY_MS,
  FOR_WHAT_MAX,
  PRIVATE_INVOICE_COINS,
  amountUnits,
  cleanForWhat,
  coinOf,
  invoiceId,
  isExpired,
  makeInvoice,
  shortAddress,
  timeLeft,
  unitsText,
} from "./model.ts";
import { FEE_MARGIN_LAMPORTS, WAY_SEEN, failureOf, payView, payWay, walletShort } from "./pay.ts";
import { inboundOf, listOrder, newlyPaid, settle, waitingTotals } from "./status.ts";

/* «Invoices», private: an invoice paid into the recipient's private balance. The invoice lives in the link's
   fragment and in the recipient's browser; «paid» comes from the recipient's own private history, never the public
   chain; the payer pays from their private balance (only they are seen) or from the wallet in one approval (they and
   the sum are seen). */

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const TO = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const PAYER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const BYTES = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
const SOL = PRIVATE_INVOICE_COINS[0];

const invoice = (over = {}) => makeInvoice({ to: TO, mint: SOL.mint, typed: "0.5", forWhat: "Logo, two drafts", expiry: "7d", ...over }, NOW, BYTES);

test("a private invoice asks for SOL on the test network, by the ring's own name for it", () => {
  assert.deepEqual(PRIVATE_INVOICE_COINS.map((c) => [c.symbol, c.mint, c.decimals]), [["SOL", RING_SOL, 9]]);
  assert.equal(coinOf(RING_SOL)?.symbol, "SOL");
  assert.equal(coinOf("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), null, "no coin the private balance cannot hold yet");
  assert.deepEqual([...EXPIRIES], ["1h", "24h", "7d", "30d"], "the open links' own presets");
  assert.equal(DEFAULT_EXPIRY, "7d");
  assert.equal(EXPIRY_MS["1h"], 3_600_000);
  assert.equal(FOR_WHAT_MAX, 120);
});

test("amounts: typed text and smallest units go there and back without rounding; more places are refused", () => {
  assert.equal(amountUnits("0.5", 9), 500_000_000n);
  assert.equal(amountUnits("0,05", 9), 50_000_000n, "a comma is the point");
  assert.equal(amountUnits(".5", 9), 500_000_000n);
  assert.equal(amountUnits("1.234567891", 9), 1_234_567_891n);
  assert.equal(amountUnits("1.2345678912", 9), null, "more places than the coin has — refused, never rounded");
  for (const bad of ["", ".", "0", "0.000", "-1", "1e3", "abc", "1.2.3"]) assert.equal(amountUnits(bad, 9), null, bad);
  assert.equal(amountUnits("18446744073.709551615", 9), 0xffff_ffff_ffff_ffffn, "the ring's bound");
  assert.equal(amountUnits("18446744073.709551616", 9), null, "past the ring's bound");
  assert.equal(unitsText(500_000_000n, 9), "0.5");
  assert.equal(unitsText(1_234_567_891n, 9), "1.234567891");
  assert.equal(unitsText(2_000_000_000n, 9), "2");
  assert.equal(unitsText(0n, 9), "0");
});

test("«what it is for» is kept clean: no control or invisible characters, spaces folded, 120 characters at most", () => {
  assert.equal(cleanForWhat("  Logo,\n\ttwo   drafts  "), "Logo, two drafts");
  assert.equal(cleanForWhat("a\u0000b\u200bc\u202ed\u2028e"), "a b c d e");
  assert.equal(cleanForWhat("   "), null);
  assert.equal(cleanForWhat(null), null);
  const long = "🎨".repeat(200);
  assert.equal([...cleanForWhat(long)].length, 120, "whole code points, never half an emoji");
});

test("a new invoice: to the person's own wallet, an exact sum, a clean «for what», a time from the presets", () => {
  const made = invoice();
  assert.equal(made.id, "0102030405060708");
  assert.equal(made.to, TO);
  assert.equal(made.mint, RING_SOL);
  assert.equal(made.amount, 500_000_000n);
  assert.equal(made.forWhat, "Logo, two drafts");
  assert.equal(made.expiresAt - made.createdAt, 7 * 24 * 3_600_000);
  assert.equal(invoice({ forWhat: "  " }).forWhat, null);
  assert.equal(invoice({ to: "not an address" }), null);
  assert.equal(invoice({ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }), null);
  assert.equal(invoice({ typed: "0" }), null);
  assert.equal(invoice({ expiry: "90d" }), null);
  assert.throws(() => invoiceId(new Uint8Array(4)));
  assert.equal(isExpired(made, NOW), false);
  assert.equal(isExpired(made, made.expiresAt), true);
  assert.deepEqual(timeLeft(made, NOW), { unit: "days", count: 7 });
  assert.deepEqual(timeLeft(made, made.expiresAt - 3 * 3_600_000 - 1), { unit: "hours", count: 3 });
  assert.deepEqual(timeLeft(made, made.expiresAt - 30_000), { unit: "minutes", count: 1 });
  assert.equal(timeLeft(made, made.expiresAt), null);
  assert.equal(shortAddress(TO), "4Eot…zFmS");
});

test("the link carries the whole invoice after `#` and refuses a cut or changed one", async () => {
  const made = invoice();
  const fragment = await encodeInvoice(made);
  assert.match(fragment, /^i=[A-Za-z0-9_-]+$/);
  assert.ok(!fragment.includes("Logo"), "the words ride encoded, not as plain text in the address");
  const back = await decodeInvoice(`#${fragment}`);
  assert.deepEqual({ ...back, amount: back.amount.toString() }, { ...made, amount: made.amount.toString(), createdAt: Math.floor(NOW / 1000) * 1000 });
  assert.equal(payUrl("https://ryntra.io", fragment), `https://ryntra.io/private/pay#${fragment}`);
  assert.equal(PAY_PATH, "/private/pay");
  assert.equal(await decodeInvoice(fragment.slice(0, -3)), null, "a cut link");
  const flipped = fragment.slice(0, 10) + (fragment[10] === "A" ? "B" : "A") + fragment.slice(11);
  assert.equal(await decodeInvoice(flipped), null, "a changed link");
  assert.equal(await decodeInvoice("#k=abc"), null, "a claim link is not an invoice");
  assert.equal(await decodeInvoice(""), null);
  const none = await decodeInvoice(await encodeInvoice(invoice({ forWhat: "" })));
  assert.equal(none.forWhat, null);
});

test("a link that asks for what no invoice may is refused even with a whole checksum", async () => {
  const forge = async (wire) => {
    const body = new TextEncoder().encode(JSON.stringify(wire));
    const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", body)).slice(0, 4);
    const bytes = new Uint8Array([...body, ...sum]);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `i=${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  };
  const good = { v: 1, i: "0102030405060708", t: TO, m: RING_SOL, a: "500000000", f: "Logo", c: 1_790_000_000, e: 1_790_604_800 };
  assert.ok(await decodeInvoice(await forge(good)), "the forge itself is right");
  const cases = {
    "another version": { ...good, v: 2 },
    "a bad id": { ...good, i: "xyz" },
    "not an address": { ...good, t: "0OIl" },
    "an unknown coin": { ...good, m: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    "a sum of nothing": { ...good, a: "0" },
    "a sum with a sign": { ...good, a: "-5" },
    "past the ring's bound": { ...good, a: "18446744073709551616" },
    "control characters": { ...good, f: "a\u0000b" },
    "too long a note": { ...good, f: "x".repeat(121) },
    "time back to front": { ...good, e: good.c - 1 },
    "longer than a month": { ...good, e: good.c + 40 * 86_400 },
  };
  for (const [name, wire] of Object.entries(cases)) assert.equal(await decodeInvoice(await forge(wire)), null, name);
});

/* The recipient's private history, as the SDK's `getPrivateTransactions` gives it. */
const record = (signature, slot, amount, over = {}) => ({ id: { signature, slot, index: 0n }, kind: "privateTransfer", direction: "inbound", status: "confirmed", asset: RING_SOL, amount, ...over });

test("the payments that came in are read from the private history only — inbound, confirmed, a deposit or a transfer", () => {
  const got = inboundOf([
    record("sigA", 100n, 500_000_000n),
    record("sigB", 101n, 500_000_000n, { kind: "deposit" }),
    record("sigC", 102n, 1n, { direction: "outbound" }),
    record("sigD", 103n, 1n, { direction: "selfTransfer", kind: "split" }),
    record("sigE", 104n, 0n),
    record("sigF", "105", "7"),
    null,
    { kind: "deposit" },
  ]);
  assert.deepEqual(got.map((p) => [p.signature, p.slot, p.amount, p.key]), [
    ["sigA", 100n, 500_000_000n, "sigA#0"],
    ["sigB", 101n, 500_000_000n, "sigB#0"],
    ["sigF", 105n, 7n, "sigF#0"],
  ]);
});

test("an invoice is paid by the first payment after it of exactly its coin and sum; one payment pays one invoice", () => {
  const first = { invoice: invoice(), sinceSlot: 200n, paid: null };
  const second = { invoice: { ...invoice(), id: "1111111111111111", createdAt: NOW + 1 }, sinceSlot: 210n, paid: null };
  const other = { invoice: { ...invoice({ typed: "0.25" }), id: "2222222222222222" }, sinceSlot: 200n, paid: null };
  const inbound = inboundOf([
    record("before", 150n, 500_000_000n), // before the invoice was made — pays nothing
    record("less", 220n, 499_999_999n), // not the sum
    record("pay1", 230n, 500_000_000n),
  ]);
  const settled = settle([second, first, other], inbound, NOW);
  assert.equal(settled.get(first.invoice.id).state, "paid", "the oldest invoice takes the payment");
  assert.equal(settled.get(first.invoice.id).paid.signature, "pay1");
  assert.equal(settled.get(second.invoice.id).state, "waiting", "the same payment never pays twice");
  assert.equal(settled.get(other.invoice.id).state, "waiting");
  const later = settle([first, second, other], [...inbound, ...inboundOf([record("pay2", 240n, 500_000_000n)])], NOW);
  assert.equal(later.get(second.invoice.id).paid.signature, "pay2");
  assert.deepEqual(newlyPaid([first, second, other], later).map((x) => x.id), [first.invoice.id, second.invoice.id]);
  // Expired with nothing come; a payment kept stays whatever is read after.
  const expired = settle([other], [], other.invoice.expiresAt);
  assert.equal(expired.get(other.invoice.id).state, "expired");
  const kept = { ...first, paid: { signature: "pay1", slot: 230n, key: "pay1#0" } };
  const again = settle([kept, second], inboundOf([record("pay1", 230n, 500_000_000n)]), first.invoice.expiresAt + 1);
  assert.equal(again.get(first.invoice.id).state, "paid");
  assert.equal(again.get(second.invoice.id).state, "expired", "a payment already kept by another invoice pays no second one");
  assert.deepEqual(newlyPaid([kept, second], again), []);
});

test("«waiting for …» sums what is still to come, by coin; the list shows waiting first", () => {
  const a = { invoice: invoice(), sinceSlot: 1n, paid: null };
  const b = { invoice: { ...invoice({ typed: "0.25", expiry: "1h" }), id: "2222222222222222" }, sinceSlot: 1n, paid: null };
  const c = { invoice: { ...invoice({ typed: "2" }), id: "3333333333333333", createdAt: NOW + 5 }, sinceSlot: 1n, paid: { signature: "s", slot: 2n, key: "s#0" } };
  const settled = settle([a, b, c], [], NOW);
  assert.deepEqual(waitingTotals([a, b, c], settled), [{ mint: RING_SOL, amount: 750_000_000n }]);
  assert.deepEqual(listOrder([c, a, b], settled).map((k) => k.invoice.id), [b.invoice.id, a.invoice.id, c.invoice.id], "soonest to end on top, then the rest newest first");
  assert.deepEqual(waitingTotals([], new Map()), []);
});

test("the payer pays from the private balance when it holds the sum, from the wallet otherwise — and is told what others see", () => {
  const ask = 500_000_000n;
  assert.equal(payWay({ phase: "ready", held: ask }, ask), "private");
  assert.equal(payWay({ phase: "ready", held: ask - 1n }, ask), "wallet", "not the whole sum — the wallet pays");
  for (const phase of ["off", "elsewhere", "failed", "none"]) assert.equal(payWay({ phase, held: null }, ask), "wallet", phase);
  assert.equal(payWay({ phase: "loading", held: null }, ask), "wait");
  // A private transfer: only the payer is seen. From the wallet: the payer and the sum are seen (as on «Hide»).
  assert.deepEqual(exposureOf(WAY_SEEN.private), { who: "seen", to: "seen", amount: "hidden" });
  assert.equal(exposureOf(WAY_SEEN.wallet).amount, "seen", "paid from a wallet, the sum is seen — the page says so");
  assert.equal(exposureOf(WAY_SEEN.wallet).who, "seen");
  const made = invoice();
  assert.equal(payView({ invoice: made, now: NOW, payer: null, paidHere: false }), "connect");
  assert.equal(payView({ invoice: made, now: NOW, payer: TO, paidHere: false }), "own");
  assert.equal(payView({ invoice: made, now: NOW, payer: PAYER, paidHere: false }), "pay");
  assert.equal(payView({ invoice: made, now: made.expiresAt, payer: PAYER, paidHere: false }), "expired");
  assert.equal(payView({ invoice: made, now: made.expiresAt, payer: PAYER, paidHere: true }), "paidHere", "a payment made here stays «paid»");
  assert.equal(walletShort(ask + FEE_MARGIN_LAMPORTS, made, "wallet"), false);
  assert.equal(walletShort(ask + FEE_MARGIN_LAMPORTS - 1n, made, "wallet"), true);
  assert.equal(walletShort(FEE_MARGIN_LAMPORTS, made, "private"), false, "from the private balance the wallet pays the fee only");
  assert.equal(failureOf("WALLET_REFUSED"), "refused");
  assert.equal(failureOf("NOT_REGISTERED"), "closed");
  assert.equal(failureOf("WALLET_RECIPIENT_NOT_REGISTERED"), "closed");
  assert.equal(failureOf("WALLET_BUILD_DEPOSIT"), "failed", "it could not be built — nothing moved");
  assert.equal(failureOf("WALLET_CHANGED_MESSAGE"), "failed");
  assert.equal(failureOf("SEND_FAILED"), "unconfirmed", "it may have gone out: check the wallet before paying again");
  assert.equal(failureOf(null), "unconfirmed");
});

test("«what it is for» never reaches a server or the chain: no memo, no fetch, sealed storage only", () => {
  const files = readdirSync(join(REPO, "lib/privacy/invoices")).filter((name) => /\.(ts|tsx)$/.test(name));
  for (const name of files) {
    const source = code(`lib/privacy/invoices/${name}`);
    assert.doesNotMatch(source, /\bmemo\b/i, `${name}: nothing is written as a memo`);
    assert.doesNotMatch(source, /\bfetch\(/, `${name}: no request of its own`);
    assert.doesNotMatch(source, /localStorage|sessionStorage/, `${name}: the invoice is sealed, never kept in plain storage`);
  }
  const chain = code("lib/privacy/invoices/chain.client.ts");
  assert.match(chain, /buildDepositTransaction\(\{\s*client: ctx\.client,\s*feePayer: payer,\s*recipient: invoice\.to,\s*amount: invoice\.amount,/, "the deposit is made out to the recipient, with the exact sum and nothing else");
  assert.match(chain, /if \(!\(await canReceive\(ctx, invoice\.to\)\)\) throw new PrivateError\('NOT_REGISTERED'\)/, "only into a private balance that is on");
  assert.match(code("lib/privacy/invoices/store.client.ts"), /from '\.\.\/vault\.client\.ts'/);
  // The payer's page keeps the fragment out of analytics, and the route stands only with the private balance open.
  const page = code("terminal/money/private/PayScreen.tsx");
  assert.match(page, /holder\.va\('beforeSend', \(event: VaEvent\) => \(\{ \.\.\.event, url: withoutFragment\(event\.url\) \}\)\)/);
  assert.doesNotMatch(page, /\bfetch\(/);
  const route = code("app/(terminal)/private/pay/page.tsx");
  assert.match(route, /if \(!privateNetwork\(\) \|\| !shelfOn\("portfolio"\)\) notFound\(\);/);
  assert.match(route, /index: false/, "an invoice page is never offered to the index");
});

test("«Invoices» stays as it was without the flag: the switch stands only with the private balance open", () => {
  const mode = code("terminal/money/private/Mode.tsx");
  assert.match(mode, /const shown = privateNetwork\(\) !== null;/);
  assert.match(mode, /return \{ shown, mode: shown \? mode : 'open', set \};/);
  const screen = code("terminal/money/MoneyScreen.tsx");
  assert.match(screen, /mark=\{tab === 'invoices' && mode\.shown \? <ModeSwitch/);
  assert.match(screen, /const privately = tab === 'invoices' && mode\.mode === 'private';/);
  assert.match(screen, /<InvoiceForm key=\{owner\} create=\{invoices\.create\} \/>/, "the open form stands as it was");
  assert.match(screen, /<MyLinks links=\{invoices\.links\}/, "and its list");
});

test("the private invoice's words are «private», never «anonymous», and promise nothing", () => {
  const words = code("terminal/money/private/words.ts").toLowerCase();
  for (const banned of ["anonym", "анонім", "untrace", "не відстеж", "invisible", "невидим", "first private", "перший приват", "like cash", "як готівка", "guarantee", "гарант"]) {
    assert.ok(!words.includes(banned), banned);
  }
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(REPO, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(REPO, path)).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk("terminal/money/private");
  for (const path of files) assert.doesNotMatch(code(path).replace(/\/\/.*$/gm, ""), /mainnet/i, `${path}: devnet only`);
});
