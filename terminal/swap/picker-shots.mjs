// The Swap's pickers and its pair for the eyes: every coin of a field's list wears its logo, as on the Market,
// and the pair's two coins stand beside the form as two tiles — the logo, the price, the day's move.
//
//   node terminal/swap/picker-shots.mjs <outDir> [base]        base defaults to http://localhost:3111
//
// Public pages only: no wallet is connected, nothing is signed. The run opens the coin «you get», searches for a coin
// outside the city's towers (SRM), shoots the list, picks it and shoots the pair; the report (`picker.json`) counts the
// list's rows drawn with a letter instead of a logo and the pair's tiles.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-311");
const base = process.argv[3] ?? "http://localhost:3111";
const find = process.env.FIND ?? "SRM";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

/** Runs in the page: the picker's rows — how many show a picture, and the names of those that show a letter. */
function rowsOf() {
  const rows = [...document.querySelectorAll("[role='menu'] [role='menuitemradio']")];
  const letters = rows.filter((row) => !row.querySelector("img")).map((row) => row.innerText.split("\n")[0]);
  return { rows: rows.length, letters };
}

const report = {};
for (const lang of ["uk", "en"]) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: lang === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  await page.goto(`${base}/swap?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-page-main] button[aria-haspopup], [data-page-main] button", { timeout: 60_000 });
  await page.waitForTimeout(4500);
  const at = {};
  at.pairBefore = await page.locator("[data-swap-pair]").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-swap-pair")));
  // The coin «you get»: the second coin button of the form.
  const coins = page.locator("[data-page-main] button:has(img), [data-page-main] button:has([class*='coinLogo'])");
  await coins.nth(1).click();
  await page.waitForSelector("[role='menu']", { timeout: 20_000 });
  await page.waitForTimeout(2500);
  at.list = await page.evaluate(rowsOf);
  await page.screenshot({ path: path.join(out, `picker-list-wide-${lang}.jpg`), type: "jpeg", quality: 80 });
  await page.locator("[role='dialog'] input[type='search']").fill(find);
  await page.waitForTimeout(3500);
  at.found = await page.evaluate(rowsOf);
  await page.screenshot({ path: path.join(out, `picker-${find.toLowerCase()}-wide-${lang}.jpg`), type: "jpeg", quality: 80 });
  await page.locator("[role='menu'] [role='menuitemradio']").first().click();
  await page.waitForTimeout(4500);
  at.pairAfter = await page.locator("[data-swap-pair]").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-swap-pair")));
  await page.screenshot({ path: path.join(out, `swap-pair-${find.toLowerCase()}-wide-${lang}.jpg`), type: "jpeg", quality: 80 });
  report[lang] = at;
  console.log(lang, JSON.stringify(at));
  await context.close();
}
await browser.close();
writeFileSync(path.join(out, "picker.json"), JSON.stringify({ base, find, report }, null, 2));
