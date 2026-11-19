import assert from "node:assert/strict";
import test from "node:test";

/* Meteora DLMM Pro's pools as the screens read them: which side is the coin, the pair's name, the depth in
   dollars, «Liquidity by price» in the coin's own terms, a per cent of basis points. */

const { coinSideOf, coinPriceIn, pairOf, tvlUsdOf, byDepth, isProPoolsAnswer, tickerOf } = await import("../../lib/pro-pools/model.ts");
const { distributionOf, pctOfBps } = await import("./pool-view.ts");

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const coin = (mint, symbol, decimals, usd) => ({ mint, symbol, name: symbol, decimals, icon: null, verified: true, usd });

test("the coin of a pair is the side that is not SOL or a dollar; between two such, the one priced in the other", () => {
  assert.equal(coinSideOf({ x: coin(MET, "MET", 6, 0.27), y: coin(SOL, "SOL", 9, 74) }), "x");
  assert.equal(coinSideOf({ x: coin(SOL, "SOL", 9, 74), y: coin(MET, "MET", 6, 0.27) }), "y");
  assert.equal(coinSideOf({ x: coin(JITO, "JitoSOL", 9, 97), y: coin(SOL, "SOL", 9, 74) }), "x");
  assert.equal(coinSideOf({ x: coin(SOL, "SOL", 9, 74), y: coin(USDC, "USDC", 6, 1) }), "x", "SOL against a dollar is SOL's market");
  assert.equal(coinSideOf({ x: coin(USDC, "USDC", 6, 1), y: coin(SOL, "SOL", 9, 74) }), "y");
  const row = { x: coin(SOL, "SOL", 9, 74), y: coin(MET, "MET", 6, 0.27), price: 272 };
  assert.equal(pairOf(row).name, "MET / SOL");
  assert.ok(Math.abs(coinPriceIn(row) - 1 / 272) < 1e-12, "the coin's price in SOL is the pool's turned over");
  assert.equal(tickerOf({ symbol: null, mint: MET }), "METv…");
});

test("the depth is both vaults at their dollar prices, and unknown where either part is", () => {
  assert.equal(tvlUsdOf(coin(MET, "MET", 6, 0.25), coin(SOL, "SOL", 9, 100), "4000000", "2000000000"), 201);
  assert.equal(tvlUsdOf(coin(MET, "MET", 6, null), coin(SOL, "SOL", 9, 100), "4000000", "2000000000"), null);
  assert.equal(tvlUsdOf(coin(MET, "MET", 6, null), coin(SOL, "SOL", 9, 100), "0", "2000000000"), 200, "an empty side needs no price");
  assert.equal(tvlUsdOf(coin(MET, "MET", 6, 1), coin(SOL, "SOL", 9, 100), null, "1"), null);
  const rows = [{ address: "b", tvlUsd: null }, { address: "a", tvlUsd: 5 }, { address: "c", tvlUsd: 50 }];
  assert.deepEqual([...rows].sort(byDepth).map((row) => row.address), ["c", "a", "b"]);
  assert.equal(isProPoolsAnswer({ pools: [] }), true);
  assert.equal(isProPoolsAnswer({ pools: [{ address: "x" }] }), false);
});

const bins = (side) => ({
  venue: "pro",
  pool: "P",
  x: { mint: MET, decimals: 6 },
  y: { mint: SOL, decimals: 9 },
  stepBps: 128,
  activeId: 0,
  price: 0.0036,
  bins: Array.from({ length: 81 }, (_, i) => {
    const offset = i - 40;
    const price = 0.0036 * Math.pow(1.0128, offset);
    // SOL under the price, MET over it, both on the price's own step; nothing beyond ten steps.
    const x = offset >= 0 && offset <= 8 ? "100000000" : "0";
    const y = offset <= 0 && offset >= -10 ? "500000000" : "0";
    return { offset, id: offset * 128, price, x, y };
  }),
  market: { gapPct: null },
  rent: null,
  ...(side ? {} : {}),
});

