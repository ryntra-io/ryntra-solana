// CITY-215 — the tower window on a phone, in a real browser: a finger up or down over the chart scrolls the window to
// the amount and Market · Limit · Stop; across and a pinch stay the chart's; the first read refused for rate (429 with
// Retry-After) is tried again in silence. Screens at 390×844 → <out>/tower-<lang>-<state>.jpg, the checks →
// <out>/checks.json; a failed check exits 1.
//   node city/lib/chart/phone-shots.mjs [out] [baseUrl]   (npm run dev running, NEXT_PUBLIC_RYNTRA_CITY_SPOT=open)
// The touches are the browser's own (CDP `Input.dispatchTouchEvent`): the page scrolls, flings and pinches as on a
// phone. No wallet, no keys, no network: the engine's routes answer with fixtures — the city's bundled snapshot read as
// live and a walk of candles that ends at the tower's price.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/city-215");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const SYMBOL = process.env.COIN ?? "POPCAT";
const tower = snapshot.towers.find((t) => t.symbol === SYMBOL);
const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const SOL_MINT = "So11111111111111111111111111111111111111112";
const solPrice = snapshot.towers.find((t) => t.id === SOL_MINT).price;
const SECONDS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400 };
/** The first reads of the candles are refused for rate, as on the phone pass of CITY-214; then the bars come. */
const REFUSED = Number(process.env.REFUSED ?? 3);
const RETRY_AFTER_S = Number(process.env.RETRY_AFTER_S ?? 2);

function candles(tf) {
  const size = SECONDS[tf];
  const now = Math.floor(Date.now() / 1000 / size) * size;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = 220;
  const closes = [tower.price];
  for (let i = 1; i < n; i += 1) closes.unshift(closes[0] * (1 + (rand() - 0.52) * 0.018));
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close * 0.995;
    const wick = 1 + rand() * 0.006;
    return { time: now - (n - i) * size, open, high: Math.max(open, close) * wick, low: Math.min(open, close) / wick, close, volume: 8_000 + rand() * 40_000 };
  });
}

