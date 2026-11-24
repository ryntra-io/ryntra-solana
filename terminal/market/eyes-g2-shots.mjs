// «Ринок» (головна) для очей після вад G2 другого проходу 20.11: «Пульс», таблиця «Market», поле агента на 1920 —
// на записаних відповідях і зі збоєм джерела → <out>/*.jpg і <out>/report.json.
//   node terminal/market/eyes-g2-shots.mjs <out> [baseUrl]      SIZES=w1920,w1440,p390  LANGS=en,uk  MODES=live,down,quiet
// live  — записаний «Пульс» 17.11 і списки Jupiter 17.11 через `listCoins` двигуна (як `qa-358-shots.mjs`);
// down  — джерело не відповідає: «Пульс» і списки ринку обриваються (як `err-*` проходу 20.11);
// quiet — джерело відповідає, але ринок порожній: три стрічки й списки без монет;
// lost  — джерело відповіло, а за хвилину замовкло: картки лишаються, «наживо» гасне, поруч «Ще раз».
// Логотипи стенд без мережі не дістає: кожна монета бере одну нейтральну картинку (`LOGO`) — лише для розкладки.
// Гаманець не підключено: нічого не підписується й не надсилається. `PRESS_CHROME` — свій Chrome, якщо треба.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listCoins } from "../../lib/market-depth/model.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/eyes-g2");
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
const MODES = (process.env.MODES ?? "live,down,quiet").split(",");
const report = { base, at: new Date().toISOString(), shots: [] };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/* «lost»: the source answers until the page has drawn, then stops answering. */
const state = { lost: false };

async function routes(context, mode) {
  await context.route("**/api/spot/pulse?**", (route) => {
    if (mode === "down" || state.lost) return route.abort("failed");
    const feed = new URL(route.request().url()).searchParams.get("feed");
    return json(route, { rows: mode === "quiet" ? [] : (PULSE[feed] ?? []).map(aged) });
  });
  await context.route("**/api/v1/market/depth?**", (route) => {
    if (mode === "down" || state.lost) return route.abort("failed");
    const q = new URL(route.request().url()).searchParams;
    const list = q.get("list") ?? "trending";
    const kind = q.get("kind") ?? "all";
    const window = q.get("window") ?? "1h";
    const coins = mode === "quiet" || list === "saved" ? [] : listCoins(list, window, ANSWERS, new Set(), kind).slice(0, 50);
    return json(route, { list, kind, window, coins, readAt: new Date().toISOString() });
  });
  await context.route(/\/api\/city(\?.*)?$/, (route) => (mode === "down" ? route.abort("failed") : json(route, { ...SNAPSHOT, source: "live", fetchedAt: new Date().toISOString() })));
  await context.route("**/api/city/earn**", (route) => (mode === "down" ? route.abort("failed") : json(route, { lsts: [{ id: "jupsol", apyPct: 7.12 }, { id: "jitosol", apyPct: 6.94 }] })));
  await context.route("**/api/spot/icon?**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: LOGO }));
}

const settle = async (page, ms = 2500) => {
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

for (const mode of MODES) {
  for (const size of SIZES) {
    for (const lang of LANGS) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
      // A development stand's own badge is not the page.
      await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal{display:none!important}" }))));
      state.lost = false;
      await routes(context, mode);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
      const tag = `${mode}-${lang}-${size.name}`;
      const shot = async (name, facts = {}) => {
        await page.mouse.move(2, 2);
        await page.waitForTimeout(400);
        const file = path.join(out, `${name}-${tag}.jpg`);
        await page.screenshot({ path: file, quality: 82, type: "jpeg" });
        report.shots.push({ file: path.basename(file), ...facts, side: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });
      };
      await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForSelector("[data-terminal='pulse']", { timeout: 180_000 }).catch(() => {});
      await settle(page, mode === "live" ? 4000 : 3000);
      if (mode === "lost") {
        // The next read of the Pulse comes 15 s later and does not answer.
        state.lost = true;
        await page.waitForTimeout(17_000);
      }
      const hero = await page.evaluate(() => {
        const form = document.querySelector("[data-terminal='hero'] form");
        const input = form?.querySelector("input")?.getBoundingClientRect();
        const say = form?.querySelector("button[type='submit']")?.getBoundingClientRect();
        return input && say ? { field: Math.round(input.width), sayLeft: Math.round(say.left), fieldLeft: Math.round(input.left) } : null;
      });
      await shot("home", { hero });
      const pulse = page.locator("[data-terminal='pulse']");
      await pulse.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
      await page.waitForTimeout(600);
      const facts = await page.evaluate(() => {
        const head = document.querySelector("[data-terminal='pulse'] [data-pulse-live]");
        const cols = [...document.querySelectorAll("[data-terminal='pulse'] section")].map((col) => {
          const box = col.getBoundingClientRect();
          const first = col.querySelector("[data-card]")?.getBoundingClientRect();
          const body = col.querySelector("[data-pulse-body]");
          return { name: col.getAttribute("aria-label"), cards: col.querySelectorAll("[data-card]").length, firstCardFromTop: first ? Math.round(first.top - box.top) : null, more: body?.hasAttribute("data-more") ?? null, text: col.querySelector("[role='status']")?.textContent ?? null };
        });
        const risks = [...document.querySelectorAll("[data-terminal='pulse'] [data-card]")].slice(0, 12).map((card) => card.lastElementChild?.previousElementSibling?.textContent ?? "");
        return { live: head?.getAttribute("data-pulse-live") ?? null, liveText: head?.textContent ?? null, cols, risks };
      });
      await shot("pulse", facts);
      const depth = page.locator("[data-terminal='depth']");
      await depth.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
      await page.waitForTimeout(600);
      const table = await page.evaluate(() => ({ text: document.querySelector("[data-terminal='depth'] [role='status']")?.textContent ?? null, rows: document.querySelectorAll("[data-terminal='depth'] [role='row'], [data-terminal='depth'] [role='listitem']").length }));
      await shot("market", table);
      if (size.mobile) {
        // The row of kinds scrolled to its end: «Saved» whole, the fade gone.
        const tabs = page.locator("[data-terminal='depth'] [role='tablist']").first();
        if (await tabs.count()) {
          await tabs.evaluate((el) => el.scrollTo({ left: 10_000 }));
          await page.waitForTimeout(500);
          await shot("market-tabs-end");
        }
      }
      if (mode === "down") {
        // «Try again» reads again: the source still down, the same honest state.
        const again = page.locator("[data-terminal='pulse'] button[data-again]").first();
        if (await again.count()) {
          await again.click();
          await page.waitForTimeout(1200);
          report.shots.push({ tag, againStill: await page.locator("[data-terminal='pulse'] button[data-again]").count() });
        }
      }
      if (errors.length) report.shots.push({ tag, errors });
      await context.close();
    }
  }
}

await browser.close();
writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.shots, null, 1).slice(0, 8000));
