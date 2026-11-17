// The terminal as the home page for the eyes: every screen a newcomer reaches, at 1440×900 and 390×844, in English and
// Ukrainian → <out>/*.jpg, and the old addresses walked on the running server.
//   node terminal/shell/home-shots.mjs <out> [baseUrl]
// A stand runs as people will get it: NEXT_PUBLIC_RYNTRA_TERMINAL=open next build && next start. The system Chrome draws
// the page (PRESS_CHROME may point at another). No wallet is connected and nothing is signed: what a person sees in their
// first minute. The market's and the coins' reads reach the stand; with LIVE set, every other read comes from that site.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-262");
const base = process.argv[3] ?? "http://localhost:3162";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = (process.env.SIZES ?? "desk,phone").split(",").map((name) =>
  name === "phone" ? { name, width: 390, height: 844, mobile: true } : { name: "desk", width: 1440, height: 900, mobile: false },
);
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SCREENS = (process.env.SCREENS ?? "home,coin,swap,earn,agent,launch,portfolio").split(",");
const PATHS = { home: "/", coin: `/coin/${JUP}`, swap: "/swap", earn: "/earn", agent: "/agent", launch: "/launch", portfolio: "/portfolio" };
/* LIVE=https://ryntra.io lets the reads the stand cannot answer come from the live site (pools, quotes); empty — 503. */
const LIVE = process.env.LIVE ?? "";
const READS = [/^\/api\/city$/, /^\/api\/icon\//, /^\/api\/spot\/candles/];
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const { pathname, search } = new URL(request.url());
      if (READS.some((re) => re.test(pathname))) return route.continue();
      // The engine's reads a stand has no keys for (pools, quotes, the launch board) come from ryntra.io: a read only —
      // a GET, or a quote's POST. Nothing else leaves the stand.
      const read = request.method() === "GET" || /quote/.test(pathname);
      if (LIVE && read) {
        try {
          const response = await route.fetch({ url: `${LIVE}${pathname}${search}`, timeout: 15_000 });
          return route.fulfill({ response });
        } catch {
          // fall through: no answer is a 503
        }
      }
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2500);
    };
    const shot = async (state, full = false) => {
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg", fullPage: full });
    };
    for (const screen of SCREENS) {
      const started = Date.now();
      await page.goto(`${base}${PATHS[screen]}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await settle();
      report.push(`${size.name}/${lang} ${screen}: ${Date.now() - started} ms, title «${await page.title()}»`);
      await shot(screen);
      if (!size.mobile && screen !== "coin") await shot(`${screen}-full`, true);
    }
    if (size.mobile) {
      await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded" });
      await settle();
      await page.locator("[data-terminal='mark']").tap();
      await page.waitForSelector("[role='dialog'][aria-modal='true']", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(700);
      await shot("sheet");
    }
    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

// The city at its own address, once, on a desk.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/city`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(out, "city-desk-en.jpg"), quality: 84, type: "jpeg" });
  report.push(`city: ${page.url()}`);
  await context.close();
}

// The old addresses on the running server: where each lands, and in how many hops.
const WALK = [
  "/market",
  "/c/" + JUP,
  "/launches",
  "/app/swap",
  "/app/spot?mint=" + JUP,
  "/app/earn",
  "/app/launch/" + JUP,
  "/app/bots",
  "/solana/workspace/swap",
  "/mission/" + JUP,
  "/trade",
  "/futures",
  "/predictions",
  "/rewards",
  "/money",
  "/send",
  "/bridge",
  "/map",
  "/city",
  "/?open=trade",
  "/?open=agent",
  "/?open=earn&tab=mine",
  "/?open=hall",
  "/?coin=" + JUP,
];
for (const start of WALK) {
  let url = `${base}${start}`;
  const hops = [];
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(url, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get("location"), url);
      hops.push(`${res.status} ${next.pathname}${next.search}`);
      url = next.toString();
      continue;
    }
    hops.push(String(res.status));
    break;
  }
  report.push(`walk ${start} → ${hops.join(" → ")}`);
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
