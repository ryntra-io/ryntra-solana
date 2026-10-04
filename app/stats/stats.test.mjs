// Run from repo root: node --test app/stats/stats.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { STATS_COPY } from "./copy.ts";
import { buildLedgerStats, buildOnchainStats, chainAttributionOf, decimalText, symbolOfMint } from "../../lib/attribution/stats-model.ts";
import { PUBLIC_PAGES } from "../sitemap.ts";
import { HOMEPAGE_COPY } from "../../lib/site/homepage-copy.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const STOCK = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const OWNER = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const SIG = (seed) => seed.padEnd(88, "A");

/** A chain read shaped like `lib/attribution/chain.server.ts` answers, with three operations. */
function chainRead() {
  return {
    ok: true,
    ruleVersion: "1.1.0",
    referralAccount: "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv",
    readAt: "2026-09-15T10:00:00.000Z",
    sources: ["a.example", "b.example"],
    accounts: [
      { address: "55p9Zk8tzq6YhnPgopW5X1sX5kHX1v1zuRiQNwqa5hYH", mint: USDC, decimals: 6, amountRaw: "2500" },
      { address: "A3QWi67fFpQ2PrGXghjLMQdWAkHeN43NbFp9FxpCeorY", mint: WSOL, decimals: 9, amountRaw: "223300" },
    ],
    ryntraShareBps: 8000,
    totals: {
      operations: 3,
      wallets: 2,
      valued: 2,
      unvalued: 1,
      volumeUsdMicros: "1507814",
      fees: [
        { mint: USDC, decimals: 6, grossRaw: "2500", ryntraRaw: "2000", operations: 1 },
        { mint: WSOL, decimals: 9, grossRaw: "223300", ryntraRaw: "178640", operations: 2 },
      ],
      first: { signature: SIG("first"), slot: 1, blockTime: 1_788_000_000 },
      last: { signature: SIG("last"), slot: 3, blockTime: 1_788_300_000 },
    },
    coverage: { complete: true, signaturesSeen: 4, transactionsRead: 4, transactionsMissing: 0, truncated: false, mismatches: [] },
    operations: [
      { signature: SIG("first"), slot: 1, blockTime: 1_788_000_000, taker: OWNER, feeCredits: [{ mint: WSOL, decimals: 9, amountRaw: "50000" }], legs: [{ mint: USDC, decimals: 6, deltaRaw: "1007814" }], valueUsdMicros: "1007814" },
      { signature: SIG("stock"), slot: 2, blockTime: 1_788_100_000, taker: OWNER, feeCredits: [{ mint: USDC, decimals: 6, amountRaw: "2500" }], legs: [{ mint: USDC, decimals: 6, deltaRaw: "-500000" }, { mint: STOCK, decimals: 8, deltaRaw: "231926" }], valueUsdMicros: "500000" },
      { signature: SIG("last"), slot: 3, blockTime: 1_788_300_000, taker: "someone", feeCredits: [{ mint: WSOL, decimals: 9, amountRaw: "173300" }], legs: [{ mint: WSOL, decimals: 9, deltaRaw: "-1" }], valueUsdMicros: null },
    ],
  };
}

function action(over) {
  return {
    schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet: OWNER, actionId: SIG("first"), lane: "SWAP", outcome: "DONE",
    out: { mint: WSOL, amountRaw: "10000000", decimals: null, symbol: null }, in: { mint: USDC, amountRaw: "1007814", decimals: null, symbol: null }, destination: null,
    signature: SIG("first"), receiptHash: null, sourceTx: null, destinationTx: null,
    fee: { collected: true, basisPoints: 50, amountRaw: "50000", decimals: null, symbol: null, usd: null, asset: WSOL, providerRaw: "10000", ryntraRaw: "40000", state: "COLLECTED", note: null },
    origin: null, providerRef: "req-1", statedUsd: null, startedAt: "2026-09-15T09:00:00.000Z", updatedAt: "2026-09-15T09:00:02.000Z", ...over,
  };
}

