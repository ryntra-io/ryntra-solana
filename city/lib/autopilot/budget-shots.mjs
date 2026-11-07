// CITY-216 for review: the agent's card says the day's budget as the person said it — «trade 0.1 SOL a day» → the
// phrase row → the card (0.1 SOL a day in the headline, 0.02 SOL a trade under it) → a grid on 0.1 a day → the agent at
// work on the small budget, on a desk (1440×900) and a phone (375×812), in English and Ukrainian →
// <out>/<lang>-<size>-<n>-<step>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=devnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=devnet NEXT_PUBLIC_RYNTRA_CITY_TRADE=open npm run dev -- -p 3175
//   node city/lib/autopilot/budget-shots.mjs [out] [baseUrl]          LANGS=en,uk  SIZES=desk,phone  PRESS_CHROME=<chromium>
//
// Every figure is a fixture: the city's read is the bundled snapshot; the agent's book answers one trade. The wallet is
// a public address seated in the store: no wallet, no key, nothing signs, nothing leaves the stand.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-216");
const base = process.argv[3] ?? "http://localhost:3175";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const WALLET = "Rev1ewWa11etPub1icAddress1111111111111111111";
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

const SAY = {
  en: { trade: "trade 0.1 SOL a day", grid: "grid BONK step 5% 0.1 SOL a day" },
  uk: { trade: "торгуй на 0,1 SOL на день", grid: "торгуй BONK сіткою на 0,1 SOL на день" },
};

/* A mandate as the window keeps it after the one signature: public addresses from CITY-174's devnet pass, the small budget. */
const RECORD = {
  owner: WALLET,
  settings: "4GYqmkrEEs1x2SXaFMAh299dskoD5VWLDe4dVVbusQj2",
  vault: "XJsZYQmFpRi7ApQ942wQiJm5nGX3eef15n3385bKcP6",
  policy: "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3",
  budget: "6KYi9ZNLkcyQR9Cf5UimuagUJcxMRPRqBdCoWfawSZNF",
  perTrade: "20000000",
  perDay: "100000000",
  expiresAt: String(Math.floor(Date.now() / 1000) + 29 * 86_400 + 3_600),
};
const now = Date.now();
const trade = (minutesAgo, received) => ({ at: now - minutesAgo * 60_000, ok: true, signature: `sig${minutesAgo}`, spentRaw: "20000000", receivedRaw: String(received) });
/* What the agent's book answers: one buy of 0.02 SOL at the calm pace, the coins worth 0.0207 SOL at the pool's price now. */
const VIEW = {
  network: "devnet",
  status: "working",
  strategy: "steady",
  plan: "steady,pace:1",
  receiveMint: "tRYNr8yQo7Zz1nHn3s1LwH8sP2wT9UuUyN4p2KqX3ab",
  symbol: "tRYN",
  everyMs: 86_400_000,
  result: { trades: 1, spentRaw: "20000000", boughtRaw: "19800", worthRaw: "20700000", earnedRaw: "700000", multiple: 1.035 },
  last: [trade(64, 19_800)],
  updatedAt: now - 64 * 60_000,
};

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const step = (what) => console.log(`${new Date().toISOString().slice(11, 19)} ${size.name} ${lang} ${what}`);
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(String(e));
      step(`page error: ${String(e).slice(0, 160)}`);
    });
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "devnet", active: true, budgetLamports: "80000000" }));
    await context.route(/\/api\/bots\/mandate\/agent/, (route) => json(route, VIEW));
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
      for (let tries = 1; ; tries += 1) {
        try {
          await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, timeout: 180_000 });
          break;
        } catch (error) {
          if (tries >= 3) throw error;
          await page.waitForTimeout(5_000);
        }
      }
      report.push({ size: size.name, lang, name, file });
      step(`shot ${name}`);
    };

    step("open the city");
    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__openCommand === "function" && typeof window.__autopilot?.setState === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 600_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    await page.evaluate((wallet) => {
      window.__autopilotMandate.setState({ hydrated: true, records: {}, status: {}, busy: null, note: null, preset: "small" });
      // A public address seated as the connected wallet: the card reads it, nothing can sign with it.
      window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:devnet"] }, holdings: null, holdingsRead: "none" });
    }, WALLET);

    const say = async (words) => {
      await page.evaluate(() => window.__openCommand());
      const field = page.locator("[data-city-command] input").first();
      await field.waitFor({ timeout: 60_000 });
      await field.fill(words);
    };

    // 1 · the phrase: the agent's row says the day's budget.
    await say(SAY[lang].trade);
    await shot("phrase");
    // 2 · the card: 0.1 SOL a day in the headline, one trade's 0.02 SOL under it.
    await page.keyboard.press("Enter");
    await page.locator("[data-autopilot='trade'] [data-autopilot-size]").waitFor({ timeout: 300_000 });
    await shot("card-trade");
    // 3 · a grid on the same budget: its buys a day are a ceiling.
    await page.evaluate(() => window.__autopilot.getState().close());
    await say(SAY[lang].grid);
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    await page.locator("[data-autopilot='trade'] [data-autopilot-plan]").waitFor({ timeout: 120_000 });
    await shot("card-grid");
    // 4 · signed once: the agent at work on its 0.1 SOL a day.
    await page.evaluate(() => window.__autopilot.getState().close());
    await page.evaluate((record) => window.__autopilotMandate.getState().keep(record), RECORD);
    await page.evaluate(() => window.__autopilot.getState().showAgent());
    await page.locator("[data-agent-earned]").waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => Object.keys(window.__autopilot.getState().views).length > 0, null, { timeout: 60_000 });
    await page.locator("[data-autopilot-size]").waitFor({ timeout: 60_000 });
    await shot("working");

    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
