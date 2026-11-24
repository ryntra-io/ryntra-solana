// The agent's drive for the eyes: the «×» card as the server draws it, the card's page, the agent's own page with
// «Stop», the week and the notifications under the bots, and the Telegram messages — a desk at 1440×900 and a phone at
// 390×844, English and Ukrainian → <out>/*.{png,jpg}, with a report of what each screen said and what the wallet was asked.
//
//   1. node terminal/agents/drive/shots.mjs seed <storeDir>      — keeps three closed trades' cards in a file store
//   2. NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_AGENT_DRIVE=open NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet next dev -p 3295,
//      with the engine's store kept in files in <storeDir> (its kind `file` and its folder — lib/guard/runtime-config.ts)
//   3. node terminal/agents/drive/shots.mjs <out> http://localhost:3295 <storeDir>      SIZES=desk,phone  LANGS=en,uk
//
// Every answer of the engine but the cards is a recorded one: the market is the bundled snapshot, the wallet's agents and
// the week the fixtures below. A test wallet of the page's own connects and refuses every signature it is asked for —
// nothing is signed. The Telegram messages are drawn from the very words and buttons the delivery sends.
import { Keypair } from "@solana/web3.js";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createFileGuardStore } from "../../../lib/guard/store.ts";
import { cardOf, keepCard } from "../../../lib/agent-drive/card.ts";
import { driveIdentity } from "../../../lib/agent-drive/events.ts";
import { driveKeyboard, driveNote, weekNote } from "../../../lib/agent-drive/note.ts";
import { weekWords } from "../../../lib/agent-drive/week.ts";

