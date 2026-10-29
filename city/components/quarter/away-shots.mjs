// Ryntra City, «While you were away» (CITY-18): the reel over the city when a signed-in wallet comes back — each line
// with the camera over its change (the quarter, the coin its tower shows, the newcomers' street, the risers), and the
// consent switches turned on, at 1440×860, 390×844 and 360×740 → <out>/away-<line>-<size>.png
//   node city/components/quarter/away-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// The world, the city's market read and the engine answer from the fixtures below through Playwright's routing, so the
// screens are the same on every machine. Every figure in them is a fixture for review, not a market figure. The
// quarter's owner is set through the dev-only store hook: no wallet signs anything here.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/away-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "small", width: 360, height: 740, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const NOW = ago(0);

// The bundled city, as if Jupiter had just answered, with the day's moves the reel tells of.
const bundled = JSON.parse(readFileSync(new URL("../../lib/market/snapshot.json", import.meta.url), "utf8"));
const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump"; // the coin my tower shows
const MOVES = { [MINT]: 14.2, Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk: 38.6, DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 21.3 };
const city = { ...bundled, source: "live", fetchedAt: ago(1), towers: bundled.towers.map((t) => (t.id in MOVES ? { ...t, change24h: MOVES[t.id] } : t)) };

const quarter = { id: "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f", ownerId: "0f1e2d3c-4b5a-4968-8776-655443322110", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level: 4, version: 9, updatedAt: NOW };
const b = (slot, kind, level, modules, link = null) => ({ id: `00000000-0000-4000-8000-00000000000${slot}`, quarterId: quarter.id, slot, kind, level, modules, link, updatedAt: NOW });
const me = {
  resident: { id: quarter.ownerId, accountId: "5b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3", displayName: null, homeQuarterId: quarter.id, createdAt: ago(6000) },
  quarter,
  buildings: [
    b(0, "workshop", 2, ["base.brick", "floor.brick", "light.lantern", "sign.plain"]),
    b(1, "home", 3, ["base.brick", "floor.brick", "floor.glass", "roof.flat", "light.lantern", "sign.plain"]),
    b(4, "coin_tower", 3, ["base.stone", "floor.concrete", "floor.glass", "light.amber"], { kind: "mint", mint: MINT }),
  ],
  quarters: [quarter],
  points: { total: 180, recent: [] },
  tasks: [],
};

const beat = (id, about, kind, source, subject, count, at, from, detail = {}, street = null) => ({ id, about, kind, source, subject, count, at, from, street, detail, eventIds: [id] });
const away = (since) => ({
  since,
  until: NOW,
  events: [],
  report: {
    beats: [
      beat("b1", "quarter", "visit", "world", quarter.id, 3, ago(42), ago(300), { street: "arrivals-1", verified: 2 }, "arrivals-1"),
      beat("b2", "object", "graduate", "engine", MINT, 1, ago(95), ago(95), { pool: "damm_v2", slot: 4, building: "coin_tower", linkKind: "mint" }),
      beat("b3", "district", "claim", "world", "arrivals-2", 4, ago(20), ago(260), { street: "arrivals-2" }, "arrivals-2"),
      beat("b4", "district", "build", "world", "arrivals-1", 2, ago(70), ago(180), { street: "arrivals-1", kind: "home", level: 2 }, "arrivals-1"),
    ],
    counts: { quarter: 3, object: 1, district: 6, city: 0 },
  },
});

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function fixtures(page) {
  const consent = { telegram: false, push: false, updatedAt: null };
  await page.route("**/api/world/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/world/me") return json(route, 200, me);
    if (url.pathname === "/api/world/away") return json(route, 200, away(url.searchParams.get("since") ?? ago(1440)));
    if (url.pathname === "/api/world/consent") {
      if (route.request().method() === "POST") Object.assign(consent, JSON.parse(route.request().postData() ?? "{}"), { updatedAt: NOW });
      return json(route, 200, { consent, canConsent: true });
    }
    return json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } });
  });
  await page.route("**/api/city", (route) => json(route, 200, city));
  await page.route("**/api/v1/**", (route) => json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } }));
  await page.route("**/api/predictions/**", (route) => json(route, 401, { error: { code: "PROOF_REQUIRED", message: "fixture" } }));
}

const browser = await chromium.launch({ ...(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await fixtures(page);
  const shot = (state) => page.screenshot({ path: path.join(out, `away-${state}-${s.name}.png`), timeout: 120_000 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__quarter && !!window.__away && !!window.__city, null, { timeout: 120_000 });
  // Let the city's own session read settle, then hand the quarter to a signed-in owner, as a wallet sign-in would.
  await page.waitForTimeout(6000);
  // No wallet is connected in this browser, so the city's account would hand the quarter back to a visitor on its
  // next read of the session: the fixture keeps the owner it was given.
  await page.evaluate(() => {
    const q = window.__quarter;
    const setOwner = q.getState().setOwner;
    q.setState({ setOwner: (owner) => (owner === null || owner === undefined ? Promise.resolve() : setOwner(owner)) });
    return q.getState().setOwner("wallet:FixtureOwner1111111111111111111111111111");
  });
  await page.waitForFunction(() => window.__away.getState().status === "playing", null, { timeout: 60_000 });
  await page.evaluate(() => window.__away.getState().pause(true));
  const lines = await page.evaluate(() => window.__away.getState().lines.map((l) => l.id));
  const names = { b1: "quarter", b2: "coin", b3: "street", b4: "neighbours", [`mine:${MINT}`]: "my-coin" };
  const widths = [];
  for (let i = 0; i < lines.length; i += 1) {
    await page.evaluate((n) => window.__away.setState({ index: n }), i);
    // Software WebGL can draw a frame a second: give the flight its time to land.
    await page.waitForTimeout(4500);
    widths.push(await overflow());
    await shot(`${i + 1}-${names[lines[i]] ?? lines[i].split(":")[0]}`);
  }
  await page.getByRole("switch", { name: "Telegram" }).click();
  await page.waitForFunction(() => window.__away.getState().consent?.telegram === true, null, { timeout: 10_000 });
  await page.waitForTimeout(600);
  widths.push(await overflow());
  await shot("consent");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.waitForTimeout(3500);
  const after = await page.evaluate(() => window.__away.getState().status);
  await shot("after");

  console.log(`${s.name}: lines=${lines.length} after=${after} overflow=${Math.max(...widths)}px errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 1200) : ""}`);
  await context.close();
}
await browser.close();
