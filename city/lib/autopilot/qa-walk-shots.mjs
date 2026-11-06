// CITY-201 quality pass B: the agent's card walked as a person walks it — every sentence the agent takes, in English and
// Ukrainian, on a desk (1440×900) and a phone (390×844) — with the card's tightness measured: the largest empty stretch
// between two of its blocks, which the owner saw as a dark hole under «trade BONK with 0.1 SOL a day».
// → <out>/<lang>-<size>-<n>-<step>.jpg and <out>/walk.json (gaps, page errors, failed requests).
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open \
//   NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open NEXT_PUBLIC_RYNTRA_CITY_ONE_SENTENCE=open npm run dev -- -p 3201
//   node city/lib/autopilot/qa-walk-shots.mjs [out] [baseUrl]          LANGS=en,uk  SIZES=desk,phone  MAX_GAP=48
//
// Every figure is a fixture: the city's read is the bundled snapshot; the run on history, the paper run and the agent's
// book answer fixtures. The wallet is a public address seated in the store: nothing signs, nothing leaves the stand.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-201");
const base = process.argv[3] ?? "http://localhost:3201";
const MAX_GAP = Number(process.env.MAX_GAP ?? 48);
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

/* The sentences a person says to the agent: the owner's own first. */
const SAY = {
  en: { steady: "trade BONK with 0.1 SOL a day", dip: "buy BONK on dips, take +20%", grid: "grid BONK step 3% 8 levels", early: "buy new launches early", regular: "buy $20 of SOL every week" },
  uk: { steady: "торгуй BONK на 0,1 SOL на день", dip: "купуй BONK на просіданнях, фіксуй +20 %", grid: "торгуй BONK сіткою кроком 4 %", early: "купуй нові запуски", regular: "купуй SOL на $20 щотижня" },
};

const now = Date.now();
const HOUR = 3_600_000;
const HISTORY = { bars: 288, fromMs: now - 12 * 24 * HOUR, toMs: now, buys: 9, sells: 0, spentSol: 0.18, gotSol: 0, heldSol: 0.1886, resultPct: 4.2, holdPct: -3.1, worstPct: -6.4, exit: null, paused: null, trades: [] };
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
const VIEW = {
  network: "mainnet",
  status: "working",
  pausedBy: null,
  strategy: "steady",
  plan: "steady",
  receiveMint: BONK,
  symbol: "BONK",
  everyMs: 17_280_000,
  result: { trades: 3, spentRaw: "60000000", boughtRaw: "3100000000000", worthRaw: "62300000", earnedRaw: "2300000", multiple: 1.038 },
  day: { trades: 2, spentRaw: "40000000", earnedRaw: "1200000" },
  last: [trade(64, 1_050_000_000_000), trade(352, 1_030_000_000_000), trade(640, 1_020_000_000_000)],
  updatedAt: now - 64 * 60_000,
};

/**
 * The card's tightness: the blocks of the open window's body top to bottom, and the largest empty stretch between two
 * neighbours. A block is a child of the body that draws something; the dock and «Details» count as blocks.
 */
