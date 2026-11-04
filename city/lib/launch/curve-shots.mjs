// CITY-139 for review: a launch tower's window (Buy and Sell are CITY-138's, `trade-shots.mjs`), «Report», a coin Ryntra
// took down, the review's «Bot shield» and a picture the image check refused — at 1440×860 and 390×844
// → <out>/curve-<state>-<size>.png. The creator's claim is «Мій причал» (CITY-141).
//   node city/lib/launch/curve-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "out/curve-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
/** A 256 px picture for the coin: an amber sun on violet, as a PNG. */
function picture() {
  const size = 256;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - 128, y - 118) / 128;
      const sun = d < 0.48;
      row.push(sun ? 255 : 42 + y / 6, sun ? 178 - d * 60 : 22 + y / 10, sun ? 63 : 64 + y / 5);
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

const file = { name: "sun.png", mimeType: "image/png", buffer: picture() };

const executablePath = process.env.PRESS_CHROME || undefined;
const browser = await chromium.launch({ executablePath, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });

const pick = (page, symbol) =>
  page.evaluate((symbol) => {
    const st = window.__city.getState();
    st.select(st.layout.towers.find((t) => t.tower.symbol === symbol).tower.id);
  }, symbol);

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `curve-${state}-${s.name}.png`), timeout: 120_000, animations: "disabled" });

  await page.goto(`${base}/?launch=stub&pace=1&refuse=picture&lang=en`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "GLNT"), null, { timeout: 180_000 });
  await page.waitForTimeout(4000);

  // A launch tower's window, then «Report»: one reason, one press.
  await pick(page, "KITE");
  const report = page.getByRole("button", { name: "Report", exact: true });
  await report.waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  await shot("tower");
  // The window's clock repaints its head every second; the click goes straight to the flag.
  await report.dispatchEvent("click");
  await page.getByRole("radio", { name: "Pretends to be someone" }).click();
  await page.waitForTimeout(500);
  await shot("report");

  // A coin Ryntra took down: no picture, only Sell; the chain keeps it.
  await pick(page, "GLNT");
  await page.getByText("Hidden by Ryntra · the chain keeps it").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await shot("hidden");
  await page.evaluate(() => window.__city.getState().select(null));
  await page.waitForTimeout(1500);

  // The sheet: the review's «Bot shield», then a picture the image check refused.
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await page.getByText("Raise your tower").waitFor();
  await page.getByLabel("Name").fill("Lumen");
  await page.getByLabel("Ticker").fill("lumen");
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Review $LUMEN" }).click();
  await page.getByRole("switch", { name: "Bot shield" }).waitFor();
  await page.waitForTimeout(500);
  await shot("shield-on");
  await page.getByRole("switch", { name: "Bot shield" }).click();
  await page.waitForTimeout(500);
  await shot("shield-off");
  await page.getByRole("button", { name: "Connect wallet" }).last().click();
  await page.getByRole("button", { name: "Launch $LUMEN" }).click();
  await page.getByText(/picture check reads this as graphic content/).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(400);
  await shot("picture-refused");

  console.log(`${s.name}: errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 300) : ""}`);
  await context.close();
}
await browser.close();
