// The payer's page for review (CITY-156), at 1440×900 and 390×844 → <out>/pay-<state>-<size>.png, and one test payment
// through the page end to end.
//
//   node city/lib/pay/shots.mjs seed <dir>                       — write the fixture requests into a file store
//   npm run dev, on the file store in <dir> (the store's two variables, `file` and its directory — `.env.example`, line 88)
//   node city/lib/pay/shots.mjs [out] [baseUrl]                  — the screens and the payment (PRESS_CHROME=<chrome> for
//                                                                   another browser than playwright's own)
//
// The server draws every page from its own public read of the fixture store (`lib/pay/**`, unchanged). Each fixture's
// settlement was read «just now», so the server asks no RPC for it. The payment runs in the page against a stub wallet
// that registers through the Wallet Standard events, with the engine's build and submit answering fixtures and its
// status read turning to Paid after the submit: what the page sends, in which order, is checked. No key and no money
// anywhere; the live payment with a real wallet on mainnet is the owner's canary.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const STUDIO = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const FRIEND = "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2";
const PAYER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SIGNATURE = "3vZ8sRkd2kN9mEJcVJbW7K1yC6p8oQGJ4fH2Lr9aT5XqBnU8wYeD3sP6mZ1cR4tV7hK9jN2gF5xL8bQ3dW6eA1s";

const DAY = 86_400_000;
const LATER = "2030-01-01T00:00:00.000Z";

/** The fixture requests: one per state the page draws. */
export const FIXTURES = {
  asked: { id: "Hq2Lr9aTXqBnU8wYe", recipient: STUDIO, mint: USDC, decimals: 6, symbol: "USDC", amountRaw: "250000000", amountDisplay: "250", description: "Logo and brand kit — October", settlement: "NONE" },
  open: { id: "Zt7Ck3mNpQ5vB2xRw", recipient: FRIEND, mint: null, decimals: 9, symbol: "SOL", amountRaw: null, amountDisplay: null, description: "Tickets for Saturday", settlement: "NONE" },
  short: { id: "Fv6Jd8sKeA4wP9gTn", recipient: FRIEND, mint: USDC, decimals: 6, symbol: "USDC", amountRaw: "40000000", amountDisplay: "40", description: "Dinner on Friday", settlement: "UNDERPAID", creditedRaw: "25000000" },
  paid: { id: "Pm3Wq7rYtE2uX5aHs", recipient: STUDIO, mint: USDC, decimals: 6, symbol: "USDC", amountRaw: "120000000", amountDisplay: "120", description: "Website copy", settlement: "PAID", creditedRaw: "120000000" },
  expired: { id: "Ex4Gb9nMcV2kR7dLq", recipient: FRIEND, mint: null, decimals: 9, symbol: "SOL", amountRaw: "500000000", amountDisplay: "0.5", description: "Board game night", settlement: "NONE", expired: true },
};

const REFERENCES = {
  asked: "Ref1aSkEdHq2Lr9aTXqBnU8wYeD3sP6mZ1cR4tV7hK",
  open: "Ref2oPeNZt7Ck3mNpQ5vB2xRwD3sP6mZ1cR4tV7hK",
  short: "Ref3sHoRtFv6Jd8sKeA4wP9gTnD3sP6mZ1cR4tV7hK",
  paid: "Ref4pAiDPm3Wq7rYtE2uX5aHsD3sP6mZ1cR4tV7hK",
  expired: "Ref5eXpEx4Gb9nMcV2kR7dLqD3sP6mZ1cR4tV7hK",
};

