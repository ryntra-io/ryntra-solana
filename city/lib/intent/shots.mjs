// The confirm sheet of a prepared action (CITY-161, phase 1) on a stand, end to end, at 1440×860 and 390×844 → <out>/<state>-<size>.jpg
//   RYNTRA_INTENTS=memory RYNTRA_PUBLIC_ORIGIN=http://localhost:3000 npm run dev
//   node city/lib/intent/shots.mjs [out] [baseUrl]     (PRESS_CHROME=<chromium> where the pinned Playwright has no browser of its own)
//   One size per fresh stand (SIZES=laptop, then restart, SIZES=phone): the golden signature answers one intent only,
//   so a second end-to-end pass on the same stand is refused, as it must be.
//
// The intents are real: each is made through `POST /api/v1/intents` on the stand, as an agent makes it, and the sheet
// claims it and sends its receipt through the stand's own routes. The engine's swap and transfer routes answer with
// fixtures (no network leaves the stand), and the end-to-end pass uses the swap routes' golden transcripts with their
// test-only key: the wallet stub signs the engine's exact bytes with it, under the transcripts' clock. Nothing here
// touches mainnet, a real wallet or a real key.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { signWire, T0, TAKER, USDT, WSOL } from "../../../app/api/solana/swap/golden/fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "out/intent-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const recorded = (name) => structuredClone(golden[name].steps.at(-1).body);
const QUOTE = recorded("quote: SOL to USDT with the referral fee");
const ORDER = recorded("order: SOL to USDT with the verified referral fee is a signable Review");
const EXECUTED = recorded("execute: exact bytes through Jupiter settle MATCHED with a Receipt");

const FRIEND = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
/* The transfer Review below stays for a stand that opens transfers (`RYNTRA_INTENTS_TRANSFER=open`); phase 1 keeps them closed. */
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

/** The live quote for 0.25 SOL of JUP, shaped as the swap engine answers it (the transcripts' quote, re-figured). */
const JUP_QUOTE = (() => {
  const quote = structuredClone(QUOTE);
  Object.assign(quote.order, { inputMint: WSOL, outputMint: JUP, inAmountRaw: "250000000", outAmountRaw: "53710000", minReceivedRaw: "53441450", priceImpactPct: "0.02" });
  quote.decimals = { [WSOL]: 9, [JUP]: 6 };
  return quote;
})();

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "3415000000", spendableRaw: "3405000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: "176.4" } },
  { kind: "TOKEN", mint: USDC, amountRaw: "248120000", spendableRaw: "248120000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1" } },
];

