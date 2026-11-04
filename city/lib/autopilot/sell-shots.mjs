// «Sell» in the tower's window (CITY-187) for review: the tower whose coin the agent bought → the share priced → 50 % →
// how it works → sold, one line → not sold, with the way back; on a desk (1440×900) and a phone (375×812 — 390 with
// NETWORK=mainnet), in English and Ukrainian → <out>/<lang>-<size>-<n>-<step>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=devnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=devnet NEXT_PUBLIC_RYNTRA_CITY_TRADE=open npm run dev -- -p 3187
//   node city/lib/autopilot/sell-shots.mjs [out] [baseUrl]          LANGS=en,uk  SIZES=desk,phone  PRESS_CHROME=<chromium>
// CITY-195 — mainnet, through Jupiter (the deployment's switches at `mainnet`, NETWORK=mainnet here):
//   NETWORK=mainnet node city/lib/autopilot/sell-shots.mjs docs/shots/city-195 http://localhost:3195
//
// Every figure is a fixture: the city's read is the bundled snapshot; the agent's book says it bought Bonk for this wallet;
// the engine's review answers the share asked with the devnet pass's own proportions (1 % fee, the floor 1 % under the
// quote) — on mainnet with Jupiter's (1 % of the SOL out, the floor 2 % under the quote: the slippage and the price's room).
// The wallet is a public address seated in the store: no wallet, no key, nothing signs, nothing leaves the stand.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAINNET = process.env.NETWORK === "mainnet";
const NET = MAINNET ? "mainnet" : "devnet";
const out = path.resolve(process.argv[2] ?? (MAINNET ? "docs/shots/city-195" : "docs/shots/city-187"));
const base = process.argv[3] ?? (MAINNET ? "http://localhost:3195" : "http://localhost:3187");
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const WALLET = "Rev1ewWa11etPub1icAddress1111111111111111111";
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: MAINNET ? 390 : 375, height: MAINNET ? 844 : 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

/* The coin the agent bought: Bonk's tower, five decimals; it holds 1 847 362 Bonk for her. */
const COIN = SNAPSHOT.towers.find((tower) => tower.symbol === "Bonk");
const HELD = 184_736_200_000n;
const LAMPORTS_PER_COIN_UNIT = 0.000166; // ≈ Bonk's price in the snapshot, per base unit — for the fixture only
const RECORD = {
  owner: WALLET,
  settings: "4GYqmkrEEs1x2SXaFMAh299dskoD5VWLDe4dVVbusQj2",
  vault: "XJsZYQmFpRi7ApQ942wQiJm5nGX3eef15n3385bKcP6",
  policy: "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3",
  budget: "6KYi9ZNLkcyQR9Cf5UimuagUJcxMRPRqBdCoWfawSZNF",
  perTrade: MAINNET ? "20000000" : "100000000",
  perDay: MAINNET ? "100000000" : "500000000",
  expiresAt: String(Math.floor(Date.now() / 1000) + 29 * 86_400 + 3_600),
};
const SALE_POLICY = "2RJdkKJbBx4BEbNevqN74HYqZDs3WKmWfbd3JSSjHEb2";
const VIEW = {
  network: NET,
  status: "working",
  strategy: "steady",
  receiveMint: COIN.id,
  symbol: "Bonk",
  everyMs: 17_280_000,
  result: { trades: 3, spentRaw: "300000000", boughtRaw: HELD.toString(), worthRaw: "311700000", earnedRaw: "11700000", multiple: 1.039 },
  last: [],
  updatedAt: Date.now() - 3_600_000,
  heldRaw: HELD.toString(),
  soldRaw: "0",
  gotRaw: "0",
  lastSale: null,
};
/**
 * The engine's review of a share: Ryntra's 1 % of the coin, the pool's quote for the rest, the floor 1 % under it; on
 * mainnet (`lib/mandate/sale.server.ts` `priceOnJupiter`) Ryntra's 1 % of the SOL out, Jupiter's quote after it, the floor
 * the quote less the slippage and the price's room.
 */
