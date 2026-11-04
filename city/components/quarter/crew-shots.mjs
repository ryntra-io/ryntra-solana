// Ryntra City, crews are streets (CITY-20): the crew's street from the city, my crew's sheet in build mode, a new
// crew, and an invite that came by a link, at 1440×860 and 375×812, in English and Ukrainian
// → <out>/<lang>-<state>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_CREWS=open npm run dev, then node city/components/quarter/crew-shots.mjs [out] [baseUrl]
//   (SIZES=desk,phone and LANGS=en,uk pick a part)
// The world answers from the fixtures below through Playwright's routing, so the screens are the same on every
// machine. The members, names and figures are fixtures for review, not people of the city.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { CREW } from "./words.ts";

const out = path.resolve(process.argv[2] ?? "out/crew-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

const NOW = new Date().toISOString();
const ROW = 1;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const quarter = { id: uuid(1), ownerId: uuid(101), district: "arrivals", street: `arrivals-${ROW + 1}`, cell: { x: 0, z: ROW }, level: 4, version: 9, updatedAt: NOW };
const b = (q, slot, kind, level, modules) => ({ id: uuid(1000 + slot), quarterId: q, slot, kind, level, modules, link: null, updatedAt: NOW });
const buildings = [
  b(quarter.id, 1, "home", 3, ["base.brick", "floor.brick", "floor.glass", "roof.garden", "light.lantern", "sign.plain"]),
  b(quarter.id, 0, "decor", 1, ["base.stone", "light.amber"]),
  b(quarter.id, 2, "workshop", 2, ["base.timber", "floor.concrete", "light.amber"]),
  b(quarter.id, 4, "decor", 1, ["base.stone", "light.lantern"]),
];
const me = (q = quarter) => ({
  resident: { id: q.ownerId, accountId: null, displayName: null, homeQuarterId: q.id, createdAt: NOW },
  quarter: q,
  buildings,
  quarters: [q],
  points: { total: 180, recent: [] },
  tasks: [],
});
// The crew's row: my quarter and five neighbours on the north side; newcomers on the first street.
const sketch = (n, x, z, level, list) => ({ id: uuid(n), ownerId: uuid(100 + n), street: `arrivals-${z + 1}`, cell: { x, z }, level, buildings: list });
const lived = (seed) => [
  { slot: 1, kind: "home", level: 2 + (seed % 2) },
  { slot: 0, kind: "decor", level: 1 },
  { slot: 2, kind: seed % 3 ? "workshop" : "harbor", level: 2 },
  { slot: 4, kind: "coin_tower", level: 2 + (seed % 3) },
];
const district = [
  sketch(1, 0, ROW, 4, buildings.map(({ slot, kind, level }) => ({ slot, kind, level }))),
  ...[2, 4, 6, 8, 10].map((x, i) => sketch(2 + i, x, ROW, 3 + (i % 3), lived(i))),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((x, i) => sketch(20 + i, x, 0, 1 + (i % 3), lived(i + 3).slice(0, 2 + (i % 3)))),
];
const hq = { level: 3, units: 210, next: 300, modules: ["base.steel", "floor.glass", "floor.brick", "roof.antenna", "light.lantern"] };
const street = { id: uuid(500), name: "Night Owls", colour: "lilac", street: `arrivals-${ROW + 1}`, row: ROW, members: 6, limit: 12, hq };
const people = [0, 2, 4, 6, 8, 10].map((lot, i) => ({ quarterId: uuid(1 + i), name: null, lot, level: 3 + (i % 3), verified: i % 3 !== 2, joinedAt: NOW }));
const crew = { ...street, invite: "K7Q2MX9P", people, score: { week: "2026-10-26", actions: 41, verified: 4, total: 61 }, me: { quarterId: quarter.id, gave: { module: true, points: false }, points: 60 } };

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function fixtures(page, { member = true, resident = true } = {}) {
  await page.route("**/api/world/**", (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/api/world/me") return resident ? json(route, 200, me()) : json(route, 401, { error: { code: "NO_RESIDENT", message: "fixture" } });
    if (p.startsWith("/api/world/district/")) return json(route, 200, { district: "arrivals", quarters: resident ? district : district.slice(1), nextCursor: null });
    if (p === "/api/world/crew") return json(route, 200, { crew: member ? crew : null });
    if (p === "/api/world/crews") return json(route, 200, { crews: [street] });
    if (p.startsWith("/api/world/crew/invite/")) return json(route, 200, { crew: street });
    return json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } });
  });
}

