// The Pro piers, at 1440×900 and 390×844 → <out>/pro-<state>-<size>-<lang>.png
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO=open npm run dev, then:
//   LANG_EARN=uk node city/lib/earn/pro-shots.mjs [out] [baseUrl]      (LANG_EARN=en for English)
// No wallet and no keys: a stub wallet registers through the Wallet Standard events and never signs. Every route
// answers from a fixture — the Harbor's recorded pools for the piers that were there before, and for the Pro piers the
// shapes of `/api/v1/earn/pro/**` (contract 1.92.0) with the numbers of the rehearsal
// (`docs/research/meteora-dlmm-pro-2026-11-14/results/earn-rehearsal-mainnet.json`). The figures on these screens are
// fixtures; nothing here reaches a chain. The city behind the window is the dev server's own market: the recorded one
// carries a moment the city films, and a film hides the window.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { harborPools } from "../districts/harbor/pools.ts";
import { CATALOG } from "../districts/harbor/test-fixtures.mjs";
import { JITOSOL, SOL, SOL_USDC, USDC, lstPool } from "./pier-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-249");
const base = process.argv[3] ?? "http://localhost:3000";
const LANG = process.env.LANG_EARN ?? "uk";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const AGENT = "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2";
const PRO_POOL = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const PRO_LST = "5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq";
const NFT = "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss";
const solUsd = SOL_USDC.x.priceUsd;
const POOLS = [lstPool(), ...harborPools(CATALOG)];

const PRO_PIERS = [
  { address: PRO_POOL, x: { mint: SOL, symbol: "SOL", decimals: 9 }, y: { mint: USDC, symbol: "USDC", decimals: 6 }, solIsX: true, price: 150.42, feeBps: 25, tickSpacing: 10, tickId: -18_934, depthLamports: "869400000000", rewards: [{ index: 0, mint: USDC, symbol: "USDC", perDayRaw: "864000000", running: true, endsAt: 1_800_000_000 }], takesDeposits: true },
  { address: PRO_LST, x: { mint: JITOSOL, symbol: "JitoSOL", decimals: 9 }, y: { mint: SOL, symbol: "SOL", decimals: 9 }, solIsX: false, price: 1.2603, feeBps: 4, tickSpacing: 1, tickId: 2_313, depthLamports: "23900000000000", rewards: [], takesDeposits: true },
];
const BOAT = { nftMint: NFT, pool: PRO_POOL, inRange: true, ranges: 7, lowerPrice: 147.36, upperPrice: 152.3, worth: { xRaw: "794444550", yRaw: "114850125", lamports: "1560713428" }, fees: { xRaw: "1210000", yRaw: "184000", lamports: "2433000" }, rewards: [{ index: 0, mint: USDC, symbol: "USDC", accruedRaw: "4210000", running: true }], empty: false, cared: false, care: null };
const CARED = { ...BOAT, cared: true, care: { status: "working", stoppedBy: null, stopBelow: 135.38, claimedInY: 0.37, lastAt: new Date(Date.now() - 3_600_000).toISOString() } };

const WIRE = Buffer.from(new Uint8Array(160).fill(7)).toString("base64");
const review = (action, summary, transactions = 1) => ({ network: "devnet", action, ticket: "t".repeat(64), transactions: Array.from({ length: transactions }, () => WIRE), expiresAt: new Date(Date.now() + 28_000).toISOString(), summary: { action, networkLamports: 5_000 * transactions, ...summary } });
/** An opening's Review for what the card asks: «Even» puts next to all of it in; the two shapes of several ranges leave about a fifth out. */
function openReview(body) {
  const lamports = BigInt(body.lamports);
  const even = body.goal === "even";
  const steps = { calm: 34, balanced: 16, dense: 5 }[body.style];
  const reach = Math.pow(1.0001, steps * 10);
  const into = even ? (lamports * 985n) / 1_000n : (lamports * 780n) / 1_000n;
  const x = into / 2n;
  const y = BigInt(Math.round((Number(into - x) / 1e9) * 150.42 * 1e6));
  return review(
    "open",
    {
      goesIn: { xRaw: x.toString(), yRaw: y.toString(), lamports: into.toString() },
      staysLamports: (lamports - into - lamports / 800n).toString(),
      bandBps: Math.max(1, Math.floor((steps * 10) / (even ? 4 : 8))),
      lowerPrice: 150.42 / reach,
      upperPrice: 150.42 * reach,
      ranges: even ? 1 : 7,
      swap: { lamports: (lamports / 2n).toString(), feeBps: 25, referral: true },
      networkLamports: 15_000,
      depositLamports: even ? 24_200_000 : 51_500_000,
      position: PRO_POOL,
      nftMint: NFT,
    },
    2,
  );
}
const BOAT_REVIEWS = {
  compound: () => review("compound", { collected: BOAT.fees, bandBps: 20 }),
  collect: () => review("collect", { fees: BOAT.fees, rewards: [{ mint: USDC, symbol: "USDC", leastRaw: "4210000" }], depositLamports: 0 }, 2),
  leave: () => review("leave", { expected: BOAT.worth, minimum: { xRaw: "760000000", yRaw: "109000000", lamports: "1484000000" }, bandBps: 100, fees: BOAT.fees, rewards: [{ mint: USDC, symbol: "USDC", leastRaw: "4210000" }] }, 3),
  close: () => review("close", {}),
  care_off: () => review("care_off", {}),
};

