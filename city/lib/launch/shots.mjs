// The Launch Docks for review: a launch's tower rising, the sheet with its three fields, a borrowed name, the review,
// the wallet, the send and the liftoff, at 1440×860 and 390×844 → <out>/launch-<state>-<size>.png
//   node city/lib/launch/shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`, slowed by `PACE` so a slow capture catches each step): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "out/launch-shots");
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

const executablePath = process.env.PRESS_CHROME || undefined;
const browser = await chromium.launch({ executablePath, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const file = { name: "sun.png", mimeType: "image/png", buffer: picture() };

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `launch-${state}-${s.name}.png`) });

  await page.goto(`${base}/?launch=stub&pace=${process.env.PACE ?? 3}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "KITE"), null, { timeout: 120_000 });
  await page.waitForTimeout(4000);

  // A launch's tower in the docks, picked: the curve, the holders, the checks.
  await page.evaluate(() => {
    const st = window.__city.getState();
    st.select(st.layout.towers.find((t) => t.tower.symbol === "KITE").tower.id);
  });
  await page.getByText("of $75K to the skyline").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3200);
  await shot("rising");

  // A launch that moved into the skyline and passed its day 7 check.
  await page.evaluate(() => {
    const st = window.__city.getState();
    st.select(st.layout.towers.find((t) => t.tower.symbol === "MOTH").tower.id);
  });
  await page.waitForTimeout(3200);
  await shot("skyline");
  await page.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(2500);

  // The city's moments of a launch's life, as the feed plays them between two reads of the engine.
  for (const [state, symbol, title, value] of [
    ["moment-skyline", "MOTH", "Into the skyline", "$75K · POOL OPEN"],
    ["moment-day7", "NOVA", "Day 7 check", "STILL TRADING"],
  ]) {
    // A capture of the live canvas can take longer than a cut-in stays, so the moment repeats while it is taken.
    await page.evaluate(([symbol, title, value]) => {
      const st = window.__city.getState();
      const tower = st.layout.towers.find((t) => t.tower.symbol === symbol).tower;
      const play = () => st.play({ kind: "pump", towerId: tower.id, symbol, title, value });
      play();
      window.__again = setInterval(play, 1500);
    }, [symbol, title, value]);
    await page.waitForTimeout(450);
    await shot(state);
    await page.evaluate(() => clearInterval(window.__again));
    await page.waitForTimeout(2500);
  }

  // The dock's Launch opens the sheet.
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await page.getByText("Raise your tower").waitFor();
  await page.waitForTimeout(900);
  await shot("form-empty");

  // A borrowed name is said at once, by the engine's own rule.
  await page.getByLabel("Name").fill("Tesla Moon");
  await page.waitForTimeout(400);
  await shot("form-borrowed");

  await page.getByLabel("Name").fill("Lumen");
  await page.getByLabel("Ticker").fill("lumen");
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(800);
  await shot("form");

  await page.getByRole("button", { name: "Review $LUMEN" }).click();
  await page.waitForTimeout(700);
  await shot("review");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Launch $LUMEN" }).waitFor();
  await page.waitForTimeout(500);
  await shot("review-wallet");

  await page.getByRole("button", { name: "Launch $LUMEN" }).click();
  await page.getByText("Confirm in Stub wallet").waitFor({ timeout: 60_000 });
  await shot("sign");
  // The wallet's answer, then the send: the engine's simulated cost stays on the review.
  await page.getByText("Sending to Solana").waitFor({ timeout: 60_000 });
  await shot("sending");

  // The coin lifts off: its tower rises in the docks and its card opens.
  await page.getByText("Liftoff").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(3500);
  await shot("liftoff");

  console.log(`${s.name}: errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 300) : ""}`);
  await context.close();
}
await browser.close();