async function measure(page, selector) {
  return page.evaluate((sel) => {
    const body = document.querySelector(sel);
    if (!body) return null;
    const boxes = [...body.children]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 0 && r.width > 0)
      .sort((a, b) => a.r.top - b.r.top);
    let gap = 0;
    let at = null;
    for (let k = 1; k < boxes.length; k += 1) {
      const d = boxes[k].r.top - boxes[k - 1].r.bottom;
      if (d > gap) {
        gap = d;
        at = `${boxes[k - 1].el.className || boxes[k - 1].el.tagName} → ${boxes[k].el.className || boxes[k].el.tagName}`;
      }
    }
    const r = body.getBoundingClientRect();
    const last = boxes.at(-1)?.r.bottom ?? r.top;
    // The empty glass under the card's last block, to the frame's own foot (a bay or a sheet stands taller than a card).
    const frame = body.closest("[data-window]");
    const foot = frame ? Math.min(frame.getBoundingClientRect().bottom, innerHeight) : r.bottom;
    const scroller = frame?.querySelector("[class*='body']");
    const scroll = Boolean(scroller && scroller.scrollHeight > scroller.clientHeight + 1);
    return { gap: Math.round(gap), at, below: Math.round(foot - last), height: Math.round(r.height), scroll };
  }, selector);
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];
let worst = 0;
for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const step = (what) => console.log(`${new Date().toISOString().slice(11, 19)} ${size.name} ${lang} ${what}`);
    const errors = [];
    const failed = [];
    page.on("pageerror", (e) => {
      errors.push(String(e).slice(0, 300));
      step(`page error: ${String(e).slice(0, 160)}`);
    });
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 300)}`));
    page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url().slice(0, 160)} ${r.failure()?.errorText ?? ""}`));
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "mainnet", active: true, budgetLamports: "40000000" }));
    await context.route(/\/api\/bots\/mandate\/agent/, (route) => json(route, VIEW));
    await context.route(/\/api\/bots\/mandate\/report/, (route) => json(route, { on: true, hour: 9 }));
    await context.route(/\/api\/bots\/mandate\/test/, (route) => json(route, { ok: true, mode: route.request().url().includes("since=") ? "paper" : "history", timeframe: "1h", result: route.request().url().includes("since=") ? PAPER : HISTORY }));
    await context.route(/\/api\/solana\/holdings/, (route) =>
      json(route, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2415000000", spendableRaw: "2405000000", decimals: 9, symbol: "SOL" }] } }),
    );

    let n = 0;
    const shot = async (name, selector) => {
      await page.waitForTimeout(1_200);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.waitForTimeout(400);
      n += 1;
      const file = `${lang}-${size.name}-${n}-${name}.jpg`;
      await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, timeout: 180_000 });
      const fit = selector ? await measure(page, selector) : null;
      // Earn keeps its tall window for its tabs: there only the stretch between blocks counts.
      if (fit) worst = Math.max(worst, fit.gap, fit.scroll || name.startsWith("earn") ? 0 : fit.below);
      report.push({ size: size.name, lang, name, file, fit });
      step(`shot ${name}${fit ? ` gap ${fit.gap}px (${fit.at}) below ${fit.below}px` : ""}`);
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
    // No wallet first: the card as a person meets it.
    await page.evaluate(() => {
      window.__autopilotMandate.setState({ hydrated: true, records: {}, status: {}, busy: null, note: null, preset: "small" });
      window.__autopilotWallet.setState({ connection: null, holdings: null, holdingsRead: "none" });
    });

    const say = async (words) => {
      await page.evaluate(() => window.__openCommand());
      const field = page.locator("[data-city-command] input").first();
      await field.waitFor({ timeout: 60_000 });
      await field.fill(words);
      await page.waitForTimeout(600);
      await page.keyboard.press("Enter");
    };
    const close = () => page.evaluate(() => (window.__autopilot.getState().close(), window.__instruct?.getState().close()));
    const details = () => page.locator("[data-autopilot] button[aria-expanded]").last().click();
    const CARD = "[data-autopilot]";

    // 1 · the owner's sentence, no wallet yet: the plan, the limits, «Connect wallet» — with no hole between them.
    await say(SAY[lang].steady);
    await page.locator("[data-autopilot='trade'] [data-autopilot-fee]").waitFor({ timeout: 300_000 });
    await shot("steady-no-wallet", CARD);
    // 2 · the same with a wallet: «Sign once», «Practice first».
    await page.evaluate((wallet) => window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] } }), WALLET);
    await page.locator("[data-autopilot-practice]").waitFor({ timeout: 60_000 });
    await shot("steady-wallet", CARD);
    // 3 · «Details»: the rules and the run on history.
    await details();
    await page.locator("[data-autopilot-tested]").waitFor({ timeout: 60_000 }).catch(() => {});
    await shot("steady-details", CARD);
    await details();
    // 4 · «Practice first»: on paper, then the way out.
    await page.locator("[data-autopilot-practice]").click();
    await page.locator("[data-paper]").waitFor({ timeout: 60_000 });
    await page.locator("[data-paper] [data-tone]").waitFor({ timeout: 60_000 }).catch(() => {});
    await shot("practice", CARD);
    await page.locator("[data-autopilot-end-practice]").click();
    await page.waitForTimeout(400);
    await shot("practice-ended", CARD);
    await close();
    // 5 · a dip with a take; 6 · a grid; 7 · new launches.
    for (const [key, plan] of [["dip", "dip"], ["grid", "grid"], ["early", "early"]]) {
      await say(SAY[lang][key]);
      await page.locator(`[data-autopilot-plan='${plan}']`).waitFor({ timeout: 120_000 }).catch(() => step(`no plan line for ${key}`));
      await shot(`card-${key}`, CARD);
      await close();
    }
    // 8 · regular buys: the instruction card of «Ask Ryntra».
    await say(SAY[lang].regular);
    await page.locator("[data-instruct]").waitFor({ timeout: 120_000 }).catch(() => step("no instruction card"));
    await shot("regular", "[data-instruct]");
    await close();
    // 9 · Earn's «Mine» with no wallet; 10 · the Guard before a paste: each tight under its action.
    await page.evaluate(() => window.__autopilotWallet.setState({ connection: null }));
    await page.evaluate(() => window.__openEarn("mine"));
    await page.locator("[data-window='earn'] section[aria-label]").waitFor({ timeout: 120_000 }).catch(() => step("no «Mine»"));
    await shot("earn-mine", "[data-window='earn'] section[aria-label]");
    await page.evaluate(() => window.__earn.getState().close());
    await page.evaluate(() => window.__guard.getState().show());
    await page.locator("[data-window='guard'] form").waitFor({ timeout: 120_000 }).catch(() => step("no Guard"));
    await shot("guard", "[data-window='guard'] form");
    await page.evaluate(() => window.__guard.setState({ open: false }));
    await page.evaluate((wallet) => window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] } }), WALLET);
    // 11 · signed once: the agent at work, its day and the daily report.
    await page.evaluate((record) => window.__autopilotMandate.getState().keep(record), RECORD);
    await page.evaluate(() => window.__autopilot.getState().showAgent());
    await page.locator("[data-agent-earned]").waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => Object.keys(window.__autopilot.getState().views).length > 0, null, { timeout: 60_000 });
    await shot("working", CARD);
    await close();

    report.push({ size: size.name, lang, errors, failed: failed.filter((f) => !f.includes("ERR_ABORTED")) });
    await context.close();
  }
}

writeFileSync(path.join(out, "walk.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(`largest empty stretch ${worst}px (allowed ${MAX_GAP}px)`);
console.log(JSON.stringify(report.filter((r) => r.errors?.length || r.failed?.length), null, 2));
if (worst > MAX_GAP) process.exitCode = 1;
