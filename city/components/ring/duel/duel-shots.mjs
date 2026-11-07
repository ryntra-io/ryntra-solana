// Ryntra City, the Ring's duels (CITY-51): the Arena's «Ring» window over the live city — a Duo Crack while it is live,
// the same duel over with «Details», and Market Replay when there is no market history to replay — at 1440×900 and
// 390×844, in English and Ukrainian → <out>/<lang>-<size>-<state>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_RING=open NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS=open npm run dev
//   node city/components/ring/duel/duel-shots.mjs [out] [baseUrl]      (PRESS_CHROME may point at a Chromium)
// A start needs an account signed in with a wallet, so the duels are played here, in this script, by the real service of
// lib/ring/duel — the same engine, harness and judge — between the house's sparring agents, and handed to the page
// through Playwright's routing. Nothing on the window is drawn by hand. Market Replay gets no candles here (no
// market-data gateway in this machine), so its shot is the honest «no history» state, never made-up bars.
import "../../../../lib/world/testing/hooks.mjs";
import { chromium } from "playwright";
import { generateKeyPairSync, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

const { createDuelService, createMemoryDuelStore, viewOf } = await import("../../../../lib/ring/duel/service.ts");
const { createStamper, signerOf, stampVerifier } = await import("../../../../lib/ring/judge/index.ts");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-51");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

/** One real house-vs-house Duo Crack, with every state the store saw on the way. */
async function playCrack() {
  const store = createMemoryDuelStore();
  const states = [];
  const kept = { ...store, put: async (record) => (states.push(structuredClone(record)), store.put(record)) };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const tasks = [];
  const service = createDuelService({
    store: kept,
    agents: { agent: async () => null, ratings: async () => [] },
    brain: async () => null,
    candles: async () => null,
    stamp: createStamper(privateKey),
    verifyStamp: stampVerifier([signerOf(publicKey)]),
    now: Date.now,
    randomInt: (n) => randomInt(n),
    newId: () => "duel-review-1",
    background: (task) => tasks.push(task),
  });
  const started = await service.start("review", { format: "duo-crack", agent: "wall", opponent: "chatty" });
  if (!started.ok) throw new Error(`the duel did not start: ${started.code}`);
  await Promise.all(tasks);
  const done = states.at(-1);
  if (done.status !== "done") throw new Error(`the duel ended ${done.status}`);
  const live = states.find((s) => s.status === "live" && s.log.entries.length === 4);
  return { live: viewOf(live), done: viewOf(done) };
}

const crack = await playCrack();
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch({ ...(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [];

for (const lang of LANGS) {
  for (const s of SIZES) {
    const context = await browser.newContext({ locale: lang === "uk" ? "uk-UA" : "en-US", viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
    await context.addInitScript((l) => window.localStorage.setItem("ryntra.city.lang", l), lang);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|api\/city|api\/world/.test(m.text()) && errors.push(m.text()));
    let phase = "live";
    await page.route("**/api/ring/**", (route) => {
      const url = new URL(route.request().url());
      const action = url.pathname.split("/").pop();
      if (action === "fight") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        if (body.format === "market-replay") return json(route, 503, { error: { code: "MARKET_UNAVAILABLE", message: "No market history to replay right now." } });
        return json(route, 202, { duel: phase === "live" ? crack.live : crack.done });
      }
      if (action === "duel") return json(route, 200, { duel: phase === "live" ? crack.live : crack.done });
      return route.continue();
    });
    const shot = (state) => page.screenshot({ path: path.join(out, `${lang}-${s.name}-${state}.jpg`), type: "jpeg", quality: 84 });
    const overflow = async () => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) problems.push(`${lang} ${s.name}: the page scrolls sideways by ${wide} px`);
    };

    await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => !!window.__duels, null, { timeout: 180_000 });
    await page.waitForTimeout(7000);
    await page.getByRole("button", { name: /^(Later|Пізніше|Close the Arrivals card|Закрити картку Прибуття)$/ }).click({ timeout: 4000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});

    // The Arena's «Ring» door: its only open door, so the place opens it straight away.
    const arena = page.getByRole("button", { name: lang === "uk" ? /^Арена$/ : /^Arena$/ });
    await arena.click({ timeout: 10_000 });
    const tab = page.getByRole("tab", { name: lang === "uk" ? "Дуо-злам" : "Duo Crack" });
    await tab.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await overflow();
    await shot("1-ready");

    await page.getByRole("button", { name: lang === "uk" ? "У бій" : "Fight" }).click();
    await page.getByText(lang === "uk" ? "Раунд 4/10" : "Round 4/10").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(900);
    await overflow();
    await shot("2-live");

    phase = "done";
    await page.evaluate(() => window.__duels.getState().read());
    await page.getByRole("button", { name: lang === "uk" ? "Деталі" : "Details" }).waitFor({ timeout: 20_000 });
    const beats = page.locator("ol > li button");
    await beats.first().click();
    await page.waitForTimeout(700);
    await overflow();
    await shot("3-over");

    await page.getByRole("button", { name: lang === "uk" ? "Деталі" : "Details" }).click();
    await page.waitForTimeout(500);
    await overflow();
    await shot("4-details");

    await page.getByRole("tab", { name: lang === "uk" ? "Повтор ринку" : "Market Replay" }).click();
    await page.getByRole("button", { name: lang === "uk" ? "У бій" : "Fight" }).click();
    await page.locator('p[role="alert"]').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await overflow();
    await shot("5-market-none");

    if (errors.length) problems.push(`${lang} ${s.name}: ${errors.join(" | ").slice(0, 1500)}`);
    await context.close();
  }
}

await browser.close();
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : `no problems; shots in ${out}`);
