// Buy and Sell on a launch's tower (L1 · CITY-138), in the tower's one window (CITY-78), for review: before graduation on the curve with the launch fee
// falling, its details behind «i», a buy done with the position at once, the sale; after graduation in DAMM v2 —
// at 1440×860 and 390×844 → <out>/trade-<state>-<size>-<locale>.jpg
//   node city/lib/launch/trade-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/launch-trade-shots");
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
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (state) => page.screenshot({ path: path.join(out, `trade-${state}-${s.name}-${locale}.jpg`), quality: 88, timeout: 120_000, animations: "disabled" });
    const pick = (symbol) =>
      page.evaluate((symbol) => {
        const st = window.__city.getState();
        st.select(st.layout.towers.find((t) => t.tower.symbol === symbol).tower.id);
      }, symbol);
    const t = (en, uk) => (locale === "uk" ? uk : en);
    // The tower's one window (CITY-78) only: the city's header has its own «Connect wallet».
    const card = page.locator("[role=dialog]").filter({ has: page.getByRole("progressbar") });

    // The language by the city's own link (CITY-79).
    await page.goto(`${base}/?launch=stub&lang=${locale}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "SPARK"), null, { timeout: 180_000 });
    await page.waitForTimeout(3000);

    // Before graduation: the curve, the launch fee falling, the chips — no wallet yet.
    await pick("SPARK");
    await page.getByText(t("Launch fee now", "Комісія запуску зараз")).waitFor({ timeout: 90_000 }).catch(async (error) => {
      console.log(await card.innerText().catch(() => ""));
      throw error;
    });
    await page.getByText("≈").waitFor({ timeout: 60_000 }).catch(async (error) => {
      console.log(await card.innerText().catch(() => ""));
      throw error;
    });
    await page.waitForTimeout(1500);
    await shot("curve-connect");

    // The wallet connected: the one action, the one honest line.
    await card.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
    await card.getByRole("button", { name: new RegExp(t("Buy \\$SPARK", "Купити \\$SPARK")) }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    await shot("curve-buy");

    // Who earns the fee, the route, slippage and the priority fee — behind «i».
    await card.getByRole("button", { name: t("Details", "Деталі") }).click();
    await page.waitForTimeout(600);
    await shot("curve-details");
    await card.getByRole("button", { name: t("Hide", "Сховати") }).click();

    // The buy: one signature, the receipt, the position at once.
    await card.getByRole("button", { name: new RegExp(t("Buy \\$SPARK", "Купити \\$SPARK")) }).click();
    await page.getByText(t("Bought", "Куплено")).waitFor({ timeout: 40_000 });
    await page.getByText(t("Receipt signed", "Квитанцію підписано")).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await shot("curve-done");

    // The sale of what was bought.
    await card.getByRole("button", { name: t("Trade again", "Ще угода") }).click();
    await card.getByRole("tab", { name: t("Sell", "Продати") }).click();
    await card.getByRole("button", { name: new RegExp(t("Sell", "Продати") + ".*\\$SPARK") }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    await shot("curve-sell");

    // After graduation: the same window on its DAMM v2 pool.
    await pick("MOTH");
    await page.getByText(t("Graduated · DAMM v2", "Вийшла · DAMM v2")).waitFor({ timeout: 30_000 });
    await card.getByRole("button", { name: new RegExp(t("Buy \\$MOTH", "Купити \\$MOTH")) }).waitFor({ timeout: 20_000 });
    await card.getByText("≈").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot("pool-buy");
    await card.getByRole("button", { name: t("Details", "Деталі") }).click();
    await page.waitForTimeout(600);
    await shot("pool-details");

    if (errors.length) console.log(`${s.name} ${locale} page errors:`, errors.slice(0, 5));
    await context.close();
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
