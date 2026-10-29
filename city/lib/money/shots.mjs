// The Money window's screens for review (CITY-63), at 1440×860 and 390×844 → <out>/money-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_MONEY=open npm run dev      then      node city/lib/money/shots.mjs [out] [baseUrl]
//   CLOSED=1 node city/lib/money/shots.mjs [out]         — against a server without the switch: Send and Bridge closed
// No wallet and no keys: a stub wallet registers through the Wallet Standard events and comes back silently, as a wallet
// this site was granted does; it signs nothing. The engine's routes answer with fixtures, so every figure on these
// screens is a fixture; the live pass with a real wallet is the owner's canary on production.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/money-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const CLOSED = process.env.CLOSED === "1";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const FRIEND = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const EVM = "0x7a16fF8270133F063aAb6C9977183D9e72835428";
const DEPOSIT = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const SIGNATURE = "3vZ8sRkd2kN9mEJcVJbW7K1yC6p8oQGJ4fH2Lr9aT5XqBnU8wYeD3sP6mZ1cR4tV7hK9jN2gF5xL8bQ3dW6eA1s";

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "3415000000", spendableRaw: "3405000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: "176.4" } },
  { kind: "TOKEN", mint: USDC, amountRaw: "248120000", spendableRaw: "248120000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1" } },
  { kind: "TOKEN", mint: JUP, amountRaw: "36230000", spendableRaw: "36230000", decimals: 6, catalog: { symbol: "JUP", name: "Jupiter", isVerified: true, usdPrice: "0.82" } },
  { kind: "TOKEN", mint: BONK, amountRaw: "152000000000", spendableRaw: "152000000000", decimals: 5, catalog: { symbol: "Bonk", name: "Bonk", isVerified: true, usdPrice: "0.0000213" } },
];

const PLAN = {
  passport: null,
  preflight: { simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "6200" }, estimatedReceivedRaw: "25000000" },
  verdict: { verdict: "NO_KNOWN_BLOCKER" },
  plan: { network: "mainnet", actionKind: "SPL_TRANSFER", sender: OWNER, recipient: FRIEND, mint: USDC, amountRaw: "25000000", decimals: 6, baseFeeLamports: "5000", priorityFeeLamports: "1200", unsignedWireBase64: "AQAB", fingerprint: { messageHash: `0x${"ab".repeat(32)}`, feePayer: OWNER } },
  provider: { role: "primary", host: "rpc.ryntra" },
  support: { decision: "SUPPORTED", findings: [] },
  safety: { decision: "ALLOW", findings: [] },
  canaryIntent: {},
  canaryVerdict: {},
  reviewProof: { status: "SIGNED" },
  check: {
    asset: { mint: USDC, decimals: 6 },
    from: OWNER,
    to: { address: FRIEND, kind: "wallet", owner: FRIEND, account: FRIEND, opensAccount: true },
    send: { raw: "25000000", amount: "25" },
    issuerFee: null,
    receive: { raw: "25000000", amount: "25", less: false },
    networkFee: { lamports: "6200", sol: "0.0000062" },
    setup: { lamports: "2039280", sol: "0.00203928" },
    minimum: null,
    signable: true,
    blocked: null,
    warnings: [],
  },
};

const QUOTE = {
  kind: "CROSS_SWAP",
  lane: "OPEN",
  buildable: true,
  quote: {
    schema: "ryntra.solana.cross-swap-quote",
    schemaVersion: "1.0.0",
    provider: "RELAY",
    route: "RELAY_DEPOSIT",
    routeLabel: "Relay",
    tupleId: "SOLANA_USDC_TO_BASE_USDC",
    from: { network: "solana", asset: "USDC", symbol: "USDC", decimals: 6, amountRaw: "100000000" },
    to: { network: "base", asset: "USDC", symbol: "USDC", decimals: 6, expectedRaw: "99680000", minimumRaw: "99430000" },
    slippageBps: 25,
    etaSeconds: 24,
    deadlineKind: "QUOTE_VALIDITY",
    deadlineUnix: 4_000_000_000,
    fees: { protocolBps: 0, protocolUsd: 0.02, relayerUsd: 0.07, relayerGasUsd: 0.05, sourceGasUsd: 0.0011, refundUsd: null, rentLamports: null, referrerBps: 0 },
    serviceFee: { mechanism: "RELAY_APP_FEE", state: "REQUESTED", basisPoints: 25, requestedBasisPoints: 25, asset: null, symbol: null, decimals: null, amountRaw: null, usd: 0.25, accrual: "PROVIDER" },
    approvals: 0,
    walletPrompts: 1,
    priceImpactBps: 32,
    priceStatus: "GOOD",
    quoteId: "q-1",
    observedAt: "2026-10-28T12:00:00Z",
  },
};

