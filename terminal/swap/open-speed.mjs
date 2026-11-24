// «Обмін» на відкритті без гаманця (огляд очима 20.11, №17): скільки запитів ціни йде, коли кожен відповідає і коли
// число стає в «Отримаєш» → <out>/open-speed.json
//   node terminal/swap/open-speed.mjs <out> <baseUrl> [delayMs …]
// `baseUrl` — стенд `next build` + `next start` (або живий сайт). Відповідь котирування — записана відповідь двигуна
// (золоті транскрипти маршруту), яка приходить через задані затримки: перша — `delayMs[0]`, друга — `delayMs[1]` …;
// так відтворюється відповідь двигуна за 2,4 с, як наживо. Два сценарії: `open` — просто відкрити «Обмін»; `back` —
// відкрити, поки ціна в дорозі перейти в «Заробіток» і одразу назад (м'яка навігація Next, як дотик у меню) (картка закривається й відкривається на тій самій
// монеті й сумі). Гаманця немає; нічого не підписується й не надсилається.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/eyes-g3/open-speed");
const base = process.argv[3] ?? "http://localhost:3113";
const delays = process.argv.slice(4).map(Number).filter((ms) => ms >= 0);
const DELAYS = delays.length ? delays : [2400, 7400];
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const recorded = golden["quote: SOL to USDT with the referral fee"].steps.at(-1).body;
const SOL = "So11111111111111111111111111111111111111112";

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const report = { base, delays: DELAYS, at: new Date().toISOString(), runs: [] };
const SCENES = (process.env.SCENES ?? "open,back").split(",");
for (const scene of SCENES)
for (const lang of (process.env.LANGS ?? "en,uk").split(",")) {
  for (const size of [{ name: "desk", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844, mobile: true }]) {
    if (scene === "back" && size.mobile) continue;
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: Boolean(size.mobile), hasTouch: Boolean(size.mobile), locale: lang === "uk" ? "uk-UA" : "en-US" });
    const asks = [];
    let t0 = 0;
    await context.route("**/api/solana/swap/quote", async (route) => {
      const input = route.request().postDataJSON();
      const ask = { at: Date.now() - t0, amountRaw: input.amountRaw, answeredAt: null };
      asks.push(ask);
      const ms = DELAYS[Math.min(asks.length - 1, DELAYS.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, ms));
      // The recorded answer, written for the pair asked: the figures are the engine's own.
      const body = structuredClone(recorded);
      Object.assign(body.order, { inputMint: input.inputMint, outputMint: input.outputMint, inAmountRaw: input.amountRaw });
      body.decimals = { [input.inputMint]: 6, [input.outputMint]: input.outputMint === SOL ? 9 : 6 };
      ask.answeredAt = Date.now() - t0;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
    });
    const page = await context.newPage();
    t0 = Date.now();
    await page.goto(`${base}/swap?lang=${lang}`, { waitUntil: "commit", timeout: 120_000 });
    if (scene === "back") {
      // The price is on its way: Earn, and straight back — through the menu and the browser's own «Back».
      while (asks.length === 0 && Date.now() - t0 < 10_000) await page.waitForTimeout(20);
      await page.evaluate(() => window.next.router.push("/earn"));
      await page.waitForURL(/\/earn/, { timeout: 10_000 });
      await page.goBack();
    }
    let shownAt = null;
    let got = null;
    while (Date.now() - t0 < 14_000) {
      const now = await page
        .evaluate(() => {
          const live = document.querySelector("main [aria-live='polite']");
          if (!live) return null;
          const shimmer = Boolean(live.querySelector("[role='status']"));
          return { shimmer, text: (live.textContent ?? "").trim() };
        })
        .catch(() => null);
      if (now && !now.shimmer && now.text && now.text !== "0") {
        shownAt = Date.now() - t0;
        got = now.text;
        break;
      }
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: path.join(out, `${scene}-${size.name}-${lang}.jpg`), quality: 80, type: "jpeg" });
    const run = { scene, lang, size: size.name, asks, shownAt, got };
    report.runs.push(run);
    console.log(`${scene} ${size.name}/${lang}: asks ${asks.map((a) => `+${(a.at / 1000).toFixed(1)}s→+${a.answeredAt === null ? "…" : (a.answeredAt / 1000).toFixed(1)}s`).join(", ")}; figure ${shownAt === null ? "none in 14 s" : `+${(shownAt / 1000).toFixed(1)} s`} (${got ?? ""})`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "open-speed.json"), JSON.stringify(report, null, 1));
