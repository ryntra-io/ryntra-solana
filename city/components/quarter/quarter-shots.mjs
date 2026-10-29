// Ryntra City, my quarter with buildings on the engine (CITY-17): the lot in build mode with its kit buildings and
// their tags, a linked coin tower's sheet, a building with nothing linked, a harbor waiting for its wallet and the
// garage that cannot be linked yet, at 1440×860, 390×844 and 360×740 → <out>/<state>-<size>.png
//   node city/components/quarter/quarter-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// The world and the engine answer from the fixtures below through Playwright's routing, so the screens are the same
// on every machine. Every figure in them is a fixture for review, not a market figure.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/quarter-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "small", width: 360, height: 740, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const POSITION = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const quarter = { id: "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f", ownerId: "0f1e2d3c-4b5a-4968-8776-655443322110", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level: 5, version: 12, updatedAt: NOW };
const b = (slot, kind, level, modules, link = null) => ({ id: `00000000-0000-4000-8000-00000000000${slot}`, quarterId: quarter.id, slot, kind, level, modules, link, updatedAt: NOW });
// Low buildings at the street, the tall ones behind them, so the camera sees every one.
const buildings = [
  b(0, "workshop", 2, ["base.brick", "floor.brick", "light.lantern", "sign.plain"]),
  b(1, "harbor", 2, ["base.timber", "floor.concrete", "light.amber"], { kind: "lp_position", position: POSITION }),
  b(2, "garage", 2, ["base.stone", "floor.concrete", "light.amber"]),
  b(3, "oracle", 2, ["base.stone", "floor.glass", "light.amber"], { kind: "prediction_book" }),
  b(4, "home", 3, ["base.brick", "floor.brick", "floor.glass", "roof.flat", "light.lantern", "sign.plain"]),
  b(5, "crew_hq", 2, ["base.stone", "floor.concrete", "roof.flat", "light.amber", "sign.plain"], { kind: "team", teamId: "6719f2c4a1b2c3d4e5f60718" }),
  b(6, "coin_tower", 3, ["base.stone", "floor.concrete", "floor.glass", "light.amber"], { kind: "mint", mint: MINT }),
];
const me = {
  resident: { id: quarter.ownerId, accountId: null, displayName: null, homeQuarterId: quarter.id, createdAt: NOW },
  quarter,
  buildings,
  quarters: [quarter],
  points: { total: 260, recent: [] },
  tasks: [],
};

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function fixtures(page) {
  await page.route("**/api/world/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/world/me") return json(route, 200, me);
    return json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } });
  });
  await page.route(`**/api/v1/launch/${MINT}**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/stats")) {
      return json(route, 200, {
        token: MINT,
        pair: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, dollar: false },
        holders: { count: 1204, atLeast: false },
        marketCap: { pair: 412.4, usd: 61200 },
        volume: { day: { raw: "38400000000", atLeast: false }, week: { raw: null, atLeast: false }, all: { raw: null, atLeast: false } },
        observedAt: ago(40),
      });
    }
    return json(route, 200, { token: MINT, name: "Orbit Cat", symbol: "OCAT", image: null, progressBps: 6420, migrated: false, observedAt: ago(20) });
  });
  // The team is read by its proven wallet; this browser has not signed in, so the engine says so.
  await page.route("**/api/v1/teams/**", (route) => json(route, 401, { error: { code: "PROOF_REQUIRED", message: "fixture" } }));
  await page.route("**/api/predictions/account", (route) => json(route, 401, { error: { code: "PROOF_REQUIRED", message: "fixture" } }));
}

const browser = await chromium.launch({ ...(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await fixtures(page);
  const shot = (state) => page.screenshot({ path: path.join(out, `${state}-${s.name}.png`) });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // A plot's sheet through the dev-only store hook: a tall building in front would take a tap meant for the one behind.
  // Software WebGL can draw a frame a second: wait until the sheet has risen, not for a fixed time.
  const tap = async (slot) => {
    await page.evaluate((n) => window.__quarter.getState().pick(n), slot);
    await page.waitForFunction(() => {
      const d = document.querySelector("[role=dialog]");
      return !!d && d.getAnimations().every((a) => a.playState === "finished");
    }, null, { timeout: 30_000 });
    await page.waitForTimeout(600);
  };
  const close = async () => {
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await page.waitForTimeout(500);
  };

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Build", exact: true }).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.waitForFunction(() => window.__quarter?.getState().mode === "build", null, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const widths = [await overflow()];
  await shot("quarter-buildings");

  await tap(6);
  await page.getByRole("dialog").getByText("Orbit Cat").waitFor({ timeout: 10_000 });
  widths.push(await overflow());
  await shot("quarter-coin");
  await close();

  await tap(0);
  widths.push(await overflow());
  await shot("quarter-empty");
  await close();

  await tap(1);
  widths.push(await overflow());
  await shot("quarter-harbor");
  await close();

  await tap(2);
  widths.push(await overflow());
  await shot("quarter-garage");
  await close();

  console.log(`${s.name}: overflow=${Math.max(...widths)}px errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 1200) : ""}`);
  await context.close();
}
await browser.close();
