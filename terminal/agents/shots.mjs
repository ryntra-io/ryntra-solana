// The Agents screen for the eyes, at 1440×900 and 390×844, in English and Ukrainian → <out>/*.jpg
//   node terminal/agents/shots.mjs <out> [baseUrl] [real|demo]
// A stand runs with the terminal's switch and the agent's switches as production has them:
//   NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet
//   NEXT_PUBLIC_RYNTRA_CITY_PILOT=open NEXT_PUBLIC_RYNTRA_AGENT_CARE=mainnet next build && next start
// The system Chrome draws the page (PRESS_CHROME may point at another). A test wallet of the page's own answers the
// browser's wallet standard: it connects, and refuses every signature it is asked for — nothing is ever signed.
//   real — the market's read and the stand's own server; the wallet's agents as ryntra.io reads them for the test
//          wallet (a read only: its agents, its plan, its pools).
//   demo — the same screens over a fixture of one agent at work, for comparing with the approved design; its figures
//          are the fixture's, never a person's.
import { Keypair } from "@solana/web3.js";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "agents-shots");
const base = process.argv[3] ?? "http://localhost:3255";
const mode = process.argv[4] === "demo" ? "demo" : "real";
const LIVE = "https://ryntra.io";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const PRO = process.env.PRO === "1";
/** ONLY=a,b — draw just these shots (the steps between still run). */
const ONLY_SHOTS = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
/** «Pro» as the browser remembers it; its shots carry «-pro». */
const proOn = (context) => (PRO ? context.addInitScript(() => window.localStorage.setItem("ryntra.terminal.pro.v1", "1")) : Promise.resolve());
const PRO_TAG = PRO ? "-pro" : "";
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const SAY = { en: "Trade BONK for me, 0.1 SOL a day", uk: "Торгуй BONK на 0,1 SOL на день" };
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const key = () => Keypair.generate().publicKey.toBase58();
const OWNER = key();
const WALLET = "Stand Wallet";
const report = [`mode ${mode}`];

/* ---------------------------------------------------------------- the demo's fixture: one trader, one pool */

const now = Date.now();
const RECORD = { owner: OWNER, settings: key(), vault: key(), policy: key(), budget: key(), perTrade: "20000000", perDay: "100000000", expiresAt: String(Math.floor(now / 1000) + 27 * 86_400 + 60) };
const POOL = key();
const DAY = { since: now - 86_400_000, until: now, trades: 3, spentRaw: "40000000", boughtRaw: "1200000000", worthRaw: "95000000", earnedRaw: "55000000", netRaw: "54000000", holdRaw: "21000000" };
const VIEW = {
  status: "working",
  strategy: "steady",
  receiveMint: BONK,
  symbol: "BONK",
  everyMs: 4 * 3_600_000,
  result: { trades: 3, spentRaw: "40000000", boughtRaw: "1200000000", worthRaw: "95000000", earnedRaw: "55000000", multiple: 2.3 },
  last: [
    { at: now - 3_600_000, ok: true, state: "ok", signature: null, spentRaw: "20000000", receivedRaw: "600000000" },
    { at: now - 5 * 3_600_000, ok: true, state: "ok", signature: null, spentRaw: "10000000", receivedRaw: "300000000" },
    { at: now - 9 * 3_600_000, ok: true, state: "ok", signature: null, spentRaw: "10000000", receivedRaw: "300000000" },
  ],
  mission: { state: "waiting", reason: null, nextAt: now + 3_600_000 },
  books: { state: "exact", budgetRaw: "100000000", spentRaw: "40000000", leftRaw: "60000000", pendingRaw: "0", gapRaw: "0" },
  updatedAt: now,
  day: DAY,
  net: { trades: 3, spentRaw: "40000000", netRaw: "54000000", holdRaw: "21000000", feesRaw: "300000" },
};
const EMPTY_NET = { read: true, mandates: [], pilot: null, cares: [] };
const AGENTS = {
  owner: OWNER,
  networks: {
    mainnet: { read: true, mandates: [{ record: RECORD, status: "working", budgetLamports: "60000000", live: true, active: true, trades: 3, pilot: false, frozen: false, createdAt: now - 3 * 86_400_000 }], pilot: null, cares: [{ key: "care-1", pool: POOL, status: "working" }] },
    devnet: EMPTY_NET,
  },
};
const CARES = { ok: true, network: "mainnet", cares: [{ key: "care-1", pool: POOL, status: "working", inRange: true, day: { claimedInY: 0.0118, reinvestedInY: 0.0045, rebalances: 1 } }] };
const HOLDINGS = { data: { holdings: [{ kind: "NATIVE_SOL", mint: null, spendableRaw: "1500000000", decimals: 9 }], tokenRead: "COMPLETE" } };

/* ---------------------------------------------------------------- the test wallet */

