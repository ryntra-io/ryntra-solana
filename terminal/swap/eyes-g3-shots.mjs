// «Обмін» і «Міст» після огляду очима 20.11 (вади 17–20) — кадри столу 1440×900 і телефона 390×844, EN і UK → <out>/*.jpg
//   node terminal/swap/eyes-g3-shots.mjs <out> <baseUrl>
// `baseUrl` — стенд `next build` + `next start` з відкритим терміналом і грошима (`NEXT_PUBLIC_RYNTRA_TERMINAL=open`,
// `NEXT_PUBLIC_RYNTRA_CITY_MONEY=open`). Ціна обміну — записана відповідь двигуна (золоті транскрипти маршруту); мережі
// мосту — список у формі відповіді двигуна; жодного гаманця, нічого не підписується й не надсилається. Без мережі стенду
// до Relay й Jupiter логотипи стоять літерами — наживо вони справжні.
//   swap-priced  — ціна прийшла: плитки пари з фактами;
//   swap-pricing — ціна в дорозі: «Отримаєш» і рядок умов мерехтять на своїх місцях;
//   bridge       — «Міст» без переказів: «Мої перекази» й «У Solana»; bridge-how — відкрите «i» у формі.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/eyes-g3");
const base = process.argv[3] ?? "http://localhost:3113";
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const recorded = golden["quote: SOL to USDT with the referral fee"].steps.at(-1).body;
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA = 792703809;
const EVM_NATIVE = "0x0000000000000000000000000000000000000000";

/** The pair's figures as the engine's market answers them by mint (`/api/v1/market/depth`) — a stand-in of the same shape. */
const depthCoin = (id, symbol, name, price, mcap, liquidity, volume, change) => ({
  id, symbol, name, icon: null, price, mcap, liquidity, holders: null, organic: null, verified: true, stock: false, kind: "crypto", stable: symbol === "USDC",
  launchpad: null, venue: null, copyOf: null, bornAt: null, mint: "renounced", freeze: "renounced", topHolders: null,
  stats: { "5m": null, "1h": null, "6h": null, "24h": { change, volume, buys: null, sells: null, traders: null } },
});
const DEPTH = { list: "saved", kind: "all", window: "24h", coins: [depthCoin(SOL, "SOL", "Wrapped SOL", 141.32, 76_800_000_000, 412_000_000, 3_140_000_000, 1.84), depthCoin(USDC, "USDC", "USD Coin", 1, 74_100_000_000, 1_020_000_000, 5_210_000_000, 0.01)] };

const token = (chainId, address, symbol, name, decimals) => ({ chainId, address, symbol, name, decimals, verified: true, logo: true });
const chain = (id, label, vm, native, over = {}) => ({ id, name: label.toLowerCase(), label, vm, wallet: vm === "svm" ? "solana" : "evm", owner: vm === "svm" ? "solana" : "evm", send: true, deposit: true, explorer: null, native, featured: [], ...over });
const CHAINS = {
  chains: [
    chain(SOLANA, "Solana", "svm", token(SOLANA, "11111111111111111111111111111111", "SOL", "Solana", 9)),
    chain(1, "Ethereum", "evm", token(1, EVM_NATIVE, "ETH", "Ether", 18)),
    chain(8453, "Base", "evm", token(8453, EVM_NATIVE, "ETH", "Ether", 18)),
    chain(42161, "Arbitrum", "evm", token(42161, EVM_NATIVE, "ETH", "Ether", 18)),
    chain(56, "BNB Chain", "evm", token(56, EVM_NATIVE, "BNB", "BNB", 18)),
    chain(137, "Polygon", "evm", token(137, EVM_NATIVE, "POL", "Polygon", 18)),
  ],
};

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    for (const scene of ["swap-priced", "swap-pricing", "bridge", "bridge-how"]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: 2, locale: lang === "uk" ? "uk-UA" : "en-US" });
      await context.route("**/api/solana/swap/quote", async (route) => {
        if (scene === "swap-pricing") return; // on its way: never answered while the frame is taken
        const input = route.request().postDataJSON();
        const body = structuredClone(recorded);
        // The recorded answer for the pair asked: 10 USDC → SOL at the stand-in market's price, fee 0.1 %.
        Object.assign(body.order, { inputMint: input.inputMint, outputMint: input.outputMint, inAmountRaw: input.amountRaw, outAmountRaw: "70695400", minReceivedRaw: "70342000" });
        body.order.ryntraFee = { ...body.order.ryntraFee, basisPoints: 10 };
        body.decimals = { [input.inputMint]: 6, [input.outputMint]: 9 };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      });
      await context.route("**/api/v1/market/depth*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DEPTH) }));
      await context.route("**/api/swap/bridge/chains", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CHAINS) }));
      await context.route("**/api/swap/bridge/quote", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
      const page = await context.newPage();
      const where = scene.startsWith("bridge") ? "/bridge" : "/swap";
      await page.goto(`${base}${where}?lang=${lang}`, { waitUntil: "load", timeout: 120_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 30_000 });
      await page.waitForTimeout(2500);
      if (scene === "bridge-how") {
        await page.locator("[data-bridge-screen] button[aria-expanded]").first().click();
        await page.waitForTimeout(400);
      }
      await page.screenshot({ path: path.join(out, `${scene}-${size.name}-${lang}.jpg`), quality: 72, type: "jpeg" });
      console.log(`${scene}-${size.name}-${lang}`);
      await context.close();
    }
  }
}
await browser.close();
