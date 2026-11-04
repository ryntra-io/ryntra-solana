// The launch's share cards (L8 · CITY-145) for review: the stub wallet sells its Night Owl, bought 42 s after birth, in
// the pool — the round trip and «Share» under the sale; «Мій причал» on Moth with its two cards one tap to share; and
// the three cards themselves, as the share sheet gets them — at 1440×860 and 390×844
//   → <out>/cards-<state>-<size>-<locale>.jpg and <out>/card-<kind>-<size>-<locale>.png
//   node city/lib/launch/cards-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, a stub wallet, nothing sent; the
// phone's share sheet is caught in the page, and the computer's download is caught by the browser — nothing is posted.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/cards-shots");
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
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, acceptDownloads: true, reducedMotion: "reduce" });
    // The phone's share sheet, caught: the card the person would send, and nothing sent.
    await context.addInitScript(() => {
      Object.assign(navigator, {
        canShare: () => true,
        share: async (data) => {
          window.__shared = data;
        },
      });
    });
    const page = await context.newPage();
    // X's page, opened on a computer after the card is saved, is closed at once.
    context.on("page", (opened) => opened !== page && void opened.close().catch(() => undefined));
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (state) => page.screenshot({ path: path.join(out, `cards-${state}-${s.name}-${locale}.jpg`), quality: 88, timeout: 120_000, animations: "disabled" });
    const t = (en, uk) => (locale === "uk" ? uk : en);
    const dump = async (error) => {
      console.log(await page.locator("body").innerText().catch(() => ""));
      throw error;
    };
    /** The card a tap makes: the computer's download, or what the phone's share sheet was handed. */
    const caught = async (kind, tap) => {
      const file = path.join(out, `card-${kind}-${s.name}-${locale}.png`);
      if (!s.mobile) {
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), tap()]);
        await download.saveAs(file);
        return;
      }
      await page.evaluate(() => {
        window.__shared = null;
      });
      await tap();
      await page.waitForFunction(() => window.__shared?.files?.length > 0, null, { timeout: 30_000 });
      const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__shared.files[0].arrayBuffer())));
      writeFileSync(file, Buffer.from(bytes));
    };

    await page.goto(`${base}/?launch=stub&lang=${locale}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "OWL"), null, { timeout: 180_000 });
    await page.waitForTimeout(3000);

    // The trader: Night Owl's tower, the wallet, a sale of all of it in the pool.
    await page.evaluate(() => {
      const st = window.__city.getState();
      st.select(st.layout.towers.find((t) => t.tower.symbol === "OWL").tower.id);
    });
    const card = page.locator("[role=dialog]").filter({ has: page.getByRole("progressbar") });
    await card.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click({ timeout: 90_000 }).catch(dump);
    await card.getByRole("tab", { name: t("Sell", "Продати") }).click();
    await card.getByRole("button", { name: t("MAX", "МАКС"), exact: true }).click();
    const sell = card.getByRole("button", { name: new RegExp(t("Sell", "Продати") + ".*\\$OWL") });
    await sell.waitFor({ timeout: 30_000 }).catch(dump);
    await card.getByText("≈").first().waitFor({ timeout: 60_000 }).catch(dump);
    await sell.click();
    await page.locator("[data-round-trip]").waitFor({ timeout: 60_000 }).catch(dump);
    await page.waitForTimeout(1500);
    await shot("round");
    await caught("round", () => page.locator("[data-share-card=round]").click());
    await page.waitForTimeout(600);
    if (!s.mobile) await shot("round-saved");

    // The creator: «Мій причал» on Moth, both cards reached, each one tap to share.
    await page.keyboard.press("Escape");
    await page.locator("[data-deck-place=launch]").click();
    await page.locator("[data-launch-berth]").first().click({ timeout: 120_000 });
    const win = page.locator("[data-window=berth]");
    const connect = win.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") });
    if (await connect.isVisible({ timeout: 5_000 }).catch(() => false)) await connect.click();
    await win.locator("[data-share-card=graduated]").waitFor({ timeout: 60_000 }).catch(dump);
    // On a phone the cards sit below the streams, above the pinned dock: the sheet is scrolled to them.
    await win.locator("[data-share-card=graduated]").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(1500);
    await shot("berth");
    await caught("graduated", () => win.locator("[data-share-card=graduated]").click());
    await page.waitForTimeout(600);
    if (!s.mobile) await shot("berth-saved");
    await caught("born", () => win.locator("[data-share-card=born]").click());
    // Where the two moments rest on the chain: behind «i», beside the receipts.
    await win.getByRole("button", { name: t("Details", "Деталі") }).click();
    await page.waitForTimeout(800);
    await shot("berth-details");

    if (errors.length) console.log(`${s.name} ${locale} page errors:`, errors.slice(0, 5));
    await context.close();
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