function figures(share) {
  const amount = share === 100 ? HELD : (HELD * BigInt(share)) / 100n;
  if (MAINNET) {
    const gross = BigInt(Math.floor(Number(amount) * LAMPORTS_PER_COIN_UNIT));
    const fee = gross / 100n;
    const quote = gross - fee;
    const floor = (((quote * 9_900n) / 10_000n) * 9_900n) / 10_000n;
    return { coin: COIN.id, decimals: 5, heldRaw: HELD.toString(), amountRaw: amount.toString(), quoteRaw: quote.toString(), floorRaw: floor.toString(), feeBps: 100, feeRaw: fee.toString(), feeSolRaw: fee.toString() };
  }
  const fee = amount / 100n;
  const worth = (raw) => BigInt(Math.floor(Number(raw) * LAMPORTS_PER_COIN_UNIT));
  const quote = worth(amount - fee);
  return { coin: COIN.id, decimals: 5, heldRaw: HELD.toString(), amountRaw: amount.toString(), quoteRaw: quote.toString(), floorRaw: ((quote * 99n) / 100n).toString(), feeBps: 100, feeRaw: fee.toString(), feeSolRaw: (worth(amount) - quote).toString() };
}

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
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: NET, active: true, budgetLamports: MAINNET ? "80000000" : "200000000" }));
    await context.route(/\/api\/bots\/mandate\/agent/, (route) => json(route, VIEW));
    await context.route(/\/api\/bots\/mandate\/sell$/, (route) => {
      const share = JSON.parse(route.request().postData() ?? "{}").share ?? 100;
      return json(route, { network: NET, record: { ...RECORD, policy: SALE_POLICY }, transactions: [], figures: figures(share) });
    });
    await context.route(/\/api\/solana\/holdings/, (route) =>
      json(route, {
        data: {
          tokenRead: "COMPLETE",
          holdings: [
            { kind: "NATIVE_SOL", mint: null, amountRaw: "2415000000", spendableRaw: "2405000000", decimals: 9, symbol: "SOL" },
            { kind: "SPL_TOKEN", mint: COIN.id, amountRaw: HELD.toString(), spendableRaw: HELD.toString(), decimals: 5, symbol: "Bonk" },
          ],
        },
      }),
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
    await page.waitForFunction(() => typeof window.__sell?.setState === "function" && typeof window.__autopilot?.setState === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 600_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    await page.evaluate(
      ({ wallet, record, chain }) => {
        window.__autopilotMandate.setState({ hydrated: true, records: { [wallet]: record }, status: {}, busy: null, note: null, preset: chain === "solana:mainnet" ? "small" : "medium" });
        // A public address seated as the connected wallet: the window reads it, nothing can sign with it.
        window.__autopilotWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: [chain] }, holdings: null, holdingsRead: "none" });
      },
      { wallet: WALLET, record: RECORD, chain: `solana:${NET}` },
    );

    // 1 · the tower's window: «Your agent holds», all of it priced — what she gets at least, Ryntra's fee.
    await page.evaluate((mint) => window.__city.getState().select(mint), COIN.id);
    await page.locator("[data-agent-sell] [data-sell-fee]").waitFor({ timeout: 300_000 });
    await shot("window-all");
    // 2 · half of it, priced again.
    await page.locator("[data-sell-share='50']").click();
    await page.locator("[data-agent-sell] [data-sell-fee]").waitFor({ timeout: 60_000 });
    await shot("half");
    // 3 · how it works, behind «i».
    await page.locator("[data-sell-info]").click();
    await page.locator("[data-sell-details]").waitFor({ timeout: 30_000 });
    await shot("details");
    await page.locator("[data-sell-info]").click();
    // 4 · signed once, the agent sold: the receipt in one line, the sale a tap away (the devnet pass's own sale); the agent
    //     holds the other half.
    await page.evaluate(({ policy, view }) => window.__autopilot.getState().setView(policy, view), { policy: RECORD.policy, view: { ...VIEW, heldRaw: (HELD / 2n).toString() } });
    await page.evaluate((sale) => window.__sell.setState({ phase: "done", quote: null, receipt: sale }), {
      policy: SALE_POLICY,
      status: "sold",
      signature: "2QqhrU3bKzRwyPkqWRVLexfNunwioz8ZEdWFXq3SDYQ7AU6Yg94WH7o6Dd8LL4BCCtmxUd6jC4FiPJB57utM8odk",
      soldRaw: (HELD / 2n).toString(),
      receivedRaw: figures(50).quoteRaw,
      reason: null,
    });
    await page.locator("[data-sell-receipt='sold']").waitFor({ timeout: 30_000 });
    await shot("sold");
    // 5 · not sold — the price moved: the coin waits, «Take it back» is one signature.
    await page.evaluate((sale) => window.__sell.setState({ phase: "done", quote: null, receipt: sale }), { policy: SALE_POLICY, status: "failed", signature: null, soldRaw: (HELD / 2n).toString(), receivedRaw: null, reason: "the price fell under your floor" });
    await page.locator("[data-sell-back]").waitFor({ timeout: 30_000 });
    await shot("not-sold");

    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
