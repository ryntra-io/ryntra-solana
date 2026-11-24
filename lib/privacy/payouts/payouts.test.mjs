import assert from "node:assert/strict";
import test from "node:test";

import { checkList, isAddress, nameKey, stopping, toRead, totals, unitsOf, unitsText, weightOf } from "./check.ts";
import { feeOf, payoutFee } from "./fee.ts";
import { lineOf, parseList } from "./list.ts";
import { batchesOf, planPayout } from "./plan.ts";
import { MAX_PAYMENTS, MERGE_INPUT_COUNT, maxSpendInputs } from "./shapes.ts";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let v = 0n;
  for (const x of bytes) v = v * 256n + BigInt(x);
  let s = "";
  while (v > 0n) {
    s = B58[Number(v % 58n)] + s;
    v /= 58n;
  }
  for (const x of bytes) {
    if (x !== 0) break;
    s = "1" + s;
  }
  return s;
}
/** A valid address of its own for each n. */
const addr = (n) => base58(new Uint8Array(32).map((_, j) => (n * 37 + j * 11 + 1) % 256));
const OWNER = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const SOL = 1_000_000_000n;
const NOFEE = { bps: 0, to: null, cap: null };

test("the proof shapes are the SDK's: 15 recipients a transfer, 8 parts of the balance from 8 recipients up", () => {
  assert.equal(MAX_PAYMENTS, 15);
  assert.equal(MERGE_INPUT_COUNT, 24);
  const want = { 1: 40, 2: 40, 3: 24, 4: 24, 5: 16, 8: 16, 9: 8, 10: 8, 15: 8, 16: 8, 17: 0 };
  for (const [outputs, inputs] of Object.entries(want)) assert.equal(maxSpendInputs(Number(outputs)), inputs, `outputs ${outputs}`);
});

test("a list is read however people bring it: spoken, pasted from a sheet, a CSV with a header", () => {
  const a = addr(1);
  const b = addr(2);
  const spoken = parseList(`Олег Петренко 900 SOL за жовтень\n\n${a} 0,05\nanna.sol 1 200,5 sol bonus`);
  assert.deepEqual(spoken, [
    { line: 1, name: "Олег Петренко", to: null, amount: "900", coin: "SOL", note: "за жовтень" },
    { line: 3, name: null, to: a, amount: "0.05", coin: "SOL", note: null },
    { line: 4, name: "anna.sol", to: null, amount: "1200.5", coin: "SOL", note: "bonus" },
  ]);

  const sheet = parseList(`Name\tAddress\tAmount\tCoin\tFor\nOleh\t${a}\t1 500,25\tSOL\tOctober, design\nIra\t${b}\t2\t\t`);
  assert.deepEqual(sheet, [
    { line: 2, name: "Oleh", to: a, amount: "1500.25", coin: "SOL", note: "October, design" },
    { line: 3, name: "Ira", to: b, amount: "2", coin: "SOL", note: null },
  ]);

  const csv = parseList(`ім'я;адреса;сума;за що\n"Марко, дизайн";${a};0,5;"листопад"`);
  assert.deepEqual(csv, [{ line: 2, name: "Марко, дизайн", to: a, amount: "0.5", coin: "SOL", note: "листопад" }]);

  const commas = parseList(`Oleh,${a},100,50,SOL\n${b},0.5sol,for the logo`);
  assert.equal(commas[0].amount, "100.50", "two bare numbers side by side are a decimal comma");
  assert.equal(commas[0].coin, "SOL");
  assert.deepEqual(commas[1], { line: 2, name: null, to: b, amount: "0.5", coin: "SOL", note: "for the logo" });
});

