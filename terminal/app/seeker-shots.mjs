// The terminal as the Ryntra app on a Seeker shows it, for the eyes: the WebView's own size (412×915, 1080×2400 at 2.625),
// its user agent and its bridge, played by a stand-in app in the page → <out>/*.jpg and <out>/report.txt.
//   node terminal/app/seeker-shots.mjs <out> [baseUrl]
// A stand runs as people will get it: NEXT_PUBLIC_RYNTRA_TERMINAL=open next build && next start. The stand-in app answers
// the page as the real one does (docs/city/APP-BRIDGE.md): `app.ready` on `page.ready`, a wallet on `wallet.connect`, and
// «declined» on every signature — nothing is signed. LIVE=https://ryntra.io lets the reads a stand cannot answer come
// from the live site (a GET, or a quote); nothing that sends leaves the stand.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/seeker");
const base = process.argv[3] ?? "http://localhost:3161";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const LIVE = process.env.LIVE ?? "";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
/* A public address with nothing in it: the stand-in wallet's. No key behind it is ever used. */
const WALLET = { address: "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2", name: "Seed Vault Wallet" };
const AGENT = "Mozilla/5.0 (Linux; Android 15; Seeker Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 RyntraApp/1.21.0";
const SAY = { en: "launch a token for me", uk: "запусти мені токен" };
const READS = [/^\/api\/city$/, /^\/api\/icon\//, /^\/api\/spot\/candles/];
const SENDS = /submit|execute|relay|send|sign/i;
const report = [];

/* The app in the page: what the WebView's `ReactNativeWebView` and the app behind it do, in a few lines. */
const standInApp = ({ wallet }) => {
  const log = (window.__appLog = []);
  let connected = null;
  const say = (message) => {
    const data = JSON.stringify({ v: 1, ...message });
    setTimeout(() => document.dispatchEvent(new MessageEvent("message", { data })), 30);
  };
  const ready = () => say({ type: "app.ready", version: "1.21.0", platform: "android", wallet: connected });
  window.ReactNativeWebView = {
    postMessage(data) {
      let m = null;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (!m || m.v !== 1) return;
      log.push(m.type);
      if (m.type === "page.ready") return ready();
      if (m.type === "wallet.connect") {
        connected = wallet;
        say({ id: m.id, ok: true, result: wallet });
        return say({ type: "wallet.changed", wallet });
      }
      if (m.type === "wallet.disconnect") {
        connected = null;
        say({ id: m.id, ok: true, result: {} });
        return say({ type: "wallet.changed", wallet: null });
      }
      if (m.type === "open.external") return say({ id: m.id, ok: true, result: {} });
      if (typeof m.id !== "string") return;
      // A signature is declined, as a person would; anything this app does not know is said so.
      const signs = m.type === "wallet.signMessage" || m.type === "wallet.signTransactions";
      say({ id: m.id, ok: false, error: { code: signs ? "declined" : "unsupported", message: signs ? "declined" : "unsupported" } });
    },
  };
  window.addEventListener("load", () => setTimeout(ready, 50));
};

for (const lang of LANGS) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: AGENT,
    locale: lang === "uk" ? "uk-UA" : "en-US",
  });
  await context.addInitScript(standInApp, { wallet: WALLET });
  // The live site's own analytics never count these visits.
  await context.route("**/_vercel/**", (route) => route.fulfill({ status: 204, body: "" }));
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const { origin, pathname, search } = new URL(request.url());
    if (origin !== new URL(base).origin) return route.continue();
    if (READS.some((re) => re.test(pathname))) return route.continue();
    if (/^\/api\/(auth\/|v1\/me)/.test(pathname) && request.method() === "GET") return route.continue();
    const read = request.method() === "GET" || /quote/.test(pathname);
    // On the live site itself every read goes as it is; only a send is refused.
    if (!/localhost|127\.0\.0\.1/.test(base) && read && !SENDS.test(pathname)) return route.continue();
    if (LIVE && read && !SENDS.test(pathname)) {
      try {
        const response = await route.fetch({ url: `${LIVE}${pathname}${search}`, timeout: 15_000 });
        return route.fulfill({ response });
      } catch {
        // no answer is a 503
      }
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const settle = async (ms = 2000) => {
    await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
    await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(ms);
  };
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}-${lang}.jpg`), quality: 88, type: "jpeg" });
  const note = (line) => report.push(`${lang} ${line}`);

  // The first open, as the app opens it: `https://ryntra.io/`. The app's cover lifts on the page's load event.
  const started = Date.now();
  await page.goto(`${base}/?lang=${lang}`, { waitUntil: "load", timeout: 180_000 });
  const loaded = Date.now() - started;
  await page.waitForSelector("[data-terminal='tabs'] a", { timeout: 60_000 });
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const scripts = performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script");
    return {
      ttfb: Math.round(nav.responseStart),
      domReady: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      scripts: scripts.length,
      scriptKb: Math.round(scripts.reduce((sum, r) => sum + (r.encodedBodySize || 0), 0) / 1024),
    };
  });
  note(`first open: load event ${loaded} ms; ttfb ${timing.ttfb}, dom ${timing.domReady}, load ${timing.load}; ${timing.scripts} scripts, ${timing.scriptKb} KB`);
  await settle();
  await shot("01-home");
  note(`bridge after load: ${JSON.stringify(await page.evaluate(() => window.__appLog))}`);

  // The five tabs: where they stand, how big a finger's target is, and that each one opens its screen.
  const tabs = page.locator("[data-terminal='tabs'] a");
  const boxes = [];
  for (let i = 0; i < (await tabs.count()); i += 1) {
    const box = await tabs.nth(i).boundingBox();
    const href = (await tabs.nth(i).getAttribute("href")) ?? "?";
    boxes.push(box ? `${href} ${Math.round(box.width)}×${Math.round(box.height)} @${Math.round(box.y)}` : `${href} hidden`);
  }
  note(`tabs: ${boxes.join(" · ")}`);
  const header = await page.locator("[data-terminal='mark']").boundingBox();
  note(`mark: ${header ? `${Math.round(header.width)}×${Math.round(header.height)} @${Math.round(header.y)}` : "none"}`);
  note(`page wider than the screen: ${await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);

  const order = ["/swap", "/agent", "/earn", "/portfolio"];
  for (const [i, href] of order.entries()) {
    await page.evaluate(() => Object.assign(window, { __same: true }));
    await page.locator(`[data-terminal='tabs'] a[href$='${href}']`).tap();
    await page.waitForURL((url) => url.pathname === href, { timeout: 30_000 });
    await settle();
    await shot(`0${i + 2}-${href.slice(1)}`);
    note(`${href}: same page — ${await page.evaluate(() => window.__same === true)}`);
  }

  // Back, as the app's Back does it (`history.back()`), all the way to the first screen.
  for (let i = 0; i < order.length; i += 1) await page.evaluate(() => history.back()).then(() => page.waitForTimeout(500));
  note(`Back ×${order.length}: ${new URL(page.url()).pathname}`);

  // A coin, as a link from outside opens it: `/c/<mint>`.
  await page.goto(`${base}/c/${JUP}?lang=${lang}`, { waitUntil: "load", timeout: 120_000 });
  await settle(3000);
  note(`coin link: ${new URL(page.url()).pathname}`);
  await shot("06-coin");

  // The agent: one sentence.
  await page.goto(`${base}/agent?lang=${lang}`, { waitUntil: "load", timeout: 120_000 });
  await settle();
  // The Agent's screen holds its own field in place of the header's line.
  const line = page.locator("input[type='text']:visible").first();
  await line.tap();
  await line.fill(SAY[lang]);
  await page.waitForTimeout(1200);
  await shot("07-agent-say");
  await page.keyboard.press("Enter");
  await settle(2500);
  note(`agent sentence → ${new URL(page.url()).pathname}`);
  await shot("08-agent-handed");

  // The wallet: the header's button asks the app; the app's wallet comes back; the sign-in message is declined.
  await page.goto(`${base}/?lang=${lang}`, { waitUntil: "load", timeout: 120_000 });
  await settle();
  await page.evaluate(() => (window.__appLog.length = 0));
  await page.locator("[data-terminal='wallet']").first().tap();
  await page.waitForTimeout(2500);
  await shot("09-wallet-asked");
  note(`wallet tap → bridge: ${JSON.stringify(await page.evaluate(() => window.__appLog))}`);
  note(`header after: «${(await page.locator("[data-terminal='wallet']").first().innerText()).replace(/\s+/g, " ")}»`);

  // The menu sheet.
  await page.keyboard.press("Escape");
  await page.locator("[data-terminal='menu-button']").tap();
  await page.waitForSelector("[role='dialog'][aria-modal='true']", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  await shot("10-sheet");

  if (errors.length) note(`page errors — ${errors.join(" | ").slice(0, 600)}`);
  await context.close();
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
