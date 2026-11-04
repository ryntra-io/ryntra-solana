// The agent on its word (CITY-175) for review: phrase → card → the agent at work → «Mine» → a launch the agent prepared
// → the launch sheet's review, on a desk (1440×900) and a phone (375×812), in English and Ukrainian →
// <out>/<lang>-<size>-<n>-<step>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=devnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=devnet NEXT_PUBLIC_RYNTRA_CITY_TRADE=open npm run dev -- -p 3175
//   node city/lib/autopilot/shots.mjs [out] [baseUrl]          LANGS=en,uk  SIZES=desk,phone  AGENT_STATUS=paused  PRESS_CHROME=<chromium>
//
// Every figure is a fixture: the city's read is the bundled snapshot; the agent's book answers three trades; the launch
// runs on the development stand-in (`?launch=stub`). The wallet is a public address seated in the store: no wallet, no
// key, nothing signs, nothing leaves the stand.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-175");
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
  en: { trade: "trade 1 SOL a day", launch: "launch me a token" },
  uk: { trade: "торгуй на 1 SOL на день", launch: "запусти мені токен" },
};

/* A mandate as the window keeps it after the one signature: public addresses from CITY-174's devnet pass, the large budget. */
const RECORD = {
  owner: WALLET,
  settings: "4GYqmkrEEs1x2SXaFMAh299dskoD5VWLDe4dVVbusQj2",
  vault: "XJsZYQmFpRi7ApQ942wQiJm5nGX3eef15n3385bKcP6",
  policy: "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3",
  budget: "6KYi9ZNLkcyQR9Cf5UimuagUJcxMRPRqBdCoWfawSZNF",
  perTrade: "100000000",
  perDay: "500000000",
  expiresAt: String(Math.floor(Date.now() / 1000) + 29 * 86_400 + 3_600),
};
const now = Date.now();
const trade = (minutesAgo, received) => ({ at: now - minutesAgo * 60_000, ok: true, signature: `sig${minutesAgo}`, spentRaw: "100000000", receivedRaw: String(received) });
/* What the agent's book answers: three buys of 0.1 SOL, the coins worth 0.3117 SOL at the pool's price now. */
const VIEW = {
  network: "devnet",
  status: process.env.AGENT_STATUS ?? "working",
  strategy: "steady",
  receiveMint: "tRYNr8yQo7Zz1nHn3s1LwH8sP2wT9UuUyN4p2KqX3ab",
  symbol: "tRYN",
  everyMs: 17_280_000,
  result: { trades: 3, spentRaw: "300000000", boughtRaw: "296400", worthRaw: "311700000", earnedRaw: "11700000", multiple: 1.039 },
  last: [trade(64, 98_100), trade(352, 99_000), trade(640, 99_300)],
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
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "devnet", active: true, budgetLamports: "200000000" }));
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
    await page.goto(`${base}/?quality=low&lang=${lang}&launch=stub`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__openCommand === "function" && typeof window.__autopilot?.setState === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 600_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    await page.evaluate((wallet) => {
      window.__autopilotMandate.setState({ hydrated: true, records: {}, status: {}, busy: null, note: null, preset: "medium" });
      // A public address seated as the connected wallet: the card reads it, nothing can sign with it.
      window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:devnet"] }, holdings: null, holdingsRead: "none" });
    }, WALLET);

    const say = async (words) => {
      await page.evaluate(() => window.__openCommand());
      const field = page.locator("[data-city-command] input").first();
      await field.waitFor({ timeout: 60_000 });
      await field.fill(words);
    };

    // 1 · the phrase: the agent's row first.
    await say(SAY[lang].trade);
    await shot("phrase");
    // 2 · the card: the budget a day, the rhythm, the limits in one line, «Sign once».
    await page.keyboard.press("Enter");
    await page.locator("[data-autopilot='trade']").waitFor({ timeout: 300_000 });
    await shot("card-trade");
    // 3 · the details behind one tap.
    await page.locator("[data-autopilot] button[aria-expanded]").last().click();
    await shot("card-details");
    await page.locator("[data-autopilot] button[aria-expanded]").last().click();
    // 4 · signed once: the agent at work — what it earned, «Share», «Stop».
    await page.evaluate((record) => window.__autopilotMandate.getState().keep(record), RECORD);
    await page.locator("[data-agent-earned]").waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => Object.keys(window.__autopilot.getState().views).length > 0, null, { timeout: 60_000 });
    await shot("working");
    // 5 · «Mine»: what the agent earned, in one row.
    await page.evaluate(() => window.__autopilot.getState().close());
    await page.evaluate(() => window.__autopilotMine.setState({ open: true }));
    await page.locator("[data-agent-mine]").waitFor({ timeout: 60_000 });
    await shot("mine");
    await page.evaluate(() => window.__autopilotMine.setState({ open: false }));
    // 6 · «launch me a token»: the coin the agent prepared — name, ticker, picture, rules.
    await say(SAY[lang].launch);
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    await page.locator("[data-autopilot='launch'] img").waitFor({ timeout: 120_000 });
    await shot("card-launch");
    // 7 · «Launch»: the launch sheet's review, filled — the person's wallet signs there.
    await page.locator("[data-autopilot-launch]").click();
    await page.locator("[data-launch-sheet]").waitFor({ timeout: 120_000 });
    await shot("launch-review");

    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
