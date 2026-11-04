// «Launched on Ryntra» (CITY-185) for review: `/launches` opened on its window — the list of people's launches, the
// empty state with Ryntra's test launches apart (the same feed with every launch marked a test), the tests opened, and
// «Trade» flying to the tower — at 1440×900 and 375×812 → <out>/launched-<state>-<size>-<locale>.jpg
//   node city/lib/launch/launched-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/launched-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "en,uk").split(",");

// On the real GPU, as the skyline's own shots: the city behind the window as people see it.
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });

for (const locale of LOCALES) {
  for (const s of SIZES) {
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (state) => page.screenshot({ path: path.join(out, `launched-${state}-${s.name}-${locale}.jpg`), quality: 88, timeout: 120_000, animations: "disabled" });
    const t = (en, uk) => (locale === "uk" ? uk : en);
    const win = page.locator("[data-window=launched]");

    // The Ukrainian address names its language; the English one follows the reader, so the shot names it as a link does.
    const address = locale === "uk" ? "/uk/launches?launch=stub" : "/launches?launch=stub&lang=en";
    const ready = async () => {
      await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "MOTH"), null, { timeout: 180_000 });
      await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: 60_000 }).catch(() => {});
      await page.evaluate(() => new Promise((done) => Object.assign(new Image(), { onload: done, onerror: done, src: "/city/art/district-launch-1600.webp" })));
    };
    await page.goto(`${base}${address}`, { waitUntil: "domcontentloaded" });
    await ready();
    await win.locator("[data-launched]").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    await shot("list");

    // Only Ryntra's test launches on the chain, as on mainnet today: the empty state, the tests apart and closed.
    await page.evaluate(() => {
      const launch = window.__launch;
      launch.setState({ feed: launch.getState().feed.map((tower) => ({ ...tower, ryntraTest: true })) });
    });
    await win.getByText(t("Be the first tower", "Стань першою вежею")).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    await shot("empty");
    await win.getByText(t("Ryntra test launches", "Тестові запуски Ryntra")).click();
    await page.waitForTimeout(600);
    await shot("tests");

    // Back to the list, and «Trade» on the first coin: the window steps aside and the tower opens.
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready();
    const trade = win.getByRole("button", { name: /^(Trade|Торгувати) \$/ }).first();
    await trade.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await trade.click();
    await page.waitForFunction(() => window.__city?.getState().selectedId, null, { timeout: 30_000 });
    await page.waitForTimeout(3500);
    await shot("trade");

    if (errors.length) console.log(`${locale} ${s.name}: page errors`, errors);
    await context.close();
    console.log(`${locale} ${s.name}: done`);
  }
}

await browser.close();
