// The Stock Pier's screens for review (CITY-98), at 1440×900 and 375×812 → <out>/<state>-<size>-<lang>.png
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER=open npm run dev, then:
//   node city/lib/earn/stock-pier-shots.mjs [out] [baseUrl]
// LANG_EARN=en for the English words (Ukrainian by default). No wallet and no keys: a stub wallet registers through the
// Wallet Standard events and never signs. The routes answer from fixtures (`stock-pier-fixtures.mjs`) — the city's own
// avenue mints with prices written by hand, a Review shaped like the engine's. The figures on these screens are fixtures.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { addReview, positionView } from "../districts/harbor/test-fixtures.mjs";
import { AAPLX, NVDAX, SPYX, TSLAX, list } from "./stock-pier-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "out/stock-pier-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const LANG = process.env.LANG_EARN ?? "uk";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = Date.now();
const LIST = list(NOW);
// NVDAx's exchange closes in forty minutes on this stand: the plan for the close is due on its boat.
LIST.pairs[1] = {
  ...LIST.pairs[1],
  session: {
    open: true,
    nextChangeAt: new Date(NOW + 40 * 60_000).toISOString(),
  },
};
const NVDA_PIER = LIST.pairs[1].piers.sol.address;
const SOL_USD = LIST.quoteUsd.sol;

const HOLDINGS = [
  {
    kind: "NATIVE_SOL",
    mint: null,
    amountRaw: "12400000000",
    spendableRaw: "12390000000",
    decimals: 9,
    symbol: "SOL",
    catalog: { usdPrice: String(SOL_USD) },
  },
  {
    kind: "TOKEN",
    mint: USDC,
    amountRaw: "248120000",
    spendableRaw: "248120000",
    decimals: 6,
    symbol: "USDC",
    catalog: {
      symbol: "USDC",
      name: "USD Coin",
      isVerified: true,
      usdPrice: "1",
    },
  },
  {
    kind: "TOKEN",
    mint: TSLAX,
    amountRaw: "184000000",
    spendableRaw: "184000000",
    decimals: 8,
    catalog: {
      symbol: "TSLAx",
      name: "Tesla xStock",
      isVerified: true,
      usdPrice: "431.2",
    },
  },
  {
    kind: "TOKEN",
    mint: NVDAX,
    amountRaw: "620000000",
    spendableRaw: "620000000",
    decimals: 8,
    catalog: {
      symbol: "NVDAx",
      name: "NVIDIA xStock",
      isVerified: true,
      usdPrice: "183.4",
    },
  },
  {
    kind: "TOKEN",
    mint: SPYX,
    amountRaw: "52000000",
    spendableRaw: "52000000",
    decimals: 8,
    catalog: {
      symbol: "SPYx",
      name: "SP500 xStock",
      isVerified: true,
      usdPrice: "684.9",
    },
  },
];