test("a comma inside what it is for does not turn a spoken line into a sheet's", () => {
  const a = addr(1);
  assert.deepEqual(parseList(`Oleh ${a} 0.4 SOL design, October`), [{ line: 1, name: "Oleh", to: a, amount: "0.4", coin: "SOL", note: "design, October" }]);
  assert.deepEqual(parseList(`Oleh, ${a}, 0.4, SOL, design`), [{ line: 1, name: "Oleh", to: a, amount: "0.4", coin: "SOL", note: "design" }]);
  assert.deepEqual(parseList(`Ira 0.4, for the logo`), [{ line: 1, name: "Ira", to: null, amount: "0.4", coin: "SOL", note: "for the logo" }]);
});

test("an address that ends in digits is never joined with the amount after it", () => {
  const tail = addr(4);
  const withDigit = [addr(1), addr(2), addr(3), addr(4), addr(5), addr(6)].find((x) => /\d$/.test(x)) ?? tail;
  const [row] = parseList(`${withDigit} 250 SOL`);
  assert.equal(row.to, withDigit);
  assert.equal(row.amount, "250");
});

test("a line that says little still comes back, so the screen can show it", () => {
  const rows = parseList("just a name\n0.5\nUSDC 10");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "just a name");
  assert.equal(rows[0].amount, null);
  assert.equal(rows[1].amount, "0.5");
  assert.equal(rows[2].name, "USDC", "a coin before any amount is not taken as the coin");
});

test("a row written back as a line reads the same", () => {
  const row = { name: "Oleh", to: addr(1), amount: "0.25", coin: "SOL", note: "October" };
  const [back] = parseList(lineOf(row));
  assert.deepEqual({ ...back, line: undefined }, { ...row, line: undefined });
});

test("amounts are exact: no rounding, no more places than the coin has", () => {
  assert.equal(unitsOf("0.05", 9), 50_000_000n);
  assert.equal(unitsOf("1200,5", 9), 1_200_500_000_000n);
  assert.equal(unitsOf("0.1234567891", 9), null, "finer than a lamport");
  assert.equal(unitsOf("0.1234567890", 9), 123_456_789n, "trailing zeros are fine");
  assert.equal(unitsOf("0", 9), null);
  assert.equal(unitsOf("-1", 9), null);
  assert.equal(unitsOf("1e3", 9), null);
  assert.equal(unitsText(1_200_500_000_000n, 9), "1200.5");
  assert.equal(unitsText(50_000_000n, 9), "0.05");
});

test("an address is base58 of 32 bytes", () => {
  assert.ok(isAddress(OWNER));
  assert.ok(isAddress(addr(7)));
  assert.ok(!isAddress("11111111111111111111111111111111111111111111"), "too many bytes of zero");
  assert.ok(!isAddress(`${OWNER.slice(0, -1)}0`), "0 is not base58");
  assert.ok(!isAddress("oleh.sol"));
});

