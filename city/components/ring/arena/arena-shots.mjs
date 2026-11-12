// Ryntra City, the Arena open (CITY-217): the whole way of a person through the Ring window over the live city, on a
// stand — the door, signed out, the first agent made in the Arena's own garage (body, brain, script), its card, a
// sparring fight with the house, a rated fight with a rival the server draws, the rating's move and the board (Market
// Replay is not offered: this machine has no market-data gateway, and the city offers no format it cannot play) — at
// 1440×900 and 390×844, in English and Ukrainian → <out>/<lang>-<size>-<n>-<state>.jpg
//
//   RING_TEST_DATABASE_URL=<local Postgres URL> node lib/ring/testing/stand.mjs 54330        (the database, two migrations)
//   SUPABASE_URL=http://127.0.0.1:54330 SUPABASE_ANON_KEY=stand BETA_APP_SECRET=world-test-secret \
//   RYNTRA_RING_STORE=database RYNTRA_RING_MODELS=stub RYNTRA_RING_STAND=1 \
//   NEXT_PUBLIC_RYNTRA_CITY_RING=open NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS=open npx next dev -p 3217
//   node city/components/ring/arena/arena-shots.mjs [out] [baseUrl]
//
// Nothing is routed or drawn by hand: every answer is the real server's, on the real migrations, with the stand's
// brains (`RYNTRA_RING_MODELS=stub`, never in production) and the stand's account cookie (`RYNTRA_RING_STAND=1`, never
// in production) in place of a wallet's session. A rival is needed for a rated fight: the script makes one first.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-217");
const base = process.argv[3] ?? "http://localhost:3217";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
/** English shows every step; Ukrainian the screens a person stops on. */
const FULL = new Set((process.env.FULL ?? "en").split(","));
const run = Date.now().toString(36);
const T = {
  en: { arena: /^Arena$/, fight: "Fight", agent: "Agent", board: "Rating", connect: "Connect wallet", make: "Make your agent", makeAgent: "Make agent", next: /^Next/, toFight: "To the fight", rated: "Rated", practice: "Practice", again: "Fight again", market: "Market Replay", details: "Details" },
  uk: { arena: /^Арена$/, fight: "Бій", agent: "Агент", board: "Рейтинг", connect: "Підключити гаманець", make: "Створити свого агента", makeAgent: "Створити агента", next: /^Далі/, toFight: "До бою", rated: "На рейтинг", practice: "Тренування", again: "Ще бій", market: "Повтор ринку", details: "Деталі" },
};

/** A rival of the light class for the rated fights, made through the same routes a person's browser uses. */
async function makeRival() {
  const who = `stand-rival-${run}`;
  const headers = { cookie: `ryntra-ring-stand=${who}`, origin: new URL(base).origin, "sec-fetch-site": "same-origin" };
  const mine = await (await fetch(`${base}/api/ring/mine`, { headers })).json();
  const res = await fetch(`${base}/api/ring/create`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "idempotency-key": `rival-${run}` },
    body: JSON.stringify({ quarter: mine.bay.quarter, slot: mine.bay.slot, archetype: "host", model: "openai/gpt-6-luna", scenario: "Talk a lot. Give nothing away." }),
  });
  if (res.status !== 201 && res.status !== 409) throw new Error(`the rival was not made: ${res.status}`);
}

