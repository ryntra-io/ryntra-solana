// For the eyes (QA 19.11): the chart through a refused chart source, the Market, the bots' catalogue and the
// Grid on MET, JUP and NVDAx — at 1920×1080 and 390×844, English and Ukrainian → <out>/*.jpg, with what each screen said.
//   node terminal/coin/qa-1119-shots.mjs <out> [baseUrl] [source]          SIZES=w1920,phone  LANGS=uk,en  ONLY=coin,market,bots,grid
// Every answer is the engine's, read from `source` (ryntra.io) as the browser would; for the chart's refusal the
// candles answer 429 with `Retry-After: 6` for the first twelve seconds, then pass through. Nothing is signed or sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-284b");
const base = process.argv[3] ?? "http://localhost:3143";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : ["coin", "market", "bots", "grid"];
const report = [];

async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  /* Reads only: a POST passes only for the limit ticket's market price, a read; anything else is answered empty. */
  const read = request.method() === "GET" || (request.method() === "POST" && url.pathname === "/api/solana/limits/market");
  if (!read) return route.fulfill({ status: 204, body: "" });
  try {
    const post = request.method() === "POST" ? { method: "POST", body: request.postData() ?? "{}" } : {};
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { ...post, headers: { accept: request.headers().accept ?? "*/*", ...(post.method ? { "content-type": "application/json" } : {}), origin: source, referer: `${source}/` } });
    const headers = { "content-type": answer.headers.get("content-type") ?? "application/json" };
    const retry = answer.headers.get("retry-after");
    if (retry) headers["retry-after"] = retry;
    return route.fulfill({ status: answer.status, headers, body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

const settle = async (page) => {
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    let refuseUntil = 0;
    await context.route("**/api/**", (route) => {
      const url = route.request().url();
      if (url.includes("/api/spot/candles") && Date.now() < refuseUntil) {
        return route.fulfill({ status: 429, headers: { "content-type": "application/json", "retry-after": "6" }, body: JSON.stringify({ error: { code: "CANDLES_RATE_LIMITED", message: "GeckoTerminal rate-limited the chart read." } }) });
      }
      return fromSource(route);
    });
    const page = await context.newPage();
    const tag = `${size.name}-${lang}`;
    page.on("pageerror", (error) => report.push(`pageerror-${tag}: ${String(error.message).slice(0, 300)}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource/.test(message.text())) report.push(`console-${tag}: ${message.text().slice(0, 300)}`);
    });
    const shot = async (name, full = false) => {
      await page.screenshot({ path: path.join(out, `${name}-${tag}.jpg`), type: "jpeg", quality: 82, fullPage: full });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      report.push(`${name}-${tag}: sideways ${overflow} px`);
    };
    const open = async (url, frame) => {
      if (frame) await page.addInitScript((tf) => window.localStorage.setItem("ryntra.city.chart.timeframe.v1", tf), frame);
      await page.goto(`${base}${url}${url.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await settle(page);
    };

    if (ONLY.includes("coin")) {
      /* The chart source refuses for twelve seconds: the frame says «Chart in a moment», then the bars come by themselves. */
      refuseUntil = Date.now() + 60_000;
      await open(`/coin/${MET}`, "1d");
      await page.waitForSelector("[data-coin-chart-wait][data-soon]", { timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
      await shot("coin-met-1d-refused");
      report.push(`coin-met-1d-refused-${tag}: «${(await page.locator("[data-coin-chart-wait]").first().textContent({ timeout: 1_000 }).catch(() => "")) ?? ""}»`);
      refuseUntil = Date.now();
      await page.waitForSelector(".ryntra-chart canvas", { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(8_000);
      await shot("coin-met-1d-back");
      for (const [name, mint, frame] of [["coin-jup-1d", JUP, "1d"], ["coin-bonk-15m", BONK, "15m"]]) {
        await open(`/coin/${mint}`, frame);
        await page.waitForSelector(".ryntra-chart canvas", { timeout: 120_000 }).catch(() => {});
        await page.waitForTimeout(6_000);
        await shot(name);
      }
      if (!size.mobile) {
        /* The ticket's «Limit»: BONK's market price in SOL, its zeros counted as the chart counts them. */
        const limit = page.getByRole("tab", { name: lang === "uk" ? "Ліміт" : "Limit" }).first();
        if (await limit.count()) {
          await limit.click();
          await page.waitForTimeout(2_500);
          await shot("coin-bonk-limit");
          report.push(`coin-bonk-limit-${tag}: «${(await page.locator("aside, [data-ticket]").first().innerText({ timeout: 1_000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 400)}»`);
        }
      }
    }

    if (ONLY.includes("market")) {
      await open("/");
      await page.waitForSelector("[data-terminal='depth'] [role=row], [data-terminal='depth'] [role=listitem]", { timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(9_000);
      await shot("market");
      await shot("market-full", true);
      const tabs = await page.locator("[data-terminal='depth'] [role=tab]").allInnerTexts().catch(() => []);
      report.push(`market-${tag}: tabs ${tabs.map((t) => t.replace(/\s+/g, " ").trim()).join(" | ")}`);
    }

    if (ONLY.includes("bots") && !size.mobile) {
      await open("/bots");
      await page.waitForSelector("[data-bots-catalog]", { timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(2_500);
      await shot("bots");
    }

    if (ONLY.includes("grid")) {
      await open("/bots/grid", "1h");
      await page.waitForSelector("[data-grid-chart] .ryntra-chart canvas", { timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(6_000);
      await shot("grid-met");
      report.push(`grid-met-${tag}: ${await page.locator("[data-bots] input").evaluateAll((els) => els.map((el) => el.value).join(" · ")).catch(() => "")}`);
      for (const [name, query, symbol] of [["grid-jup", "JUP", "JUP"], ["grid-nvdax", "NVDAx", "NVDAx"]]) {
        const pick = page.getByRole("button", { name: lang === "uk" ? "Обери монету" : "Choose the coin" }).first();
        if (!(await pick.count())) continue;
        await pick.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
        await (size.mobile ? pick.tap() : pick.click());
        await page.waitForTimeout(2_000);
        const search = page.locator("[role=dialog] input").first();
        if (await search.count()) await search.fill(query);
        await page.waitForTimeout(3_000);
        const row = page.locator(`[data-bot-coin='${symbol}']`).first();
        if (!(await row.count())) {
          report.push(`${name}-${tag}: no row for ${symbol}`);
          await page.keyboard.press("Escape").catch(() => {});
          continue;
        }
        await (size.mobile ? row.tap() : row.click());
        await page.waitForTimeout(9_000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(name);
        if (size.mobile) {
          await page.locator("[data-grid-place], [data-grid-connect], [data-grid-other]").first().evaluate((el) => el.scrollIntoView({ block: "end" })).catch(() => {});
          await page.waitForTimeout(600);
          await shot(`${name}-form`);
        }
        const said = await page.locator("[data-bots] form, [data-bots] section, [data-bots]").first().innerText({ timeout: 1_000 }).catch(() => "");
        report.push(`${name}-${tag}: ${said.replace(/\s+/g, " ").slice(0, 600)}`);
      }
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
