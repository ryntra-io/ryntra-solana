// Liquidity on the coin's own screen, for the eyes: the coin's pools under its chart, the person's own pools,
// Earn's ticket in a drawer on the spot, and the quiet «Earn on it» after a buy → <out>/<state>-<size>-<lang>.jpg
//   node terminal/coin/earn-here/shots.mjs [out] [baseUrl]        SIZES=d1920,d1440,t820,phone  LANGS=en,uk  STATES=before|after
//   QUICK=1 — only the JUP part of «after»: its pools, the drawer, and «My pools» with nothing in them.
// A stand: NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open
// `next dev` (the dev server lets the shot put a finished buy on the ticket — a stand-only hook into the trade card's
// store, never a trade). Every read is answered from a fixture shaped as the engine answers (no network): the coin's
// market, the catalogue of Meteora pools, the city's own pools, the wallet's balances, its pool position and what it
// may do. The wallet is a stub of the Wallet Standard that connects and never signs. Nothing is sent.
// In a container whose Playwright differs from the project's, PRESS_CHROME names the browser.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-390");
const base = process.argv[3] ?? "http://localhost:3390";
const STATE = process.env.STATES ?? "after";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SOL_USD = 140;
const JUP_USD = 0.52;

const coin = (mint, symbol) => ({ mint, symbol, verified: true });
const SYM = { [SOL]: "SOL", [USDC]: "USDC", [JUP]: "JUP", [JITO]: "JitoSOL" };
const pool = (kind, address, x, y, tvlUsd, volume24hUsd, fees24hUsd, feePct, binStepBps) => ({
  kind, address, x: coin(x, SYM[x]), y: coin(y, SYM[y]), tvlUsd, volume24hUsd, fees24hUsd,
  feeTvl24hPct: (fees24hUsd / tvlUsd) * 100, baseFeePct: feePct, feePct, binStepBps, createdAt: "2025-03-01T00:00:00Z",
  page: `https://app.meteora.ag/pools/${address}`,
});
const SOL_USDC = "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y";
const JITO_SOL = "BoeMUkCLHchTD31HdXsbDExuZZfcUppSLpYtV3LZTH6U";
const CATALOG = [
  pool("dlmm", SOL_USDC, SOL, USDC, 38_400_000, 121_000_000, 96_400, 0.04, 4),
  pool("dlmm", JITO_SOL, JITO, SOL, 12_100_000, 8_300_000, 4_100, 0.05, 1),
  pool("dlmm", "C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg", JUP, SOL, 4_210_000, 9_820_000, 18_400, 0.12, 10),
  pool("dlmm", "6shkv2VNBPWVABvShgcGmrv98Z1vR3EcdwND6XbMoS1x", JUP, USDC, 2_640_000, 5_140_000, 9_200, 0.2, 20),
  pool("damm-v2", "7mQeNBCLwW2ZWHPjYPbAMk5rpvKZXoHqAPd2RSvzoZYW", JUP, USDC, 1_120_000, 1_930_000, 4_820, 0.25, null),
  pool("damm-v2", "Hq2pN1vtDBUBV4w2gq9bRk6LGxtTAnJQzSv7cGC2DnRo", JUP, SOL, 418_000, 604_000, 1_510, 0.3, null),
];
const harbor = (address, x, y, price, tvlUsd, volume24hUsd, fees24hUsd, feePct, binStepBps) => ({
  kind: "dlmm", address, pair: `${SYM[x]}-${SYM[y]}`,
  x: { mint: x, symbol: SYM[x], decimals: x === USDC ? 6 : 9, priceUsd: x === USDC ? 1 : x === JITO ? 168 : SOL_USD },
  y: { mint: y, symbol: SYM[y], decimals: y === USDC ? 6 : 9, priceUsd: y === USDC ? 1 : SOL_USD },
  price, tvlUsd, volume24hUsd, fees24hUsd, lpFees24hUsd: fees24hUsd * 0.95, feePct, binStepBps, band: null,
});
const PIERS = [harbor(SOL_USDC, SOL, USDC, SOL_USD, 38_400_000, 121_000_000, 96_400, 0.04, 4), harbor(JITO_SOL, JITO, SOL, 1.2, 12_100_000, 8_300_000, 4_100, 0.05, 1)];
const POSITION = {
  kind: "dlmm", address: "9vPos1tionSoLUsdc1111111111111111111111111", pool: SOL_USDC, name: "SOL-USDC",
  x: { mint: SOL, symbol: "SOL", amount: 1.84, unclaimed: 0.0061, priceUsd: SOL_USD },
  y: { mint: USDC, symbol: "USDC", amount: 241.3, unclaimed: 0.94, priceUsd: 1 },
  rangeState: "in_range", lower: 128.4, upper: 151.9, price: SOL_USD, valueUsd: 498.9, unclaimedUsd: 1.79,
  lockedBps: 0, feesElsewhere: false, hasRewards: false, slot: 1, at: Date.now(), pricesAt: new Date().toISOString(),
};