test("«Liquidity by price»: the span that holds liquidity, cheapest first, the price's own step both coins", () => {
  const view = distributionOf(bins(), "x");
  assert.ok(view);
  assert.ok(view.columns.length >= 21, "never fewer than the fewest columns");
  assert.ok(view.columns.length <= 10 + 8 + 1 + 6, "the empty steps far from the liquidity are left out");
  for (let i = 1; i < view.columns.length; i++) assert.ok(view.columns[i].price > view.columns[i - 1].price, "cheapest first");
  const here = view.columns.find((column) => column.side === "both");
  assert.ok(here, "the price's own step holds both");
  assert.ok(view.columns.some((column) => column.side === "quote" && column.price < here.price), "SOL under the price");
  assert.ok(view.columns.some((column) => column.side === "coin" && column.price > here.price), "MET over it");
  assert.ok(view.herePct > 0 && view.herePct < 100);
  assert.equal(Math.max(...view.columns.map((column) => column.share)), 1);
  // The same pool told from SOL's side: SOL's price in MET, cheapest first, the sides swapped.
  const turned = distributionOf(bins(), "y");
  for (let i = 1; i < turned.columns.length; i++) assert.ok(turned.columns[i].price > turned.columns[i - 1].price);
  assert.ok(Math.abs(turned.price - 1 / 0.0036) < 1e-6);
  assert.equal(distributionOf({ ...bins(), bins: [] }, "x"), null);
});

test("basis points as a per cent", () => {
  assert.equal(pctOfBps(60), "0.6%");
  assert.equal(pctOfBps(150), "1.5%");
  assert.equal(pctOfBps(1), "0.01%");
  assert.equal(pctOfBps(0.4), "0.004%");
  assert.equal(pctOfBps(3124.2), "31.2%");
});

test("a price in the other coin, short: four significant digits under one, two places from one up", async () => {
  const { quoteFigure } = await import("./pool-view.ts");
  assert.equal(quoteFigure(0.003644926), "0.003645");
  assert.equal(quoteFigure(72.550287), "72.55");
  assert.equal(quoteFigure(1.31081), "1.311", "four figures at least");
  assert.equal(quoteFigure(1.31081, 1), "1.3108", "five on a step of a hundredth of a per cent");
  assert.equal(quoteFigure(0.0036488534, 129), "0.003649");
  assert.equal(quoteFigure(1.383e-7, 100), "0.0₆1383", "a run of zeros folded as the chart folds it, never «1.383e-7»");
  assert.equal(quoteFigure(25_000.4), "25,000");
  assert.equal(quoteFigure(0), "—");
});

/* Any pool's page: a DLMM Pro pool, a DLMM pool, a DAMM v2 pool; the pair's other pools; the ticket's tabs. */

const { deskOfPro, deskOfCatalog, deskOfBins, pairPools, pairGroups, carriedTab, ticketTabs, proOffer, previewPier, poolHref, poolHasPage, binsVenueOf, VENUE_MARK } = await import("./desk-pool.ts");
const { proKnown, proOffered } = await import("../../city/lib/earn/pro.ts");

const proRow = (over = {}) => ({
  address: "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d",
  kind: "static",
  x: coin(MET, "MET", 6, 0.27),
  y: coin(SOL, "SOL", 9, 74),
  price: 0.0036,
  tickSpacing: 128,
  stepBps: 128.8,
  fee: { totalBps: 150, baseBps: 150, dynamicBps: 0, mode: "fixed", protocolShareBps: 2000, collectedIn: "output" },
  bonusBps: 60,
  reserves: { xRaw: "1", yRaw: "1" },
  tvlUsd: 585,
  rewards: 0,
  open: { swap: true, deposits: true },
  ...over,
});
const SOL_USDC = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const catalogPool = (over = {}) => ({
  kind: "dlmm",
  address: SOL_USDC,
  x: { mint: SOL, symbol: "SOL", verified: true },
  y: { mint: USDC, symbol: "USDC", verified: true },
  tvlUsd: 3_040_000,
  volume24hUsd: 19_300_000,
  fees24hUsd: 7_770,
  feeTvl24hPct: 0.25,
  baseFeePct: 0.04,
  feePct: 0.0409,
  binStepBps: 4,
  createdAt: null,
  page: `https://app.meteora.ag/dlmm/${SOL_USDC}`,
  ...over,
});

