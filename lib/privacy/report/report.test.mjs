import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { ALL_TIME, CSV_STYLE, addDecimal, csvCell, inPeriod, periodOf, reportCsv, reportFileName, reportRows, rowsOfInvoices, rowsOfPayouts, stamp, totalsOf } from "./report.ts";
import { canReceipt, receiptFileName, receiptText } from "./receipt.ts";
import { JOURNAL_KEEP, cleanWho, giveAccess, giveAgain, grantId, isGrant, journalOrder, mergeJournals, takeAccess } from "./access.ts";
import { BACKUP_KIND, backupFileName, decodeBackup, encodeBackup } from "./backup.ts";
import { recordId } from "../ledger/ledger.ts";
import { RING_SOL } from "../network.ts";

const OWNER = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const A = "3WAjyrF65J4mLUm4eaPKtwYRiqT6t1N3WhAwwheyZpw3";
const B = "61AgGzUTxL49Vq1qndTKfL6XZgVRencBdHD5DZtbet8N";
const SIG = "5h6xBEauJ3PK6SWCZ1PGjBvj8vDdWG3KpwATGy1ARAXFSDwt8GFXM7W5Ncn16wmqokgpiKRLuS83KUxyZyv2sUYv";

const line = (over) => ({ name: null, to: A, amount: "0.5", coin: "SOL", note: null, how: "private", state: "paid", signature: SIG, link: null, ...over });
const record = (at, lines, over = {}) => ({ v: 1, id: recordId(at, at % 997), at, network: "devnet", coin: "SOL", fee: "0", lines, ...over });

const OCT = Date.UTC(2026, 9, 31, 10, 0);
const NOV = Date.UTC(2026, 10, 19, 15, 30);
const october = record(OCT, [line({ name: "Oleh", note: "October; design" }), line({ name: "Ira", to: B, amount: "0.25", state: "failed", signature: null })]);
const november = record(NOV, [line({ name: "Олег", amount: "1.000000001", note: "=HYPERLINK(\"x\")" }), line({ name: "Anna", to: B, amount: "0.1", how: "link" })], { fee: "0.002" });
const invoice = (id, amount, paid, createdAt = NOV + 1000) => ({ invoice: { id, to: OWNER, mint: RING_SOL, amount, forWhat: "Logo, round 2", createdAt }, paid: paid ? { signature: SIG } : null });

const WORDS = {
  head: ["Date", "Kind", "Name", "Address", "Amount", "Coin", "For", "How", "State", "Transaction"],
  kind: { payout: "Sent", fee: "Fee", invoice: "Received" },
  how: { private: "Private", link: "Link", open: "Open" },
  state: { paid: "Paid", failed: "Not paid", waiting: "Not known" },
};

test("rows: every payout line, the fee where there was one, and only paid invoices — oldest first", () => {
  const rows = reportRows([november, october], [invoice("00000000000000aa", 250000000n, true), invoice("00000000000000bb", 1n, false)]);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.name, r.amount, r.state]),
    [
      ["payout", "Oleh", "0.5", "paid"],
      ["payout", "Ira", "0.25", "failed"],
      ["payout", "Олег", "1.000000001", "paid"],
      ["payout", "Anna", "0.1", "paid"],
      ["fee", null, "0.002", "paid"],
      ["invoice", null, "0.25", "paid"],
    ],
  );
  assert.equal(rowsOfInvoices([invoice("00000000000000cc", 5n, true)])[0].amount, "0.000000005", "smallest units become exact coin text");
  assert.equal(rowsOfInvoices([{ ...invoice("00000000000000dd", 5n, true), invoice: { ...invoice("00000000000000dd", 5n, true).invoice, mint: "Unknown" } }]).length, 0, "a coin the ring does not hold is not guessed");
  const noneGone = record(NOV, [line({ state: "failed", signature: null })], { fee: "0.01" });
  assert.equal(rowsOfPayouts([noneGone]).filter((r) => r.kind === "fee").length, 0, "no fee row when nothing went");
});