const stats = (pct) => ({ priceChangePct: pct, volumeUsd: 42_500_000, buys: 19000, sells: 17000, traders: 21_000 });
const marketOf = (mint) => {
  const sol = mint === SOL;
  const price = sol ? SOL_USD : JUP_USD;
  return {
    mint, symbol: sol ? "SOL" : "JUP", name: sol ? "Solana" : "Jupiter", icon: null, decimals: sol ? 9 : 6, tokenProgram: null, verified: true, tags: [], category: "token", issuer: null,
    price, change1hPct: 0.4, change24hPct: 2.1, volume24hUsd: 42_500_000, liquidityUsd: 18_200_000,
    marketCapUsd: price * (sol ? 540_000_000 : 3_100_000_000), fdvUsd: price * (sol ? 600_000_000 : 7_000_000_000), holders: 812_000, organicScore: 96, organicScoreLabel: "high", firstPoolAt: "2024-01-31T00:00:00Z",
    audit: { devBalancePct: 0, topHoldersPct: 22.4, mintAuthorityDisabled: true, freezeAuthorityDisabled: true, suspicious: false },
    links: { website: null, twitter: null, telegram: null },
    stats: { h1: stats(0.4), h24: stats(2.1) },
    updatedAt: new Date().toISOString(),
  };
};

const ALL = [
  { name: "d1920", width: 1920, height: 1080, mobile: false },
  { name: "d1440", width: 1440, height: 900, mobile: false },
  { name: "t820", width: 820, height: 1180, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = ALL.filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const W = {
  en: { pools: "Pools", mine: "My pools", mineView: "Mine", connect: "Connect wallet", buy: /^Buy/, add: "Add", view: "View", take: "Take", earn: "Earn on it", close: "Close" },
  uk: { pools: "Пули", mine: "Мої пули", mineView: "Мої", connect: "Підключити гаманець", buy: /^Купити/, add: "Додати", view: "Огляд", take: "Забрати", earn: "Заробляти на ній", close: "Закрити" },
};
const report = [];
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});

