// CITY-193 for review: the agent's strategies on its card — a dip said in a sentence, its rules and its run on history
// behind «Details», the practice without money, a grid at work, the person's take reached, an early launch the agent
// picked — on a desk (1440×900) and a phone (390×844), in English and Ukrainian → <out>/<lang>-<size>-<n>-<step>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet NEXT_PUBLIC_RYNTRA_CITY_TRADE=open npm run dev -- -p 3193
//   node city/lib/autopilot/strategy-shots.mjs [out] [baseUrl]          LANGS=en,uk  SIZES=desk,phone
//
// Every figure is a fixture: the city's read is the bundled snapshot; the run on history, the paper run, the agent's book
// and Pulse's new launches answer fixtures. The wallet is a public address seated in the store: nothing signs, nothing
// leaves the stand.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-193");
const base = process.argv[3] ?? "http://localhost:3193";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const WALLET = "Rev1ewWa11etPub1icAddress1111111111111111111";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

const SAY = {
  en: { dip: "buy BONK on dips, take +20%", early: "buy new launches early" },
  uk: { dip: "купуй BONK на просіданнях, фіксуй +20 %", early: "купуй нові запуски" },
};

const now = Date.now();
const HOUR = 3_600_000;
/* The run on history the route answers: twelve days of hours, the dip's buys against plain holding. */
const HISTORY = { bars: 288, fromMs: now - 12 * 24 * HOUR, toMs: now, buys: 9, sells: 0, spentSol: 0.18, gotSol: 0, heldSol: 0.1886, resultPct: 4.2, holdPct: -3.1, worstPct: -6.4, exit: null, paused: null, trades: [] };
/* The paper agent since its start, five hours ago. */
const PAPER = { bars: 60, fromMs: now - 5 * HOUR, toMs: now, buys: 2, sells: 0, spentSol: 0.04, gotSol: 0, heldSol: 0.04104, resultPct: 2.1, holdPct: -1.4, worstPct: -2.2, exit: null, paused: null, trades: [] };
const RECORD = {
  owner: WALLET,
  settings: "4GYqmkrEEs1x2SXaFMAh299dskoD5VWLDe4dVVbusQj2",
  vault: "XJsZYQmFpRi7ApQ942wQiJm5nGX3eef15n3385bKcP6",
  policy: "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3",
  budget: "6KYi9ZNLkcyQR9Cf5UimuagUJcxMRPRqBdCoWfawSZNF",
  perTrade: "20000000",
  perDay: "100000000",
  expiresAt: String(Math.floor(now / 1000) + 29 * 86_400 + 3_600),
};
const trade = (minutesAgo, received) => ({ at: now - minutesAgo * 60_000, ok: true, signature: `sig${minutesAgo}`, spentRaw: "20000000", receivedRaw: String(received) });
const view = (extra) => ({
  network: "mainnet",
  status: "working",
  pausedBy: null,
  strategy: "grid",
  plan: "grid:500:5",
  receiveMint: BONK,
  symbol: "BONK",
  everyMs: 17_280_000,
  result: { trades: 3, spentRaw: "60000000", boughtRaw: "3100000000000", worthRaw: "62300000", earnedRaw: "2300000", multiple: 1.038 },
  last: [trade(64, 1_050_000_000_000), trade(352, 1_030_000_000_000), trade(640, 1_020_000_000_000)],
  updatedAt: now - 64 * 60_000,
  ...extra,
});
const PULSE = {
  rows: [
    { mint: "NeonFoxLaunch111111111111111111111111111111", symbol: "NFOX", name: "Neon Fox", icon: null, liquidityUsd: 61_000, marketCapUsd: 240_000, holders: 1_240, top10Pct: 17, devPct: 1.5, creatorLaunches: 1, creatorGraduated: 0, auditRead: true, notices: [], firstPoolAt: new Date(now - 3 * HOUR).toISOString(), windows: { h1: { volumeUsd: 180_000 } } },
  ],
};

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
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
    let agentView = view({});
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "mainnet", active: true, budgetLamports: "40000000" }));
    await context.route(/\/api\/bots\/mandate\/agent/, (route) => json(route, agentView));
    await context.route(/\/api\/bots\/mandate\/test/, (route) => json(route, { ok: true, mode: route.request().url().includes("since=") ? "paper" : "history", timeframe: "1h", result: route.request().url().includes("since=") ? PAPER : HISTORY }));
    await context.route(/\/api\/spot\/pulse/, (route) => json(route, PULSE));
    await context.route(/\/api\/solana\/holdings/, (route) =>
      json(route, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2415000000", spendableRaw: "2405000000", decimals: 9, symbol: "SOL" }] } }),
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
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("ryntra.city.agentPaper");
      } catch {}
    });
    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__openCommand === "function" && typeof window.__autopilot?.setState === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 600_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    await page.evaluate((wallet) => {
      window.__autopilotMandate.setState({ hydrated: true, records: {}, status: {}, busy: null, note: null, preset: "small" });
      window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] }, holdings: null, holdingsRead: "none" });
    }, WALLET);

    const say = async (words) => {
      await page.evaluate(() => window.__openCommand());
      const field = page.locator("[data-city-command] input").first();
      await field.waitFor({ timeout: 60_000 });
      await field.fill(words);
      await page.waitForTimeout(600);
      await page.keyboard.press("Enter");
    };
    const details = () => page.locator("[data-autopilot] button[aria-expanded]").last().click();

    // 1 · «buy BONK on dips, take +20%»: the strategy in one line.
    await say(SAY[lang].dip);
    await page.locator("[data-autopilot-plan='dip']").waitFor({ timeout: 300_000 });
    await page.locator("[data-autopilot-practice]").waitFor({ timeout: 60_000 });
    await shot("card-dip");
    // 2 · the rules and the run on history, behind «Details».
    await details();
    await page.locator("[data-autopilot-tested]").waitFor({ timeout: 60_000 });
    await page.locator("[data-autopilot-tested]").scrollIntoViewIfNeeded();
    await shot("details-tested");
    await details();
    // 3 · «Practice first»: the agent on paper, then one tap to the real budget.
    await page.locator("[data-autopilot-practice]").click();
    await page.locator("[data-paper] [data-tone]").waitFor({ timeout: 60_000 });
    await shot("practice");
    await page.locator("[data-autopilot-end-practice]").click();
    await page.evaluate(() => window.__autopilot.getState().close());
    // 4 · «buy new launches early»: the launch the agent picked through the city's check.
    await say(SAY[lang].early);
    await page.locator("[data-autopilot-plan='early']").waitFor({ timeout: 120_000 });
    await page.locator("[data-autopilot-coin]").waitFor({ timeout: 60_000 });
    await shot("card-early");
    await page.evaluate(() => window.__autopilot.getState().close());
    // 5 · signed once: a grid at work.
    await page.evaluate((record) => window.__autopilotMandate.getState().keep(record), RECORD);
    await page.evaluate(() => window.__autopilot.getState().showAgent());
    await page.locator("[data-agent-earned]").waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => Object.keys(window.__autopilot.getState().views).length > 0, null, { timeout: 60_000 });
    await shot("working-grid");
    // 6 · the person's take reached: the agent stopped buying and says why.
    agentView = view({ status: "paused", pausedBy: "take", strategy: "dip", plan: "dip:800,take:2000", result: { trades: 4, spentRaw: "80000000", boughtRaw: "4100000000000", worthRaw: "96800000", earnedRaw: "16800000", multiple: 1.21 } });
    await page.evaluate((record) => window.__autopilot.getState().setView(record.policy, null), RECORD);
    await page.evaluate(() => window.__autopilot.getState().close());
    await page.evaluate(() => window.__autopilot.getState().showAgent());
    await page.waitForFunction(() => Object.values(window.__autopilot.getState().views).some((v) => v && v.pausedBy === "take"), null, { timeout: 90_000 });
    await shot("paused-take");

    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
