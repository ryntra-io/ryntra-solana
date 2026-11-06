// CITY-197 for review — the agent's honest result and the owner's week of demand, on a desk (1440×900) and a phone
// (390×844), in English and Ukrainian → <out>/<lang>-<size>-<n>-<step>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open NEXT_PUBLIC_RYNTRA_CITY_TRADE=open npm run dev -- -p 3197
//   node city/lib/autopilot/net-shots.mjs [out] [baseUrl] [adminPath]          LANGS=en,uk  SIZES=desk,phone  PRESS_CHROME=<chromium>
//
// Every figure is a fixture: the city's read is the bundled snapshot; the agent's book answers seven buys, the result
// after every fee and plain holding beside it. The wallet is a public address seated in the store: nothing signs.
// The owner's week is the real card (`app/admin/growth/demand-week.tsx`) with the route's answer fixed; the admin's own
// session is not on a stand, so `adminPath` names a page that mounts the card in the admin's frame.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-197");
const base = process.argv[3] ?? "http://localhost:3197";
const adminPath = process.argv[4] ?? "/stand-city197/demand";
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
const H = 3_600_000;
const trade = (hoursAgo) => ({ at: now - hoursAgo * H, ok: true, signature: `sig${hoursAgo}`, spentRaw: "20000000", receivedRaw: "824000000" });
const span = (since, trades, spent, worth, net, hold) => ({ since, until: now, trades, spentRaw: String(spent), boughtRaw: String(trades * 824_000_000), worthRaw: String(worth), earnedRaw: String(worth - spent), netRaw: String(net), holdRaw: String(hold) });
/* Five buys of 0.02 SOL at the calm pace, one a day; today one, since the person last looked one. */
const VIEW = {
  network: "mainnet",
  status: "working",
  strategy: "steady",
  plan: "steady,pace:1",
  receiveMint: COIN,
  symbol: "BONK",
  everyMs: 86_400_000,
  result: { trades: 5, spentRaw: "100000000", boughtRaw: "4120000000", worthRaw: "108600000", earnedRaw: "8600000", multiple: 1.086 },
  net: { trades: 5, spentRaw: "100000000", netRaw: "-2486000", holdRaw: "5120000", feesRaw: "11086000" },
  last: [trade(3), trade(27), trade(51), trade(75), trade(99)],
  updatedAt: now - 3 * H,
  day: span(now - 24 * H, 1, 20_000_000, 21_720_000, -497_000, 840_000),
  away: span(now - 5 * H, 1, 20_000_000, 21_720_000, -497_000, 840_000),
  heldRaw: "4120000000",
  lastSale: null,
};
const week = (from) => new Date(Date.parse(from) + 7 * 86_400_000).toISOString();
const DEMAND = {
  demand: {
    week: "2026-10-26",
    from: "2026-10-26T00:00:00.000Z",
    to: week("2026-10-26T00:00:00.000Z"),
    launches: { coins: 0, people: 0 },
    agents: { active: 3, turnoverSol: 0.42 },
    returns: { d7: { back: 1, of: 4 }, d30: null },
    partners: { people: 2 },
    revenue: { netUsd: 7.86, swapsUsd: 6.12, agentsUsd: 1.74, agentsSol: 0.0084, partnersUsd: 0 },
  },
  weeks: ["2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05"],
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
    await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "mainnet", active: true, budgetLamports: "0" }));
    await context.route(/\/api\/bots\/mandate\/agent/, (route) => json(route, VIEW));
    await context.route(/\/api\/bots\/mandate\/report/, (route) => json(route, { on: true, hour: 20, kept: true }));
    await context.route(/\/api\/admin\/growth\/demand/, (route) => json(route, DEMAND));
    await context.route(/\/api\/solana\/holdings/, (route) =>
      json(route, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2415000000", spendableRaw: "2405000000", decimals: 9, symbol: "SOL" }] } }),
    );
    await context.addInitScript(([policy, at]) => {
      try {
        localStorage.setItem(`ryntra.city.agent.seen.v1:${policy}`, String(at));
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
    // The scene first: a shot of the city without it is no shot.
    await page.waitForFunction(() => typeof window.__cityView === "function" && document.querySelector("canvas") !== null, null, { timeout: 600_000 }).catch(() => step("the scene did not come up"));
    await page.waitForTimeout(8_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
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
        window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] }, holdings: null, holdingsRead: "none" });
        window.__autopilotMandate.getState().keep(record);
      },
      [RECORD, WALLET],
    );

    // 1 · back after five hours: the day after every fee, over the tower.
    await page.locator("[data-agent-away]").waitFor({ timeout: 120_000 });
    await shot("away-net");
    await page.locator("[data-agent-away] button[aria-label]").last().click();
    // 2 · the agent's card: earned after fees, holding beside it, «Today».
    await page.evaluate(() => window.__autopilot.getState().showAgent());
    await page.locator("[data-agent-hold]").waitFor({ timeout: 120_000 });
    await shot("card-net");
    // 3 · «Details»: the fees counted, said once.
    const details = page.locator("[data-autopilot] details summary, [data-autopilot] button[aria-expanded]").first();
    if (await details.count()) {
      await details.click().catch(() => undefined);
      await shot("card-details");
    }

    // 4 · the owner's week of demand.
    step("open the owner's week");
    await page.goto(`${base}${adminPath}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.locator("[data-demand-net]").waitFor({ timeout: 300_000 });
    await shot("demand-week");

    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
