// «Ryntra Partners» screens for review (CITY-126, CITY-127): desk 1440×900 and phone 375×812 (2×), English and
// Ukrainian → <out>/<state>-<lang>-<size>.jpg
//   npm run dev      then      node city/lib/partners/shots.mjs [out] [baseUrl]
// No wallet and no keys: a stub wallet registers through the Wallet Standard events and comes back silently, as a wallet
// this site was granted does; it signs nothing. «Мій район» reads `/api/rewards` answered with a fixture in the Growth
// engine's own shape, so every figure on its screens is a fixture under no mark of «demo» — the live pass with a real
// wallet is the owner's on production. The terms are decision 93's, read from `lib/decks/partner-terms.ts`.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-126");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = process.env.LANGS ? process.env.LANGS.split(",") : ["en", "uk"];
// BLOCKS: retake only some of them — programme, district, gate, landing.
const BLOCKS = new Set(process.env.BLOCKS ? process.env.BLOCKS.split(",") : ["programme", "district", "gate", "landing"]);

const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const row = (kind, amount, detail, minutes) => ({ kind, display: `${kind === "CLAIM" ? "−" : "+"}$${amount}`, amount, valued: true, detail, at: at(minutes) });

/** `/api/rewards` for a proven wallet (`app/api/rewards/route.ts`): a partner who brought 14 people. */
const REWARDS = {
  ok: true,
  address: OWNER,
  available: "0.00",
  pending: "1.10",
  lifetime: "48.62",
  cashback: "11.37",
  referralL1: "34.80",
  referralL2: "0.00",
  claimable: false,
  referrals: { level1: 14, level2: 0 },
  referral: { code: "K7Q2M9XW4HPT", link: "https://ryntra.io/r/K7Q2M9XW4HPT" },
  rows: [
    row("REFERRAL_L1", "2.14", "BONK", 7),
    row("CASHBACK", "0.62", "SOL", 31),
    row("REFERRAL_L1", "1.08", "POPCAT", 95),
    row("REFERRAL_L1", "0.87", "SOL", 60 * 9),
    row("REFERRAL_L1", "3.40", "WIF", 60 * 26),
    row("REFERRAL_L1", "0.55", "PENGU", 60 * 50),
    row("REFERRAL_L1", "1.92", "JUP", 60 * 75),
  ],
  started: true,
};

/** `/api/partners/earnings` once the weekly payout runs (CITY-128): counted, owed, paid; `PAYOUTS=off` answers it off. */
const EARNINGS = process.env.PAYOUTS === "off" ? { ok: true, on: false } : { ok: true, on: true, accrued: "41.60", swap: "36.80", launch: "4.80", pending: "6.80", paid: "34.80", lastPaidWeek: "2026-11-02" };

const gl = ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: gl });

async function open(size, lang, { connected = true, ask = "", invited = false } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(({ taker, connected }) => {
    if (!connected) return;
    window.localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
        "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { taker: OWNER, connected });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/icon/*", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: [] } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/rewards?*", (route) => json(route, 200, REWARDS));
  await page.route("**/api/partners/earnings*", (route) => json(route, 200, EARNINGS));
  // A browser that came through a partner's link carries its invitation (the engine's own answer shape).
  await page.route("**/api/rewards/referral*", (route) => json(route, 200, invited ? { ok: true, pending: { code: "K7Q2M9XW4HPT", inviterMasked: "4EeX…KPGW", codeMasked: "K7Q2…4HPT" }, confirmed: null } : { ok: true, pending: null, confirmed: null }));
  const query = new URLSearchParams({ lang, ...(ask ? { partners: ask } : {}) });
  await page.goto(`${base}/?${query}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForFunction(() => typeof window.__partners?.getState === "function" && (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 240_000 });
  await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: Number(process.env.SKYLINE_WAIT ?? 90_000) }).catch(() => {});
  await page.waitForTimeout(4000);
  return { page, context, errors };
}

const settle = async (page) => {
  // The head still: a busy development server can take a while to hand it over.
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => !img.closest("[class*='hero']") || (img.complete && img.naturalWidth > 0)), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3500);
};
const scrollWindow = (page, y) => page.evaluate((y) => document.querySelectorAll("[class*='framed']").forEach((el) => el.scrollTo(0, y)), y);
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const report = [];
for (const size of SIZES) {
  for (const lang of LANGS) {
    const shot = (page, state) => page.screenshot({ path: path.join(out, `${state}-${lang}-${size.name}.jpg`), type: "jpeg", quality: 82 });
    const w = lang === "uk" ? { terms: "Умови", history: "Історія", creator: "Творець", guild: "Гільдія", menu: "Меню" } : { terms: "The terms", history: "History", creator: "Creator", guild: "Guild", menu: "Menu" };

    // The programme: the offer, the calculator, the terms behind «i», the creator, the guild.
    if (BLOCKS.has("programme")) {
      const { page, context, errors } = await open(size, lang, { ask: "referrer" });
      await settle(page);
      await shot(page, "1-referrer");
      await page.getByRole("button", { name: w.terms }).click();
      // The terms open with a short fade: wait until they stand whole.
      await page.locator("dl dt").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForFunction(() => { const dl = document.querySelector("dl"); const box = dl?.parentElement; return Boolean(box && getComputedStyle(box).opacity === "1"); }, null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await shot(page, "2-terms");
      await page.getByRole("button", { name: w.terms }).click();
      await scrollWindow(page, 420);
      await page.waitForTimeout(1200);
      await shot(page, "3-calculator");
      await scrollWindow(page, 0);
      await page.getByRole("tab", { name: w.creator }).click();
      await settle(page);
      await shot(page, "4-creator");
      await page.getByRole("tab", { name: w.guild }).click();
      await settle(page);
      await shot(page, "5-guild");
      report.push(`${size.name} ${lang} programme: overflow=${await overflowOf(page)}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
      await context.close();
    }

    // «Мій район» on the engine's answer: the figures, then the history behind its toggle.
    if (BLOCKS.has("district")) {
      const { page, context, errors } = await open(size, lang, { ask: "district" });
      await page.evaluate((owner) => window.__partners.getState().read(owner, true), OWNER);
      await settle(page);
      await shot(page, "6-district");
      await scrollWindow(page, 10_000);
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: w.history }).click();
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: w.history }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
      await shot(page, "7-district-history");
      report.push(`${size.name} ${lang} district: overflow=${await overflowOf(page)}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
      await context.close();
    }

    // Without a wallet: «Мій район» asks for one.
    if (BLOCKS.has("gate")) {
      const { page, context } = await open(size, lang, { ask: "district", connected: false });
      await settle(page);
      await shot(page, "8-district-gate");
      await context.close();
    }

    // The friend's greeting, as a browser that came through a partner's link sees it, and the menu's way in.
    if (BLOCKS.has("landing")) {
      const { page, context } = await open(size, lang, { connected: false, invited: true });
      await settle(page);
      await shot(page, "9-landing");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: w.menu, exact: true }).click();
      await page.locator("#city-menu").waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
      // The menu fades in; a software GL keeps the page busy, so wait until it stands whole.
      await page.waitForFunction(() => { const menu = document.getElementById("city-menu"); return Boolean(menu && getComputedStyle(menu).opacity === "1"); }, null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await shot(page, "10-menu");
      await context.close();
    }
  }
}

await browser.close();
console.log(report.join("\n"));
