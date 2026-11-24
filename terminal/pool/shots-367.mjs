// DLMM Pro's day, trades and filled limit orders on the screens, for the eyes → <out>/<page>-<size>-<lang>.jpg
//   node terminal/pool/shots-367.mjs <tape.json> [out] [baseUrl]
// A stand (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand next dev`) with every DLMM Pro read answered on the browser's side:
// - the day, the trades and the fills of pool A are the engine's own answers from the program's recorded transactions
//   (`./shots-367-tape.mjs` makes <tape.json> — the rehearsal, not a mainnet pool);
// - pool B's day does not answer (a 503), so its cells stay empty;
// - the two pool rows themselves (names, depth, fee) are the stand's, to lay the table out.
// A guest: no wallet, nothing is built or signed.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const tape = JSON.parse(readFileSync(path.resolve(process.argv[2]), "utf8"));
const out = path.resolve(process.argv[3] ?? "docs/shots/city-367");
const base = process.argv[4] ?? "http://localhost:3167";
mkdirSync(out, { recursive: true });

const A = tape.pool;
const B = "B1111111111111111111111111111111111111111111";
const coin = (mint, symbol, decimals, usd) => ({ mint, symbol, name: symbol, decimals, icon: null, verified: true, usd });
const fee = { totalBps: 146, baseBps: 146, dynamicBps: 0, mode: "time", protocolShareBps: 2000, collectedIn: "tokenY" };
const row = (address, x, y, price, tvlUsd) => ({ address, kind: "static", x, y, price, tickSpacing: 10, stepBps: 10, fee, bonusBps: 15, reserves: { xRaw: null, yRaw: null }, tvlUsd, rewards: 0, open: { swap: true, deposits: true } });
const pair = tape.stats.pair;
const ROW_A = row(A, coin(pair.coin.mint, "RHRSL", pair.coin.decimals, null), coin(pair.quote.mint, "USDC", pair.quote.decimals, 1), tape.stats.stats.price.last, 120_000);
const ROW_B = row(B, coin("C1111111111111111111111111111111111111111111", "KITE", 6, null), coin(pair.quote.mint, "USDC", 6, 1), 0.42, 80_000);
const at = new Date().toISOString();

const SIZES = [
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "desk1440", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const WORDS = { en: { trades: "Trades", limits: "Limits", pro: "DLMM Pro" }, uk: { trades: "Угоди", limits: "Лімітки", pro: "DLMM Pro" } };

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const report = [];
for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("ryntra.city.lang", value);
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
    }, lang);
    await context.route("**/api/pro/pools**", (route) => {
      const url = new URL(route.request().url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/api/pro/pools") return json({ network: "mainnet", at, pools: [ROW_A, ROW_B] });
      if (url.pathname === `/api/pro/pools/${A}`) return json({ network: "mainnet", at, pool: ROW_A });
      if (url.pathname === `/api/pro/pools/${B}`) return json({ network: "mainnet", at, pool: ROW_B });
      if (url.pathname === `/api/pro/pools/${A}/stats`) return json(tape.stats);
      if (url.pathname === `/api/pro/pools/${A}/trades`) return json(tape.trades);
      if (url.pathname === `/api/pro/pools/${A}/fills`) return json(tape.fills);
      return json({ error: { code: "UNAVAILABLE" } }, 503);
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    // Console errors of the stand's own reads that have no network here (the market, the chart) are not this screen's.
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource|ERR_|net::|fetch/i.test(message.text())) errors.push(message.text());
    });
    const shot = async (name) => {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, `${name}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
    };
    const w = WORDS[lang];

    await page.goto(`${base}/pro`, { waitUntil: "domcontentloaded" });
    await page.locator("[role='table'], [data-earn-pick]").first().waitFor({ timeout: 120_000 }).catch(() => report.push(`${size.name}/${lang}: /pro — no rows`));
    await page.waitForTimeout(4000);
    await shot("pro");
    if (!size.mobile) {
      const head = page.locator("[role='columnheader'] button").nth(1);
      if (await head.count()) {
        await head.click();
        await shot("pro-sorted");
      }
    }

    await page.goto(`${base}/pool/${A}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-pool-head]").first().waitFor({ timeout: 120_000 }).catch(() => report.push(`${size.name}/${lang}: pool — no head`));
    await page.waitForTimeout(4000);
    await shot("pool");
    const tab = (word) => page.getByRole("tab", { name: word, exact: true }).first();
    if (await tab(w.trades).count()) {
      await tab(w.trades).click();
      await page.locator("[data-pool-trades]").first().waitFor({ timeout: 20_000 }).catch(() => report.push(`${size.name}/${lang}: no trades list`));
      if (size.mobile) await page.locator("[data-pool-trades]").first().scrollIntoViewIfNeeded().catch(() => {});
      await shot("pool-trades");
    } else report.push(`${size.name}/${lang}: no «${w.trades}» tab`);
    if (await tab(w.limits).count()) {
      await tab(w.limits).click();
      await page.locator("[data-pool-fills]").first().waitFor({ timeout: 20_000 }).catch(() => report.push(`${size.name}/${lang}: no fills list`));
      if (size.mobile) await page.locator("[data-pool-fills]").first().scrollIntoViewIfNeeded().catch(() => {});
      await shot("pool-limits");
    } else report.push(`${size.name}/${lang}: no «${w.limits}» tab`);
    const head = await page.locator("[data-pool-head]").first().innerText().catch(() => "");
    report.push(`${size.name}/${lang} head: ${head.replace(/\s+/g, " ").slice(0, 220)}`);
    if (errors.length) report.push(`${size.name}/${lang} errors: ${errors.join(" | ").slice(0, 400)}`);
    await context.close();
  }
}
await browser.close();
console.log(report.join("\n"));
