// «Запуск за 30 секунд» → «Моя вежа» → «Кишеня доходів» (CITY-168) for review: the two doors to the picture, a photo as
// the coin's face, the review, the wallet, the liftoff that opens «Моя вежа», the way in from the menu and «Забрати» — at
// 375×812 and 1440×860 → <out>/tower-<state>-<size>-<locale>.jpg
//   node city/lib/launch/tower-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/tower-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "phone", width: 375, height: 812, mobile: true },
  { name: "desk", width: 1440, height: 860, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk,en").split(",");

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });

/** A photo as a phone's camera hands it over: a large JPEG, drawn in a page of its own. */
async function cameraPhoto() {
  const page = await browser.newPage();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 4000;
    const c = canvas.getContext("2d");
    const sky = c.createLinearGradient(0, 0, 0, 4000);
    sky.addColorStop(0, "#ff681c");
    sky.addColorStop(1, "#2a1458");
    c.fillStyle = sky;
    c.fillRect(0, 0, 3000, 4000);
    c.fillStyle = "#ffd28a";
    c.beginPath();
    c.arc(1500, 1800, 760, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#0b0a14";
    c.beginPath();
    c.arc(1240, 1660, 110, 0, Math.PI * 2);
    c.arc(1760, 1660, 110, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 70;
    c.strokeStyle = "#0b0a14";
    c.beginPath();
    c.arc(1500, 1900, 360, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
  });
  await page.close();
  return { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") };
}

const photo = await cameraPhoto();

for (const locale of LOCALES) {
  for (const s of SIZES) {
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (state) => page.screenshot({ path: path.join(out, `tower-${state}-${s.name}-${locale}.jpg`), quality: 88, timeout: 120_000, animations: "disabled" });
    const t = (en, uk) => (locale === "uk" ? uk : en);
    const win = page.locator("[data-window=berth]");

    await page.goto(`${base}/?launch=stub&lang=${locale}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "MOTH"), null, { timeout: 180_000 });
    await page.waitForTimeout(3000);

    // The sheet: on a phone two doors to the picture; with a mouse the one picker.
    await page.locator("[data-deck-place=launch]").click();
    await page.locator("[data-launch-preview]").waitFor({ timeout: 120_000 }).catch(async (error) => {
      await shot("stuck");
      console.log(await page.evaluate(() => JSON.stringify({ launch: window.__launch.getState().status, sheet: window.__launch.getState().sheet, selected: window.__city.getState().selectedId, count: document.querySelectorAll("[data-launch-preview]").length })));
      throw error;
    });
    await page.waitForTimeout(900);
    await shot("doors");

    // The photo becomes the coin's face.
    await page.locator(s.mobile ? "[data-launch-camera]" : 'input[type="file"]').setInputFiles(photo);
    await page.locator("[data-launch-preview] [class*=badgeSet]").waitFor({ timeout: 30_000 });
    await page.getByLabel(t("Name", "Назва")).fill("Sunny");
    await page.getByLabel(t("Ticker", "Тікер")).fill("sunny");
    await page.waitForTimeout(1200);
    await shot("photo");

    await page.getByRole("button", { name: t("Review $SUNNY", "Огляд $SUNNY") }).click();
    await page.locator("[data-launch-sheet]").getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
    const launch = page.getByRole("button", { name: t("Launch $SUNNY", "Запустити $SUNNY") });
    await launch.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await shot("review");
    await launch.click();

    // Straight from the signature to «Моя вежа», the tower framed above it.
    await win.waitFor({ timeout: 90_000 });
    await win.getByText("$SUNNY").first().waitFor({ timeout: 240_000 });
    await page.waitForTimeout(5000);
    await shot("landed");
    await page.evaluate(() => window.__berth.getState().close());
    await page.waitForTimeout(1500);

    // From the menu, on the launch with something to take.
    await page.locator("[data-city-menu] > button").click();
    await page.waitForTimeout(500);
    await shot("menu");
    await page.locator("[data-city-menu-tower]").click();
    await win.getByRole("tab", { name: "$SPARK" }).click();
    const claim = win.getByRole("button", { name: new RegExp(t("^Claim \\$18\\.64", "^Забрати \\$18,64")) });
    await claim.waitFor({ timeout: 40_000 });
    await page.getByText(t("network ≈", "мережа ≈")).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await shot("pocket");

    await win.getByRole("button", { name: t("Details", "Деталі") }).click();
    await page.waitForTimeout(600);
    await shot("details");
    await win.getByRole("button", { name: t("Hide", "Сховати") }).click();

    await claim.click();
    await page.getByText(t("Claimed $18.64", "Забрано $18,64")).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1200);
    await shot("claimed");

    // A coin in its pool: no curve to fill, and the tower's own window one tap away.
    await win.getByRole("button", { name: t("Done", "Готово") }).click();
    await win.getByRole("tab", { name: "$MOTH" }).click();
    await page.waitForTimeout(3000);
    await shot("pool");
    await page.locator("[data-berth-tower]").click();
    await page.waitForTimeout(3500);
    await shot("tower");

    console.log(`${s.name} ${locale}: errors=${errors.length}${errors.length ? ` → ${errors[0].slice(0, 300)}` : ""}`);
    await context.close();
  }
}
await browser.close();