test("a pool's page reads any of Meteora's pools as one shape: DLMM Pro from its program, DLMM from the catalogue and its bins", () => {
  const pro = deskOfPro(proRow());
  assert.deepEqual([pro.venue, pro.feePct, pro.stepBps, pro.page, pro.pro.bonusBps], ["pro", 1.5, 128.8, null, 60]);
  assert.equal(VENUE_MARK[pro.venue], "Meteora DLMM Pro");
  const bins = { venue: "dlmm", pool: SOL_USDC, x: { mint: SOL, decimals: 9 }, y: { mint: USDC, decimals: 6 }, stepBps: 4, activeId: 0, price: 73.84, bins: [], market: { price: null, gapPct: null }, rent: null, at: "2026-11-18T00:00:00.000Z" };
  const before = deskOfCatalog(catalogPool(), null);
  assert.deepEqual([before.venue, before.price, before.x.decimals, before.tvlUsd, before.fees24hUsd, before.page !== null], ["dlmm", null, 0, 3_040_000, 7_770, true], "the price waits for the pool's own bins");
  const after = deskOfCatalog(catalogPool(), bins);
  assert.deepEqual([after.price, after.x.decimals, after.y.decimals], [73.84, 9, 6]);
  assert.equal(deskOfCatalog(catalogPool(), { ...bins, pool: "another" }).price, null, "another pool's bins are never this one's");
  assert.equal(pairOf(after).name, "SOL / USDC");
  const damm = deskOfCatalog(catalogPool({ kind: "damm-v2", binStepBps: null }), null);
  assert.deepEqual([damm.venue, binsVenueOf(damm.venue), binsVenueOf("dlmm"), binsVenueOf("pro")], ["damm", null, "dlmm", "pro"]);
  const lone = deskOfBins({ ...bins, pool: "P1" });
  assert.deepEqual([lone.venue, lone.address, lone.x.symbol, lone.y.symbol, lone.tvlUsd], ["dlmm", "P1", "SOL", null, null], "a pool the catalogue does not list: its bins alone");
});

test("the pair's pools: DLMM Pro's and the catalogue's alike, whichever way round, the deepest first, the page's own marked", () => {
  const here = deskOfPro(proRow());
  const pro = [proRow(), proRow({ address: "9fkq", tvlUsd: 55 }), proRow({ address: "other", x: coin(USDC, "USDC", 6, 1) })];
  const catalog = [catalogPool({ address: "dlmmMET", x: { mint: SOL, symbol: "SOL", verified: true }, y: { mint: MET, symbol: "MET", verified: true }, tvlUsd: 3_900_000 }), catalogPool()];
  const pools = pairPools(here, pro, catalog);
  assert.deepEqual(
    pools.map((row) => [row.address, row.venue, row.here]),
    [
      ["dlmmMET", "dlmm", false],
      ["JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d", "pro", true],
      ["9fkq", "pro", false],
    ],
  );
  assert.equal(pairPools(here, [proRow()], []).length, 1, "a pair of one pool has nothing to pick");
  assert.deepEqual(pools.map((row) => row.bonusBps), [null, 60, 60], "a Pro pool carries its limit bonus; DLMM has no limits");
});

test("the picker's groups: DLMM Pro first, then DLMM, then DAMM v2, each the deepest first; a turn keeps the swap and the position", () => {
  const here = deskOfPro(proRow());
  const pro = [proRow(), proRow({ address: "9fkq", tvlUsd: 55 })];
  const catalog = [
    catalogPool({ address: "dlmmMET", x: { mint: SOL, symbol: "SOL", verified: true }, y: { mint: MET, symbol: "MET", verified: true }, tvlUsd: 813_000 }),
    catalogPool({ address: "dlmmMET2", x: { mint: MET, symbol: "MET", verified: true }, y: { mint: SOL, symbol: "SOL", verified: true }, tvlUsd: 162_000 }),
    catalogPool({ address: "dammMET", kind: "damm-v2", x: { mint: MET, symbol: "MET", verified: true }, y: { mint: SOL, symbol: "SOL", verified: true }, tvlUsd: 900_000, binStepBps: null }),
  ];
  const groups = pairGroups(pairPools(here, pro, catalog));
  assert.deepEqual(
    groups.map((group) => [group.venue, group.pools.map((row) => row.address)]),
    [
      ["pro", ["JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d", "9fkq"]],
      ["dlmm", ["dlmmMET", "dlmmMET2"]],
      ["damm", ["dammMET"]],
    ],
  );
  assert.deepEqual(pairGroups(pairPools(here, pro, [])).map((group) => group.venue), ["pro"], "a kind with no pool is no group");
  assert.deepEqual(
    [carriedTab("swap", "dlmm"), carriedTab("position", "dlmm"), carriedTab("position", "damm"), carriedTab("limit", "dlmm"), carriedTab("limit", "pro"), carriedTab(null, "pro")],
    ["swap", "position", null, null, null, null],
    "a limit, or the first tab, gives way to the other pool's own first",
  );
});

