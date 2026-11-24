// «Money → Invoices», private, for the eyes — the recipient's panel and list and the payer's page, at
// 1920×1080 and 390×844, in English and Ukrainian → <out>/<state>-<size>-<lang>.jpg and <out>/report.txt.
//   node terminal/money/private/shots.mjs [out] [baseUrl]
// A stand with the terminal on, money open and the private balance on the test network
// (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`, `NEXT_PUBLIC_RYNTRA_CITY_MONEY=open`, `NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`).
// SIZES=wide,phone, LANGS=en,uk and ONLY=<shot,shot> narrow a run.
//
// No Helius key is needed and nothing reaches a network: the SDK bundle the page loads is answered by a stand SDK in
// this file — it keeps registrations, balances and the private history in memory, and its «send» sends nothing. The
// stand wallet (Wallet Standard, `solana:devnet`) echoes the bytes it is given as «signed» or refuses, as each shot
// needs. The pass on the real test network is the lead's: the live script is `terminal/portfolio/private/shots.mjs`.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-341");
const base = process.argv[3] ?? "http://localhost:3341";
if (/mainnet/i.test(base)) process.exit(3);
mkdirSync(out, { recursive: true });

const OWNER = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const PAYER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SOL = "So11111111111111111111111111111111111111112";

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const report = [];

/* The stand SDK: the names the private balance and the invoices call, answering from `window.__stand`. */
const STAND_SDK = `
const stand = () => (window.__stand ??= JSON.parse(sessionStorage.getItem("__stand") || 'null') ?? { registered: [], held: "0", inbound: [], slot: 1000, proveMs: 0, sent: 0 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const SOL_MINT = "11111111111111111111111111111111";
export const SDK_VERSION = "stand";
export async function initializePoseidon() {}
export const SignedTeePolicy = { forNetwork: () => ({}) };
export const ViewingKey = { generate: () => ({ secretBytes: () => bytes(32), destroy() {} }), fromBytes: (b) => ({ publicKey: () => b }) };
export const NullifierKey = { fromSecret: (b) => ({ publicKey: () => b }) };
export const ShieldedPublicKey = { fromEd25519: (b) => b };
export const ShieldedAddress = { fromPublicKeys: () => ({}) };
export const LocalKeys = { fromKeys: ({ address }) => ({ address: () => address }), fromKeypair: () => ({ address: () => ({}) }), fromDerivationSeed: () => ({ address: () => ({}) }) };
export function getAddressEncoder() { return { encode: (a) => new TextEncoder().encode(a) }; }
export class Wallet { constructor(o) { this.o = o; } }
export async function syncWallet() { await wait(250); }
export function getPrivateTokenBalances() { const h = BigInt(stand().held); return h > 0n ? [{ mint: SOL_MINT, amount: h }] : []; }
export function getPrivateTransactions() {
  return stand().inbound.map((p, i) => ({ id: { signature: p.signature, slot: BigInt(p.slot), index: 0n }, kind: "privateTransfer", direction: "inbound", status: "confirmed", asset: SOL_MINT, amount: BigInt(p.amount) }));
}
export async function buildRegistrationTransaction({ owner }) { if (!stand().registered.includes(owner)) stand().registered.push(owner); return undefined; }
const tx = () => ({ messageBytes: new Uint8Array(16) });
export async function buildDepositTransaction() { await wait(stand().proveMs); return tx(); }
export async function buildTransferTransaction() { await wait(stand().proveMs); return tx(); }
export async function buildWithdrawalTransaction() { await wait(stand().proveMs); return tx(); }
export async function partiallySignTransactionWithSigners(_s, t) { return t; }
export function getTransactionEncoder() { return { encode: () => new Uint8Array(80) }; }
export function getTransactionDecoder() { return { decode: () => tx() }; }
export function getSignatureFromTransaction() { return "Stand" + String(++stand().sent).padStart(4, "0") + "SignatureNothingWasSentToAnyNetwork"; }
export async function createSprClient() {
  return {
    proofService: {},
    solanaRpc: {
      getSlot: () => ({ send: async () => BigInt(stand().slot) }),
      sendTransaction: () => ({ send: async () => "stand" }),
      getLatestBlockhash: () => ({ send: async () => ({ value: {} }) }),
    },
    getUserRecords: async (list) => ({ records: list.map((a) => (stand().registered.includes(a) ? {} : null)) }),
    getBalance: async () => 2000000000n,
    confirmTransaction: async () => BigInt(stand().slot + 1),
  };
}
`;

