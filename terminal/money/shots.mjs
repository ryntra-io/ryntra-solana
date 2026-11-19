// «Money» for the eyes — «Send · Receive · Invoices» and «Recent transfers» beside them — at 1920×1080,
// 1440×900 and 390×844, in English and Ukrainian → <out>/<state>-<size>-<lang>.jpg, and <out>/report.txt.
//   node terminal/money/shots.mjs [out] [baseUrl]
// A stand built with the terminal on and money open (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`,
// `NEXT_PUBLIC_RYNTRA_CITY_MONEY=open`; next build, then next start). Chromium draws the page (PRESS_CHROME may point at
// another). SIZES=wide,desk,phone, LANGS=en,uk and ONLY=<shot,shot> narrow a run.
//
// Everything a wallet has answers from recorded responses in the engine's own shapes: the wallet's coins
// (`/api/solana/holdings`), its ledger (`/api/solana/activity`), the recipient check (`/api/v1/money/recipient`, contract
// 1.22.0), the session's proof (`/api/auth/solana/session`) and the payment links (`/api/v1/pay/requests`, checked
// against `PayLinkSchema`). Any other call answers 503. The stand wallet connects and refuses every signature — a
// message and a transaction alike: a link asked for without a proof ends in «Nothing was signed». Nothing is sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PayLinkSchema, RecipientCheckResponseSchema } from "../../lib/api/v1/contract.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-306");
const base = process.argv[3] ?? "http://localhost:3306";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const ALICE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ALICE_ATA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const REF = (n) => ["8xg1", "Cq2z", "Hb4m", "Kw7p", "Tn3v"][n] + "ZQ5dVb3pXrN7Lk9mWfYtE2sGhJcRa6uB1nP";
const SIG = "4kPmY7xbN2sR8vL1qT5wZcH3jD9fG6aE2nU7yK4mB8pX1rS5tV3wQ9zC6dF2hJ8kL4nM7pR1sT5vW9xZ3bD6fG";

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const report = [];
const FORM = new Set(["square", "cut", "r4", "pill"]);

/** Every visible box with a frame or a fill, and its shape. Runs in the page. */
function measure() {
  const boxes = [];
  const clear = /rgba\(0, 0, 0, 0\)|transparent/;
  for (const el of document.querySelectorAll("main *, [role='dialog'] *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 22) continue;
    if (r.bottom < 0 || r.top > innerHeight * 3 || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && !clear.test(cs[`border${s}Color`]));
    const framed = sides.length >= 3;
    const filled = !clear.test(cs.backgroundColor) || cs.backgroundImage !== "none";
    if (!framed && !filled) continue;
    const px = parseFloat(cs.borderTopLeftRadius) || 0;
    const half = Math.min(r.width, r.height) / 2;
    const cut = cs.clipPath && cs.clipPath !== "none";
    const shape = cut ? "cut" : px === 0 ? "square" : px >= half - 0.5 ? "pill" : `r${Math.round(px)}`;
    const cls = String(el.className?.baseVal ?? el.className ?? "").split(" ")[0].slice(0, 36);
    boxes.push({ shape, cls, w: Math.round(r.width), h: Math.round(r.height) });
  }
  return boxes;
}

/* ── recorded answers ── */
const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "4250000000", spendableRaw: "4240000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: "142.1", dayChangePct: 1.2 } },
  { kind: "TOKEN", mint: USDC, amountRaw: "1250000000", spendableRaw: "1250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1", icon: "/site/universe/USDC.png", dayChangePct: 0 } },
  { kind: "TOKEN", mint: JUP, amountRaw: "135600000", spendableRaw: "135600000", decimals: 6, symbol: "JUP", catalog: { symbol: "JUP", name: "Jupiter", isVerified: true, usdPrice: "0.27", icon: null, dayChangePct: -2.1 } },
];

