// The launch sheet (L6 · CITY-143) for review: the Deck's «Launch» → the sheet with the cost line first and the live
// preview of the tower; the fields filled, the face risen; the engine's refusal of a picture said on the form at once;
// the rules (bot shield, two facts, the one line) before and after the wallet — the cost simulated; «i»; the wallet's
// prompt; the liftoff — at 1440×860 and 375×812 → <out>/sheet-<state>-<size>-<locale>.jpg
//   node city/lib/launch/sheet-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "out/sheet-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk,en").split(",");
const PACE = process.env.PACE ?? 2;

/** The creator's picture for the stand: a 256 px amber orb with a halo on deep violet, as a PNG. */
function picture() {
  const size = 256;
  const rows = [];
  const mix = (a, b, t) => Math.round(a + (b - a) * Math.min(1, Math.max(0, t)));
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - 128, y - 122) / 128;
      const bg = [mix(34, 12, y / size), mix(14, 8, y / size), mix(70, 30, y / size)];
      const glow = Math.max(0, 1 - d / 0.95) ** 2;
      const orb = Math.min(1, Math.max(0, (0.5 - d) * 40));
      const ring = Math.max(0, 1 - Math.abs(d - 0.66) * 30) * 0.8;
      const core = [mix(255, 255, d), mix(222, 140, d / 0.5), mix(150, 40, d / 0.5)];
      const lit = bg.map((c, i) => mix(c, [255, 160, 60][i], glow * 0.55 + ring));
      row.push(...lit.map((c, i) => mix(c, core[i], orb)));
    }
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const file = { name: "orb.png", mimeType: "image/png", buffer: picture() };
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const locale of LOCALES) {
  for (const s of SIZES) {
    const t = (en, uk) => (locale === "uk" ? uk : en);
    const open = async (extra = "") => {
      const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${base}/?launch=stub&pace=${PACE}&lang=${locale}${extra}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForFunction(() => window.__launch?.getState().status === "ready" && window.__city?.getState().layout.towers.length > 0, null, { timeout: 240_000 });
      await page.waitForTimeout(3000);
      await page.locator("[data-deck-place=launch]").click({ timeout: 180_000 });
      await page.locator("[data-launch-preview]").waitFor({ timeout: 120_000 });
      await page.waitForTimeout(900);
      return { context, page, errors };
    };
    const sheet = (page) => page.locator("[data-launch-sheet]");
    const shot = (page, state) => page.screenshot({ path: path.join(out, `sheet-${state}-${s.name}-${locale}.jpg`), quality: 86, timeout: 120_000, animations: "disabled" });
    const fill = async (page) => {
      await sheet(page).getByLabel(t("Name", "Назва")).fill("Kite");
      await sheet(page).getByLabel(t("Ticker", "Тікер")).fill("kite");
      await page.locator("[data-launch-preview] input[type=file]").setInputFiles(file);
    };
    const dump = (page) => async (error) => {
      console.log(await page.locator("body").innerText().catch(() => ""));
      throw error;
    };

    // The Deck's «Launch»: the cost line first, the docks of our own city and an empty face over them.
    const { context, page, errors } = await open();
    await shot(page, "empty");

    // The three fields: the face rises a step for each; the picture goes to the engine's store in the background.
    await fill(page);
    await page.waitForFunction(() => window.__launch.getState().stored?.answer?.ok === true, null, { timeout: 60_000 }).catch(dump(page));
    await page.waitForTimeout(1200);
    await shot(page, "filled");

    // The rules: the bot shield with what bots pay, the two facts, the one line; no wallet yet.
    await sheet(page).getByRole("button", { name: t("Review $KITE", "Огляд $KITE") }).click();
    await page.locator("[data-launch-line]").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(900);
    await shot(page, "rules");

    // The wallet: the engine simulates the launch, the cost line says the network's cost, the promise under the action.
    await sheet(page).getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
    await sheet(page).getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).waitFor({ timeout: 30_000 });
    await sheet(page).getByText(t("network ≈", "мережа ≈")).waitFor({ timeout: 60_000 }).catch(dump(page));
    await page.waitForTimeout(800);
    await shot(page, "wallet");

    // «i»: the schedule, the creator's part, the pool, what is for ever, the other route, the cost.
    await sheet(page).getByRole("button", { name: t("Details", "Деталі") }).click();
    await page.waitForTimeout(700);
    await shot(page, "details");
    await sheet(page).getByRole("button", { name: t("Hide", "Сховати") }).click();

    // The press: the build made ahead is still fresh, so the wallet opens at once.
    await sheet(page).getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).click();
    await sheet(page).getByText(t("Confirm in Stub wallet", "Підтверди в Stub wallet")).waitFor({ timeout: 60_000 }).catch(dump(page));
    await page.waitForTimeout(500);
    await shot(page, "sign");

    // The liftoff: the sheet closes, the tower rises in the docks and its window opens.
    await page.waitForFunction(() => window.__launch.getState().mine.length > 0, null, { timeout: 120_000 }).catch(dump(page));
    await page.waitForTimeout(4000);
    await shot(page, "liftoff");
    if (errors.length) console.log(`${s.name} ${locale} page errors:`, errors.slice(0, 5));
    await context.close();

    // The engine refuses the picture: said on the form as soon as the store answers, before any review or wallet.
    const refused = await open("&refuse=picture");
    await fill(refused.page);
    await sheet(refused.page).locator("[role=status]").filter({ hasText: t("Nothing was sent or stored", "Нічого не надіслано й не збережено") }).waitFor({ timeout: 60_000 }).catch(dump(refused.page));
    await sheet(refused.page).getByRole("button", { name: t("New picture", "Нова картинка") }).waitFor({ timeout: 10_000 });
    await refused.page.waitForTimeout(800);
    await shot(refused.page, "refused");
    if (refused.errors.length) console.log(`${s.name} ${locale} refused page errors:`, refused.errors.slice(0, 5));
    await refused.context.close();
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
