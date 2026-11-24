// Every read is answered from a fixture shaped as the
// engine answers (no network): the coin's market, passport and curve, its candles, trades with the wallets' marks and
// holders, and a price made from the swap engine's recorded order (`app/api/solana/swap/golden/transcripts.json`). The
// price comes `QUOTE_MS` after it is asked, so the ticket is seen before and after it. No wallet, nothing signed or sent.
// In a container whose Playwright differs from the project's, PRESS_CHROME names the browser (/opt/pw-browsers/chromium).
//
// Measured on each frame: the page does not scroll sideways; on a phone, every cell of the trades table ends inside its
// column and the screen; the ticket's text lines never overlap; where the buy button stands before and after the price
// came (KIDS=1 — the height of each part of the form at each sample); on the limit by market cap, the field's hint; the
// facts of the coin with no figure («—»); on a desk, the bottom panel's height and the trades it shows whole, and the
// ticket's room between its button and the coin's facts and under them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-358b");
const base = process.argv[3] ?? "http://localhost:3184";
mkdirSync(out, { recursive: true });

const REPO = new URL("../..", import.meta.url).pathname;
const golden = JSON.parse(readFileSync(`${REPO}app/api/solana/swap/golden/transcripts.json`, "utf8"));
const recorded = () => structuredClone(golden["order: SOL to USDT with the verified referral fee is a signable Review"].steps.at(-1).body);
const QUOTE_MS = Number(process.env.QUOTE_MS ?? 2500);

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const now = Date.now();
const DAY = 86_400_000;

/* The three coins: the mints are the stand's own (base58, no real coin's), their figures shaped as the engine's. */
const COINS = {
  sol: { mint: SOL, symbol: "SOL", name: "Solana", price: 72.88, decimals: 9, supply: 560_000_000, category: "crypto", verified: true, feeBps: 10, curve: null, dev: null, launchpad: null, age: 5 * 365 * DAY },
  meme: { mint: "CatmAr1o7k2YbKcQ4p1sVvGWa9xQeWvG816bUx9EPjp", symbol: "CATMARIO", name: "Cat Mario", price: 0.000614, decimals: 6, supply: 998_000_000, category: "meme", verified: true, feeBps: 100, curve: null, dev: null, launchpad: null, age: 41 * DAY },
  curve: { mint: "KiteCurve7k2YbKcQ4p1sVvGWa9xQeWvG816bUx9EPjq", symbol: "KITEFLYER", name: "Kite Flyer", price: 0.0000412, decimals: 6, supply: 1_000_000_000, category: "meme", verified: false, feeBps: 100, curve: { progressPct: 63.2, complete: false }, dev: "Crea7orStand1111111111111111111111111111111", launchpad: "pump.fun", age: 38 * 60_000 },
};
const PRICES = { [SOL]: COINS.sol.price, [USDC]: 1, [USDT]: 1, [COINS.meme.mint]: COINS.meme.price, [COINS.curve.mint]: COINS.curve.price };
const DECIMALS = { [SOL]: 9, [USDC]: 6, [USDT]: 6, [COINS.meme.mint]: 6, [COINS.curve.mint]: 6 };

function quoteFor(input, coin) {
  const body = recorded();
  const inRaw = BigInt(input.amountRaw);
  const inUnits = Number(inRaw) / 10 ** DECIMALS[input.inputMint];
  const outUnits = (inUnits * PRICES[input.inputMint]) / PRICES[input.outputMint];
  const outRaw = BigInt(Math.floor(outUnits * 10 ** DECIMALS[input.outputMint]));
  Object.assign(body.order, {
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inAmountRaw: String(inRaw),
    outAmountRaw: String(outRaw),
    minReceivedRaw: String((outRaw * 992n) / 1000n),
    slippageBps: 80,
    priceImpactPct: "0.0012",
    totalFeeBasisPoints: coin.feeBps,
    platformFee: { ...body.order.platformFee, basisPoints: coin.feeBps, mint: input.outputMint },
  });
  return {
    order: body.order,
    review: body.review,
    verdict: body.assetReview ?? body.verdict,
    decimals: { [input.inputMint]: DECIMALS[input.inputMint], [input.outputMint]: DECIMALS[input.outputMint] },
    outputFee: { basisPoints: 0, feeRaw: "0", capApplied: false },
    passports: {},
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    check: null,
    risk: body.risk,
  };
}

