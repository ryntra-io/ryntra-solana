// «Start from a set» on the Launch screen for the eyes: at 1920×1080 and 390×844, in English and Ukrainian —
// the row as the form opens, the ready sets opened, and a set chosen with what it changes from the default.
//   node terminal/launch/presets/shots.mjs <out> [baseUrl]
// A stand runs with the terminal's switch and Launch's: NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_LAUNCH=open.
// No wallet is connected and nothing is signed: the sets are read from the stand's own route.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "sets-shots");
const base = process.argv[3] ?? "http://localhost:3371";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = ["en", "uk"];
const report = [];
// A Chrome of the machine's own may stand in (PRESS_CHROME), as the screen's other shots allow.
/** The row brought to the middle of the page's own scroll, and every box that does not scroll put back where it stood. */
async function centre(page) {
  await page.evaluate(() => {
    const row = document.querySelector("[data-launch-sets]");
    row?.scrollIntoView({ block: "center" });
    for (let box = row?.parentElement; box; box = box.parentElement) {
      if (box.scrollTop && getComputedStyle(box).overflowY !== "auto" && getComputedStyle(box).overflowY !== "scroll") box.scrollTop = 0;
    }
  });
}

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});

for (const lang of LANGS) {
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile });
    await context.addInitScript((value) => window.localStorage.setItem("ryntra.city.lang", value), lang);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message ?? error)));
    await page.goto(`${base}/launch`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    const row = page.locator("[data-launch-sets]");
    await row.waitFor({ state: "visible", timeout: 180_000 });
    await page.waitForTimeout(1500);
    const shot = async (state) => {
      await centre(page);
      // The pointer rests off the form, so no row stands lit by a hover the scroll put under it.
      await page.mouse.move(1, size.height - 1);
      await page.waitForTimeout(300);
      const file = `sets-${state}-${size.name}-${lang}.jpg`;
      await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 88 });
      return file;
    };
    const entry = { lang, size: size.name, shots: [], errors };
    entry.shots.push(await shot("closed"));
    await page.locator("[data-launch-sets-pick]").click();
    await page.locator("[data-launch-set]").first().waitFor({ state: "visible" });
    entry.offered = await page.locator("[data-launch-set]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-launch-set")));
    entry.selectedWhenOpened = await page.locator('[data-launch-set][aria-selected="true"]').count();
    entry.shots.push(await shot("open"));
    // The set that differs from the form's start, so its changes show.
    for (const id of ["ryntra-classic", "ryntra-protected"]) {
      if (!entry.offered.includes(id)) continue;
      if (!(await page.locator("[data-launch-set]").first().isVisible().catch(() => false))) await page.locator("[data-launch-sets-pick]").click();
      await page.locator(`[data-launch-set="${id}"]`).click();
      await page.waitForTimeout(300);
      const changed = Number(await page.locator("[data-launch-sets-changes]").getAttribute("data-launch-sets-changes"));
      entry.applied = { id, changed, words: (await page.locator("[data-launch-sets-changes]").innerText()).trim(), pick: (await page.locator("[data-launch-sets-pick]").innerText()).trim() };
      if (changed > 0) break;
    }
    entry.shots.push(await shot("chosen"));
    entry.shield = await page.locator("[data-launch-shield]").getAttribute("data-launch-shield").catch(() => null);
    entry.horizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    report.push(entry);
    await context.close();
  }
}

/* The market as it reads once the store is applied: creators' sets beside Ryntra's own, with the launches each started,
   and the save's line without a wallet. The read is answered in the page alone, with the stand's own numbers. */
{
  const stand = await (await fetch(`${base}/api/v1/launch/presets/sets`, { headers: { "X-Ryntra-API": "1" } })).json();
  const protectedTerms = stand.sets.find((set) => set.id === "ryntra-protected")?.terms;
  const classicTerms = stand.sets.find((set) => set.id === "ryntra-classic")?.terms;
  const market = {
    ...stand,
    stored: true,
    sets: [
      { id: "1b4e28ba-2fa1-4d2b-883f-0016d3cca427", name: "Night guard", names: null, author: "So11111111111111111111111111111111111111112", terms: protectedTerms, uses: 41, createdAt: "2026-11-19T10:00:00.000Z" },
      ...stand.sets.map((set) => ({ ...set, uses: set.id === "ryntra-classic" ? 27 : set.id === "ryntra-protected" ? 12 : 0 })),
      { id: "2b4e28ba-2fa1-4d2b-883f-0016d3cca427", name: "Quick open", names: null, author: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", terms: classicTerms, uses: 3, createdAt: "2026-11-20T10:00:00.000Z" },
    ],
  };
  for (const [lang, size] of [["en", SIZES[0]], ["uk", SIZES[1]]]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile });
    await context.addInitScript((value) => window.localStorage.setItem("ryntra.city.lang", value), lang);
    const page = await context.newPage();
    await page.route("**/api/v1/launch/presets/sets?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(market) }));
    await page.goto(`${base}/launch`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.locator("[data-launch-sets]").waitFor({ state: "visible", timeout: 180_000 });
    await page.waitForTimeout(1500);
    await page.locator("[data-launch-sets-pick]").click();
    await page.locator('[data-launch-set="1b4e28ba-2fa1-4d2b-883f-0016d3cca427"]').waitFor({ state: "visible" });
    await centre(page);
    await page.mouse.move(1, size.height - 1);
    await page.waitForTimeout(300);
    const file = `sets-market-${size.name}-${lang}.jpg`;
    await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 88 });
    report.push({ lang, size: size.name, shots: [file], offered: await page.locator("[data-launch-set]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-launch-set"))) });
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
