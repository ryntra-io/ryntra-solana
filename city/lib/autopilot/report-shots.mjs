// The agent's day (CITY-194) for review: the return card «While you were away», the quiet line over the agent's tower,
// the agent's card with «Today» and the daily report's switch, the switch off — on a desk (1440×900) and a phone
// (390×844), in English and Ukrainian → <out>/<lang>-<size>-<n>-<step>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open NEXT_PUBLIC_RYNTRA_CITY_TRADE=open npm run dev -- -p 3194
//   node city/lib/autopilot/report-shots.mjs [out] [baseUrl]          LANGS=en,uk  SIZES=desk,phone  PRESS_CHROME=<chromium>
//
// Every figure is a fixture: the city's read is the bundled snapshot; the agent's book answers three trades today, two
// of them while the person was away. The wallet is a public address seated in the store: no wallet, no key, nothing
// signs, nothing leaves the stand.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-194");
const base = process.argv[3] ?? "http://localhost:3194";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const WALLET = "Rev1ewWa11etPub1icAddress1111111111111111111";
const COIN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

/* A mandate as the window keeps it after the one signature: mainnet's one budget, 0.1 SOL a day. */
const RECORD = {
  owner: WALLET,
  settings: "4GYqmkrEEs1x2SXaFMAh299dskoD5VWLDe4dVVbusQj2",
  vault: "XJsZYQmFpRi7ApQ942wQiJm5nGX3eef15n3385bKcP6",
  policy: "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3",
  budget: "6KYi9ZNLkcyQR9Cf5UimuagUJcxMRPRqBdCoWfawSZNF",
  perTrade: "10000000",
  perDay: "100000000",
  expiresAt: String(Math.floor(Date.now() / 1000) + 29 * 86_400 + 3_600),
};
const now = Date.now();
const H = 3_600_000;
const trade = (hoursAgo) => ({ at: now - hoursAgo * H, ok: true, signature: `sig${hoursAgo}`, spentRaw: "10000000", receivedRaw: "412000000" });
const span = (since, trades, spent, worth) => ({ since, until: now, trades, spentRaw: String(spent), boughtRaw: String(trades * 412_000_000), worthRaw: String(worth), earnedRaw: String(worth - spent) });
/* What the agent's book answers: seven buys of 0.01 SOL so far; today three, two of them since the person last looked. */
const VIEW = {
  network: "mainnet",
  status: "working",
  strategy: "steady",
  receiveMint: COIN,
  symbol: "BONK",
  everyMs: 8_640_000,
  result: { trades: 7, spentRaw: "70000000", boughtRaw: "2884000000", worthRaw: "78400000", earnedRaw: "8400000", multiple: 1.12 },
  last: [trade(1.2), trade(3.6), trade(6), trade(26), trade(28.4)],
  updatedAt: now - 1.2 * H,
  day: span(now - 24 * H, 3, 30_000_000, 42_000_000),
  away: span(now - 5 * H, 2, 20_000_000, 28_000_000),
  heldRaw: "2884000000",
  lastSale: null,
};

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", timezoneId: "Europe/Kyiv", reducedMotion: "reduce" });
    const page = await context.newPage();
    const step = (what) => console.log(`${new Date().toISOString().slice(11, 19)} ${size.name} ${lang} ${what}`);
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(String(e));
      step(`page error: ${String(e).slice(0, 160)}`);
    });
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    let daily = { on: true, hour: 20, kept: true };
    await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "mainnet", active: true, budgetLamports: "30000000" }));
    await context.route(/\/api\/bots\/mandate\/agent/, (route) => json(route, VIEW));
    await context.route(/\/api\/bots\/mandate\/report/, (route) => {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        if (typeof body.on === "boolean") daily = { ...daily, on: body.on };
      }
      return json(route, daily);
    });
    await context.route(/\/api\/solana\/holdings/, (route) =>
      json(route, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2415000000", spendableRaw: "2405000000", decimals: 9, symbol: "SOL" }] } }),
    );
    // This browser last saw the agent five hours ago.
    await context.addInitScript(([policy, at]) => {
      try {
        localStorage.setItem(`ryntra.city.agent.seen.v1:${policy}`, String(at));
        // A person coming back has learned the first hint long ago.
        localStorage.setItem("ryntra.city.firstHint", "1");
      } catch {}
    }, [RECORD.policy, now - 5 * H]);

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
    await page.waitForFunction(() => typeof window.__autopilot?.setState === "function" && typeof window.__agentReport?.setState === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 600_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    // The camera on the agent's tower: the coin it buys stands in the skyline.
    const view = await page.evaluate((coin) => {
      const placed = window.__city.getState().layout.towers.find((t) => t.tower.id === coin);
      if (!placed || typeof window.__cityView !== "function") return false;
      const top = placed.height + placed.width * 1.6;
      window.__cityView([placed.x + 70, top + 34, placed.z + 92], [placed.x, top * 0.72, placed.z]);
      return true;
    }, COIN);
    if (!view) step("no camera hook or no tower: the shot stands on the city's own view");
    await page.evaluate(
      ([record, wallet]) => {
        window.__autopilotMandate.setState({ hydrated: true, records: {}, status: {}, busy: null, note: null });
        // A public address seated as the connected wallet: the card reads it, nothing can sign with it.
        window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] }, holdings: null, holdingsRead: "none" });
        window.__autopilotMandate.getState().keep(record);
      },
      [RECORD, WALLET],
    );

    // 1 · back after five hours: «While you were away», over the agent's tower and its quiet line.
    await page.locator("[data-agent-away]").waitFor({ timeout: 120_000 });
    await page.locator("[data-agent-tower]").waitFor({ timeout: 60_000 }).catch(() => step("no tower line"));
    await shot("away");
    // 2 · the card let go: the city with only the quiet line over the tower.
    await page.locator("[data-agent-away] button[aria-label]").last().click();
    await shot("tower");
    // 3 · the agent's card: what it earned, «Today», the daily report's switch.
    await page.evaluate(() => window.__autopilot.getState().showAgent());
    await page.locator("[data-agent-daily]").waitFor({ timeout: 120_000 });
    await shot("card-today");
    // 4 · one tap: the daily report off.
    await page.locator("[data-agent-daily]").click();
    await page.waitForFunction(() => document.querySelector("[data-agent-daily]")?.getAttribute("aria-checked") === "false", null, { timeout: 30_000 });
    await shot("daily-off");

    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