for (const size of SIZES) {
  for (const lang of LANGS) {
    const w = W[lang];
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("ryntra.city.lang", value);
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
    }, lang);
    let connected = false;
    await context.route("**/api/**", (route) => json(route, 503, {}));
    await context.route("**/api/spot/market?*", (route) => json(route, 200, { market: marketOf(new URL(route.request().url()).searchParams.get("mint")) }));
    await context.route("**/api/v1/earn/pools", (route) => json(route, 200, { pools: CATALOG, lend: [], at: new Date().toISOString(), sources: { dlmm: true, dammV2: true, lend: false } }));
    await context.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: PIERS, at: new Date().toISOString() }));
    await context.route("**/api/city/earn/piers/admit*", (route) => json(route, 200, { add: "on", exit: "on", ceilingUsd: null, stopped: false }));
    await context.route("**/api/liquidity/positions*", (route) => json(route, 200, { owner: TAKER, positions: [POSITION], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
    await context.route("**/api/solana/holdings*", (route) =>
      connected
        ? json(route, 200, {
            data: {
              tokenRead: "COMPLETE",
              holdings: [
                { kind: "NATIVE_SOL", mint: null, amountRaw: "4210000000", spendableRaw: "4200000000", decimals: 9 },
                { kind: "TOKEN", mint: JUP, amountRaw: "1250000000", spendableRaw: "1250000000", decimals: 6, symbol: "JUP" },
                { kind: "TOKEN", mint: USDC, amountRaw: "312000000", spendableRaw: "312000000", decimals: 6, symbol: "USDC" },
              ],
            },
          })
        : json(route, 503, {}),
    );
    await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
    await page.addInitScript(({ taker }) => {
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
      const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      const wallet = {
        version: "1.0.0", name: "Phantom", icon, chains: ["solana:mainnet"], accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async (input) => (input?.silent ? { accounts: [] } : ((wallet.accounts = [account]), { accounts: [account] })) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { taker: TAKER });

    const tag = `${size.name}-${lang}`;
    const shot = async (name) => {
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(out, `${name}-${tag}.jpg`), type: "jpeg", quality: 84 });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      report.push(`${name}-${tag}: sideways ${sideways}px`);
    };
    const open = async (mint) => {
      await page.goto(`${base}/coin/${mint}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(5000);
    };
    const connect = async () => {
      connected = true;
      // A phone connects from the frame's own wallet control in the header; a desk from the ticket.
      const button = size.mobile ? page.locator("[data-terminal='wallet']").first() : page.getByRole("button", { name: w.connect }).first();
      if (await button.count()) {
        await button.click().catch(() => {});
        await page.waitForTimeout(800);
        const phantom = page.getByRole("button", { name: "Phantom" }).first();
        if (await phantom.count()) await phantom.click().catch(() => {});
      }
      await page.waitForTimeout(3000);
      // The wallet's own menu, opened by the connect, is put away.
      await page.keyboard.press("Escape").catch(() => {});
      await page.mouse.click(size.width / 2, size.height - 4).catch(() => {});
      await page.waitForTimeout(500);
      report.push(`wallet-${size.name}-${lang}: ${await page.locator("[data-terminal='wallet']").first().innerText().catch(() => "?")}`);
    };
    const tab = async (name) => {
      const it = page.getByRole("tab", { name, exact: true }).first();
      if (await it.count()) await it.click().catch(() => {});
      await page.waitForTimeout(2500);
    };
    const drawer = () => page.locator("[data-earn-here='drawer']");
    const shut = async () => {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    };

    // JUP: the coin's pools — DLMM and DAMM v2 of the catalogue; none takes a deposit from the city here.
    await open(JUP);
    await connect();
    if (STATE === "before") {
      await shot("before-jup");
    } else {
      await tab(w.pools);
      await shot("pools-jup");
      const view = page.locator("[data-earn-here-act='view']").first();
      if (await view.count()) {
        await view.click();
        await drawer().waitFor({ timeout: 15_000 }).catch(() => {});
        await shot("drawer-view-jup");
        await shut();
      }
      // «My pools» with no position in the coin: one calm line and the quiet way to the pools.
      if (size.mobile) await tab(w.mineView);
      await tab(w.mine);
      await shot("mine-empty-jup");
      if (process.env.QUICK === "1") {
        report.push(`errors-${tag}: ${errors.join(" | ") || "none"}`);
        await context.close();
        continue;
      }
    }

    // SOL: the city's SOL · USDC pool takes a deposit — «Add» opens Earn's own pool ticket on the spot; «My pools» holds
    // the wallet's position, and «Take» opens its ticket.
    await open(SOL);
    await connect();
    if (STATE === "before") {
      await shot("before-sol");
    } else {
      await tab(w.pools);
      await shot("pools-sol");
      const add = page.locator("[data-earn-here-act='add']").first();
      if (await add.count()) {
        await add.click();
        await drawer().waitFor({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await shot("drawer-add-sol");
        await shut();
      }
      if (size.mobile) await tab(w.mineView);
      await tab(w.mine);
      await shot("mine-sol");
      const take = page.locator("[data-earn-here-act='take']").first();
      if (await take.count()) {
        await take.click();
        await drawer().waitFor({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await shot("drawer-take-sol");
        await shut();
      }

      // A finished buy of JUP on the ticket (the stand's dev hook into the trade card's own store — nothing is traded):
      // the quiet «Earn on it» under «New trade», and the drawer it opens.
      await open(JUP);
      await connect();
      const put = await page.evaluate(({ jup, sol }) => {
        const chunk = window.webpackChunk_N_E;
        if (!chunk) return "no chunks";
        let req = null;
        chunk.push([[Symbol("shot")], {}, (r) => (req = r)]);
        const id = req && Object.keys(req.c).find((key) => key.endsWith("city/lib/trade/store.ts"));
        if (!id) return "no store";
        const { useTrade } = req(id);
        const tower = useTrade.getState().tower ?? { mint: jup, symbol: "JUP", name: "Jupiter", icon: null };
        useTrade.setState({
          phase: "done",
          done: {
            trade: { signature: "5hotSignature1111111111111111111111111111111111111111111111111111111111111111111111", inputMint: sol, outputMint: jup, inputRaw: "500000000", outputRaw: "134615384" },
            side: "buy",
            tower,
            pay: { mint: sol, symbol: "SOL", decimals: 9 },
            decimals: { [sol]: 9, [jup]: 6 },
          },
        });
        return "ok";
      }, { jup: JUP, sol: SOL });
      report.push(`done-${tag}: ${put}`);
      if (size.mobile) {
        await page.locator("button[data-side='buy']").first().tap().catch(() => {});
        await page.waitForTimeout(800);
      }
      await shot("bought-jup");
      const earn = page.locator("[data-ticket='earn-on']:visible").first();
      if (await earn.count()) {
        await earn.click();
        await drawer().waitFor({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await shot("earn-on-it-jup");
      } else report.push(`earn-${tag}: no «${w.earn}»`);
    }
    report.push(`errors-${tag}: ${errors.join(" | ") || "none"}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, `report-${STATE}.txt`), report.join("\n") + "\n");
console.log(report.join("\n"));