const stats = (pct, traders) => ({ priceChangePct: pct, volumeUsd: 12_500_000, buys: 9000, sells: 8000, traders });
const win = (pct) => ({ priceChangePct: pct, volumeUsd: 100_000, buyVolumeUsd: 60_000, sellVolumeUsd: 40_000, buys: 900, sells: 700, traders: 800, holderChangePct: 0.2, liquidityChangePct: -1.5 });

function marketOf(coin) {
  return {
    mint: coin.mint, symbol: coin.symbol, name: coin.name, icon: null, decimals: coin.decimals, tokenProgram: null, verified: coin.verified, tags: [], category: coin.category, issuer: null,
    price: coin.price, change1hPct: 0.6, change24hPct: 3.4, volume24hUsd: 48_200_000, liquidityUsd: coin.curve ? 38_600 : 12_400_000,
    marketCapUsd: coin.price * coin.supply, fdvUsd: coin.price * coin.supply * 1.05, holders: coin.curve ? 214 : 812_400, organicScore: 80, organicScoreLabel: "high", firstPoolAt: new Date(now - coin.age).toISOString(),
    audit: { devBalancePct: coin.dev ? 4.1 : null, topHoldersPct: 31.2, mintAuthorityDisabled: true, freezeAuthorityDisabled: true, suspicious: false },
    links: { website: null, twitter: null, telegram: null },
    stats: { h1: stats(0.6, 900), h24: stats(3.4, 18_420) },
    updatedAt: new Date().toISOString(),
  };
}

function factsOf(coin) {
  return { mint: coin.mint, circulatingSupply: coin.supply, totalSupply: coin.supply, dev: coin.dev, devMints: coin.dev ? 14 : null, devMigrations: coin.dev ? 1 : null, launchpad: coin.launchpad, graduatedAt: null, createdAt: new Date(now - coin.age).toISOString(), socials: [], windows: { m5: win(0.1), h1: win(0.6), h6: win(-1.1), h24: win(3.4) } };
}

const risk = [
  { code: "MINT_AUTHORITY", tone: "plain", state: "revoked", value: null, source: "jupiter" },
  { code: "FREEZE_AUTHORITY", tone: "plain", state: "revoked", value: null, source: "jupiter" },
  { code: "TOP10", tone: "plain", state: null, value: 31.2, source: "jupiter" },
];

/* Wallets as the chain writes them, the widest letters first: the column must hold the widest short form. */
const WALLETS = ["WMmWq46Es1jh92dQQisAq662SmxELLLsHHe4YWWM", "MfDuWBqLq46Es1jh92dQQisAq662SmxELLLsHHGVWa", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH"];
const LABELS = [["creator"], ["top-holder", "big"], ["fresh"], [], ["ryntra-agent"], []];
const tradesOf = (coin) =>
  Array.from({ length: 30 }, (_, i) => {
    const usd = i % 5 === 0 ? 182_420.5 - i * 311 : 1842.5 - i * 31;
    return {
      signature: `sig${coin.symbol}${i}`,
      at: new Date(now - i * 47_000).toISOString(),
      side: i % 3 === 0 ? "sell" : "buy",
      wallet: WALLETS[i % WALLETS.length],
      tokenAmount: usd / coin.price,
      usd,
      priceUsd: coin.price * (1 + ((i % 7) - 3) / 1000),
      capUsd: coin.price * coin.supply,
      labels: LABELS[i % LABELS.length],
    };
  });
const holdersOf = () => Array.from({ length: 20 }, (_, i) => ({ owner: WALLETS[i % WALLETS.length], amount: 9_000_000 / (i + 1), sharePct: 12 / (i + 1), labels: i === 0 ? ["pool"] : i === 3 ? ["creator"] : [], change: i % 2 ? 1200 : null }));

const STEP = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 };
/* Bars that end at the coin's price: a slow drift with a small swing, so the last price stands among the axis' labels. */
function candlesOf(coin, tf) {
  const step = STEP[tf] ?? 900;
  const last = Math.floor(now / 1000 / step) * step;
  const bars = [];
  let close = coin.price;
  for (let i = 0; i < 160; i++) {
    const time = last - i * step;
    const open = close * (1 + Math.sin(i / 6) * 0.004 + ((i % 5) - 2) * 0.0008);
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    bars.push({ time, open, high, low, close, volume: 1000 + (i % 9) * 340 });
    close = open;
  }
  return { timeframe: tf, candles: bars.reverse(), observedAt: new Date().toISOString(), stale: false, pool: { name: `${coin.symbol} / USDC` }, source: { label: "GeckoTerminal" } };
}

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><circle cx="14" cy="14" r="14" fill="#5B5BD6"/></svg>';

