// «Report» and «Accountant access» beside «Payouts» and private «Invoices» for the eyes — 1920×1080 and 390×844, EN and
// UK → <out>/<state>-<size>-<lang>.jpg and <out>/report.txt.
//   node terminal/money/report/shots.mjs [out] [baseUrl]
// A stand with NEXT_PUBLIC_RYNTRA_TERMINAL=stand and NEXT_PUBLIC_RYNTRA_PRIVATE=devnet (next dev or next start).
//
// For the eyes only — no Helius key, no network, no money. The ring's bundle is the stand module of the payouts shots
// (copied here); the wallet is a Wallet Standard stub that never signs anything here. The record is put in through the
// screen's own «Open record copy» with a file made here — so the shots also walk the copy's way back in.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-343");
const base = process.argv[3] ?? "http://localhost:3343";
if (/mainnet/i.test(base)) process.exit(3);
mkdirSync(out, { recursive: true });

const OWNER = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const REGISTERED = new Set(["3WAjyrF65J4mLUm4eaPKtwYRiqT6t1N3WhAwwheyZpw3"]);
const SIG = (n) => `5h6xBEauJ3PK6SWCZ1PGjBvj8vDdWG3KpwATGy1ARAXFSDwt8GFXM7W5Ncn16wmqokgpiKRLuS83KUxyZy${n}sUYv`;
const now = Date.now();
const day = 86_400_000;
const line = (name, to, amount, note, n, state = "paid") => ({ name, to, amount, coin: "SOL", note, how: "private", state, signature: state === "paid" ? SIG(n) : null, link: null });
const COPY = JSON.stringify({
  kind: "ryntra-private-record",
  v: 1,
  network: "devnet",
  owner: OWNER,
  at: now,
  payouts: [
    { v: 1, id: `${(now - 2 * day).toString(36).padStart(9, "0")}-a`, at: now - 2 * day, network: "devnet", coin: "SOL", fee: "0", lines: [
      line("Oleh", "3WAjyrF65J4mLUm4eaPKtwYRiqT6t1N3WhAwwheyZpw3", "0.4", "design", 1),
      line("Anna", "61AgGzUTxL49Vq1qndTKfL6XZgVRencBdHD5DZtbet8N", "0.35", "audit", 2),
      line("Marko", "8WAca8hqqN3XfBGcvgX8mTEKTUQyVAHUNRtyCcbkPo3y", "0.3", "front end", 3),
      line("Ira", "Cs8KY3PiWrCMAytMsBRQo8EdGbticVtdvufLnb2UhXM", "0.25", "community", 4, "failed"),
    ] },
    { v: 1, id: `${(now - 40 * day).toString(36).padStart(9, "0")}-b`, at: now - 40 * day, network: "devnet", coin: "SOL", fee: "0", lines: [line("Oleh", "3WAjyrF65J4mLUm4eaPKtwYRiqT6t1N3WhAwwheyZpw3", "0.4", "design", 5)] },
  ],
  invoices: [
    { invoice: { id: "00000000000000a1", to: OWNER, mint: "11111111111111111111111111111111", amount: "250000000", forWhat: "Logo, round 2", createdAt: now - day, expiresAt: now + 6 * day }, sinceSlot: "1", fragment: "stand", paid: { signature: SIG(6), slot: "2", key: "k" } },
  ],
  access: [],
});
const copyFile = path.join(os.tmpdir(), "ryntra-record-stand.json");
writeFileSync(copyFile, COPY);