/** The engine's Review of 25 USDC to a wallet that has no USDC account yet. */
const PLAN = {
  passport: null,
  preflight: { simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "6200" }, estimatedReceivedRaw: "25000000" },
  verdict: { verdict: "NO_KNOWN_BLOCKER" },
  plan: { network: "mainnet", actionKind: "SPL_TRANSFER", sender: TAKER, recipient: FRIEND, mint: USDC, amountRaw: "25000000", decimals: 6, baseFeeLamports: "5000", priorityFeeLamports: "1200", unsignedWireBase64: "AQAB", fingerprint: { messageHash: `0x${"ab".repeat(32)}`, feePayer: TAKER } },
  provider: { role: "primary", host: "rpc.ryntra" },
  support: { decision: "SUPPORTED", findings: [] },
  safety: { decision: "ALLOW", findings: [] },
  canaryIntent: {},
  canaryVerdict: {},
  reviewProof: { status: "SIGNED" },
  check: {
    asset: { mint: USDC, decimals: 6 },
    from: TAKER,
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

/** An agent, a chat or a partner prepares an intent: the stand's own route, no wallet and no key. */
async function prepare(body) {
  const response = await fetch(`${base}/api/v1/intents`, { method: "POST", headers: { "content-type": "application/json", "x-ryntra-api": "1" }, body: JSON.stringify(body) });
  const json = await response.json();
  assert.equal(response.status, 201, JSON.stringify(json));
  return Object.assign(json.intent, { creatorKey: json.creatorKey });
}

async function readBack(id, key = null) {
  const response = await fetch(`${base}/api/v1/intents/${id}`, { headers: { "x-ryntra-api": "1", ...(key ? { "x-ryntra-intent-key": key } : {}) } });
  return { status: response.status, body: await response.json() };
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function open(size, url, { connected = false, signs = false, clock = null, calm = false } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU|404|503/.test(m.text()) && errors.push(m.text()));
  // Every answer of the intent routes, so a failed pass says which step the server refused.
  const steps = [];
  page.on("response", async (response) => {
    const where = new URL(response.url());
    if (!where.pathname.startsWith("/api/v1/intents/") || response.request().method() !== "POST") return;
    const body = await response.json().catch(() => null);
    const sent = JSON.parse(response.request().postData() ?? "{}").signature ?? null;
    const marked = body?.intent?.sentSignature ?? null;
    const short = (sig) => (sig ? sig.slice(0, 6) : "-");
    steps.push(`${where.pathname.split("/").pop()} ${response.status()} ${body?.error?.code ?? ""} sent=${short(sent)} marked=${short(marked)}`.replace(/\s+/g, " "));
  });
  // A returning visitor: the city's first-visit hint has been seen before.
  await page.addInitScript(() => window.localStorage.setItem("ryntra.city.firstHint", "1"));
  if (clock) await page.clock.setFixedTime(clock);
  if (signs) await page.exposeFunction("__ryntraTestSign", (wire) => signWire(wire).wire);
  // The test browser only: a software GPU's frames would starve the page's thread through a whole signing flow, so the
  // scene draws one frame every two seconds here. The product's frame loop is untouched.
  if (calm) await page.addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => setTimeout(() => native(callback), 2_000);
  });
  await page.addInitScript(({ taker, connected, signs }) => {
    if (!connected) return;
    window.localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
    const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
    const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const signTransaction = signs
      ? async (...inputs) => Promise.all(inputs.map(async (input) => ({ signedTransaction: fromBase64(await window.__ryntraTestSign(toBase64(input.transaction))) })))
      : () => new Promise(() => {});
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction },
        "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { taker: TAKER, connected, signs });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const letters = { [USDC]: ["$", "#2775CA"], [JUP]: ["J", "#1B9A6C"], [USDT]: ["₮", "#26A17B"], [WSOL]: ["◎", "#9945FF"] };
  await page.route("**/api/icon/*", (route) => {
    const mint = route.request().url().split("/").pop();
    const [glyph, fill] = letters[mint] ?? ["?", "#23222D"];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="20" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
  });
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/v1/research/address-evidence?*", (route) => json(route, 200, { state: "UNAVAILABLE" }));
  await page.route("**/api/solana/transfer/plan", (route) => json(route, 200, { data: PLAN }));
  await page.route("**/api/solana/swap/quote", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    return json(route, 200, body.outputMint === JUP ? JUP_QUOTE : QUOTE);
  });
  await page.route("**/api/solana/swap/order", (route) => json(route, 200, ORDER));
  await page.route("**/api/solana/swap/execute", (route) => json(route, 200, EXECUTED));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByRole("dialog", { name: /^(Confirm|Підтвердження)$/ }).first().waitFor({ timeout: 180_000 });
  // The scene paints its first frames under a software GPU: the shot waits for the city, not only for the sheet.
  await page.waitForTimeout(14_000);
  // The first visit's welcome steps aside, as a visitor would send it.
  const later = page.getByRole("button", { name: /^(Later|Close the Arrivals card)$/ });
  if (await later.isVisible().catch(() => false)) await later.click();
  await page.waitForTimeout(800);
  return { page, context, errors, steps };
}

const report = { base, at: new Date().toISOString(), shots: [], endToEnd: [] };