const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "d1366", width: 1366, height: 768, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => (process.env.SIZES ? process.env.SIZES.split(",").includes(size.name) : size.name !== "d1366"));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const KEYS = (process.env.COINS ?? "sol,meme,curve").split(",");
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const report = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME, args: ["--no-sandbox"] } : {});
for (const key of KEYS) {
  const coin = COINS[key];
  for (const size of SIZES) {
    for (const lang of LANGS) {
      const tag = `${key}-${size.name}-${lang}`;
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
      await context.addInitScript((lang) => {
        try {
          localStorage.setItem("ryntra.lang", lang);
          localStorage.setItem("city.lang", lang);
        } catch {}
      }, lang);
      // Nothing leaves the stand: any other host is refused, any other read of the engine is «unavailable».
      await context.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({ status: 503, body: "" }));
      await context.route("**/api/**", (route) => json(route, 503, {}));
      await context.route("**/api/spot/icon?*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: ICON }));
      await context.route("**/api/icon/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: ICON }));
      await context.route("**/api/spot/market?*", (route) => json(route, 200, { market: marketOf(coin) }));
      await context.route("**/api/spot/candles?*", (route) => json(route, 200, candlesOf(coin, new URL(route.request().url()).searchParams.get("tf"))));
      await context.route("**/api/spot/pulse?*", (route) => json(route, 200, { rows: coin.curve ? [{ mint: coin.mint, curve: coin.curve }] : [] }));
      await context.route("**/api/spot/token?*", (route) => {
        const part = new URL(route.request().url()).searchParams.get("part");
        if (part === "overview") return json(route, 200, { facts: factsOf(coin) });
        if (part === "risk") return json(route, 200, { facts: risk });
        if (part === "trades") return json(route, 200, { trades: tradesOf(coin), marks: { creator: Boolean(coin.dev), topHolders: 10, bigTradeUsd: 50_000 } });
        if (part === "holders") return json(route, 200, { holders: holdersOf(), programPct: 12, supply: coin.supply });
        return json(route, 503, {});
      });
      await context.route("**/api/solana/swap/quote", async (route) => {
        const body = quoteFor(route.request().postDataJSON(), coin);
        await new Promise((done) => setTimeout(done, QUOTE_MS));
        return json(route, 200, body).catch(() => {});
      });
      await context.route("**/api/solana/limits/market", (route) => json(route, 200, { price: coin.price / PRICES[SOL], quoteUsd: PRICES[SOL] }));
      await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));

      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(`${base}/coin/${coin.mint}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 120_000 }).catch(() => {});
      const ticketLabel = lang === "uk" ? "Купівля та продаж" : "Buy and sell";
      if (size.mobile) {
        await page.waitForTimeout(2500);
        await page.getByRole("button", { name: lang === "uk" ? /^Купити/ : /^Buy/ }).first().tap().catch(() => {});
      }
      // The buy button, every 250 ms while the price comes and after it: where it stands in the ticket, and how far it moved.
      const tops = [];
      const started = Date.now();
      while (Date.now() - started < QUOTE_MS + 4500) {
        const at = await page.evaluate(({ label, withKids }) => {
          const t = document.querySelector(`section[aria-label="${label}"]`);
          // The ticket's one amber press (the kit's `Action` under the ticket's `go`), not the facts' «i» under it.
          const go = t ? [...t.querySelectorAll("button")].filter((b) => /(^|[_ ])go([_ ]|$)/.test(b.className)).at(-1) : null;
          const r = go?.getBoundingClientRect();
          // From the ticket's own top: the page settling above it is not the button moving in the form.
          if (!r || !r.height) return null;
          // What stands over it, measured: «You get» with its figure, and the terms line.
          const part = (re) => [...t.querySelectorAll("div, span")].find((el) => re.test(el.className))?.getBoundingClientRect().height;
          const kids = [...go.parentElement.children].filter((el) => el.getClientRects().length).map((el) => Math.round(el.getBoundingClientRect().height));
          return `${Math.round(r.top - t.getBoundingClientRect().top)}:${[part(/(^|_)getRow(_|$)/), part(/(^|_)getFigure(_|$)/), part(/(^|_)terms(_|$)/)].map((v) => (v === undefined ? "-" : Math.round(v * 10) / 10)).join("/")}${withKids ? ` [${kids.join(",")}]` : ""}`;
        }, { label: ticketLabel, withKids: Boolean(process.env.KIDS) });
        if (at !== null) tops.push(at);
        await page.waitForTimeout(250);
      }
      const first = Number(tops[0]?.split(":")[0]);
      const lastTop = Number(tops.at(-1)?.split(":")[0]);
      const screen = await page.evaluate((label) => {
        const t = document.querySelector(`section[aria-label="${label}"]`);
        const go = t ? [...t.querySelectorAll("button")].filter((b) => /(^|[_ ])go([_ ]|$)/.test(b.className)).at(-1) : null;
        return go ? Math.round(go.getBoundingClientRect().bottom) : null;
      }, ticketLabel);
      say(`${tag} button: ${first} → ${lastTop} in the ticket (moved ${lastTop - first} px; samples ${[...new Set(tops)].join(",")}); its foot at ${screen} of ${size.height}`);

      const measure = await page.evaluate((label) => {
        const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const t = document.querySelector(`section[aria-label="${label}"]`);
        const overlaps = [];
        if (t) {
          const lines = [...t.querySelectorAll("p, span, b, dd, dt, label")].filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() && el.getClientRects().length);
          const boxes = lines.map((el) => ({ text: el.textContent.trim().slice(0, 24), r: el.getBoundingClientRect() }));
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i].r;
              const b = boxes[j].r;
              if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(`${boxes[i].text} × ${boxes[j].text}`);
            }
        }
        // Every table cell whose content runs past its own box or past the screen.
        const spill = [];
        for (const table of document.querySelectorAll('[role="table"]')) {
          if (!table.getClientRects().length) continue;
          for (const cell of table.querySelectorAll('[role="cell"], [role="columnheader"]')) {
            const box = cell.getBoundingClientRect();
            if (!box.width) continue;
            let right = box.left;
            const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            for (let node = walk.nextNode(); node; node = walk.nextNode()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const r of range.getClientRects()) right = Math.max(right, r.right);
            }
            for (const el of cell.querySelectorAll("svg, img")) right = Math.max(right, el.getBoundingClientRect().right);
            if (right > box.right + 1 || right > window.innerWidth - 4) spill.push(`${(cell.textContent ?? "").trim().slice(0, 14)} +${Math.round(right - Math.min(box.right, window.innerWidth - 4))}`);
          }
        }
        // The bottom panel of the desk: its height and how many trades it shows whole; the ticket's room under its facts.
        let under = null;
        const table = document.querySelector('section[class*="bottom"] [role="table"]');
        if (table) {
          const box = table.parentElement.getBoundingClientRect();
          const rows = [...table.querySelectorAll('[role="row"]')].slice(1).filter((row) => row.getBoundingClientRect().bottom <= box.bottom + 1);
          under = { panel: Math.round(table.closest("section").getBoundingClientRect().height), rows: rows.length };
        }
        let room = null;
        if (t) {
          const kids = [...t.children].filter((el) => el.getClientRects().length);
          const lastBottom = Math.max(...kids.map((el) => el.getBoundingClientRect().bottom));
          const go = [...t.querySelectorAll("button")].filter((b) => /(^|[_ ])go([_ ]|$)/.test(b.className)).at(-1);
          const foot = t.querySelector('section[aria-label]');
          room = { belowContent: Math.round(t.getBoundingClientRect().bottom - lastBottom), buttonToFacts: go && foot ? Math.round(foot.getBoundingClientRect().top - go.getBoundingClientRect().bottom) : null };
        }
        // Facts said with no figure.
        const dashes = [...document.querySelectorAll("dt")].filter((dt) => dt.getClientRects().length && (dt.nextElementSibling?.textContent ?? "").trim() === "—").map((dt) => dt.textContent.trim());
        return { sideways, overlaps: overlaps.slice(0, 6), spill: spill.slice(0, 8), dashes, under, room };
      }, ticketLabel);
      say(`${tag} measure: ${JSON.stringify(measure)}`);
      await page.screenshot({ path: path.join(out, `${tag}.jpg`), type: "jpeg", quality: 84 });

      if (size.mobile) {
        // The sheet closed, the trades tab: the table on the page.
        await page.keyboard.press("Escape").catch(() => {});
        await page.mouse.click(10, 300).catch(() => {});
        await page.waitForTimeout(600);
        const bar = page.locator('div[role="tablist"]').filter({ hasText: lang === "uk" ? "Графік" : "Chart" }).first();
        await bar.locator('[role="tab"]').nth(1).click().catch(() => {});
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(out, `${tag}-trades.jpg`), type: "jpeg", quality: 84 });
        const spill = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('[role="table"] [role="row"]')].filter((row) => row.getClientRects().length);
          const out = [];
          for (const row of rows) {
            const box = row.getBoundingClientRect();
            const cells = [...row.children];
            for (const cell of cells) {
              const c = cell.getBoundingClientRect();
              let right = c.left;
              for (const el of cell.querySelectorAll("*")) right = Math.max(right, el.getBoundingClientRect().right);
              const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
              for (let node = walk.nextNode(); node; node = walk.nextNode()) {
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const r of range.getClientRects()) right = Math.max(right, r.right);
              }
              if (right > c.right + 1 || right > Math.min(box.right, window.innerWidth) - 4) out.push(`${(cell.textContent ?? "").trim().slice(0, 14)} cell ${Math.round(c.right)} text ${Math.round(right)}`);
            }
          }
          return { rows: rows.length, spill: out.slice(0, 10) };
        });
        say(`${tag} trades table: ${JSON.stringify(spill)}`);
        await page.locator('div[role="tablist"]').filter({ hasText: lang === "uk" ? "Графік" : "Chart" }).first().locator('[role="tab"]').nth(0).click().catch(() => {});
        await page.waitForTimeout(800);
      } else {
        // The limit by market cap: the field's hint.
        const t = page.locator(`section[aria-label="${ticketLabel}"]`).first();
        const limit = t.getByRole("tab", { name: lang === "uk" ? "Ліміт" : "Limit" });
        if (await limit.count()) {
          await limit.click();
          await page.waitForTimeout(1500);
          const cap = t.getByRole("button", { name: lang === "uk" ? "Ліміт за капіталізацією" : "Set the limit by market cap" });
          if (await cap.count()) {
            await cap.click();
            await page.waitForTimeout(400);
            const hint = await t.locator("input").nth(1).getAttribute("placeholder").catch(() => null);
            say(`${tag} cap hint: ${hint}`);
            await page.screenshot({ path: path.join(out, `${tag}-cap.jpg`), type: "jpeg", quality: 84 });
          } else say(`${tag} cap: no switch`);
          await t.getByRole("tab", { name: lang === "uk" ? "Ринковий" : "Market" }).click().catch(() => {});
        } else say(`${tag} limit: no tab`);
      }
      // The chart, close: its axes' labels and the last price's tag.
      const chart = page.locator("[data-coin-layer]").first();
      if (await chart.count()) await chart.screenshot({ path: path.join(out, `${tag}-chart.png`) }).catch(() => {});
      say(`${tag} errors: ${errors.join(" | ") || "none"}`);
      await context.close();
    }
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), report.join("\n") + "\n");
