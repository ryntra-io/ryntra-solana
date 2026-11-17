// «Straight to a pool» for review: the door in the launch's review — off, on with its times and its two
// facts, the creator's ladder, «i»; the three approvals; the launch set, counting down; its tower's window — the countdown, «Details», a
// trading tower — and the tower in the city with its countdown and its shield — at 1440×860 and 375×812
// → <out>/pool-<state>-<size>-<locale>.jpg
//   node city/lib/launch/pool-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub&pool=open`): devnet-shaped answers, a stub wallet,
// nothing built, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-247");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk,en").split(",");
const PACE = process.env.PACE ?? 2;

/** The creator's picture for the stand: a 256 px amber orb on deep violet, as a PNG. */
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
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 300)}`);
    });
    // Every other route of the city answers at once: slow reads of a development server — some take
    // minutes — hold the browser's six connections, and the windows' own code then waits behind them until it times out.
    // The city itself is read; the launch is the stand-in's, in the page.
    await page.route("**/api/**", (route) => (new URL(route.request().url()).pathname === "/api/city" ? route.fallback() : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE" } }) })));
    await page.route("**/api/icon/*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#23222D"/></svg>' }));
    await page.goto(`${base}/?launch=stub&pool=open&pace=${PACE}&lang=${locale}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => window.__launch?.getState().status === "ready" && window.__city?.getState().layout.towers.length > 0, null, { timeout: 240_000 });
    await page.waitForTimeout(3000);
    const sheet = page.locator("[data-launch-sheet]");
    const shot = async (state, target = null) => {
      if (target) await target.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.screenshot({ path: path.join(out, `pool-${state}-${s.name}-${locale}.jpg`), quality: 86, timeout: 120_000, animations: "disabled" });
    };
    const dump = async (error) => {
      const state = await page.evaluate(() => JSON.stringify({ launch: window.__launch?.getState().status, stub: window.__launch?.getState().stub, network: window.__launch?.getState().network, pool: window.__pool ? { open: window.__pool.getState().switchOpen, launches: window.__pool.getState().launches.length } : null })).catch(() => "unread");
      console.log(`state: ${state}`);
      console.log(`errors: ${JSON.stringify(errors.slice(-8))}`);
      throw error;
    };

    // The city first: the stand's two launches into a pool stand in the docks — one counting down, one trading.
    await page.waitForFunction(() => window.__pool?.getState().launches.length >= 2, null, { timeout: 480_000 }).catch(dump);
    const mints = await page.evaluate(() => window.__pool.getState().launches.map((launch) => ({ mint: launch.mint, symbol: launch.symbol })));
    const glow = mints.find((entry) => entry.symbol === "GLOW").mint;
    const tide = mints.find((entry) => entry.symbol === "TIDE").mint;
    await page.waitForFunction((mint) => window.__city.getState().layout.towers.some((tower) => tower.tower.id === mint), glow, { timeout: 240_000 }).catch(dump);

    // A tower counting down: its window — the countdown, the two facts, the one line; then «Details».
    await page.evaluate((mint) => window.__city.getState().select(mint), glow);
    await page.locator("[data-pool-tower=COUNTDOWN]").waitFor({ timeout: 60_000 }).catch(dump);
    await page.locator("[data-pool-honest]").waitFor({ timeout: 30_000 }).catch(dump);
    await page.waitForTimeout(2500);
    await shot("tower-countdown");
    await page.locator("[data-pool-honest] button").click();
    await page.waitForTimeout(500);
    await shot("tower-details", page.locator("[data-pool-honest]"));

    // A tower trading: how far the price stands from its first, and what is left of the shield.
    await page.evaluate((mint) => window.__city.getState().select(mint), tide);
    await page.locator("[data-pool-tower=OPEN]").waitFor({ timeout: 60_000 }).catch(dump);
    await page.locator("[data-pool-honest]").waitFor({ timeout: 30_000 }).catch(dump);
    await page.waitForTimeout(2500);
    await shot("tower-open");
    await page.evaluate(() => window.__city.getState().select(null));
    await page.waitForTimeout(800);

    // The launch sheet: the fields, the review, the wallet — the door is one quiet row.
    /*
     * Opened through the district's own store, as the Deck's «Launch» does. A cold development server builds the sheet's
     * part on its first open and may reload the page for it: the city is waited for again, and the sheet opened again.
     */
    let opened = false;
    for (let attempt = 0; attempt < 4 && !opened; attempt += 1) {
      await page.waitForFunction(() => window.__launch?.getState().status === "ready" && window.__city?.getState().layout.towers.length > 0, null, { timeout: 480_000 }).catch(dump);
      await page.evaluate(() => window.__launch.getState().openSheet()).catch(() => undefined);
      opened = await page.locator("[data-launch-preview]").waitFor({ timeout: 120_000 }).then(() => true, () => false);
    }
    if (!opened) await dump(new Error("the launch sheet did not open"));
    await sheet.getByLabel(t("Name", "Назва")).fill("Kite");
    await sheet.getByLabel(t("Ticker", "Тікер")).fill("kite");
    await page.locator(s.mobile ? "[data-launch-gallery]" : "[data-launch-preview] input[type=file]").first().setInputFiles(file);
    await page.waitForFunction(() => window.__launch.getState().stored?.answer?.ok === true, null, { timeout: 60_000 }).catch(dump);
    await sheet.getByRole("button", { name: t("Review $KITE", "Огляд $KITE") }).click();
    await page.locator("[data-launch-line]").waitFor({ timeout: 30_000 });
    await sheet.getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
    await sheet.getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(900);
    const door = sheet.locator("[data-launch-pool]");
    await shot("row", door);

    // On: when trading opens, what snipers pay, and the one line before the signature.
    await sheet.getByRole("switch", { name: t("Straight to a pool", "Одразу в пул"), exact: false }).click();
    await sheet.locator("[data-launch-pool=on]").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(700);
    await shot("on", door);
    await sheet.getByRole("radio", { name: t("1 hour", "1 година") }).click();
    await page.waitForTimeout(400);
    await shot("on-hour", sheet.locator("[data-launch-line]"));

    // The creator's take-profit ladder: one switch in the door, and the line says the twentieth that is for sale.
    await sheet.locator("[data-launch-pool-ladder]").click();
    await sheet.locator("[data-launch-pool-ladder=on]").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await shot("ladder", sheet.locator("[data-launch-line]"));

    // «i»: how it works — the pool, the fee, the lock, who earns, the three approvals, the rent.
    await sheet.getByRole("button", { name: t("Details", "Деталі") }).click();
    await page.waitForTimeout(600);
    await shot("details", sheet.getByText(t("Your wallet signs three times", "Гаманець підписує тричі"), { exact: false }));
    await sheet.getByRole("button", { name: t("Hide", "Сховати") }).click();

    // The press: three approvals, each named.
    await sheet.getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).click();
    await sheet.getByText(t("Step 1 of 3", "Крок 1 з 3")).waitFor({ timeout: 60_000 }).catch(dump);
    await page.waitForTimeout(500);
    await shot("step-1", sheet.locator("[role=status]").first());
    await sheet.getByText(t("Step 2 of 3", "Крок 2 з 3")).waitFor({ timeout: 120_000 }).catch(dump);
    await page.waitForTimeout(500);
    await shot("step-2", sheet.locator("[role=status]").first());
    await sheet.getByText(t("Step 3 of 3", "Крок 3 з 3")).waitFor({ timeout: 120_000 }).catch(dump);
    await page.waitForTimeout(500);
    await shot("step-3", sheet.locator("[role=status]").first());

    // Set: the coin is in its pool, and counts down to its opening.
    await sheet.locator("[data-launch-pooled]").waitFor({ timeout: 180_000 }).catch(dump);
    await page.waitForTimeout(700);
    await shot("set", sheet.locator("[data-launch-pooled]"));

    // Its tower: the creator's own launch stands in the docks, counting down.
    await sheet.locator("[data-launch-pooled-tower]").click();
    await page.locator("[data-pool-tower=COUNTDOWN]").waitFor({ timeout: 60_000 }).catch(dump);
    await page.waitForTimeout(3000);
    await shot("own-tower");
    if (errors.length) console.log(`${s.name} ${locale} page errors:`, errors.slice(0, 5));
    await context.close();
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
