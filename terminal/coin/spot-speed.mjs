// «Спот» на швидкість (18.11): за скільки після переходу на сторінку монети приходять перші свічки, перші угоди й перша
// ціна квитка — без гаманця, як людина, що щойно відкрила монету. Лише читання.
//   node terminal/coin/spot-speed.mjs <out.json> <baseUrl> [mint] [runs]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "spot-speed.json";
const base = process.argv[3] ?? "http://localhost:3113";
const mint = process.argv[4] ?? "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const runs = Number(process.argv[5] ?? 3);
const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome });
const rows = [];
for (let run = 0; run < runs; run += 1) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const firsts = {};
  const calls = [];
  let started = 0;
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    const ms = Math.round(performance.now() - started);
    calls.push(`${ms} ${response.status()} ${url.pathname}`);
    const kind = /candles|chart|ohlc/.test(url.pathname) ? "candles" : /trades|fills|activity/.test(url.pathname) ? "trades" : /swap\/quote/.test(url.pathname) ? "quote" : null;
    if (kind && response.ok() && firsts[kind] === undefined) firsts[kind] = ms;
  });
  started = performance.now();
  await page.goto(`${base}/coin/${mint}?lang=en`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  const loaded = Math.round(performance.now() - started);
  await page.waitForTimeout(15_000);
  const seen = await page.evaluate(() => ({ reading: (document.body.innerText.match(/Reading…/g) ?? []).length, delayed: /Delayed/.test(document.body.innerText) }));
  rows.push({ run, domMs: loaded, ...firsts, ...seen, calls: calls.slice(0, 40) });
  console.log(`run ${run}: page ${loaded} ms · candles ${firsts.candles ?? "none"} · trades ${firsts.trades ?? "none"} · quote ${firsts.quote ?? "none"} · «Reading…» left ${seen.reading}`);
  await context.close();
}
await browser.close();
writeFileSync(out, JSON.stringify({ base, mint, rows }, null, 1));
