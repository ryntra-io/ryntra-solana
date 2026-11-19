// The wallet window and «Money» without a wallet for the eyes: the window at 1920 and 390 — with no wallet
// in the browser, and with two wallets that register through the Wallet Standard (a stand's own, for the picture alone:
// they connect to nothing and sign nothing) — and «Money» · «Send · Receive · Invoices» with no wallet, in English and
// Ukrainian → <out>/<state>-<size>-<lang>.jpg.
//   node terminal/shell/wallets-shots.mjs [out] [baseUrl]
// Works on the live site (the «before») and on a stand (`next dev`, the «after»). SIZES=wide,phone, LANGS=en,uk and
// ONLY=<shot,shot> narrow a run; PRESS_CHROME may point at another Chromium.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-302c/after");
const base = process.argv[3] ?? "http://localhost:3144";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" },
  // An Android phone: the wallet window alone — the Seeker's wallet is registered there and offered as a row of its own.
  { name: "android", width: 390, height: 844, mobile: true, only: "connect", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" },
].filter((size) => (process.env.SIZES ?? "wide,phone,android").split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const want = (name) => !ONLY || ONLY.has(name);

/** Phantom's own icon, as its extension registers it (the site keeps the same file). */
const PHANTOM_ICON = `data:image/svg+xml;base64,${readFileSync(new URL("../../public/terminal/wallets/phantom.svg", import.meta.url)).toString("base64")}`;

/** Two wallets registered as the Wallet Standard has them register — the picture of a browser that has them. */
function standWallets({ phantom }) {
  const tile = (fill, letter) =>
    `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${fill}"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="#fff" font-family="sans-serif">${letter}</text></svg>`)}`;
  const wallet = (name, icon) => ({
    version: "1.0.0",
    name,
    icon,
    chains: ["solana:mainnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: () => new Promise(() => {}) },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => Promise.reject(new Error("stand")) },
    },
  });
  // Phantom with its own icon, and a wallet the window does not know, with the icon it registered.
  const wallets = [wallet("Phantom", phantom), wallet("Trust", tile("#3375bb", "T"))];
  const register = (api) => api.register(...wallets);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

/** A stand under `next dev` hydrates late: SETTLE_MS waits longer before a shot. */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 1200);

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
  // `next dev`'s own badge is the stand's, never the page's.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

/** The header's wallet, pressed until its window stands (a press before the page hydrates does nothing). */
async function openWallet(page) {
  const button = page.locator('[data-terminal="wallet"]').first();
  for (let attempt = 0; attempt < 5; attempt++) {
    await button.click({ timeout: 30_000 });
    const open = await page.locator('[role="dialog"]').first().waitFor({ state: "visible", timeout: 4_000 }).then(() => true).catch(() => false);
    if (open) break;
  }
  // The shot waits for every logo the window draws.
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(900);
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const plan of size.only ? ["none"] : ["none", "two"]) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.mobile ? 2 : 1,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        userAgent: size.ua,
      });
      const page = await context.newPage();
      if (plan === "two") await page.addInitScript(standWallets, { phantom: PHANTOM_ICON });
      const file = (name) => path.join(out, `${name}-${size.name}-${lang}.jpg`);

      const name = plan === "none" ? "connect" : "connect-installed";
      if (want(name)) {
        await page.goto(`${base}/swap?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await settle(page);
        await openWallet(page).catch((error) => console.log(`${name} ${size.name}/${lang}: ${error.message.split("\n")[0]}`));
        await page.screenshot({ path: file(name), type: "jpeg", quality: 82 });
        console.log(`${name}-${size.name}-${lang}`);
      }
      if (plan === "none" && !size.only) {
        for (const tab of ["send", "receive", "invoices"]) {
          const shot = `money-${tab}`;
          if (!want(shot)) continue;
          await page.goto(`${base}/money?lang=${lang}${tab === "send" ? "" : `&tab=${tab}`}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
          await settle(page);
          await page.screenshot({ path: file(shot), type: "jpeg", quality: 82, fullPage: size.mobile });
          console.log(`${shot}-${size.name}-${lang}`);
        }
      }
      await context.close();
    }
  }
}
await browser.close();
