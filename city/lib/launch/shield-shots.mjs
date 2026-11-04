// The shielded launch (CITY-169) for review, with the shield open on the deployment
// (`NEXT_PUBLIC_RYNTRA_CITY_SHIELD=open` for `npm run dev`): the halo on the launch towers in the docks, the tower's
// window with its halo and the line behind «i», the launch sheet's review with the halo, the cost line and the one line
// before the signature, and «i» with the halo's row — at 1440×860 and 375×812 → <out>/shield-<state>-<size>-<locale>.jpg
//   node city/lib/launch/shield-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "out/shield-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk,en").split(",");
/** The tower whose halo the shots look at: on the stand, Nova — Classic, its creator's first purchase locked. */
const HALO = process.env.HALO ?? "NOVA";

/** A 256 px picture for the sheet: an amber orb on deep violet, as a PNG. */
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
      const core = [255, mix(222, 140, d / 0.5), mix(150, 40, d / 0.5)];
      const lit = bg.map((c, i) => mix(c, [255, 160, 60][i], glow * 0.55));
      row.push(...lit.map((c, i) => mix(c, core[i], orb)));
    }
    rows.push(Buffer.from(row));
  }
  const crc32 = (bytes) => {
    let crc = ~0;
    for (const byte of bytes) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
  };
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

const file = { name: "orb.png", mimeType: "image/png", buffer: picture() };
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const HIDE_HUD = "body * { visibility: hidden !important; } canvas { visibility: visible !important; }";

for (const locale of LOCALES) {
  for (const s of SIZES) {
    const t = (en, uk) => (locale === "uk" ? uk : en);
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (state) => page.screenshot({ path: path.join(out, `shield-${state}-${s.name}-${locale}.jpg`), quality: 86, timeout: 120_000, animations: "disabled" });
    await page.goto(`${base}/?launch=stub&pace=2&lang=${locale}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction((symbol) => window.__launch?.getState().status === "ready" && window.__city?.getState().layout.towers.some((t) => t.tower.symbol === symbol), HALO, { timeout: 240_000 });
    await page.waitForTimeout(4000);

    // The halo in the city: close on the docks, the halo tower in the middle, no HUD.
    const aim = await page.evaluate((symbol) => {
      const t = window.__city.getState().layout.towers.find((entry) => entry.tower.symbol === symbol);
      const d = Math.max(14, t.height * 2.6);
      return { eye: [t.x + d * 0.8, t.height * 0.9 + d * 0.35, t.z + d * 0.95], target: [t.x, t.height * 0.42, t.z] };
    }, HALO);
    /* The city's opening flight may still be running: aim, let it settle, aim again. */
    await page.waitForFunction(() => typeof window.__cityView === "function", null, { timeout: 60_000 });
    await page.evaluate(({ eye, target }) => window.__cityView(eye, target), aim);
    await page.waitForTimeout(2500);
    await page.evaluate(({ eye, target }) => window.__cityView(eye, target), aim);
    const hud = await page.addStyleTag({ content: HIDE_HUD });
    await page.waitForTimeout(2500);
    await shot("city");
    await hud.evaluate((node) => node.remove());
    await page.evaluate(() => window.__cityView(null));

    // The tower's window: the halo among its tags, and behind «i» what the halo is.
    await page.evaluate((symbol) => {
      const st = window.__city.getState();
      st.select(st.layout.towers.find((entry) => entry.tower.symbol === symbol).tower.id);
    }, HALO);
    await page.locator("[data-launch-halo]").first().waitFor({ timeout: 60_000 });
    await page.locator("[data-launch-status]").first().click();
    await page.waitForTimeout(1500);
    await shot("window");
    await page.evaluate(() => window.__city.getState().select(null));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);

    // The sheet: the three fields, then the review with the halo — the cost line first and the one line before the signature.
    for (let attempt = 0; ; attempt += 1) {
      await page.locator("[data-deck-place=launch]").click({ timeout: 180_000 });
      const opened = await page.locator("[data-launch-preview]").waitFor({ timeout: 20_000 }).then(() => true, () => false);
      if (opened) break;
      if (attempt >= 3) throw new Error("the launch sheet did not open");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1500);
    }
    const sheet = page.locator("[data-launch-sheet]");
    await sheet.getByLabel(t("Name", "Назва")).fill("Kite");
    await sheet.getByLabel(t("Ticker", "Тікер")).fill("kite");
    await page.locator("[data-launch-preview] input[type=file]").setInputFiles(file);
    await page.waitForFunction(() => window.__launch.getState().stored?.answer?.ok === true, null, { timeout: 60_000 });
    await sheet.getByRole("button", { name: t("Review $KITE", "Огляд $KITE") }).click();
    await sheet.locator("[data-launch-halo]").waitFor({ timeout: 30_000 });
    await sheet.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
    await sheet.getByText(t("network ≈", "мережа ≈")).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(900);
    await shot("review");

    // «i»: the schedule, then the halo's row — what keeps it on the tower.
    await sheet.getByRole("button", { name: t("Details", "Деталі") }).click();
    await page.waitForTimeout(700);
    await shot("details");
    if (errors.length) console.log(`${s.name} ${locale} page errors:`, errors.slice(0, 5));
    await context.close();
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
