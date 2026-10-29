// «Mine»'s screens for review, at 390×844 and 1440×860 → <out>/mine-<state>-<size>.png
//   node city/lib/trade/mine-shots.mjs [out] [baseUrl]      (npm run dev running)
// No wallet and no keys: a stub wallet registers through the Wallet Standard events and comes back silently, as a wallet
// this site was granted does; it signs nothing. The engine's holdings and history routes answer with fixtures, so the
// figures on these screens are fixtures; the live pass with a real wallet is done on production.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/mine-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const named = snapshot.towers.filter((t) => t.verified && t.id !== SOL_MINT && t.id !== USDC_MINT && t.price > 0);
const [first, second, third] = named;
const raw = (usd, price, decimals) => BigInt(Math.floor((usd / price) * 10 ** decimals)).toString();
const COINS = [
  { mint: first.id, decimals: 6, raw: raw(412, first.price, 6) },
  { mint: second.id, decimals: 6, raw: raw(96.5, second.price, 6) },
  { mint: third.id, decimals: 6, raw: raw(18.2, third.price, 6) },
];
// What the first coin cost through Ryntra: a fifth less than it is worth now.
const BOUGHT = [{ key: "BUY:sig1", kind: "BUY", mint: first.id, costMicros: String(Math.round(330 * 1e6)), quantityRaw: COINS[0].raw, decimals: 6 }];

const ALL = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1440, height: 860, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

// PRESS_CHROME may point at a Chromium, as for the city's own screens.
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

/** One page with the stub wallet and the routes answering as `scene` says. */
async function open(size, scene) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(({ taker }) => {
    window.localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
        "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { taker: TAKER });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/holdings", (route) =>
    scene.holdings === "failed"
      ? json(route, 503, { error: { code: "UNAVAILABLE", message: "RPC unavailable" } })
      : json(route, 200, {
          data: {
            tokenRead: "COMPLETE",
            holdings: [
              { kind: "NATIVE_SOL", mint: null, spendableRaw: "2400000000", decimals: 9 },
              ...(scene.holdings === "empty" ? [] : COINS.map((c) => ({ kind: "TOKEN", mint: c.mint, spendableRaw: c.raw, decimals: c.decimals }))),
            ],
          },
        }),
  );
  await page.route("**/api/growth/cards?*", (route) => {
    if (!scene.proven) return json(route, 401, { error: "proof required", proof: false });
    const mint = new URL(route.request().url()).searchParams.get("mint");
    return json(route, 200, { complete: true, trades: BOUGHT.filter((t) => t.mint === mint) });
  });
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  return { page, context, errors };
}

const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const report = [];

for (const size of SIZES) {
  const shot = (page, state) => page.screenshot({ path: path.join(out, `mine-${state}-${size.name}.png`) });

  // Not proven in this browser: values and 24-hour moves, and the one tap for «since you bought».
  {
    const { page, context, errors } = await open(size, { proven: false });
    const pill = page.getByRole("button", { name: /^Mine,/ });
    await pill.waitFor({ timeout: 20_000 });
    await shot(page, "pill");
    await pill.click();
    await page.waitForTimeout(3000);
    await shot(page, "day");
    report.push(`${size.name} day: overflow=${await overflowOf(page)}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 2).join(" | ").slice(0, 300) : ""}`);
    // Sell from the panel: the trade card opens on selling, the panel steps aside.
    await page.getByRole("button", { name: `Sell $${first.symbol}` }).click();
    await page.waitForTimeout(2500);
    await shot(page, "sell");
    report.push(`${size.name} sell: side=${await page.getByRole("tab", { name: "Sell" }).getAttribute("aria-selected")} overflow=${await overflowOf(page)}px`);
    await context.close();
  }

  // Proven: the first coin's cost is on record, the others say their 24 hours.
  {
    const { page, context, errors } = await open(size, { proven: true });
    await page.getByRole("button", { name: /^Mine,/ }).click();
    await page.waitForTimeout(3000);
    await shot(page, "bought");
    report.push(`${size.name} bought: overflow=${await overflowOf(page)}px errors=${errors.length}`);
    await context.close();
  }

  if (size.mobile) {
    for (const holdings of ["empty", "failed"]) {
      const { page, context } = await open(size, { proven: true, holdings });
      await page.getByRole("button", { name: /^Mine/ }).click();
      await page.waitForTimeout(1500);
      await shot(page, holdings);
      report.push(`${size.name} ${holdings}: overflow=${await overflowOf(page)}px`);
      await context.close();
    }
  }
}
console.log(report.join("\n"));
await browser.close();
