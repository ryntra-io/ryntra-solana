// The Portfolio on live data, for the eyes — before (ryntra.io itself) and after (a stand whose every
// `/api/**` is read from ryntra.io) — at 1440×900, 1920×1080 and 390×844, English and Ukrainian.
//   node terminal/portfolio/live-shots.mjs <out> <base> [source]
//   base — the stand (http://localhost:3141) or https://ryntra.io for «before».
// Every figure is the engine's own read of public addresses. The stand wallet is a read-only stub: it connects with a
// public address and refuses every signature. SIZES=desk,wide,phone, LANGS=en,uk and ONLY=<shot,…> narrow a run.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-272b");
const base = process.argv[3] ?? "http://localhost:3141";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

/** The QA's wallet, connected (read only), and the busy wallet it looked at by address. */
const OWNER = "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne";
const WATCHED = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "w1440", width: 1440, height: 900, mobile: false },
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "p390", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const proxied = !base.startsWith(source);

/** The routes this change mends answer from the stand itself (LOCAL=<path,…>, e.g. /api/v1/wallet/clean). */
const LOCAL = (process.env.LOCAL ?? "").split(",").filter(Boolean);

async function fromSource(route) {
  const url = new URL(route.request().url());
  const request = route.request();
  const from = LOCAL.some((local) => url.pathname === local) ? base : source;
  try {
    const answer = await fetch(`${from}${url.pathname}${url.search}`, {
      method: request.method(),
      headers: { accept: request.headers().accept ?? "*/*", "content-type": request.headers()["content-type"] ?? "application/json", origin: source, referer: `${source}/portfolio`, "X-Ryntra-API": request.headers()["x-ryntra-api"] ?? "1" },
      body: request.method() === "GET" ? undefined : request.postData() ?? undefined,
    });
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

const notes = [];
for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const wallet of [false, true]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
      if (proxied) await context.route("**/api/**", fromSource);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      if (wallet) {
        await page.addInitScript(({ address }) => {
          const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
          const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction"], label: "Phantom" };
          // Never signs: a request to sign waits for ever, as a person who does not press.
          const refuse = () => new Promise(() => {});
          const wallet = {
            version: "1.0.0",
            name: "Phantom",
            icon,
            chains: ["solana:mainnet"],
            accounts: [],
            features: {
              "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
              "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
              "standard:events": { version: "1.0.0", on: () => () => {} },
              "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse },
              "solana:signMessage": { version: "1.0.0", signMessage: refuse },
            },
          };
          window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
          window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
        }, { address: OWNER });
      }
      const shot = async (name, { full = false } = {}) => {
        if (ONLY && !ONLY.has(name)) return;
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(out, `${name}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg", fullPage: full });
      };
      const go = async (where) => {
        const started = Date.now();
        await page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        return started;
      };
      const connect = async () => {
        const button = page.getByRole("button", { name: lang === "uk" ? /Підключити гаманець/ : /Connect wallet/ }).first();
        await button.click({ timeout: 20_000 }).catch(() => {});
        await page.getByRole("button", { name: /Phantom/ }).first().click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.keyboard.press("Escape");
      };
      const walk = async () =>
        page.evaluate(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
            window.scrollTo(0, y);
            await new Promise((done) => setTimeout(done, 150));
          }
          window.scrollTo(0, 0);
        });
      try {
        if (!wallet) {
          await go("/portfolio");
          await page.waitForTimeout(6000);
          await shot("nowallet");
          const started = await go(`/portfolio?owner=${WATCHED}`);
          await page.waitForFunction(() => /\$\s?[\d\s ,.]+/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 60_000 }).catch(() => {});
          notes.push(`${size.name}/${lang} lookup total in ${Date.now() - started} ms`);
          await page.waitForTimeout(4000);
          await walk();
          await shot("lookup");
          await shot("lookup-full", { full: true });
          await go("/?tab=saved");
          await page.waitForTimeout(5000);
          await shot("saved");
        } else {
          await go("/portfolio");
          await page.waitForTimeout(2500);
          await connect();
          await page.waitForFunction(() => /\$\s?[\d\s ,.]+/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 60_000 }).catch(() => {});
          await page.waitForTimeout(5000);
          await walk();
          await shot("wallet");
          await shot("wallet-full", { full: true });
          const clean = await page.evaluate(() => /Очистити гаманець|Clean wallet/.test(document.querySelector("main")?.innerText ?? ""));
          notes.push(`${size.name}/${lang} clean tile on screen with a wallet: ${clean}`);
          await page.evaluate(() => {
            const link = [...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/portfolio#history");
            if (link) link.click();
            else window.location.hash = "history";
          });
          await page.waitForTimeout(2500);
          await shot("history");
          // A panel beside the lists: the coin's ticket, opened from its row (nothing is signed — the stub never signs).
          if (!size.mobile && (!ONLY || ONLY.has("panel"))) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.getByRole("button", { name: lang === "uk" ? /^Купити USDC$/ : /^Buy USDC$/ }).first().click({ timeout: 8_000 }).catch(() => {});
            await page.waitForTimeout(3000);
            await shot("panel");
          }
        }
      } catch (error) {
        notes.push(`${size.name}/${lang} wallet=${wallet}: ${String(error).slice(0, 200)}`);
      }
      if (errors.length) notes.push(`${size.name}/${lang} wallet=${wallet} page errors: ${errors.slice(0, 3).join(" | ").slice(0, 400)}`);
      await context.close();
    }
  }
}
await browser.close();
console.log(notes.join("\n"));
