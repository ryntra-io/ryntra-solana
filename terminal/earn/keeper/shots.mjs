// The stock pool's keeper on a position, for the eyes: 1920×1080 and 390×844, English and Ukrainian →
// <out>/<state>-<size>-<lang>.jpg
//   node terminal/earn/keeper/shots.mjs [out] [baseUrl]
// A stand with the terminal's switch on its stand and Earn's Pro pools and stock pools offered
// (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`, `NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO=open`, `NEXT_PUBLIC_RYNTRA_EARN_PRO_STOCKS=open`),
// `next dev` or `next start`. Every read answers from fixtures shaped like the engine's routes — a stock pool of ANT
// against SOL, one position in it, the keeper's answers as mainnet gives them (take out only) and as devnet does (lay it
// back) — for a stand wallet that connects silently and never signs. PRESS_CHROME may point at a system Chrome.
//
// States: `door` — the position's ticket with the keeper's quiet line under it; `bounds` — the bounds in the ticket's
// place on mainnet, the one line before the signature; `info` — its «i» open; `bounds-back` — devnet, «Lay it back»
// chosen: how often and the most a move costs; `working` — a keeper at work, the line under the position.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-364");
const base = process.argv[3] ?? "http://localhost:3364";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const ALL = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [];

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const SOL = "So11111111111111111111111111111111111111112";
const ANT = "ANTq8rKwqVmR2mUtrLzZbmAxMhqb3u1nqDVdV1ZQhY2B";
const POOL = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const NFT = "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss";
const WIRE = Buffer.from(new Uint8Array(1 + 64 + 8).fill(7)).toString("base64");
const PRICE = 1.62;

const PIER = { address: POOL, x: { mint: ANT, symbol: "ANT", decimals: 9 }, y: { mint: SOL, symbol: "SOL", decimals: 9 }, solIsX: false, price: PRICE, feeBps: 80, tickSpacing: 10, tickId: 4824, depthLamports: "412000000000", rewards: [], takesDeposits: true, stock: { issuer: "Backpack Securities" } };
const BOAT = { nftMint: NFT, pool: POOL, inRange: true, ranges: 1, lowerPrice: PRICE / 1.05, upperPrice: PRICE * 1.05, worth: { xRaw: "6000000000", yRaw: "9700000000", lamports: "19420000000" }, fees: { xRaw: "21000000", yRaw: "34000000", lamports: "68000000" }, rewards: [], empty: false, cared: false, care: null };
const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: "142" } },
  { kind: "SPL", mint: ANT, amountRaw: "2000000000", spendableRaw: "2000000000", decimals: 9, symbol: "ANT", catalog: { symbol: "ANT" } },
];
const VIEW = (choice) => ({ key: `k:mainnet:${OWNER}:${NFT}`, nftMint: NFT, pool: POOL, status: "working", stoppedBy: null, mode: choice.putBack ? "shift" : "pull", choice, hours: "open", shape: "narrow", wait: "in-shape", waiting: false, movesToday: 2, lastAt: new Date().toISOString() });
const TERMS = (choice) => {
  const widths = { tight: [50, 300], usual: [100, 500], loose: [200, 1000] }[choice.width];
  const moves = { calm: 4, usual: 8, busy: 16 }[choice.pace];
  return {
    mode: choice.putBack ? "shift" : "pull",
    may: [],
    mayNot: [],
    approval: choice.putBack ? { xRaw: "35200000000", yRaw: "56900000000" } : null,
    approvalOutsideThePool: choice.putBack,
    narrowestBps: widths[0],
    widestBps: widths[1],
    maxShiftsPerDay: moves,
  };
};