function walletScript({ owner, name, demo, record }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
    if (demo) localStorage.setItem("ryntra.city.mandate.mainnet.v1", JSON.stringify({ [owner]: record }));
  } catch {}
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: name };
  const refuse = (what) => async () => {
    asked.push(what);
    throw new Error("User rejected the request.");
  };
  const wallet = {
    version: "1.0.0",
    name,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    chains: ["solana:mainnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse("signTransaction") },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: refuse("signAndSendTransaction") },
      "solana:signMessage": { version: "1.0.0", signMessage: refuse("signMessage") },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

/** ryntra.io's own read for the test wallet: the agents, the plan, the pools. Nothing else goes there. */
async function fromLive(route, request) {
  const url = new URL(request.url());
  const body = request.postData();
  if (url.pathname === "/api/city/earn/care" && JSON.parse(body ?? "{}").action !== "status") return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  const answer = await fetch(`${LIVE}${url.pathname}${url.search}`, { method: request.method(), headers: { "content-type": "application/json", origin: LIVE }, body: request.method() === "POST" ? body : undefined }).catch(() => null);
  if (!answer) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  return route.fulfill({ status: answer.status, contentType: "application/json", body: await answer.text() });
}

const json = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    await proOn(context);
    await context.route("**/api/**", (route, request) => {
      const { pathname } = new URL(request.url());
      if (pathname === "/api/city" || pathname.startsWith("/api/icon/")) return route.continue();
      // The budget's review on the stand: its own server, where the agent's engine is shut — so it stops before the wallet.
      if (pathname === "/api/bots/mandate/review") return route.continue();
      if (mode === "demo") {
        if (pathname === "/api/bots/agents") return json(route, AGENTS);
        if (pathname === "/api/bots/mandate/agent") return json(route, VIEW);
        if (pathname === "/api/bots/mandate/status") return json(route, { active: true, budgetLamports: "60000000" });
        if (pathname === "/api/city/earn/care") return json(route, CARES);
        if (pathname === "/api/solana/holdings") return json(route, HOLDINGS);
        if (pathname === "/api/bots/pilot") return json(route, { error: { code: "NO_PILOT", message: "No autopilot for this wallet." } }, 404);
      } else if (["/api/bots/agents", "/api/bots/pilot", "/api/city/earn/care", "/api/bots/mandate/test"].includes(pathname)) {
        return fromLive(route, request);
      }
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const shot = async (state) => {
      if (ONLY_SHOTS && !ONLY_SHOTS.has(state)) return;
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}${PRO_TAG}-${lang}.jpg`), quality: 86, type: "jpeg" });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const open = async () => {
      await page.goto(`${base}/agent?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("[data-agents]", { timeout: 180_000 });
      await page.waitForResponse((res) => res.url().includes("/api/city"), { timeout: 20_000 }).catch(() => {});
      await settle();
    };

    if (mode === "real") {
      // 1. No wallet: the line, the ready sentences, the agents to hire, the new agent's card, the quiet empty state.
      await open();
      await shot("home");

      // 2. A sentence said in the screen's own line: the agent's card fills with the coin and the budget.
      const field = page.locator("[data-agents] input[type='text']:visible").first();
      await tap(field);
      await field.fill(SAY[lang]);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(900);
      await settle();
      report.push(`${size.name}/${lang}: said here → the card on «${await page.locator("[data-agent-coin][aria-checked='true']").first().textContent().catch(() => "?")}»`);
      await shot("said");

      // 3. The same sentence to the header's line, from another screen's address: the agent's row first, then this screen.
      if (!size.mobile && (!ONLY_SHOTS || ONLY_SHOTS.has("header-rows"))) {
        await page.goto(`${base}/terminal/kit/market?lang=${lang}`, { waitUntil: "domcontentloaded" });
        await settle();
        await page.keyboard.press("Control+k");
        const line = page.getByRole("combobox").first();
        await line.fill(SAY[lang]);
        await page.waitForSelector("[role='listbox']:not([hidden]) [role='option']", { timeout: 20_000 });
        report.push(`${size.name}/${lang}: header rows — ${(await page.locator("[role='listbox'] [role='option']").allTextContents()).join(" | ")}`);
        await shot("header-rows");
      }

      // 4. The test wallet, granted before: the card's one action is the wallet's — and it stops before the wallet.
      await context.addInitScript(walletScript, { owner: OWNER, name: WALLET, demo: false, record: RECORD });
      await open();
      await page.waitForSelector("[data-agent-give]", { timeout: 30_000 }).catch(() => {});
      if (size.mobile) {
        await tap(page.locator("[data-agent-hire]"));
        await page.waitForTimeout(600);
      }
      await settle();
      await shot("wallet");
      const give = page.locator("[data-agent-give]:visible");
      report.push(`${size.name}/${lang}: the action — «${await give.textContent().catch(() => "?")}», enabled ${await give.isEnabled().catch(() => false)}`);
      if (await give.isEnabled().catch(() => false)) {
        await tap(give);
        await page.waitForSelector("[role='status']", { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1200);
        await shot("give");
      }
      report.push(`${size.name}/${lang}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      if (size.mobile) await page.goBack();
      // The plain view draws no tabs: «Mine» is Pro's.
      if (!size.mobile && (await page.getByRole("tab").nth(1).isVisible().catch(() => false))) {
        await tap(page.getByRole("tab").nth(1));
        await page.waitForTimeout(600);
        await shot("mine");
      }
    } else {
      // The fixture: one trader at work and one pool looked after, for the approved design's comparison.
      await context.addInitScript(walletScript, { owner: OWNER, name: WALLET, demo: true, record: RECORD });
      await open();
      await page.waitForSelector("[data-agent-stop]", { timeout: 30_000 }).catch(() => {});
      await settle();
      await shot("demo");
      if (size.mobile) {
        await tap(page.locator("[data-agent-hire]"));
        await page.waitForTimeout(600);
        await settle();
        await shot("demo-hire");
        await page.goBack();
        await page.waitForTimeout(600);
        report.push(`${size.name}/${lang}: Back closes the hire step — ${await page.evaluate(() => !document.querySelector("[data-agents][data-hiring]"))}`);
      } else {
        await tap(page.locator("[data-agent-role='pilot']"));
        await page.waitForTimeout(900);
        await settle();
        await shot("demo-pilot");
        if (await page.getByRole("tab").nth(2).isVisible().catch(() => false)) {
          await tap(page.getByRole("tab").nth(2));
          await page.waitForTimeout(600);
          await shot("demo-history");
        }
      }
    }

    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, `report-${mode}.txt`), `${report.join("\n")}\n`);
console.log(report.join("\n"));
