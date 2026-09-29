import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const history = read("./history-card.tsx");
const receipts = read("../receipts/local-receipts.tsx");
const holdings = read("../holdings/holdings-card.tsx");

test("Portfolio and Activity consume the one wallet-scoped read provider", () => {
  assert.match(history, /useWalletData\(\)/);
  assert.match(holdings, /useWalletData\(\)/);
  assert.doesNotMatch(history, /fetch\("\/api\/solana\/activity"/);
  assert.doesNotMatch(holdings, /fetch\("\/api\/solana\/(?:activity|holdings)"/);
});

test("an activity row opens in the cabinet and scopes its receipt link", () => {
  assert.match(history, /const open = selectedAction !== null/, "Null transaction signatures must not open details without a selection.");
  assert.match(history, /\/app\/activity\?action=\$\{encodeURIComponent\(action\.actionId\)\}/);
  assert.match(history, /\/app\/receipts\?action=\$\{encodeURIComponent\(action\.actionId\)\}/);
  assert.match(receipts, /receiptMatchesFilter\(row, filter, actions\)/);
});

test("routine receipts show operation facts without internal ids or correction reports", () => {
  const localList = receipts.slice(receipts.indexOf("export function LocalReceiptList"));
  assert.doesNotMatch(localList, /receiptId|shortId|Provenance correction recorded|submitter sentence/);
  assert.match(localList, /Operation details/);
  assert.match(localList, /Source transaction/);
  assert.match(localList, /Destination transaction/);
});

test("unknown bridge direction is not narrated as a guessed movement", () => {
  assert.doesNotMatch(history, /Moved between chains/);
  assert.match(history, /action\.destination === "SOLANA"/);
  assert.match(history, /action\.destination === "BASE"/);
});