function history(now) {
  const at = (ms) => new Date(now - ms).toISOString();
  const line = (id, lane, startedAt, spent, got, outcome = "DONE", destination = null) => ({ schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet: OWNER, actionId: `stand-${id}-0000000000`, lane, outcome, out: spent, in: got, destination, signature: null, receiptHash: null, sourceTx: null, destinationTx: null, fee: null, origin: null, providerRef: null, statedUsd: null, startedAt, updatedAt: startedAt });
  const usdc = (raw) => ({ mint: USDC, amountRaw: raw, decimals: 6, symbol: "USDC" });
  const sol = (raw) => ({ mint: null, amountRaw: raw, decimals: 9, symbol: "SOL" });
  return [
    line("a", "SEND", at(4 * 60_000), usdc("25000000"), null),
    line("b", "SWAP", at(30 * 60_000), usdc("100000000"), sol("700000000")),
    line("c", "RECEIVE", at(3 * 3_600_000), null, usdc("120000000")),
    line("d", "BRIDGE", at(6 * 3_600_000), usdc("50000000"), null, "MOVING", "BASE"),
    line("e", "SEND", at(26 * 3_600_000), sol("500000000"), null),
    line("f", "RECEIVE", at(3 * 86_400_000), null, sol("1200000000")),
  ];
}

