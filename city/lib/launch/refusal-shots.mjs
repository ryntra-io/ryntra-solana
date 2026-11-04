// A stopped launch (CITY-181) for review: the sheet's refusal — one sentence, the money, one action, «Details» — for
// Ryntra's co-signer that did not sign, a wallet short of SOL, a person who declined in the wallet, and a send with no
// answer; at 1440×860 and 375×812 → <out>/refusal-<state>-<size>-<locale>.jpg, and one with «Details» open.
//   node city/lib/launch/refusal-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub&refuse=…`): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "out/refusal-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk,en").split(",");
const STATES = (process.env.STATES ?? "payer,sol,sign,answer").split(",");
const PACE = process.env.PACE ?? 1;

/** A 256 px amber orb on deep violet, as a PNG — the creator's picture on the stand. */
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

for (const locale of LOCALES) {
  for (const s of SIZES) {
    const t = (en, uk) => (locale === "uk" ? uk : en);
    for (const state of STATES) {
      const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const dump = async (error) => {
        console.log(await page.locator("body").innerText().catch(() => ""));
        throw error;
      };
      await page.goto(`${base}/?launch=stub&pace=${PACE}&lang=${locale}&refuse=${state}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForFunction(() => window.__launch?.getState().status === "ready" && window.__city?.getState().layout.towers.length > 0, null, { timeout: 240_000 });
      await page.waitForTimeout(2500);
      await page.locator("[data-deck-place=launch]").click({ timeout: 180_000 });
      const sheet = page.locator("[data-launch-sheet]");
      await page.locator("[data-launch-preview]").waitFor({ timeout: 120_000 });
      await sheet.getByLabel(t("Name", "Назва")).fill("Kite");
      await sheet.getByLabel(t("Ticker", "Тікер")).fill("kite");
      await page.locator("[data-launch-preview] input[type=file]").setInputFiles(file);
      await page.waitForFunction(() => window.__launch.getState().stored?.answer?.ok === true, null, { timeout: 60_000 }).catch(dump);
      await sheet.getByRole("button", { name: t("Review $KITE", "Огляд $KITE") }).click();
      await sheet.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
      await sheet.getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).click({ timeout: 60_000 });
      await sheet.locator("[data-launch-refusal]").waitFor({ timeout: 120_000 }).catch(dump);
      await page.waitForTimeout(700);
      const shot = (name) => page.screenshot({ path: path.join(out, `refusal-${name}-${s.name}-${locale}.jpg`), quality: 86, timeout: 120_000, animations: "disabled" });
      await shot(state);
      if (state === STATES[0]) {
        await sheet.locator("[data-launch-refusal]").getByRole("button", { name: t("Details", "Деталі") }).click();
        await page.waitForTimeout(500);
        await shot(`${state}-details`);
      }
      if (errors.length) console.log(`${s.name} ${locale} ${state} page errors:`, errors.slice(0, 5));
      await context.close();
      console.log(`${s.name} ${locale} ${state} done`);
    }
  }
}
await browser.close();