for (const size of SIZES) {
  const shot = async (page, state) => {
    const file = path.join(out, `${state}-${size.name}.jpg`);
    // The scene builds its skyline on the main thread under a software GPU; a shot is taken once a frame comes back.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
        await page.screenshot({ path: file, type: "jpeg", quality: 82, timeout: 60_000 });
        break;
      } catch (error) {
        if (attempt >= 6) throw error;
      }
    }
    report.shots.push(path.relative(process.cwd(), file));
  };

  // A swap an agent prepared: 0.25 SOL into JUP.
  const swap = await prepare({ action: "swap", coin: JUP, side: "buy", pay: "SOL", amountRaw: "250000000", origin: { kind: "agent", name: "Atlas" } });
  {
    const { page, context, errors } = await open(size, swap.links.url);
    await page.getByText(/53\.71/).first().waitFor({ timeout: 30_000 });
    await shot(page, "swap-no-wallet");
    await context.close();
    assert.deepEqual(errors, [], errors.join("\n"));
  }
  {
    const { page, context, errors } = await open(size, swap.links.url, { connected: true });
    await page.getByRole("button", { name: /Confirm in wallet/ }).waitFor({ timeout: 30_000 });
    await shot(page, "swap-wallet");
    await page.getByRole("button", { name: "Details" }).first().click();
    await page.waitForTimeout(400);
    await shot(page, "swap-who-prepared");
    await context.close();
    assert.deepEqual(errors, [], errors.join("\n"));
  }

  // Phase 1: a transfer to another address from an outside client is closed on this stand as on production.
  {
    const response = await fetch(`${base}/api/v1/intents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "transfer", coin: USDC, amountRaw: "25000000", to: FRIEND, origin: { kind: "chat", name: "Atlas" } }) });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "INTENT_ACTION_CLOSED");
  }

  // A request bound to another wallet: the sheet says so and never claims it from this one.
  const bound = await prepare({ action: "swap", coin: JUP, side: "buy", pay: "SOL", amountRaw: "250000000", for: FRIEND, origin: { kind: "chat", name: "Atlas" } });
  {
    const { page, context, errors } = await open(size, bound.links.url, { connected: true });
    await page.getByText(/This request is for another wallet/).first().waitFor({ timeout: 30_000 });
    await shot(page, "swap-other-wallet");
    await context.close();
    assert.deepEqual(errors, [], errors.join("\n"));
  }
  const untouched = await readBack(bound.id);
  assert.equal(untouched.body.intent.status, "OPEN");

  // End to end: a partner prepares the transcripts' swap; the person confirms; the wallet signs the engine's exact bytes;
  // the signature becomes the intent's receipt; the same link never opens again.
  const deal = await prepare({ action: "swap", coin: USDT, side: "buy", pay: "SOL", amountRaw: "10000000", origin: { kind: "partner", name: "Acme Pay" } });
  {
    const { page, context, errors, steps } = await open(size, deal.links.url, { connected: true, signs: true, clock: T0 + 1_000, calm: true });
    const confirm = page.getByRole("button", { name: /Confirm in wallet/ });
    await confirm.waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => !document.querySelector('[data-window="intent"] button[disabled]'), null, { timeout: 30_000 }).catch(() => {});
    // The press of a person: the scene's endless animation never lets Playwright call the button «stable».
    await confirm.click({ force: true });
    await page.getByRole("heading", { name: /^Done$/ }).waitFor({ timeout: 240_000 });
    await page.waitForTimeout(2_500);
    await shot(page, "swap-done");
    await context.close();
    console.log(`${size.name} ${deal.id} steps: ${steps.join(" · ")}`);
    assert.deepEqual(errors, [], errors.join("\n"));
  }
  // The partner reads the signature back with its key; anyone else with the link sees only that it is done.
  const after = await readBack(deal.id, deal.creatorKey);
  assert.equal(after.status, 200);
  assert.equal(after.body.intent.status, "DONE");
  assert.equal(after.body.intent.receipt.signature, EXECUTED.signature);
  assert.equal(after.body.intent.receipt.wallet, TAKER);
  const stranger = await readBack(deal.id);
  assert.equal(stranger.body.intent.status, "DONE");
  assert.equal(stranger.body.intent.receipt, null);
  const replay = await fetch(`${base}/api/v1/intents/${deal.id}/claim`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ digest: deal.digest, wallet: TAKER }) });
  const replayBody = await replay.json();
  assert.equal(replay.status, 409);
  assert.equal(replayBody.error.code, "INTENT_USED");
  // The same signed bytes on a second intent: they may be marked, but the signature that answered the first intent
  // never answers another.
  const twin = await prepare({ action: "swap", coin: USDT, side: "buy", pay: "SOL", amountRaw: "10000000", origin: { kind: "partner", name: "Acme Pay" } });
  const step = (name, body) => fetch(`${base}/api/v1/intents/${twin.id}/${name}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ digest: twin.digest, wallet: TAKER, ...body }) });
  assert.equal((await step("claim", {})).status, 200);
  assert.equal((await step("signed", { signedWireBase64: signWire(ORDER.order.transactionBase64).wire, replaces: null })).status, 200);
  const reused = await step("receipt", { signature: EXECUTED.signature });
  const reusedBody = await reused.json();
  assert.equal(reused.status, 422);
  assert.equal(reusedBody.error.code, "INTENT_RECEIPT_MISMATCH");
  {
    const { page, context, errors } = await open(size, deal.links.url, { connected: true });
    await page.getByRole("heading", { name: /^Done$/ }).waitFor({ timeout: 30_000 });
    await context.close();
    assert.deepEqual(errors, [], errors.join("\n"));
  }
  // Its creator withdraws an open intent: the link says so and never opens a sheet again.
  const withdrawn = await prepare({ action: "swap", coin: JUP, side: "sell", pay: "USDC", amountRaw: "40000000", origin: { kind: "agent", name: "Atlas" } });
  {
    const response = await fetch(`${base}/api/v1/intents/${withdrawn.id}/cancel`, { method: "POST", headers: { "x-ryntra-intent-key": withdrawn.creatorKey } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).intent.status, "CANCELLED");
    const { page, context, errors } = await open(size, withdrawn.links.url);
    await page.getByRole("heading", { name: /^Withdrawn$/ }).waitFor({ timeout: 30_000 });
    await shot(page, "link-withdrawn");
    await context.close();
    assert.deepEqual(errors, [], errors.join("\n"));
  }
  // A forged id is not found.
  {
    const { page, context, errors } = await open(size, `${base}/i/AAAAAAAAAAAAAAAAAAAAAA`);
    await page.getByRole("heading", { name: /^Link not found$/ }).waitFor({ timeout: 30_000 });
    await shot(page, "link-not-found");
    await context.close();
    assert.deepEqual(errors, [], errors.join("\n"));
  }
  report.endToEnd.push({
    size: size.name,
    intent: deal.id,
    madeBy: deal.origin,
    statusAfter: after.body.intent.status,
    receipt: after.body.intent.receipt,
    receiptForStrangers: stranger.body.intent.receipt,
    replay: { status: replay.status, code: replayBody.error.code },
    signatureOnAnotherIntent: { status: reused.status, code: reusedBody.error.code },
    boundToAnotherWallet: { intent: bound.id, statusAfterOpen: untouched.body.intent.status },
    withdrawn: withdrawn.id,
  });
}

writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify(report, null, 2));
