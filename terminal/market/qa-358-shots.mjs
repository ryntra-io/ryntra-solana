// Логотипи стенд без мережі не дістає: кадри «Запуску» беруть
// одну нейтральну картинку для кожної монети (`LOGO`) — лише для розкладки; справжні логотипи — на живому сайті.
// Гаманець не підключено: нічого не підписується й не надсилається. `PRESS_CHROME` — свій Chrome, якщо треба.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listCoins } from "../../lib/market-depth/model.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-358-ac");
const base = process.argv[3] ?? "http://localhost:3358";
mkdirSync(out, { recursive: true });

const PULSE = JSON.parse(readFileSync(new URL("./fixtures/pulse-2026-11-17.json", import.meta.url), "utf8"));
const JUP = JSON.parse(readFileSync(new URL("../../lib/market-depth/fixtures/jupiter-2026-11-17.json", import.meta.url), "utf8"));
const SNAPSHOT = JSON.parse(readFileSync(new URL("../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
const ANSWERS = [JUP.toptrending1h, JUP.toptraded1h, JUP.toporganicscore1h, JUP.searchPrestocks, JUP.searchSpacex].filter(Array.isArray);
/* A neutral stand-in picture for a logo the closed network cannot bring: a plain disc, never a coin's own. */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="#3a3550"/><circle cx="32" cy="32" r="14" fill="#6d6690"/></svg>`;

/* The recorded Pulse, moved in time so its newest coin was born two minutes ago. */
const newest = Math.max(...PULSE.new.map((row) => Date.parse(row.firstPoolAt ?? "") || 0));
const shift = Date.now() - newest - 2 * 60_000;
const moved = (iso) => (iso ? new Date(Date.parse(iso) + shift).toISOString() : iso);
const aged = (row) => ({ ...row, firstPoolAt: moved(row.firstPoolAt), graduatedAt: moved(row.graduatedAt), ryntra: row.ryntra ? { ...row.ryntra, launchedAt: moved(row.ryntra.launchedAt) } : null });

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = [
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "w1440", width: 1440, height: 900, mobile: false },
  { name: "p390", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : ["market", "launch"];
const report = { base, at: new Date().toISOString(), shots: [] };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function routes(context, logos) {
  await context.route("**/api/spot/pulse?**", (route) => {
    const feed = new URL(route.request().url()).searchParams.get("feed");
    return json(route, { rows: (PULSE[feed] ?? []).map(aged) });
  });
  await context.route("**/api/v1/market/depth?**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    const list = q.get("list") ?? "trending";
    const kind = q.get("kind") ?? "all";
    const window = q.get("window") ?? "1h";
    // The recorded lists hold no «recent» answer: the fresh list is the Pulse's newest coins, as the depth list writes them.
    const coins =
      list === "saved"
        ? []
        : list === "fresh"
          ? PULSE.new.map(aged).map((row) => ({ id: row.mint, symbol: row.symbol, name: row.name, icon: row.icon, mcap: row.marketCapUsd, holders: row.holders, bornAt: row.firstPoolAt, mint: row.notices.includes("MINT_AUTHORITY") ? "on" : "off", freeze: row.notices.includes("FREEZE_AUTHORITY") ? "on" : "off" }))
          : listCoins(list, window, ANSWERS, new Set(), kind).slice(0, 50);
    return json(route, { list, kind, window, coins, readAt: new Date().toISOString() });
  });
  await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { ...SNAPSHOT, source: "live", fetchedAt: new Date().toISOString() }));
  await context.route("**/api/city/earn**", (route) => json(route, { lsts: [{ id: "jupsol", apyPct: 7.12 }, { id: "jitosol", apyPct: 6.94 }] }));
  if (logos) await context.route("**/api/spot/icon?**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: LOGO }));
}

const settle = async (page, ms = 2500) => {
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    // A development stand's own badge is not the page.
    await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal{display:none!important}" }))));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
    const tag = `${lang}-${size.name}`;
    const shot = async (name, facts = {}) => {
      await page.mouse.move(2, 2);
      await page.waitForTimeout(400);
      const file = path.join(out, `${name}-${tag}.jpg`);
      await page.screenshot({ path: file, quality: 82, type: "jpeg" });
      report.shots.push({ file: path.basename(file), ...facts, side: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });
    };

    if (ONLY.includes("market")) {
      await routes(context, false);
      await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForSelector("[data-terminal='tiles'] [data-tile]", { timeout: 180_000 }).catch(() => {});
      await settle(page, 3500);
      const tiles = await page.evaluate(() =>
        [...document.querySelectorAll("[data-terminal='tiles'] [data-tile]")].map((tile) => {
          const box = tile.getBoundingClientRect();
          return { id: tile.getAttribute("data-tile"), h: Math.round(box.height), arrow: Boolean(tile.querySelector("svg") && tile.querySelectorAll("svg").length), text: tile.textContent };
        }),
      );
      await shot("home", { tiles });
      // The table's rows 9–12: the «#» beside the logo.
      const depth = page.locator("[data-terminal='depth']");
      if (await depth.count()) {
        await page.waitForSelector("[data-terminal='depth'] [role='row'] a[href^='/coin/'], [data-terminal='depth'] [role='listitem']", { timeout: 90_000 }).catch(() => {});
        const rows = page.locator("[data-terminal='depth'] [role='row']");
        const tenth = rows.nth(9);
        if (await tenth.count()) {
          await tenth.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 360));
          await page.waitForTimeout(600);
          // The gap between a row's number and its coin's logo, px.
          const gaps = await page.evaluate(() =>
            [...document.querySelectorAll("[data-terminal='depth'] [role='row']")]
              .slice(1, 13)
              .map((row) => {
                const cells = row.querySelectorAll("[role='cell']");
                const num = cells[0]?.querySelector("span");
                const logo = cells[1]?.querySelector("img, span");
                return num && logo ? Math.round(logo.getBoundingClientRect().left - num.getBoundingClientRect().right) : null;
              }),
          );
          await shot("home-table", { numberToLogo: gaps });
        }
      }
      if (size.mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        const says = page.locator("[data-terminal='hero'] [data-say]").first();
        if (await says.count()) {
          await says.evaluate((el) => el.parentElement?.scrollTo({ left: 10_000 }));
          await page.waitForTimeout(500);
          await shot("home-says-end");
        }
      }
    }

    if (ONLY.includes("launch")) {
      await routes(context, true);
      for (const tab of ["new", "fresh"]) {
        await page.goto(`${base}/launch?lang=${lang}${tab === "new" ? "" : `&tab=${tab}`}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
        await page.waitForSelector("[data-launch-screen]", { timeout: 180_000 }).catch(() => {});
        await settle(page, 5000);
        const facts = await page.evaluate(() => {
          // The coins a person sees on this tab, the lines cut short in them, and the widths of the cards.
          const cards = [...document.querySelectorAll("[data-launch-screen] a[href^='/coin/']")].filter((card) => card.offsetParent !== null);
          const cut = cards.flatMap((card) => [...card.querySelectorAll("span")].filter((line) => line.scrollWidth > line.clientWidth + 1).map((line) => line.textContent));
          const widths = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().width)))];
          return { coins: cards.map((card) => card.textContent?.slice(0, 40)), cut, widths };
        });
        await shot(`launch-${tab}`, facts);
        if (tab === "new") {
          // The empty form: the samples in the fields beside a typed value.
          await page.locator("[data-launch-name]").fill("Moth").catch(() => {});
          await page.waitForTimeout(300);
          await page.locator("[data-launch-name]").evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
          await shot("launch-typed");
        }
      }
    }
    if (errors.length) report.shots.push({ tag, errors });
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.shots.map((s) => ({ ...s, coins: s.coins?.length })), null, 1).slice(0, 6000));