test("the ticket's tabs, Meteora's order: a Pro pool opens on its limits, a DLMM pool on its position where Earn adds to it and else on its swap; a DAMM v2 pool shows a position only with a form", () => {
  assert.deepEqual(ticketTabs({ venue: "pro", ladder: true, trade: true, adds: true }), { tabs: ["position", "limit", "swap"], first: "limit" });
  assert.deepEqual(ticketTabs({ venue: "pro", ladder: false, trade: true, adds: true }), { tabs: ["position", "swap"], first: "position" });
  assert.deepEqual(ticketTabs({ venue: "pro", ladder: true, trade: true, adds: true, empty: true }), { tabs: ["position", "limit", "swap"], first: "position" }, "an empty pool opens on its first position");
  assert.deepEqual(ticketTabs({ venue: "dlmm", ladder: true, trade: true, adds: false }), { tabs: ["position", "swap"], first: "swap" }, "limit orders rest in DLMM Pro only; a pool not added to from here opens on its swap, never on «soon»");
  assert.deepEqual(ticketTabs({ venue: "dlmm", ladder: false, trade: true, adds: true }), { tabs: ["position", "swap"], first: "position" }, "a pool Earn adds to opens on its position");
  assert.deepEqual(ticketTabs({ venue: "dlmm", ladder: false, trade: false, adds: false }), { tabs: ["position"], first: "position" });
  assert.deepEqual(ticketTabs({ venue: "damm", ladder: false, trade: true, adds: false }), { tabs: ["swap"], first: "swap" });
  assert.deepEqual(ticketTabs({ venue: "damm", ladder: false, trade: false, adds: false }), { tabs: [], first: null });
  assert.equal(poolHref("P"), "/pool/P");
  assert.equal(poolHref("P", "position"), "/pool/P?tab=position");
  assert.deepEqual([poolHasPage("pro", false), poolHasPage("dlmm", false), poolHasPage("damm-v2", false), poolHasPage("damm-v2", true)], [true, true, false, true]);
});

test("a DLMM Pro pool's position: the form where it is served and offered, the form without its signature where not yet, a line where there is no SOL", () => {
  assert.equal(proOffer(proRow(), true, true), "ticket");
  assert.equal(proOffer(proRow(), true, false), "preview", "served, but the terminal does not offer it yet");
  assert.equal(proOffer(proRow(), false, false), "preview", "not served: the form to try");
  assert.equal(proOffer(proRow({ y: coin(USDC, "USDC", 6, 1) }), false, false), "soon", "no SOL side: an opening is paid in SOL");
  const pier = previewPier(proRow());
  assert.deepEqual([pier.solIsX, pier.x.symbol, pier.y.symbol, pier.feeBps, pier.tickSpacing, pier.takesDeposits, pier.rewards.length, pier.depthLamports], [false, "MET", "SOL", 150, 128, false, 0, null]);
  assert.ok(Math.abs((Math.pow(1.0001, pier.tickId) * 10 ** (6 - 9)) / 0.0036 - 1) < 0.001, "the tick the price stands in");
  assert.equal(previewPier(proRow({ y: coin(USDC, "USDC", 6, 1) })), null);
  assert.equal(previewPier(proRow({ price: 0 })), null);
  assert.equal(previewPier(proRow({ x: coin(MET, "AVERYLONGTICKER", 6, 1) })).x.symbol.length, 10, "a ticker as long as the contract takes");
});

test("a pier is offered where Earn checked its coin, or where the terminal's switch opens any pool; devnet's stand as served", () => {
  const pier = (other) => ({ address: "P", x: { mint: other, symbol: "X", decimals: 6 }, y: { mint: SOL, symbol: "SOL", decimals: 9 }, solIsX: false, price: 1, feeBps: 1, tickSpacing: 1, tickId: 0, depthLamports: null, rewards: [], takesDeposits: true });
  assert.equal(proKnown(pier(USDC)), true);
  assert.equal(proKnown(pier(JITO)), true);
  assert.equal(proKnown(pier(MET)), false);
  assert.equal(proOffered(pier(MET), "mainnet", false), false, "closed by default");
  assert.equal(proOffered(pier(MET), "mainnet", true), true);
  assert.equal(proOffered(pier(USDC), "mainnet", false), true);
  assert.equal(proOffered(pier(MET), "devnet", false), true);
});

/* The QA of 19.11 night: DLMM Pro's list in order, and the names a person should not meet first. */

