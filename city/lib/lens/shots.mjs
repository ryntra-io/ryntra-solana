// The Lens (CITY-86) for review, from the live city: every chip at 1440×900 and 390×844 → <out>/lens-<chip>-<size>.png
//   npm run dev      then      node city/lib/lens/shots.mjs [out] [baseUrl]
// The PR's frames, made so and saved as JPEG, are city/lib/lens/shots/.
// No keys and no signatures: a stub wallet registers through the Wallet Standard events and comes back silently, and
// `/api/solana/holdings` answers with a fixture of a few coins the city stands, so «Mine» has towers to show. The
// engine's listed companies are its own answer when it gives one, else a fixture of two xStocks mints. Every figure on
// the city is the bundled or live market's; the fixtures only say which towers a wallet holds.
// STILL=1 also shoots «Memes» with «Flashing effects» off — the switch a device asking for reduced motion starts with
// (city/lib/feed/motion.ts): the light changes, nothing moves. Set through the kept setting rather than the media query:
// the software GL of a cloud session stalls compiling the city's shaders under the emulated query.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/lens-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const HELD = [
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // JUP
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // Bonk
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", // $WIF
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", // POPCAT
  "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", // TSLAx
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // JitoSOL
];
const STOCKS = { companies: [{ mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" }, { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" }], order: "volume-24h", fetchedAt: new Date().toISOString() };
const CHIPS = [
  ["all", "All"],
  ["crypto", "Crypto"],
  ["memes", "Memes"],
  ["stocks", "Stocks"],
  ["new", "New"],
  ["mine", "Mine"],
];
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const ONLY = process.env.CHIPS ? CHIPS.filter(([id]) => process.env.CHIPS.split(",").includes(id)) : CHIPS;

const gl = process.env.PRESS_CHROME ? ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] : ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || process.env.CHROME || undefined, args: gl });

async function open(size, { still = false } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(({ owner, still }) => {
    window.localStorage.setItem("ryntra.city.firstHint", "1");
    if (still) window.localStorage.setItem("ryntra.city.feed", JSON.stringify({ flashing: false }));
    window.localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
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
  }, { owner: OWNER, still });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/holdings", (route) =>
    json(route, 200, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", spendableRaw: "2500000000", decimals: 9 }, ...HELD.map((mint) => ({ kind: "TOKEN", mint, spendableRaw: "1000000", decimals: 6 }))] } }),
  );
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/v1/stocks/popular*", async (route) => {
    const answer = await route.fetch().catch(() => null);
    if (answer?.ok()) return route.fulfill({ response: answer });
    return json(route, 200, STOCKS);
  });
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => typeof window.__lens?.getState === "function" && (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 180_000 });
  await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: Number(process.env.SKYLINE_WAIT ?? 120_000) }).catch(() => {});
  await page.evaluate(() => window.__city.getState().enter());
  await page.waitForTimeout(6000);
  // The first visit's welcome steps aside, as a visitor would send it.
  for (const name of [/^Later$/, /^Close the Arrivals card$/]) {
    const later = page.getByRole("button", { name });
    if (await later.first().isVisible().catch(() => false)) await later.first().click();
  }
  return { page, context, errors };
}

const report = [];
for (const size of SIZES) {
  const { page, context, errors } = await open(size);
  for (const [id, label] of ONLY) {
    await page.locator("[data-city-lens]").getByRole("button", { name: new RegExp(`^${label}`) }).click();
    // 700 ms of the lens and the camera's own glide; a software GL draws slowly.
    await page.waitForTimeout(Number(process.env.SETTLE ?? 7000));
    const file = `lens-${id}-${size.name}.png`;
    await page.screenshot({ path: path.join(out, file) });
    const state = await page.evaluate(() => ({ lens: window.__lens.getState().lens, kept: localStorage.getItem("ryntra.city.lens"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    const chip = await page.locator("[data-city-lens] [aria-pressed=true]").innerText();
    const box = await page.locator("[data-city-lens] button").first().boundingBox();
    report.push({ size: size.name, id, file, chip: chip.replace(/\s+/g, " "), targetHeight: box?.height, ...state });
  }
  report.push({ size: size.name, errors });
  await context.close();
}
if (process.env.STILL) {
  const { page, context, errors } = await open(ALL[0], { still: true });
  await page.locator("[data-city-lens]").getByRole("button", { name: /^Memes/ }).click();
  await page.waitForTimeout(Number(process.env.SETTLE ?? 7000));
  await page.screenshot({ path: path.join(out, "lens-memes-desk-still.png") });
  report.push({ size: "desk", id: "memes-still", errors });
  await context.close();
}
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
