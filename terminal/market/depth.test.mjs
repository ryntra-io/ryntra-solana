import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEPTH } from "./depth-words.ts";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  KINDS,
  KIND_TABS,
  LISTS,
  MAIN_COLUMNS,
  ageParts,
  companyOf,
  exchangeOpen,
  filtersFor,
  buyShare,
  countText,
  depthRows,
  filtersOn,
  fitColumns,
  isRisky,
  logoAlso,
  logoChain,
  logoOf,
  nextSort,
  passes,
  readSum,
  riskFacts,
  sumField,
  timePath,
  dayLine,
} from "./depth-view.ts";

const NOW = Date.parse("2026-11-16T20:00:00Z");
const stats = (change, extra = {}) => ({ change, volume: 1000, buys: 30, sells: 10, traders: 12, ...extra });
const coin = (over = {}) => ({
  id: "So11111111111111111111111111111111111111112",
  symbol: "AAA",
  name: "Aaa",
  icon: "https://static.jup.ag/a.png",
  price: 2,
  mcap: 2_000_000,
  liquidity: 200_000,
  holders: 5_000,
  organic: 80,
  verified: true,
  stock: false,
  stable: false,
  launchpad: null,
  venue: null,
  copyOf: null,
  bornAt: "2026-11-15T20:00:00Z",
  mint: "off",
  freeze: "off",
  topHolders: 20,
  stats: { "5m": stats(0.5), "1h": stats(1), "6h": stats(-3), "24h": stats(100) },
  ...over,
});
const view = (over = {}) => ({ filters: DEFAULT_FILTERS, window: "1h", sort: DEFAULT_SORT, query: "", now: NOW, ...over });
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("decision 109: «Hide risky» stands on and «Verified only» off by default", () => {
  assert.equal(DEFAULT_FILTERS.hideRisky, true);
  assert.equal(DEFAULT_FILTERS.verified, false);
  assert.equal(filtersOn(DEFAULT_FILTERS), 0);
  // A new coin nobody verified, with nothing against it, stands in the list.
  assert.equal(passes(coin({ verified: false }), DEFAULT_FILTERS, "1h", NOW), true);
  assert.equal(passes(coin({ verified: false }), { ...DEFAULT_FILTERS, verified: true }, "1h", NOW), false);
});

test("risky is a coin that borrows a name, or one nobody verified with a fact against it; a verified coin keeps its facts and stays", () => {
  assert.deepEqual(riskFacts(coin()), []);
  assert.deepEqual(riskFacts(coin({ mint: "on", freeze: "on" })), ["mint", "freeze"]);
  assert.deepEqual(riskFacts(coin({ topHolders: 61, liquidity: 4_000, holders: 40 })), ["top", "thin", "few"]);
  assert.deepEqual(riskFacts(coin({ copyOf: "Bitcoin" })), ["copy"]);
  // Unmeasured is not a fact.
  assert.deepEqual(riskFacts(coin({ mint: null, freeze: null, topHolders: null, liquidity: null, holders: null })), []);
  // cbBTC: its issuer keeps both rights; it is verified and stays.
  assert.equal(isRisky(coin({ mint: "on", freeze: "on" })), false);
  assert.equal(isRisky(coin({ verified: false, freeze: "on" })), true);
  assert.equal(isRisky(coin({ copyOf: "HYPE", verified: false })), true);
  assert.equal(passes(coin({ verified: false, liquidity: 3_000 }), DEFAULT_FILTERS, "1h", NOW), false);
  assert.equal(passes(coin({ verified: false, liquidity: 3_000 }), { ...DEFAULT_FILTERS, hideRisky: false }, "1h", NOW), true);
});

test("liquidity and market cap from — to; volume and holders from; a bound never passes a figure Jupiter did not measure", () => {
  const f = { ...DEFAULT_FILTERS, liquidity: { min: 50_000, max: 500_000 }, holders: 1_000 };
  assert.equal(passes(coin(), f, "1h", NOW), true);
  assert.equal(passes(coin({ liquidity: 900_000 }), f, "1h", NOW), false);
  assert.equal(passes(coin({ liquidity: null }), f, "1h", NOW), false);
  assert.equal(passes(coin({ holders: 10 }), f, "1h", NOW), false);
  assert.equal(filtersOn(f), 2);
  const v = coin({ stats: { "5m": stats(-1, { volume: 10 }), "1h": stats(2, { volume: 50_000 }), "6h": null, "24h": stats(1) } });
  assert.equal(passes(v, { ...DEFAULT_FILTERS, volume: 10_000 }, "1h", NOW), true);
  assert.equal(passes(v, { ...DEFAULT_FILTERS, volume: 10_000 }, "5m", NOW), false);
  assert.equal(passes(coin({ mcap: 20_000_000 }), { ...DEFAULT_FILTERS, mcap: { min: null, max: 10_000_000 } }, "1h", NOW), false);
});

