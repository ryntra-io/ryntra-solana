// The creator's tab and the largest holders' links on a coin's page, for the eyes, at 1920×1080, 1440×900
// and 390×844, in English and Ukrainian, plus their states (reading, the source quiet, no creator) → <out>/*.jpg
//   node terminal/coin/creator/shots.mjs [out] [baseUrl]
// A stand runs with `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` and the switch `RYNTRA_SPOT_CREATOR=on`. The engine's answers
// are made here from the recorded scan answers of the tests (`lib/spot/fixtures/creator-scan.json`,
// `holder-links-scan.json`) by the engine's own rules, and the browser is handed them in place of the network: the coin
// is the fixtures' example, not a coin of mainnet. Reads only, no wallet. `PRESS_CHROME` names a browser of its own.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { launchesOf, movesOf, scanPageOf } from "../../../lib/spot/creator-chain.ts";
import { balanceOfParsedAccounts, creatorActionOf, creatorCoinsOf, creatorCountsOf } from "../../../lib/spot/creator.ts";
import { holderLinksOf } from "../../../lib/spot/holder-links.ts";
import { CREATOR } from "./words.ts";
import { HOLDER_MAP } from "../holders-map/words.ts";
import { HEAD } from "../head-words.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-356");
const base = process.argv[3] ?? "http://localhost:3356";
mkdirSync(out, { recursive: true });

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../../lib/spot/fixtures/${name}`, import.meta.url), "utf8"));
const C = fixture("creator-scan.json");
const L = fixture("holder-links-scan.json");
const A = C.addresses;
const MINT = A.MINT;
const DAY = 86_400_000;
const NOW = Date.now();

/* The example coins, named as Jupiter would name them; their times moved to the days before today. */
const market = (mint, symbol, name, cap) => ({
  mint, symbol, name, icon: null, decimals: 6, tokenProgram: null, price: cap / 1e9, change24hPct: 12.4, change1hPct: 1.2, volume24hUsd: 340_000, liquidityUsd: 52_000,
  marketCapUsd: cap, fdvUsd: cap, holders: 812, organicScore: null, organicScoreLabel: null, verified: false, tags: [], category: null, issuer: null, firstPoolAt: null,
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: 41, devBalancePct: 1.5, suspicious: false },
  links: { website: null, twitter: null, telegram: null },
  stats: { h1: { priceChangePct: 1.2, volumeUsd: 21_000, buys: 140, sells: 96, traders: 88 }, h24: { priceChangePct: 12.4, volumeUsd: 340_000, buys: 2_100, sells: 1_800, traders: 640 } },
  updatedAt: null,
});
const facts = (mint, extra = {}) => ({ mint, circulatingSupply: 1e9, totalSupply: 1e9, dev: A.CREATOR, devMints: null, devMigrations: null, launchpad: "pump.fun", graduatedAt: null, createdAt: null, windows: {}, socials: [], ...extra });
const shift = (launch, daysAgo) => ({ ...launch, at: Math.floor((NOW - daysAgo * DAY) / 1000) });

const launches = launchesOf([scanPageOf(C.launches.first), scanPageOf(C.launches.second)], A.CREATOR);
const dated = launches.map((launch) => shift(launch, launch.mint === MINT ? 0.2 : launch.mint === A.COIN_A ? 9 : 64));
const markets = new Map([
  [MINT, market(MINT, "KITE", "Kite", 90_000)],
  [A.COIN_A, market(A.COIN_A, "LOOM", "Loom", 4_200)],
  [A.COIN_B, market(A.COIN_B, "ORBIT", "Orbit Cat", 2_000_000)],
]);
const factsBy = new Map([
  [MINT, facts(MINT, { devMints: 3, devMigrations: 1 })],
  [A.COIN_A, facts(A.COIN_A)],
  [A.COIN_B, facts(A.COIN_B, { launchpad: "met-dbc", graduatedAt: new Date(NOW - 60 * DAY).toISOString() })],
]);
const coins = creatorCoinsOf({ mint: MINT, launches: dated, markets, facts: factsBy, peaks: new Map([[A.COIN_A, 1_250_000], [A.COIN_B, 6_800_000], [MINT, 140_000]]) });
const counts = creatorCountsOf(factsBy.get(MINT), coins, true);
const moves = movesOf([scanPageOf(C.moves.first), scanPageOf(C.moves.second)], A.CREATOR, MINT);
const CREATOR_ANSWER = {
  creator: A.CREATOR,
  launched: counts.launched,
  listed: counts.listed,
  coins,
  coinsWhole: counts.whole,
  action: creatorActionOf({ moves, balance: balanceOfParsedAccounts(C.balance), supply: 1e9, whole: true }),
  observedAt: new Date(NOW).toISOString(),
  stale: false,
};

const people = L.holders.filter((row) => !row.labels.length).map(({ owner, sharePct }) => ({ owner, sharePct }));
const linkMoves = new Map(people.map((holder) => [holder.owner, movesOf([scanPageOf(L.pages[holder.owner])], holder.owner, MINT)]));
const onCurve = new Set(Object.entries(A).filter(([name]) => !/^(CURVE|POOL)/.test(name)).map(([, value]) => value));
const links = holderLinksOf({ holders: people, moves: linkMoves, isWallet: (address) => onCurve.has(address), skip: new Set([A.CURVE]), creator: A.CREATOR });
const LINKS_ANSWER = { ...links, checked: people.length, of: people.length, whole: true, observedAt: new Date(NOW).toISOString(), stale: false };

/** The browser's reads, answered: the coin's market and the creator's parts from here; the rest of the coin's reads as «none». */
async function answer(context, mode) {
  await context.route("**/api/spot/market?**", (route) => route.fulfill({ json: { market: markets.get(MINT), observedAt: new Date(NOW).toISOString(), stale: false } }));
  await context.route("**/api/spot/token?**", (route) => route.fulfill({ json: { none: { code: "NOT_READ", reason: "example" }, observedAt: new Date(NOW).toISOString() } }));
  await context.route("**/api/spot/creator?**", async (route) => {
    const part = new URL(route.request().url()).searchParams.get("part");
    if (mode === "reading") return; // never answered: the frame stands
    if (mode === "quiet") return route.fulfill({ status: 503, json: { error: { code: "CREATOR_UNREACHABLE", message: "quiet" } } });
    if (mode === "none") return route.fulfill({ json: { none: { code: "NO_CREATOR", reason: "example" } } });
    return route.fulfill({ json: part === "links" ? LINKS_ANSWER : CREATOR_ANSWER });
  });
}

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = [
  { name: "1920", width: 1920, height: 1080, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];

async function open(size, lang, mode = "live") {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, timezoneId: "Europe/Kyiv" });
  await answer(context, mode);
  const page = await context.newPage();
  await page.goto(`${base}/coin/${MINT}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[role='tablist']", { timeout: 120_000 });
  return { context, page };
}