test("sums are exact: no float, only what surely went", () => {
  assert.equal(addDecimal("0.1", "0.2"), "0.3");
  assert.equal(addDecimal("1.000000001", "0.999999999"), "2");
  assert.equal(addDecimal("123456789.123456789", "0.000000001"), "123456789.12345679");
  assert.equal(addDecimal("5", "x"), "5");
  const totals = totalsOf(reportRows([november, october], [invoice("00000000000000aa", 250000000n, true)]));
  assert.equal(totals.out.byCoin.get("SOL"), "1.600000001");
  assert.equal(totals.out.count, 3, "the failed line is not counted");
  assert.equal(totals.in.byCoin.get("SOL"), "0.25");
  assert.equal(totals.in.count, 1);
  assert.equal(totals.fee.get("SOL"), "0.002");
});

test("periods are the person's calendar; a row belongs to one period", () => {
  const now = new Date(2026, 10, 20, 12).getTime();
  assert.deepEqual(periodOf("month", now), { from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 11, 1).getTime() });
  assert.deepEqual(periodOf("month", now, -1), { from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 10, 1).getTime() });
  assert.deepEqual(periodOf("month", new Date(2026, 0, 15).getTime(), -1), { from: new Date(2025, 11, 1).getTime(), to: new Date(2026, 0, 1).getTime() }, "January's last month is December");
  assert.deepEqual(periodOf("quarter", now), { from: new Date(2026, 9, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
  assert.deepEqual(periodOf("quarter", now, -4), { from: new Date(2025, 9, 1).getTime(), to: new Date(2026, 0, 1).getTime() });
  assert.deepEqual(periodOf("year", now, -1), { from: new Date(2025, 0, 1).getTime(), to: new Date(2026, 0, 1).getTime() });
  assert.deepEqual(periodOf("month", now, 3), periodOf("month", now), "never past this period");
  assert.equal(periodOf("all", now, -5), ALL_TIME);
  const rows = reportRows([november, october], []);
  const edge = { from: NOV, to: NOV + 1 };
  assert.equal(inPeriod(rows, edge).length, 3, "from is inclusive");
  assert.equal(inPeriod(rows, { from: OCT + 1, to: NOV }).length, 0, "to is exclusive");
});

test("the CSV opens in a sheet: byte-order mark, the sheet's separator and point, exact amounts, no formulas", () => {
  const rows = reportRows([november, october], [invoice("00000000000000aa", 250000000n, true)]);
  const en = reportCsv(rows, WORDS, CSV_STYLE.en);
  assert.ok(en.startsWith("﻿Date,Kind,Name,"), "UTF-8 with its mark, header first");
  assert.ok(en.endsWith("\r\n"));
  const lines = en.slice(1).split("\r\n");
  assert.equal(lines.length, rows.length + 2);
  assert.equal(lines[1], `2026-10-31 10:00,Sent,Oleh,${A},0.5,SOL,October; design,Private,Paid,${SIG}`);
  assert.match(en, /,1\.000000001,SOL,"'=HYPERLINK\(""x""\)",/, "a formula starts as text and the amount keeps every digit");
  assert.match(en, /Not paid,\r\n/, "no transaction for what did not go");
  const uk = reportCsv(rows, WORDS, CSV_STYLE.uk);
  assert.ok(uk.includes(`;Олег;${A};1,000000001;SOL;`), "Ukrainian sheets: «;» between cells and «,» in the number");
  assert.ok(uk.includes(';"October; design";'), "a cell with the separator is quoted");
  assert.equal(csvCell("a,b", ";"), "a,b", "the other sign needs no quotes");
  assert.equal(csvCell("a;b", ";"), '"a;b"');
  assert.equal(csvCell("a\nb", ","), '"a\nb"');
  assert.equal(csvCell("-1", ","), "'-1");
  assert.equal(csvCell(null, ","), "");
  const local = reportCsv(rows.slice(0, 1), WORDS, CSV_STYLE.en, () => 120);
  assert.ok(local.includes("2026-10-31 12:00,"), "local time at the given offset");
});

test("stamps and file names", () => {
  assert.equal(stamp(Date.UTC(2026, 0, 2, 3, 4), 0), "2026-01-02 03:04");
  assert.equal(stamp(Date.UTC(2026, 0, 1, 23, 30), 60), "2026-01-02 00:30");
  assert.equal(reportFileName({ from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 10, 1) }, NOV), "ryntra-report-2026-10-01_2026-10-31.csv");
  assert.equal(reportFileName(ALL_TIME, NOV), "ryntra-report-2026-11-19.csv");
});