const BOAT = positionView({
  kind: "damm-v2",
  address: "8zvEZXMTHrhQze7z6uEG2Y8YmJRk25DYvfAYUHKjKpJq",
  pool: NVDA_PIER,
  name: "NVDAx-SOL",
  x: {
    mint: NVDAX,
    symbol: "NVDAx",
    amount: 0.54,
    unclaimed: 0,
    priceUsd: 183.4,
  },
  y: {
    mint: SOL,
    symbol: "SOL",
    amount: 0.537,
    unclaimed: 0.0042,
    priceUsd: SOL_USD,
  },
  lower: null,
  upper: null,
  price: 0.9957,
  valueUsd: 0.54 * 183.4 + 0.537 * SOL_USD,
  unclaimedUsd: 0.0042 * SOL_USD,
});

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const browser = await chromium.launch({
  executablePath: process.env.PRESS_CHROME || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.mobile ? 2 : 1,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    locale: LANG === "uk" ? "uk-UA" : "en-US",
    timezoneId: "Europe/Kyiv",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = (state) =>
    page.screenshot({
      path: path.join(out, `${state}-${size.name}-${LANG}.png`),
    });

  await page.addInitScript(
    ({ owner, lang }) => {
      Object.defineProperty(navigator, "languages", {
        get: () => (lang === "uk" ? ["uk-UA", "uk", "en"] : ["en-US", "en"]),
      });
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
      const account = {
        address: owner,
        publicKey: new Uint8Array(32),
        chains: ["solana:mainnet"],
        features: ["solana:signTransaction"],
        label: "Phantom",
      };
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async (input) => (input?.silent ? { accounts: [] } : ((wallet.accounts = [account]), { accounts: [account] })),
          },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: () => new Promise(() => {}),
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: (api) => api.register(wallet),
        }),
      );
    },
    { owner: OWNER, lang: LANG },
  );

  let admitted = true;
  const json = (route, status, body) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const LETTERS = {
    [SOL]: ["S", "#9945FF"],
    [USDC]: ["$", "#2775CA"],
    [TSLAX]: ["T", "#E31937"],
    [NVDAX]: ["N", "#76B900"],
    [SPYX]: ["S", "#1F3C88"],
    [AAPLX]: ["A", "#8E8E93"],
  };
  await page.route("**/api/icon/*", (route) => {
    const [glyph, fill] = LETTERS[route.request().url().split("/").pop()] ?? ["·", "#23222D"];
    return route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="19" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>`,
    });
  });
  await page.route("**/api/city/earn/stock-piers", (route) => json(route, 200, LIST));
  await page.route("**/api/city/earn/stock-piers/admit?*", (route) =>
    json(route, 200, admitted ? { build: "on", exit: "on", ceilingUsd: 1000, stopped: false } : { build: "off", exit: "off", ceilingUsd: null, stopped: false }),
  );
  await page.route("**/api/city/earn/stock-piers/review", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300));
    const review = addReview({
      expiresAt: Date.now() + 60_000,
      signableMs: 60_000,
      networkFeeLamports: "15000",
    });
    if (body.action === "build") {
      const pair = LIST.pairs.find((p) => p.mint === body.stock) ?? LIST.pairs[0];
      const spot = pair.piers[body.quote];
      const builds = !spot.built;
      const quoteMint = body.quote === "sol" ? SOL : USDC;
      review.preview = {
        ...review.preview,
        venue: "meteora-damm2",
        pool: spot.address,
        range: { kind: "range", minPrice: null, maxPrice: null },
        rent: builds
          ? [
              {
                what: "position",
                direction: "pay",
                lamports: "9831840",
                refundable: true,
              },
              {
                what: "pool",
                direction: "pay",
                lamports: "13711680",
                refundable: false,
              },
            ]
          : [
              {
                what: "position",
                direction: "pay",
                lamports: "9831840",
                refundable: true,
              },
            ],
        notices: [],
        deposit: {
          x: { asset: pair.mint, units: body.amountA, decimals: 8 },
          y: {
            asset: quoteMint,
            units: body.amountB,
            decimals: body.quote === "sol" ? 9 : 6,
          },
        },
      };
      review.stockPier = { builds, pool: spot.address };
    } else {
      review.preview = {
        ...review.preview,
        venue: "meteora-damm2",
        action: body.action,
        rent: [
          {
            what: "position",
            direction: "return",
            lamports: "9831840",
            refundable: true,
          },
        ],
        notices: [],
        expected: {
          x: { units: "54000000", decimals: 8 },
          y: { units: "537000000", decimals: 9 },
        },
        claimed: {
          x: { units: "0", decimals: 8 },
          y: { units: "4200000", decimals: 9 },
        },
        minimum: null,
        feesClaimed: {
          x: { units: "0", decimals: 8 },
          y: { units: "4200000", decimals: 9 },
        },
        rewardsClaimed: [],
        closesPosition: body.action === "remove",
      };
    }
    json(route, 200, review);
  });
  await page.route("**/api/city/earn", (route) =>
    json(route, 200, {
      at: new Date().toISOString(),
      epochsPerYear: 182.4,
      lsts: [
        {
          id: "jupsol",
          rate: { lamports: "1104300000", supply: "1000000000" },
          apyPct: 7.18,
          rewardsFeePct: 0,
          unstakeFeePct: 0.1,
          source: "chain",
          epoch: 871,
        },
      ],
    }),
  );
  await page.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: [], at: null }));
  await page.route("**/api/city/earn/stocks?*", (route) => json(route, 200, { stocks: [], at: new Date().toISOString() }));
  await page.route("**/api/solana/earn", (route) =>
    json(route, 200, {
      providers: [],
      positions: [],
      actions: { open: false, mode: "CLOSED", maxUsd: null },
      feeBps: 0,
      readAt: new Date().toISOString(),
    }),
  );
  await page.route("**/api/liquidity/positions?*", (route) =>
    json(route, 200, {
      owner: OWNER,
      positions: [BOAT],
      venues: { dlmm: { ok: true }, "damm-v2": { ok: true } },
      at: Date.now(),
    }),
  );
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/auth/solana/session", (route) =>
    json(route, 200, {
      signedIn: false,
      walletAddress: null,
      proof: null,
      at: Date.now(),
    }),
  );
  await page.route("**/api/city/harbor", (route) => json(route, 200, { pools: [], at: null }));
  await page.route("**/api/liquidity/actions?*", (route) =>
    json(route, 200, {
      add: { status: "later" },
      remove: { status: "later" },
      claim: { status: "later" },
      maxDepositUsd: null,
    }),
  );

  await page.goto(`${base}/`, {
    waitUntil: "domcontentloaded",
    timeout: 300_000,
  });
  await page.waitForFunction(() => typeof window.__openEarn === "function", null, { timeout: 240_000 });
  await page.waitForTimeout(5000);

  const scrollBodyTo = async (selector, block = "start") => {
    await page.evaluate(({ selector, block }) => document.querySelector(selector)?.scrollIntoView({ block }), { selector, block });
    await page.waitForTimeout(400);
  };
  const scrollBodyTop = async () => {
    await page.evaluate(() => {
      const section = document.querySelector("section[aria-label]");
      let el = section?.parentElement;
      while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
      if (el) el.scrollTop = 0;
    });
    await page.waitForTimeout(300);
  };
  const details = LANG === "uk" ? "Деталі" : "Details";

  // Connect from «Mine», then the Shelf with the Stock Pier's card.
  await page.evaluate(() => window.__openEarn("mine"));
  await page.getByRole("tab").first().waitFor({ timeout: 240_000 });
  await page.waitForFunction(() => window.__stockPier && typeof window.__stockPier.getState === "function", null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Phantom" }).first().click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__openEarn("shelf"));
  await page.waitForTimeout(2000);
  await scrollBodyTo('[data-earn-product="stockpier"]', "center");
  await shot("shelf");

  // TSLAx–SOL: no pier yet — the person builds it; the Review is built while the card is read.
  await page.evaluate(() => window.__openEarn("shelf", "stockpier"));
  await page.waitForTimeout(3500);
  await shot("build");
  await page.locator(`[aria-label="${details}"][aria-expanded="false"]`).last().click();
  await page.waitForTimeout(800);
  await shot("build-details");
  await page.locator(`[aria-label="${details}"][aria-expanded="true"]`).last().click();
  await scrollBodyTop();

  // NVDAx–SOL: the pier stands — the person moors beside it; the exchange closes soon.
  await page.evaluate((mint) => window.__stockPier.getState().choose(mint), NVDAX);
  await page.waitForTimeout(3000);
  await scrollBodyTop();
  await shot("moor");

  // SPYx: a dividend step in nine hours — new liquidity waits.
  await page.evaluate((mint) => window.__stockPier.getState().choose(mint), SPYX);
  await page.waitForTimeout(2000);
  await scrollBodyTop();
  await shot("dividend");

  // TSLAx in USDC.
  await page.evaluate((mint) => {
    window.__stockPier.getState().choose(mint);
    window.__stockPier.getState().setQuote("usdc");
  }, TSLAX);
  await page.waitForTimeout(3000);
  await scrollBodyTop();
  await shot("build-usdc");

  // Built.
  await page.evaluate(() =>
    window.__stockPier.setState({
      phase: "done",
      done: { kind: "build", pool: "x" },
      quote: "sol",
      outcome: {
        kind: "done",
        signatures: ["5Ld9mYd1fYpZ9JwT1hT8wFqAXo4oXbF3nE7Yq4ZrkC1VbkGx3PZ5rtv1QpH6AqgM8nTJxv8xjzQcZb6yH3U4wFq"],
      },
    }),
  );
  await page.waitForTimeout(800);
  await shot("done");
  await page.evaluate(() => window.__stockPier.getState().again());
  await page.waitForTimeout(600);

  // The boat in NVDAx's pier, its plan «step out» due as the exchange closes.
  await page.evaluate(({ owner, pool }) => window.__stockPier.getState().keepBoatPlan(owner, pool, "leave"), { owner: OWNER, pool: NVDA_PIER });
  await page.evaluate(() => window.__stockPier.getState().openBoat(window.__earnData.getState().positions.value.value[0]));
  await page.waitForTimeout(1500);
  await shot("boat");
  await page.evaluate(() => window.__stockPier.getState().back());
  await page.waitForTimeout(600);

  // Closed to this wallet: the verified pairs read-only, with «tell me when it opens».
  admitted = false;
  await page.evaluate((owner) => window.__stockPier.getState().loadStates(owner), OWNER);
  await page.evaluate((mint) => {
    window.__stockPier.getState().choose(mint);
    window.__stockPier.getState().setQuote("sol");
    window.__stockPier.getState().setTyped("1");
  }, TSLAX);
  await page.waitForTimeout(2000);
  await page.evaluate(() => document.querySelectorAll('[role="switch"]').forEach((el) => el.scrollIntoView({ block: "end" })));
  await page.waitForTimeout(500);
  await shot("closed");

  if (errors.length) console.log(size.name, "errors:", errors.slice(0, 6));
  await context.close();
}

await browser.close();
console.log("shots in", out);