test("age: younger than an hour, a day or a week; where it was launched — a launchpad, or Ryntra by the Pulse's own launches", () => {
  assert.equal(passes(coin(), { ...DEFAULT_FILTERS, age: "7d" }, "1h", NOW), true);
  assert.equal(passes(coin(), { ...DEFAULT_FILTERS, age: "1h" }, "1h", NOW), false);
  assert.equal(passes(coin({ bornAt: null }), { ...DEFAULT_FILTERS, age: "7d" }, "1h", NOW), false);
  assert.equal(passes(coin({ venue: "pump" }), { ...DEFAULT_FILTERS, venue: "pump" }, "1h", NOW), true);
  assert.equal(passes(coin({ venue: "launchlab" }), { ...DEFAULT_FILTERS, venue: "pump" }, "1h", NOW), false);
  const ours = new Set(["So11111111111111111111111111111111111111112"]);
  assert.equal(passes(coin(), { ...DEFAULT_FILTERS, venue: "ryntra" }, "1h", NOW, ours), true);
  assert.equal(passes(coin(), { ...DEFAULT_FILTERS, venue: "ryntra" }, "1h", NOW), false);
  assert.deepEqual(ageParts(86_400_000 * 400), { n: 13, unit: "mo" });
  assert.deepEqual(ageParts(30 * 60_000), { n: 30, unit: "min" });
});

test("a sum reads as a person types it, and a bound shows short", () => {
  assert.equal(readSum("50K"), 50_000);
  assert.equal(readSum("$1.2M"), 1_200_000);
  assert.equal(readSum("2 млн"), 2_000_000);
  assert.equal(readSum("1,5k"), 1_500);
  assert.equal(readSum("1,000"), 1_000);
  assert.equal(readSum("1,000,000"), 1_000_000);
  assert.equal(readSum("$2,500.5"), 2_501);
  assert.equal(readSum("1.000.000"), 1_000_000);
  assert.equal(readSum("1.5M"), 1_500_000);
  assert.equal(readSum("10 000"), 10_000);
  assert.equal(readSum(""), null);
  assert.equal(readSum("abc"), undefined);
  assert.equal(readSum("-5"), undefined);
  assert.equal(sumField(50_000), "50K");
  assert.equal(sumField(1_200_000), "1.2M");
  assert.equal(sumField(null), "");
});

test("the tabs are kinds of asset, the view is quiet beside them", () => {
  assert.deepEqual(KINDS, ["all", "meme", "crypto", "stock", "preipo"]);
  assert.deepEqual(KIND_TABS, ["all", "meme", "crypto", "stock", "preipo", "saved"]);
  assert.deepEqual(LISTS, ["trending", "gainers", "losers", "traded"]);
  // Each kind's main set tells it: a meme by its market, a coin by its price, a company's token by its company.
  assert.ok(MAIN_COLUMNS.meme.includes("top") && MAIN_COLUMNS.meme.includes("bs") && !MAIN_COLUMNS.meme.includes("price"));
  assert.deepEqual(MAIN_COLUMNS.crypto.filter((c) => ["price", "move", "day", "volume", "mcap", "liquidity", "holders"].includes(c)), ["price", "move", "day", "volume", "mcap", "liquidity", "holders"]);
  assert.deepEqual(MAIN_COLUMNS.stock.filter((c) => !["n", "coin", "quick", "star"].includes(c)), ["price", "day", "volume", "mcap"]);
  assert.deepEqual(MAIN_COLUMNS.preipo.filter((c) => !["n", "coin", "quick", "star"].includes(c)), ["price", "day", "volume", "liquidity"]);
  assert.equal(companyOf("NVIDIA xStock"), "NVIDIA");
  assert.equal(companyOf("OpenAI PreStocks"), "OpenAI");
  assert.equal(companyOf("Tesla - Backpack Securities"), "Tesla");
  assert.equal(companyOf("SpaceX (Ondo Tokenized)"), "SpaceX");
  assert.equal(companyOf("Jupiter"), "Jupiter");
});

test("a meme's filter never cuts another kind: «Launched on» and age leave stocks, pre-IPO and crypto whole", () => {
  const f = { ...DEFAULT_FILTERS, venue: "pump", age: "1h" };
  assert.deepEqual(filtersFor(f, "meme"), f);
  assert.equal(filtersFor(f, "crypto").venue, "all");
  assert.equal(filtersFor(f, "crypto").age, "1h");
  assert.deepEqual([filtersFor(f, "stock").venue, filtersFor(f, "stock").age], ["all", "any"]);
  assert.deepEqual([filtersFor(f, "preipo").venue, filtersFor(f, "preipo").age], ["all", "any"]);
  const screen = read("./DepthMarket.tsx");
  assert.ok(screen.includes("r.coins.length === 0 && kind !== tab"), "a tab is hidden by an empty market, never by a filter");
});

