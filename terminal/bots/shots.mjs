// «Bots» and «Agents» for the eyes: a desk at 1920×1080 and 1440×900, a phone at 390×844, English
// and Ukrainian → <bots>/*.jpg and <agents>/*.jpg, with a report of what each screen said.
//   node terminal/bots/shots.mjs <botsOut> <agentsOut> [baseUrl]          SIZES=wide,desk,phone  LANGS=en,uk
// The stand runs with the terminal's switch and the bots' switches as production has them:
//   NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet
//   NEXT_PUBLIC_RYNTRA_CITY_LADDER=mainnet NEXT_PUBLIC_RYNTRA_CITY_MONEY=open NEXT_PUBLIC_RYNTRA_CITY_SPOT=open next dev
// Every answer of the engine is a recorded one — the cloud holds no key: the market is the bundled snapshot
// (city/lib/market/snapshot.json), a coin's week the review's sample hours (city/lib/bots/demo.ts), the ladder's pool and
// three placed ladders the review stand's (city/lib/bots/ladder-demo.ts), two recurring buys at work and their books the
// fixtures below, the analyst's answer a recorded turn over the snapshot's own figures. A test wallet of the page's own
// answers the browser's wallet standard: it connects and refuses every signature it is asked for — nothing is signed.
// The paper bots are kept in the browser, as a person's are. Logos: SOL's from the token list, JUP's from the repo's own
// file; a coin without one shows the kit's disc.
import { Keypair } from "@solana/web3.js";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { defaultDraft } from "../../city/lib/bots/draft.ts";
import { sampleBars } from "../../city/lib/bots/demo.ts";
import { laddersDemo, statusAt } from "../../city/lib/bots/ladder-demo.ts";
import { weatherOf } from "../../city/lib/bots/weather.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const botsOut = path.resolve(process.argv[2] ?? "docs/shots/city-303");
const agentsOut = path.resolve(process.argv[3] ?? "docs/shots/city-305");
const base = process.argv[4] ?? "http://localhost:3303";
for (const dir of [botsOut, agentsOut]) mkdirSync(dir, { recursive: true });

const ALL_SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name, fallback) => (process.env[name] ? process.env[name].split(",").filter(Boolean) : fallback);
const SIZES = ALL_SIZES.filter((size) => list("SIZES", ALL_SIZES.map((s) => s.name)).includes(size.name));
const LANGS = list("LANGS", ["en", "uk"]);

