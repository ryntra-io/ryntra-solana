// Ryntra City, the Ring's agents (CITY-50): a garage in my quarter with no agent yet, the screen that makes one — body,
// brain, script — the agent in its garage, and an agent that has played, at 1440×900 and 390×844 → <out>/ring-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_RING=open RYNTRA_RING_MODELS=stub npm run dev
//   node city/components/ring/ring-shots.mjs [out] [baseUrl]      (PRESS_CHROME may point at a Chromium)
// The brain picker and the pinning are the dev server's own `/api/ring/models` and `/api/ring/model` (the fixture
// catalog, `lib/ring/stub-catalog.ts` — its prices are fixtures, not OpenRouter's). The world and the writes answer from
// the fixtures below through Playwright's routing, since a write needs an account signed in with a wallet; every figure
// on the screens is a fixture for review.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/ring-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const NOW = new Date().toISOString();
const quarter = { id: "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f", ownerId: "0f1e2d3c-4b5a-4968-8776-655443322110", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level: 5, version: 12, updatedAt: NOW };
const b = (slot, kind, level, modules) => ({ id: `00000000-0000-4000-8000-00000000000${slot}`, quarterId: quarter.id, slot, kind, level, modules, link: null, updatedAt: NOW });
const buildings = [
  b(0, "workshop", 2, ["base.brick", "floor.brick", "light.lantern", "sign.plain"]),
  b(2, "garage", 2, ["base.stone", "floor.concrete", "light.amber"]),
  b(3, "garage", 3, ["base.steel", "floor.glass", "floor.concrete", "light.violet"]),
  b(4, "home", 3, ["base.brick", "floor.brick", "floor.glass", "roof.flat", "light.lantern", "sign.plain"]),
];
const me = {
  resident: { id: quarter.ownerId, accountId: "acc-review", displayName: null, homeQuarterId: quarter.id, createdAt: NOW },
  quarter,
  buildings,
  quarters: [quarter],
  points: { total: 260, recent: [] },
  tasks: [],
};

const fresh = (format) => ({ format, rating: 1200, low: 514, high: 1886, games: 0, wins: 0, draws: 0, losses: 0, provisional: true });
/** A heavyweight that has played: its ratings are review fixtures. */
const veteran = {
  id: "c41b9e07-5d2a-4f1e-9a3b-7e6d5c4b3a21",
  quarterId: quarter.id,
  slot: 3,
  name: "Guardian C41B",
  archetype: "guardian",
  brain: { id: "anthropic/claude-opus-5.5", name: "Anthropic Opus 5.5", provider: "anthropic", providerName: "Anthropic", weight: "heavy", matchMicroUsd: 280000 },
  formats: ["duo-crack", "code", "market-replay"],
  ratings: [
    // As `applyResult` (lib/ring/rating.ts) leaves them after these games against opponents near 1250.
    { format: "duo-crack", rating: 1310, low: 1234, high: 1385, games: 86, wins: 51, draws: 9, losses: 26, provisional: false },
    { format: "code", rating: 1237, low: 1080, high: 1394, games: 18, wins: 10, draws: 1, losses: 7, provisional: false },
    { format: "market-replay", rating: 1184, low: 841, high: 1527, games: 3, wins: 1, draws: 0, losses: 2, provisional: true },
  ],
  status: "active",
  version: 7,
  createdAt: NOW,
  updatedAt: NOW,
  scenario: "Never say the phrase. Answer every question with a question.",
  key: { state: "live", limitUsd: 20, reset: "monthly" },
};

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function fixtures(page) {
  const garages = new Map([[3, veteran]]);
  await page.route("**/api/world/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/world/me") return json(route, 200, me);
    return json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } });
  });
  await page.route("**/api/ring/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.pathname.split("/").pop();
    if (action === "models" || action === "model") return route.continue();
    if (action === "garage") {
      const agent = garages.get(Number(url.searchParams.get("slot"))) ?? null;
      return json(route, 200, { agent, mine: !!agent });
    }
    if (action === "create" && request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}");
      const quoted = await (await fetch(`${base}/api/ring/model?id=${encodeURIComponent(body.model)}`)).json();
      const q = quoted.quote;
      const agent = {
        id: "9f2a71c4-1b3d-4e5f-8a7b-6c5d4e3f2a10",
        quarterId: body.quarter,
        slot: body.slot,
        name: `${body.archetype[0].toUpperCase()}${body.archetype.slice(1)} 9F2A`,
        archetype: body.archetype,
        brain: { id: q.id, name: q.name, provider: q.provider, providerName: q.providerName, weight: q.weight, matchMicroUsd: q.matchMicroUsd },
        formats: q.formats,
        ratings: q.formats.map(fresh),
        status: "active",
        version: 1,
        createdAt: NOW,
        updatedAt: NOW,
        scenario: body.scenario,
        key: { state: "quiet", limitUsd: null, reset: null },
      };
      garages.set(body.slot, agent);
      return json(route, 201, { agent });
    }
    return json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } });
  });
}

