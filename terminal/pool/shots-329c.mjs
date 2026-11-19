// The Meteora QA of 19.11 night for the eyes → <out>/*.jpg: `/pro` («Active» and its order), MET/SOL's own
// desk on Position and on Limit, JitoSOL/SOL's on Position (wide; then «My shape»), HOLDFAST/SOL's head and «Liquidity by
// price», TTWO/SOL's book, and Earn — the range's edges and the head's figures written to the report for each.
//   node terminal/pool/shots-329c.mjs [out] [baseUrl] [source]
// `baseUrl` a stand (`next dev` or `next start`), every `/api/**` read asked from `source` (ryntra.io by default) with
// the site's own origin; or `baseUrl` = the source itself for the «before» set (nothing routed). Reads only; the wallet
// is never connected; nothing is sent. SIZES=desk2560,desk1920,desk1440,desk1366,phone, LANGS=uk,en and PAGES=pro,met,jito,odd,solusdc,ttwo,earn
// narrow the run.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-329c/after");
const base = process.argv[3] ?? "http://localhost:3142";
const source = process.argv[4] ?? "https://ryntra.io";
const live = base === source;
mkdirSync(out, { recursive: true });

const MET_POOL = "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d";
const JITO_POOL = "EBEQoUmLTYoBMLShvubK7RBniYyx9CyLLos221c1u1kW";
const ODD_POOL = "2gc7BgE3WJ9P8A7hKDjYEDzSXw4Ux2DxyPrr9YijvkLL";
const SOL_USDC = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const TTWO_POOL = "GEhkDiHnZ5m6eYp6AtRqcsmqwN8YNnvfXaDUPoBRAMoA";
const EXE = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: EXE, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk2560", width: 2560, height: 1440, mobile: false, only: ["ttwo"] },
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "desk1440", width: 1440, height: 900, mobile: false },
  { name: "desk1366", width: 1366, height: 768, mobile: false, only: ["met", "odd"] },
  { name: "phone", width: 390, height: 844, mobile: true, only: ["pro", "met", "jito", "earn"] },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const PAGES = (process.env.PAGES ?? "pro,met,jito,odd,solusdc,ttwo,earn").split(",");
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
    const tag = (state) => `${state}-${size.name}-${lang}`;
    const shot = async (state, full = false) => {
      await page.waitForTimeout(800);
      const file = path.join(out, `${tag(state)}.jpg`);
      await page.screenshot({ path: file, quality: 86, type: "jpeg", fullPage: full });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      report.push(`${tag(state)}: overflow-x ${overflow} px`);
    };
    const open = async (where, wait = 10_000) => {
      await page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(wait);
    };
    /** The range's line and its three edges, and the head's figures with whether each is in sight. */
    const read = async (state) => {
      const facts = await page.evaluate(() => {
        const line = document.querySelector("[data-earn-range='line']")?.textContent ?? "-";
        const edges = [...document.querySelectorAll("[data-earn-range='editor'] b")].map((b) => b.textContent).join(" | ");
        const head = document.querySelector("[data-pool-head]");
        const box = head?.getBoundingClientRect();
        const figures = [...(head?.querySelectorAll("dl > div") ?? [])].map((div) => {
          const r = div.getBoundingClientRect();
          const seen = r.width > 0 && box && r.right <= (div.parentElement?.getBoundingClientRect().right ?? 0) + 1;
          return `${div.querySelector("dt")?.textContent}=${div.querySelector("dd")?.textContent}${seen ? "" : " (hidden)"}`;
        });
        const quote = head?.querySelector("[class*='inQuote']")?.textContent ?? "-";
        const axis = document.querySelector("figcaption")?.textContent ?? "-";
        return `line «${line}» · edges «${edges}» · head ${quote} · ${figures.join(", ")} · axis «${axis}»`;
      });
      report.push(`${tag(state)}: ${facts}`);
    };
    const proRows = async (state) => {
      const rows = await page.evaluate(() => [...document.querySelectorAll("[role='row']")].slice(1, 9).map((row) => row.textContent?.replace(/\s+/g, " ").trim().slice(0, 80)));
      report.push(`${tag(state)}: rows ${rows.join(" ‖ ")}`);
    };

    const wants = (name) => PAGES.includes(name) && (!size.only || size.only.includes(name));
    if (wants("pro")) {
      await open("/pro", 12_000);
      await proRows("pro");
      await shot("pro");
    }
    if (wants("met")) {
      await open(`/pool/${MET_POOL}?tab=position`, 14_000);
      await read("met-position");
      await shot("met-position", size.mobile);
      await open(`/pool/${MET_POOL}?tab=limit`, 12_000);
      await shot("met-limit", size.mobile);
    }
    if (wants("jito")) {
      await open(`/pool/${JITO_POOL}?tab=position`, 14_000);
      const wide = page.locator("[role='radio'], [role='tab'], button", { hasText: lang === "uk" ? "Широкий" : "Wide" });
      if (await wide.count()) await wide.first().click();
      await page.waitForTimeout(1_200);
      await read("jito-wide");
      await shot("jito-wide", size.mobile);
      const custom = page.locator("[role='radio'], button", { hasText: lang === "uk" ? "Своя" : "own" });
      if (await custom.count()) {
        await custom.first().click();
        await page.waitForTimeout(1_200);
        await shot("jito-custom", size.mobile);
      }
    }
    if (wants("odd")) {
      await open(`/pool/${ODD_POOL}`, 14_000);
      await read("holdfast");
      await shot("holdfast");
    }
    if (wants("solusdc")) {
      // A pool Earn adds to opens on its position, with no jump from the swap while Earn's pools are read.
      await open(`/pool/${SOL_USDC}`, 3_000);
      const early = await page.evaluate(() => document.querySelector("[role='tab'][aria-selected='true']")?.textContent ?? "-");
      await page.waitForTimeout(10_000);
      const late = await page.evaluate(() => [...document.querySelectorAll("[role='tab'][aria-selected='true']")].map((t) => t.textContent).join(" / "));
      report.push(`${tag("solusdc")}: tab at 3 s «${early}», at 13 s «${late}»`);
      await shot("solusdc");
    }
    if (wants("ttwo")) {
      await open(`/pool/${TTWO_POOL}`, 14_000);
      await shot("ttwo");
    }
    if (wants("earn")) {
      await open("/earn", 12_000);
      await shot("earn");
    }
    if (errors.length) report.push(`${size.name}-${lang} errors: ${errors.join(" | ")}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
