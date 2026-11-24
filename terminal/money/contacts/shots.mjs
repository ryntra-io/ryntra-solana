// «Contacts» and «Autopay» for the eyes — each tab of «Money» with its panel and its list, and the contacts
// under «To» in «Send» — at 1920×1080 and 390×844 (DESK=1 adds 1440×900), in English and Ukrainian →
// <out>/<state>-<size>-<lang>.jpg, and <out>/report.txt.
//   node terminal/money/contacts/shots.mjs [out] [baseUrl]
// A stand with the terminal on, money open and both tabs open (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`,
// `NEXT_PUBLIC_RYNTRA_CITY_MONEY=open`, `NEXT_PUBLIC_RYNTRA_CONTACTS=1`, `NEXT_PUBLIC_RYNTRA_AUTOPAY=devnet`).
// SIZES=wide,desk,phone, LANGS=en,uk and ONLY=<shot,shot> narrow a run.
//
// Everything a wallet has answers from recorded responses in the engine's own shapes: the wallet's coins and ledger,
// the session's proof, the book (`/api/v1/contacts`) and the autopays (`/api/v1/autopay`, records read back by the
// engine's own `recordOf`). Any other call answers 503. The stand wallet connects and refuses every signature — a
// message and a transaction alike: a save or a start ends in «Nothing signed». Nothing is sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { recordOf } from "../../../lib/autopay/record.ts";
import { contactOf } from "../../../lib/contacts/model.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-307");
const base = process.argv[3] ?? "http://localhost:3307";
mkdirSync(out, { recursive: true });

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const MOM = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const LANDLORD = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TEAM = "Hb4mZQ5dVb3pXrN7Lk9mWfYtE2sGhJcRa6uB1nPKw7pT";

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  ...(process.env.DESK ? [{ name: "desk", width: 1440, height: 900, mobile: false }] : []),
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const report = [];

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const CONTACTS = [
  { id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Mom", to: MOM, note: "Monthly help", createdAt: iso(9 * 86_400_000), updatedAt: iso(2 * 86_400_000) },
  { id: "2b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Landlord", to: LANDLORD, note: "Rent", createdAt: iso(20 * 86_400_000), updatedAt: iso(5 * 86_400_000) },
  { id: "3b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Design team", to: TEAM, note: null, createdAt: iso(30 * 86_400_000), updatedAt: iso(9 * 86_400_000) },
  { id: "4b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Alice", to: "alice.skr", note: null, createdAt: iso(40 * 86_400_000), updatedAt: iso(12 * 86_400_000) },
];
for (const contact of CONTACTS) if (!contactOf(contact)) throw new Error(`${contact.name} is not a contact the engine reads`);

const nowSeconds = Math.floor(Date.now() / 1000);
const DAY = 86_400;
/** An autopay record as the engine writes it (the addresses derive from the stand's settings: `recordOf` keeps them). */
function autopay(n, over) {
  const value = {
    id: `${n}c4e28ba-2fa1-41d2-883f-0016d3cca427`,
    network: "devnet",
    owner: OWNER,
    agent: "FPww7mrcY56cwCwS4LGeVLWR5uYR4b2MzQxD8LUgYacQ",
    settings: "8xg1ZQ5dVb3pXrN7Lk9mWfYtE2sGhJcRa6uB1nPKw7pT",
    vault: "Cq2zZQ5dVb3pXrN7Lk9mWfYtE2sGhJcRa6uB1nPKw7pT",
    vaultIndex: 128 + n,
    policy: "Tn3vZQ5dVb3pXrN7Lk9mWfYtE2sGhJcRa6uB1nPKw7pT",
    policySeed: String(3 + n),
    coin: "USDC",
    recipient: LANDLORD,
    label: "Landlord",
    amount: "900000000",
    every: "month",
    count: 12,
    startAt: nowSeconds - 40 * DAY,
    endsAt: nowSeconds - 40 * DAY + 12 * 30 * DAY,
    status: "working",
    createdAt: iso(40 * 86_400_000),
    updatedAt: iso(10 * 86_400_000),
    payments: [],
    ...over,
  };
  if (!recordOf(value)) throw new Error(`autopay ${n} is not a record the engine reads`);
  return value;
}
const AUTOPAYS = [
  autopay(1, { payments: [{ window: 0, state: "paid", signature: null, at: iso(40 * 86_400_000) }, { window: 1, state: "paid", signature: null, at: iso(10 * 86_400_000) }] }),
  autopay(2, { recipient: MOM, label: "Mom", coin: "SOL", amount: "250000000", every: "week", count: 26, startAt: nowSeconds - 15 * DAY, endsAt: nowSeconds - 15 * DAY + 26 * 7 * DAY, payments: [{ window: 0, state: "paid", signature: null, at: iso(15 * 86_400_000) }, { window: 1, state: "missed", signature: null, at: iso(8 * 86_400_000) }, { window: 2, state: "paid", signature: null, at: iso(1 * 86_400_000) }] }),
  autopay(3, { recipient: TEAM, label: "Design team", amount: "1500000000", count: 3, startAt: nowSeconds - 100 * DAY, endsAt: nowSeconds - 100 * DAY + 3 * 30 * DAY, status: "ended", payments: [0, 1, 2].map((window) => ({ window, state: "paid", signature: null, at: iso((100 - window * 30) * 86_400_000) })) }),
];

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "4250000000", spendableRaw: "4240000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: "142.1", dayChangePct: 1.2 } },
  { kind: "TOKEN", mint: USDC, amountRaw: "1250000000", spendableRaw: "1250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1", icon: "/site/universe/USDC.png", dayChangePct: 0 } },
];

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

