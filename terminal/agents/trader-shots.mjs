// The AI trader's plan and the fee's one phrasing, for the eyes: at 1440×900, 1920×1080 and 390×844, in
// English and Ukrainian → <out>/*.jpg and <out>/report.txt.
//   node terminal/agents/trader-shots.mjs <out> [baseUrl] [quoteSource]
// A stand runs as people will get it: NEXT_PUBLIC_RYNTRA_TERMINAL=open with production's switches, next build && next
// start. Moments:
//   home    — the first screen: the four ready sentences;
//   trader  — «Trade JUP every day» tapped: the AI trader's plan on the Agents shelf, its edge, fee and two actions;
//   scout   — «Find new coins» tapped: the Scout, the agent that finds them;
//   swap    — the Swap's quote as the engine answers it (read from <quoteSource>, ryntra.io by default) and the same quote
//             with the engine's zero: «Ryntra fee …» and «No Ryntra fee», one phrasing.
// Nothing is signed: no wallet is in the page. /api/track is caught, never stored.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-382");
const base = process.argv[3] ?? "http://localhost:3282";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => (process.env.SIZES ?? "desk,wide,phone").split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const FEE_LINE = /Ryntra fee [^·\n]*|No Ryntra fee|Комісія Ryntra [^·\n]*|Без комісії Ryntra/u;
const report = [];

const settle = async (page) => {
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.jpg`), quality: 86, type: "jpeg" });
const text = async (page, selector) => ((await page.locator(selector).first().textContent({ timeout: 5_000 }).catch(() => null)) ?? "—").replace(/\s+/g, " ").trim();
const tap = (size, locator) => (size.mobile ? locator.tap() : locator.click());

for (const size of SIZES) {
  for (const lang of LANGS) {
    const tag = `${size.name}-${lang}`;
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.route("**/api/track", (route) => route.fulfill({ status: 204, body: "" }));
    // The engine's quote: the live one, or — `zero` — the same with the engine's «none» (a route without Ryntra's fee).
    const state = { zero: false, answered: 0 };
    await context.route("**/api/solana/swap/quote", async (route) => {
      const url = new URL(route.request().url());
      const answer = await fetch(`${source}${url.pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() }).catch(() => null);
      if (!answer) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      const body = await answer.text();
      if (!answer.ok || !state.zero) {
        state.answered += answer.ok ? 1 : 0;
        return route.fulfill({ status: answer.status, contentType: "application/json", body });
      }
      const json = JSON.parse(body);
      const order = json.order ?? json.data?.order;
      if (order?.ryntraFee) Object.assign(order.ryntraFee, { state: "NOT_APPLIED", basisPoints: 0, amountRaw: null });
      state.answered += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const home = async () => {
      await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("[data-terminal='hero']", { timeout: 180_000 });
      await settle(page);
    };

    // home
    await home();
    report.push(`${tag} home: sentences «${(await page.locator("[data-terminal='hero'] [data-say]").allTextContents()).join(" | ")}»`);
    await shot(page, `home-${tag}`);

    // trader — the ready sentence opens the AI trader's plan
    await tap(size, page.locator("[data-terminal='hero'] [data-say='tradeDaily']"));
    await page.waitForURL((url) => url.pathname !== "/", { timeout: 30_000 }).catch(() => {});
    await page.waitForSelector("[data-agent-terms]", { timeout: 60_000 }).catch(() => {});
    await settle(page);
    const url = new URL(page.url());
    report.push(
      `${tag} trader → ${url.pathname}${url.search}: tab «${await text(page, "[role='tab'][aria-selected='true']")}» · card «${await text(page, "[data-bot-form] h2")}» · edge «${await text(page, "[data-agent-terms]")}» · fee «${(await page.locator("[data-bot-form]").first().innerText().catch(() => "")).match(FEE_LINE)?.[0] ?? "—"}» · actions «${await text(page, "[data-agent-practice]")}» / «${await text(page, "[data-agent-connect]")}»`,
    );
    await page.locator("[data-agent-connect]").first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `trader-${tag}`);

    // scout — «Find new coins» opens the agent that finds them
    await home();
    await tap(size, page.locator("[data-terminal='hero'] [data-say='scout']"));
    await page.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }).catch(() => {});
    await settle(page);
    const scoutUrl = new URL(page.url());
    report.push(`${tag} scout → ${scoutUrl.pathname}${scoutUrl.search}: tab «${await text(page, "[role='tab'][aria-selected='true']")}»`);
    await shot(page, `scout-${tag}`);

    // swap — the engine's quote, then its zero: one phrasing
    for (const zero of [false, true]) {
      state.zero = zero;
      const before = state.answered;
      await page.goto(`${base}/swap?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await settle(page);
      for (let i = 0; i < 30 && state.answered === before; i += 1) await page.waitForTimeout(500);
      await page.waitForTimeout(1500);
      const line = (await page.locator("main").innerText().catch(() => "")).match(FEE_LINE)?.[0] ?? "—";
      report.push(`${tag} swap ${zero ? "zero" : "live"}: «${line}» (quotes answered ${state.answered - before})`);
      await shot(page, `swap-${zero ? "nofee" : "fee"}-${tag}`);
    }
    if (errors.length) report.push(`${tag}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