function seed(dir) {
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const requests = {};
  const settlements = {};
  const references = {};
  for (const [key, f] of Object.entries(FIXTURES)) {
    const createdAt = new Date(now - (f.expired ? 3 * DAY : 2 * 3_600_000)).toISOString();
    const expiresAt = new Date(f.expired ? now - DAY : now + 2 * DAY).toISOString();
    requests[f.id] = {
      schema: "ryntra.pay.request",
      schemaVersion: "1.0.0",
      id: f.id,
      network: "mainnet",
      recipient: f.recipient,
      reference: REFERENCES[key],
      mint: f.mint,
      decimals: f.decimals,
      symbol: f.symbol,
      amountRaw: f.amountRaw,
      amountDisplay: f.amountDisplay,
      description: f.description,
      createdAt,
      expiresAt,
    };
    const paid = f.settlement === "PAID";
    settlements[f.id] = {
      schema: "ryntra.pay.settlement",
      schemaVersion: "1.0.0",
      id: f.id,
      state: f.settlement,
      signature: paid ? SIGNATURE : null,
      creditedRaw: f.creditedRaw ?? null,
      feeWithheldRaw: null,
      payer: paid ? PAYER : null,
      paidAt: paid ? new Date(now - 40 * 60_000).toISOString() : null,
      // «Read just now» for the open ones, so the page asks no RPC; an ended request keeps its last read.
      observedAt: f.expired ? new Date(now - DAY).toISOString() : LATER,
      checkedAt: f.expired ? new Date(now - DAY).toISOString() : LATER,
      failures: 0,
      lastError: null,
    };
    references[REFERENCES[key]] = { id: f.id };
  }
  writeFileSync(path.join(dir, "paymentRequests.json"), JSON.stringify(requests));
  writeFileSync(path.join(dir, "paymentRequestSettlements.json"), JSON.stringify(settlements));
  writeFileSync(path.join(dir, "paymentRequestReferences.json"), JSON.stringify(references));
  console.log(`seeded ${Object.keys(requests).length} requests into ${dir}`);
}

if (process.argv[2] === "seed") {
  seed(path.resolve(process.argv[3] ?? "out/pay-guard"));
  process.exit(0);
}

const { chromium } = await import("playwright");
const out = path.resolve(process.argv[2] ?? "out/pay-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LOGOS = { [USDC]: "public/site/universe/USDC.png", So11111111111111111111111111111111111111112: "public/site/universe/SOL.png" };

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined });

async function open(size, { wallet = false, lang = "en" } = {}) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    userAgent: size.mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(
    ({ payer, wallet, lang }) => {
      window.localStorage.setItem("ryntra.city.lang", lang);
      if (!wallet) return;
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
      const account = { address: payer, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      window.__signed = [];
      const wallet_ = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet"],
        accounts: [account],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          // The stub «signs» by handing the bytes back: what reaches the engine is checked, nothing reaches a chain.
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs) => {
              await new Promise((r) => setTimeout(r, 900));
              window.__signed.push(inputs.length);
              return inputs.map((input) => ({ signedTransaction: input.transaction }));
            },
          },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet_));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet_) }));
    },
    { payer: PAYER, wallet, lang },
  );
  await page.route("**/api/icon/*", (route) => {
    const mint = route.request().url().split("/").pop();
    const file = LOGOS[mint];
    return file ? route.fulfill({ status: 200, contentType: "image/png", body: readFileSync(file) }) : route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/research/skr-name?*", (route) => {
    const address = new URL(route.request().url()).searchParams.get("address");
    const body = address === STUDIO ? { direction: "address", state: "FOUND", address, name: "northlight.skr", source: "primary" } : { direction: "address", state: "NOT_FOUND", address, name: null, source: null };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return { page, context, errors };
}

/**
 * Whether anything of the old face reaches the person: the words and pictures on the page, the tab, the preview tags.
 * The root layout's JSON-LD (the organisation's logo and line, for search engines) is the whole site's and is left to
 * CITY-158; it is not drawn.
 */
const oldFace = (page) =>
  page.evaluate(() => {
    const head = [...document.head.querySelectorAll("title, meta, link")].map((e) => e.outerHTML).join(" ");
    const drawn = [...document.body.querySelectorAll("img, [class], [href]")].map((e) => `${e.getAttribute("src")} ${e.getAttribute("class")} ${e.getAttribute("href")}`).join(" ");
    return /ryntra-wordmark|ryntra-brand|ry-mark-grad|tokenized stocks/i.test(`${head} ${drawn} ${document.body.innerText}`);
  });

async function settle(page) {
  await page.waitForSelector("[data-pay-page]");
  await page.waitForFunction(() => !document.documentElement.classList.contains("city-lang-wait"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1_400);
}

const report = [];
for (const size of SIZES) {
  for (const [state, fixture] of Object.entries(FIXTURES)) {
    const { page, context, errors } = await open(size, { wallet: state === "asked" && !size.mobile });
    const answer = await page.goto(`${base}/pay/${fixture.id}`, { waitUntil: "load" });
    await settle(page);
    const file = path.join(out, `pay-${state}-${size.name}.png`);
    await page.screenshot({ path: file });
    report.push({ shot: path.basename(file), status: answer?.status(), old: await oldFace(page), errors });
    if (state === "asked") {
      // What the payment costs, behind the «i».
      await page.locator("button[aria-expanded]").first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `pay-asked-details-${size.name}.png`) });
    }
    await context.close();
  }
  // A link that does not exist.
  {
    const { page, context, errors } = await open(size);
    const answer = await page.goto(`${base}/pay/NoSuchLink4Xr8Qw2`, { waitUntil: "load" });
    await settle(page);
    await page.screenshot({ path: path.join(out, `pay-missing-${size.name}.png`) });
    report.push({ shot: `pay-missing-${size.name}.png`, status: answer?.status(), title: await page.title(), old: await oldFace(page), errors });
    await context.close();
  }
  // Ukrainian.
  {
    const { page, context, errors } = await open(size, { lang: "uk" });
    await page.goto(`${base}/pay/${FIXTURES.open.id}`, { waitUntil: "load" });
    await settle(page);
    await page.screenshot({ path: path.join(out, `pay-open-uk-${size.name}.png`) });
    report.push({ shot: `pay-open-uk-${size.name}.png`, errors });
    await context.close();
  }
}

