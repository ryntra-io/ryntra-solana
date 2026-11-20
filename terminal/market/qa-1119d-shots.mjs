// «Ринок», шапка монети, «Обмін» і «Міст» для очей (перевірка якості 19.11, день) → <out>/*.jpg і <out>/report.json:
// шапка й графік монети (MET, BONK, SOL, USDT), список «Ринку» і його вкладки, пошук і вибір у «Обміні», монети Base у
// «Мості», «Події» й Ctrl+K — на 2560, 1920, 1440 і 390, EN і UK.
//   node terminal/market/qa-1119d-shots.mjs <out> [baseUrl] [source]      SIZES=w2560,w1920,w1440,p390  LANGS=uk,en
// `baseUrl` — живий ryntra.io («до») або стенд `next start` («після»); на стенді кожне читання `/api/**` іде на `source`
// (ryntra.io) із його заголовками, крім логотипів «Мосту», які віддає сам стенд. Нічого не підписується й не надсилається.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-337/after");
const base = process.argv[3] ?? "http://localhost:3137";
const source = process.argv[4] ?? "https://ryntra.io";
const viaSource = !base.startsWith(source);
mkdirSync(out, { recursive: true });

const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const SOL = "So11111111111111111111111111111111111111112";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "w2560", width: 2560, height: 1440, mobile: false },
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "w1440", width: 1440, height: 900, mobile: false },
  { name: "p390", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : ["coin", "market", "swap", "bridge", "shell"];
const report = { base, source, at: new Date().toISOString(), shots: [] };

async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  const read = request.method() === "GET";
  if (!read) return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: request.headers().accept ?? "*/*", origin: source, referer: `${source}/` } });
    const headers = { "content-type": answer.headers.get("content-type") ?? "application/json" };
    return route.fulfill({ status: answer.status, headers, body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

const settle = async (page, ms = 2500) => {
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: uk ? "uk-UA" : "en-US" });
    if (viaSource) await context.route("**/api/**", (route) => (route.request().url().includes("/api/swap/bridge/icon") ? route.fallback() : fromSource(route)));
    const page = await context.newPage();
    const tag = `${lang}-${size.name}`;
    const shot = async (name, options = {}) => {
      const file = `${tag}-${name}.jpg`;
      await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, ...options });
      report.shots.push({ file, url: page.url() });
    };
    const go = async (where, ms) => {
      await page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await settle(page, ms);
    };
    const step = async (name, run) => {
      try {
        await run();
      } catch (error) {
        report.shots.push({ file: `${tag}-${name}`, error: String(error).slice(0, 300) });
      }
    };

    if (ONLY.includes("coin")) {
      for (const [name, mint] of [["met", MET], ["bonk", BONK], ["sol", SOL], ["usdt", USDT]]) {
        if (name === "usdt" && size.name !== "w1440") continue;
        await step(`coin-${name}`, async () => {
          await go(`/coin/${mint}`, 9000);
          if (size.mobile) await shot(`coin-${name}`, { fullPage: false });
          else await shot(`coin-${name}`, { clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 760) } });
          if (name === "met" && !size.mobile) {
            const info = page.locator('button[aria-expanded]').filter({ has: page.locator("svg") }).nth(0);
            const about = page.getByRole("button", { name: uk ? "Адреса й посилання" : "Address and links" }).first();
            await (await about.count() ? about : info).click();
            await page.waitForTimeout(600);
            await shot(`coin-${name}-about`, { clip: { x: 0, y: 0, width: size.width, height: 420 } });
          }
        });
      }
    }

    if (ONLY.includes("market")) {
      await step("market", async () => {
        await go("/", 7000);
        await page.evaluate(() => document.getElementById("market-title")?.closest("section")?.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(1200);
        await shot("market");
        if (!size.mobile) {
          await page.getByRole("radio", { name: uk ? "Ростуть" : "Rising" }).first().click().catch(() => page.getByText(uk ? "Ростуть" : "Rising", { exact: true }).first().click());
          await page.waitForTimeout(2500);
          await shot("market-rising");
        }
      });
    }

    if (ONLY.includes("swap")) {
      await step("swap", async () => {
        await go("/swap", 5000);
        await page.getByRole("button", { name: new RegExp(`^${uk ? "Обрати, чим платиш" : "Pick the coin you pay"}`) }).click();
        await page.waitForTimeout(500);
        await page.getByRole("searchbox").first().fill("bonk");
        await page.waitForTimeout(4000);
        await shot("swap-find-bonk");
        await page.getByRole("menuitemradio").filter({ hasText: /^Bonk/ }).first().click();
        await page.waitForTimeout(1500);
        const field = page.locator("input[inputmode='decimal']").first();
        await field.fill("1000000");
        await page.waitForTimeout(3000);
        await shot("swap-bonk-typed");
        await page.getByRole("button", { name: new RegExp(`^${uk ? "Обрати, що отримаєш" : "Pick the coin you get"}`) }).click();
        await page.waitForTimeout(500);
        await page.getByRole("searchbox").first().fill("jup");
        await page.waitForTimeout(3500);
        await page.getByRole("menuitemradio").filter({ hasText: /^JUP/ }).first().click();
        await page.waitForTimeout(4000);
        await shot("swap-bonk-to-jup");
        report.shots.push({ file: `${tag}-swap-bonk-to-jup:amount`, value: await field.inputValue().catch(() => null) });
      });
      await step("swap-link", async () => {
        const started = Date.now();
        await page.goto(`${base}/swap?from=SOL&to=BONK&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        const priced = await page.waitForFunction(() => /1\s+\S+\s+=\s+\S/.test(document.body.innerText), null, { timeout: 20_000 }).then(() => Date.now() - started).catch(() => null);
        await settle(page, 1500);
        report.shots.push({ file: `${tag}-swap-link:pricedMs`, value: priced });
        await shot("swap-link-sol-bonk");
      });
    }

    if (ONLY.includes("bridge") && !size.mobile) {
      await step("bridge", async () => {
        await go("/bridge", 6000);
        await page.locator("[data-bridge-coin='from']").first().click();
        await page.waitForTimeout(800);
        await page.locator("[data-bridge-net='base']").first().click();
        await page.waitForTimeout(6000);
        await shot("bridge-base");
      });
    }

    if (ONLY.includes("shell")) {
      await step("bell", async () => {
        await go("/swap", 9000);
        await page.locator("[data-terminal='bell']").first().click();
        await page.waitForTimeout(2500);
        await shot("bell");
        await page.keyboard.press("Escape");
      });
      if (!size.mobile) {
        await step("ctrlk", async () => {
          await page.keyboard.press("Control+KeyK");
          await page.waitForTimeout(400);
          await page.keyboard.type("bonk", { delay: 40 });
          await page.waitForTimeout(1500);
          await shot("ctrlk-bonk", { clip: { x: 0, y: 0, width: Math.min(size.width, 1100), height: 360 } });
        });
      }
    }
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 1));
await browser.close();
console.log(`${report.shots.length} entries → ${out}`);
