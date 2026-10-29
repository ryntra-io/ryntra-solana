// Run from repo root: node --test app/solana/workspace/holdings/portfolio-phoenix.test.mjs
//
// SOL-C6 «Портфель — правда грошей» (UX-600, UX-604): Portfolio shows the Phoenix collateral inside «Загальна вартість»
// and, where the wallet has open positions on Phoenix, their entry, mark and result with how near liquidation the
// account is — on the account read «Your Phoenix account» makes. Read only: no action, no receipt, no route moves here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { phoenixShown } from "./portfolio-model.ts";
import { portfolioWords } from "./portfolio-words.ts";

const read = (path) => readFileSync(new URL("../../../../" + path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const HOLDINGS = code("app/solana/workspace/holdings/holdings-card.tsx");
const BLOCK = code("app/solana/workspace/holdings/phoenix-block.tsx");
const HOOK = code("app/app/use-portfolio-value.ts");

test("«На Phoenix» is drawn only for an account with an open position", () => {
  assert.equal(phoenixShown(null), false);
  assert.equal(phoenixShown({ state: "none", positions: [] }), false);
  assert.equal(phoenixShown({ state: "active", positions: [] }), false, "collateral alone stays a line of the value");
  assert.equal(phoenixShown({ state: "active", positions: [{ symbol: "SOL-PERP" }] }), true);
});

test("the value and the block read the one Phoenix account read «Perps» makes", () => {
  assert.match(HOOK, /useFuturesAccount\(owner, COLLATERAL_POLL_MS\)/);
  assert.match(HOLDINGS, /const \{ value: portfolio, pools, limits, phoenix \} = usePortfolioValue\(/);
  assert.match(HOLDINGS, /<PhoenixBlock read=\{phoenix\} locale=\{locale\} \/>/);
});

test("entry, mark and result are the Perps page's own: its words and its formula", () => {
  assert.match(BLOCK, /unrealisedPnl\(row, markOf\(row\.symbol\)\)/);
  for (const key of ["market", "side", "size", "entry", "mark", "pnl", "collateral", "risk"]) assert.match(BLOCK, new RegExp(`w\\("${key}"\\)`), key);
  assert.match(BLOCK, /risk\.\$\{tier\}/, "how near liquidation stays in sight");
  assert.match(BLOCK, /href="\/app\/perps"/);
});

test("the block moves no money: no signature, no send, no receipt", () => {
  assert.doesNotMatch(BLOCK, /signTransaction|signMessage|sendTransaction|useWallet|recordSolanaAction|fetch\(/);
});

test("its words in both languages", () => {
  assert.equal(portfolioWords("en").phoenixTitle, "On Phoenix");
  assert.equal(portfolioWords("uk").phoenixTitle, "На Phoenix");
  assert.equal(portfolioWords("uk").phoenixOpen, "Відкрити Perps");
  assert.equal(portfolioWords("en").phoenixOpen, "Open Perps");
});