test("the exchange's mark reads New York's hours: weekdays 9:30 to 16:00", () => {
  assert.equal(exchangeOpen(Date.parse("2026-11-17T15:00:00Z")), true); // Tuesday 10:00 in New York
  assert.equal(exchangeOpen(Date.parse("2026-11-17T14:00:00Z")), false); // 9:00
  assert.equal(exchangeOpen(Date.parse("2026-11-17T21:30:00Z")), false); // 16:30
  assert.equal(exchangeOpen(Date.parse("2026-11-15T15:00:00Z")), false); // Sunday
});

test("a column sorts, turns round, then gives the list its own order back; unmeasured figures stand last", () => {
  const a = coin({ id: "A1111111111111111111111111111111", symbol: "A", holders: 10 });
  const b = coin({ id: "B1111111111111111111111111111111", symbol: "B", holders: null });
  const c = coin({ id: "C1111111111111111111111111111111", symbol: "C", holders: 99 });
  const f = { ...DEFAULT_FILTERS, hideRisky: false };
  const desc = nextSort(DEFAULT_SORT, "holders");
  assert.deepEqual(depthRows([a, b, c], view({ sort: desc, filters: f })).map((x) => x.symbol), ["C", "A", "B"]);
  const asc = nextSort(desc, "holders");
  assert.deepEqual(depthRows([a, b, c], view({ sort: asc, filters: f })).map((x) => x.symbol), ["A", "C", "B"]);
  assert.deepEqual(nextSort(asc, "holders"), DEFAULT_SORT);
  assert.deepEqual(depthRows([b, a, c], view({ filters: f })).map((x) => x.symbol), ["B", "A", "C"]);
});

test("every coin's logo comes through the engine's own icon proxy, never from the address its creator wrote", () => {
  assert.equal(logoOf(coin()), "/api/spot/icon?mint=So11111111111111111111111111111111111111112&u=https%3A%2F%2Fstatic.jup.ag%2Fa.png");
  assert.equal(logoOf(coin({ icon: null })), null);
  assert.equal(logoOf(coin({ icon: "http://x/a.png" })), null);
});

test("the day's line, a short count, the buys' share and a table that fits its width", () => {
  const line = dayLine(coin());
  assert.equal(line.length, 5);
  assert.deepEqual(line[0], { x: 0, price: 1 });
  assert.match(timePath(line, 96, 28), /^M\d/);
  assert.equal(countText(999_950, "en"), "1M");
  assert.equal(countText(153_246, "uk"), "153K", "a count is written as the sums beside it are: K, M, B");
  assert.equal(countText(1_234_567, "uk"), "1,2M");
  assert.equal(countText(null, "en"), "—");
  assert.equal(buyShare(stats(1)), 0.75);
  assert.equal(buyShare(stats(1, { buys: 0, sells: 0 })), null);
  const cols = [
    { id: "coin", min: 150, rank: 0 },
    { id: "price", min: 90, rank: 1 },
    { id: "day", min: 96, rank: 9 },
    { id: "quick", min: 44, rank: 0.5 },
  ];
  assert.deepEqual(fitColumns(cols, 340).map((c) => c.id), ["coin", "price", "quick"]);
});

test("the words stand in both languages with the same keys, short; Ukrainian counts its coins", () => {
  assert.deepEqual(Object.keys(DEPTH.en).sort(), Object.keys(DEPTH.uk).sort());
  for (const lang of ["en", "uk"]) {
    for (const key of ["trending", "gainers", "losers", "traded", "stocks", "filters", "colNew", "colSoon", "colDex", "tileTrade", "tileEarn"]) assert.ok(DEPTH[lang][key].length <= 18, `${lang}.${key}`);
    assert.ok(DEPTH[lang].homeTitle1.length + DEPTH[lang].homeTitle2.length <= 48, lang);
  }
  assert.equal(DEPTH.uk.trending, "Тренди");
  assert.equal(DEPTH.uk.showCoins(1), "Показати 1 монету");
  assert.equal(DEPTH.uk.showCoins(3), "Показати 3 монети");
  assert.equal(DEPTH.uk.showCoins(38), "Показати 38 монет");
  assert.equal(DEPTH.uk.showCoins(12), "Показати 12 монет");
  assert.equal(DEPTH.uk.quickLine("0,1"), "Купівля в один дотик: 0,1 SOL");
});