const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const action = (over) => ({ schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet: OWNER, receiptHash: null, sourceTx: null, destinationTx: null, fee: null, origin: null, providerRef: null, statedUsd: null, destination: null, in: null, ...over });
const ACTIVITY = [
  action({ actionId: SIGNATURE, lane: "SEND", outcome: "DONE", out: { mint: USDC, amountRaw: "25000000", decimals: 6, symbol: "USDC" }, signature: SIGNATURE, startedAt: at(12), updatedAt: at(12) }),
  action({ actionId: `0x${"cd".repeat(32)}`, lane: "CROSS_SWAP", outcome: "IN_FLIGHT", out: { mint: USDC, amountRaw: "100000000", decimals: 6, symbol: "USDC" }, in: { mint: null, amountRaw: "99680000", decimals: 6, symbol: "USDC" }, destination: "BASE", signature: null, sourceTx: SIGNATURE, startedAt: at(40), updatedAt: at(39) }),
  action({ actionId: `${SIGNATURE.slice(0, -1)}2`, lane: "SWAP", outcome: "DONE", out: { mint: null, amountRaw: "100000000", decimals: 9, symbol: "SOL" }, in: { mint: JUP, amountRaw: "36230000", decimals: 6, symbol: "JUP" }, signature: `${SIGNATURE.slice(0, -1)}2`, startedAt: at(60 * 26), updatedAt: at(60 * 26) }),
  action({ actionId: `${SIGNATURE.slice(0, -1)}3`, lane: "SEND", outcome: "FAILED", out: { mint: null, amountRaw: "50000000", decimals: 9, symbol: "SOL" }, signature: `${SIGNATURE.slice(0, -1)}3`, startedAt: at(60 * 50), updatedAt: at(60 * 50) }),
];

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function open(size, { connected = true } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(({ taker, friend, connected }) => {
    window.localStorage.setItem(`ryntra.solana.send.recipients:${taker}`, JSON.stringify([friend]));
    if (!connected) return;
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
  }, { taker: OWNER, friend: FRIEND, connected });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const letters = { [USDC]: ["$", "#2775CA"], [JUP]: ["J", "#1B9A6C"], [BONK]: ["B", "#F7A400"], So11111111111111111111111111111111111111112: ["◎", "#9945FF"] };
  await page.route("**/api/icon/*", (route) => {
    const mint = route.request().url().split("/").pop();
    const [glyph, fill] = letters[mint] ?? ["?", "#23222D"];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="20" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
  });
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/v1/money/recipient?*", (route) =>
    json(route, 200, { input: "address", next: "transfer", problem: null, address: FRIEND, asset: { mint: USDC }, destination: { kind: "wallet", owner: FRIEND, account: FRIEND, opensAccount: true }, asked: null, link: null, checkedAt: new Date().toISOString() }),
  );
  await page.route("**/api/solana/transfer/plan", (route) => json(route, 200, { data: PLAN }));
  await page.route("**/api/swap/deposit-address*", (route) =>
    route.request().method() === "POST"
      ? json(route, 200, { data: { network: "base", address: DEPOSIT, recipient: OWNER, feeUsd: 0.03, seconds: 20 } })
      : json(route, 200, { data: { progress: "ON_THE_WAY", amount: null, at: null } }),
  );
  await page.route("**/api/solana/cross-swap/quote", (route) => json(route, 200, QUOTE));
  await page.route("**/api/solana/activity", (route) => json(route, 200, { data: { actions: ACTIVITY, rewards: null, cashback: null, complete: true, coverage: "RYNTRA_ACTIONS" } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__openMoney === "function", null, { timeout: 120_000 });
  await page.waitForTimeout(6000);
  // The first visit's welcome steps aside, as a visitor would send it.
  const later = page.getByRole("button", { name: /^(Later|Close the Arrivals card)$/ });
  if (await later.isVisible().catch(() => false)) await later.click();
  return { page, context, errors };
}

const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const report = [];

for (const size of SIZES) {
  const shot = (page, state) => page.screenshot({ path: path.join(out, `money-${state}-${size.name}.png`) });
  const tab = async (page, id, wait = 1800) => {
    await page.evaluate((id) => window.__openMoney(id), id);
    // The window's code loads the first time it opens.
    await page.getByRole("dialog", { name: "Money" }).waitFor({ timeout: 120_000 });
    await page.waitForTimeout(wait);
  };

  {
    const { page, context, errors } = await open(size);
    await tab(page, "portfolio", 3500);
    await shot(page, "portfolio");
    await tab(page, "topup");
    await shot(page, "topup");
    await page.getByRole("tab", { name: "From another network" }).click();
    await page.getByRole("radio", { name: "Base" }).click();
    await page.waitForTimeout(2500);
    await shot(page, "topup-network");
    await tab(page, "activity", 2500);
    await shot(page, "activity");
    if (CLOSED) {
      await tab(page, "send");
      await shot(page, "send-closed");
      await tab(page, "bridge");
      await shot(page, "bridge-closed");
    } else {
      await tab(page, "send");
      await page.getByRole("radio", { name: "USDC" }).click();
      await page.locator("#money-to").fill(FRIEND);
      await page.locator("#money-amount").fill("25");
      await page.waitForTimeout(1500);
      await shot(page, "send");
      await page.getByRole("button", { name: "Review transfer" }).click();
      await page.waitForTimeout(1500);
      await page.locator('[aria-label="Review"]').scrollIntoViewIfNeeded();
      await shot(page, "send-review");
      await tab(page, "bridge");
      await page.locator("#money-bridge-to").fill(EVM);
      await page.locator("#money-bridge-amount").fill("100");
      await page.waitForTimeout(2500);
      await shot(page, "bridge");
    }
    report.push(`${size.name}${CLOSED ? " closed" : ""}: overflow=${await overflowOf(page)}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
    await context.close();
  }

  // A visitor without a wallet: the window asks for one.
  if (!CLOSED) {
    const { page, context } = await open(size, { connected: false });
    await tab(page, "portfolio");
    await shot(page, "connect");
    await context.close();
  }
}
console.log(report.join("\n"));
await browser.close();
