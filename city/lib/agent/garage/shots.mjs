// The garage agent (CITY-29) for review: a desk at 1440×900 and a phone at 375×812, in English and Ukrainian →
// <out>/garage-<state>-<lang>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_GARAGE=open NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open npm run dev
//   node city/lib/agent/garage/shots.mjs [out] [baseUrl]      (SIZES=1440,375 LANGS=en,uk STATES=… PRESS_CHROME=…)
// Everything answers from fixtures through Playwright's routing, so the screens are the same on every machine: the
// world (a quarter with a garage and a coin tower), the city's saved market read served as a fresh live one, the
// beacons and the agent's kept read on the device, and one answer of Ryntra's guest seam. Every figure in them is a
// fixture for review, not a market figure.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-29");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "375", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const STATES = process.env.STATES ? new Set(process.env.STATES.split(",")) : null;
const want = (state) => !STATES || STATES.has(state);

const saved = JSON.parse(readFileSync(new URL("../../market/snapshot.json", import.meta.url), "utf8"));
const byId = new Map(saved.towers.map((t) => [t.id, t]));
const bare = (symbol) => symbol.replace(/^\$/, "").toUpperCase();
const bySymbol = (symbol) => saved.towers.find((t) => bare(t.symbol) === bare(symbol) && t.verified);
const SOL = "So11111111111111111111111111111111111111112";
const pick = (...symbols) => symbols.map(bySymbol).find(Boolean);
const LEAD = pick("FARTCOIN", "PENGU").id;
const WIF = pick("WIF", "BONK").id;
const BIRB = pick("BIRB", "POPCAT").id;

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const quarter = { id: "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f", ownerId: "0f1e2d3c-4b5a-4968-8776-655443322110", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level: 5, version: 12, updatedAt: iso(NOW) };
const b = (slot, kind, level, modules, link = null) => ({ id: `00000000-0000-4000-8000-00000000000${slot}`, quarterId: quarter.id, slot, kind, level, modules, link, updatedAt: iso(NOW) });
const me = {
  resident: { id: quarter.ownerId, accountId: null, displayName: null, homeQuarterId: quarter.id, createdAt: iso(NOW) },
  quarter,
  buildings: [
    b(0, "workshop", 2, ["base.brick", "floor.brick", "light.lantern", "sign.plain"]),
    b(1, "home", 3, ["base.brick", "floor.brick", "floor.glass", "roof.flat", "light.lantern", "sign.plain"]),
    b(2, "garage", 3, ["base.stone", "floor.concrete", "roof.antenna", "light.amber"]),
    b(4, "oracle", 2, ["base.stone", "floor.glass", "light.amber"]),
    b(6, "coin_tower", 3, ["base.stone", "floor.concrete", "floor.glass", "light.amber"], { kind: "mint", mint: LEAD }),
  ],
  quarters: [quarter],
  points: { total: 260, recent: [] },
  tasks: [],
};

// The beacons on this device: one fired twelve minutes ago, one on SOL waiting, one that ends tonight.
const frame = (id, mint, over = {}) => ({ id, mint, symbol: byId.get(mint)?.symbol ?? "SOL", version: 1, createdAt: NOW - 86_400_000, groups: [[{ kind: "price", op: "below", value: 1 }]], holdSeconds: 0, hysteresis: 0.02, cooldownSeconds: 3600, repeat: true, expiresAt: null, quiet: null, notify: false, on: true, ...over });
const beacons = {
  rules: [frame("birbdrop", BIRB), frame("solwatch", SOL, { groups: [[{ kind: "price", op: "above", value: 140 }]] }), frame("wifnight", WIF, { expiresAt: NOW + 5 * 3600_000 })],
  states: { birbdrop: { version: 1, state: { armed: false, since: NOW - 13 * 60_000, firedAt: NOW - 12 * 60_000, seen: true }, spent: false } },
};
// What the agent kept of your towers when you last looked, three hours ago.
const mark = (id, priceShare, liquidityShare = 1) => [id, { price: byId.get(id).price / priceShare, liquidity: byId.get(id).liquidity / liquidityShare, at: NOW - 3 * 3600_000 }];
const garage = {
  settings: { name: "Nova", topics: { moves: true, liquidity: true, beacons: true, scout: true }, on: true },
  marks: Object.fromEntries([mark(LEAD, 1.064), mark(SOL, 1.006, 0.86), mark(WIF, 0.952)]),
  ledger: { day: iso(NOW).slice(0, 10), spent: 0, seam: null },
};