const RECIPIENT = {
  input: "address",
  next: "transfer",
  problem: null,
  address: ALICE,
  asset: { mint: USDC },
  destination: { kind: "wallet", owner: ALICE, account: ALICE_ATA, opensAccount: false },
  asked: null,
  link: null,
  checkedAt: new Date().toISOString(),
};
if (!RecipientCheckResponseSchema.safeParse(RECIPIENT).success) throw new Error("the recipient check is not the contract's");

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
function link(n, over) {
  const id = `${["Pq8", "Rt4", "Vw2", "Xy7", "Za9"][n]}k2rT4xWbN9mLp3`;
  const amount = over.amount ?? null;
  const decimals = over.symbol === "SOL" ? 9 : 6;
  const raw = amount ? String(Math.round(Number(amount) * 10 ** decimals)) : null;
  const mint = over.symbol === "SOL" ? null : USDC;
  const value = {
    id,
    url: `https://ryntra.io/pay/${id}`,
    payUrl: `solana:${OWNER}?${amount ? `amount=${amount}&` : ""}${mint ? `spl-token=${mint}&` : ""}reference=${REF(n)}`,
    status: over.status ?? "AWAITING",
    note: over.note ?? null,
    token: { symbol: over.symbol ?? "USDC", mint, decimals },
    amount: amount ? { raw, display: amount } : null,
    description: over.description ?? null,
    recipient: { abbreviated: "4EeX…KPGW", address: OWNER },
    reference: REF(n),
    createdAt: iso(over.made ?? 3_600_000),
    expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    paid: over.paid ? { signature: SIG, creditedRaw: raw, credited: amount, paidAt: iso(over.paid) } : null,
    received: over.received ? { raw: String(Math.round(Number(over.received) * 10 ** decimals)), amount: over.received, feeWithheldRaw: null, feeWithheld: null } : null,
  };
  const parsed = PayLinkSchema.safeParse(value);
  if (!parsed.success) throw new Error(`link ${n} is not the contract's: ${parsed.error.message}`);
  return value;
}
const LINKS = [
  link(0, { amount: "120", description: "Logo and brand kit", made: 40 * 60_000 }),
  link(1, { amount: "0.75", symbol: "SOL", status: "PAID", paid: 5 * 3_600_000, received: "0.75", made: 9 * 3_600_000 }),
  link(2, { amount: "300", status: "CHECKING", note: "UNDERPAID", received: "180", description: "November rent share", made: 2 * 86_400_000 }),
  link(3, { amount: "45", status: "EXPIRED", made: 9 * 86_400_000 }),
];
const MADE = link(4, { amount: "250", description: "Design work", made: 1_000 });

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const shots = [];
for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    for (const plan of ["none", "proven", "unproven"]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: uk ? "uk-UA" : "en-US", timezoneId: "Europe/Kyiv" });
      const asked = { posts: [], gets: 0, signs: 0, messages: 0, transfers: 0 };
      await context.route("**/api/**", (route) => json(route, {}, 503));
      await context.route("**/api/icon/**", (route) => {
        const mint = new URL(route.request().url()).pathname.split("/").pop();
        if (mint === SOL) return route.fulfill({ path: "public/site/universe/SOL.png", contentType: "image/png" });
        return route.fulfill({ status: 404, body: "" });
      });
      await context.route("**/api/solana/holdings*", (route) => json(route, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
      await context.route("**/api/solana/activity", (route) => json(route, { data: { actions: history(Date.now()), complete: true } }));
      await context.route("**/api/v1/money/recipient?*", (route) => json(route, RECIPIENT));
      await context.route("**/api/v1/research/address-evidence?*", (route) => json(route, { error: { code: "UNAVAILABLE", message: "Not on the stand." } }, 503));
      await context.route("**/api/solana/transfer/**", (route) => ((asked.transfers += 1), json(route, {}, 503)));
      await context.route("**/api/auth/solana/session*", (route) =>
        json(route, { signedIn: false, walletAddress: null, proof: plan === "proven" ? { address: OWNER, via: "proof", expiresAt: new Date(Date.now() + 86_400_000).toISOString() } : null, at: Date.now() }),
      );
      await context.route("**/api/auth/solana?*", (route) => json(route, { input: { domain: "ryntra.io", address: OWNER, statement: "Sign in to Ryntra", nonce: "stand0000000", issuedAt: new Date().toISOString() }, message: "ryntra.io wants you to sign in with your Solana account" }));
      await context.route("**/api/v1/pay/requests", (route) => {
        if (route.request().method() === "POST") {
          asked.posts.push(route.request().postDataJSON());
          if (plan !== "proven") return json(route, { error: { code: "UNAUTHORIZED", message: "No proven wallet." } }, 401);
          return json(route, { link: MADE }, 201);
        }
        asked.gets += 1;
        if (plan !== "proven") return json(route, { error: { code: "UNAUTHORIZED", message: "No proven wallet." } }, 401);
        const made = asked.posts.length ? [MADE] : [];
        return json(route, { address: OWNER, links: [...made, ...LINKS] });
      });

      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error" && !/Failed to load resource|503|401|404/.test(message.text())) errors.push(message.text());
      });
      await page.exposeFunction("__counted", (what) => (asked[what] += 1));
      // A stub wallet in the Wallet Standard registry: it connects, and refuses every signature.
      await page.addInitScript(({ address }) => {
        const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
        const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
        const refuse = (what) => {
          window.__counted(what);
          return Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 }));
        };
        const wallet = {
          version: "1.0.0",
          name: "Phantom",
          icon,
          chains: ["solana:mainnet"],
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

      const file = (name) => path.join(out, `${name}-${size.name}-${lang}.jpg`);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const ambers = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("main button, main a")]
            .filter((el) => el.offsetParent !== null && getComputedStyle(el).clipPath !== "none" && getComputedStyle(el).clipPath !== "")
            .map((el) => el.textContent.trim()),
        );
      const shot = async (name, { full = false, block = null } = {}) => {
        if (ONLY && !ONLY.has(name)) return;
        if (block) await block.evaluate((node) => node.scrollIntoView({ block: "center" })).catch(() => {});
        await page.waitForTimeout(700);
        await page.screenshot({ path: file(name), quality: 84, type: "jpeg", fullPage: full });
        const boxes = await page.evaluate(measure);
        const tally = {};
        for (const box of boxes) tally[box.shape] = (tally[box.shape] ?? 0) + 1;
        const odd = boxes.filter((box) => !FORM.has(box.shape));
        const amber = await ambers();
        shots.push(`${name}-${size.name}-${lang}`);
        report.push(`${size.name}/${lang} ${name}: corners ${JSON.stringify(tally)}${odd.length ? ` ODD ${JSON.stringify(odd.slice(0, 3))}` : ""}; amber ${JSON.stringify(amber)}; overflow ${await overflow()}px`);
      };
      const settle = async () => {
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
        await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1200);
      };
      const open = async (query, wallet) => {
        await page.goto(`${base}/money?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 }).catch(() => {});
        await page.evaluate((on) => {
          try {
            if (on) localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
            else localStorage.removeItem("ryntra.solana.wallet-hint.v1");
          } catch {}
        }, wallet);
        await page.goto(`${base}/money?lang=${lang}${query}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.waitForSelector("main h1", { timeout: 120_000 });
        await settle();
        await page.waitForTimeout(wallet ? 3500 : 800);
      };
      const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
      const words = uk
        ? { to: /Кому/i, amount: "Сума", forWhat: "За що", d30: "30 днів", create: "Створити посилання", invoices: "Рахунки", show: "Показати мої посилання" }
        : { to: /To/i, amount: "Amount", forWhat: "What it is for", d30: "30 days", create: "Create link", invoices: "Invoices", show: "Show my links" };

      if (plan === "none") {
        // ── no wallet: one line and «Connect wallet» on each tab ──
        await open("", false);
        await shot("send-connect");
        await open("&tab=receive", false);
        await shot("receive-connect");
        // ── the Portfolio's old panel leads on to «Money» in one step ──
        await page.goto(`${base}/portfolio?lang=${lang}&act=receive`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.waitForURL(/\/money/, { timeout: 30_000 }).catch(() => {});
        report.push(`${size.name}/${lang}: /portfolio?act=receive led to ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
      }

      if (plan === "proven") {
        // ── Send: the wallet's coins, a Solana address, the amount ──
        await open("", true);
        await shot("send");
        const to = page.locator("main input").first();
        await to.fill(ALICE);
        await page.locator("main input[inputmode='decimal']").first().fill("25");
        await page.waitForTimeout(2500);
        await shot("send-filled");
        report.push(`${size.name}/${lang}: send — transfers asked ${asked.transfers}, signatures asked ${asked.signs}`);

        // ── Receive: the address, its QR, one copy ──
        await tap(page.getByRole("tab", { name: uk ? "Отримати" : "Receive" }));
        await settle();
        await shot("receive");
        report.push(`${size.name}/${lang}: receive tab → ${new URL(page.url()).search}`);

        // ── Invoices: the form, the person's links, a new one ──
        await tap(page.getByRole("tab", { name: words.invoices }));
        await page.waitForTimeout(2500);
        await settle();
        await shot("invoices");
        await shot("invoices-full", { full: true });
        await page.locator("main input[inputmode='decimal']").first().fill("250");
        await page.getByPlaceholder(uk ? "Можна не писати — платник це бачить" : "Optional — the payer sees it").fill("Design work");
        await tap(page.getByRole("button", { name: words.d30, exact: true }));
        await page.waitForTimeout(400);
        await shot("invoices-filled");
        await tap(page.getByRole("button", { name: words.create, exact: true }));
        await page.waitForSelector("[data-pay-made]", { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1800);
        await shot("invoices-made");
        if (size.mobile) await shot("invoices-made-list", { block: page.locator("main section").last() });
        report.push(`${size.name}/${lang}: invoices — asked to make ${JSON.stringify(asked.posts.at(-1) ?? null)}; messages to sign ${asked.messages}; links read ${asked.gets}`);
      }

      if (plan === "unproven") {
        // ── no proof yet: the list is locked; a link asked for asks the wallet's one message — refused ──
        await open("&tab=invoices", true);
        await shot("invoices-locked");
        await page.locator("main input[inputmode='decimal']").first().fill("40");
        await tap(page.getByRole("button", { name: words.create, exact: true }));
        await page.waitForTimeout(3000);
        await shot("invoices-declined");
        report.push(`${size.name}/${lang}: unproven — messages asked ${asked.messages}, links made ${asked.posts.length}, signatures ${asked.signs}`);
      }

      if (errors.length) report.push(`${size.name}/${lang} ${plan}: page errors ${JSON.stringify(errors.slice(0, 3))}`);
      await context.close();
    }
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
console.log(`${shots.length} shots → ${out}`);