const RWORDS = { title: "Payment receipt", date: "Date", from: "From", to: "To", amount: "Amount", forWhat: "For", tx: "Transaction", shows: "SHOWS", hides: "HIDES" };

test("a receipt is one payment from the person's record, with its transaction and nothing of the others", () => {
  const rows = reportRows([october, november], [invoice("00000000000000aa", 250000000n, true)]);
  const [oleh, ira] = rows;
  assert.ok(canReceipt(oleh));
  assert.ok(!canReceipt(ira), "no receipt for what did not go");
  assert.ok(!canReceipt(rows.find((r) => r.kind === "fee")));
  const text = receiptText(oleh, OWNER, RWORDS, "https://explorer/x", 0);
  assert.ok(text.includes(`From: ${OWNER}`));
  assert.ok(text.includes(`To: Oleh · ${A}`));
  assert.ok(text.includes("Amount: 0.5 SOL"));
  assert.ok(text.includes(`Transaction: ${SIG}`));
  assert.ok(text.includes("SHOWS") && text.includes("HIDES"), "what it shows and what it does not — said every time");
  assert.ok(!text.includes("Ira") && !text.includes(B), "no other payment of the same transfer");
  const inv = receiptText(rows.find((r) => r.kind === "invoice"), OWNER, RWORDS, null, 0);
  assert.ok(!inv.includes("From:"), "the payer of an invoice is not in the person's record and is not written");
  assert.equal(receiptText(ira, OWNER, RWORDS, null, 0), null);
  assert.equal(receiptFileName(oleh, 0), `ryntra-receipt-2026-10-31-${SIG.slice(0, 8)}.txt`);
});

test("access: give, give again, take back — a grant taken back gives nothing more", () => {
  const period = { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 10, 1) };
  assert.equal(giveAccess([], { id: "g1", who: "   ", period, at: 1 }), null, "whom is needed");
  assert.equal(giveAccess([], { id: "g1", who: "Iryna", period: { from: 5, to: 5 }, at: 1 }), null, "a period has length");
  let list = giveAccess([], { id: "g1", who: "  Iryna \n Accounting ", period, at: 100 });
  assert.equal(list[0].who, "Iryna Accounting");
  assert.ok(isGrant(JSON.parse(JSON.stringify(list[0]))));
  assert.equal(giveAccess(list, { id: "g1", who: "x", period, at: 1 }), null, "ids do not repeat");
  list = giveAgain(list, "g1", 200);
  assert.deepEqual(list[0].given, [100, 200]);
  list = takeAccess(list, "g1", 300);
  assert.equal(list[0].taken, 300);
  assert.equal(giveAgain(list, "g1", 400), null);
  assert.equal(takeAccess(list, "g1", 500)[0].taken, 300, "taken once");
  assert.equal(cleanWho("x".repeat(80)).length, 60);
  assert.ok(!isGrant({ ...list[0], given: [] }));
  assert.ok(grantId(2, 0) > grantId(1, 9));
});