const SNAPSHOT = JSON.parse(readFileSync(new URL("../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
const byId = new Map(SNAPSHOT.towers.map((tower) => [tower.id, tower]));
const coin = (symbol) => SNAPSHOT.towers.find((tower) => tower.symbol === symbol && tower.verified);
const SOL = coin("SOL");
const JUP = coin("JUP");
const MET = coin("MET");

const SCRATCH = process.env.ICONS ?? "";
const ICONS = new Map(
  [
    [SOL.id, SCRATCH ? path.join(SCRATCH, SOL.id) : ""],
    [JUP.id, path.resolve("public/site/universe/JUP.png")],
  ].filter(([, file]) => file && existsSync(file)),
);

const NOW = Date.now();
const HOUR = 3_600_000;
const END = Math.floor(NOW / HOUR) * HOUR;
/** Public addresses of fresh keys thrown away at once: no wallet holds them; nothing signs with them. */
const fresh = () => Keypair.generate().publicKey.toBase58();
const OWNER = fresh();
const WALLET = "Stand Wallet";
const KEYS = new Map();
const key = (n) => (KEYS.has(n) ? KEYS.get(n) : (KEYS.set(n, fresh()), KEYS.get(n)));
const report = [];

/* ---------------------------------------------------------------- recurring buys: two at work */

const record = (n, perDay, perTrade) => ({ owner: OWNER, settings: key(1), vault: key(2), policy: key(10 + n), budget: key(20 + n), perTrade, perDay, expiresAt: String(Math.floor(NOW / 1000) + (12 + n * 9) * 86_400 + 60) });
const RECORDS = [record(1, "2000000000", "250000000"), record(2, "500000000", "100000000")];
/** One trader's book: its whole result after fees, its last day inside its own day's budget, its last three trades. */
const view = (coinTower, { spent, earned, net, trades, day, perTrade, offset }) => ({
  status: "working",
  strategy: "steady",
  receiveMint: coinTower.id,
  symbol: coinTower.symbol,
  everyMs: 4 * HOUR,
  result: { trades, spentRaw: spent, boughtRaw: "1", worthRaw: String(BigInt(spent) + BigInt(earned)), earnedRaw: earned, multiple: 1.04 },
  last: [
    { at: NOW - offset * HOUR, ok: true, state: "ok", signature: null, spentRaw: perTrade, receivedRaw: "1" },
    { at: NOW - (offset + 4) * HOUR, ok: true, state: "ok", signature: null, spentRaw: perTrade, receivedRaw: "1" },
    { at: NOW - (offset + 8) * HOUR, ok: false, state: "refused", signature: null, spentRaw: "0", receivedRaw: null },
  ],
  mission: { state: "waiting", reason: null, nextAt: NOW + HOUR },
  updatedAt: NOW,
  day: { since: NOW - 86_400_000, until: NOW, trades: day.trades, spentRaw: day.spent, boughtRaw: "1", worthRaw: day.spent, earnedRaw: "0", netRaw: day.net, holdRaw: "0" },
  net: { trades, spentRaw: spent, netRaw: net, holdRaw: "9000000", feesRaw: "2000000" },
});
const VIEWS = {
  [RECORDS[0].policy]: view(JUP, { spent: "6000000000", earned: "51000000", net: "47000000", trades: 22, day: { trades: 4, spent: "1000000000", net: "12000000" }, perTrade: "250000000", offset: 1 }),
  [RECORDS[1].policy]: view(MET, { spent: "1500000000", earned: "-9000000", net: "-11000000", trades: 9, day: { trades: 3, spent: "300000000", net: "-2000000" }, perTrade: "100000000", offset: 3 }),
};
const AGENTS = {
  owner: OWNER,
  networks: {
    mainnet: {
      read: true,
      mandates: RECORDS.map((one, at) => ({ record: one, status: "working", budgetLamports: at ? "300000000" : "1100000000", live: true, active: true, trades: at ? 9 : 22, pilot: false, frozen: false, createdAt: NOW - (at + 3) * 86_400_000 })),
      pilot: null,
      cares: [],
    },
    devnet: { read: true, mandates: [], pilot: null, cares: [] },
  },
};
const HOLDINGS = { data: { holdings: [{ kind: "NATIVE_SOL", mint: null, spendableRaw: "48250000000", decimals: 9 }], tokenRead: "COMPLETE" } };

/* ---------------------------------------------------------------- the ladder and the paper bots */

const LADDERS = laddersDemo(SOL.price, NOW, "mainnet");
const KEPT_LADDERS = LADDERS.ladders.map((ladder) => ({ ...ladder, owner: OWNER }));
const barsOf = (tower) => sampleBars(tower.id, tower.price, tower.change24h, END);
const paper = (id, kind, tower, spans, stoppedAt = null, change = {}) => {
  const draft = { ...defaultDraft(kind, { mint: tower.id, symbol: tower.symbol }, tower.price, weatherOf(barsOf(tower)), change.amountUsd ?? 250), ...change };
  return { id, draft, createdAt: spans[0]?.[0] ?? NOW, spans, stoppedAt, strategyId: null, mode: "paper" };
};
const PAPER = [
  paper("grid-sol", "grid", SOL, [[END - 70 * HOUR, null]]),
  paper("grid-jup", "grid", JUP, [[END - 120 * HOUR, END - 30 * HOUR]], null, { amountUsd: 500, levels: 16 }),
  paper("signal-sol", "signal", SOL, [[END - 96 * HOUR, null]], null, { fast: 6, slow: 13 }),
  paper("signal-met", "signal", MET, [[END - 140 * HOUR, END - 40 * HOUR]], END - 40 * HOUR),
];

/* ---------------------------------------------------------------- the analyst's recorded answer */

const pct = (value, lang) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`.replace(".", lang === "uk" ? "," : ".");
const usd = (value, lang) => `$${value.toFixed(2)}`.replace(".", lang === "uk" ? "," : ".");
function answerOf(lang) {
  const en = lang === "en";
  return {
    ryn: {
      text: en ? "SOL is steady today." : "SOL сьогодні стабільний.",
      cards: [],
      citations: [{ source: "Jupiter", observedAt: new Date(NOW).toISOString() }],
      answer: {
        observation: [{ text: en ? `SOL trades at ${usd(SOL.price, lang)}, ${pct(SOL.change24h, lang)} over the day, on deep liquidity across its pools.` : `SOL коштує ${usd(SOL.price, lang)}, ${pct(SOL.change24h, lang)} за добу, ліквідність глибока в усіх пулах.` }],
        meaning: [{ text: en ? "The move is small and broad — nothing in the read points to one large buyer." : "Рух малий і широкий — у читанні немає ознак одного великого покупця." }],
        counter: [{ text: en ? "A day says little about the week." : "Одна доба мало каже про тиждень." }],
        risks: [],
        checks: [],
      },
    },
    guest: { day: { used: 1, allowance: 5 } },
  };
}

/* ---------------------------------------------------------------- the test wallet */

function walletScript({ owner, name, ladders, paper }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    if (name) localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
    localStorage.setItem("ryntra.city.bots.ladders.mainnet.v1", JSON.stringify(ladders));
    localStorage.setItem("ryntra.city.bots.paper.v1", JSON.stringify(paper));
  } catch {}
  if (!name) return;
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

const json = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

async function engine(context) {
  // A logo the browser would fetch from another host: refused at once, as a person's browser offline would — the kit's disc stands in.
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)[^/]+\/.*\.(png|svg|jpe?g|webp|gif)(\?.*)?$/i, (route) => route.abort());
  await context.route("**/api/**", (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/city") return json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date(NOW).toISOString(), source: "live" });
    if (pathname.startsWith("/api/icon/")) {
      const file = ICONS.get(pathname.slice("/api/icon/".length));
      return file ? route.fulfill({ status: 200, contentType: file.endsWith(".svg") ? "image/svg+xml" : "image/png", body: readFileSync(file) }) : route.fulfill({ status: 204, body: "" });
    }
    if (pathname === "/api/spot/candles") {
      const tower = byId.get(url.searchParams.get("mint"));
      if (!tower) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      return json(route, { timeframe: url.searchParams.get("tf"), candles: barsOf(tower).map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })), observedAt: new Date(NOW).toISOString(), source: { label: "GeckoTerminal" } });
    }
    if (pathname === "/api/bots/ladder") {
      const mint = url.searchParams.get("mint");
      return mint === SOL.id ? json(route, statusAt(SOL.price, NOW, "mainnet")) : json(route, { open: true, network: "mainnet", venue: { venue: null, available: false, reason: "NO_POOL" }, pool: null, at: NOW });
    }
    if (pathname === "/api/bots/ladder/orders") return json(route, { network: "mainnet", orders: LADDERS.reads, prices: { [LADDERS.ladders[0].pool]: LADDERS.poolPrice }, at: NOW });
    if (pathname === "/api/bots/agents") return json(route, AGENTS);
    if (pathname === "/api/bots/mandate/agent") {
      const found = VIEWS[url.searchParams.get("policy")];
      return found ? json(route, found) : json(route, {}, 404);
    }
    if (pathname === "/api/bots/mandate/status") return json(route, { active: true, budgetLamports: "1100000000" });
    if (pathname === "/api/solana/holdings") return json(route, HOLDINGS);
    if (pathname === "/api/bots/pilot") return json(route, { error: { code: "NO_PILOT" } }, 404);
    if (pathname === "/api/v1/assistant/guest") {
      const body = JSON.parse(request.postData() ?? "{}");
      return json(route, answerOf(body.locale === "uk" ? "uk" : "en"));
    }
    return json(route, {}, 503);
  });
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || "/opt/pw-browsers/chromium" });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const run = async (withWallet, steps) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.mobile ? 2 : 1,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
        reducedMotion: "reduce",
      });
      await engine(context);
      await context.addInitScript(walletScript, { owner: OWNER, name: withWallet ? WALLET : null, ladders: KEPT_LADDERS, paper: PAPER });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const settle = async () => {
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
        await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1400);
      };
      const open = async (address, mark) => {
        await page.goto(`${base}${address}${address.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
        await page.waitForSelector(mark, { timeout: 300_000 });
        await settle();
      };
      const shot = async (dir, state, full = true) => {
        await page.waitForTimeout(500);
        if (size.mobile && full) {
          // A phone, as a person sees it: the screen from its top, then scrolled to the bots under the form — the frame's
          // header and tab bar stay where they stand, never in the middle of a page drawn whole.
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(dir, `${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg" });
          const bodies = page.locator("[data-page-body]");
          if ((await bodies.count()) > 1) {
            await bodies.last().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 140));
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(dir, `${state}-mine-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg" });
          }
        } else await page.screenshot({ path: path.join(dir, `${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg", fullPage: full });
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (wide) report.push(`${size.name}/${lang} ${state}: the page scrolls sideways`);
      };
      const said = async (selector) => (await page.locator(selector).first().textContent().catch(() => null))?.trim() ?? "—";
      await steps({ page, open, shot, settle, said });
      report.push(`${size.name}/${lang}${withWallet ? " +wallet" : ""}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
      await context.close();
    };

    // With the test wallet: every bot's page, the person's bots of each kind under its form.
    await run(true, async ({ page, open, shot, said }) => {
      await open("/bots/recurring", "[data-bot='recurring'] [data-agent-terms], [data-bot='recurring'] [data-agent-give]");
      await page.waitForSelector("[data-agent-stop]", { timeout: 30_000 }).catch(() => {});
      report.push(`${size.name}/${lang} recurring: the action «${await said("[data-agent-give]")}», stops ${await page.locator("[data-agent-stop]:visible").count()}`);
      await shot(botsOut, "recurring");

      await open("/bots/ladder", "[data-bot='ladder'] [data-bot-place]");
      await page.waitForSelector("[data-bot-rungs]", { timeout: 30_000 }).catch(() => {});
      report.push(`${size.name}/${lang} ladder: «${await said("[data-bot-cost]")}» · the action «${await said("[data-bot-place]")}»`);
      await shot(botsOut, "ladder");
      if (!size.mobile) {
        await page.getByRole("button", { name: lang === "uk" ? "Обери монету" : "Choose the coin" }).first().click().catch(() => {});
        if (await page.locator("[data-bot-coin]").first().isVisible().catch(() => false)) {
          await shot(botsOut, "ladder-coins", false);
          await page.keyboard.press("Escape");
        }
      }

      await open("/bots/grid", "[data-bot='grid'] [data-bot-start]");
      await page.waitForSelector("[data-bot-week]", { timeout: 30_000 }).catch(() => {});
      report.push(`${size.name}/${lang} grid: the week «${await said("[data-bot-week]")}»`);
      await shot(botsOut, "grid");

      await open("/bots/signals", "[data-bot='signals'] [data-bot-start]");
      await page.waitForSelector("[data-bot-week]", { timeout: 30_000 }).catch(() => {});
      report.push(`${size.name}/${lang} signals: the week «${await said("[data-bot-week]")}»`);
      await shot(botsOut, "signals");
      if (!size.mobile) {
        await page.locator("[data-bot-start]").first().click();
        await page.waitForTimeout(700);
        report.push(`${size.name}/${lang} signals: started on paper — ${await page.locator("[data-bot-stop]:visible").count()} with «Stop»`);
        await shot(botsOut, "signals-started");
      }
    });

    // Without a wallet: a bot that needs one says so in one line and one action; the analyst needs none.
    await run(false, async ({ page, open, shot, said }) => {
      await open("/bots/ladder", "[data-bot='ladder'] [data-bot-connect]");
      report.push(`${size.name}/${lang} ladder without a wallet: «${await said("[data-bot-connect]")}»`);
      await shot(botsOut, "ladder-nowallet");

      await open("/agent", "[data-agents] [data-agent-ask-field]");
      report.push(`${size.name}/${lang} agents: questions — ${(await page.locator("[data-agent-questions] button").allTextContents()).join(" | ")}`);
      await shot(agentsOut, "agents");
      await page.locator("[data-agent-questions] button").first().click();
      await page.waitForSelector("[data-agents] [role='status']:not([aria-busy])", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(900);
      report.push(`${size.name}/${lang} agents: the answer — «${await said("[data-agents] [role='status'] p")}»`);
      await shot(agentsOut, "agents-answer");
    });
  }
}

await browser.close();
writeFileSync(path.join(botsOut, "report.txt"), `${report.join("\n")}\n`);
writeFileSync(path.join(agentsOut, "report.txt"), `${report.filter((line) => / agents/.test(line) || /page errors|sideways/.test(line)).join("\n")}\n`);
console.log(report.join("\n"));
