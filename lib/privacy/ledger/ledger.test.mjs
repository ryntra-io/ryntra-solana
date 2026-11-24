import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeLedgerCopy, encodeLedgerCopy } from "./copy.ts";
import { contactsOf, isRecord, newestFirst, paidCount, paidTo, recordId, reportCsv, settle, templateOf, unpaidOf } from "./ledger.ts";
import { decodeKeyCopy, linkFragmentsIn } from "../codes.ts";
import { parseList } from "../payouts/list.ts";

const OWNER = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const A = "3WAjyrF65J4mLUm4eaPKtwYRiqT6t1N3WhAwwheyZpw3";
const B = "61AgGzUTxL49Vq1qndTKfL6XZgVRencBdHD5DZtbet8N";
const C = "8WAca8hqqN3XfBGcvgX8mTEKTUQyVAHUNRtyCcbkPo3y";

const line = (over) => ({ name: null, to: A, amount: "0.5", coin: "SOL", note: null, how: "private", state: "paid", signature: "sig1", link: null, ...over });
const record = (at, lines, over = {}) => ({ v: 1, id: recordId(at, at % 997), at, network: "devnet", coin: "SOL", fee: "0", lines, ...over });

const october = record(Date.UTC(2026, 9, 31), [line({ name: "Oleh", to: A, note: "October; design" }), line({ name: "Ira", to: B, amount: "0.25", state: "failed", signature: null })]);
const november = record(Date.UTC(2026, 10, 19), [line({ name: "Oleh", to: C, amount: "1", note: "November" }), line({ name: "Anna", to: B, how: "link", link: C })]);

test("a record is plain JSON this code wrote; anything else is left out", () => {
  assert.ok(isRecord(october));
  assert.ok(isRecord(JSON.parse(JSON.stringify(october))));
  assert.ok(!isRecord({ ...october, v: 2 }));
  assert.ok(!isRecord({ ...october, lines: [{ to: A, amount: 1, state: "paid" }] }));
  assert.ok(!isRecord(null));
  assert.deepEqual(newestFirst([october, november]).map((r) => r.id), [november.id, october.id]);
  assert.ok(recordId(2, 0) > recordId(1, 99), "ids sort by time");
});

test("names the person paid lead to where they were paid last; only paid lines count", () => {
  const contacts = contactsOf([november, october]);
  assert.equal(contacts.get("oleh"), C, "the newest address wins");
  assert.equal(contacts.get("anna"), B);
  assert.equal(contacts.has("ira"), false, "a failed line is not a contact");
  assert.deepEqual([...paidTo([october, november])].sort(), [A, B, C].sort());
});

test("«as last time» is the newest payout as a list, read back the same", () => {
  const text = templateOf([october, november]);
  const rows = parseList(text);
  assert.deepEqual(
    rows.map((r) => [r.name, r.to, r.amount, r.coin, r.note]),
    [
      ["Oleh", C, "1", "SOL", "November"],
      ["Anna", B, "0.5", "SOL", null],
    ],
  );
  assert.equal(templateOf([]), null);
  const again = parseList(unpaidOf(october));
  assert.deepEqual(again.map((r) => [r.name, r.to, r.amount]), [["Ira", B, "0.25"]], "only what did not go");
  // What for with a «;» in it survives the trip.
  assert.equal(parseList(templateOf([october]))[0].note, "October; design");
});

test("a step settles its lines: the signature it landed in, the count of paid", () => {
  const fresh = record(1, [line({ state: "waiting", signature: null }), line({ to: B, state: "waiting", signature: null })]);
  const after = settle(fresh, new Set([0]), "paid", "sigX");
  assert.equal(after.lines[0].signature, "sigX");
  assert.equal(after.lines[1].state, "waiting");
  assert.equal(paidCount(after), 1);
  assert.equal(paidCount(fresh), 0);
});

const WORDS = {
  head: ["Date", "Name", "Address", "Amount", "Coin", "For", "How", "State", "Transaction"],
  how: { private: "Private", link: "Link", open: "Open" },
  state: { paid: "Paid", failed: "Not paid", waiting: "Waiting" },
};

test("the report is a CSV an accountant opens: oldest first, quoted where it must be, never a formula", () => {
  const evil = record(Date.UTC(2026, 10, 20), [line({ name: "=HYPERLINK(\"x\")", note: "+1 bonus, \"cash\"" })]);
  const csv = reportCsv([november, october, evil], WORDS);
  const rows = csv.trim().split("\r\n");
  assert.equal(rows[0], "Date,Name,Address,Amount,Coin,For,How,State,Transaction");
  assert.equal(rows.length, 1 + 2 + 2 + 1);
  assert.ok(rows[1].startsWith("2026-10-31T00:00:00.000Z,Oleh,"), "oldest first");
  assert.ok(rows[1].includes('"October; design"'));
  assert.ok(rows[2].includes(",Not paid,"));
  assert.ok(rows[4].includes(",Link,"));
  assert.ok(rows[5].includes(`'=HYPERLINK(""x"")`), "a formula starts as text");
  assert.ok(rows[5].includes(`"'+1 bonus, ""cash"""`));
});

test("the copy's line opens with the same viewing key, for the same wallet only, and holds nothing in the clear", async () => {
  const viewing = crypto.getRandomValues(new Uint8Array(32));
  const lineText = await encodeLedgerCopy([october, november], "devnet", OWNER, viewing);
  assert.match(lineText, /^rpl1\.devnet\.4Eot[1-9A-HJ-NP-Za-km-z]+\.[A-Za-z0-9_-]+$/);
  for (const secret of ["Oleh", "Anna", A, B, "November", "0.25"]) assert.ok(!lineText.includes(secret), `«${secret}» is sealed`);
  const file = `Ryntra private balance — key copy\n\nrpk1.devnet.${OWNER}.xyz\n${lineText}\n`;
  const back = await decodeLedgerCopy(file, "devnet", OWNER, viewing);
  assert.deepEqual(back, newestFirst([october, november]));
  assert.equal(await decodeLedgerCopy(file, "devnet", A, viewing), null, "another wallet");
  assert.equal(await decodeLedgerCopy(file, "devnet", OWNER, crypto.getRandomValues(new Uint8Array(32))), null, "other keys");
  const cut = file.replace(/(rpl1\.[^\n]+)[A-Za-z0-9_-]{4}\n/, "$1\n");
  assert.equal(await decodeLedgerCopy(cut, "devnet", OWNER, viewing), null, "a cut line");
  assert.equal(await encodeLedgerCopy([], "devnet", OWNER, viewing), null, "nothing to keep");
  // The key copy's own readers do not take the line for theirs.
  assert.equal(await decodeKeyCopy(lineText), null);
  assert.deepEqual(linkFragmentsIn(lineText), []);
});

test("the record is sealed by the private balance's own vault and never leaves the browser", () => {
  const store = readFileSync(new URL("./store.client.ts", import.meta.url), "utf8");
  assert.match(store, /from '\.\.\/vault\.client\.ts'/);
  for (const path of ["./store.client.ts", "./ledger.ts", "./copy.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|sendBeacon|localStorage/, `${path} sends or stores nothing in the clear`);
  }
});
