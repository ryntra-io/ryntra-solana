// «Grid» for the eyes: 2560×1440, 1920×1080 and 1440×900 on a desk, 390×844 on a phone, English
// and Ukrainian → <out>/*.jpg, with a report of what each screen said, its corners, any page that scrolls sideways and
// the desk's measures (the chart's share of the window, the form's width). Then the bots' catalogue (`/bots`) and the
// form bots' pages, to see that a form stays a form.
//   node terminal/bots/grid-shots.mjs <out> [baseUrl] [source]          SIZES=w2560,w1920,w1440,phone  LANGS=en,uk
// The stand runs with production's switches (a local file of production's switches) and the grid's window on mainnet
// (NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS=mainnet — the window only: the server's gate stays closed).
// Every answer is the engine's: the market, the candles, the logos from `source` (ryntra.io); the coin's DLMM Pro
// market — the lane's own answer read from mainnet's pools (docs/shots/grid-dlmm-pro/market-met-mainnet.json); «My
// grids» — the rehearsal's grid on the program's own binary after a whole cycle, its record and the wallet's orders
// as the lane answered (docs/research/meteora-dlmm-pro-2026-11-14/results/grid-rehearsal-mainnet.json). A stub wallet
// of the Wallet Standard connects and never signs; a Review answers 503 — nothing is built, signed or sent.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/grid-dlmm-pro");
const base = process.argv[3] ?? "http://localhost:3134";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const MARKET = JSON.parse(readFileSync("docs/shots/grid-dlmm-pro/market-met-mainnet.json", "utf8")).answer.value;
const SCREEN = JSON.parse(readFileSync("docs/research/meteora-dlmm-pro-2026-11-14/results/grid-rehearsal-mainnet.json", "utf8")).facts.screen;
/* The rehearsal's grid, kept as the person's browser keeps it — for the stub wallet on the window's network. */
const RECORD = { ...SCREEN.record, owner: TAKER, network: "mainnet", createdAt: Date.now() - 26 * 3_600_000 };

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "w2560", width: 2560, height: 1440, mobile: false },
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "w1440", width: 1440, height: 900, mobile: false },
  { name: "w1024", width: 1024, height: 768, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const report = [];

async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() !== "GET") return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: request.headers().accept ?? "*/*", origin: source, referer: `${source}/bots/grid` } });
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Every box on screen whose corner is not 0, 4 px or a circle: the form allows nothing else. */
const CORNERS = () => {
  const odd = new Map();
  for (const el of document.querySelectorAll("main *")) {
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2 || box.bottom < 0 || box.top > innerHeight) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const r = parseFloat(style.borderTopLeftRadius) || 0;
    if (r === 0 || r === 4 || r >= Math.min(box.width, box.height) / 2 - 0.5) continue;
    const key = `${r}px ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]?.slice(0, 40)}`;
    odd.set(key, (odd.get(key) ?? 0) + 1);
  }
  return [...odd.entries()].map(([key, n]) => `${key} ×${n}`);
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.route("**/api/**", fromSource);
    /* DLMM Pro's markets live from the source (its lane is open on mainnet since 18.11), the recorded MET market where
       the source does not answer; the rehearsal grid's coin keeps its rehearsal market. */
    await context.route("**/api/v1/ladders/market*", async (route) => {
      const mint = new URL(route.request().url()).searchParams.get("mint");
      if (mint === SCREEN.record.coin.mint) return json(route, { market: { ...SCREEN.market, network: "mainnet" } });
      try {
        const url = new URL(route.request().url());
        const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: "application/json", origin: source, referer: `${source}/bots/grid` } });
        if (answer.ok) return route.fulfill({ status: 200, contentType: "application/json", body: Buffer.from(await answer.arrayBuffer()) });
      } catch {
        // The recorded answer below.
      }
      return json(route, { market: mint === MET ? MARKET : null });
    });
    await context.route("**/api/v1/ladders/orders*", (route) => json(route, { orders: SCREEN.orders }));
    await context.route("**/api/v1/ladders/review", (route) => json(route, { error: { code: "UNAVAILABLE", message: "" } }, 503));
    await context.route("**/api/v1/ladders/submit", (route) => json(route, { error: { code: "UNAVAILABLE", message: "" } }, 503));
    await context.route("**/api/solana/holdings*", (route) => json(route, {}, 503));
    await context.route("**/api/auth/solana/session*", (route) => json(route, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await context.route("**/api/growth/cards?*", (route) => json(route, { error: "proof required", proof: false }, 401));

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript(({ taker, grids }) => {
      try {
        window.localStorage.setItem("ryntra.grids.v1", JSON.stringify(grids));
      } catch {
        // A browser that keeps nothing: the page shows no grid of its own.
      }
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
      const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async (input) => (input?.silent ? { accounts: [] } : ((wallet.accounts = [account]), { accounts: [account] })) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { taker: TAKER, grids: [RECORD] });

    const name = (state) => path.join(out, `${state}-${size.name}-${lang}.jpg`);
    /** The desk's measures: the chart's box and its share of the window, the form's width and height. */
    const MEASURES = () => {
      const box = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const chart = box("[data-grid-desk-chart]");
      const form = box("[data-grid-desk-form]");
      const main = box("main") ?? { width: innerWidth };
      if (!chart || !form) return "";
      const pct = (a, b) => `${Math.round((a / b) * 100)}%`;
      return ` · chart ${Math.round(chart.width)}×${Math.round(chart.height)} (${pct(chart.width, main.width)} of the working width, ${pct(chart.height, innerHeight)} of the window) · form ${Math.round(form.width)}×${Math.round(form.height)}`;
    };
    const shot = async (state, full = false) => {
      await page.waitForTimeout(900);
      await page.screenshot({ path: name(state), quality: 86, type: "jpeg", fullPage: full });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const odd = await page.evaluate(CORNERS);
      const said = await page.locator("[data-grid-place], [data-grid-connect], [data-bot-start]").first().textContent({ timeout: 2_000 }).catch(() => "—");
      const note = await page.locator("[data-bots] [role=status]").first().textContent({ timeout: 2_000 }).catch(() => "");
      const lines = await page.locator("[data-grid-chart] .ryntra-trade__row--level").count();
      const measures = await page.evaluate(MEASURES);
      report.push(`${state}-${size.name}-${lang}: action «${said?.trim()}» · note «${note?.trim()}» · ${lines} lines on the chart${measures} · sideways ${overflow} px${odd.length ? ` · corners off the form: ${odd.join(", ")}` : ""}`);
    };
    const tap = async (locator) => (size.mobile ? locator.tap() : locator.click());

    await page.goto(`${base}/bots/grid?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForSelector("[data-bot='grid']", { timeout: 300_000 });
    await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
    await page.waitForSelector("[data-grid-chart] .ryntra-chart canvas", { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
    await shot("start");
    const connect = page.locator("[data-grid-connect]");
    if (await connect.count()) {
      await tap(connect.first());
      await page.waitForTimeout(900);
      /* On a phone the wallet's door is in the sections' sheet: the wallet is picked there and the sheet closed. */
      const scope = size.mobile ? page.getByRole("dialog").last() : page;
      const pick = scope.getByRole("button", { name: "Phantom" });
      if (await pick.count()) await tap(pick.first()).catch(() => pick.first().click({ force: true }));
      await page.waitForTimeout(3_000);
      if (size.mobile) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(800);
      }
      await page.waitForTimeout(2_000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot("grid");
    if (size.mobile) {
      await page.locator("[data-grid-place]").first().evaluate((el) => el.scrollIntoView({ block: "end" })).catch(() => {});
      await shot("grid-form");
    }
    /* The coin's list: the whole market, each coin with where its grid would rest. */
    const pick = page.getByRole("button", { name: lang === "uk" ? "Обери монету" : "Choose the coin" }).first();
    if (await pick.count()) {
      await pick.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
      await tap(pick);
      await page.waitForTimeout(4_000);
      await shot("list");
      /* A coin with no pool that takes orders: one line, and why behind its «i». */
      const search = page.locator("[role=dialog] input").first();
      if (await search.count()) {
        await search.fill("RAY");
        await page.waitForTimeout(2_500);
        const ray = page.locator("[data-bot-coin='RAY']").first();
        if (await ray.count()) {
          await tap(ray);
          await page.waitForTimeout(6_000);
          await page.evaluate(() => window.scrollTo(0, 0));
          await shot("nopool");
          const why = page.locator("[data-grid-no-pool] button").first();
          if (await why.count()) {
            await tap(why);
            await page.waitForTimeout(500);
            await why.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
            await shot("nopool-why");
            await page.keyboard.press("Escape").catch(() => {});
          }
        }
      }
    }
    await page.locator("[data-grid-card]").first().evaluate((el, phone) => el.scrollIntoView({ block: phone ? "start" : "center" }), size.mobile).catch(() => {});
    await shot("mine");
    if (!size.mobile) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot("page", true);
    }

    /* The bots' catalogue, and the form bots — each a form in its container, never stretched to the desk. */
    await page.goto(`${base}/bots?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForSelector("[data-bots-catalog]", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
    await shot("catalog", size.mobile);
    if (!size.mobile) {
      for (const bot of ["recurring", "ladder", "signals", "autopilot"]) {
        const answer = await page.goto(`${base}/bots/${bot}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
        if (!answer || answer.status() >= 400) continue;
        await page.waitForSelector(`[data-bot='${bot}']`, { timeout: 120_000 }).catch(() => {});
        await page.waitForTimeout(3_000);
        await shot(`form-${bot}`);
      }
    }
    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
