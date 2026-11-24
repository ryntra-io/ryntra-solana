// «Money → Payouts» for the eyes — every state of the tab at 1920×1080 and 390×844, in English and Ukrainian
// → <out>/<state>-<size>-<lang>.jpg and <out>/report.txt.
//   node terminal/money/payouts/shots.mjs [out] [baseUrl]
// A stand with NEXT_PUBLIC_RYNTRA_TERMINAL=stand and NEXT_PUBLIC_RYNTRA_PRIVATE=devnet (next dev or next start).
// SIZES=wide,phone, LANGS=en,uk and ONLY=<state,state> narrow a run; PRESS_CHROME may point at another browser.
//
// For the eyes only — no Helius key, no network, no money. The page's Privacy Rings bundle is answered by a stand
// module made here (`STAND_SDK`): a private balance of 2.5 SOL in three parts, which recipients have a private balance,
// and transactions that «land» in the page alone. The wallet is a Wallet Standard stub on `solana:devnet` that declares
// version 1 and returns exactly the bytes it was given — or refuses (`refused` state). Ryntra's relay is never reached:
// any call to it answers 503. The real pass on devnet is the lead session's, with the key (PR text, «Пройти ведучій»).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-340");
const base = process.argv[3] ?? "http://localhost:3340";
if (/mainnet/i.test(base)) process.exit(3);
mkdirSync(out, { recursive: true });

const OWNER = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const PEOPLE = [
  ["Oleh", "3WAjyrF65J4mLUm4eaPKtwYRiqT6t1N3WhAwwheyZpw3", "0.4", "design, October"],
  ["Anna", "61AgGzUTxL49Vq1qndTKfL6XZgVRencBdHD5DZtbet8N", "0.35", "audit"],
  ["Marko", "8WAca8hqqN3XfBGcvgX8mTEKTUQyVAHUNRtyCcbkPo3y", "0.3", "front end"],
  ["Ira", "Cs8KY3PiWrCMAytMsBRQo8EdGbticVtdvufLnb2UhXM", "0.25", "community"],
  ["Danylo", "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E", "0.2", "support"],
  ["Sofia", "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH", "0.15", "copy"],
];
/** People with a private balance; the last one has none. */
const REGISTERED = new Set(PEOPLE.slice(0, 5).map((p) => p[1]));

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
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const report = [];

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const plan of ["none", "wallet", "refuse"]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
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
      const shot = async (name) => {
        if (ONLY && !ONLY.has(name)) return;
        await page.waitForTimeout(800);
        await page.screenshot({ path: file(name), quality: 84, type: "jpeg" });
        report.push(`${size.name}/${lang} ${name}: overflow ${await overflow()}px${errors.length ? `; errors ${errors.slice(0, 2).join(" | ")}` : ""}`);
      };
      const open = async (wallet) => {
        await page.goto(`${base}/money?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 }).catch(() => {});
        await page.evaluate((w) => {
          try {
            if (w) localStorage.setItem("ryntra.solana.wallet-hint.v1", "Backpack");
            else localStorage.removeItem("ryntra.solana.wallet-hint.v1");
          } catch {}
        }, wallet);
        await page.goto(`${base}/money?lang=${lang}&tab=payouts`, { waitUntil: "domcontentloaded", timeout: 240_000 });
        await page.waitForSelector("main h1", { timeout: 180_000 });
        await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(wallet ? 4000 : 1200);
      };
      const press = async (name) => {
        const button = page.getByRole("button", { name, exact: true }).first();
        await (size.mobile ? button.tap() : button.click());
      };
      const T = lang === "uk"
        ? { turnOn: "Увімкнути приватний баланс", add: "Додати до списку", pay: "Виплатити", open: "Відкрито" }
        : { turnOn: "Turn on private balance", add: "Add to list", pay: "Pay out", open: "In the open" };

      if (plan === "none") {
        await open(false);
        await shot("connect");
      } else {
        await open(true);
        if (plan === "wallet") await shot("off");
        await press(T.turnOn).catch(() => {});
        await page.waitForTimeout(2500);
        if (plan === "wallet") await shot("empty");
        const list = [...PEOPLE.map(([name, address, amount, note]) => `${name} ${address} ${amount} SOL ${note}`), "Nobody 0.1", `${PEOPLE[1][1]} 0.05 bonus`].join("\n");
        await page.locator("main textarea").first().fill(list);
        await press(T.add);
        await page.waitForTimeout(3000);
        if (plan === "wallet") await shot("list-issues");
        // Mend the list: the unknown name and the second line to Anna go.
        for (let i = 0; i < 2; i += 1) {
          const drop = page.locator("main ul li button").last();
          await (size.mobile ? drop.tap() : drop.click()).catch(() => {});
          await page.waitForTimeout(300);
        }
        await page.waitForTimeout(2500);
        if (plan === "wallet") await shot("ready");
        const inOpen = page.getByRole("radio", { name: T.open, exact: true }).first();
        await (size.mobile ? inOpen.tap() : inOpen.click()).catch(() => {});
        await page.waitForTimeout(800);
        if (plan === "wallet") await shot("ready-open");
        // The stand pays Sofia in the open: a link's own steps need the ring itself.
        await press(T.pay).catch(() => {});
        await page.waitForTimeout(500);
        await shot(plan === "refuse" ? "signing-refuse" : "signing");
        await page.waitForTimeout(plan === "refuse" ? 3000 : 9000);
        await shot(plan === "refuse" ? "refused" : "paid");
      }
      await context.close();
    }
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