await makeRival();
const browser = await chromium.launch({ ...(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [];

for (const lang of LANGS) {
  const t = T[lang];
  for (const s of SIZES) {
    const full = FULL.has(lang);
    const context = await browser.newContext({ locale: lang === "uk" ? "uk-UA" : "en-US", viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
    await context.addInitScript((l) => window.localStorage.setItem("ryntra.city.lang", l), lang);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|api\/city|api\/world|api\/v1|api\/market|api\/auth|api\/account|ERR_|status of 5\d\d|status of 4\d\d/.test(m.text()) && errors.push(m.text()));
    let n = 0;
    const shot = async (state, always = false) => {
      n += 1;
      if (!full && !always) return;
      // The 3D city keeps the renderer busy on a machine without a GPU: wait for two fresh frames before the shot.
      await page.waitForTimeout(2000);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) problems.push(`${lang} ${s.name} ${state}: the page scrolls sideways by ${wide} px`);
      await page.screenshot({ path: path.join(out, `${lang}-${s.name}-${String(n).padStart(2, "0")}-${state}.jpg`), type: "jpeg", quality: 80 });
    };
    const tab = (name) => page.getByRole("tab", { name, exact: true });
    const button = (name) => page.getByRole("button", { name, exact: typeof name === "string" });
    const primary = () => page.locator("[data-duel-fight]");
    const over = async () => {
      await page.waitForFunction(() => {
        const d = window.__duels.getState();
        return d.duel && d.duel.status !== "live" && d.shown === null;
      }, null, { timeout: 60_000 });
      await page.waitForTimeout(1200);
    };

    await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => !!window.__arena && !!window.__duels, null, { timeout: 300_000 });
    await page.waitForTimeout(8000);
    await page.getByRole("button", { name: /^(Later|Пізніше|Close the Arrivals card|Закрити картку Прибуття)$/ }).click({ timeout: 4000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});

    // 1 · The Arena's door, signed out: the latest fights to watch and one way in — the wallet.
    await page.getByRole("button", { name: t.arena }).click({ timeout: 20_000 });
    await tab(t.fight).waitFor({ timeout: 60_000 });
    await primary().filter({ hasText: t.connect }).waitFor({ timeout: 30_000 });
    await shot("signed-out", true);

    // Signed in: the stand's account cookie stands for the wallet's session.
    await context.addCookies([{ name: "ryntra-ring-stand", value: `stand-${lang}-${s.name}-${run}`, url: base }]);
    await page.evaluate(() => window.__arena.getState().readMine());

    // 2 · The agent tab, empty: one button.
    await tab(t.agent).click();
    await button(t.make).waitFor({ timeout: 20_000 });
    await shot("agent-empty", true);

    // 3–5 · Made right here: body, brain (light class, so a rival of its class is there), script.
    await button(t.make).click();
    await page.locator('[role="radiogroup"] [role="radio"]').nth(1).click();
    await page.locator('[role="radiogroup"]').evaluate((el) => el.parentElement?.scrollTo({ top: 0 }));
    await shot("make-body");
    await page.getByRole("button", { name: t.next }).click();
    await page.getByRole("button", { name: /GPT-6 Luna/ }).click({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await shot("make-brain");
    await page.getByRole("button", { name: t.next }).click();
    await page.locator("textarea").fill(lang === "uk" ? "Тримай свою фразу. Слухай їхню. Вгадуй, коли почув три слова." : "Keep your phrase. Listen for theirs. Guess once you have heard three words.");
    await shot("make-script");
    await button(t.makeAgent).click();

    // 6 · The agent's card.
    await button(t.toFight).waitFor({ timeout: 30_000 });
    await shot("agent", true);

    // 7–8 · Sparring with the house: practice, nothing rated.
    await button(t.toFight).click();
    await page.locator('[data-duel-mode="practice"]').waitFor({ timeout: 20_000 });
    await shot("fight-ready", true);
    await primary().click();
    await over();
    await shot("practice-over");

    // 9 · Rated: the server draws a rival of the class; the result moves the rating.
    await page.locator('[data-duel-mode="rated"]').click();
    await shot("rated-ready");
    await primary().click();
    await over();
    await page.waitForTimeout(1500);
    await shot("rated-over", true);

    // 10 · Details behind one tap.
    await button(t.details).click();
    await shot("details");
    await page.locator("[aria-expanded='true']").filter({ hasText: t.details === "Details" ? "Close" : "Закрити" }).click();

    // 11 · The board.
    await tab(t.board).click();
    await page.locator("[data-board-row]").first().waitFor({ timeout: 20_000 });
    await shot("board", true);

    // Market Replay is offered only where the server has real candles (the market-data gateway); this machine has none.
    await tab(t.fight).click();
    if (await tab(t.market).count()) problems.push(`${lang} ${s.name}: Market Replay is offered without the market-data gateway`);

    if (errors.length) problems.push(`${lang} ${s.name}: ${errors.join(" | ").slice(0, 1500)}`);
    await context.close();
  }
}

await browser.close();
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : `no problems; shots in ${out}`);