const require = createRequire(import.meta.url);
const SNAPSHOT = JSON.parse(readFileSync(new URL("../../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
const coin = (symbol) => SNAPSHOT.towers.find((tower) => tower.symbol === symbol && tower.verified);
const JUP = coin("JUP");
const MET = coin("MET");

const NOW = Date.now();
const HOUR = 3_600_000;
const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const POLICY = "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3";
const sig = (c) => `5${c.repeat(87)}`;
const closed = (patch) => ({ kind: "sold", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: { mint: JUP.id, symbol: "JUP" }, at: NOW - HOUR, signature: sig("K"), entryRaw: "500000000", exitRaw: "620000000", openedAt: NOW - 4 * HOUR, why: null, ...patch });
const CLOSED = [
  closed({}),
  closed({ coin: { mint: MET.id, symbol: "MET" }, at: NOW - 26 * HOUR, signature: sig("M"), entryRaw: "300000000", exitRaw: "261000000", openedAt: NOW - 27 * HOUR, why: "stop" }),
  closed({ at: NOW - 50 * HOUR, signature: sig("Q"), entryRaw: "250000000", exitRaw: "847500000", openedAt: NOW - 5 * 24 * HOUR, why: "take" }),
];

if (process.argv[2] === "seed") {
  const dir = path.resolve(process.argv[3]);
  mkdirSync(dir, { recursive: true });
  const store = createFileGuardStore({ directory: dir });
  const ids = [];
  for (const event of CLOSED) ids.push((await keepCard(store, cardOf(event, "en", NOW))).id);
  writeFileSync(path.join(dir, "cards.json"), JSON.stringify({ ids, at: NOW }));
  console.log(`kept ${ids.length} cards in ${dir}`);
  process.exit(0);
}

const { chromium } = require("playwright");
const out = path.resolve(process.argv[2] ?? "docs/shots/city-295");
const base = process.argv[3] ?? "http://localhost:3295";
const kept = JSON.parse(readFileSync(path.join(path.resolve(process.argv[4] ?? "."), "cards.json"), "utf8"));
const [UP, DOWN, BIG] = kept.ids;
mkdirSync(out, { recursive: true });

const ALL_SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name, fallback) => (process.env[name] ? process.env[name].split(",").filter(Boolean) : fallback);
const SIZES = ALL_SIZES.filter((size) => list("SIZES", ALL_SIZES.map((s) => s.name)).includes(size.name));
const LANGS = list("LANGS", ["en", "uk"]);
const report = [];
const fresh = () => Keypair.generate().publicKey.toBase58();

/* ---------------------------------------------------------------- the wallet's agent, its book and its week */

const RECORD = { owner: OWNER, settings: fresh(), vault: fresh(), policy: POLICY, budget: fresh(), perTrade: "500000000", perDay: "1000000000", expiresAt: String(Math.floor(NOW / 1000) + 12 * 86_400) };
const VIEW = {
  status: "working",
  strategy: "steady",
  receiveMint: JUP.id,
  symbol: "JUP",
  everyMs: 12 * HOUR,
  result: { trades: 14, spentRaw: "7000000000", boughtRaw: "1", worthRaw: "7310000000", earnedRaw: "310000000", multiple: 1.04 },
  last: [{ at: NOW - 40 * 60_000, ok: true, state: "ok", signature: null, spentRaw: "500000000", receivedRaw: "1" }],
  mission: { state: "waiting", reason: null, nextAt: NOW + HOUR },
  updatedAt: NOW,
  net: { trades: 14, spentRaw: "7000000000", netRaw: "262000000", holdRaw: "90000000", feesRaw: "21000000" },
};
const AGENTS = {
  owner: OWNER,
  networks: {
    mainnet: { read: true, mandates: [{ record: RECORD, status: "working", budgetLamports: "1500000000", live: true, active: true, trades: 14, pilot: false, frozen: false, createdAt: NOW - 6 * 86_400_000 }], pilot: null, cares: [] },
    devnet: { read: true, mandates: [], pilot: null, cares: [] },
  },
};
const card = (id, event) => ({ id, coin: event.coin, entryRaw: event.entryRaw, exitRaw: event.exitRaw, x: Number((BigInt(event.exitRaw) * 1000n) / BigInt(event.entryRaw)) / 1000, openedAt: event.openedAt, closedAt: event.at, page: `https://ryntra.io/x/${id}`, image: `https://ryntra.io/api/v1/agent-drive/card/${id}`, post: "https://x.com/intent/post", up: BigInt(event.exitRaw) > BigInt(event.entryRaw) });
const WEEK = {
  week: { since: NOW - 7 * 86_400_000, until: NOW, trades: 14, spentRaw: "7000000000", resultRaw: "262000000", afterFees: true, closed: 3, best: { x: 3.39, coin: { mint: JUP.id, symbol: "JUP" }, card: BIG } },
  cards: [card(UP, CLOSED[0]), card(DOWN, CLOSED[1]), card(BIG, CLOSED[2])],
};
const SETTINGS = { topics: { bought: true, sold: true, paused: true, stopped: true, week: true }, telegram: true, push: true, locale: "en", timezone: "Europe/Kyiv", kept: true };

/* ---------------------------------------------------------------- the test wallet */

function walletScript({ owner, name }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    if (name) localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
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
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)[^/]+\/.*\.(png|svg|jpe?g|webp|gif)(\?.*)?$/i, (route) => route.abort());
  await context.route("**/api/**", (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    // The cards are the server's own: drawn from the kept trades.
    if (pathname.startsWith("/api/v1/agent-drive/card/")) return route.continue();
    if (pathname === "/api/city") return json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date(NOW).toISOString(), source: "live" });
    if (pathname.startsWith("/api/icon/")) return route.fulfill({ status: 204, body: "" });
    if (pathname === "/api/spot/candles") return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
    if (pathname === "/api/bots/agents") return json(route, AGENTS);
    if (pathname === "/api/bots/mandate/agent") return url.searchParams.get("policy") === POLICY ? json(route, VIEW) : json(route, {}, 404);
    if (pathname === "/api/bots/mandate/status") return json(route, { active: true, budgetLamports: "1500000000" });
    if (pathname === "/api/bots/pilot") return json(route, { error: { code: "NO_PILOT" } }, 404);
    if (pathname === "/api/v1/agent-drive/week") return json(route, WEEK);
    if (pathname === "/api/v1/agent-drive/settings") return json(route, SETTINGS);
    if (pathname === "/api/v1/assistant/push") return json(route, { configured: true, publicKey: null, browsers: 0, thisBrowser: false });
    if (pathname === "/api/v1/notifications/telegram") return json(route, { telegram: { connected: true, username: "owner" } });
    if (pathname === "/api/v1/notifications/devices") return json(route, { devices: [] });
    return json(route, {}, 503);
  });
}

/* ---------------------------------------------------------------- Telegram, as the delivery sends it */

