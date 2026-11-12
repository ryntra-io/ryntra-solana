// CITY-70 for review — the agent's mission card and its three controls on a desk (1440×900) and a phone (390×844), in
// English and Ukrainian, and the agent walking to the tower it trades → <out>/<lang>-<size>-<n>-<step>.jpg
//   node <stand> (next dev with NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet
//   NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open NEXT_PUBLIC_RYNTRA_CITY_TRADE=open, port 3070)
//   node city/lib/autopilot/missions-shots.mjs [out] [baseUrl]          LANGS=en,uk  SIZES=desk,phone  PRESS_CHROME=<chromium>
//
// Every figure is a fixture: the city's read is the bundled snapshot; the agent's book answers as the engine does
// (`lib/mandate/agent-service.server.ts` `AgentView`, CITY-70's mission, books and trade states). The wallet is a public
// address seated in the store: nothing signs; «Freeze» answers as the engine's switch does.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-70");
const base = process.argv[3] ?? "http://localhost:3070";
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
const trade = (hoursAgo, state = "ok") => ({ at: now - hoursAgo * H, ok: state === "ok", state, signature: `sig${hoursAgo}`, spentRaw: state === "ok" ? "20000000" : "0", receivedRaw: state === "ok" ? "824000000" : null });
const span = (since, trades, spent, worth, net, hold) => ({ since, until: now, trades, spentRaw: String(spent), boughtRaw: String(trades * 824_000_000), worthRaw: String(worth), earnedRaw: String(worth - spent), netRaw: String(net), holdRaw: String(hold) });
/* Three buys of 0.02 SOL: 0.06 spent, 0.04 left — the vault on chain says the same. */
const BASE = {
  network: "mainnet",
  status: "working",
  pausedBy: null,
  strategy: "steady",
  plan: "steady",
  receiveMint: COIN,
  symbol: "BONK",
  everyMs: 17_280_000,
  result: { trades: 3, spentRaw: "60000000", boughtRaw: "2472000000", worthRaw: "64900000", earnedRaw: "4900000", multiple: 1.081 },
  net: { trades: 3, spentRaw: "60000000", netRaw: "2310000", holdRaw: "3070000", feesRaw: "2590000" },
  last: [trade(1), trade(5.8), trade(10.6)],
  updatedAt: now - H,
  day: span(now - 24 * H, 3, 60_000_000, 64_900_000, 2_310_000, 3_070_000),
  heldRaw: "2472000000",
  lastSale: null,
  frozen: false,
  mission: { state: "waiting", reason: "interval", nextAt: now + 3.8 * H },
  books: { state: "exact", budgetRaw: "100000000", spentRaw: "60000000", leftRaw: "40000000", pendingRaw: "0", gapRaw: "0" },
};
const VIEWS = {
  working: BASE,
  confirming: { ...BASE, last: [trade(0.02, "unknown"), ...BASE.last], mission: { state: "confirming", reason: null, nextAt: null }, books: { ...BASE.books, state: "settling", leftRaw: "20000000", pendingRaw: "20000000" } },
  frozen: { ...BASE, frozen: true, mission: { state: "frozen", reason: null, nextAt: null } },
  order: { ...BASE, lastSale: { policy: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", status: "failed", signature: null, soldRaw: "618000000", receivedRaw: null, reason: "the price moved" } },
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
    let current = VIEWS.working;
    const freezes = [];
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "mainnet", active: true, budgetLamports: current.books.leftRaw }));
    await context.route(/\/api\/bots\/mandate\/agent/, (route) => json(route, current));
    await context.route(/\/api\/bots\/mandate\/report/, (route) => json(route, { on: true, hour: 20, kept: true }));
    await context.route(/\/api\/bots\/mandate\/freeze/, (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      freezes.push(body);
      current = body.frozen ? VIEWS.frozen : VIEWS.working;
      return json(route, { network: "mainnet", frozen: body.frozen === true });
    });
    await context.route(/\/api\/solana\/holdings/, (route) => json(route, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2415000000", spendableRaw: "2405000000", decimals: 9, symbol: "SOL" }] } }));
    await context.addInitScript(([policy, at]) => {
      try {
        localStorage.setItem(`ryntra.city.agent.seen.v1:${policy}`, String(at));
        localStorage.setItem("ryntra.city.firstHint", "1");
      } catch {}
    }, [RECORD.policy, now]);

    let n = 0;
    const shot = async (name) => {
      await page.waitForTimeout(1_000);
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
    const show = async (name) => {
      current = VIEWS[name];
      await page.evaluate(([policy, view]) => window.__autopilot.getState().setView(policy, view), [RECORD.policy, current]);
    };

    step("open the city");
    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__autopilot?.setState === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 600_000 });
    await page.waitForFunction(() => typeof window.__cityView === "function" && document.querySelector("canvas") !== null, null, { timeout: 600_000 }).catch(() => step("the scene did not come up"));
    await page.waitForTimeout(8_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    const aimed = await page.evaluate((coin) => {
      const placed = window.__city.getState().layout.towers.find((t) => t.tower.id === coin);
      if (!placed || typeof window.__cityView !== "function") return false;
      const top = placed.height + placed.width * 1.6;
      window.__cityView([placed.x + 70, top + 34, placed.z + 92], [placed.x, top * 0.72, placed.z]);
      return true;
    }, COIN);
    if (!aimed) step("no camera hook or no tower: the shot stands on the city's own view");
    await page.evaluate(
      ([record, wallet]) => {
        window.__autopilotMandate.setState({ hydrated: true, records: {}, status: {}, busy: null, note: null });
        window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] }, holdings: null, holdingsRead: "none" });
        window.__autopilotMandate.getState().keep(record);
      },
      [RECORD, WALLET],
    );

    // 1 · the agent at work: what it does now, the figure, Share — and its three controls.
    await page.evaluate(() => window.__autopilot.getState().showAgent());
    await page.locator('[data-control="freeze"]').waitFor({ timeout: 120_000 });
    await show("working");
    await page.waitForTimeout(600);
    await page.locator('[data-control="withdraw"]').scrollIntoViewIfNeeded();
    await shot("card-working");
    // 2 · «Details»: the money — budget = spent + left — and its last trades by what they are.
    await page.locator("[data-autopilot] button[aria-expanded]").first().click();
    await page.locator("[data-agent-trades]").waitFor({ timeout: 30_000 });
    await page.locator("[data-agent-trades]").scrollIntoViewIfNeeded();
    await shot("card-details");
    await page.locator("[data-autopilot] button[aria-expanded]").first().click();
    // 3 · a trade whose answer is not in yet: «Confirming», never «failed».
    await show("confirming");
    await page.locator('[data-mission="confirming"]').waitFor({ timeout: 30_000 });
    await shot("card-confirming");
    await page.locator("[data-autopilot] button[aria-expanded]").first().click();
    await page.locator('[data-trade="unknown"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-agent-trades]').scrollIntoViewIfNeeded();
    await shot("card-confirming-details");
    await page.locator("[data-autopilot] button[aria-expanded]").first().click();
    // 4 · «Freeze»: one tap, no transaction — the card turns at once, «Resume» in its place.
    await show("working");
    await page.locator('[data-control="freeze"]').click();
    await page.locator('[data-mission="frozen"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-control="withdraw"]').scrollIntoViewIfNeeded();
    await shot("card-frozen");
    // 5 · a sale waiting in her vault: «Cancel orders» is there to tap.
    await page.evaluate(() => window.__agentControls?.setState({ note: null }));
    await show("order");
    await page.locator('[data-control="cancel"]:not([disabled])').waitFor({ timeout: 30_000 });
    await page.locator('[data-control="withdraw"]').scrollIntoViewIfNeeded();
    await shot("card-open-order");
    // 6 · the city: the agent over the tower it is trading, its beam on the roof (desk only, one language).
    if (size.name === "desk" && lang === LANGS[0]) {
      await show("confirming");
      await page.evaluate(() => window.__autopilot.getState().close());
      await page.waitForFunction(() => window.__agentWalk?.plan?.mood === "trade", null, { timeout: 30_000 }).catch(() => step("the agent did not go out"));
      /* Close to the agent: over the roof of the tower it trades, its beam down to it. */
      await page.evaluate(() => {
        const at = window.__agentWalk?.at;
        if (at && typeof window.__cityView === "function") window.__cityView([at[0] + 34, at[1] + 10, at[2] + 46], [at[0], at[1] - 8, at[2]]);
      });
      await page.waitForTimeout(4_000);
      report.push({ size: size.name, lang, walk: await page.evaluate(() => window.__agentWalk ?? null) });
      await shot("city-agent-at-tower");
    }

    report.push({ size: size.name, lang, freezes, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