const browser = await chromium.launch({ ...(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function open(s, options, lang, invite = null) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await fixtures(page, options);
  const query = new URLSearchParams({ lang, ...(invite ? { crew: invite } : {}) });
  await page.goto(`${base}/?${query}`, { waitUntil: "domcontentloaded" });
  // The development server's own badge is not part of the city.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForFunction(() => !!window.__quarter && !!window.__crew, null, { timeout: 120_000 });
  // The account settles first (no wallet here: a visitor); the fixture's place is then shown as if a wallet signed in.
  await page.waitForFunction(() => window.__quarter.getState().owner !== undefined, null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  return { context, page, errors };
}

/**
 * The fixture's place, shown as if a wallet signed in: the account's own sync may still say «visitor» once more while
 * it settles, so the owner is set again until it stays.
 */
async function signIn(page) {
  for (let i = 0; i < 10; i += 1) {
    await page.evaluate(async () => {
      await window.__quarter.getState().setOwner("wallet:fixture");
      await window.__crew.getState().read();
    });
    await page.waitForTimeout(1500);
    if (await page.evaluate(() => window.__quarter.getState().status === "resident")) return;
  }
}

/** Software WebGL draws slowly: wait until the sheet has risen, not for a fixed time. */
async function settled(page) {
  await page.waitForFunction(() => {
    const d = document.querySelector("[role=dialog]");
    return !!d && d.getAnimations({ subtree: true }).every((a) => a.playState === "finished");
  }, null, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

/** Waits for a state of the stores; on a timeout says what they hold instead. */
async function until(page, fn) {
  try {
    await page.waitForFunction(fn, null, { timeout: 60_000 });
  } catch (e) {
    const state = await page.evaluate(() => ({ quarter: window.__quarter.getState().status, owner: window.__quarter.getState().owner, mode: window.__quarter.getState().mode, crew: window.__crew.getState().status, error: window.__crew.getState().error }));
    throw new Error(`${e.message}: ${JSON.stringify(state)}`);
  }
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// A development server compiles what a page asks for on its first visit and may reload it once: one visit first, so
// the shots below meet a settled city.
{
  const { context } = await open(SIZES[0], {}, LANGS[0]);
  await context.close();
}

for (const lang of LANGS) for (const s of SIZES) {
  const w = CREW[lang];
  const shot = (page, state) => page.screenshot({ path: path.join(out, `${lang}-${state}-${s.name}.jpg`), type: "jpeg", quality: 82, timeout: 120_000 });
  const report = [];

  // 1 · My crew in build mode: the street in its light, the headquarters across from me, the crew's sheet.
  {
    const { context, page, errors } = await open(s, {}, lang);
    await signIn(page);
    await until(page, () => window.__quarter.getState().status === "resident" && window.__crew.getState().status === "member");
    await page.evaluate(() => window.__quarter.getState().enter());
    await until(page, () => window.__quarter.getState().mode === "build");
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: w.crew, exact: true }).click();
    await page.getByRole("dialog", { name: w.crew }).waitFor({ timeout: 10_000 });
    await settled(page);
    await shot(page, "crew-home");
    await page.getByRole("button", { name: w.details }).click();
    await settled(page);
    await shot(page, "crew-details");
    report.push(`home overflow=${await overflow(page)} errors=${errors.length}${errors.length ? ` → ${errors.join("\n").slice(0, 3000)}` : ""}`);

    // 2 · The street from the city: back out, the camera over the terrace.
    await page.getByRole("dialog", { name: w.crew }).getByRole("button", { name: w.close }).click();
    await page.evaluate(() => window.__quarter.getState().leave());
    await page.waitForTimeout(2500);
    await page.evaluate((row) => {
      const hq = window.__terrace.lotOf({ x: 1, z: row });
      return window.__terrace.look(hq.x - 30, 30, hq.z + 44, hq.x + 14, 0, hq.z - 10);
    }, ROW);
    await page.waitForTimeout(3500);
    await shot(page, "crew-street");
    await context.close();
  }

  // 3 · No crew yet: a new one, a name and a colour.
  {
    const { context, page, errors } = await open(s, { member: false }, lang);
    await signIn(page);
    await until(page, () => window.__quarter.getState().status === "resident" && window.__crew.getState().status === "none");
    await page.evaluate(() => window.__quarter.getState().enter());
    await until(page, () => window.__quarter.getState().mode === "build");
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: w.crew, exact: true }).click();
    await page.getByLabel(w.crewName).fill("Night Owls");
    await page.getByRole("radio", { name: w.colour("lilac") }).click();
    await settled(page);
    await shot(page, "crew-create");
    report.push(`create overflow=${await overflow(page)} errors=${errors.length}${errors.length ? ` → ${errors.join("\n").slice(0, 4000)}` : ""}`);
    await context.close();
  }

  // 4 · An invite by a link, for a newcomer: the street behind the code and its one action.
  {
    const { context, page, errors } = await open(s, { member: false, resident: false }, lang, "K7Q2MX9P");
    await page.getByRole("dialog", { name: w.crew }).getByText("Night Owls").waitFor({ timeout: 60_000 });
    // The city draws behind the invite: wait for the terrace's first frames.
    await page.waitForFunction(() => !!window.__terrace, null, { timeout: 120_000 });
    await page.waitForTimeout(40_000);
    await settled(page);
    await shot(page, "crew-invite");
    report.push(`invite overflow=${await overflow(page)} crew in url=${new URL(page.url()).searchParams.has("crew")} errors=${errors.length}${errors.length ? ` → ${errors[0].slice(0, 600)}` : ""}`);
    await context.close();
  }

  console.log(`${lang} ${s.name}: ${report.join(" | ")}`);
}
await browser.close();