/** The stand wallet: connects on `solana:devnet`, declares versions legacy, 0 and 1; signs by echo or refuses. */
function standWallet({ address }) {
  const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
  const account = { address, publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
  const wallet = {
    version: "1.0.0",
    name: "Phantom",
    icon,
    chains: ["solana:devnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0, 1],
        signTransaction: async (input) => {
          if (window.__refuse) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          return [{ signedTransaction: input.transaction }];
        },
      },
      "solana:signMessage": { version: "1.0.0", signMessage: async () => Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 })) },
    },
  };
  window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function contextFor(size, lang, address) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", timezoneId: "Europe/Kyiv" });
  await context.route("**/api/**", (route) => json(route, {}, 503));
  await context.route("**/api/icon/**", (route) => {
    const mint = new URL(route.request().url()).pathname.split("/").pop();
    if (mint === SOL) return route.fulfill({ path: "public/site/universe/SOL.png", contentType: "image/png" });
    return route.fulfill({ status: 404, body: "" });
  });
  await context.route("**/api/solana/activity", (route) => json(route, { data: { actions: [], complete: true } }));
  await context.route("**/privacy/spr-0.9.0-alpha.mjs", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: STAND_SDK }));
  if (address) await context.addInitScript(standWallet, { address });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("ryntra.money.invoices.mode", "private");
    } catch {}
  });
  return context;
}

async function settle(page) {
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

const FORM = new Set(["square", "cut", "r4", "pill"]);
function measure() {
  const boxes = [];
  const clear = /rgba\(0, 0, 0, 0\)|transparent/;
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 22) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const framed = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && !clear.test(cs[`border${s}Color`])).length >= 3;
    const filled = !clear.test(cs.backgroundColor) || cs.backgroundImage !== "none";
    if (!framed && !filled) continue;
    const px = parseFloat(cs.borderTopLeftRadius) || 0;
    const cut = cs.clipPath && cs.clipPath !== "none";
    boxes.push(cut ? "cut" : px === 0 ? "square" : px >= Math.min(r.width, r.height) / 2 - 0.5 ? "pill" : `r${Math.round(px)}`);
  }
  return boxes;
}

async function shot(page, name, size, lang) {
  if (ONLY && !ONLY.has(name)) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${name}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg" });
  const shapes = await page.evaluate(measure);
  const tally = {};
  for (const shape of shapes) tally[shape] = (tally[shape] ?? 0) + 1;
  const odd = shapes.filter((shape) => !FORM.has(shape));
  const ambers = await page.evaluate(() => [...document.querySelectorAll("main button, main a")].filter((el) => el.offsetParent !== null && !["none", ""].includes(getComputedStyle(el).clipPath)).map((el) => el.textContent.trim()));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.push(`${size.name}/${lang} ${name}: corners ${JSON.stringify(tally)}${odd.length ? ` ODD ${odd.join(",")}` : ""}; amber ${JSON.stringify(ambers)}; overflow ${overflow}px`);
}