/** The stand's Privacy Rings module: the few names the page uses, answering from memory. */
const STAND_SDK = `
const REG = new Set(${JSON.stringify([...REGISTERED, OWNER])});
let on = false;
const LAMPORTS = 1000000000n;
export const SOL_MINT = '11111111111111111111111111111111';
export const SDK_VERSION = 'stand';
export async function initializePoseidon() {}
export const SignedTeePolicy = { forNetwork: () => ({}) };
const key = () => ({ publicKey: () => ({}), secretBytes: () => crypto.getRandomValues(new Uint8Array(32)), destroy() {} });
export const ViewingKey = { generate: key, fromBytes: key };
export const NullifierKey = { fromSecret: key };
export const ShieldedPublicKey = { fromEd25519: () => ({}) };
export const ShieldedAddress = { fromPublicKeys: () => ({}) };
export const LocalKeys = { fromKeys: ({ address }) => ({ address: () => address }), fromKeypair: () => ({ address: () => ({}) }) };
export const getAddressEncoder = () => ({ encode: () => new Uint8Array(32) });
const parts = [1500000000n, 700000000n, 300000000n];
export class Wallet { constructor() {} utxos() { return parts.map((amount) => ({ spent: false, utxo: { asset: SOL_MINT, amount, data: { isEmpty: () => true } } })); } }
export async function syncWallet() {}
export function getPrivateTokenBalances() { return on ? [{ mint: SOL_MINT, amount: parts.reduce((a, b) => a + b, 0n) }] : []; }
export async function buildRegistrationTransaction({ owner }) { if (on || !REG.has(owner)) { on = true; return undefined; } return undefined; }
const tx = () => ({ messageBytes: crypto.getRandomValues(new Uint8Array(64)) });
export async function buildTransferTransaction() { await new Promise((r) => setTimeout(r, 900)); return tx(); }
export async function buildMultiTransferTransaction() { await new Promise((r) => setTimeout(r, 900)); return tx(); }
export async function buildWithdrawalTransaction() { return tx(); }
export async function buildDepositTransaction() { return tx(); }
export const getTransactionEncoder = () => ({ encode: (t) => t.messageBytes });
export const getTransactionDecoder = () => ({ decode: (wire) => ({ messageBytes: wire }) });
export const getSignatureFromTransaction = () => '5standSig' + Math.random().toString(36).slice(2, 10);
export async function partiallySignTransactionWithSigners(_s, t) { return t; }
export async function createSprClient() {
  return {
    proofService: {},
    async getUserRecords(owners) { return { records: owners.map((a) => (a === ${JSON.stringify(OWNER)} ? (on ? { mergeEncryption: 0 } : null) : REG.has(a) ? { mergeEncryption: 0 } : null)) }; },
    solanaRpc: { sendTransaction: () => ({ send: async () => 'ok' }) },
    async confirmTransaction() { return 1n; },
    async getBalance() { return 0n; },
  };
}
`;

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const plan = "wallet";
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
      await context.addInitScript((l) => {
        try {
          localStorage.setItem("ryntra-lang", l);
          localStorage.setItem("ryntra.city.lang", l);
        } catch {}
      }, lang);
      await context.route("**/privacy/spr-0.9.0-alpha.mjs", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: STAND_SDK }));
      await context.route("**/api/v1/privacy/devnet/**", (route) => json(route, { error: "stand" }, 503));
      await context.route("**/api/solana/holdings*", (route) => json(route, { data: { tokenRead: "COMPLETE", holdings: [] } }));
      await context.route("**/api/solana/activity", (route) => json(route, { data: { actions: [], complete: true } }));
      await context.route("**/api/auth/solana/session*", (route) => json(route, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.addInitScript(
        ({ address, refuse }) => {
          const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#E2DBFF"/></svg>')}`;
          const account = { address, publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Backpack" };
          const wallet = {
            version: "1.0.0",
            name: "Backpack",
            icon,
            chains: ["solana:devnet", "solana:mainnet"],
            accounts: [],
            features: {
              "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
              "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
              "standard:events": { version: "1.0.0", on: () => () => {} },
              "solana:signTransaction": {
                version: "1.0.0",
                supportedTransactionVersions: ["legacy", 0, 1],
                signTransaction: async ({ transaction }) => {
                  await new Promise((r) => setTimeout(r, 600));
                  if (refuse) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
                  return [{ signedTransaction: transaction }];
                },
              },
              "solana:signMessage": { version: "1.0.0", signMessage: async () => Promise.reject(new Error("User rejected the request.")) },
            },
          };
          window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
          window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
        },
        { address: OWNER, refuse: plan === "refuse" },
      );

      const file = (name) => path.join(out, `${name}-${size.name}-${lang}.jpg`);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const shot = async (name, target) => {
        await page.waitForTimeout(700);
        if (target) await target.scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: file(name), quality: 84, type: "jpeg" });
        report.push(`${size.name}/${lang} ${name}: overflow ${await overflow()}px${errors.length ? `; errors ${errors.slice(0, 2).join(" | ")}` : ""}`);
      };
      const T = lang === "uk"
        ? { turnOn: "Увімкнути приватний баланс", report: "Звіт за період", access: "Доступ бухгалтеру", give: "Дати доступ", hint: "Ім’я чи фірма", year: "Рік", earlier: "Попередній період" }
        : { turnOn: "Turn on private balance", report: "Report by period", access: "Accountant access", give: "Give access", hint: "Name or firm", year: "Year", earlier: "Earlier period" };
      const press = async (name) => {
        const button = page.getByRole("button", { name, exact: true }).first();
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await (size.mobile ? button.tap() : button.click());
      };
      await page.goto(`${base}/money?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 }).catch(() => {});
      await page.evaluate(() => {
        try {
          localStorage.setItem("ryntra.solana.wallet-hint.v1", "Backpack");
          localStorage.setItem("ryntra.money.invoices.mode", "private");
        } catch {}
      });
      await page.goto(`${base}/money?lang=${lang}&tab=payouts`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForSelector("main h1", { timeout: 180_000 });
      await page.waitForTimeout(4000);
      await press(T.turnOn).catch(() => {});
      await page.waitForTimeout(2500);
      await press(T.report);
      await shot("report-empty", page.locator("section").last());
      await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(copyFile);
      await page.waitForTimeout(1500);
      await shot("report", page.locator("section").last());
      await press(T.year);
      await shot("report-year", page.locator("section").last());
      const earlier = page.getByRole("button", { name: T.earlier, exact: true }).first();
      await (size.mobile ? earlier.tap() : earlier.click());
      await shot("report-earlier", page.locator("section").last());
      await press(T.access);
      await shot("access", page.locator("section").last());
      await page.getByPlaceholder(T.hint).fill("Iryna · Books & Co");
      const download = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null);
      await press(T.give);
      const got = await download;
      if (got) report.push(`${size.name}/${lang} access file: ${got.suggestedFilename()}`);
      await page.waitForTimeout(800);
      await shot("access-given", page.locator("section").last());
      await page.goto(`${base}/money?lang=${lang}&tab=invoices`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForSelector("main h1", { timeout: 180_000 });
      await page.waitForTimeout(4000);
      await press(T.report).catch(() => {});
      await shot("invoices-report", page.locator("section").last());
      await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