test("the list: MET/SOL first, the city's empty pool second and never first, «Active» without test, crude and look-alike names", async () => {
  const { proListRows, proInvites, proQuiet } = await import("./pool-view.ts");
  const at = (n) => `${String(n).padStart(2, "0")}${"1".repeat(42)}`;
  const named = (n, symbol, name, tvlUsd, verified = true) => proRow({ address: at(n), x: { ...coin(`M${n}${"1".repeat(41)}`, symbol, 6, 1), name, verified }, tvlUsd });
  const met = proRow({ tvlUsd: 590 });
  const jito = proRow({ address: "EBEQoUmLTYoBMLShvubK7RBniYyx9CyLLos221c1u1kW", x: coin(JITO, "JitoSOL", 9, 97), tvlUsd: 0 });
  const bp = named(2, "BP", "Backpack", 147);
  const hold = named(3, "HOLDFAST", "Holdfast", 593, null);
  const butt = named(4, "BUTTHOLE", "Butthole", 3.7, null);
  const test1 = named(5, "TEST", "Test Token", 10, null);
  const twin = named(6, "Nеil", "Nеil The Lеmur", 2.6, null);
  const nameless = proRow({ address: at(7), x: { ...coin(`M7${"1".repeat(42)}`, null, 6, null), verified: null }, tvlUsd: null });
  const dust = named(8, "Rings", "Rings", 0, null);
  const rows = [hold, met, bp, butt, test1, twin, nameless, dust, jito];
  const adds = (row) => row.address === jito.address;
  const active = proListRows(rows, { which: "deep", adds, deepUsd: 1 }).map((row) => row.x.symbol);
  assert.deepEqual(active, ["MET", "JitoSOL", "BP", "HOLDFAST"], "the deepest verified pool first, the city's empty pool next, then by trust and depth");
  const every = proListRows(rows, { which: "every", adds, deepUsd: 1 }).map((row) => row.x.symbol);
  assert.equal(every[0], "MET");
  assert.equal(every[1], "JitoSOL");
  assert.equal(every.length, rows.length, "«All» keeps every pool");
  assert.deepEqual(every.slice(-4).sort(), ["BUTTHOLE", "Nеil", "TEST", null].sort(), "the quiet names last");
  assert.equal(proInvites(jito, { adds, deepUsd: 1 }), true);
  assert.equal(proInvites(met, { adds, deepUsd: 1 }), false);
  assert.equal(proInvites({ ...jito, tvlUsd: 900 }, { adds, deepUsd: 1 }), false, "a city's pool with liquidity stands by its depth");
  assert.deepEqual(proListRows([met, { ...jito, tvlUsd: 900 }], { which: "deep", adds, deepUsd: 1 }).map((row) => row.x.symbol), ["JitoSOL", "MET"]);
  assert.deepEqual([proQuiet(met), proQuiet(butt), proQuiet(test1), proQuiet(twin), proQuiet(nameless)], [null, "crude", "test", "lookalike", "unnamed"]);
  assert.equal(proQuiet(named(9, "S0L", "Not Solana", 5)), "lookalike", "a known ticker in other letters");
  assert.equal(proQuiet(named(10, "TTWO", "Take-Two Interactive", 23)), null);
  assert.equal(proQuiet(named(11, "BASS", "Classic Bass", 5)), null, "a short crude word counts only as a word of its own");
});

test("a range's edges and the price between them: as many figures as the step needs, one column of places, zeros folded", async () => {
  const { edgeTexts } = await import("../earn/range/model.ts");
  const { foldZeros, stepSignificant } = await import("../ui/figures.ts");
  assert.deepEqual(edgeTexts(1.30636, 1.3154, 1.31081, 1), { low: "1.3064", now: "1.3108", high: "1.3154" }, "JitoSOL «Wide»: never «1.31 – 1.32», never «Min 1.31 = Now 1.31»");
  assert.deepEqual(edgeTexts(0.002967, 0.004502, 0.0036488534, 128.8), { low: "0.002967", now: "0.003649", high: "0.004502" }, "MET/SOL: «Now» as the head says it");
  assert.deepEqual(edgeTexts(1.2e-7, 1.6e-7, 1.383e-7, 100), { low: "0.0₆1200", now: "0.0₆1383", high: "0.0₆1600" });
  assert.deepEqual(edgeTexts(149.04, 150.96, 150, 4), { low: "149.04", now: "150.00", high: "150.96" });
  assert.deepEqual([stepSignificant(1), stepSignificant(0.9999999999998899), stepSignificant(128.8), stepSignificant(5), stepSignificant(null)], [5, 5, 4, 5, 4]);
  assert.deepEqual([foldZeros("0.0000001383"), foldZeros("0.0001383"), foldZeros("0.003649"), foldZeros("12.5")], ["0.0₆1383", "0.0001383", "0.003649", "12.5"]);
});
