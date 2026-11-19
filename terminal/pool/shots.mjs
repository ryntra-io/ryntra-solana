// Meteora DLMM Pro's pools for the eyes → <out>/*.jpg: the list (/pro), a pool's own desk (/pool/<address>)
// with and without a ladder drawn, the Earn card and the Spot's way to the pool.
//   node terminal/pool/shots.mjs [out] [baseUrl] [source]
// A stand: `next build`, then `next start` with the production flags and an RPC that serves the program's accounts
// (`RYNTRA_SOLANA_RPC_MAINNET`): `/api/pro/**` is the stand's own — ryntra.io does not have it yet — and every other read
// is asked from `source` (ryntra.io by default) with the site's own origin, as a browser on it asks. Reads only; the
// wallet is never connected; nothing is sent. SIZES=desk2560,desk1920,phone and LANGS=uk,en narrow the run.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-324");
const base = process.argv[3] ?? "http://localhost:3131";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const MET_POOL = "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const EXE = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: EXE, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk2560", width: 2560, height: 1440, mobile: false },
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const report = [];

/** A read asked from the source with the site's own origin; a source that does not answer is a 503. */
async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname.startsWith("/api/pro/")) return route.continue();
  const readPost = request.method() === "POST" && (url.pathname === "/api/solana/swap/quote" || url.pathname === "/api/v1/ladders/quote");
  if (request.method() !== "GET" && !readPost) return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, {
      method: request.method(),
      headers: { "content-type": "application/json", accept: request.headers().accept ?? "*/*", origin: source, referer: `${source}/` },
      body: readPost ? request.postData() : undefined,
    });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    await context.route("**/api/**", fromSource);
    await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
    const shot = async (state) => {
      await page.waitForTimeout(800);
      const file = path.join(out, `${state}-${size.name}-${lang}.jpg`);
      await page.screenshot({ path: file, quality: 86, type: "jpeg" });
      const overflow = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
      report.push(`${state}-${size.name}-${lang}: overflow ${overflow.join("×")} px`);
    };
    const open = async (where, wait = 8_000) => {
      await page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(wait);
    };

    await open("/pro", 12_000);
    await shot("pro");
    await open(`/pool/${MET_POOL}`, 14_000);
    await page.waitForSelector(".ryntra-chart canvas", { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(4_000);
    await shot("pool-met");
    // A ladder on the form: its prices stand over the candles as the draft's lines.
    const amount = page.locator('input[inputmode="decimal"]').first();
    if (await amount.count()) {
      await amount.fill("1");
      await page.waitForTimeout(6_000);
      await shot("pool-met-ladder");
    }
    if (size.mobile) {
      await page.evaluate(() => window.scrollTo(0, 620));
      await shot("pool-met-phone-under");
    }
    if (size.name === "desk1920") {
      await open("/earn", 12_000);
      await shot("earn");
      await open(`/coin/${MET}`, 12_000);
      await shot("spot-met");
    }
    if (errors.length) report.push(`${size.name}-${lang}: page errors — ${errors.join(" | ")}`);
    await context.close();
  }
}

writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
await browser.close();
