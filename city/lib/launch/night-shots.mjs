// Launch Night (L9 · CITY-146) for review: the card that opens the show over the city, the stage on the first launch,
// the next act and the rule behind «i» — at 1440×900 and 375×812, in Ukrainian and English
//   → <out>/night-<state>-<size>-<locale>.jpg
//   node city/lib/launch/night-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub&night=open`): devnet-shaped answers, nothing sent; the
// frames are the live 3D scene's own.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/night-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk,en").split(",");

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const locale of LOCALES) {
  for (const s of SIZES) {
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
    // A device that has learned the first-visit hint.
    await context.addInitScript(() => {
      try {
        localStorage.setItem("ryntra.city.firstHint", "1");
      } catch {}
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (state) => page.screenshot({ path: path.join(out, `night-${state}-${s.name}-${locale}.jpg`), quality: 88, timeout: 300_000, animations: "disabled" });
    const dump = async (error) => {
      console.log(await page.locator("body").innerText().catch(() => ""));
      throw error;
    };
    /** The stage holds still for the shot: the clock that moves it on is pushed past the shot. */
    const hold = () => page.evaluate(() => window.__night.setState({ movedAt: Date.now() + 3_600_000 }));

    await page.goto(`${base}/?launch=stub&night=open&lang=${locale}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "SPARK"), null, { timeout: 180_000 });
    // Into the city from the title screen, as a person does.
    await page.evaluate(() => window.__city.getState().enter());
    await page.waitForFunction(() => window.__night?.getState().status === "ready", null, { timeout: 120_000 }).catch(dump);
    await page.locator("[data-night-card]").waitFor({ timeout: 60_000 }).catch(dump);
    // The skyline's first frame takes a while in a software renderer, longer on a large screen.
    await page.waitForTimeout(30_000);
    await shot("card");

    await page.locator("[data-night-watch]").click({ force: true, timeout: 120_000 });
    await page.locator("[data-launch-night]").waitFor({ timeout: 30_000 }).catch(dump);
    await hold();
    await page.waitForTimeout(3500);
    await shot("stage");

    // The next act: the stage moves on to the first launch climbing its curve.
    const climbing = await page.evaluate(() => window.__night.getState().show.entries.findIndex((entry) => entry.act === "climbing"));
    if (climbing > 0) {
      await page.evaluate((i) => window.__night.getState().go(i), climbing);
      await hold();
      await page.waitForTimeout(3500);
      await shot("climbing");
    }

    // The rule the show keeps, behind «i».
    await page.locator("[data-launch-night] [aria-controls=city-night-more]").click({ force: true, timeout: 120_000 });
    await hold();
    await page.waitForTimeout(800);
    await shot("details");

    // Buy opens the tower's own window; the show steps aside.
    await page.locator("[data-night-buy]").click({ force: true, timeout: 120_000 });
    await page.waitForFunction(() => !window.__night.getState().playing && !!window.__city.getState().selectedId, null, { timeout: 120_000, polling: 500 }).catch(dump);
    await page.waitForTimeout(3500);
    await shot("buy");

    if (errors.length) console.log(`${s.name} ${locale} page errors:`, errors.slice(0, 5));
    await context.close();
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
