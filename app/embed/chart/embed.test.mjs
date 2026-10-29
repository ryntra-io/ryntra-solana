import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { embedLocale, embedMint, embedTheme, embedThemeScript } from "./embed-params.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the address carries only the market, the app's theme and its language", () => {
  assert.equal(embedMint("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  assert.equal(embedMint("not-a-mint"), null);
  assert.equal(embedMint(undefined), null);
  assert.equal(embedTheme("porcelain"), "porcelain");
  assert.equal(embedTheme("light"), "graphite");
  assert.equal(embedTheme(undefined), "graphite");
  assert.equal(embedLocale("uk"), "uk");
  assert.equal(embedLocale("ua"), "en");
  assert.match(embedThemeScript("porcelain"), /"data-theme","porcelain"/);
  assert.match(embedThemeScript("porcelain"), /"data-ry-theme","light"/);
  assert.match(embedThemeScript("graphite"), /"data-theme","graphite"/);
});

test("the chart page is the spot page's chart alone: no wallet, no ticket, not indexed", () => {
  const page = read("./[mint]/page.tsx");
  const chart = read("./[mint]/embed-chart.tsx");
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(chart, /<SpotChart[\s\S]*fullScreen=\{false\}/);
  /* The app keeps buying and selling on its own screens: nothing here reads a wallet or draws a ticket. */
  for (const source of [page, chart]) {
    assert.doesNotMatch(source, /useSpotHoldings|useSpotFills|useLimitOrders|SpotTicket|QuickBuy|useSolanaConnection|WalletProof/);
  }
  /* The full-screen control stays on the spot page and only the page that is a whole screen turns it off. */
  assert.match(read("../../solana/workspace/spot/spot-chart.tsx"), /fullScreen = true,/);
});