// Ryntra's answer is about the person's own towers: the beacon that fired and SOL beside it.
const B = byId.get(BIRB).symbol;
const TEXT = {
  en: {
    observation: `${B} slid 14% today while SOL held flat.`,
    meaning: `The drop is ${B}'s own, not the market's.`,
    checks: [`Watch whether ${B}'s pool holds as the price falls.`, "SOL's pool got thinner: wider spreads on big swaps."],
    risks: ["Thin books move fast both ways."],
  },
  uk: {
    observation: `${B} сьогодні −14%, SOL тримається рівно.`,
    meaning: `Падіння — власне в ${B}, не ринку.`,
    checks: [`Стеж, чи тримається пул ${B}, поки ціна падає.`, "Пул SOL став тоншим: ширші спреди на великих обмінах."],
    risks: ["Тонкі книги швидко рухаються в обидва боки."],
  },
};
const answer = (lang) => ({
  person: { role: "person", text: "q", cards: [], citations: [] },
  ryn: {
    text: TEXT[lang].observation,
    cards: [],
    citations: [{ source: "Jupiter", observedAt: iso(NOW - 60_000) }],
    answer: {
      observation: [{ text: TEXT[lang].observation }],
      meaning: [{ text: TEXT[lang].meaning }],
      checks: TEXT[lang].checks.map((text) => ({ text })),
      risks: TEXT[lang].risks.map((text) => ({ text })),
      counter: [],
    },
    refusal: null,
  },
  guest: { day: { used: 2, allowance: 6, resetsAt: iso(NOW + 8 * 3600_000) }, model: "configured", needsWallet: false },
});

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function fixtures(context, lang) {
  await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, 200, { ...saved, source: "live", fetchedAt: iso(Date.now()) }));
  await context.route("**/api/world/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/world/me") return json(route, 200, me);
    return json(route, 404, { error: { code: "NOT_FOUND", message: "fixture" } });
  });
  // Coin pictures come from Jupiter, which a cloud sandbox cannot reach: each coin shows its letter instead.
  await context.route("**/api/icon/**", (route) => route.fulfill({ status: 404, body: "" }));
  await context.route("**/api/v1/assistant/guest", async (route) => {
    // Ryntra takes a moment: long enough to see the agent think.
    await new Promise((r) => setTimeout(r, 6_000));
    return json(route, 200, answer(lang));
  });
  await context.addInitScript(
    ([b, g]) => {
      localStorage.setItem("ryntra.city.beacons.v1", JSON.stringify(b));
      if (!sessionStorage.getItem("garage-seeded")) {
        localStorage.setItem("ryntra.city.garage.v1", JSON.stringify(g));
        sessionStorage.setItem("garage-seeded", "1");
      }
    },
    [beacons, garage],
  );
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const s of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|status of 404/.test(m.text()) && errors.push(m.text()));
    await fixtures(context, lang);

    const shot = async (state, clip) => {
      await page.waitForTimeout(1_200);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.waitForTimeout(400);
      const file = `garage-${state}-${lang}-${s.name}.jpg`;
      for (let tries = 1; ; tries += 1) {
        try {
          await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, timeout: 180_000, ...(clip ? { clip } : {}) });
          break;
        } catch (error) {
          if (tries >= 3) throw error;
          await page.waitForTimeout(5_000);
        }
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      report.push({ size: s.name, lang, state, file, overflow });
    };
    const win = () => page.locator("[data-window='garage']");

    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => window.__city?.getState().snapshot.source === "live" && !!window.__garage && !!window.__quarter, null, { timeout: 300_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter.setState({ later: true }));
    // Software WebGL draws the city's first frames slowly: the Deck's shot waits until the skyline is on the screen.
    await page.waitForFunction(() => !!document.querySelector("canvas"), null, { timeout: 300_000 });
    await page.waitForTimeout(s.mobile ? 30_000 : 25_000);

    // The Deck's «Agents» tray: Hangar · Bots · Garage.
    // The diamond breathes while the city is idle: a tap does not wait for it to stand still.
    await page.locator("[data-deck-place='agents']").click({ force: true, timeout: 60_000 }).catch(async (error) => {
      const state = await page.evaluate(() => ({ deck: !!document.querySelector("[data-city-deck]"), places: document.querySelectorAll("[data-deck-place]").length, quarter: window.__quarter?.getState().mode, windows: [...document.querySelectorAll("[data-window]")].map((w) => w.getAttribute("data-window")), dialogs: [...document.querySelectorAll("[role='dialog']")].map((d) => d.getAttribute("aria-label")) })).catch(() => null);
      await page.screenshot({ path: path.join(process.env.TMPDIR ?? "/tmp", `garage-fail-${lang}-${s.name}.png`), timeout: 120_000 }).catch(() => {});
      throw new Error(`${lang}-${s.name}: the Deck's «Agents» did not take the tap — ${JSON.stringify(state)}\n${error.message.split("\n")[0]}`);
    });
    await page.locator("[data-deck-tray='agents']").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    if (want("deck")) await shot("deck");

    // The «Garage» door: the agent's window in a bay beside the city (a phone's sheet), its report ready.
    await page.locator("[data-deck-door='garage']").click({ force: true });
    await win().first().waitFor({ timeout: 60_000 });
    await win().locator("[data-garage-report]").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(s.mobile ? 4000 : 2500);
    if (want("report")) await shot("report");

    await win().locator("[data-garage-action='ask']").click();
    await page.waitForTimeout(1200);
    if (want("thinking")) await shot("thinking");
    await win().locator("[data-garage-advice]").waitFor({ timeout: 90_000 });
    await win().locator("[data-garage-details]").click();
    await page.waitForTimeout(400);
    await win().locator("[data-garage-left]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    if (want("advice")) await shot("advice");

    // Show: the camera flies to the towers and they light; beside a bay the window stays, over a phone it steps aside.
    await win().locator("[data-garage-action='show']").click();
    await page.waitForTimeout(s.mobile ? 12_000 : 9_000);
    if (want("show")) await shot("show");
    if (s.mobile) {
      await page.locator("[data-garage-chip] button").first().click();
      await win().first().waitFor({ timeout: 20_000 });
    }

    await win().locator("[data-garage-gear]").click();
    await page.waitForTimeout(800);
    if (want("settings")) await shot("settings");

    // The quarter: the agent at its garage's door; a tap on the garage opens its window too.
    if (want("quarter")) {
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.__garage.getState().close());
      await page.waitForTimeout(800);
      // My quarter without a wallet in this browser: the dev-only store hook names the account (the world's answer is
      // the fixture above) and flies into build mode, as a signed-in resident's «Build» does.
      await page.evaluate(() => {
        const q = window.__quarter;
        const setOwner = q.getState().setOwner;
        q.setState({ setOwner: (owner) => (owner === null || owner === undefined ? Promise.resolve() : setOwner(owner)) });
        return q.getState().setOwner("wallet:review");
      });
      await page.waitForFunction(() => window.__quarter.getState().status === "resident", null, { timeout: 30_000 });
      await page.evaluate(() => window.__quarter.getState().enter());
      await page.waitForFunction(() => window.__quarter?.getState().mode === "build", null, { timeout: 60_000 });
      await page.waitForTimeout(s.mobile ? 10_000 : 12_000);
      await shot("quarter");
      // The agent at its garage, close (a computer: a phone's camera stands too far back for a frame of one plot).
      if (!s.mobile) {
        await page.mouse.move(s.width / 2, s.height / 2);
        for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
        await page.waitForTimeout(8000);
        const at = await page.evaluate(() => window.__quarterPlot?.(2) ?? null);
        if (at) {
          const w = 560;
          const h = 420;
          const x = Math.max(0, Math.min(s.width - w, at.x - w / 2));
          const y = Math.max(0, Math.min(s.height - h, at.y - h * 0.62));
          await shot("agent", { x, y, width: w, height: h });
        }
      }
      await page.evaluate(() => window.__quarter.getState().pick(2));
      await win().first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(s.mobile ? 6000 : 4000);
      await shot("garage-tap");
    }

    report.push({ size: s.name, lang, errors: errors.slice(0, 3).map((e) => e.slice(0, 400)) });
    await context.close();
  }
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
