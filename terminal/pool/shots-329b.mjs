// The pair's pools picker in groups (MET/SOL,
// SOL/USDC), SOL/USDC's head with both logos, a thin and an empty pool's column, Earn's filters bar (1440 too), and the
// Bots' head on «All bots», a form and the Grid — the head's left edge is written to the report for each.
//   node terminal/pool/shots-329b.mjs [out] [baseUrl] [source]
// `baseUrl` a stand (`next dev` or `next start`), every `/api/**` read asked from `source` (ryntra.io by default) with
// the site's own origin; or `baseUrl` = the source itself for the «before» set (nothing routed). Reads only; the wallet
// is never connected; nothing is sent. SIZES=desk2560,desk1920,desk1440,phone, LANGS=uk,en and PAGES=earn,pro,pools,bots
// narrow the run.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-329b/after");
const base = process.argv[3] ?? "http://localhost:3138";
const source = process.argv[4] ?? "https://ryntra.io";
const live = base === source;
mkdirSync(out, { recursive: true });

const MET_POOL = "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d";
const SOL_USDC = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const THIN_POOL = "CnrAd1XSkS1NpyF4PDuumQx4ZvRv5ofZnEcjwMExceaL";
const EXE = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: EXE, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk2560", width: 2560, height: 1440, mobile: false },
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "desk1440", width: 1440, height: 900, mobile: false, only: ["earn"] },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const PAGES = (process.env.PAGES ?? "earn,pro,pools,bots").split(",");
const report = [];

const ask = (url, init = {}) => fetch(`${source}${url}`, { ...init, headers: { "content-type": "application/json", accept: "application/json", origin: source, referer: `${source}/`, ...(init.headers ?? {}) } });

/** A read asked from the source with the site's own origin; a source that does not answer is a 503. */
const fromSource = async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const readPost = request.method() === "POST" && (url.pathname === "/api/solana/swap/quote" || url.pathname === "/api/v1/ladders/quote");
  if (request.method() !== "GET" && !readPost) return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await ask(`${url.pathname}${url.search}`, { method: request.method(), headers: { accept: request.headers().accept ?? "*/*" }, body: readPost ? request.postData() : undefined });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body, headers: { "cache-control": "no-store" } });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    if (!live) await context.route("**/api/**", fromSource);
    await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
    const shot = async (state) => {
      await page.waitForTimeout(800);
      const file = path.join(out, `${state}-${size.name}-${lang}.jpg`);
      await page.screenshot({ path: file, quality: 86, type: "jpeg" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      report.push(`${state}-${size.name}-${lang}: overflow-x ${overflow} px`);
    };
    const open = async (where, wait = 10_000) => {
      await page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(wait);
    };
    const headAt = async (state) => {
      const at = await page.evaluate(() => {
        const head = document.querySelector("[data-page-head] h1");
        const tabs = document.querySelector("[data-page-head] [role='tablist']");
        return head ? `${Math.round(head.getBoundingClientRect().left)} / tabs ${Math.round(tabs?.getBoundingClientRect().left ?? -1)}` : "none";
      });
      report.push(`${state}-${size.name}-${lang}: head x ${at}`);
    };
    const picker = async (state) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const pick = page.locator("[data-pool-head] button[aria-haspopup='dialog']");
      if (!(await pick.count())) return report.push(`${state}-${size.name}-${lang}: no picker`);
      await pick.click();
      await page.waitForTimeout(1_200);
      await shot(state);
      await page.keyboard.press("Escape");
      await page.mouse.click(5, size.height - 5);
    };

    const wants = (name) => PAGES.includes(name) && (!size.only || size.only.includes(name));
    if (wants("earn")) {
      await open("/earn", 12_000);
      await shot("earn");
    }
    if (wants("pro")) {
      await open("/pro", 12_000);
      await shot("pro");
    }
    if (wants("pools")) {
      await open(`/pool/${MET_POOL}`, 14_000);
      await picker("met-pairs");
      await open(`/pool/${SOL_USDC}`, 14_000);
      await shot("solusdc-head");
      await picker("solusdc-pairs");
      await open(`/pool/${THIN_POOL}`, 14_000);
      await shot("thin-pool");
    }
    if (wants("bots")) {
      for (const [state, where] of [
        ["bots", "/bots"],
        ["bots-recurring", "/bots/recurring"],
        ["bots-grid", "/bots/grid"],
      ]) {
        await open(where, 10_000);
        await headAt(state);
        await shot(state);
      }
    }
    if (errors.length) report.push(`${size.name}-${lang} errors: ${errors.join(" | ")}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