test("the on-chain block is the chain read, with exact decimal fees, the share as a percent and the boundary as a date", () => {
  const block = buildOnchainStats(chainRead(), { stockMints: new Set([STOCK]), internalWallets: new Set([OWNER]) });
  assert.equal(block.state, "ok");
  assert.equal(block.operations, 3);
  assert.equal(block.wallets, 2);
  assert.equal(block.volumeUsd, 1.507814);
  assert.equal(block.since, new Date(1_788_000_000 * 1000).toISOString());
  assert.deepEqual(block.fees.map((fee) => [fee.symbol, fee.gross, fee.ryntra, fee.operations]), [["USDC", "0.0025", "0.002", 1], ["SOL", "0.0002233", "0.00017864", 2]]);
  assert.equal(block.ryntraSharePercent, 80);
  assert.deepEqual(block.own, { operations: 2, wallets: 1 }, "Ryntra's own wallet is counted in and named, never dropped");
  assert.deepEqual(block.stocks, { state: "ok", operations: 1, volumeUsd: 0.5, unvalued: 0 });
  assert.deepEqual(block.tokenAccounts.map((account) => account.symbol), ["USDC", "SOL"]);
  assert.equal(block.coverage.complete, true);
});

test("a chain read that failed is an unavailable block, not a block of zeros", () => {
  const block = buildOnchainStats({ ok: false, code: "UNREACHABLE", reason: "no endpoint" }, { stockMints: null, internalWallets: new Set() });
  assert.deepEqual(block, { state: "unavailable", code: "UNREACHABLE" });
  const noUniverse = buildOnchainStats(chainRead(), { stockMints: null, internalWallets: new Set() });
  assert.deepEqual(noUniverse.stocks, { state: "unavailable" }, "no universe means no stock split, not zero stock operations");
  assert.equal(chainAttributionOf({ ok: false, code: "UNREACHABLE", reason: "no endpoint" }), null);
});

test("the ledger block is the live count — confirmed rows only, once each, masked, verified against the chain read", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const chain = chainAttributionOf(chainRead());
  assert.deepEqual([chain.readAt, chain.complete, chain.signatures.size], ["2026-09-15T10:00:00.000Z", true, 3]);
  const block = buildLedgerStats(
    {
      actions: [
        action({}),
        action({}),
        action({ actionId: SIG("stock"), signature: SIG("stock"), origin: { surface: "SPOT", side: "BUY" }, out: { mint: USDC, amountRaw: "500000", decimals: null, symbol: null }, in: { mint: STOCK, amountRaw: "231926", decimals: null, symbol: null }, fee: { collected: true, basisPoints: 50, amountRaw: "2500", decimals: null, symbol: null, usd: null, asset: USDC, providerRaw: "500", ryntraRaw: "2000", state: "COLLECTED", note: null }, startedAt: "2026-09-15T11:30:00.000Z", updatedAt: "2026-09-15T11:30:02.000Z" }),
        action({ actionId: SIG("fresh"), signature: SIG("fresh"), startedAt: "2026-09-15T11:59:00.000Z", updatedAt: "2026-09-15T11:59:02.000Z" }),
        action({ actionId: SIG("open"), signature: SIG("open"), outcome: "IN_FLIGHT", in: null, fee: null }),
        action({ actionId: SIG("send"), lane: "SEND", signature: SIG("send"), in: null, fee: null }),
      ],
      orders: new Map(),
      stockMints: new Set([STOCK]),
      internalWallets: new Set([OWNER]),
      names: { [STOCK]: { symbol: "NVDAx", decimals: 8 } },
      chain,
    },
    now,
  );
  assert.equal(block.state, "ok");
  assert.equal(block.operations.length, 3, "two in flight or transfer rows and one duplicate are not operations");
  assert.deepEqual(block.operations.map((row) => [row.product, row.wallet, row.verification]), [["SWAP", "4MS4…fQ1n", "PENDING"], ["STOCK", "4MS4…fQ1n", "VERIFIED"], ["SWAP", "4MS4…fQ1n", "VERIFIED"]]);
  assert.equal(block.operations[1].action, "Buy NVDAx");
  assert.equal(block.operations[1].links[0].url, `https://solscan.io/tx/${SIG("stock")}`);
  assert.equal("plan" in block.operations[0], false, "the public row carries no plan id");
  assert.deepEqual([block.summary.all.operations, block.summary.all.volumeUsd, block.summary.all.wallets], [3, 2.515628, 1]);
  assert.deepEqual(block.summary.all.attributable, { operations: 2, volumeUsd: 1.507814 });
  assert.deepEqual(block.summary["24h"].operations, 3);
  assert.equal(block.summary.all.byProduct.STOCK.operations, 1);
  assert.equal(block.truncated, 0);
  assert.deepEqual(buildLedgerStats(null, now), { state: "unavailable" });
});

test("decimal text is exact and symbols are known for the fee assets", () => {
  assert.equal(decimalText("1235854", 9), "0.001235854");
  assert.equal(decimalText("26870", 6), "0.02687");
  assert.equal(decimalText("1000000", 6), "1");
  assert.equal(decimalText("0", 9), "0");
  assert.equal(symbolOfMint(WSOL), "SOL");
  assert.equal(symbolOfMint(USDC), "USDC");
  assert.equal(symbolOfMint(STOCK), "Xsc9…9qEh");
});