test("the check says what stops a payout, what to look at again, and what is only said", () => {
  const known = addr(1);
  const fresh = addr(2);
  const unready = addr(3);
  const rows = parseList(
    [
      `Oleh 1 SOL`, // a name the record knows
      `${fresh} 0.5`, // never paid, has a private balance
      `${fresh} 0.25`, // the same recipient again
      `${unready} 0.0005`, // no private balance, too little for a link
      `Nobody 2`, // a name nobody knows
      `${OWNER} 1`, // the person's own wallet
      `${known.slice(0, -2)}0O 1`, // not base58 — read as words
      `${known} 1 USDC`, // a coin not paid privately yet
      `${known}`, // no amount
    ].join("\n"),
  );
  const checked = checkList({
    rows,
    owner: OWNER,
    contacts: new Map([[nameKey("oleh"), known]]),
    paid: new Set([known]),
    registered: new Map([
      [known, true],
      [fresh, true],
      [unready, false],
      [OWNER, true],
    ]),
    way: "link",
  });
  const issues = checked.map((r) => [...r.issues].sort());
  assert.deepEqual(issues[0], []);
  assert.equal(checked[0].address, known);
  assert.equal(checked[0].route, "private");
  assert.deepEqual(issues[1], ["duplicate", "new"]);
  assert.deepEqual(issues[2], ["duplicate", "new"]);
  assert.deepEqual(issues[3], ["new", "noPrivate", "small"]);
  assert.equal(checked[3].route, "link");
  assert.deepEqual(issues[4], ["who"]);
  assert.deepEqual(issues[5], ["new", "self"]);
  assert.ok(issues[6].includes("who") || issues[6].includes("address"));
  assert.deepEqual(issues[7], ["amount", "coin"]);
  assert.deepEqual(issues[8], ["amount"]);
  assert.equal(weightOf("duplicate"), "ask");
  assert.equal(weightOf("noPrivate"), "note");
  assert.equal(weightOf("who"), "stop");
  assert.deepEqual(stopping(checked).map((r) => r.line), [4, 5, 6, 7, 8, 9]);
  assert.equal(totals(checked).get("SOL"), SOL + SOL / 2n + SOL / 4n);
  const open = checkList({ rows: [rows[3]], owner: OWNER, contacts: new Map(), paid: new Set(), registered: new Map([[unready, false]]), way: "open" });
  assert.equal(open[0].route, "open");
  const unknown = checkList({ rows: [rows[1]], owner: OWNER, contacts: new Map(), paid: new Set(), registered: new Map(), way: "link" });
  assert.equal(unknown[0].route, null, "not read yet — no route");
  assert.deepEqual(toRead(unknown, new Map()), [fresh]);
  assert.ok(!unknown[0].issues.includes("new"), "on a first payout every address is new — not said");
});

/** `n` people with a private balance, `each` lamports to each. */
function people(n, each = SOL / 100n, route = "private") {
  const rows = parseList(Array.from({ length: n }, (_, i) => `${addr(100 + i)} ${unitsText(each, 9)}`).join("\n"));
  return checkList({ rows, owner: OWNER, contacts: new Map(), paid: new Set(), registered: new Map(rows.map((r) => [r.to, route !== "noPrivate"])), way: route === "noPrivate" ? "link" : "link" });
}

const plan = (rows, parts, extra = {}) => planPayout({ rows, coin: "SOL", parts, mergeOn: true, perTransfer: 15, canMerge: true, fee: NOFEE, ...extra });

test("fifteen people with the balance in one part: one signature", () => {
  const p = plan(people(15), [SOL]);
  assert.equal(p.signatures, 1);
  assert.equal(p.batches.length, 1);
  assert.equal(p.batches[0].payments.length, 15);
  assert.equal(p.people, 15);
  assert.equal(p.total, (SOL / 100n) * 15n);
  assert.equal(p.short, 0n);
});

test("sixteen people: two transfers, two signatures, in list order", () => {
  const rows = people(16);
  const p = plan(rows, [SOL]);
  assert.equal(p.signatures, 2);
  assert.deepEqual(p.batches.map((b) => b.payments.length), [15, 1]);
  assert.deepEqual(p.batches.flatMap((b) => b.payments.map((x) => x.id)), rows.map((r) => r.id));
});

test("a balance in more than 8 parts is merged before a transfer of 9 or more", () => {
  // 10 parts of 0.016: 15 people of 0.01 need 10 of them, more than the 8 the transfer's proof takes.
  const parts = Array.from({ length: 10 }, () => (SOL * 16n) / 1000n);
  const p = plan(people(15), parts);
  assert.deepEqual(p.steps.map((s) => s.kind), ["merge", "transfer"]);
  assert.equal(p.steps[0].parts, 10);
  assert.equal(p.signatures, 2);
  // The record has merging off: one signature more, once.
  const off = plan(people(15), parts, { mergeOn: false });
  assert.deepEqual(off.steps.map((s) => s.kind), ["mergeOn", "merge", "transfer"]);
  assert.equal(off.signatures, 3);
  // Eight parts are enough for the same payout: no merge.
  assert.equal(plan(people(15), Array.from({ length: 8 }, () => SOL / 50n)).signatures, 1);
});

