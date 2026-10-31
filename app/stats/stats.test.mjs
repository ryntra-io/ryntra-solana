// Run from repo root: node --test app/stats/stats.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { STATS_COPY } from "./copy.ts";
import { buildLedgerStats, buildOnchainStats, chainAttributionOf, decimalText, symbolOfMint } from "../../lib/attribution/stats-model.ts";
import { AWAITING_CITY, CITY_PAGES } from "../../city/lib/open/site-map.ts";
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
  const forbidden = /RYN-[A-Z]+-\d|gate|handoff|Dune|DefiLlama|hackathon|competition|grant|task|RPC|referral account balance|methodology rule/i;
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

test("the page is on the frozen chrome, follows the reader's language, is in the site's one menu (out of the sitemap until the city draws it); the methodology is a disclosure", () => {
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
  assert.match(content, /filterOperations\(rows, \{ product, range, now \}\)/, "the feed is the filtered rows");
  assert.match(content, /ledger\.summaries\[product\]\[range\]/, "the totals are the server's, for the same filter");
  assert.match(content, /row\.links\[0\]/, "every row carries its proof link");
  assert.doesNotMatch(content, /\d{2,}\.\d+ ?(USDC|SOL)/, "no figure typed into the markup");
  /* Out of the sitemap and the index while it is the old page (CITY-159), until the city's Stats window takes it over. */
  assert.ok(!CITY_PAGES.some((entry) => entry.path === "/stats"), "the sitemap does not list /stats yet");
  assert.ok(AWAITING_CITY.includes("/stats"), "it answers noindex meanwhile");
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

/* ---------------------------------------------------------------------------
 * Fees, revenue and rewards in dollars; product × network.
 * ------------------------------------------------------------------------- */

const RELAY_SOURCE = `0x${"ab".repeat(32)}`;

function moneyLedger() {
  const now = new Date("2026-10-04T12:00:00.000Z");
  const swap = action({
    actionId: SIG("solfee"),
    signature: SIG("solfee"),
    /* 1 USDC in, 0.008 SOL out; 40,000 lamports of fee in SOL, 32,000 of them Ryntra's. */
    out: { mint: USDC, amountRaw: "1000000", decimals: 6, symbol: "USDC" },
    in: { mint: WSOL, amountRaw: "8000000", decimals: 9, symbol: "SOL" },
    fee: { collected: true, basisPoints: 50, amountRaw: "40000", decimals: 9, symbol: "SOL", usd: null, asset: WSOL, providerRaw: "8000", ryntraRaw: "32000", state: "COLLECTED", note: null },
    startedAt: "2026-10-04T10:00:00.000Z",
    updatedAt: "2026-10-04T10:00:02.000Z",
  });
  const stock = action({
    actionId: SIG("usdcfee"),
    signature: SIG("usdcfee"),
    out: { mint: USDC, amountRaw: "2000000", decimals: 6, symbol: "USDC" },
    in: { mint: STOCK, amountRaw: "1000", decimals: 8, symbol: "NVDAx" },
    fee: { collected: true, basisPoints: 50, amountRaw: "10000", decimals: 6, symbol: "USDC", usd: null, asset: USDC, providerRaw: "2000", ryntraRaw: "8000", state: "COLLECTED", note: null },
    startedAt: "2026-10-04T10:10:00.000Z",
    updatedAt: "2026-10-04T10:10:02.000Z",
  });
  const meme = action({
    actionId: SIG("meme"),
    signature: SIG("meme"),
    /* SOL for a token: no stablecoin leg, so the SOL fee has no dollar figure. */
    out: { mint: WSOL, amountRaw: "10000000", decimals: 9, symbol: "SOL" },
    in: { mint: "MemeMint1111111111111111111111111111111111", amountRaw: "5", decimals: 6, symbol: "MEME" },
    fee: { collected: true, basisPoints: 50, amountRaw: "50000", decimals: 9, symbol: "SOL", usd: null, asset: WSOL, providerRaw: "10000", ryntraRaw: "40000", state: "COLLECTED", note: null },
    startedAt: "2026-10-04T10:20:00.000Z",
    updatedAt: "2026-10-04T10:20:02.000Z",
  });
  const bridge = action({
    actionId: "intent-1",
    lane: "CROSS_SWAP",
    signature: null,
    sourceTx: RELAY_SOURCE,
    out: { mint: null, amountRaw: "5000000", decimals: 6, symbol: "USDC" },
    in: { mint: null, amountRaw: "40000000", decimals: 9, symbol: "SOL" },
    fee: { collected: true, basisPoints: 25, amountRaw: "12552", decimals: 6, symbol: "USDC", usd: 0.012549, asset: "USDC", providerRaw: "0", ryntraRaw: "12552", state: "COLLECTED", note: null },
    providerRef: null,
    startedAt: "2026-10-04T10:30:00.000Z",
    updatedAt: "2026-10-04T10:30:05.000Z",
  });
  return {
    now,
    source: {
      actions: [swap, stock, meme, bridge],
      orders: new Map([["intent-1", { provider: "RELAY", sourceChain: "base", destinationChain: "solana", sourceTxHash: RELAY_SOURCE, destinationTxHash: null }]]),
      stockMints: new Set([STOCK]),
      internalWallets: new Set(),
      names: {},
      chain: null,
      rewards: new Map([
        [SIG("solfee"), { cashbackUsd: 0.0025, friendsUsd: 0.0005, unvalued: 0 }],
        [RELAY_SOURCE, { cashbackUsd: 0.006274, friendsUsd: 0, unvalued: 0 }],
        [SIG("meme"), { cashbackUsd: 0, friendsUsd: 0, unvalued: 1 }],
      ]),
    },
  };
}

test("a fee is stated in dollars by one rule — the provider's figure, a stablecoin at par, or the operation's own execution rate — and never priced later", () => {
  const { now, source } = moneyLedger();
  const block = buildLedgerStats(source, now);
  const byAction = Object.fromEntries(block.operations.map((row) => [row.action, row]));
  const swap = byAction["USDC → SOL"];
  assert.equal(swap.network, "solana");
  assert.deepEqual([swap.fee.valueUsd, swap.fee.valueBasis, swap.fee.ryntraUsd], [0.005, "EXECUTION_RATE", 0.004], "0.00004 SOL at the trade's own 125 USDC per SOL");
  const stock = byAction["Buy NVDAx"];
  assert.deepEqual([stock.fee.valueUsd, stock.fee.valueBasis, stock.fee.ryntraUsd], [0.01, "PAR", 0.008]);
  const meme = byAction["SOL → MEME"];
  assert.deepEqual([meme.fee.valueUsd, meme.fee.valueBasis, meme.fee.ryntraUsd], [null, null, null], "no stablecoin leg: counted in SOL, no dollar figure");
  const bridge = byAction["Base → Solana"];
  assert.equal(bridge.network, "base", "a bridge's network is where the person paid");
  assert.deepEqual([bridge.fee.valueUsd, bridge.fee.valueBasis, bridge.fee.ryntraUsd], [0.012549, "PROVIDER_STATED", 0.012549]);
  for (const row of block.operations) assert.equal("rewards" in row, false, "what one trader's referrer earned on one trade is never public");
  assert.equal(block.summaries.BRIDGE.all.money.cashbackUsd, 0.006274, "the bridge's cashback matched by its source transaction");
  assert.equal(block.summaries.STOCK.all.money.cashbackUsd, 0, "no reward rows for an operation adds nothing");
});

test("a fee no rule above values takes the reward ledger's own valuation at settlement — cashback over its rate", async () => {
  const { projectOperations } = await import("../../lib/analytics/operations.ts");
  const { now, source } = moneyLedger();
  const meme = source.actions.find((entry) => entry.actionId === SIG("meme"));
  const [record] = projectOperations({ ...source, actions: [meme], rewards: new Map([[SIG("meme"), { cashbackUsd: 0.0031, friendsUsd: 0, unvalued: 0, feeUsd: 0.0062 }]]) });
  assert.deepEqual([record.fee.valueUsd, record.fee.valueBasis, record.fee.ryntraUsd], [0.0062, "REWARD_LEDGER", 0.00496]);
  void now;
});

test("the overview and the product × network table come from the same rows: fees, what Ryntra kept, cashback, friends and revenue", async () => {
  const { now, source } = moneyLedger();
  const { projectOperations, summarizeOperations } = await import("../../lib/analytics/operations.ts");
  /* The arithmetic; what the public model withholds is the next test. */
  const all = summarizeOperations(projectOperations(source), { now });
  assert.deepEqual(all.money, {
    feesUsd: 0.027549,
    feesUnvalued: 1,
    retainedUsd: 0.024549,
    retainedUnvalued: 1,
    cashbackUsd: 0.008774,
    rewardsUnvalued: 1,
    revenueUsd: 0.015775,
    revenueExcluded: 1,
  });
  assert.deepEqual(
    all.breakdown.map((row) => [row.product, row.network, row.operations, row.volumeUsd, row.feesUsd, row.feesUnvalued, row.revenueUsd, row.cashbackUsd, row.wallets]),
    [
      ["BRIDGE", "base", 1, 5, 0.012549, 0, 0.006275, 0.006274, 1],
      ["STOCK", "solana", 1, 2, 0.01, 0, 0.008, 0, 1],
      ["SWAP", "solana", 2, 1, 0.005, 1, 0.0015, 0.0025, 1],
    ],
  );
  const sum = (key) => Math.round(all.breakdown.reduce((total, row) => total + row[key], 0) * 1e6) / 1e6;
  assert.equal(sum("feesUsd"), all.money.feesUsd);
  assert.equal(sum("revenueUsd"), all.money.revenueUsd);
  assert.equal(all.breakdown.reduce((total, row) => total + row.operations, 0), all.operations);
  assert.equal(buildLedgerStats(source, now).rewards, "ok");
  const { rewards: _rewards, ...withoutRewards } = source;
  void _rewards;
  assert.equal(buildLedgerStats(withoutRewards, now).rewards, "unavailable", "a reward ledger that did not answer is said, not drawn as zeros");
});

test("cashback and friends are read from the reward ledger by the reference each reward names; a claim is not an earning", async () => {
  const { rewardsByOperation } = await import("../../lib/attribution/rewards.ts");
  const base = { rateBps: 5000, shareRaw: "1", valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: "USDC", observedAt: "2026-10-04T10:00:03.000Z" }, createdAt: "2026-10-04T10:00:03.000Z", claimId: null, signature: null };
  const source = { mechanism: "JUPITER_REFERRAL", operationRef: SIG("solfee"), trader: OWNER, grossRaw: "10000", asset: USDC, symbol: "USDC", decimals: 6, settledAt: "2026-10-04T10:00:02.000Z" };
  const map = rewardsByOperation([
    { ...base, type: "CASHBACK", recipient: OWNER, usdMicros: "5000", source },
    { ...base, type: "REFERRAL_L1", recipient: "Referrer111111111111111111111111111111111", rateBps: 1000, usdMicros: "1000", source },
    { ...base, type: "REFERRAL_L2", recipient: "Referrer222222222222222222222222222222222", rateBps: 500, usdMicros: null, source },
    { ...base, type: "CLAIM", recipient: OWNER, rateBps: 0, shareRaw: null, usdMicros: "-5000", source: null, claimId: "c1", signature: SIG("payout") },
  ]);
  assert.deepEqual([...map.entries()], [[SIG("solfee"), { cashbackUsd: 0.005, friendsUsd: 0.001, unvalued: 0, feeUsd: 0.01 }]], "the gross fee is the cashback over its 50 %; an unvalued friends' reward is not counted — how many there are would say how many inviters");
});

test("the page draws the registry's published rows and links the JSON; the breakdown and the registry are tables", () => {
  const content = read("app/stats/stats-content.tsx");
  assert.match(content, /model\.registry\.rows/);
  assert.match(content, /href="\/api\/stats\/registry"/);
  assert.match(content, /summary\.breakdown\.map/);
  assert.match(content, /rx-stats-breakdown/);
  assert.match(content, /rx-stats-registry/);
  for (const locale of ["en", "uk"]) {
    const words = STATS_COPY[locale];
    for (const key of ["product", "network", "operations", "volume", "fees", "revenue", "cashback", "users"]) assert.ok(words.breakdown.columns[key], `${locale}: breakdown ${key}`);
    for (const role of ["FEE", "PAYOUT_CASHBACK", "PAYOUT_FRIENDS", "PAYOUT_INTEGRATORS", "PAYOUT_REWARDS", "TREASURY"]) assert.ok(words.registry.roles[role], `${locale}: role ${role}`);
  }
  assert.deepEqual(Object.values(STATS_COPY.uk.products), ["Усі", "Обмін", "Спот", "Акції", "Лаунч", "Міст"], "the Ukrainian page names the products in Ukrainian");
});

test("a dollar at par is decided by the mint: a token that calls itself USDC values nothing", async () => {
  const { projectOperations } = await import("../../lib/analytics/operations.ts");
  const { source } = moneyLedger();
  const fake = action({
    actionId: SIG("fakeusdc"),
    signature: SIG("fakeusdc"),
    out: { mint: WSOL, amountRaw: "10000000", decimals: 9, symbol: "SOL" },
    in: { mint: "FakeUsdc11111111111111111111111111111111111", amountRaw: "100000000000000", decimals: 6, symbol: "USDC" },
    fee: { collected: true, basisPoints: 50, amountRaw: "50000", decimals: 9, symbol: "SOL", usd: null, asset: WSOL, providerRaw: "10000", ryntraRaw: "40000", state: "COLLECTED", note: null },
  });
  const [record] = projectOperations({ ...source, actions: [fake], rewards: new Map() });
  assert.deepEqual([record.fee.valueUsd, record.fee.valueBasis], [null, null], "no execution rate against a counterfeit dollar");
  const usdcFee = action({ actionId: SIG("fakefee"), signature: SIG("fakefee"), fee: { collected: true, basisPoints: 50, amountRaw: "1000000", decimals: 6, symbol: "USDC", usd: null, asset: "FakeUsdc11111111111111111111111111111111111", providerRaw: "0", ryntraRaw: "1000000", state: "COLLECTED", note: null } });
  const [paid] = projectOperations({ ...source, actions: [usdcFee], rewards: new Map() });
  assert.notEqual(paid.fee.valueBasis, "PAR", "a fee in a counterfeit USDC is not at par");
});

test("friends' rewards say who invited whom: no public summary carries them, as a sum or as a count, in any window", () => {
  const { now, source } = moneyLedger();
  const block = buildLedgerStats(source, now);
  assert.equal(block.summaries.ALL.all.money.revenueUsd, 0.015775, "revenue is after cashback only, the same half for everyone: always stated");
  const text = JSON.stringify(block);
  assert.doesNotMatch(text, /friends|invited/i, "nothing about friends' rewards reaches the public model");
});

test("without the reward ledger cashback and revenue are unknown in the model, never what reached Ryntra", () => {
  const { now, source } = moneyLedger();
  const { rewards: _rewards, ...withoutRewards } = source;
  void _rewards;
  const block = buildLedgerStats(withoutRewards, now);
  assert.deepEqual([block.summary.all.money.cashbackUsd, block.summary.all.money.revenueUsd], [null, null]);
  assert.ok(block.summaries.SWAP["7d"].breakdown.every((line) => line.cashbackUsd === null && line.revenueUsd === null));
});