function telegramPage(lang) {
  const say = (note) => {
    const words = note.text[lang];
    const keyboard = driveKeyboard({ ...note, locale: lang }, { text: lang === "uk" ? "Відкрити агента" : "Open my agent", url: `https://ryntra.io${note.href}` }, "https://ryntra.io");
    return { text: `Ryntra\n${words.title}\n${words.reason}`, keyboard };
  };
  const coinOf = { mint: JUP.id, symbol: "JUP" };
  const bought = { kind: "bought", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: coinOf, at: NOW, signature: sig("B"), spentRaw: "500000000", receivedRaw: "1" };
  const paused = { kind: "paused", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: coinOf, at: NOW, why: "losses" };
  const stopped = { kind: "stopped", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: coinOf, at: NOW, why: "you" };
  const notes = [
    say(driveNote(bought, driveIdentity(bought), lang, NOW)),
    say(driveNote(CLOSED[0], driveIdentity(CLOSED[0]), lang, NOW, UP)),
    say(driveNote(paused, driveIdentity(paused, 2), lang, NOW)),
    say(driveNote(stopped, driveIdentity(stopped, 3), lang, NOW)),
    say(weekNote(OWNER, "agent-drive:week:x", { en: weekWords(WEEK.week, "en"), uk: weekWords(WEEK.week, "uk") }, lang, NOW)),
  ];
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const bubble = (note) => `<div class="msg"><div class="text">${escape(note.text).replace(/\n/g, "<br>")}</div></div><div class="keys">${note.keyboard.map((row) => `<div class="row">${row.map((button) => `<span class="key">${escape(button.text)}${button.url && !button.url.startsWith("https://ryntra.io/agent") ? " ↗" : ""}</span>`).join("")}</div>`).join("")}</div>`;
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0e1621;font:15px/1.4 -apple-system,system-ui,sans-serif;color:#fff;padding:20px}
    .chat{max-width:420px;margin:0 auto}.msg{background:#182533;border-radius:12px 12px 12px 4px;padding:10px 12px;margin-top:14px}
    .text div:first-child{font-weight:600}.keys{margin-top:4px}.row{display:flex;gap:4px;margin-top:4px}
    .key{flex:1;text-align:center;background:rgba(24,37,51,.85);border-radius:8px;padding:9px 6px;font-weight:600;font-size:14px}
  </style><div class="chat">${notes.map(bubble).join("")}</div>`;
}

/* ---------------------------------------------------------------- the shots */

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || "/opt/pw-browsers/chromium" });

// The cards, exactly as the server draws them.
const plain = await browser.newContext();
for (const lang of LANGS) {
  for (const [name, id] of [["card-up", UP], ["card-down", DOWN], ["card-big", BIG]]) {
    const answer = await plain.request.get(`${base}/api/v1/agent-drive/card/${id}?l=${lang}`, { timeout: 300_000 });
    writeFileSync(path.join(out, `${name}-${lang}.png`), await answer.body());
    report.push(`${name} ${lang}: ${answer.status()} ${answer.headers()["content-type"]}`);
  }
  const page = await plain.newPage({ viewport: { width: 460, height: 900 } });
  await page.setContent(telegramPage(lang));
  await page.screenshot({ path: path.join(out, `telegram-${lang}.png`), fullPage: true });
  await page.close();
}
await plain.close();

for (const size of SIZES) {
  for (const lang of LANGS) {
    const run = async (withWallet, steps) => {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
      await engine(context);
      await context.addInitScript(walletScript, { owner: OWNER, name: withWallet ? "Stand Wallet" : null });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => message.type() === "error" && errors.push(`console: ${message.text()}`));
      const open = async (address, mark) => {
        await page.goto(`${base}${address}${address.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
        await page.waitForSelector(mark, { timeout: 300_000 });
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
        await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(1500);
      };
      const shot = async (state, full = true) => {
        await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg", fullPage: full && !size.mobile });
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) report.push(`${size.name}/${lang} ${state}: the page scrolls sideways`);
      };
      const said = async (selector) => (await page.locator(selector).first().textContent().catch(() => null))?.trim() ?? "—";
      await steps({ page, open, shot, said });
      report.push(`${size.name}/${lang}${withWallet ? " +wallet" : ""}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
      await context.close();
    };

    await run(false, async ({ open, shot, said }) => {
      await open(`/x/${UP}`, "[data-drive-card] [data-drive-try]");
      report.push(`${size.name}/${lang} card page: «${await said("[data-drive-try]")}»`);
      await shot("x");
      await open(`/agent/pulse?p=${POLICY}&x=${UP}`, "[data-agent-pulse] [data-drive-connect]");
      report.push(`${size.name}/${lang} agent, no wallet: «${await said("[data-drive-connect]")}»`);
      await shot("pulse-connect");
    });

    await run(true, async ({ page, open, shot, said }) => {
      await open(`/agent/pulse?p=${POLICY}&x=${UP}&do=stop`, "[data-agent-pulse]");
      await page.waitForSelector("[data-drive-stop]", { timeout: 60_000 }).catch(() => {});
      report.push(`${size.name}/${lang} agent: the action «${await said("[data-drive-stop]")}»`);
      await shot("pulse");
      await open("/bots/recurring", "[data-bot='recurring']");
      const week = page.locator("[data-drive-week]");
      await week.waitFor({ timeout: 60_000 }).catch(() => {});
      await page.locator("[data-drive-notify]").click().catch(() => {});
      await page.waitForSelector("[data-drive-settings]", { timeout: 30_000 }).catch(() => {});
      await week.evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => {});
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `week-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg" });
      report.push(`${size.name}/${lang} week: «${(await said("[data-drive-week]")).slice(0, 160)}»`);
    });
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
