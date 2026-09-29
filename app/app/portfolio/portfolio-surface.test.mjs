import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const PORTFOLIO = code("app/app/portfolio/page.tsx");
const HOLDINGS_PAGE = code("app/solana/workspace/holdings/page.tsx");
const HOLDINGS = code("app/solana/workspace/holdings/holdings-card.tsx");
const LOADING = code("app/app/portfolio/loading.tsx");
const WALLET_DATA = code("app/app/wallet-data.tsx");
const CSS = read("app/solana/workspace/holdings/holdings.module.css");

/* RYN-UX-UNIFY-001 replaces the mixed paper/venue portfolio on these routes.
   The retained Home read-model and Financial Twin tests still cover their
   algorithms; these checks cover the customer routes that now mount instead. */

test("Portfolio is the overview, and it is one direct screen", () => {
  /* Product Canon v1.0 9.1 made Portfolio the functional overview; since
     canon v5.0 §3 the product opens on Home, and since canon v5.3 (В28) for
     everyone — Portfolio is the fourth of the five places, one direct screen
     with its tabs: the positions, Strategies, Results, History. */
  assert.doesNotMatch(PORTFOLIO, /\bredirect\(/);
  assert.match(PORTFOLIO, /export \{ default, generateMetadata \} from "@\/app\/solana\/workspace\/holdings\/page"/);
  /* One version: the beginner's empty states for everyone, no depth read on the server. */
  assert.match(HOLDINGS_PAGE, /<HoldingsCard \/>/);
  assert.match(HOLDINGS_PAGE, /<PortfolioTabs locale=\{locale\} \/>/);
  assert.doesNotMatch(HOLDINGS_PAGE, /cookies\(|depthFromCookie/);
  assert.doesNotMatch(PORTFOLIO + HOLDINGS_PAGE, /<RyntraAppShell|<HomeShell|<SolanaConnectionProvider/);
  const routing = read("lib/product/customer-routing.ts");
  assert.ok(!routing.includes('["/app", "/app/portfolio"]'), "a depth still opens the root on the overview");
  assert.ok(routing.includes('["/app", "/app/home"]'), "the root must open on Home");
  assert.ok(routing.includes('home: "/app/home"'), "the product root must name Home as home");
});

test("Portfolio owns the value, the searchable asset list and what is in motion", () => {
  assert.match(HOLDINGS, /walletValue\(holdings\.data\)/);
  assert.match(HOLDINGS, /id="portfolio-value"/);
  assert.match(HOLDINGS, /id="portfolio-motion"/);
  assert.match(HOLDINGS, /aria-label=\{text\("Search your holdings"\)\}/);
  assert.match(HOLDINGS, /query\.trim\(\)\.toLowerCase\(\)/);
  assert.match(HOLDINGS, /row\.ticker\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(HOLDINGS, /row\.holding\.mint\s*\?\?\s*""/);
  assert.match(HOLDINGS, /onClick=\{refresh\}/);
});

test("Portfolio rows carry quantity, value, asset details and an operation destination", () => {
  /* The quantity as the wallet shows it: a scaled mint's raw amount times its multiplier (1.15.0). */
  assert.match(HOLDINGS, /displayAmount\(shownRaw\(row\.holding\)\.toString\(\),\s*row\.holding\.decimals\)/);
  assert.match(HOLDINGS, /data-unpriced=\{row\.value === null\}/);
  assert.match(HOLDINGS, /href=\{mintHref\(row\.holding\.mint\)\}/);
  assert.match(HOLDINGS, /\/app\/activity\?action=\$\{encodeURIComponent\(action\.actionId\)\}/);
  // A count of assets or transfers never becomes money in the total.
  assert.doesNotMatch(HOLDINGS, /walletValue\(moving|walletValue\(activity|totals\.total\s*\+\s*moving/);
});

test("Portfolio consumes one wallet read and one valuation implementation", () => {
  for (const surface of [HOLDINGS]) {
    assert.match(surface, /useWalletData\(\)/);
    assert.match(surface, /wallet-view-model/);
    assert.doesNotMatch(surface, /\bfetch\(|\/api\/solana\/holdings|\/api\/solana\/activity/);
    for (const formula of ["addDecimal", "subtractDecimal", "multiplyDecimal", "calculateRisk", "calculateValuationCoverage", "mergePositionRecords", "rankAttention"]) {
      assert.equal(surface.includes(formula), false, `${formula} must stay outside the view`);
    }
  }
  assert.match(WALLET_DATA, /decodeWalletCollection\(response\.ok,\s*payload,\s*kind\)/);
});

test("loading, failed reads and incomplete reads cannot render as an empty wallet", () => {
  assert.match(LOADING, /aria-busy="true"/);
  assert.doesNotMatch(LOADING, /formatMoney|usdValue|\$[0-9]/);
  assert.match(HOLDINGS, /if \(!connection\)\s*\{\s*return\s*\([\s\S]*?<WalletGate\b/);
  assert.match(HOLDINGS, /holdings\.status === "error"/);
  assert.match(HOLDINGS, /holdings\.status === "ready" && !holdings\.complete/);
  assert.match(HOLDINGS, /holdings\.status === "ready" && holdings\.complete && rows\.length === 0/);
  assert.match(HOLDINGS, /holdings\.status === "ready" && holdings\.complete\s*\?/);
  assert.match(HOLDINGS, /activity\.status === "error" \|\| \(activity\.status === "ready" && !activity\.complete && moving\.length === 0\)/);
});

test("an unpriced holding is labelled as unknown and never given a zero price", () => {
  assert.match(HOLDINGS, /totals\.unpriced > 0/);
  assert.match(HOLDINGS, /text\("Without a price"\)/);
  assert.match(HOLDINGS, /row\.value === null \? "\\u2014" : usdValueIn\(row\.value, locale\)/);
  assert.match(CSS, /\.value\[data-unpriced="true"\][\s\S]*?color: var\(--text-faint\)/);
  assert.doesNotMatch(HOLDINGS, /usdPrice\s*\?\?\s*["']?0|row\.value\s*\?\?\s*0n/);
});

test("internal explanations are removed from customer views rather than hidden in disclosures", () => {
  for (const [name, source] of [["Portfolio", HOLDINGS]]) {
    assert.doesNotMatch(source, /<InfoControl|<details|info=\{|disclosure=\{|<LoopStrip|<WorkspaceCatalogue/, name);
    assert.doesNotMatch(source, /RYN-[A-Z][A-Z0-9-]+-\d+|npm (?:run|test)|docs\/tasks\/|backend is|not shipped|[Pp]hase [AB]/, name);
  }
});

test("portfolio data is a labelled snapshot and contains no invented chart feed", () => {
  assert.match(HOLDINGS, /holdings\.data[\s\S]*?holdingValue\(holding\)/);
  assert.match(HOLDINGS, /text\("Priced assets"\)/);
  for (const library of ["lightweight-charts", "recharts", "chart.js", "d3"]) {
    assert.equal(HOLDINGS.includes(library), false, `no invented chart feed belongs here (${library})`);
  }
  assert.doesNotMatch(HOLDINGS, /Math\.random|DEMO_|SAMPLE_|mockPortfolio/);
});

test("the customer portfolio preserves mobile controls, wrapping and a shared focus ring", () => {
  assert.match(CSS, /\.search \{[\s\S]*?min-height: 44px;/);
  assert.match(CSS, /\.action \{[\s\S]*?min-height: 44px;/);
  assert.match(CSS, /@media \(max-width: 560px\)/);
  assert.match(CSS, /overflow-wrap: anywhere;/);
  assert.match(
    read("app/shell/shell.css"),
    /\.rs :where\(a, button, select, summary, \[tabindex\]\):focus-visible \{[\s\S]{0,40}?outline: 2px solid/,
  );
});

test("the retained portfolio loader still projects data through the tested domain model", () => {
  assert.match(read("app/app/portfolio/read.ts"), /projectHomePortfolio/);
  const tiles = read("app/app/portfolio/tiles.tsx");
  assert.match(tiles, /item\.detailHref === null \? \(/);
  assert.match(tiles, /data-no-destination/);
  assert.match(tiles, /item\.limitation === null \? null/);
});

test("Portfolio itself neither signs nor executes an action", () => {
  for (const source of [PORTFOLIO, HOLDINGS_PAGE, HOLDINGS]) {
    for (const forbidden of [
      "eth_requestAccounts",
      "personal_sign",
      "eth_sendTransaction",
      "signTypedData",
      "signTransaction",
      "sendTransaction",
      'method: "POST"',
      "paperOpen",
      "paperClose",
    ]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} must not enter a summary or portfolio view`);
    }
  }
});
