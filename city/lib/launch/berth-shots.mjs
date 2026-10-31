// «Мій причал» (L4 · CITY-141) for review: the way in from the launch sheet's head, the berth on Moth (in its pool: all
// three streams, both cards), «i», Spark (on its curve: the exit and the pool ahead), «Забрати» done, and the way in
// from the creator's own tower — at 1440×860 and 390×844 → <out>/berth-<state>-<size>-<locale>.jpg
//   node city/lib/launch/berth-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/berth-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk,en").split(",");

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const locale of LOCALES) {
  for (const s of SIZES) {
    // Reduced motion: a still frame of every step (the window scrolls to «i» at once rather than smoothly).
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (state) => page.screenshot({ path: path.join(out, `berth-${state}-${s.name}-${locale}.jpg`), quality: 88, timeout: 120_000, animations: "disabled" });
    const t = (en, uk) => (locale === "uk" ? uk : en);
    const win = page.locator("[data-window=berth]");
    const dump = async (error) => {
      console.log(await page.locator("body").innerText().catch(() => ""));
      throw error;
    };

    // The language by the city's own link (CITY-79).
    await page.goto(`${base}/?launch=stub&lang=${locale}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "MOTH"), null, { timeout: 180_000 });
    await page.waitForTimeout(3000);

    // The way in: the launch sheet's head, «Мій причал» beside its close.
    await page.locator("[data-deck-place=launch]").click();
    await page.locator("[data-launch-berth]").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(800);
    await shot("entry");
    await page.locator("[data-launch-berth]").click();

    // No wallet yet: the docks and the one action.
    await win.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await shot("connect");
    await win.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();

    // Moth, in its pool: what it earned, its days, the three streams, both cards and «Забрати».
    const claim = win.getByRole("button", { name: new RegExp(t("^Claim \\$344\\.00", "^Забрати \\$344,00")) });
    await claim.waitFor({ timeout: 40_000 }).catch(dump);
    await page.getByText(t("network ≈", "мережа ≈")).waitFor({ timeout: 20_000 }).catch(dump);
    await page.waitForTimeout(1500);
    await shot("moth");

    // How it is made, behind «i».
    await win.getByRole("button", { name: t("Details", "Деталі") }).click();
    await page.waitForTimeout(600);
    await shot("details");
    await win.getByRole("button", { name: t("Hide", "Сховати") }).click();

    // Spark, on its curve: the curve earns, the exit and the pool ahead.
    await win.getByRole("tab", { name: "$SPARK" }).click();
    await win.getByRole("button", { name: new RegExp(t("^Claim \\$18\\.64", "^Забрати \\$18,64")) }).waitFor({ timeout: 30_000 }).catch(dump);
    await page.waitForTimeout(1200);
    await shot("spark");

    // «Забрати» on Moth: one signature, the receipt, the counters read again.
    await win.getByRole("tab", { name: "$MOTH" }).click();
    await claim.waitFor({ timeout: 30_000 });
    await claim.click();
    await page.getByText(t("Claimed $344.00", "Забрано $344,00")).waitFor({ timeout: 60_000 }).catch(dump);
    await page.waitForTimeout(1200);
    await shot("claimed");

    // The other way in: the creator's own tower, its window with «Мій причал».
    await win.getByRole("button", { name: t("Done", "Готово") }).click();
    await page.evaluate(() => window.__berth.getState().close());
    await page.evaluate(() => {
      const st = window.__city.getState();
      st.select(st.layout.towers.find((t) => t.tower.symbol === "MOTH").tower.id);
    });
    await page.locator("[data-launch-berth]").last().waitFor({ timeout: 30_000 }).catch(dump);
    await page.waitForTimeout(1500);
    await shot("tower");

    if (errors.length) console.log(`${s.name} ${locale} page errors:`, errors.slice(0, 5));
    await context.close();
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