test("both languages carry every sentence, and no internal vocabulary reaches the page", () => {
  const forbidden = /RYN-[A-Z]+-\d|canon|WIP|gate|handoff|Dune|DefiLlama|hackathon|competition|grant|task|RPC|referral account balance|methodology rule/i;
  for (const locale of ["en", "uk"]) {
    const copy = STATS_COPY[locale];
    const text = JSON.stringify(copy, (key, value) => (typeof value === "function" ? value(1, 1, 1) : value));
    assert.doesNotMatch(text, forbidden, `${locale}: internal vocabulary on a public page`);
    assert.equal(copy.method.rule.length, 5);
    for (const key of ["title", "lead"]) assert.ok(copy[key].length > 8, `${locale}.${key}`);
    assert.ok(copy.eyebrow.length > 2);
    for (const product of ["ALL", "SWAP", "SPOT", "STOCK", "BRIDGE"]) assert.ok(copy.products[product], `${locale}: product ${product}`);
    for (const range of ["24h", "7d", "30d", "all"]) assert.ok(copy.ranges[range], `${locale}: range ${range}`);
    for (const state of ["VERIFIED", "PENDING", "NOT_ATTRIBUTABLE", "NOT_APPLICABLE"]) {
      assert.ok(copy.feed.verification[state] && copy.feed.verificationLong[state], `${locale}: verification ${state}`);
    }
    for (const provider of ["JUPITER", "RELAY", "MAYAN", "CIRCLE"]) assert.ok(copy.feed.detail.providers[provider], `${locale}: provider ${provider}`);
  }
  assert.doesNotMatch(STATS_COPY.en.title + STATS_COPY.en.lead, /[А-Яа-яІіЇїЄє]/, "the English copy is English");
  assert.match(STATS_COPY.uk.title, /[А-Яа-яІіЇїЄє]/, "the Ukrainian copy is Ukrainian");
  for (const file of ["app/stats/page.tsx", "app/stats/stats-content.tsx", "app/stats/stats.css"]) {
    assert.doesNotMatch(read(file), /RYN-[A-Z]+-\d|hackathon|competition/i, `${file}: internal vocabulary`);
  }
});

test("the page is on the frozen chrome, follows the reader's language, is in the sitemap and in the site's one menu; the methodology is a disclosure", () => {
  const page = read("app/stats/page.tsx");
  assert.match(page, /PublicHeader locale=\{locale\}/);
  assert.match(page, /FrozenFooter locale=\{locale\}/);
  assert.match(page, /PUBLIC_LOCALE_COOKIE/);
  assert.match(page, /readPublicStats\(\)/);
  assert.match(page, /force-dynamic/, "rendered per request: the ledger is read live");
  const content = read("app/stats/stats-content.tsx");
  assert.match(content, /ryntra:public-locale/, "the content follows the header's language switch");
  assert.match(content, /solscan\.io\/account\//, "the referral account and the fee accounts link to an explorer");
  assert.match(content, /<details className="rx-stats-method">/, "the methodology sits behind one disclosure");
  assert.match(content, /filterOperations\(rows, \{ product, range, now \}\)/, "the feed and the totals come from the same filtered rows");
  assert.match(content, /summarizeOperations\(rows, \{ product, range, now \}\)/);
  assert.match(content, /row\.links\[0\]/, "every row carries its proof link");
  assert.doesNotMatch(content, /\d{2,}\.\d+ ?(USDC|SOL)/, "no figure typed into the markup");
  assert.ok(PUBLIC_PAGES.some((entry) => entry.path === "/stats"), "the sitemap lists /stats");
  for (const locale of ["en", "uk"]) {
    assert.ok(HOMEPAGE_COPY[locale].footer.links.some((link) => link.href === "/stats"), `${locale}: /stats is in the one menu`);
  }
});

test("the JSON route serves the same model and lets the edge keep it for seconds, not minutes", () => {
  const route = read("app/api/stats/route.ts");
  assert.match(route, /readPublicStats\(\)/);
  assert.match(route, /s-maxage=5, stale-while-revalidate=10/);
  assert.doesNotMatch(route, /s-maxage=600/, "the ten-minute edge cache is gone: a confirmed operation is visible within seconds");
  assert.doesNotMatch(route, /getAdminSession|cookies\(/, "public and unauthenticated");
});