/** A tab picked, and the screen waited for until it stands chosen. */
async function pick(page, label) {
  const tab = page.getByRole("tab", { name: label, exact: true });
  await tab.click();
  await page.waitForFunction((word) => [...document.querySelectorAll("[role='tab'][aria-selected='true']")].some((node) => node.textContent?.trim() === word), label, { timeout: 30_000 });
}

async function report(page, name) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  // A box under the chart that scrolls sideways — the tab is wider than its panel.
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll("[role='table'], svg[role='group'], [role='list']")]
      .map((node) => node.parentElement)
      .filter((box) => box && box.scrollWidth > box.clientWidth + 1)
      .map((box) => `${box.firstElementChild?.getAttribute("aria-label") ?? box.className} ${box.scrollWidth}/${box.clientWidth}`),
  );
  console.log(`${name}${wide ? " — the page scrolls sideways" : ""}${boxes.length ? ` — sideways inside: ${boxes.join(", ")}` : ""}`);
}

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const { context, page } = await open(size, lang);
    if (!size.mobile) {
      for (const [id, label] of [["creator", CREATOR[lang].tab], ["links", HOLDER_MAP[lang].tab]]) {
        await pick(page, label);
        await page.waitForTimeout(1_200);
        const name = `${id}-${size.name}-${lang}`;
        await page.screenshot({ path: path.join(out, `${name}.jpg`), quality: 86 });
        await report(page, name);
      }
      // A group's row lights its group on the map.
      await page.getByRole("button", { name: HOLDER_MAP[lang].showGroup("1") }).hover();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `links-${size.name}-${lang}-group.jpg`), quality: 86 });
    } else {
      await pick(page, HEAD[lang].about);
      await page.waitForTimeout(1_500);
      // Each part brought to the top of the screen, whichever box scrolls the page.
      for (const [name, word] of [["", CREATOR[lang].creator], ["-links", HOLDER_MAP[lang].tab]]) {
        await page.getByText(word, { exact: true }).last().evaluate((node) => node.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(out, `about-${size.name}-${lang}${name}.jpg`), quality: 86 });
      }
      await report(page, `about-${size.name}-${lang}`);
    }
    await context.close();
  }
}

// The states, on a desk and a phone, in English and Ukrainian: reading, the source quiet, no creator named.
for (const mode of ["reading", "quiet", "none"]) {
  for (const lang of ["en", "uk"]) {
    const { context, page } = await open(SIZES[1], lang, mode);
    await pick(page, CREATOR[lang].tab);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `state-${mode}-creator-1440-${lang}.jpg`), quality: 86 });
    await pick(page, HOLDER_MAP[lang].tab);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `state-${mode}-links-1440-${lang}.jpg`), quality: 86 });
    await context.close();
  }
}
await browser.close();
