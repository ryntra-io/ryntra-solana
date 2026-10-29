// Run from repo root: node --test app/solana/workspace/holdings/portfolio-b5.test.mjs
//
// B5 «Портфель із вкладкою «Винагороди»»: under the holdings, the pools money is taken back from and the receipts;
// beside them «Винагороди» with one number of points — Rewards' own figure, from the same field, by the same words.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ordersHref, pointsScale, poolsShown, receiptRows, rewardsReadOf, rewardsShown, RECEIPT_ROWS } from "./portfolio-model.ts";
import { portfolioWords } from "./portfolio-words.ts";
import { rankCopy } from "../rewards/rank-copy.ts";

const read = (path) => readFileSync(new URL("../../../../" + path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const HOLDINGS = code("app/solana/workspace/holdings/holdings-card.tsx");
const REWARDS = code("app/solana/workspace/holdings/rewards-block.tsx");
const RANK_CARD = code("app/solana/workspace/rewards/rank-card.tsx");
const RECEIPTS = code("app/solana/workspace/holdings/receipts-block.tsx");
const CSS = read("app/solana/workspace/holdings/holdings.module.css");

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function action(id, outcome, updatedAt) {
  return { actionId: id, outcome, updatedAt, lane: "SWAP", out: null, in: null };
}

test("receipts are the newest finished operations, never one on its way or one that failed", () => {
  const rows = receiptRows([
    action("a", "DONE", "2026-10-18T10:00:00.000Z"),
    action("b", "IN_FLIGHT", "2026-10-20T10:00:00.000Z"),
    action("c", "DONE", "2026-10-19T10:00:00.000Z"),
    action("d", "FAILED", "2026-10-20T09:00:00.000Z"),
    action("e", "NEEDS_YOU", "2026-10-20T08:00:00.000Z"),
  ]);
  assert.deepEqual(rows.map((row) => row.actionId), ["c", "a"]);
  const many = Array.from({ length: 9 }, (_, index) => action(`x${index}`, "DONE", `2026-10-1${index}T00:00:00.000Z`));
  assert.equal(receiptRows(many).length, RECEIPT_ROWS);
  assert.equal(receiptRows(many)[0].actionId, "x8");
});

test("the pools block stands when there is money in a pool, or when the read could not say", () => {
  assert.equal(poolsShown({ status: "loading" }), false);
  assert.equal(poolsShown({ status: "idle" }), false);
  assert.equal(poolsShown({ status: "ready", positions: 0, complete: true }), false, "no empty block for a wallet without pools");
  assert.equal(poolsShown({ status: "ready", positions: 2, complete: true }), true);
  assert.equal(poolsShown({ status: "ready", positions: 0, complete: false }), true, "a venue that did not answer is named, not passed over");
  assert.equal(poolsShown({ status: "failed" }), true);
});

test("the money in orders is taken back where the newest open order trades", () => {
  assert.equal(ordersHref([]), "/app/spot");
  const orders = [
    { state: "OPEN", baseMint: "OLD", updatedAt: "2026-10-18T00:00:00.000Z", createdAt: "2026-10-18T00:00:00.000Z" },
    { state: "OPEN", baseMint: "NEW", updatedAt: "2026-10-20T00:00:00.000Z", createdAt: "2026-10-19T00:00:00.000Z" },
    { state: "CANCELLED", baseMint: "GONE", updatedAt: "2026-10-21T00:00:00.000Z", createdAt: "2026-10-21T00:00:00.000Z" },
  ];
  assert.equal(ordersHref(orders), "/app/spot?mint=NEW");
});

test("the points are Rewards' own: the rank's points from /api/rewards, untouched", () => {
  const body = { ok: true, address: WALLET, available: "3.40", rank: { rank: "SILVER", points: "12 480", windowDays: 30 } };
  const ready = rewardsReadOf(200, body, WALLET);
  assert.deepEqual(ready, { status: "ready", points: { points: "12 480", rank: "SILVER", windowDays: 30 }, available: "3.40" });
  /* Drawn by the very words the ring uses: the same figure in both languages. */
  assert.equal(rankCopy("en").number(ready.points.points), "12,480");
  assert.equal(rankCopy("uk").number(ready.points.points).replace(/\D/g, ""), "12480");
  /* Proof missing, a failure, another wallet's answer, a rank not read: never a zero. */
  assert.deepEqual(rewardsReadOf(401, { proof: false }, WALLET), { status: "proof" });
  assert.deepEqual(rewardsReadOf(500, { error: "x" }, WALLET), { status: "failed" });
  assert.deepEqual(rewardsReadOf(200, { ...body, address: "Other1111111111111111111111111111111111111" }, WALLET), { status: "failed" });
  const { address: _dropped, ...unnamed } = body;
  assert.deepEqual(rewardsReadOf(200, unnamed, WALLET), { status: "failed" }, "an answer that names no wallet is no answer");
  assert.deepEqual(rewardsReadOf(200, { ...body, rank: null }, WALLET), { status: "ready", points: null, available: "3.40" });
  assert.deepEqual(rewardsReadOf(200, { ...body, available: "0.00" }, WALLET).available, null);
  assert.deepEqual(rewardsReadOf(200, { ...body, available: "<0.01" }, WALLET).available, "<0.01");
});

test("what «Винагороди» draws: never the last wallet's points, never an endless skeleton", () => {
  const mine = { address: WALLET, value: { status: "ready", points: { points: "480", rank: "BRONZE", windowDays: 30 }, available: null } };
  assert.equal(rewardsShown({ address: null, proof: "proven", read: mine }), null, "no wallet, no block");
  assert.deepEqual(rewardsShown({ address: WALLET, proof: "settling", read: mine }), { status: "loading" });
  assert.deepEqual(rewardsShown({ address: WALLET, proof: "down", read: mine }), { status: "failed" }, "a check that did not answer is named");
  assert.deepEqual(rewardsShown({ address: WALLET, proof: "unproven", read: mine }), { status: "proof" }, "an unproven wallet never sees a kept answer");
  assert.deepEqual(rewardsShown({ address: WALLET, proof: "proven", read: mine }), mine.value);
  const other = "Other1111111111111111111111111111111111111";
  assert.deepEqual(rewardsShown({ address: other, proof: "proven", read: mine }), { status: "loading" }, "a switched wallet waits for its own answer");
});

test("large points are written the way the ring writes them", () => {
  assert.deepEqual(pointsScale("99\u202f999"), { scale: "full" });
  assert.deepEqual(pointsScale("124\u202f560"), { scale: "thousands", value: 124 });
  assert.deepEqual(pointsScale("2\u202f400\u202f000"), { scale: "millions", value: 2 });
  assert.equal(rankCopy("en").thousands(124).figure, "124k");
  assert.match(REWARDS, /copy\.thousands\(scale\.value\)/);
  assert.match(REWARDS, /copy\.millions\(scale\.value\)/);
  assert.match(RANK_CARD, />= 100_000 \? copy\.thousands\(Math\.floor\(whole\(rank\.points\) \/ 1000\)\)/);
});

test("one number of points, read and written as the Rewards ring reads and writes it", () => {
  /* The same field the ring draws, and the same words. */
  assert.match(RANK_CARD, /copy\.number\(rank\.points\)/);
  assert.match(REWARDS, /copy\.number\(points\.points\)/);
  assert.match(REWARDS, /copy\.unit\(points\.points\)/);
  assert.match(REWARDS, /rankCopy\(locale\)/);
  assert.match(REWARDS, /\/api\/rewards\?address=/);
  /* One figure: no lifetime count beside it, nothing summed, nothing claimed here. */
  assert.equal((REWARDS.match(/data-portfolio="points"/g) ?? []).length, 1);
  assert.doesNotMatch(REWARDS, /\.points\.level|lifetime|\/api\/rewards\/claim/);
  /* A claim against Ryntra is said, never added to the value. */
  assert.doesNotMatch(HOLDINGS, /available.*portfolio\.total|portfolio\.total\s*\+/);
  assert.match(REWARDS, /href="\/app\/rewards"/);
});

test("Portfolio holds the positions, the receipts and Rewards in one place", () => {
  assert.match(HOLDINGS, /<MyPositions locale=\{locale\} read=\{pools\} title=\{words\.poolsTitle\} \/>/);
  assert.match(HOLDINGS, /id="portfolio-pools"/);
  assert.match(HOLDINGS, /<ReceiptsBlock activity=\{activity\} onRetry=\{refresh\} \/>/);
  assert.match(HOLDINGS, /<RewardsBlock \/>/);
  assert.doesNotMatch(HOLDINGS, /RewardsSummary/);
  /* The pools are read once, for the value and the block alike. */
  assert.match(HOLDINGS, /const \{ value: portfolio, pools, limits, phoenix \} = usePortfolioValue/);
  /* Receipts open in History, worded by History's lines. */
  assert.match(RECEIPTS, /describeAction\(row, text\)/);
  assert.match(RECEIPTS, /\/app\/activity\?action=\$\{encodeURIComponent\(row\.actionId\)\}/);
  /* No tabs over the page (Menu 3, decision 55) and no network switch on a Solana page (decision 58). */
  assert.doesNotMatch(HOLDINGS + REWARDS + RECEIPTS, /role="tablist"|\bArc\b|EVM/);
  /* The blocks under the holdings stand in the holdings' own column: nothing waits for the side column's height. */
  assert.match(CSS, /\.main \{[^}]*grid-area: holdings;[^}]*flex-direction: column;/);
  assert.ok(HOLDINGS.indexOf("<div className={styles.main}>") < HOLDINGS.indexOf('id="portfolio-holdings"'));
  assert.ok(HOLDINGS.indexOf('id="portfolio-holdings"') < HOLDINGS.indexOf("<div className={styles.below}>"));
  assert.ok(HOLDINGS.indexOf("<div className={styles.below}>") < HOLDINGS.indexOf("<div className={styles.side}>"));
});

test("the words exist in both languages", () => {
  const en = portfolioWords("en");
  const uk = portfolioWords("uk");
  for (const key of Object.keys(en)) {
    assert.ok(key in uk, key);
    if (typeof en[key] === "string") assert.notEqual(en[key], uk[key], `${key} is not translated`);
  }
  assert.equal(uk.rewardsRank("Срібло", rankCopy("uk").window(30)), "Срібло · 30 днів");
  assert.equal(en.rewardsTitle, "Rewards");
  assert.equal(uk.rewardsTitle, "Винагороди");
});
