// The Guard window's screens for review (CITY-152), at 1440×860 and 390×844 → <out>/guard-<state>-<lang>-<size>.png (kept in the repository as JPEG)
//   node city/lib/guard/stand-rpc.mjs &
//   RYNTRA_SOLANA_RPC_MAINNET=http://127.0.0.1:8899 RYNTRA_SOLANA_RPC_MAINNET_FALLBACK=http://127.0.0.1:8899 \
//     NEXT_PUBLIC_RYNTRA_CITY_GUARD=open npm run dev
//   node city/lib/guard/shots.mjs [out] [baseUrl]
// The window opens from the Deck's Guard place, the transactions are pasted as a person would, and the engine's own
// route answers — over the stand chain (`stand-rpc.mjs`), so every figure on these screens is a fixture.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { SCENARIOS } from "./stand.mjs";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-152");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

/* A project pinned to another Playwright than the machine's browser: the machine's Chromium, named. */
const executablePath = process.env.PRESS_CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function open(size, lang) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  /* The towers' coin icons are not what these screens are about: a plain disc each, so the stand's server stays free. */
  await page.route("**/api/icon/*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#23222D"/></svg>' }));
  await page.route("**/api/auth/solana/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
  await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => Boolean(window.__guard) && document.querySelector('[data-deck-place="guard"]'), null, { timeout: 180_000 });
  await page.waitForTimeout(6000);
  const later = page.getByRole("button", { name: /^(Later|Close the Arrivals card|Пізніше)$/ });
  if (await later.isVisible().catch(() => false)) await later.click({ force: true, timeout: 120_000 });
  await page.locator('[data-deck-place="guard"]').click({ force: true, timeout: 120_000 });
  await page.locator("[data-guard-input]").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(900);
  return { page, context, errors };
}

async function check(page, scenario) {
  const { transaction, intent } = SCENARIOS[scenario];
  if (await page.locator("[data-guard-another]").isVisible().catch(() => false)) await page.locator("[data-guard-another]").click({ force: true, timeout: 120_000 });
  await page.locator("[data-guard-input]").fill(transaction);
  if (intent) {
    if (!(await page.locator("[data-guard-intent]").isVisible().catch(() => false))) await page.locator("[data-guard-intent-toggle]").click({ force: true, timeout: 120_000 });
    await page.locator("[data-guard-intent]").fill(intent);
  }
  await page.locator("[data-guard-check]").click({ force: true, timeout: 120_000 });
  await page.locator("[data-guard-verdict]").waitFor({ timeout: 120_000 }).catch(async (failure) => {
    const state = await page.evaluate(() => {
      const { phase, failure: why, text, intent } = window.__guard.getState();
      return { phase, why, text: text.slice(0, 24), intent };
    });
    throw new Error(`${scenario}: no verdict — ${JSON.stringify(state)} (${failure.message.split("\n")[0]})`);
  });
  await page.waitForTimeout(1500);
}

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const { page, context, errors } = await open(size, lang);
    const shot = (state) => page.screenshot({ path: path.join(out, `guard-${state}-${lang}-${size.name}.png`), timeout: 120_000 });
    await shot("empty");
    await check(page, "drain");
    await shot("block");
    await page.locator("[data-guard-details]").click({ force: true, timeout: 120_000 });
    await page.waitForTimeout(1500);
    await shot("block-details");
    await check(page, "intent");
    await page.locator("[data-guard-details]").click({ force: true, timeout: 120_000 });
    await page.waitForTimeout(1500);
    await shot("intent-details");
    await check(page, "clear");
    await shot("allow");
    await check(page, "nonce");
    await shot("warn");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${size.name} ${lang}: overflow ${overflow}px, errors ${errors.length}${errors.length ? ` — ${errors.slice(0, 3).join(" | ")}` : ""}`);
    await context.close();
  }
}
await browser.close();
