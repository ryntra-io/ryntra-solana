// «Straight to a pool» with its door shut — the deployment's switch closed, as on ryntra.io: the same city,
// the same launch review and the same command line as master's, at 1440×860 and 375×812. Run once against master's
// tree and once against this branch's, each on its own development stand-in (`?launch=stub`, no `&pool=open`):
//   node city/lib/launch/pool-closed-shots.mjs <out> <baseUrl> <label>      (PRESS_CHROME may point at a Chromium)
// → <out>/closed-<state>-<label>-<size>-<locale>.jpg, and <out>/closed-<label>.json: what each page holds, to compare
// in words — whether the pool's door is there, the review's line and rows, the command line's rows.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-247");
const base = process.argv[3] ?? "http://localhost:3000";
const label = process.argv[4] ?? "branch";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk").split(",");
const SAID = { uk: "запусти мені токен Moon Cat $MOON в пул через 20 хвилин", en: "launch Moon Cat $MOON into a pool in 20 minutes" };

/** A 64 px amber square as a PNG: the creator's picture for the stand. */
function picture() {
  const size = 64;
  const rows = [];
  for (let y = 0; y < size; y += 1) rows.push(Buffer.from([0, ...Array.from({ length: size }, () => [255, 150, 50]).flat()]));
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
const file = { name: "square.png", mimeType: "image/png", buffer: picture() };
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const facts = {};

for (const locale of LOCALES) {
  for (const s of SIZES) {
    const t = (en, uk) => (locale === "uk" ? uk : en);
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
    const page = await context.newPage();
    const shot = (state) => page.screenshot({ path: path.join(out, `closed-${state}-${label}-${s.name}-${locale}.jpg`), quality: 84, timeout: 120_000, animations: "disabled" });
    const ready = () => page.waitForFunction(() => window.__launch?.getState().status === "ready" && window.__city?.getState().layout.towers.length > 0 && typeof window.__openCommand === "function", null, { timeout: 480_000 });
    /* A cold development server builds the sheet's part on its first open and may reload the page for it: the city is waited for again, and the sheet opened again. */
    const openSheet = async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await ready();
        await page.evaluate(() => window.__launch.getState().openSheet()).catch(() => undefined);
        if (await page.locator("[data-launch-preview]").waitFor({ timeout: 120_000 }).then(() => true, () => false)) return;
      }
      throw new Error("the launch sheet did not open");
    };
    // Every other route of the city answers at once: slow reads of a development server — some take
    // minutes — hold the browser's six connections, and the windows' own code then waits behind them until it times out.
    // The city itself is read; the launch is the stand-in's, in the page.
    await page.route("**/api/**", (route) => (new URL(route.request().url()).pathname === "/api/city" ? route.fallback() : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE" } }) })));
    await page.route("**/api/icon/*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#23222D"/></svg>' }));
    await page.goto(`${base}/?launch=stub&pace=1&lang=${locale}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await ready();
    await page.waitForTimeout(6_000);
    await shot("city");
    const key = `${s.name}-${locale}`;
    const here = (facts[key] = { towers: await page.evaluate(() => window.__city.getState().layout.towers.length) });

    // The launch review: no third door, the line and the rows as they always were.
    await openSheet();
    const sheet = page.locator("[data-launch-sheet]");
    await sheet.getByLabel(t("Name", "Назва")).fill("Kite");
    await sheet.getByLabel(t("Ticker", "Тікер")).fill("kite");
    await page.locator(s.mobile ? "[data-launch-gallery]" : "[data-launch-preview] input[type=file]").first().setInputFiles(file);
    await page.waitForFunction(() => window.__launch.getState().stored?.answer?.ok === true, null, { timeout: 120_000 });
    await sheet.getByRole("button", { name: t("Review $KITE", "Огляд $KITE") }).click();
    await page.locator("[data-launch-line]").waitFor({ timeout: 60_000 });
    await sheet.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
    await sheet.getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1_200);
    await shot("review");
    here.poolDoor = await page.locator("[data-launch-pool]").count();
    here.line = (await page.locator("[data-launch-line]").innerText()).trim();
    here.review = (await sheet.innerText()).replace(/\s+/g, " ").trim();
    await page.evaluate(() => window.__launch.getState().closeSheet());
    await page.waitForTimeout(800);

    // The command line: a sentence that names a pool reads as it always did.
    await page.evaluate(() => window.__openCommand());
    const field = page.locator("[data-city-command] input").first();
    await field.waitFor({ timeout: 60_000 });
    await field.fill(SAID[locale]);
    await page.waitForTimeout(1_200);
    await shot("command");
    here.command = (await page.locator("[data-city-command] [role=listbox]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    await context.close();
    console.log(`${label} ${key}: towers ${here.towers} · pool door ${here.poolDoor}`);
  }
}
writeFileSync(path.join(out, `closed-${label}.json`), `${JSON.stringify(facts, null, 1)}\n`);
await browser.close();