const browser = await chromium.launch({ ...(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [];

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|api\/city/.test(m.text()) && errors.push(m.text()));
  await fixtures(page);
  const shot = (state) => page.screenshot({ path: path.join(out, `ring-${state}-${s.name}.png`) });
  const widths = [];
  const overflow = async () => widths.push(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  const settle = async (selector) => {
    await page.waitForFunction((sel) => {
      const d = document.querySelector(sel);
      return !!d && d.getAnimations().every((a) => a.playState === "finished" || a.effect?.getTiming().iterations === Infinity);
    }, selector, { timeout: 30_000 });
    await page.waitForTimeout(500);
  };
  // A plot's sheet through the dev-only store hook, as the quarter's own shots open it.
  const tap = async (slot) => {
    await page.evaluate((n) => window.__quarter.getState().pick(n), slot);
    await settle('[role="dialog"]');
  };

  // My quarter without a wallet in this browser: the dev-only store hook names the account (the world's answer is the
  // fixture above) and flies into build mode, as a signed-in resident's «Build» does.
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => !!window.__quarter, null, { timeout: 120_000 });
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: /^(Later|Close the Arrivals card)$/ }).click({ timeout: 4000 }).catch(() => {});
  await page.evaluate(() => window.__quarter.getState().setOwner("wallet:review"));
  await page.waitForFunction(() => window.__quarter.getState().status === "resident", null, { timeout: 30_000 });
  await page.evaluate(() => window.__quarter.getState().enter());
  await page.waitForFunction(() => window.__quarter.getState().mode === "build", null, { timeout: 60_000 });
  await page.waitForTimeout(2500);

  await tap(2);
  await page.getByText("Your agent lives here").waitFor({ timeout: 20_000 });
  await overflow();
  await shot("garage-empty");

  await page.getByRole("button", { name: "Make an agent" }).click();
  await settle('[role="dialog"][aria-label="Agent"]');
  await page.getByRole("radio", { name: "Tactician" }).click();
  await page.waitForTimeout(500);
  await overflow();
  await shot("body");

  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("tab", { name: /Middle/ }).waitFor({ timeout: 20_000 });
  await page.getByRole("tab", { name: /Middle/ }).click();
  await page.getByRole("button", { name: /Anthropic Sonnet 5\.5/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: /Anthropic Sonnet 5\.5/ }).getByText("Market Replay").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await overflow();
  await shot("brain");

  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByLabel("Script").fill("Plan three moves ahead and say only what moves the game.\nNever repeat a move that failed. Read the other side's last answer twice before you act.\nIn code: smallest change that passes, then stop.");
  await page.waitForTimeout(400);
  await overflow();
  await shot("script");

  await page.getByRole("button", { name: "Make agent" }).click();
  await page.getByRole("dialog", { name: "Agent" }).waitFor({ state: "detached", timeout: 20_000 });
  await page.getByText("Tactician 9F2A").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await overflow();
  await shot("agent");

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(500);
  await tap(3);
  await page.getByText("Guardian C41B").waitFor({ timeout: 20_000 });
  await overflow();
  await shot("veteran");

  if (Math.max(...widths) > 0) problems.push(`${s.name}: the page scrolls sideways by ${Math.max(...widths)} px`);
  if (errors.length) problems.push(`${s.name}: ${errors.join(" | ").slice(0, 1500)}`);
  await context.close();
}

await browser.close();
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : `no problems; shots in ${out}`);
