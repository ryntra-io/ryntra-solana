// CITY-204 for review: the money autopilot's card — the sentence in the command line, one plan for the whole budget, its
// details, the practice on paper, the agent at work with the week's figure, and its pause when SOL fell — on a desk
// (1440×900) and a phone (390×844), in English and Ukrainian → <out>/<lang>-<size>-<n>-<step>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_PILOT=open NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet npm run dev -- -p 3204
//   node city/lib/pilot/shots.mjs [out] [baseUrl]          LANGS=en,uk  SIZES=desk,phone
//
// Every figure is a fixture: the city's read is the bundled snapshot; the run on history, the savings' rates, the wallet
// and the autopilot's book answer fixtures. The wallet is a public address seated in the store: nothing signs.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-204");
const base = process.argv[3] ?? "http://localhost:3204";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const WALLET = "Rev1ewWa11etPub1icAddress1111111111111111111";
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const SAY = {
  en: "work with my 2 SOL and 100 USDC: some into savings, trade BONK and JUP, some into pools",
  uk: "працюй з моїми 2 SOL і 100 USDC: частину в скарбничку, частину торгуй BONK і JUP, частину в пули",
};

const now = Date.now();
const HOUR = 3_600_000;
const HISTORY = { bars: 288, fromMs: now - 12 * 24 * HOUR, toMs: now, buys: 9, sells: 0, spentSol: 0.18, gotSol: 0, heldSol: 0.1872, resultPct: 3.4, holdPct: -2.1, worstPct: -5.2, exit: null, paused: null, trades: [] };
const EARN = {
  providers: [{ provider: "jupiter", ok: true, markets: [{ provider: "jupiter", id: "USDC", asset: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 }, share: { mint: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", symbol: "jlUSDC", decimals: 6 }, rateAnnualPercent: 5.36, suppliedRaw: null, liquidRaw: null, minimumRaw: "1000000", priceUsd: 1, readAt: new Date().toISOString() }, { provider: "jupiter", id: "SOL", asset: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 }, share: { mint: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", symbol: "jlSOL", decimals: 9 }, rateAnnualPercent: 3.7, suppliedRaw: null, liquidRaw: null, minimumRaw: "10000000", priceUsd: 160, readAt: new Date().toISOString() }] }],
  positions: [],
  actions: { open: true, mode: "OPEN", maxUsd: null },
  feeBps: 0,
  readAt: new Date().toISOString(),
};
const PLAN = {
  v: 1,
  legs: { trade: { solRaw: "110000000" }, save: { solRaw: "735000000", usdcRaw: "100000000" }, pool: { solRaw: "570000000" }, reserve: { solRaw: "585000000", usdcRaw: "0" } },
  shares: { trade: 422, save: 6656, pool: 2189, reserve: 733 },
  preset: "small",
  rules: { bandBps: 1000, crashBps: 1000 },
};
const pilotView = (extra) => ({
  network: "mainnet",
  status: "working",
  said: SAY.en,
  plan: PLAN,
  policy: "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3",
  legs: { saveUsdc: { asset: "USDC", raw: "100000000", signature: "s1", state: "landed" }, saveSol: { asset: "SOL", raw: "735000000", signature: "s2", state: "landed" }, pool: { asset: "SOL", raw: "570000000", signature: "s3", state: "landed", position: "P", pool: "Q" } },
  held: null,
  care: { at: now - 10 * 60_000, shares: { trade: 451, save: 6640, pool: 2176, reserve: 733 }, earnedUsd: 4.87, weekUsd: 4.87, solUsd: 156, fallBps: 120 },
  events: [{ at: now - 3 * 86_400_000, what: "start" }],
  createdAt: now - 3 * 86_400_000,
  ...extra,
});

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-shader-disk-cache", ...(process.env.PRESS_CACHE ? [`--disk-cache-dir=${process.env.PRESS_CACHE}`] : [])] });
const report = [];
for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const step = (what) => console.log(`${new Date().toISOString().slice(11, 19)} ${size.name} ${lang} ${what}`);
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(String(e));
      step(`page error: ${String(e).slice(0, 160)}`);
    });
    let view = null;
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route(/\/api\/bots\/mandate\/test/, (route) => json(route, { ok: true, mode: "history", timeframe: "1h", result: HISTORY }));
    await context.route(/\/api\/solana\/earn(\?.*)?$/, (route) => json(route, EARN));
    await context.route(/\/api\/bots\/pilot/, (route) => (view ? json(route, view) : json(route, { error: { code: "NO_PILOT" } }, 404)));
    await context.route(/\/api\/solana\/holdings/, (route) =>
      json(route, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2415000000", spendableRaw: "2405000000", decimals: 9, symbol: "SOL" }, { kind: "SPL", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "120000000", spendableRaw: "120000000", decimals: 6, symbol: "USDC" }] } }),
    );

    let n = 0;
    const shot = async (name) => {
      await page.waitForTimeout(1_200);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.waitForTimeout(400);
      n += 1;
      const file = `${lang}-${size.name}-${n}-${name}.jpg`;
      await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, timeout: 180_000 });
      report.push({ size: size.name, lang, name, file });
      step(`shot ${name}`);
    };

    step("open the city");
    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__openCommand === "function" && typeof window.__pilot?.setState === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 600_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    await page.evaluate((wallet) => {
      window.__autopilotMandate.setState({ hydrated: true, records: {}, status: {}, busy: null, note: null, preset: "small" });
      window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] }, holdings: null, holdingsRead: "none" });
    }, WALLET);

    // 1 · the sentence in the command line: the autopilot's row on top.
    await page.evaluate(() => window.__openCommand());
    const field = page.locator("[data-city-command] input").first();
    await field.waitFor({ timeout: 60_000 });
    await field.fill(SAY[lang]);
    await page.waitForTimeout(800);
    await shot("sentence");
    await page.keyboard.press("Enter");
    // 2 · one plan for the whole budget: the parts as one bar, one honest line, one button.
    await page.locator("[data-pilot-split]").waitFor({ timeout: 300_000 });
    await shot("plan");
    // 3 · the rest behind «Details».
    await page.locator("[data-pilot-details]").click();
    await page.waitForTimeout(400);
    await page.locator("[data-pilot-details] ~ div li").last().scrollIntoViewIfNeeded();
    await shot("details");
    await page.locator("[data-pilot-details]").click();
    // 4 · «Practice first»: no wallet, no money — the trade's rules on history, the savings at today's rate.
    await page.locator("[data-pilot-paper-start]").click();
    await page.locator("[data-pilot-paper] [data-tone], [data-pilot-paper] span").first().waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => window.__pilot.getState().paper !== null, null, { timeout: 60_000 });
    await shot("paper");
    // 5 · signed once: the agent at work — the week's figure.
    view = pilotView({});
    await page.evaluate(() => {
      window.__pilot.setState({ phase: "live", note: { kind: "on", at: Date.now() } });
    });
    await page.locator("[data-pilot-week]").waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => window.__pilot.getState().view !== null, null, { timeout: 60_000 });
    await shot("working");
    // 6 · SOL fell 12 % in a day: the agent paused its trading by itself; a minus is a minus.
    view = pilotView({ held: { why: "market", since: now - 2 * HOUR }, care: { at: now - 5 * 60_000, shares: { trade: 398, save: 6801, pool: 2068, reserve: 733 }, earnedUsd: -1.42, weekUsd: -1.42, solUsd: 138, fallBps: 1240 }, events: [{ at: now - 3 * 86_400_000, what: "start" }, { at: now - 2 * HOUR, what: "hold", why: "market", fallBps: 1240 }] });
    await page.evaluate(() => window.__pilot.setState({ view: null, note: null }));
    await page.evaluate((owner) => fetch(`/api/bots/pilot?owner=${owner}`).then((r) => r.json()).then((v) => window.__pilot.getState().setView(v)), WALLET);
    await page.waitForFunction(() => window.__pilot.getState().view?.held?.why === "market", null, { timeout: 60_000 });
    await shot("paused-market");

    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
