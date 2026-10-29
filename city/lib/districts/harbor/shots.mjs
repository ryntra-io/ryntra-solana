// The Harbor's screens for review, at 1440×860 and 390×844 → <out>/harbor-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open npm run dev, then: node city/lib/districts/harbor/shots.mjs [out] [baseUrl]
// No wallet and no keys are needed: a stub wallet registers through the Wallet Standard events (it signs nothing real).
// The pools are the engine's own recorded Meteora catalogue (16.10); the pool routes answer with Reviews and positions
// shaped like the engine's. The figures on these screens are fixtures; the live pass with a real wallet is the owner's.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { harborPools } from "./pools.ts";
import { addReview, CATALOG, positionView, wire } from "./test-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "out/harbor-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const POOLS = harborPools(CATALOG);
const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `harbor-${state}-${size.name}.png`) });

  // One stub wallet; signing waits until the script lets it go.
  await page.addInitScript(({ owner }) => {
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    let release = null;
    window.__releaseSignature = () => release?.();
    const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async (input) => (input?.silent ? { accounts: [] } : ((wallet.accounts = [account]), { accounts: [account] })) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs) => {
            await new Promise((resolve) => (release = resolve));
            return inputs.map(({ transaction }) => {
              const signed = new Uint8Array(transaction);
              signed.fill(7, 1, 65);
              return { signedTransaction: signed };
            });
          },
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { owner: OWNER });

  let added = false;
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/city/harbor", (route) => json(route, 200, { pools: POOLS, at: "2026-10-16T09:12:00.000Z" }));
  await page.route("**/api/liquidity/actions?*", (route) => json(route, 200, { add: { status: "on" }, remove: { status: "on" }, claim: { status: "on" }, maxDepositUsd: null }));
  await page.route("**/api/liquidity/positions?*", (route) =>
    json(route, 200, {
      owner: OWNER,
      positions: [
        positionView({ x: { ...positionView().x, unclaimed: 0.00412 }, y: { ...positionView().y, unclaimed: 0.62 }, unclaimedUsd: 1.04, valueUsd: 251.3 }),
        positionView({ address: "9xPositionTwo", pool: POOLS[2].address, name: "TRUMP-USDC", x: { mint: POOLS[2].x.mint, symbol: "TRUMP", amount: 6, unclaimed: 0, priceUsd: 1.81 }, y: { ...positionView().y, unclaimed: 0 }, rangeState: "above", valueUsd: 10.9, unclaimedUsd: 0 }),
        ...(added ? [positionView({ address: "7xNewPosition", unclaimedUsd: 0, valueUsd: 49.8, x: { ...positionView().x, unclaimed: 0 }, y: { ...positionView().y, unclaimed: 0 } })] : []),
      ],
      venues: { dlmm: { ok: true }, "damm-v2": { ok: true } },
      at: Date.now(),
    }),
  );
  await page.route("**/api/liquidity/review", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 600));
    const review = addReview({ signableMs: 25_000, transactions: [{ wireBase64: wire(1), presigned: [] }] });
    if (body.action === "add") {
      review.preview.deposit = { x: { asset: POOLS[0].x.mint, units: body.request.amountX, decimals: 9 }, y: { asset: POOLS[0].y.mint, units: body.request.amountY, decimals: 6 } };
    } else if (body.action === "claim") {
      review.preview = { ...review.preview, action: "claim", claimed: { x: { units: "4120000", decimals: 9 }, y: { units: "620000", decimals: 6 } }, rent: [], notices: [] };
    }
    json(route, 200, review);
  });
  await page.route("**/api/liquidity/submit", (route) => {
    added = true;
    const signed = route.request().postDataJSON().signed;
    json(route, 200, { results: signed.map(() => ({ signature: "4hXbMVF2Kz9nqPYmEWZg2cRrTn8L1vU5sQ7xDdA3jJbCkN6tHfW9yGmPeR2oZaLs8iUq1BcVvXxY4wT7nM5pDkE", state: "LANDED", reason: null })), settled: true });
  });
  await page.route("**/api/solana/holdings*", (route) =>
    json(route, 200, {
      data: {
        tokenRead: "COMPLETE",
        holdings: [
          { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 },
          { kind: "TOKEN", mint: POOLS[0].y.mint, amountRaw: "184000000", spendableRaw: "184000000", decimals: 6 },
        ],
      },
    }),
  );

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.getByRole("button", { name: "Harbor", exact: true }).click();
  await page.waitForTimeout(1500);
  await shot("pools");
  const sheet = page.getByRole("dialog", { name: "Harbor" });

  await sheet.getByRole("button", { name: /SOL-USDC/ }).first().click();
  await page.waitForTimeout(1000);
  await shot("card");

  await sheet.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForTimeout(800);
  const pick = sheet.getByRole("button", { name: "Phantom" });
  if (await pick.count()) await pick.click();
  await page.waitForTimeout(2500);
  await sheet.getByRole("radio", { name: "$50" }).click();
  await page.waitForTimeout(2000);
  await shot("review");

  await sheet.getByRole("button", { name: "Add liquidity" }).click();
  await page.waitForTimeout(700);
  await shot("confirm");
  await page.evaluate(() => window.__releaseSignature());
  await page.waitForTimeout(2500);
  await shot("done");

  await sheet.getByRole("button", { name: "Back to the city" }).click();
  await page.waitForTimeout(3500);
  await shot("glow");
  // The tower card of the lit tower is open: close it to reach the dock again.
  await page.getByRole("button", { name: "Close" }).first().click();
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "Harbor", exact: true }).click();
  await page.waitForTimeout(800);
  await sheet.getByRole("tab", { name: /Mine/ }).click();
  await page.waitForTimeout(1200);
  await shot("mine");
  await sheet.getByRole("button", { name: "Take fees" }).first().click();
  await page.waitForTimeout(1500);
  await shot("claim");

  console.log(`${size.name}: overflow=${overflow}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
  await context.close();
}
await browser.close();