/* ------------------------------------------------------------------ *
 * One test payment through the page, end to end
 * ------------------------------------------------------------------ */

async function testPayment(size) {
  const { page, context, errors } = await open(size, { wallet: true });
  const fixture = FIXTURES.asked;
  const sent = [];
  let submitted = false;
  const first = await (await fetch(`${base}/api/pay/${fixture.id}`)).json();
  const paidView = {
    ...first.data,
    request: { ...first.data.request, status: "PAID", paid: { signature: SIGNATURE, creditedRaw: fixture.amountRaw, paidAt: new Date().toISOString() }, received: { raw: fixture.amountRaw, feeWithheldRaw: null } },
  };
  await page.route(`**/api/pay/${fixture.id}/transaction`, async (route) => {
    sent.push({ path: "transaction", body: JSON.parse(route.request().postData() ?? "null"), origin: route.request().headers().origin ?? null });
    await new Promise((r) => setTimeout(r, 700));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { intentId: "intent_test_0001", unsignedWireBase64: "AQIDBAUGBwgJCgsMDQ4PEA==", signableMs: 25_000 } }) });
  });
  await page.route(`**/api/pay/${fixture.id}/submit`, async (route) => {
    sent.push({ path: "submit", body: JSON.parse(route.request().postData() ?? "null") });
    submitted = true;
    await new Promise((r) => setTimeout(r, 600));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { signature: SIGNATURE, view: first.data } }) });
  });
  await page.route(`**/api/pay/${fixture.id}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: submitted ? paidView : first.data }) }),
  );
  await page.goto(`${base}/pay/${fixture.id}`, { waitUntil: "load" });
  await settle(page);
  const action = page.locator("[data-pay-action]");
  await action.click();
  await page.waitForFunction(() => document.querySelector("[data-pay-action]")?.textContent?.includes("Confirm"), null, { timeout: 10_000 });
  await page.screenshot({ path: path.join(out, `pay-flow-wallet-${size.name}.png`) });
  await page.waitForSelector("[data-shown='pending']", { timeout: 15_000 });
  await page.screenshot({ path: path.join(out, `pay-flow-sent-${size.name}.png`) });
  await page.waitForSelector("[data-shown='paid']", { timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, `pay-flow-paid-${size.name}.png`) });
  const signed = await page.evaluate(() => window.__signed);
  await context.close();
  const ok =
    sent.length === 2 &&
    sent[0].path === "transaction" &&
    sent[0].body.payer === PAYER &&
    sent[0].body.amount === null &&
    sent[1].path === "submit" &&
    sent[1].body.intentId === "intent_test_0001" &&
    sent[1].body.signedWireBase64 === "AQIDBAUGBwgJCgsMDQ4PEA==" &&
    signed.length === 1;
  return { size: size.name, ok, sent, signed, errors };
}

for (const size of SIZES) report.push({ payment: await testPayment(size) });

await browser.close();
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