test("the journal keeps every grant that stands and drops the oldest taken-back ones first", () => {
  const period = { from: 1, to: 2 };
  let list = [];
  for (let i = 0; i < 3; i += 1) list = giveAccess(list, { id: `s${i}`, who: "S", period, at: 10 + i });
  for (let i = 0; i < JOURNAL_KEEP + 5; i += 1) list = takeAccess(giveAccess(list, { id: `g${i}`, who: "W", period, at: 1000 + i }), `g${i}`, 2000 + i);
  assert.ok(list.length <= JOURNAL_KEEP);
  assert.equal(list.filter((g) => g.id.startsWith("s")).length, 3, "grants that stand are never dropped");
  assert.ok(!list.some((g) => g.id === "g0"), "the oldest taken-back one left first");
  list = takeAccess(giveAccess(list, { id: "g10x", who: "W", period, at: 4000 }), "g10x", 5000);
  const joined = mergeJournals(list, [{ v: 1, id: "g10x", who: "W", period, given: [9], taken: null }, { v: 1, id: "new", who: "N", period, given: [9999], taken: null }]);
  assert.equal(joined.find((g) => g.id === "g10x").taken, 5000, "taken in either stays taken");
  assert.deepEqual(joined.find((g) => g.id === "g10x").given, [9, 4000]);
  assert.ok(joined.some((g) => g.id === "new"));
  assert.ok(joined.length <= JOURNAL_KEEP);
  assert.equal(journalOrder(joined)[0].id, "new");
});

test("the record's copy opens only for its wallet and network, and carries no key", () => {
  const inv = { invoice: { id: "00000000000000aa", to: OWNER, mint: RING_SOL, amount: "250000000", forWhat: "Logo", createdAt: 1, expiresAt: 2 }, sinceSlot: "10", fragment: "abc", paid: { signature: SIG, slot: "11", key: "k" } };
  const grant = giveAccess([], { id: "g1", who: "Iryna", period: { from: 1, to: 2 }, at: 3 })[0];
  assert.equal(encodeBackup({ network: "devnet", owner: OWNER, at: 1, payouts: [], invoices: [], access: [] }), null);
  const text = encodeBackup({ network: "devnet", owner: OWNER, at: NOV, payouts: [october, november], invoices: [inv], access: [grant] });
  const parsed = JSON.parse(text);
  assert.equal(parsed.kind, BACKUP_KIND);
  assert.deepEqual(Object.keys(parsed).sort(), ["access", "at", "invoices", "kind", "network", "owner", "payouts", "v"]);
  assert.doesNotMatch(text, /viewing|nullifier|seed|secret/i);
  const back = decodeBackup(`﻿${text}`, "devnet", OWNER);
  assert.equal(back.payouts.length, 2);
  assert.deepEqual(back.invoices, [inv]);
  assert.equal(back.access[0].id, "g1");
  assert.equal(decodeBackup(text, "devnet", A), null, "another wallet");
  assert.equal(decodeBackup(text, "mainnet", OWNER), null, "another network");
  assert.equal(decodeBackup("not json", "devnet", OWNER), null);
  const dirty = JSON.stringify({ ...parsed, payouts: [...parsed.payouts, { v: 9 }], invoices: [...parsed.invoices, { ...inv, invoice: { ...inv.invoice, to: A } }, { invoice: { id: "zz" } }], access: [{ v: 1 }] });
  const clean = decodeBackup(dirty, "devnet", OWNER);
  assert.equal(clean.payouts.length, 2);
  assert.equal(clean.invoices.length, 1, "only this wallet's invoices, only well-formed ones");
  assert.equal(clean.access.length, 0);
  assert.equal(backupFileName(OWNER, "2026-11-20"), "ryntra-record-4EotVU-2026-11-20.json");
});

test("the report sends nothing anywhere: no fetch, no server path in its code", () => {
  const dir = new URL("./", import.meta.url);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const src = readFileSync(new URL(name, dir), "utf8");
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|sendBeacon|\/api\//, name);
  }
});
