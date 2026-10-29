// Ryntra City, the day's tasks and points over my quarter (CITY-19): the panel in build mode with one task done and
// two left, the phone's folded row and the same panel unfolded, and the day with all three done, at 1440×900 and
// 390×844 → <out>/<state>-<size>.png
//   node lib/city-economy/day-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// The world answers from the fixtures below through Playwright's routing, and the quarter is opened through the
// dev-only window.__quarter hook, so the screens are the same on every machine and need no wallet. Every figure in
// them is a fixture for review.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/day-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const NOW = new Date().toISOString();
const DAY = NOW.slice(0, 10);
const resident = { id: "0f1e2d3c-4b5a-4968-8776-655443322110", accountId: "5b0f8c1e-2a3d-4c5e-8f70-1a2b3c4d5e6f", displayName: null, homeQuarterId: "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f", createdAt: NOW };
const quarter = { id: resident.homeQuarterId, ownerId: resident.id, district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level: 5, version: 9, updatedAt: NOW };
const b = (slot, kind, level, modules) => ({ id: `00000000-0000-4000-8000-00000000000${slot}`, quarterId: quarter.id, slot, kind, level, modules, link: null, updatedAt: NOW });
const buildings = [
  b(0, "decor", 1, ["base.stone", "light.amber"]),
  b(1, "workshop", 2, ["base.brick", "floor.brick", "light.lantern", "sign.plain"]),
  b(4, "home", 3, ["base.brick", "floor.brick", "floor.glass", "roof.flat", "light.lantern", "sign.plain"]),
];
const task = (kind, progress, goal) => ({ residentId: resident.id, day: DAY, kind, progress, goal, doneAt: progress >= goal ? NOW : null });
const me = (tasks, total) => ({ resident, quarter, buildings, quarters: [quarter], points: { total, recent: [] }, tasks });
const SOME = me([task("add_floor", 1, 1), task("light_street", 0, 1), task("visit_quarters", 2, 3)], 260);
const ALL_DONE = me([task("add_floor", 1, 1), task("light_street", 1, 1), task("visit_quarters", 3, 3)], 280);

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch({ ...(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  let current = SOME;
  await page.route("**/api/world/**", (route) => (new URL(route.request().url()).pathname === "/api/world/me" ? json(route, 200, current) : json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } })));
  const shot = (state) => page.screenshot({ path: path.join(out, `${state}-${s.name}.png`) });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  /**
   * The quarter as the world read it, opened the way the card's Build does: the camera flies in, then build mode. Once
   * in build mode, a new read only replaces what the world said, as a build's answer does.
   */
  const open = async (data) => {
    current = data;
    await page.evaluate((m) => {
      const q = window.__quarter;
      if (q.getState().mode === "build") q.setState({ me: m });
      else q.setState({ me: m, status: "resident", mode: "arrive", slot: null, choice: null, landed: null });
    }, data);
    await page.waitForFunction(() => window.__quarter.getState().mode === "build", null, { timeout: 60_000 });
    await page.getByRole("region", { name: "Today's tasks and points" }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
  };

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__quarter && !!window.__city, null, { timeout: 180_000 });
  // Let the account settle (no wallet here: a visitor), so it does not clear the quarter opened next.
  await page.waitForTimeout(6000);

  await open(SOME);
  const widths = [await overflow()];
  await shot("day");
  // Folded by default on every screen: one row, then unfolded by a tap, then the level tapped for how far the next is.
  const head = page.getByRole("button", { name: /^Today:/ });
  const press = (target) => (s.mobile ? target.tap() : target.click());
  await press(head);
  await page.waitForTimeout(600);
  widths.push(await overflow());
  await shot("day-open");
  await press(page.getByRole("button", { name: /^Level / }));
  await page.waitForTimeout(300);
  await shot("day-level");
  await open(ALL_DONE);
  if ((await head.getAttribute("aria-expanded")) !== "true") await press(head);
  await page.waitForTimeout(600);
  widths.push(await overflow());
  await shot("day-done");

  console.log(`${s.name}: overflow=${Math.max(...widths)}px errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 300) : ""}`);
  await context.close();
}
await browser.close();
