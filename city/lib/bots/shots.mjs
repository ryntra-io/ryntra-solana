// The bots window's screens for review (B4; Ryntra's tools in it — CITY-133), at 1440×900 and 375×812 → <out>/bots-<state>-<lang>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open npm run dev -- -p 3137      then      node city/lib/bots/shots.mjs [out] [baseUrl]
//   LANGS=uk,en  SIZES=1440,375  STATES=deck,hub,detail,…  narrow it down.
// The window is opened as a person opens it: the Deck's «Agents» diamond, then its «Bots» door. Every figure here is a
// fixture: the city's read is the bundled snapshot served as a live read stamped now, the candles are the review's
// sample week of each coin (demo.ts) served as the engine's answer, the hangar and the shared strategies are the review
// stand, and the wallet's bots on the chain are the engine's Hangar answer for a review wallet. Ryntra's answers
// (`POST /api/v1/assistant/bots`) are the assistant line's real tools run on those same fixtures — the sample week for
// the hour, a drawn month and half-year for the longer windows. Paper only: no wallet, no keys, nothing signs.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { botsDemo, chainDemo, hashOf, sampleBars } from "./demo.ts";
import { syntheticCandles } from "../../../lib/assistant/bots/fixtures.ts";
import { BotsToolRequestSchema } from "../../../lib/assistant/bots/schema.ts";
import { runBotsTool } from "../../../lib/assistant/bots/tools.ts";
import { lotOf } from "../quarter/plot.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-134");
const base = process.argv[3] ?? "http://localhost:3137";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const ALL = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "375", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const STATES = process.env.STATES ? new Set(process.env.STATES.split(",")) : null;
const want = (state) => !STATES || STATES.has(state);