const T = {
  en: { private: "Private", turnOn: "Turn on private balance", newInvoice: "New invoice", amount: "Amount", forWhat: "Logo, two drafts", create: "Create link", done: "Done", h1: "1 h", check: "Check payments", pay: "Pay", connect: "Connect wallet" },
  uk: { private: "Приватно", turnOn: "Увімкнути приватний баланс", newInvoice: "Новий рахунок", amount: "Сума", forWhat: "Логотип, два варіанти", create: "Створити посилання", done: "Готово", h1: "1 год", check: "Перевірити оплати", pay: "Оплатити", connect: "Підключити гаманець" },
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const t = T[lang];
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const errors = [];

    /* ── the recipient: private mode, the private balance off → on, a new invoice, the list ── */
    const recipient = await contextFor(size, lang, OWNER);
    const page = await recipient.newPage();
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.clock.install();
    await page.goto(`${base}/money?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 }).catch(() => {});
    await page.evaluate(() => localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom"));
    await page.goto(`${base}/money?tab=invoices&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector("main h1", { timeout: 120_000 });
    await settle(page);
    await page.waitForSelector(`[data-invoice-mode-at='${size.mobile ? "phone" : "head"}']`, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await shot(page, "off", size, lang);
    await tap(page.getByRole("button", { name: t.turnOn }));
    await page.getByRole("button", { name: t.newInvoice }).waitFor({ timeout: 30_000 });
    await shot(page, "empty", size, lang);

    const make = async (amount, forWhat, hour) => {
      await tap(page.getByRole("button", { name: t.newInvoice }));
      await page.getByLabel(t.amount).fill(amount);
      if (forWhat) await page.locator("main input:not([inputmode])").first().fill(forWhat);
      if (hour) await tap(page.getByRole("button", { name: t.h1, exact: true }));
    };
    await make("0.5", t.forWhat, false);
    await shot(page, "form", size, lang);
    await tap(page.getByRole("button", { name: t.create }));
    await page.locator("[data-private-invoice-made]").waitFor({ timeout: 30_000 });
    await shot(page, "made", size, lang);
    const link = await page.locator("[data-private-invoice-made] a").first().getAttribute("href");
    await tap(page.getByRole("button", { name: t.done }));
    await make("0.12", "", true);
    await tap(page.getByRole("button", { name: t.create }));
    await page.locator("[data-private-invoice-made]").waitFor({ timeout: 30_000 });
    await tap(page.getByRole("button", { name: t.done }));
    await make("2", lang === "uk" ? "Сайт, аванс" : "Website, first half", false);
    await tap(page.getByRole("button", { name: t.create }));
    await page.locator("[data-private-invoice-made]").waitFor({ timeout: 30_000 });
    await tap(page.getByRole("button", { name: t.done }));
    // The first invoice is paid: its exact sum comes into the private history after the slot it was made at.
    await page.evaluate(() => window.__stand.inbound.push({ signature: "StandPaymentOne", slot: 1001, amount: "500000000" }));
    await tap(page.getByRole("button", { name: t.check }));
    await page.locator("[data-private-invoice='paid']").waitFor({ timeout: 30_000 });
    await page.locator("[data-private-invoice]").last().scrollIntoViewIfNeeded();
    await shot(page, "list", size, lang);
    // Two hours on: the hour's invoice has ended with nothing come.
    await page.clock.fastForward("02:00:00");
    await tap(page.getByRole("button", { name: t.check }));
    await page.locator("[data-private-invoice='expired']").waitFor({ timeout: 30_000 });
    await page.locator("[data-private-invoice]").last().scrollIntoViewIfNeeded();
    await shot(page, "expired", size, lang);
    await page.goto(link, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-screen='private-pay']", { timeout: 120_000 });
    await settle(page);
    await shot(page, "pay-own", size, lang);
    await recipient.close();

    /* ── the payer: no wallet, a wallet without a private balance, one with it; the press; a cut link ── */
    const none = await contextFor(size, lang, null);
    const bare = await none.newPage();
    await bare.goto(link.replace(/^https?:\/\/[^/]+/, base), { waitUntil: "domcontentloaded" });
    await bare.waitForSelector("[data-screen='private-pay']", { timeout: 120_000 });
    await settle(bare);
    await shot(bare, "pay-connect", size, lang);
    await bare.goto(`${base}/private/pay?lang=${lang}#i=cut`, { waitUntil: "domcontentloaded" });
    await bare.reload({ waitUntil: "domcontentloaded" });
    await bare.waitForSelector("[data-screen='private-pay']", { timeout: 120_000 });
    await settle(bare);
    await shot(bare, "pay-broken", size, lang);
    await none.close();

    const payerContext = await contextFor(size, lang, PAYER);
    const payer = await payerContext.newPage();
    payer.on("pageerror", (error) => errors.push(String(error)));
    const keep = (change) => payer.evaluate((next) => sessionStorage.setItem("__stand", JSON.stringify({ ...(window.__stand ?? JSON.parse(sessionStorage.getItem("__stand") || "{}")), ...next })), change);
    await payer.goto(`${base}/money?lang=${lang}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await payer.evaluate(() => localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom"));
    await keep({ registered: [OWNER], held: "0", inbound: [], slot: 1000, proveMs: 3500, sent: 0 });
    const payUrl = `${base}/private/pay?lang=${lang}${new URL(link).hash}`;
    await payer.goto(payUrl, { waitUntil: "domcontentloaded" });
    await payer.waitForSelector("[data-pay-way='wallet']", { timeout: 120_000 });
    await settle(payer);
    await shot(payer, "pay-wallet", size, lang);
    await payer.evaluate(() => (window.__refuse = true));
    await tap(payer.getByRole("button", { name: t.pay }));
    await payer.locator("[data-pay-failure]").waitFor({ timeout: 30_000 });
    await shot(payer, "pay-refused", size, lang);
    // The payer turns their private balance on, and it holds a whole sum: the private way.
    await payer.evaluate(() => (window.__refuse = false));
    await payer.goto(`${base}/money?tab=invoices&lang=${lang}`, { waitUntil: "domcontentloaded" });
    await tap(payer.getByRole("button", { name: t.turnOn }));
    await payer.getByRole("button", { name: t.newInvoice }).waitFor({ timeout: 30_000 });
    await keep({ held: "800000000" });
    await payer.goto(payUrl, { waitUntil: "domcontentloaded" });
    await payer.waitForSelector("[data-pay-way='private']", { timeout: 120_000 });
    await settle(payer);
    await shot(payer, "pay-private", size, lang);
    await tap(payer.getByRole("button", { name: t.pay }));
    await payer.waitForTimeout(1200);
    await shot(payer, "pay-busy", size, lang);
    await payer.locator(`[data-screen='private-pay'] a[href*='explorer']`).waitFor({ timeout: 30_000 });
    await shot(payer, "pay-paid", size, lang);
    await payerContext.close();
    if (errors.length) report.push(`${size.name}/${lang} page errors: ${errors.slice(0, 3).join(" | ")}`);
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