const HOLDINGS = [{ kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(solUsd) } }];
const FEED = {
  at: new Date().toISOString(),
  epochsPerYear: 182.4,
  lsts: [
    { id: "jupsol", rate: { lamports: "1104300000", supply: "1000000000" }, apyPct: 7.18, rewardsFeePct: 0, unstakeFeePct: 0.1, source: "chain", epoch: 871 },
    { id: "inf", rate: { lamports: "1312200000", supply: "1000000000" }, apyPct: 7.42, rewardsFeePct: null, unstakeFeePct: null, source: "sanctum", epoch: null },
    { id: "jitosol", rate: { lamports: "1260300000", supply: "1000000000" }, apyPct: 6.31, rewardsFeePct: 4, unstakeFeePct: 0.1, source: "chain", epoch: 871 },
  ],
};

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let problems = 0;

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: LANG === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `pro-${state}-${size.name}-${LANG}.png`), timeout: 180_000 });
  let boats = [BOAT];

  await page.addInitScript(({ owner, lang }) => {
    Object.defineProperty(navigator, "languages", { get: () => (lang === "uk" ? ["uk-UA", "uk", "en"] : ["en-US", "en"]) });
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet", "solana:devnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async (input) => (input?.silent ? { accounts: [] } : ((wallet.accounts = [account]), { accounts: [account] })) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
      },
    };
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.append(style);
    });
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { owner: OWNER, lang: LANG });

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const LETTERS = { [SOL]: ["S", "#9945FF"], [USDC]: ["$", "#2775CA"], [JITOSOL]: ["J", "#2F9E6B"] };
  // Every other route of the city answers at once: slow reads (some take minutes on a dev server) hold the browser's
  // six connections, and the window's own code then waits behind them until it times out. The city itself is read.
  // Registered first, so every stub below wins over it.
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/city") return route.fallback();
    return json(route, 503, { error: { code: "UNAVAILABLE" } });
  });
  await page.route("**/api/icon/*", (route) => {
    const [glyph, fill] = LETTERS[route.request().url().split("/").pop()] ?? ["·", "#23222D"];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="19" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
  });
  await page.route("**/api/city/earn", (route) => json(route, 200, FEED));
  await page.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: POOLS, at: "2026-10-16T09:12:00.000Z" }));
  await page.route("**/api/city/earn/piers/admit?*", (route) => json(route, 200, { add: "on", exit: "on", ceilingUsd: 1000, stopped: false }));
  await page.route("**/api/spot/candles?*", (route) => json(route, 404, { error: { code: "CANDLES_NO_POOL" } }));
  await page.route("**/api/city/earn/stocks?*", (route) => json(route, 200, { stocks: [], at: new Date().toISOString() }));
  await page.route("**/api/solana/earn", (route) => json(route, 200, { providers: [], positions: [], actions: { open: false, mode: "CLOSED", maxUsd: null }, feeBps: 0, readAt: new Date().toISOString() }));
  await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: [], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/city/harbor", (route) => json(route, 200, { pools: POOLS, at: null }));
  await page.route("**/api/city/earn/care", (route) => json(route, 200, { ok: true, network: "devnet", cares: [] }));
  await page.route("**/api/liquidity/actions?*", (route) => json(route, 200, { add: { status: "later" }, remove: { status: "later" }, claim: { status: "later" }, maxDepositUsd: null }));
  /* The Pro piers' own five routes. */
  await page.route("**/api/v1/earn/pro/piers", (route) => json(route, 200, { network: "devnet", piers: PRO_PIERS, at: new Date().toISOString(), care: true }));
  await page.route("**/api/v1/earn/pro/positions?*", (route) => json(route, 200, { network: "devnet", owner: OWNER, positions: boats, care: true }));
  await page.route("**/api/v1/earn/pro/review", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 250));
    if (body.action === "open") return json(route, 200, openReview(body));
    if (body.action === "care_on") return json(route, 200, review("care_on", { agent: AGENT, rights: ["claimFee", "claimReward", "removeLiquidity"], stopBelow: body.stopPct === 0 ? null : 150.42 * (1 - body.stopPct / 100), stopCoin: "SOL", stopUnit: "USDC" }));
    return json(route, 200, BOAT_REVIEWS[body.action]());
  });

  const broken = () => page.evaluate(() => /зламалося|went wrong|broke/i.test(document.title));
  // A slow dev server can time the window's chunk out (the page then shows its error screen): the page is loaded again,
  // with the chunk fetched into the cache first, and the wallet connected again where it was.
  const load = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 600_000 });
      await page.waitForFunction(() => typeof window.__openEarn === "function", null, { timeout: 600_000 });
      await page.evaluate(() => fetch("/_next/static/chunks/_app-pages-browser_city_components_earn_EarnWindow_tsx.js").then((answer) => answer.ok, () => false));
      await page.waitForTimeout(6000);
      if (!(await broken())) break;
    }
  };
  await load();
  let connected = false;
  const open = async (tab) => {
    for (let attempt = 0; ; attempt += 1) {
      if (await broken()) {
        await load();
        if (connected) {
          await page.evaluate(() => window.__openEarn("mine"));
          await page.getByRole("button", { name: "Phantom" }).first().click({ timeout: 60_000 }).catch(() => undefined);
          await page.waitForTimeout(2500);
        }
      }
      await page.evaluate((t) => window.__openEarn(t), tab);
      const there = await page.getByRole("tab").first().waitFor({ timeout: 60_000 }).then(() => true, () => false);
      if (there) break;
      if (attempt >= 4) {
        await page.screenshot({ path: path.join(out, `fail-open-${size.name}.png`) }).catch(() => undefined);
        const seen = await page.evaluate(() => ({ title: document.title, open: typeof window.__openEarn, earn: window.__earn?.getState?.() ?? null, text: document.body.innerText.slice(0, 400) })).catch((error) => String(error));
        throw new Error(`the Earn window did not open: ${JSON.stringify(seen)} · ${errors.slice(0, 3).join(" | ")}`);
      }
    }
    await page.waitForTimeout(1500);
  };
  const pro = (work, arg) => page.evaluate(work, arg);
  const intoView = (selector) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), selector);

  await open("mine");
  await page.getByRole("button", { name: "Phantom" }).first().click();
  connected = true;
  await page.waitForTimeout(2500);
  await open("piers");
  await page.waitForFunction(() => window.__proPier?.getState().list.status === "ready" && window.__proPier.getState().boats?.value.status === "ready", null, { timeout: 240_000 });
  await page.waitForTimeout(1200);

  // The list: the piers that were there, then the wallet's Pro boat and the Pro piers with their reward a day.
  await page.evaluate(() => [...document.querySelectorAll("span")].find((el) => /Pro/.test(el.textContent ?? "") && el.children.length === 0)?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  await shot("list");

  // A Pro pier's card, «Even»: the amount, what goes in, one line, one amber action.
  await pro(() => window.__proPier.getState().openPier(window.__proPier.getState().list.value.piers[0]));
  await page.waitForFunction(() => window.__proPier.getState().reviewed !== null, null, { timeout: 60_000 });
  await page.waitForTimeout(700);
  await shot("card");

  // «Details» opened: the band of the price said in full, the range, the swap, the deposit that comes back.
  await page.locator("button[aria-expanded]").last().click();
  await page.waitForTimeout(700);
  await shot("details");
  await page.locator("button[aria-expanded]").last().click();

  // «Near price»: several ranges in one position, and what of the amount stays in the wallet.
  await pro(() => window.__proPier.getState().setGoal("near"));
  await page.waitForFunction(() => window.__proPier.getState().reviewed?.review.summary.ranges === 7, null, { timeout: 60_000 });
  await page.waitForTimeout(700);
  await shot("near");

  // One approval in the wallet.
  await pro(() => window.__proPier.setState({ phase: "wallet" }));
  await page.waitForTimeout(500);
  await shot("approve");

  // Moored.
  await pro(() => {
    const st = window.__proPier.getState();
    window.__proPier.setState({ phase: "done", outcome: { kind: "done", signatures: ["5Yd3pXgqZV4c1nBtTz8sYwJqk2aE9uHhLr7mNf6oPQxW3vKjC1bA2dR8eGiS4tUyX9zM5nBvCxZaQwErTyUiOpAs"] }, sent: st.reviewed, reviewed: null });
  });
  await page.waitForTimeout(600);
  await shot("done");

  // Only the swap landed: said as it is.
  await pro(() => window.__proPier.setState({ phase: "partial", outcome: { kind: "partial", signatures: ["5Yd3pXgqZV4c1nBtTz8sYwJqk2aE9uHhLr7mNf6oPQxW3vKjC1bA2dR8eGiS4tUyX9zM5nBvCxZaQwErTyUiOpAs"] } }));
  await page.waitForTimeout(600);
  await shot("partial");

  // The boat: two lines of income, what to do with it, the agent's switch.
  await pro(() => {
    window.__proPier.setState({ phase: "idle", outcome: null, sent: null, pier: null });
    window.__proPier.getState().openBoat(window.__proPier.getState().boats.value.value[0]);
  });
  await page.waitForTimeout(900);
  await shot("boat");

  // «Take and put back»: its exact figures, one signature.
  await page.getByRole("radio").filter({ hasText: LANG === "uk" ? "Забрати й докласти" : "Take and put back" }).click();
  await page.waitForFunction(() => window.__proPier.getState().reviewed?.review.action === "compound", null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  if (size.mobile) await intoView('[role="radiogroup"]:last-of-type');
  await shot("compound");

  // «Leave»: what comes back, and the least of it.
  await page.getByRole("radio").filter({ hasText: LANG === "uk" ? "Вийти" : "Leave" }).click();
  await page.waitForFunction(() => window.__proPier.getState().reviewed?.review.action === "leave", null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  await shot("leave");

  // The agent's care: one switch, the stop as three chips, what it may do behind «Details».
  await page.getByRole("switch").click();
  await page.waitForFunction(() => window.__proPier.getState().reviewed?.review.action === "care_on", null, { timeout: 60_000 });
  const chip = page.getByRole("radio").filter({ hasText: "−10%" });
  if (!(await chip.waitFor({ timeout: 30_000 }).then(() => true, () => false))) {
    await page.screenshot({ path: path.join(out, `fail-care-${size.name}.png`) }).catch(() => undefined);
    const seen = await page.evaluate(() => ((st) => ({ phase: st.phase, target: st.target, action: st.reviewed?.review.action ?? null, notice: st.notice }))(window.__proPier.getState()));
    throw new Error(`the stop chips did not show: ${JSON.stringify(seen)}`);
  }
  await chip.click();
  await page.waitForFunction(() => window.__proPier.getState().reviewed?.review.summary.stopBelow > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  /* What the care will do stands under the switch; the window is scrolled to it, as a person would. */
  await page.evaluate(() => [...document.querySelectorAll("span")].find((el) => /^(Агент доглядає|The agent looks after it)$/i.test(el.textContent ?? "") && el.closest("[class*=get]"))?.scrollIntoView({ block: "center" }));
  if (size.mobile) await intoView('[role="switch"]');
  await shot("care");
  await page.locator("details summary").last().click();
  await page.waitForTimeout(500);
  if (size.mobile) await intoView("details[open]");
  await shot("care-details");
  await page.locator("details summary").last().click();

  // The agent is on it: what it brought today.
  boats = [CARED];
  await pro((cared) => {
    window.__proPier.setState({ target: null, reviewed: null, boat: cared, boats: { owner: window.__proPier.getState().boats.owner, value: { status: "ready", value: [cared], at: Date.now() } } });
  }, CARED);
  await page.waitForTimeout(700);
  if (size.mobile) await page.evaluate(() => document.querySelector("section")?.scrollIntoView({ block: "start" }));
  await shot("cared");

  // Back at the list: the boat says an agent looks after it.
  await pro(() => window.__proPier.getState().back());
  await page.waitForTimeout(600);
  await page.evaluate(() => [...document.querySelectorAll("span")].find((el) => /Pro/.test(el.textContent ?? "") && el.children.length === 0)?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await shot("list-cared");

  if (errors.length) {
    problems += errors.length;
    console.log(size.name, "errors:", errors.slice(0, 6));
  }
  await context.close();
}

await browser.close();
console.log("shots in", out, problems ? `— ${problems} page errors` : "— no page errors");
