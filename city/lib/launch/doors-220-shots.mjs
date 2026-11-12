// The launch's three doors brought to mainnet (CITY-220) for review, at 1440×900 and 390×844, EN and UK →
// <out>/<state>-<size>-<locale>.jpg
//   node city/lib/launch/doors-220-shots.mjs [out] [baseUrl]
// with `NEXT_PUBLIC_RYNTRA_CITY_SHIELD=open npm run dev` running (PRESS_CHROME may point at a Chromium).
//
// The creator: the review with the shield's halo and the split row; the split shown before the signature; the wallet's
// prompt for two transactions; an early launch set, with the one link that calls their people.
// The people (the creator's link, `?early=<mint>`; on the stand `&entry=<moment>`): the window before it opens, open with
// the amounts and the one line, «i», in, the hour of the buy for everyone, the tokens to take, the rest to take back, and
// the window with coming in shut (the kill switch) — never a way back.
// Everything runs on the development stand-in (`?launch=stub`): devnet-shaped answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-220");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const PACE = process.env.PACE ?? 2;
const FRIENDS = ["7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"];

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
const want = (name) => !ONLY || ONLY.some((prefix) => name.startsWith(prefix));

for (const locale of LOCALES) {
  for (const s of SIZES) {
    const t = (en, uk) => (locale === "uk" ? uk : en);
    const open = async (extra = "") => {
      const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${base}/?launch=stub&pace=${PACE}&lang=${locale}${extra}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForFunction(() => window.__launch?.getState().status === "ready" && window.__city?.getState().layout.towers.length > 0, null, { timeout: 240_000 });
      await page.waitForTimeout(2500);
      return { context, page, errors };
    };
    const shot = async (page, state, target = null) => {
      if (target) await target.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${state}-${s.name}-${locale}.jpg`), quality: 84, timeout: 120_000, animations: "disabled" });
      console.log(`  ${state}-${s.name}-${locale}`);
    };
    const dump = (page) => async (error) => {
      console.log(await page.locator("body").innerText().catch(() => ""));
      throw error;
    };
    const sheet = (page) => page.locator("[data-launch-sheet]");
    /* The dock's Launch on a slow development server: tapped again if the sheet has not opened. */
    const openSheet = async (page) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.locator("[data-deck-place=launch]").click({ timeout: 180_000 });
        if (await page.locator("[data-launch-preview]").waitFor({ timeout: 120_000 }).then(() => true, () => false)) return;
      }
      throw new Error("the sheet did not open");
    };

    /* ---------------------------------------------------------------- the creator */
    if (want("shield") || want("share")) {
      const { context, page: p, errors } = await open();
      await openSheet(p);
      await sheet(p).getByLabel(t("Name", "Назва")).fill("Kite");
      await sheet(p).getByLabel(t("Ticker", "Тікер")).fill("kite");
      await p.locator(s.mobile ? "[data-launch-gallery]" : "[data-launch-preview] input[type=file]").first().setInputFiles(file);
      await p.waitForFunction(() => window.__launch.getState().stored?.answer?.ok === true, null, { timeout: 60_000 }).catch(dump(p));
      await sheet(p).getByRole("button", { name: t("Review $KITE", "Огляд $KITE") }).click();
      await sheet(p).getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
      await sheet(p).getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).waitFor({ timeout: 30_000 });
      await sheet(p).locator("[data-launch-halo]").waitFor({ timeout: 30_000 }).catch(dump(p));
      await p.waitForTimeout(900);
      if (want("shield")) await shot(p, "shield-review", sheet(p).locator("[data-launch-halo]"));
      if (want("share")) {
        await sheet(p).locator("[data-launch-share]").click();
        const addresses = sheet(p).getByLabel(t("Wallet address", "Адреса гаманця"));
        await addresses.nth(0).fill(FRIENDS[0]);
        await sheet(p).getByRole("button", { name: t("Add a wallet", "Додати гаманець") }).click();
        await addresses.nth(1).fill(FRIENDS[1]);
        await sheet(p).getByLabel(t("Share", "Частка")).nth(0).fill("20");
        await sheet(p).getByLabel(t("Share", "Частка")).nth(1).fill("10");
        await sheet(p).getByRole("button", { name: t("Done", "Готово") }).click();
        await sheet(p).locator("[data-launch-shares]").waitFor({ timeout: 10_000 });
        await p.waitForFunction(() => window.__launch.getState().costLamports === "13064320", null, { timeout: 60_000 }).catch(dump(p));
        await shot(p, "share-review", sheet(p).locator("[data-launch-shares]"));
        await sheet(p).getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).click();
        await sheet(p).getByText(t("Two transactions", "Дві транзакції"), { exact: false }).waitFor({ timeout: 60_000 }).catch(dump(p));
        await shot(p, "share-sign", sheet(p).locator("[role=status]").first());
        await p.waitForFunction(() => window.__launch.getState().mine.length > 0, null, { timeout: 120_000 }).catch(dump(p));
      }
      if (errors.length) console.log(`${s.name} ${locale} creator errors:`, errors.slice(0, 5));
      await context.close();
    }
    if (want("early-set")) {
      const { context, page: e, errors } = await open("&early=open");
      await openSheet(e);
      await sheet(e).getByLabel(t("Name", "Назва")).fill("Kite");
      await sheet(e).getByLabel(t("Ticker", "Тікер")).fill("kite");
      await e.locator(s.mobile ? "[data-launch-gallery]" : "[data-launch-preview] input[type=file]").first().setInputFiles(file);
      await e.waitForFunction(() => window.__launch.getState().stored?.answer?.ok === true, null, { timeout: 60_000 }).catch(dump(e));
      await sheet(e).getByRole("button", { name: t("Review $KITE", "Огляд $KITE") }).click();
      await sheet(e).getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
      await sheet(e).getByRole("switch", { name: t("Your people first", "Спершу — твої люди"), exact: false }).click();
      await sheet(e).getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).click();
      await sheet(e).locator("[data-launch-opened]").waitFor({ timeout: 120_000 }).catch(dump(e));
      await shot(e, "early-set", sheet(e).locator("[data-launch-invite]"));
      if (errors.length) console.log(`${s.name} ${locale} early errors:`, errors.slice(0, 5));
      await context.close();
    }

    /* ---------------------------------------------------------------- the people */
    const windowOf = (page) => page.locator("[data-launch-entry]");
    const entry = async (moment, extra = "&early=open") => {
      const opened = await open(`&entry=${moment}${extra}`);
      await windowOf(opened.page).waitFor({ timeout: 240_000 }).catch(dump(opened.page));
      await opened.page.waitForFunction(() => !document.querySelector("[data-launch-entry=setting]"), null, { timeout: 60_000 }).catch(dump(opened.page));
      const connect = windowOf(opened.page).getByRole("button", { name: t("Connect wallet", "Підключити гаманець") });
      if (await connect.isVisible().catch(() => false)) await connect.click();
      await opened.page.waitForTimeout(1500);
      return opened;
    };
    for (const moment of ["soon", "join", "fill", "claim", "refund"]) {
      if (!want(`entry-${moment}`) && !(moment === "join" && (want("entry-details") || want("entry-in")))) continue;
      const { context, page, errors } = await entry(moment);
      if (want(`entry-${moment}`)) await shot(page, `entry-${moment}`, windowOf(page).locator("[data-launch-entry-act]").first());
      if (moment === "join" && want("entry-details")) {
        await windowOf(page).getByRole("button", { name: t("How it works", "Як це працює") }).click();
        await shot(page, "entry-details", windowOf(page).locator("dl"));
        await windowOf(page).getByRole("button", { name: t("How it works", "Як це працює") }).click();
      }
      if (moment === "join" && want("entry-in")) {
        await windowOf(page).locator("[data-launch-entry-act=DEPOSIT]").click();
        await windowOf(page).locator("[data-launch-entry-done]").waitFor({ timeout: 240_000 }).catch(dump(page));
        await shot(page, "entry-in", windowOf(page).locator("[data-launch-entry-done]"));
      }
      if (errors.length) console.log(`${s.name} ${locale} entry ${moment} errors:`, errors.slice(0, 5));
      await context.close();
    }
    if (want("entry-shut")) {
      const { context, page, errors } = await entry("join", "");
      await shot(page, "entry-shut", windowOf(page));
      if (errors.length) console.log(`${s.name} ${locale} entry shut errors:`, errors.slice(0, 5));
      await context.close();
    }
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
