import assert from "node:assert/strict";
import test from "node:test";

import { RECEIPT_KINDS, issueReceipt, projectReceiptIndex } from "./receipt.ts";

const outcome = (overrides = {}) => ({
  observedAt: "2026-08-22T18:00:00.000Z",
  observedBy: "Paper book",
  authoritative: true,
  book: "PAPER",
  effects: ["Closed at 440.00 for +280.00."],
  realizedAmount: "280.00",
  realizedCurrency: "USD",
  ...overrides,
});

const input = (overrides = {}) => ({
  caseId: "adv_abc123abc123",
  actionRef: "paper:t1",
  subjectLabel: "TSLA-USD",
  outcome: outcome(),
  ...overrides,
});

test("no receipt exists before an authoritative observed outcome", () => {
  assert.equal(issueReceipt(input({ outcome: null })), null);
  assert.equal(issueReceipt(input({ outcome: outcome({ authoritative: false }) })), null);
});

test("an authoritative outcome issues exactly one receipt, carrying its observer", () => {
  const receipt = issueReceipt(input());
  assert.ok(receipt);
  assert.equal(receipt.caseId, "adv_abc123abc123");
  assert.equal(receipt.actionRef, "paper:t1");
  assert.equal(receipt.observedBy, "Paper book");
  assert.equal(receipt.observedAt, "2026-08-22T18:00:00.000Z");
  assert.match(receipt.receiptId, /^rcp_[0-9a-f]{12}$/);
  assert.match(receipt.integrity, /^0x[0-9a-f]{16}$/);
});

test("a paper receipt is typed as a simulated outcome and a live one as a venue fill", () => {
  assert.equal(issueReceipt(input()).kind, "PAPER_SIMULATED_OUTCOME");
  assert.equal(
    issueReceipt(input({ outcome: outcome({ book: "LIVE", observedBy: "Arcus" }) })).kind,
    "VENUE_OBSERVED_FILL",
  );
  for (const kind of RECEIPT_KINDS) assert.ok(kind.length > 0);
});

test("the same outcome always issues the same receipt", () => {
  assert.deepEqual(issueReceipt(input()), issueReceipt(input()));
  assert.notEqual(issueReceipt(input()).receiptId, issueReceipt(input({ actionRef: "paper:t2" })).receiptId);
});

test("a changed outcome changes the integrity digest", () => {
  const first = issueReceipt(input());
  const second = issueReceipt(input({ outcome: outcome({ realizedAmount: "281.00" }) }));
  assert.notEqual(first.integrity, second.integrity);
});

test("the index separates the books and never totals across them", () => {
  const index = projectReceiptIndex([
    input(),
    input({ caseId: "adv_222222222222", actionRef: "arcus:fill:f1", outcome: outcome({ book: "LIVE", observedBy: "Arcus", realizedAmount: "61.40" }) }),
  ]);
  assert.deepEqual(index.books.map((book) => book.book), ["LIVE", "PAPER"]);
  assert.deepEqual(index.books.map((book) => book.count), [1, 1]);
  assert.equal(index.count, 2);
  /* A count is not money. There is deliberately no combined realized figure:
     adding a simulated result to a real one produces a number that describes
     nothing that happened. */
  assert.equal("total" in index, false);
  assert.equal("realizedTotal" in index, false);
  for (const book of index.books) assert.equal("realizedTotal" in book, false);
});

test("a case with no receipt is recorded as a refusal with its reason", () => {
  const index = projectReceiptIndex([
    input({ outcome: null }),
    input({ caseId: "adv_333333333333", actionRef: "paper:t9", outcome: outcome({ authoritative: false, observedBy: "an expectation" }) }),
  ]);
  assert.equal(index.count, 0);
  assert.equal(index.refusals.length, 2);
  for (const refusal of index.refusals) assert.ok(refusal.reason.length > 20);
  assert.match(index.refusals[0].reason, /authoritative|observed/i);
});

test("the index is deterministic and ordered newest first inside each book", () => {
  const entries = [
    input({ caseId: "adv_aaaaaaaaaaaa", actionRef: "paper:a" }),
    input({ caseId: "adv_bbbbbbbbbbbb", actionRef: "paper:b", outcome: outcome({ observedAt: "2026-08-23T09:00:00.000Z" }) }),
  ];
  const index = projectReceiptIndex(entries);
  assert.deepEqual(index.books[0].receipts.map((receipt) => receipt.actionRef), ["paper:b", "paper:a"]);
  assert.deepEqual(projectReceiptIndex([...entries].reverse()), index);
});

test("an empty index is empty rather than absent", () => {
  const index = projectReceiptIndex([]);
  assert.deepEqual(index.books, []);
  assert.deepEqual(index.refusals, []);
  assert.equal(index.count, 0);
});
