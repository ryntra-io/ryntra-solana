// Ryntra City, free building on my quarter (CITY-55): the way in, the dock over a built-up lot, a sign in focus with
// its words, a refused piece, and the lot from the city — at 1440×860 and 390×844 → <out>/<state>-<size>.png
//   node city/components/quarter/kit/free/free-shots.mjs [out] [baseUrl]   (npm run dev running; PRESS_CHROME may point at a Chromium)
// The world answers from the fixtures below through Playwright's routing, so the screens are the same on every machine.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/free-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const NOW = new Date().toISOString();
const quarter = { id: "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f", ownerId: "0f1e2d3c-4b5a-4968-8776-655443322110", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level: 3, version: 4, updatedAt: NOW };
const buildings = [{ id: "00000000-0000-4000-8000-000000000001", quarterId: quarter.id, slot: 1, kind: "home", level: 2, modules: ["base.brick", "floor.brick", "light.lantern"], link: null, updatedAt: NOW }];
const me = {
  resident: { id: quarter.ownerId, accountId: null, displayName: null, homeQuarterId: quarter.id, createdAt: NOW },
  quarter,
  buildings,
  quarters: [quarter],
  points: { total: 120, recent: [] },
  tasks: [],
};

const p = (gx, gz, kind, y = 0, rot = 0, text) => ({ gx, gz, y, kind, rot, ...(text ? { text } : {}) });
/** A lot people would build: a row of houses by the street, a hall of games, a ring behind a hedge, a vault, a sign. */
const PIECES = [
  // Plot 0: a row of houses with a second storey and a turret, a lamp and a walk.
  p(0, 1, "block"), p(1, 1, "block"), p(2, 1, "block"), p(0, 1, "block", 1), p(1, 1, "glass", 1), p(0, 1, "turret", 2),
  p(0, 0, "lamp"), p(1, 0, "path"), p(2, 0, "path"), p(1, 2, "tree"), p(2, 2, "hedge"), p(0, 2, "hedge"),
  // Plot 2: the arcade, a walk to it and trees.
  p(6, 1, "arcade"), p(6, 0, "path"), p(7, 0, "path"), p(8, 0, "tree"), p(8, 1, "lamp"), p(8, 2, "tree"),
  // Plot 3: a hedge line, the ring, a fountain.
  p(0, 3, "hedge"), p(1, 3, "hedge"), p(2, 3, "hedge"), p(0, 4, "mini_ring"), p(2, 5, "fountain"), p(2, 4, "lamp"),
  // Plot 4: the vault, a sign, a glass tower.
  p(3, 3, "vault_house"), p(5, 3, "sign", 0, 0, "Ryntra"), p(5, 5, "glass"), p(5, 5, "glass", 1), p(5, 5, "glass", 2), p(3, 5, "tree"), p(4, 5, "arch"),
];

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function fixtures(page) {
  let version = 3;
  await page.route("**/api/world/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/world/me") return json(route, 200, me);
    if (url.pathname === "/api/world/layout" && route.request().method() === "GET") return json(route, 200, { layout: { quarterId: quarter.id, pieces: PIECES, version, updatedAt: NOW } });
    if (url.pathname === "/api/world/layout") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      version += 1;
      return json(route, 200, { layout: { quarterId: quarter.id, pieces: body.pieces, version, updatedAt: NOW } });
    }
    if (url.pathname === "/api/world/district/arrivals") return json(route, 200, { district: "arrivals", quarters: [], nextCursor: null });
    return json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } });
  });
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
  const settle = (ms = 2500) => page.waitForTimeout(ms);

  await page.goto(base, { waitUntil: "domcontentloaded" });
  // The framework's development badge is not part of the screen.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  // The city shows a quarter only to a wallet signed in to Ryntra; the shots stand in for that sign-in through the
  // dev-only store hook, once the account watch has settled on «a visitor».
  await page.waitForFunction(() => window.__quarter?.getState().owner === null, null, { timeout: 120_000 });
  await settle(3000);
  await page.evaluate((m) => {
    window.__quarter.setState({ owner: "shots", me: m, status: "resident" });
    window.__quarter.getState().enter();
  }, me);
  await page.waitForFunction(() => window.__quarter?.getState().mode === "build", null, { timeout: 90_000 });
  await page.waitForFunction(() => window.__free?.getState().status === "ready", null, { timeout: 60_000 });
  await settle();
  const widths = [await overflow()];
  await shot("free-entry");

  await page.getByRole("button", { name: "Free build" }).click();
  await page.getByRole("toolbar", { name: "Free build" }).waitFor({ timeout: 20_000 });
  await settle();
  widths.push(await overflow());
  await shot("free-build");

  // The sign in focus: its words open in the dock.
  await page.evaluate(() => window.__free.setState({ focus: { gx: 5, gz: 3, y: 0 }, tool: "sign" }));
  await settle(1200);
  widths.push(await overflow());
  await shot("free-sign");

  // A ring above the quarter's level: one line, for a moment.
  await page.evaluate(() => window.__free.setState({ focus: null, tool: "block", note: { kind: "refused", reason: "support", at: performance.now() } }));
  // Software WebGL paints slowly: the line is held still for the shot instead of caught mid-fade.
  await page.addStyleTag({ content: "[role=status]{animation:none!important;opacity:1!important}" });
  await page.getByRole("status").waitFor({ timeout: 10_000 });
  await settle(400);
  widths.push(await overflow());
  await shot("free-refused");

  await page.getByRole("button", { name: "Done" }).click();
  await settle(1500);
  await shot("free-done");

  console.log(`${s.name}: overflow=${Math.max(...widths)}px errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 1200) : ""}`);
  await context.close();
}
await browser.close();
