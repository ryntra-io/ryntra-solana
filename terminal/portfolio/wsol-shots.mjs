// The QA's whale (19.11, day) on the Portfolio, for the eyes: its wrapped SOL in the coins and the total, the
// line «Not everything was read», the clean with its wrapped SOL off until picked, the address kept through the menu,
// a tiny price folded, and «Saved» on a phone. At 1920×1080, 1440×900 and 390×844, English and Ukrainian.
//   node terminal/portfolio/wsol-shots.mjs <out> <base> [source]
//   base — https://ryntra.io for «before», or the stand (http://localhost:3334) for «after».
// The stand answers the portfolio and the clean itself (LOCAL) and reads every other `/api/**` from ryntra.io. The whale
// is looked at by its public address; for the clean it is connected as a read-only stub that never signs, and the
// clean's Review is never asked of any server: the request is held, so nothing is built. SIZES, LANGS, ONLY narrow a run.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-334/after");
const base = process.argv[3] ?? "http://localhost:3334";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

/** The QA's whale: ~86 000 SOL wrapped in its token account `CTyFgu…`. */
const WHALE = "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa";
const LOCAL = ["/api/v1/portfolio", "/api/v1/wallet/clean", "/api/v1/wallet/clean/back"];

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "w1440", width: 1440, height: 900, mobile: false },
  { name: "p390", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const proxied = !base.startsWith(source);

async function fromSource(route) {
  const url = new URL(route.request().url());
  const request = route.request();
  // The clean's Review builds a package: never asked here, on any server — held, so the panel only reads.
  if (url.pathname === "/api/v1/wallet/clean/review" || url.pathname === "/api/v1/wallet/clean/submit") return;
  if (!proxied) return route.continue();
  const from = LOCAL.includes(url.pathname) ? base : source;
  try {
    const answer = await fetch(`${from}${url.pathname}${url.search}`, {
      method: request.method(),
      headers: { accept: request.headers().accept ?? "*/*", "content-type": request.headers()["content-type"] ?? "application/json", origin: source, referer: `${source}/portfolio`, "X-Ryntra-API": request.headers()["x-ryntra-api"] ?? "1" },
      body: request.method() === "GET" ? undefined : (request.postData() ?? undefined),
    });
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

/** A Wallet Standard stub for the whale's public address: it connects and never signs. */
function stub(address) {
  const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
  const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction"], label: "Phantom" };
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
}

const notes = [];
const facts = {};
for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const wallet of [false, true]) {
      if (wallet && ONLY && !ONLY.has("clean")) continue;
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
      await context.route("**/api/**", fromSource);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      if (wallet) await page.addInitScript(stub, WHALE);
      const key = `${size.name}-${lang}`;
      const fact = (facts[key] ??= {});
      const shot = async (name, { full = false } = {}) => {
        if (ONLY && !ONLY.has(name)) return;
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(out, `${name}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg", fullPage: full });
      };
      const go = (where) => page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      const ready = () => page.waitForFunction(() => /\$\s?[\d\s ,.]{4,}/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 90_000 }).catch(() => {});
      const toRow = (text) =>
        page.evaluate((text) => {
          const cell = [...document.querySelectorAll("main [role='cell'], main li, main [role='row']")].find((node) => node.textContent?.trim().startsWith(text));
          cell?.scrollIntoView({ block: "center", behavior: "instant" });
          return Boolean(cell);
        }, text);
      try {
        if (!wallet) {
          const started = Date.now();
          await go(`/portfolio?owner=${WHALE}`);
          await ready();
          await page.waitForTimeout(5000);
          fact.readMs = Date.now() - started;
          fact.text = await page.evaluate(() => (document.querySelector("main")?.innerText ?? "").slice(0, 900));
          await shot("lookup");
          fact.wsolRow = await toRow("wSOL");
          await shot("wsol");
          fact.tinyRow = await toRow("Lmn");
          await shot("tiny");
          // The menu's «Positions», then a reload: the wallet looked at stays.
          if (!size.mobile) {
            await page.evaluate(() => window.scrollTo(0, 0));
            const link = page.locator('a[href="/portfolio#positions"]').first();
            await link.click({ timeout: 8_000 }).catch(() => {});
            await page.waitForTimeout(1500);
            fact.afterPositions = page.url();
            await page.reload({ waitUntil: "domcontentloaded" });
            await ready();
            await page.waitForTimeout(3000);
            fact.afterReload = page.url();
            fact.stillWatched = await page.evaluate((whale) => (document.querySelector("main")?.innerText ?? "").includes(`${whale.slice(0, 4)}…${whale.slice(-4)}`), WHALE);
            await shot("positions-reload");
          }
          if (size.mobile) {
            await go("/?tab=saved");
            await page.waitForTimeout(8000);
            fact.savedTop = await page.evaluate(() => Math.round(document.getElementById("market-title")?.getBoundingClientRect().top ?? -1));
            await shot("saved");
          }
        } else {
          await go(`/portfolio?lang=${lang}`);
          await page.waitForTimeout(2500);
          await page.getByRole("button", { name: lang === "uk" ? /Підключити гаманець/ : /Connect wallet/ }).first().click({ timeout: 20_000 }).catch(() => {});
          await page.getByRole("button", { name: /Phantom/ }).first().click({ timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(1500);
          await page.keyboard.press("Escape");
          await ready();
          await page.waitForTimeout(6000);
          // The stub never signs the sign-in message: its waiting card is put away before the shot.
          await page.keyboard.press("Escape");
          const clean = page.getByRole("button", { name: lang === "uk" ? /^Очистити гаманець$/ : /^Clean wallet$/ }).first();
          await clean.click({ timeout: 20_000 }).catch(() => notes.push(`${key}: no clean tile`));
          await page.waitForTimeout(2500);
          // The stub's unanswered sign-in opens the header's wallet card over the panel: its own button puts it away.
          const unCard = () => page.locator('[data-terminal="wallet"][aria-expanded="true"]').first().click({ timeout: 3_000 }).catch(() => {});
          await unCard();
          await shot("clean");
          const toggle = page.getByRole("switch", { name: lang === "uk" ? /^Додати w?SOL$/ : /^Include w?SOL$/ }).first();
          fact.wsolPickedByDefault = await toggle.getAttribute("aria-checked", { timeout: 8_000 }).catch(() => null);
          if (fact.wsolPickedByDefault === "false") await toggle.click({ timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(1500);
          fact.cleanText = await page.evaluate(() => (document.querySelector("[aria-label='Очистити гаманець'], [aria-label='Clean wallet']")?.innerText ?? "").slice(0, 400));
          await unCard();
          await shot("clean-wsol-on");
        }
      } catch (error) {
        notes.push(`${key} wallet=${wallet}: ${String(error).slice(0, 200)}`);
      }
      if (errors.length) notes.push(`${key} wallet=${wallet} page errors: ${errors.slice(0, 3).join(" | ").slice(0, 400)}`);
      await context.close();
    }
  }
}
await browser.close();
writeFileSync(path.join(out, "facts.json"), JSON.stringify({ base, notes, facts }, null, 2));
console.log(JSON.stringify({ notes, facts }, null, 2).slice(0, 6000));