test("forty small parts take two merges of the 24 smallest", () => {
  const parts = Array.from({ length: 40 }, () => SOL / 200n); // 0.2 SOL in 40 parts
  const p = plan(people(15), parts);
  assert.deepEqual(p.steps.map((s) => s.kind), ["merge", "transfer"], "after one merge the largest part covers it");
  const big = plan(people(15, SOL / 80n), parts); // needs 0.1875: one merged 0.12 + 7 of 0.005 = 0.155 — not enough
  assert.deepEqual(big.steps.map((s) => s.kind), ["merge", "merge", "transfer"]);
});

test("without a merge in this session, a payout that needs one is stuck, not half signed", () => {
  const parts = Array.from({ length: 10 }, () => (SOL * 16n) / 1000n);
  const p = plan(people(15), parts, { canMerge: false });
  assert.equal(p.stuck, true);
  assert.equal(p.steps.length, 0);
});

test("a private balance too small says by how much", () => {
  const p = plan(people(15), [SOL / 20n]);
  assert.equal(p.short, (SOL / 100n) * 15n - SOL / 20n);
});

test("people without a private balance: a link is two signatures and its fees in the open, an open payment one", () => {
  const rows = parseList(`${addr(1)} 0.5\n${addr(2)} 0.25\n${addr(3)} 0.1`);
  const registered = new Map([
    [addr(1), true],
    [addr(2), false],
    [addr(3), false],
  ]);
  const links = checkList({ rows, owner: OWNER, contacts: new Map(), paid: new Set(), registered, way: "link" });
  const viaLinks = plan(links, [SOL]);
  assert.deepEqual(viaLinks.steps.map((s) => s.kind), ["transfer", "link", "link"]);
  assert.equal(viaLinks.signatures, 5);
  assert.equal(viaLinks.walletSol, 10_000_000n, "two links' own network fees");
  const opens = checkList({ rows, owner: OWNER, contacts: new Map(), paid: new Set(), registered, way: "open" });
  const viaOpen = plan(opens, [SOL]);
  assert.deepEqual(viaOpen.steps.map((s) => s.kind), ["transfer", "open", "open"]);
  assert.equal(viaOpen.signatures, 3);
  assert.equal(viaOpen.walletSol, 0n);
});

test("without the SDK's transfer to many, each person is a transfer of their own", () => {
  const p = plan(people(3), [SOL], { perTransfer: 1 });
  assert.equal(p.signatures, 3);
  assert.deepEqual(p.batches.map((b) => b.payments.length), [1, 1, 1]);
});

test("Ryntra's fee: none until the owner sets a rate and an address; then the transfer's own extra output", () => {
  assert.deepEqual(payoutFee(), { bps: 0, to: null, cap: null }, "no rate and no address in code");
  assert.equal(feeOf(100n * SOL, payoutFee()), 0n);
  const rule = { bps: 20, to: addr(9), cap: null };
  assert.equal(feeOf(100n * SOL, rule), SOL / 5n, "0.2 % of 100");
  assert.equal(feeOf(100n * SOL, { ...rule, cap: SOL / 10n }), SOL / 10n, "capped");
  assert.equal(feeOf(100n * SOL, { ...rule, to: null }), 0n, "no address — no fee");
  assert.equal(feeOf(7n, rule), 0n, "rounded down");
  // With a fee the transfer keeps a slot for it: 14 people, then the fee.
  const batches = batchesOf(people(15), "SOL", 15, rule);
  assert.deepEqual(batches.map((b) => b.payments.length), [14, 1]);
  assert.equal(batches[0].fee, feeOf((SOL / 100n) * 14n, rule));
  const p = plan(people(15), [SOL], { fee: rule });
  assert.equal(p.fee, batches.reduce((a, b) => a + b.fee, 0n));
  assert.equal(p.spend, p.total + p.fee);
});