test("decision 109: no side form — a row is its coin's page, the pointer resting on it changes nothing", () => {
  const screen = read("./DepthMarket.tsx");
  assert.ok(!/<Split\b|<Ticket\b/.test(screen), "no side ticket on the Market");
  assert.ok(!/onPointerMove|onPointerEnter|PICK_REST_MS/.test(screen), "hovering a row picks nothing");
  assert.match(screen, /router\.push\(coinHref\(coin\.id, 'live'\)\)/, "a tap on a row opens the coin's page");
  assert.ok(!/jup\.ag|datapi/.test(screen), "no provider is read from the browser");
  assert.ok(!/data-pro/.test(screen), "no second look");
  const store = read("./depth.ts");
  assert.match(store, /\/api\/v1\/market\/depth\?/);
  assert.match(store, /market\.depth\.v2/, "the filters of decision 109 are not read back from v1");
});

test("a quick buy goes through the trade card every ticket uses — no logic of its own", () => {
  const quick = read("./QuickBuy.tsx");
  assert.match(quick, /useTicket\(ref, 'spot', 'buy'\)/);
  assert.match(quick, /setPay\(SOL\.symbol\)/);
  assert.match(quick, /setTyped\(quick\)/);
  assert.match(quick, /actionOf\(/);
  assert.ok(!/fetch\(|\/api\/v1\/trade|signTransaction|sendTransaction/.test(quick), "it builds and signs nothing itself");
  // Never closed under a signature on its way.
  assert.match(quick, /ticketFree\(st\)/);
  // SOL and USDC pay for a quick buy: no ⚡ buys them (the card would pay with the other one).
  assert.match(quick, /PAID_WITH\.has\(coin\.id\)\) return null/);
});

test("decision 108: the Market names no coin to buy in its own words; the tiles lead to the sections", () => {
  for (const file of ["./HomeHero.tsx", "./Tiles.tsx", "./Pulse.tsx", "./DepthMarket.tsx", "./MarketScreen.tsx"]) {
    const source = read(file);
    assert.ok(!/BONK|WIF|PUMP|'TRUMP'/.test(source), `${file}: no promoted coin`);
    assert.ok(!/x1000|guarantee/i.test(source), `${file}: no promise of profit`);
  }
  const tiles = read("./Tiles.tsx");
  for (const shelf of ["'swap'", "'agents'", "'earn'", "'launch'"]) assert.ok(tiles.includes(`shelfHref(${shelf}`) || tiles.includes(`shelfOn(${shelf}`), shelf);
});

test("the address names the table's tab: `?tab=` (a kind, or saved) read on arrival and on change, written back without one for «All»", () => {
  const screen = read("./DepthMarket.tsx");
  assert.ok(screen.includes("useSearchParams().get('tab')"));
  assert.match(screen, /<Suspense fallback=\{null\}>\s*<TabParam \/>/, "the read waits in its own boundary: the page still renders on the server");
  assert.ok(screen.includes("if (tab === 'all') url.searchParams.delete('tab')"));
  assert.ok(screen.includes("window.history.replaceState"));
});

test("a logo that does not load is tried at the engine's other routes: the IPFS picture through the public gateway, then by mint (QA 19.11)", () => {
  const mint = "CDBdbNqmrLu1PcgjrFG52yxg71QnFhBZcUE6PSFdbonk";
  const cid = "bafkreigsmirfebog72ttc2egkfk7udsjjlu2ue7hi73bijzupyyatsopgm";
  const pinned = `https://sapphire-working-koi-276.mypinata.cloud/ipfs/${cid}`;
  const viaIpfs = `/api/spot/icon?mint=${mint}&u=${encodeURIComponent(`https://ipfs.io/ipfs/${cid}`)}`;
  assert.deepEqual(logoAlso(mint, pinned), [viaIpfs, `/api/icon/${mint}`]);
  // The same from an address already through the proxy, and a subdomain gateway.
  assert.deepEqual(logoAlso(mint, `/api/spot/icon?mint=${mint}&u=${encodeURIComponent(pinned)}`), [viaIpfs, `/api/icon/${mint}`]);
  assert.deepEqual(logoAlso(mint, `https://${cid}.ipfs.w3s.link/logo.png`)[0], `/api/spot/icon?mint=${mint}&u=${encodeURIComponent(`https://ipfs.io/ipfs/${cid}/logo.png`)}`);
  // A picture not on IPFS has the route by mint alone; the first address is never repeated.
  assert.deepEqual(logoAlso(mint, "https://static.jup.ag/a.png"), [`/api/icon/${mint}`]);
  assert.deepEqual(logoAlso(mint, null, `/api/icon/${mint}`), []);
  // No address of its own: the first of the others stands first.
  assert.deepEqual(logoChain(mint, null, null), { src: `/api/icon/${mint}`, also: [] });
  assert.deepEqual(logoChain(mint, pinned, "/x.png"), { src: "/x.png", also: [viaIpfs, `/api/icon/${mint}`] });
});
