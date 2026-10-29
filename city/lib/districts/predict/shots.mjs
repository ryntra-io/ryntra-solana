// The Predictions window's screens for review, at 1440×900 and 390×844 → <out>/predict-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_ORACLE=open [NEXT_PUBLIC_RYNTRA_CITY_PREDICT_REAL=open] npm run dev, then:
//   node city/lib/districts/predict/shots.mjs [out] [baseUrl]
// No wallet and no keys: the window's reads are answered here with fixtures shaped as Predictions' routes answer
// (test-fixtures.mjs), and Practice keeps its book on the device. The questions and figures on these screens are
// fixtures, not a read of AGG; the live pass on the stand is the overseer's. Real screens appear only where the dev
// server has the real switch open, with a fixture account behind a fake wallet proof.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chartBody, discoverBody, eventBody, fundingBody, liveBody, orderRecord, quoteBody } from "./test-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "out/predict-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const WALLET = "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj";

const browser = await chromium.launch({
  executablePath: process.env.PRESS_CHROME || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU|Content Security Policy/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `predict-${state}-${size.name}.png`) });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  // A fresh practice book; and a stand wallet in the Wallet Standard registry, so the Real screens have a connection.
  // It signs nothing: the account's reads below are fixtures, and nothing on these screens reaches money.
  await page.addInitScript((address) => {
    try {
      localStorage.removeItem("ryntra.city.predict.practice.v1");
      localStorage.removeItem("ryntra.city.oracle.v1");
    } catch {}
    const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Stand" };
    const refuse = async () => {
      throw Object.assign(new Error("The stand wallet signs nothing."), { code: 4001 });
    };
    const wallet = {
      version: "1.0.0",
      name: "Stand Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiM5OTQ1RkYiLz48L3N2Zz4=",
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse },
        "solana:signMessage": { version: "1.0.0", signMessage: refuse },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (e) => e.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: ({ register }) => register(wallet) }));
  }, WALLET);
  await page.route("**/api/predictions/discover?*", (route) => {
    const now = Date.now();
    const url = new URL(route.request().url());
    const category = url.searchParams.get("category");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const body = discoverBody(now, { category });
    if (url.searchParams.get("sort") === "ending") body.events = [...body.events].filter((e) => e.endDate && Date.parse(e.endDate) > now).sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate));
    if (q) body.events = body.events.filter((e) => e.title.toLowerCase().includes(q));
    json(route, 200, body);
  });
  await page.route("**/api/predictions/events/*", (route) => json(route, 200, eventBody(route.request().url().split("/").pop().split("?")[0], { now: Date.now() })));
  await page.route("**/api/predictions/outcomes/*/chart?*", (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/outcomes/")[1].split("/")[0];
    const resolution = url.searchParams.get("resolution");
    const step = resolution === "1d" ? 86_400_000 : resolution === "1h" ? 3_600_000 : 5 * 60_000;
    const count = Number(url.searchParams.get("countBack")) || 288;
    const yes = id.startsWith("fed-hike25") ? [0.64, 0.765] : id.startsWith("fed-hold") ? [0.33, 0.215] : [0.52, 0.58];
    json(route, 200, chartBody(id, Date.now(), { count: Math.min(count, 365), stepMs: step, from: yes[0], to: yes[1] }));
  });
  // No cover reaches this stand (no network): every card shows its category's emblem, as a market without a cover does.
  await page.route("**/api/city/predict/cover?*", (route) => route.fulfill({ status: 404, body: "" }));
  let placed = false;
  await page.route("**/api/predictions/live", (route) => json(route, 200, liveBody(WALLET, { orders: placed ? [orderRecord(WALLET, { quoteId: "q_live_1", state: "submitted", spend: 10 })] : [] })));
  await page.route("**/api/predictions/funding", (route) => json(route, 200, fundingBody(WALLET)));
  await page.route("**/api/predictions/quote", (route) => json(route, 200, quoteBody(WALLET, { spend: 10, price: 0.58 })));
  await page.route("**/api/predictions/orders", (route) => {
    placed = true;
    json(route, 202, { wallet: WALLET, order: { quoteId: "q_live_1", state: "submitted" } });
  });
  await page.route("**/api/predictions/orders/*", (route) => json(route, 200, { wallet: WALLET, order: { quoteId: "q_live_1", state: "submitted" } }));

  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForFunction(() => !!window.__city?.getState().layout.towers.length, null, { timeout: 240_000 });
  await page.waitForTimeout(9000);
  await page.getByRole("button", { name: /^(Later|Close the Arrivals card)$/ }).click({ timeout: 4000 }).catch(() => {});
  // The frame names the window by its page: Predictions, Positions, Money.
  const dialog = page.getByRole("dialog", { name: /^(Predictions|Positions|Money|Practice)$/ });
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const scrollPage = (where) =>
    page.evaluate((w) => {
      const el = document.querySelector('[role="dialog"] [data-page] > div');
      if (el) el.scrollTo({ top: w === "end" ? el.scrollHeight : 0 });
    }, where);

  // The showcase: Trending, by the day's volume.
  await page.getByRole("button", { name: "Predict", exact: true }).click();
  await dialog.locator("article").first().waitFor();
  if (!size.mobile) await page.mouse.move(size.width - 20, size.height - 20);
  await settle(2500);
  await shot("01-markets");

  // Ending soon, the soonest closes first.
  await dialog.getByRole("tab", { name: "Ending soon" }).click();
  await settle();
  await shot("02-ending");

  // Search.
  await dialog.getByRole("button", { name: "Search markets" }).click();
  await page.keyboard.type("sol");
  await settle(1200);
  await shot("03-search");
  await dialog.getByRole("button", { name: "Close search" }).click();
  await settle(500);

  // A market's page: the question, the chance, the volume and close, the chart, the ticket.
  await dialog.getByRole("button", { name: "Will Bitcoin close October above $120,000?" }).first().click();
  await page.getByRole("img", { name: "Chance over 1D" }).waitFor();
  await settle(900);
  await shot("04-market");

  // The ticket: amount by a tile, what it wins, the fee in one line.
  if (size.mobile) await scrollPage("end");
  await page.getByRole("radio", { name: "$100" }).click();
  await settle(300);
  await shot("05-ticket");
  await page.getByRole("button", { name: /^Buy Yes/ }).click();
  await settle(1500);
  await shot("06-bought");

  // Details, opened: the rules behind one tap.
  await page.getByRole("button", { name: "Details" }).click();
  await settle(400);
  await page.getByRole("button", { name: "Details" }).scrollIntoViewIfNeeded();
  await shot("07-details");

  // An event of several markets: each bracket a row with its own Yes and No; one picked, bought.
  await page.getByRole("button", { name: "Back to markets" }).click();
  await settle(400);
  await dialog.getByRole("button", { name: "Fed decision in December?" }).first().click();
  await page.getByRole("region", { name: "Markets of this event" }).waitFor();
  await settle(900);
  await page.getByRole("button", { name: "No change: Yes 22¢" }).click();
  await settle(900);
  await shot("08-event-rows");
  if (size.mobile) await scrollPage("end");
  await page.getByRole("radio", { name: "$50" }).click();
  await page.getByRole("button", { name: /^Buy Yes/ }).click();
  await settle(400);

  // The showcase again: what you hold shows on its card and beside the markets; the head counts it.
  await page.getByRole("button", { name: "Back to markets" }).click();
  await dialog.getByRole("tab", { name: "Trending" }).click();
  await settle(700);
  await shot("09-markets-held");

  // Your positions: value, profit or loss, each one with its move.
  await page.getByRole("button", { name: /^Your positions/ }).first().click();
  await settle(600);
  await shot("10-positions");

  // A sale: its market on Sell, then the history.
  await page.getByRole("button", { name: /Will Bitcoin close October above \$120,000\?, Yes/ }).click();
  await settle(900);
  if (size.mobile) await scrollPage("end");
  await settle(300);
  await shot("11-sell");
  await page.getByRole("button", { name: /^Sell Yes/ }).click();
  await settle(400);
  await page.getByRole("button", { name: /^Your positions/ }).first().click();
  await settle(400);
  await dialog.getByRole("tab", { name: "History" }).click();
  await settle(400);
  await shot("12-history");

  // Real, where the switch is open on the stand: the account, the Review with its fee before the signature, the order on its way.
  await page.getByRole("button", { name: "Back to markets" }).click();
  await settle(400);
  const real = await page.getByRole("radio", { name: "Real" }).count();
  if (real) {
    await page.getByRole("radio", { name: "Real" }).click();
    await settle(500);
    await dialog.getByRole("button", { name: "Yes 58¢" }).first().click();
    await settle(900);
    await dialog.getByRole("button", { name: "Connect wallet" }).click();
    await page.getByRole("button", { name: "Stand Wallet" }).click({ timeout: 3000 }).catch(() => {});
    await page.getByRole("button", { name: /^Buy Yes/ }).waitFor({ timeout: 15_000 });
    await page.getByRole("radio", { name: "$10", exact: true }).click();
    await page.getByRole("button", { name: /^Buy Yes/ }).click();
    await page.getByRole("button", { name: /^Confirm/ }).waitFor({ timeout: 15_000 });
    if (size.mobile) await scrollPage("end");
    await settle(400);
    await shot("13-real-review");
    await page.getByRole("button", { name: /^Confirm/ }).click();
    await settle(1500);
    if (size.mobile) await scrollPage("end");
    await shot("14-real-placed");
    await page.getByRole("button", { name: /^Your positions/ }).first().click();
    await settle(800);
    await shot("15-real-positions");
    // The order stays on its way while the engine polls it; the window is held until it ends.
    await page.waitForTimeout(14_000);
    await page.getByRole("button", { name: "Back to markets" }).click().catch(() => {});
    await settle(600);
    await shot("16-real-markets");
  }

  if (errors.length) console.log(`${size.name}: page errors`, errors);
  await context.close();
}

await browser.close();
console.log(`screens in ${out}`);