/** The recorded quote, re-priced for this tower at the snapshot's prices (as the chart's own shots do). */
function quote(amountRaw) {
  const body = structuredClone(golden["quote: SOL to USDT with the referral fee"].steps.at(-1).body);
  const o = body.order;
  const outRaw = BigInt(Math.floor((((Number(amountRaw) / 1e9) * solPrice) / tower.price) * 0.99 * 1e9));
  Object.assign(o, {
    inputMint: SOL_MINT,
    outputMint: tower.id,
    inAmountRaw: amountRaw,
    outAmountRaw: outRaw.toString(),
    minReceivedRaw: ((outRaw * 995n) / 1000n).toString(),
    priceImpactPct: "0.08",
    route: [{ ...o.route[0], label: "Meteora DLMM", inputMint: SOL_MINT, outputMint: tower.id, inAmountRaw: amountRaw, outAmountRaw: outRaw.toString() }],
  });
  body.decimals = { [SOL_MINT]: 9, [tower.id]: 9 };
  body.expiresAt = new Date(Date.now() + 45_000).toISOString();
  o.reviewExpiresAt = body.expiresAt;
  return body;
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const checks = [];
const check = (lang, name, pass, detail) => {
  checks.push({ lang, name, pass, ...detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${lang}] ${name}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
};

for (const lang of (process.env.LANGS ?? "en,uk").split(",")) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((lang) => {
    try {
      localStorage.setItem("ryntra.city.lang", lang);
    } catch {}
    // Every text the chart's frame ever said, kept as it appears: «Chart unavailable» must never be one of them.
    window.__chartSaid = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll("[data-trade-chart] [role=status]")) window.__chartSaid.push(el.textContent);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, lang);
  const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
  await page.route("**/api/city", (route) => json(route, 200, { ...snapshot, source: "live", fetchedAt: new Date().toISOString() }));
  const reads = [];
  await page.route("**/api/spot/candles?*", (route) => {
    const tf = new URL(route.request().url()).searchParams.get("tf");
    reads.push(Date.now());
    if (reads.length <= REFUSED) return json(route, 429, { error: { code: "RATE_LIMITED", message: "Too many requests." } }, { "Retry-After": String(RETRY_AFTER_S) });
    return json(route, 200, { timeframe: tf, candles: candles(tf), pool: { name: `${SYMBOL} / SOL` }, observedAt: new Date(Date.now() - 4_000).toISOString(), stale: false, source: "geckoterminal" });
  });
  await page.route("**/api/spot/token?*", (route) => json(route, 200, { marks: [], facts: null, observedAt: new Date().toISOString() }));
  await page.route("**/api/solana/swap/quote", (route) => json(route, 200, quote(route.request().postDataJSON().amountRaw)));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));

  const shot = (state) => page.screenshot({ path: path.join(out, `tower-${lang}-${state}.jpg`), type: "jpeg", quality: 84 });
  const cdp = await context.newCDPSession(page);
  // Each touch carries the time a finger would make it (a frame apart): the cloud's software GPU keeps the page's main
  // thread busy, and a touch stamped when it is finally delivered would read as a finger held still.
  const touch = async (type, points, at) =>
    cdp.send("Input.dispatchTouchEvent", { type, timestamp: at / 1000, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  /** One finger or two, from `from` to `to` (each a list of [x, y]), in steps a frame apart, then lifted. */
  const gesture = async (from, to, steps = 18, hold = 0) => {
    const t0 = Date.now();
    await touch("touchStart", from, t0);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= steps; i += 1) {
      await touch("touchMove", from.map(([x, y], k) => [x + ((to[k][0] - x) * i) / steps, y + ((to[k][1] - y) * i) / steps]), t0 + hold + i * 16);
    }
    await touch("touchEnd", [], t0 + hold + (steps + 1) * 16);
    await page.waitForTimeout(1200);
  };

  const opened = Date.now();
  await page.goto(`${base}/c/${tower.id}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  const chart = page.locator("[data-trade-chart]");
  await chart.waitFor({ timeout: 180_000 });
  await page.locator("[data-trade-chart] .ryntra-chart[data-phase='ready']").waitFor({ timeout: 90_000 });
  const drawnAfter = Date.now() - opened;
  await page.waitForTimeout(1500);
  const said = await page.evaluate(() => [...new Set(window.__chartSaid)]);
  check(lang, "first chart: refused reads tried again in silence", reads.length > REFUSED && !said.some((t) => /unavailable|недоступн/i.test(t ?? "")), {
    refused: REFUSED,
    retryAfterS: RETRY_AFTER_S,
    reads: reads.length,
    pausesMs: reads.slice(1).map((t, i) => t - reads[i]),
    said,
    drawnAfterMs: drawnAfter,
  });
  await shot("window");

  // The window's own scroller, the chart's box, and the touch-action the browser reads on the engine's canvas.
  const scroller = await page.evaluate(() => {
    const pane = document.querySelector("[data-trade-chart]");
    for (let el = pane?.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
        el.setAttribute("data-shot-scroller", "");
        return { height: el.clientHeight, scrollHeight: el.scrollHeight };
      }
    }
    return null;
  });
  const top = () => page.evaluate(() => document.querySelector("[data-shot-scroller]")?.scrollTop ?? -1);
  const toTop = () => page.evaluate(() => document.querySelector("[data-shot-scroller]")?.scrollTo(0, 0));
  const engineTouch = await page.evaluate(() => getComputedStyle(document.querySelector("[data-trade-chart] .ryntra-chart__canvas > div")).touchAction);
  check(lang, "the window scrolls and the canvas lets it pan up and down", scroller !== null && engineTouch === "pan-y", { scroller, engineTouch });
  const box = await page.locator("[data-trade-chart] .ryntra-chart__canvas").boundingBox();
  const cx = box.x + box.width * 0.45;
  const cy = box.y + box.height * 0.5;
  const canvasShot = () => page.locator("[data-trade-chart] .ryntra-chart__canvas").screenshot({ type: "png" });
  const ticket = page.getByRole("tablist").first();

  // 1. Up over the candles: the window scrolls; the ticket comes into view.
  const before = await top();
  const ticketBefore = (await ticket.boundingBox())?.y ?? null;
  await gesture([[cx, cy + 60]], [[cx + 4, cy - 110]]);
  const after = await top();
  const ticketAfter = (await ticket.boundingBox())?.y ?? null;
  const crosshairAfterScroll = await page.evaluate(() => Boolean(document.querySelector("[data-trade-chart] .ryntra-chart__ohlc-row")));
  check(lang, "a finger up over the chart scrolls the window", after > before + 60, { before, after, ticketBefore, ticketAfter });
  await shot("scrolled");
  // Further, slowly (no fling), until Market · Limit · Stop stands under the window's head.
  const lift = Math.max(40, (ticketAfter ?? 700) - 400);
  await gesture([[cx, 790]], [[cx, 790 - lift]], Math.round(lift / 4));
  const deep = await top();
  check(lang, "a second swipe reaches the ticket", deep > after, { deep, crosshairAfterScroll });
  await shot("ticket");
  await toTop();
  await page.waitForTimeout(600);

  // 2. Across the candles: the chart moves, the window does not.
  const across0 = await canvasShot();
  const acrossTop0 = await top();
  await gesture([[cx + 90, cy]], [[cx - 90, cy + 6]]);
  const acrossTop1 = await top();
  const across1 = await canvasShot();
  check(lang, "a finger across moves the candles, not the window", acrossTop1 === acrossTop0 && !across0.equals(across1), { acrossTop0, acrossTop1, chartChanged: !across0.equals(across1) });

  // 3. A pinch, fingers apart across, and fingers apart up and down: the chart zooms, the window stays.
  for (const [name, from, to] of [
    ["across", [[cx - 30, cy], [cx + 30, cy]], [[cx - 110, cy], [cx + 110, cy]]],
    ["up and down", [[cx - 6, cy - 25], [cx + 6, cy + 25]], [[cx - 10, cy - 95], [cx + 10, cy + 95]]],
  ]) {
    const p0 = await canvasShot();
    const t0 = await top();
    await gesture(from, to, 16);
    const t1 = await top();
    const p1 = await canvasShot();
    check(lang, `a pinch (${name}) zooms the chart, not the window`, t1 === t0 && !p0.equals(p1), { t0, t1, chartChanged: !p0.equals(p1) });
  }

  // 4. A finger held first, then moved up: the crosshair's, the window stays.
  const h0 = await top();
  await gesture([[cx, cy]], [[cx, cy - 70]], 12, 650);
  const h1 = await top();
  check(lang, "a finger held, then moved up, stays the chart's", h1 === h0, { h0, h1 });

  check(lang, "no page errors", errors.length === 0, { errors });
  await context.close();
}

await browser.close();
writeFileSync(path.join(out, "checks.json"), JSON.stringify({ coin: SYMBOL, checks }, null, 2) + "\n");
const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `${failed.length} check(s) failed` : `all ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
