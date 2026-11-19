// «Обмін» і «Міст» на швидкість (18.11): скільки чекає людина до ціни, скільки разів бачить відмову, і кадри
// 1920×1080 та 390×844, EN і UK → <out>/*.jpg і <out>/speed.json
//   node terminal/swap/speed-shots.mjs <out> <baseUrl>
// `baseUrl` — живий ryntra.io («до») або стенд `next build` + `next start` із прапорцями проду («після»,
// локальний файл прапорців проду). Ціни — справжні відповіді двигуна того сайту (Jupiter, Relay): лише читання.
// Гаманець — заглушка Wallet Standard: підключається й ніколи не підписує; її баланси — як у власника 18.11 (0.0619
// USDC, 0.2063 SOL). Точне замовлення — записана відповідь двигуна, переоцінена на живу ціну з екрана: маршрут
// замовлення не питається ні на проді, ні на стенді. Нічого не надсилається.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/swap-speed/after");
const base = process.argv[3] ?? "http://localhost:3113";
mkdirSync(out, { recursive: true });

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const golden = JSON.parse(readFileSync(new URL("../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const recordedOrder = () => structuredClone(golden["order: SOL to USDT with the verified referral fee is a signable Review"].steps.at(-1).body);

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
/** How many share presses a person makes on each form (25 · 50 · 75 · Max, round and round). */
const PRESSES = Number(process.env.PRESSES ?? 8);
const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "206300000", spendableRaw: "206300000", decimals: 9 },
  { kind: "TOKEN", mint: USDC, amountRaw: "61900", spendableRaw: "61900", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
];
const report = { base, at: new Date().toISOString(), swap: [], bridge: [], notes: [] };

for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: uk ? "uk-UA" : "en-US" });
    let lastQuote = null;
    const quotes = [];
    await context.route("**/api/solana/holdings*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }) }));
    await context.route("**/api/solana/activity", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { actions: [], complete: true } }) }));
    await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    // The exact order: the engine's recorded Review carrying the live quote's figures — the order route is never asked.
    await context.route("**/api/solana/swap/order", async (route) => {
      const { input } = route.request().postDataJSON();
      const body = recordedOrder();
      const quote = lastQuote?.order;
      if (quote && quote.inAmountRaw === input.amountRaw) {
        Object.assign(body.order, { inputMint: input.inputMint, outputMint: input.outputMint, inAmountRaw: quote.inAmountRaw, outAmountRaw: quote.outAmountRaw, minReceivedRaw: quote.minReceivedRaw, priceImpactPct: quote.priceImpactPct, slippageBps: quote.slippageBps, route: quote.route, ryntraFee: quote.ryntraFee, platformFee: quote.platformFee, totalFeeBasisPoints: quote.totalFeeBasisPoints });
        body.decimals = lastQuote.decimals;
      }
      const expires = new Date(Date.now() + 45_000).toISOString();
      body.expiresAt = expires;
      body.order.reviewExpiresAt = expires;
      await new Promise((resolve) => setTimeout(resolve, 900));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    for (const pattern of ["**/api/solana/swap/execute", "**/api/swap/bridge/relay/**"]) await context.route(pattern, (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));

    const page = await context.newPage();
    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("/api/solana/swap/quote") && !url.includes("/api/swap/bridge/quote")) return;
      const body = await response.json().catch(() => null);
      if (url.includes("/swap/quote") && response.ok()) lastQuote = body;
      quotes.push({ route: url.includes("bridge") ? "bridge" : "swap", status: response.status(), code: body?.error?.code ?? null, field: body?.error?.field ?? null, fee: body?.order?.ryntraFee?.basisPoints ?? null, router: body?.order?.router ?? null, timing: response.headers()["server-timing"] ?? null });
    });
    await page.addInitScript(({ taker }) => {
      try {
        localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
      } catch {}
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
      const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { taker: TAKER });

    const shot = (name) => page.screenshot({ path: path.join(out, `${name}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForTimeout(1500);
    };
    /** What a person sees right now: the figure got, whether it still shimmers, the fee line, a refusal, the button. */
    const look = () =>
      page.evaluate(() => {
        const live = document.querySelector("main [aria-live='polite']");
        const shimmer = Boolean(live?.querySelector("[role='status']"));
        const text = (live?.textContent ?? "").trim();
        const fee = [...document.querySelectorAll("main span")].map((node) => node.textContent?.trim() ?? "").find((line) => /^(Fee |No Ryntra fee|Комісія |Без комісії Ryntra)/.test(line)) ?? null;
        const note = document.querySelector("main p[data-tone]");
        const go = [...document.querySelectorAll("main button")].filter((node) => node.offsetParent !== null).at(-1);
        return { got: text, shimmer, fee, note: note ? `${note.getAttribute("data-tone")}: ${note.textContent?.trim()}` : null, button: go?.textContent?.trim() ?? null };
      });

    // ── «Обмін»: USDC → SOL, as the owner tried on 18.11 ──
    await page.goto(`${base}/swap?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.getByText(uk ? "Платиш" : "You pay").first().waitFor({ timeout: 120_000 });
    await settle();
    const pickPay = page.getByRole("button", { name: new RegExp(`^${uk ? "Обрати, чим платиш" : "Pick the coin you pay"}`) });
    if (!/USDC$/.test((await pickPay.getAttribute("aria-label").catch(() => "")) ?? "")) {
      await tap(pickPay);
      await page.locator("input[type='search']").fill("USDC");
      await page.waitForTimeout(900);
      await tap(page.getByRole("menuitemradio", { name: /^USDC/ }).first());
      await page.waitForTimeout(1200);
    }
    const pickGet = page.getByRole("button", { name: new RegExp(`^${uk ? "Обрати, що отримаєш" : "Pick the coin you get"}`) });
    if (!/SOL$/.test((await pickGet.getAttribute("aria-label").catch(() => "")) ?? "")) {
      await tap(pickGet);
      await page.locator("input[type='search']").fill("SOL");
      await page.waitForTimeout(900);
      await tap(page.getByRole("menuitemradio", { name: /^SOL/ }).first());
      await page.waitForTimeout(1200);
    }
    const shares = ["25%", "50%", "75%", uk ? "Макс" : "Max"];
    const seen = [];
    for (let press = 0; press < PRESSES; press += 1) {
      const label = shares[press % shares.length];
      const chip = page.getByRole("radio", { name: label }).or(page.getByRole("button", { name: label, exact: true })).first();
      const before = quotes.length;
      const started = Date.now();
      await tap(chip);
      let state = await look();
      let refused = null;
      let buttonWait = 0;
      // Until a figure stands for this press, or a refusal is said: at most 15 s.
      while (Date.now() - started < 15_000) {
        state = await look();
        if (state.note && /^error/.test(state.note)) refused = refused ?? state.note;
        if (quotes.length > before && !state.shimmer && state.got && state.got !== "0") break;
        if (refused && !state.shimmer) break;
        await page.waitForTimeout(50);
      }
      const shownMs = Date.now() - started;
      // What the button says over the next 2.5 s: «Getting your order…» counted in time.
      const watchFrom = Date.now();
      while (Date.now() - watchFrom < 2_500) {
        const now = await look();
        if (/Getting your order|Готуємо|Отримуємо/i.test(now.button ?? "")) buttonWait += 50;
        if (now.note && /^error/.test(now.note)) refused = refused ?? now.note;
        await page.waitForTimeout(50);
      }
      const settled = await look();
      seen.push({ press: label, shownMs, refused, fee: settled.fee, got: settled.got, buttonBusyMs: buttonWait, asked: quotes.slice(before).map((q) => `${q.status}${q.code ? ` ${q.code}` : ""}${q.router ? ` ${q.router}/${q.fee}` : ""}`) });
      if (press === 1) await shot("swap-usdc-sol");
    }
    report.swap.push({ size: size.name, lang, presses: seen });

    // ── «Міст»: Solana SOL → Base ETH, before an EVM wallet is connected ──
    await page.goto(`${base}/bridge?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.locator("[data-bridge-screen]").waitFor({ timeout: 120_000 });
    await settle();
    await tap(page.getByRole("button", { name: uk ? "Поміняти місцями" : "Swap sides" }).first());
    await page.waitForTimeout(800);
    const before = quotes.length;
    const started = Date.now();
    await page.locator("[data-bridge-screen] input[inputmode='decimal']").first().fill("0.1");
    let bridged = null;
    while (Date.now() - started < 20_000) {
      const asked = quotes.slice(before).filter((q) => q.route === "bridge");
      const last = asked.at(-1);
      if (last && (last.status === 200 || !["RATE_LIMITED", "QUOTE_RATE_LIMITED", "QUOTE_HTTP_ERROR", "QUOTE_UNREADABLE"].includes(last.code ?? ""))) {
        bridged = { ms: Date.now() - started, asked: asked.map((q) => `${q.status}${q.code ? ` ${q.code}` : ""}${q.field ? `/${q.field}` : ""}`) };
        break;
      }
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1500);
    await shot("bridge-sol-base");
    report.bridge.push({ size: size.name, lang, ...(bridged ?? { ms: null, asked: quotes.slice(before).filter((q) => q.route === "bridge").map((q) => `${q.status} ${q.code ?? ""}`) }) });
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "speed.json"), JSON.stringify(report, null, 1));
for (const row of report.swap) {
  const ms = row.presses.map((p) => p.shownMs).sort((a, b) => a - b);
  const refused = row.presses.filter((p) => p.refused).length;
  console.log(`swap ${row.size}/${row.lang}: to figures p50 ${ms[Math.floor(ms.length / 2)]} ms, max ${ms.at(-1)} ms; refusals said ${refused}/${row.presses.length}; fee lines ${[...new Set(row.presses.map((p) => p.fee))].join(" | ")}; button busy ${row.presses.map((p) => p.buttonBusyMs).join(",")} ms`);
}
for (const row of report.bridge) console.log(`bridge ${row.size}/${row.lang}: ${row.ms ?? "none"} ms — ${row.asked.join(", ")}`);