const byId = new Map(SNAPSHOT.towers.map((t) => [t.id, t]));
const coin = (symbol) => {
  const t = SNAPSHOT.towers.find((x) => x.symbol === symbol && x.verified);
  return { mint: t.id, symbol: t.symbol, price: t.price };
};
const COINS = { sol: coin("SOL"), jup: coin("JUP"), bonk: coin("KMNO") };

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route("**/api/spot/candles?*", (route) => {
      const url = new URL(route.request().url());
      const t = byId.get(url.searchParams.get("mint"));
      if (!t) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      const bars = sampleBars(t.id, t.price, t.change24h, Math.floor(Date.now() / 3_600_000) * 3_600_000);
      return json(route, {
        timeframe: url.searchParams.get("tf"),
        candles: bars.map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })),
        observedAt: new Date().toISOString(),
        source: { label: "GeckoTerminal" },
      });
    });
    // Ryntra's tools, run for real on the review's fixtures: the hour is the window's own sample week.
    const readers = {
      candles: async (mint, timeframe) => {
        const t = byId.get(mint);
        if (!t) return null;
        const end = Math.floor(Date.now() / 3_600_000) * 3_600_000;
        const candles = timeframe === "1h" ? sampleBars(t.id, t.price, t.change24h, end) : syntheticCandles({ price: t.price, shape: "range", timeframe, endMs: end, seed: hashOf(t.id) });
        return { candles, observedAt: new Date().toISOString(), stale: false };
      },
      symbol: async (mint) => byId.get(mint)?.symbol ?? null,
      hangar: async (wallet) => {
        const answer = chainDemo(COINS, Date.now());
        return answer.wallet === wallet ? answer : null;
      },
    };
    await context.route("**/api/v1/assistant/bots", async (route) => {
      const parsed = BotsToolRequestSchema.safeParse(route.request().postDataJSON());
      if (!parsed.success) return json(route, { error: { code: "VALIDATION_ERROR", message: "body" } }, 400);
      return json(route, await runBotsTool(parsed.data, readers));
    });
    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__openBots === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 300_000 });
    await page.waitForTimeout(4_000);
    // The quarter's invitation card stands over the workspace's corner: put off for this visit, as a person would.
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    const win = page.locator("[data-window='bots']");

    // The way in: the Deck's «Agents» diamond opens its tray, «Bots» opens the window.
    await page.locator("[data-deck-place='agents']").click();
    await page.locator("[data-deck-tray='agents']").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    if (want("deck")) {
      const file = `bots-deck-tray-${lang}-${size.name}.jpg`;
      await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 80, timeout: 180_000 });
      report.push({ size: size.name, lang, state: "deck-tray", file, selected: null });
    }
    await page.locator("[data-deck-door='bots']").click();
    await win.first().waitFor({ timeout: 120_000 });
    await page.locator("[data-window='bots'] [data-tab]").first().waitFor({ timeout: 240_000 });
    await page.waitForFunction(() => typeof window.__bots?.setState === "function", null, { timeout: 120_000 });
    const seed = botsDemo(COINS, Date.now());
    const chain = chainDemo(COINS, Date.now());
    await page.evaluate(
      ({ seed, chain }) => {
        window.__bots.setState({ ...seed, hydrated: true, page: { kind: "home" }, focus: null, notice: null, mint: null, chain: { status: "ready", wallet: chain.wallet, answer: chain } });
        const running = seed.bots.filter((b) => b.stoppedAt === null && b.spans.length && b.spans[b.spans.length - 1][1] === null).length;
        window.__botsWindow.setState({ counted: true, running });
      },
      { seed, chain },
    );
    const shot = async (state) => {
      await page.waitForTimeout(1_200);
      // Two frames painted after the change: the software GPU here can show the tab row a step behind otherwise.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.waitForTimeout(400);
      const file = `bots-${state}-${lang}-${size.name}.jpg`;
      // The city renders on a software GPU here; a frame that does not come in time is asked for again.
      for (let tries = 1; ; tries += 1) {
        try {
          await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 80, timeout: 180_000 });
          break;
        } catch (error) {
          if (tries >= 3) throw error;
          await page.waitForTimeout(5_000);
        }
      }
      const selected = await page.evaluate(() => document.querySelector("[data-window='bots'] [role='tab'][aria-selected='true']")?.textContent ?? null);
      report.push({ size: size.name, lang, state, file, selected });
    };
    const act = (fn, arg) => page.evaluate(fn, arg);
    const openTab = async (tab) => {
      await act((tab) => window.__openBots(tab), tab);
      await win.first().waitFor({ timeout: 120_000 });
      // The window's contents load with it: wait for them, never shoot the frame while they arrive.
      await page.locator("[data-window='bots'] [data-tab]").first().waitFor({ timeout: 240_000 });
      await full();
    };
    // The window over the city first; then on the whole screen (macet M3), where every state is shot — on the phone the
    // sheet takes the screen.
    let fullDone = false;
    const full = async () => {
      if (fullDone) return;
      fullDone = true;
      // The frame speaks the city's language (CITY-79).
      await page.getByRole("button", { name: /^(Full screen|На весь екран)$/ }).first().click();
      await page.waitForTimeout(600);
    };
    const scrollBody = (y) => page.locator("[data-window='bots'] [data-tab]").first().evaluate((el, y) => el.scrollTo(0, y), y);

    if (want("hub")) {
      await page.waitForFunction(() => Object.values(window.__bots.getState().paths).some((p) => p.status === "ready"), null, { timeout: 240_000 });
      if (!size.mobile) await shot("hub-city");
      await full();
      await shot("hub");
      if (size.mobile) {
        await scrollBody(560);
        await shot("hub-catalogue");
        await scrollBody(1400);
        await shot("hub-scout");
        await scrollBody(0);
      }
    }
    if (want("flow")) {
      await openTab("launch");
      await act(() => window.__bots.getState().startFlow("swings"));
      await shot("flow-2-recommended");
      if (size.mobile) {
        await scrollBody(700);
        await shot("flow-2-recommended-more");
        await scrollBody(0);
      }
      await act(() => {
        const st = window.__bots.getState();
        const towers = window.__city.getState().snapshot.towers;
        const t = towers.find((x) => x.symbol === "SOL");
        st.useRecommended({ mint: t.id, symbol: t.symbol, price: t.price });
      });
      await shot("flow-3-confirm");
      if (size.mobile) {
        await scrollBody(900);
        await shot("flow-3-confirm-start");
        await scrollBody(0);
      }
      await act(() => window.__bots.getState().startFlow("accumulate"));
      await shot("flow-2-accumulate");
      await act(() => window.__bots.getState().go({ kind: "home" }));
    }
    if (want("detail")) {
      await openTab("launch");
      // The draft takes its range from the week's weather: the week is read first.
      await page.waitForFunction(() => Object.values(window.__bots.getState().paths).some((p) => p.status === "ready"), null, { timeout: 240_000 });
      await act(() => {
        const t = window.__city.getState().snapshot.towers.find((x) => x.symbol === "SOL");
        window.__bots.getState().openKind("grid", { mint: t.id, symbol: t.symbol, price: t.price });
      });
      await shot("detail-grid");
      if (size.mobile) {
        await scrollBody(640);
        await shot("detail-grid-more");
        await scrollBody(1500);
        await shot("detail-grid-start");
        await scrollBody(0);
      }
      await act(() => {
        const t = window.__city.getState().snapshot.towers.find((x) => x.symbol === "JUP");
        window.__bots.getState().openKind("recurring", { mint: t.id, symbol: t.symbol, price: t.price });
      });
      await shot("detail-recurring");
      await act(() => window.__bots.getState().go({ kind: "home" }));
    }
    if (want("ryntra")) {
      await openTab("launch");
      await act(() => window.__bots.getState().go({ kind: "home" }));
      const card = page.locator("[data-window='bots'] [data-bots-ryntra]").first();
      await card.waitFor({ timeout: 120_000 });
      await page.waitForFunction(() => document.querySelector("[data-window='bots'] [data-bots-ryntra]")?.getAttribute("aria-busy") === "false", null, { timeout: 120_000 });
      await shot("ryntra");
      // «Details»: the reasons, the alternative and the replay over 7, 30 and 180 days.
      await card.locator("button[aria-controls]").first().click();
      await page.waitForFunction(() => !document.querySelector("[data-window='bots'] [data-bots-ryntra] [aria-busy='true']"), null, { timeout: 120_000 });
      await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await shot("ryntra-details");
      if (size.mobile) {
        await scrollBody(await card.evaluate((el) => el.offsetTop + 420));
        await shot("ryntra-details-replay");
      }
      // «Set it up for me»: Ryntra's draft opens in the window's own review.
      await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await card.locator("button[aria-busy]").first().click();
      await page.waitForFunction(() => window.__bots.getState().page.kind === "detail", null, { timeout: 60_000 });
      await scrollBody(0);
      await shot("ryntra-draft");
      await act(() => window.__bots.getState().go({ kind: "home" }));
    }
    if (want("ryntra-why")) {
      await openTab("hangar");
      await page.locator("[data-window='bots'] [data-bots-ryntra-report]").first().waitFor({ timeout: 120_000 });
      await page.locator("[data-window='bots'] [data-bots-why]").first().click();
      await page.waitForFunction(() => !document.querySelector("[data-window='bots'] [data-bots-why] + div [aria-busy='true']"), null, { timeout: 60_000 });
      await shot("ryntra-why");
    }
    if (want("hangar")) {
      await openTab("hangar");
      await act(() => window.__bots.getState().focusBot(window.__bots.getState().bots[0].id));
      await shot("hangar");
      if (size.mobile) {
        await scrollBody(700);
        await shot("hangar-practice");
        await scrollBody(0);
      }
    }
    if (want("strategies")) {
      await openTab("strategies");
      await shot("strategies");
    }
    if (want("history")) {
      await openTab("history");
      await shot("history");
    }
    if (want("drones") && !size.mobile && lang === LANGS[0]) {
      // The running paper bots as drones over a quarter of the person's own: a quarter is put in the store as the world
      // would answer it, and the camera stands near it (the development hook `__cityView`).
      await act(() => window.__botsWindow.getState().close());
      const lot = lotOf({ x: 0, z: 0 });
      await act(({ lot }) => {
        const at = new Date().toISOString();
        const quarter = { id: "q-review", ownerId: "r-review", district: "arrivals", street: "0", cell: { x: 0, z: 0 }, level: 1, version: 1, updatedAt: at };
        window.__quarter.setState({ status: "resident", me: { resident: { id: "r-review" }, quarter, buildings: [], quarters: [quarter], points: { total: 0, recent: [] }, tasks: [] } });
        window.__cityView([lot.x + 16, 15, lot.z + 20], [lot.x, 7, lot.z]);
      }, { lot });
      await page.waitForTimeout(3_000);
      await shot("drones");
      await act(() => window.__cityView(null));
    }
    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