async function stage(size, lang, { network = "mainnet", working = false } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript((owner) => {
    // The stand wallet: it connects silently (as a wallet this site was already granted) and never signs.
    localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    window.__asked = [];
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet", "solana:devnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: (...inputs) => {
            window.__asked.push({ transactions: inputs.length });
            return new Promise(() => {});
          },
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, OWNER);

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  // Every route not named below answers at once: nothing is read from outside the stand.
  await page.route("**/api/**", (route) => json(route, 503, { error: { code: "UNAVAILABLE" } }));
  await page.route("**/api/v1/earn/pro/piers", (route) => json(route, 200, { network, piers: [PIER], at: new Date().toISOString(), care: false }));
  await page.route("**/api/v1/earn/pro/positions?*", (route) => json(route, 200, { network, owner: OWNER, positions: [BOAT], care: false }));
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: [], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/city/earn/keeper", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "status") return json(route, 200, { ok: true, network, modes: network === "mainnet" ? ["pull"] : ["pull", "shift"], standPools: [], keepers: working ? [VIEW({ width: "usual", pace: "usual", cost: "usual", plan: "leave", putBack: false })] : [] });
    if (body.action === "review") return json(route, 200, { ok: true, key: `k:${network}:${OWNER}:${NFT}`, network, transactions: [WIRE], mode: body.choice.putBack ? "shift" : "pull", terms: TERMS(body.choice), coins: { x: { symbol: "ANT", decimals: 9 }, y: { symbol: "SOL", decimals: 9 } } });
    return json(route, 409, { error: { code: "UNAVAILABLE" } });
  });
  await page.goto(`${base}/earn?tab=mine&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 120_000 }).catch(() => {});
  return { context, page, errors };
}

const settle = async (page) => {
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(900);
};
const WORDS = {
  en: { give: "Give to agent", bounds: "Bounds", lay: "Lay it back", info: "What the agent may do", working: "At work" },
  uk: { give: "Віддати агентові", bounds: "Межі", lay: "Класти назад", info: "Що може агент", working: "Працює" },
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const w = WORDS[lang];
    const shot = (page, state) => settle(page).then(() => page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" }));
    /** On a phone the position's ticket is a sheet: the position's row opens it. */
    const openTicket = async (page) => {
      const door = page.getByRole("button", { name: new RegExp(`^(${w.give}|${w.bounds})$`) }).first();
      if (await door.isVisible().catch(() => false)) return door;
      const row = page.locator("[data-earn-pick]:visible").first();
      await row.waitFor({ timeout: 120_000 }).catch(() => {});
      if (process.env.KEEPER_SHOTS_DEBUG) console.log(`picks ${await page.locator("[data-earn-pick]").count()} · enabled ${await row.isEnabled().catch(() => "-")}`);
      await (size.mobile ? row.tap() : row.click()).catch((error) => process.env.KEEPER_SHOTS_DEBUG && console.log(String(error).slice(0, 300)));
      await door.waitFor({ timeout: 60_000 });
      return door;
    };

    {
      const { context, page, errors } = await stage(size, lang, { network: "mainnet" });
      const door = await openTicket(page).catch(async (error) => {
        await page.screenshot({ path: path.join(out, `fail-${size.name}-${lang}.jpg`), quality: 80, type: "jpeg" }).catch(() => {});
        report.push(`${size.name}/${lang}: no keeper line — ${String(error).slice(0, 160)}`);
        return null;
      });
      if (door) {
        await shot(page, "door");
        await door.click();
        await page.getByRole("button", { name: w.info }).first().waitFor({ timeout: 30_000 });
        await shot(page, "bounds");
        await page.getByRole("button", { name: w.info }).first().click();
        await shot(page, "info");
        report.push(`${size.name}/${lang} mainnet: asked ${JSON.stringify(await page.evaluate(() => window.__asked))}`);
      }
      if (errors.length) report.push(`${size.name}/${lang} mainnet: page errors — ${errors.join(" | ").slice(0, 400)}`);
      await context.close();
    }
    {
      const { context, page, errors } = await stage(size, lang, { network: "devnet" });
      const door = await openTicket(page).catch(() => null);
      if (door) {
        await door.click();
        await page.getByRole("radio", { name: w.lay }).or(page.getByRole("button", { name: w.lay })).first().click();
        await page.getByRole("button", { name: w.info }).first().waitFor({ timeout: 30_000 });
        await shot(page, "bounds-back");
      }
      if (errors.length) report.push(`${size.name}/${lang} devnet: page errors — ${errors.join(" | ").slice(0, 400)}`);
      await context.close();
    }
    {
      const { context, page, errors } = await stage(size, lang, { network: "mainnet", working: true });
      const door = await openTicket(page).catch(() => null);
      if (door) await shot(page, "working");
      if (errors.length) report.push(`${size.name}/${lang} working: page errors — ${errors.join(" | ").slice(0, 400)}`);
      await context.close();
    }
  }
}

await browser.close();
console.log(report.join("\n"));
