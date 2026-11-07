// The launch's two doors (CITY-212) for review: «Share earnings» — the quiet row, the split being typed, a mistake said
// at once, the split shown before the signature, «i», the wallet's prompt for two transactions; «Your people first» —
// the switch on with its amounts and its two moments, the wallet's prompt for three, and the launch set — at 1440×860
// and 375×812 → <out>/doors-<state>-<size>-<locale>.jpg
//   node city/lib/launch/doors-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Everything runs on the development stand-in (`?launch=stub`, early access only with `&early=open`): devnet-shaped
// answers, a stub wallet, nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-212");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "uk,en").split(",");
const PACE = process.env.PACE ?? 2;
/* Two wallets to share with — any Solana addresses; the stand sends nothing. */
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
    const shot = async (page, state, target = null) => {
      /* The sheet scrolls on a phone: what the state is about is brought into view first. */
      if (target) await target.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.screenshot({ path: path.join(out, `doors-${state}-${s.name}-${locale}.jpg`), quality: 86, timeout: 120_000, animations: "disabled" });
    };
    const dump = (page) => async (error) => {
      console.log(await page.locator("body").innerText().catch(() => ""));
      throw error;
    };
    /* The fields, the review, the wallet: the review as the creator sees it before the doors. */
    const toReview = async (page) => {
      await sheet(page).getByLabel(t("Name", "Назва")).fill("Kite");
      await sheet(page).getByLabel(t("Ticker", "Тікер")).fill("kite");
      /* A finger gets the gallery door; a mouse the one file picker. */
      await page.locator(s.mobile ? "[data-launch-gallery]" : "[data-launch-preview] input[type=file]").first().setInputFiles(file);
      await page.waitForFunction(() => window.__launch.getState().stored?.answer?.ok === true, null, { timeout: 60_000 }).catch(dump(page));
      await sheet(page).getByRole("button", { name: t("Review $KITE", "Огляд $KITE") }).click();
      await page.locator("[data-launch-line]").waitFor({ timeout: 30_000 });
      await sheet(page).getByRole("button", { name: t("Connect wallet", "Підключити гаманець") }).click();
      await sheet(page).getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(900);
    };

    // «Share earnings»: one quiet row in the review — only you, until opened.
    const shared = await open();
    const p = shared.page;
    await toReview(p);
    const door = sheet(p).locator("[data-launch-share]");
    await shot(p, "share-row", door);

    // Opened: the bar, a wallet and its part; a second wallet added; the creator keeps the rest.
    await door.click();
    const addresses = sheet(p).getByLabel(t("Wallet address", "Адреса гаманця"));
    await addresses.nth(0).fill(FRIENDS[0]);
    await sheet(p).getByRole("button", { name: t("Add a wallet", "Додати гаманець") }).click();
    await addresses.nth(1).fill(FRIENDS[1]);
    await sheet(p).getByLabel(t("Share", "Частка")).nth(0).fill("20");
    await sheet(p).getByLabel(t("Share", "Частка")).nth(1).fill("10");
    await p.waitForTimeout(700);
    await shot(p, "share-edit", sheet(p).locator("[data-launch-share]"));

    // A mistake is said at once: the creator's own wallet among the others.
    const creator = await p.evaluate(() => window.__launch.getState().connection.address);
    await addresses.nth(1).fill(creator);
    await sheet(p).locator("[data-launch-share-problem]").waitFor({ timeout: 10_000 }).catch(dump(p));
    await p.waitForTimeout(500);
    await shot(p, "share-problem", sheet(p).locator("[data-launch-share-problem]"));
    await addresses.nth(1).fill(FRIENDS[1]);

    // Done: who gets what, before the signature — the bar and each wallet's part; the cost line counts the sharing.
    await sheet(p).getByRole("button", { name: t("Done", "Готово") }).click();
    await sheet(p).locator("[data-launch-shares]").waitFor({ timeout: 10_000 });
    await p.waitForFunction(() => window.__launch.getState().costLamports === "13064320", null, { timeout: 60_000 }).catch(dump(p));
    await p.waitForTimeout(700);
    await shot(p, "share-review", sheet(p).locator("[data-launch-shares]"));

    // «i»: the split is fixed for ever, each wallet claims its own part.
    await sheet(p).getByRole("button", { name: t("Details", "Деталі") }).click();
    await p.waitForTimeout(600);
    await shot(p, "share-details", sheet(p).getByText(t("Each wallet claims its own part.", "Кожен гаманець забирає свою частку сам.")));
    await sheet(p).getByRole("button", { name: t("Hide", "Сховати") }).click();

    // The press: two transactions in one prompt — the coin and its earnings split.
    await sheet(p).getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).click();
    await sheet(p).getByText(t("Two transactions", "Дві транзакції"), { exact: false }).waitFor({ timeout: 60_000 }).catch(dump(p));
    await p.waitForTimeout(500);
    await shot(p, "share-sign", sheet(p).locator("[role=status]").first());
    await p.waitForFunction(() => window.__launch.getState().mine.length > 0, null, { timeout: 120_000 }).catch(dump(p));
    const crew = await p.evaluate(() => window.__launch.getState().mine[0].crew);
    if (crew !== 2) throw new Error(`the tower's crew is ${crew}, not 2`);
    if (shared.errors.length) console.log(`${s.name} ${locale} share page errors:`, shared.errors.slice(0, 5));
    await shared.context.close();

    // «Your people first» (the stand opens it only when asked): the switch on, the amounts, the two moments.
    const early = await open("&early=open");
    const e = early.page;
    await toReview(e);
    const switcher = sheet(e).getByRole("switch", { name: t("Your people first", "Спершу — твої люди"), exact: false });
    await shot(e, "early-row", switcher);
    await switcher.click();
    await sheet(e).locator("[data-launch-early=on]").waitFor({ timeout: 10_000 });
    await e.waitForTimeout(700);
    await shot(e, "early-on", sheet(e).locator("[data-launch-early]"));
    await sheet(e).getByRole("button", { name: t("Details", "Деталі") }).click();
    await e.waitForTimeout(600);
    await shot(e, "early-details", sheet(e).getByText(t("Ryntra takes nothing", "Ryntra на цьому"), { exact: false }));
    await sheet(e).getByRole("button", { name: t("Hide", "Сховати") }).click();
    await sheet(e).getByRole("button", { name: t("Launch $KITE", "Запустити $KITE") }).click();
    await sheet(e).getByText(t("Three transactions", "Три транзакції"), { exact: false }).waitFor({ timeout: 60_000 }).catch(dump(e));
    await e.waitForTimeout(500);
    await shot(e, "early-sign", sheet(e).locator("[role=status]").first());
    await sheet(e).locator("[data-launch-opened]").waitFor({ timeout: 120_000 }).catch(dump(e));
    await e.waitForTimeout(700);
    await shot(e, "early-set", sheet(e).locator("[data-launch-opened]"));
    if (early.errors.length) console.log(`${s.name} ${locale} early page errors:`, early.errors.slice(0, 5));
    await early.context.close();
    console.log(`${s.name} ${locale} done`);
  }
}
await browser.close();