let count = 0;
for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    for (const plan of ["none", "proven", "empty", "unproven"]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: Number(process.env.SCALE ?? 2), isMobile: size.mobile, hasTouch: size.mobile, locale: uk ? "uk-UA" : "en-US", timezoneId: "Europe/Kyiv" });
      const asked = { messages: 0, signs: 0, posts: 0 };
      await context.route("**/api/**", (route) => json(route, {}, 503));
      await context.route("**/api/icon/**", (route) => route.fulfill({ status: 404, body: "" }));
      await context.route("**/api/solana/holdings*", (route) => json(route, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
      await context.route("**/api/solana/activity", (route) => json(route, { data: { actions: [], complete: true } }));
      await context.route("**/api/auth/solana/session*", (route) => json(route, { signedIn: false, walletAddress: null, proof: plan === "unproven" ? null : { address: OWNER, via: "proof", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, at: Date.now() }));
      await context.route("**/api/auth/solana?*", (route) => json(route, { input: { domain: "ryntra.io", address: OWNER, statement: "Sign in to Ryntra", nonce: "stand0000000", issuedAt: new Date().toISOString() }, message: "ryntra.io wants you to sign in with your Solana account" }));
      const locked = (route) => json(route, { error: { code: "UNAUTHORIZED", message: "No proven wallet." } }, 401);
      await context.route("**/api/v1/contacts", (route) => {
        if (route.request().method() === "POST") return (asked.posts += 1), json(route, { error: { code: "SIGNATURE_INVALID", message: "x" } }, 400);
        if (plan === "unproven") return locked(route);
        return json(route, { address: OWNER, contacts: plan === "empty" ? [] : CONTACTS });
      });
      await context.route("**/api/v1/autopay", (route) => {
        if (plan === "unproven") return locked(route);
        return json(route, { address: OWNER, network: "devnet", executor: "FPww7mrcY56cwCwS4LGeVLWR5uYR4b2MzQxD8LUgYacQ", autopays: plan === "empty" ? [] : AUTOPAYS });
      });
      await context.route("**/api/v1/autopay/**", (route) => ((asked.posts += 1), json(route, { error: { code: "UNAVAILABLE", message: "Not on the stand." } }, 503)));

      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.exposeFunction("__counted", (what) => (asked[what] += 1));
      await page.addInitScript(({ address }) => {
        const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
        const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
        const refuse = (what) => {
          window.__counted(what);
          return Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 }));
        };
        const wallet = {
          version: "1.0.0",
          name: "Phantom",
          icon,
          chains: ["solana:mainnet", "solana:devnet"],
          accounts: [],
          features: {
            "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
            "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
            "standard:events": { version: "1.0.0", on: () => () => {} },
            "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => refuse("signs") },
            "solana:signMessage": { version: "1.0.0", signMessage: () => refuse("messages") },
          },
        };
        window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
      }, { address: OWNER });

      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const ambers = () => page.evaluate(() => [...document.querySelectorAll("main button, main a")].filter((el) => el.offsetParent !== null && getComputedStyle(el).clipPath !== "none" && getComputedStyle(el).clipPath !== "").map((el) => el.textContent.trim()));
      const shot = async (name, { full = false, block = null } = {}) => {
        if (ONLY && !ONLY.has(name)) return;
        if (block) await block.evaluate((node) => node.scrollIntoView({ block: "center" })).catch(() => {});
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(out, `${name}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg", fullPage: full });
        count += 1;
        report.push(`${size.name}/${lang} ${name}: amber ${JSON.stringify(await ambers())}; overflow ${await overflow()}px`);
      };
      const open = async (query, wallet) => {
        await page.goto(`${base}/money?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 }).catch(() => {});
        await page.evaluate((on) => {
          try {
            if (on) localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
            else localStorage.removeItem("ryntra.solana.wallet-hint.v1");
          } catch {}
        }, wallet);
        await page.goto(`${base}/money?lang=${lang}${query}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
        await page.waitForSelector("main h1", { timeout: 300_000 });
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(wallet ? 4000 : 1200);
      };
      const tap = (locator) => (size.mobile ? locator.tap() : locator.click());

      if (plan === "none") {
        await open("&tab=contacts", false);
        await shot("contacts-connect");
        await open("&tab=autopay", false);
        await shot("autopay-connect");
      }
      if (plan === "proven") {
        await open("&tab=contacts", true);
        await shot("contacts");
        if (size.mobile) await shot("contacts-list", { block: page.locator("main section").last() });
        await page.locator("main input").nth(0).fill("Landlord 2");
        await page.locator("main input").nth(1).fill(`${LANDLORD.slice(0, 4)}${TEAM.slice(4, -4)}${LANDLORD.slice(-4)}`);
        await page.waitForTimeout(500);
        await shot("contacts-lookalike");
        await page.locator("main input").nth(1).fill(TEAM.replace("Hb4m", "Hb4n"));
        await tap(page.getByRole("button", { name: uk ? "Зберегти контакт" : "Save contact", exact: true }));
        await page.waitForTimeout(2500);
        await shot("contacts-declined");
        report.push(`${size.name}/${lang}: contacts — messages asked ${asked.messages}, changes posted ${asked.posts}`);

        await open("&tab=autopay", true);
        await shot("autopay");
        if (size.mobile) await shot("autopay-list", { block: page.locator("main section").last() });
        await tap(page.getByRole("button", { name: uk ? "Обрати: Landlord" : "Choose Landlord" }).first()).catch(() => {});
        await page.locator("main input[inputmode='decimal']").first().fill("900");
        await page.waitForTimeout(500);
        await shot("autopay-filled");
        await tap(page.getByRole("button", { name: uk ? "Як працює автоплатіж" : "How autopay works" })).catch(() => {});
        await page.waitForTimeout(400);
        await shot("autopay-how");

        await open("", true);
        await page.locator("main input").first().fill("La");
        await page.waitForTimeout(800);
        await shot("send-contacts");
        await page.locator("main input").first().fill(MOM);
        await page.waitForTimeout(2500);
        await shot("send-known");
      }
      if (plan === "empty") {
        await open("&tab=contacts", true);
        await shot("contacts-empty", { block: page.locator("main section").last() });
        await open("&tab=autopay", true);
        await shot("autopay-empty", { block: page.locator("main section").last() });
      }
      if (plan === "unproven") {
        await open("&tab=contacts", true);
        await shot("contacts-locked", { block: page.locator("main section").last() });
        await open("&tab=autopay", true);
        await shot("autopay-locked", { block: page.locator("main section").last() });
        report.push(`${size.name}/${lang}: unproven — messages ${asked.messages}, signatures ${asked.signs}, posts ${asked.posts}`);
      }
      if (errors.length) report.push(`${size.name}/${lang} ${plan}: page errors ${JSON.stringify(errors.slice(0, 3))}`);
      await context.close();
    }
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
console.log(`${count} shots → ${out}`);
