// Beacons' screens for review (CITY-72), at 390×844 and 1440×900 → <out>/beacon-<state>-<size>.jpg
//   node city/lib/beacon/shots.mjs [out] [baseUrl]      (the app running: npm run dev, or next start)
// No wallet and no keys. The city's market read answers with the bundled snapshot marked live and fresh, so the
// beacons' engine runs on it; the account's beacons answer «sign in first», as for a visitor. The lit tower is a beacon
// seeded on the device as fired a minute ago: these are fixtures, the live pass is on the stand.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-72");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const SOL_MINT = "So11111111111111111111111111111111111111112";
const tower = [...snapshot.towers].filter((t) => t.verified && t.id !== SOL_MINT && t.price > 0).sort((a, b) => b.mcap - a.mcap)[2];
const SYMBOL = tower.symbol.replace(/^\$/, "");

const ALL = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "desk", width: 1440, height: 900, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

function seeded(now) {
  const rule = {
    id: "shotbeacon1", version: 1, groups: [[{ kind: "price", op: "above", value: Number((tower.price * 0.9).toPrecision(3)) }]], holdSeconds: 0,
    hysteresis: 0.002, cooldownSeconds: 3600, repeat: true, expiresAt: null, quiet: null, on: true, createdAt: now - 3_600_000, mint: tower.id, symbol: SYMBOL, notify: true,
  };
  const states = { shotbeacon1: { version: 1, state: { armed: false, since: null, firedAt: now - 60_000, seen: true }, spent: false } };
  return JSON.stringify({ rules: [rule], states });
}

async function open(size, { lit = false } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  if (lit) await page.addInitScript((saved) => window.localStorage.setItem("ryntra.city.beacons.v1", saved), seeded(Date.now()));
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/city", (route) => json(route, 200, { ...snapshot, source: "live", fetchedAt: new Date().toISOString() }));
  await page.route("**/api/world/beacons", (route) => json(route, 401, { error: { code: "WALLET_REQUIRED" } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.goto(`${base}/c/${tower.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(Number(process.env.WAIT_MS ?? 12_000));
  return { page, context, errors };
}

const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const report = [];

for (const size of SIZES) {
  const shot = (page, state) => page.screenshot({ path: path.join(out, `beacon-${state}-${size.name}.jpg`), type: "jpeg", quality: 82 });
  {
    const { page, context, errors } = await open(size);
    const button = page.getByRole("button", { name: "Alert me", exact: true });
    await button.waitFor({ timeout: 30_000 });
    await shot(page, "card");
    await button.click();
    await page.waitForTimeout(1200);
    await shot(page, "editor");
    await page.getByRole("button", { name: /^Details/ }).click();
    await page.getByRole("button", { name: "+ Condition" }).click();
    await page.waitForTimeout(600);
    await shot(page, "details");
    await page.getByRole("button", { name: "Set beacon" }).click();
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    await shot(page, "set");
    report.push(`${size.name}: overflow=${await overflowOf(page)}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 2).join(" | ").slice(0, 300) : ""}`);
    await context.close();
  }
  {
    const { page, context, errors } = await open(size, { lit: true });
    await page.getByRole("button", { name: "Alert me", exact: true }).waitFor({ timeout: 30_000 });
    await shot(page, "lit");
    report.push(`${size.name} lit: overflow=${await overflowOf(page)}px errors=${errors.length}`);
    await context.close();
  }
}
console.log(report.join("\n"));
await browser.close();
