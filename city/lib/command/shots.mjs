// The command line and Ryntra in every window (CITY-85) for review, at 1440×900 and 390×844 → <out>/command-<state>-<size>.jpg
//   node city/lib/command/shots.mjs [out] [baseUrl]      (npm run dev or next start running; ONLY=desk|phone; PRESS_CHROME may point at a Chromium)
// The desk opens the line with Ctrl+K, the phone with the spark in the top bar. Each picked row opens its window filled;
// nothing is pressed in the window and no wallet is connected — the shots end where the person would confirm.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "city/lib/command/shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ONLY = process.env.ONLY;
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false, lang: "en" },
  { name: "phone", width: 390, height: 844, mobile: true, lang: "uk" },
];

const chrome = process.env.PRESS_CHROME || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: chrome, args: ["--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

for (const s of SIZES.filter((size) => !ONLY || size.name === ONLY)) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(String(e));
    console.log(`${s.name}: page error → ${String(e.stack || e).slice(0, 1200)}`);
  });
  const shot = (state) => page.screenshot({ path: path.join(out, `command-${state}-${s.name}.jpg`), quality: 84, timeout: 180_000 });
  const tap = (locator) => (s.mobile ? locator.tap({ timeout: 90_000 }) : locator.click({ timeout: 90_000 }));
  const ask = s.lang === "uk" ? "Спитати Ryntra" : "Ask Ryntra";
  const field = s.lang === "uk" ? "Скажи, що відкрити" : "Say what to open";
  const open = async () => {
    if (s.mobile) await tap(page.getByRole("button", { name: ask }).first());
    else await page.keyboard.press("Control+k");
    await page.waitForTimeout(1200);
  };
  const say = async (text) => {
    const input = page.getByRole("combobox", { name: field });
    await input.fill(text);
    await page.waitForTimeout(900);
  };

  await page.goto(`${base}/?lang=${s.lang}`, { waitUntil: "domcontentloaded" });
  // A development build has its hooks; a production build is ready once the top bar and the canvas stand.
  await page.waitForFunction(() => document.querySelector("[data-city-top]") && document.querySelector("canvas"), null, { timeout: 120_000 });
  await page.waitForTimeout(9000);
  for (const name of ["Later", "Got it", "Пізніше", "Зрозуміло"]) {
    const b = page.getByRole("button", { name, exact: true });
    if (await b.count()) await tap(b.first()).catch(() => {});
  }
  // The coins the city stands today, named: the shots say what the city really has.
  const named = await page.evaluate(async () => {
    const towers = window.__city?.getState().snapshot.towers ?? (await fetch("/api/city").then((r) => r.json()).then((city) => city.towers).catch(() => []));
    return towers
      .filter((t) => t.verified)
      .sort((a, b) => b.mcap - a.mcap)
      .map((t) => t.symbol.replace(/^\$/, ""));
  });
  const coin = named.find((symbol) => symbol === "JUP") ?? named.find((symbol) => !["SOL", "USDC", "USDT"].includes(symbol)) ?? "SOL";
  const meme = named.find((symbol) => symbol === "BONK") ?? named.find((symbol) => symbol !== coin && !["SOL", "USDC", "USDT"].includes(symbol)) ?? coin;
  await page.waitForTimeout(600);

  await open();
  await shot("empty");

  await say(s.lang === "uk" ? "купити SOL на 50" : "buy SOL for 50");
  await shot("buy");

  await page.keyboard.press("Enter").catch(() => {});
  if (s.mobile) await page.waitForTimeout(400);
  await page.waitForTimeout(4500);
  await shot("buy-window");

  // Ryntra in the window: the quiet spark in its head opens the panel about the window's coin.
  await tap(page.locator(`[role="dialog"][data-window] button[aria-label="${ask}"]`).first());
  await page.waitForTimeout(2500);
  await shot("window-ryntra");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  await open();
  await say(s.lang === "uk" ? `стоп на ${coin} по 0,8` : `stop on ${coin} at 0.8`);
  await shot("stop");
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(4500);
  await shot("stop-window");

  await open();
  await say(s.lang === "uk" ? `продати половину ${meme}` : `sell half ${meme}`);
  await shot("sell");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  await open();
  await say(s.lang === "uk" ? "мій портфель" : "my portfolio");
  await shot("portfolio");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  await open();
  await say(s.lang === "uk" ? `чому ${meme} падає` : `why is ${meme} falling`);
  await shot("question");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${s.name}: coin=${coin} meme=${meme} overflow=${overflow}px errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 200) : ""}`);
  await context.close();
}
await browser.close();
