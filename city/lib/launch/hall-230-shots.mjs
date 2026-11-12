// CITY-230 for review: the Hall of Fame without empty signs — a quiet week reaching back over 30 days and all time,
// and a Hall nobody is on, whose signs and panel are one action, «Launch yours». The plaza's two billboard towers, the
// panel a tap on a sign opens, the details behind the «i», and a tap on an empty sign opening the launch sheet — at
// 1440×900 and 390×844, in English and Ukrainian → <out>/<state>-<desk|phone>-<en|uk>.jpg
//   node city/lib/launch/hall-230-shots.mjs [out] [baseUrl]
//   (NEXT_PUBLIC_RYNTRA_CITY_HALL=open npm run dev running; PRESS_CHROME may point at a Chromium)
// Every state runs on the development stand-ins (`?hall=stub|month|all|empty`, `?launch=stub`): made-up coins, every
// screen saying «Stub data». The camera stands on the plaza through the development hook `window.__cityView`.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-230");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  /* The plaza from in front, the two billboard towers filling the frame; a phone stands further back to fit both. */
  { name: "desk", width: 1440, height: 900, mobile: false, eye: [0, 60, 66], target: [0, 59, 5] },
  { name: "phone", width: 390, height: 844, mobile: true, eye: [0, 52, 132], target: [0, 58, 5] },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = process.env.LANGS ? process.env.LANGS.split(",") : ["en", "uk"];
const WORDS = {
  en: { hall: "Hall of Fame", details: "Details", creators: "Creators", later: /^(Later|Close the Arrivals card)$/ },
  uk: { hall: "Зала слави", details: "Деталі", creators: "Творці", later: /^(Пізніше|Закрити картку «Новосілля»)$/ },
};
/** The biggest ×'s sign in the world (`HallSigns.tsx`): the left tower's top. */
const CATCH_SIGN = [-13, 65, 5.5];

const executablePath = process.env.PRESS_CHROME || undefined;
// Behind an outbound proxy (a cloud session), the browser takes it too, so the page's fonts and pictures arrive.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ executablePath, proxy, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-unsafe-swiftshader"] });
const problems = [];

for (const s of SIZES) {
  for (const lang of LANGS) {
    const w = WORDS[lang];
    const session = async (hall) => {
      const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2, isMobile: s.mobile, hasTouch: s.mobile });
      // The first-visit hint has been seen: it would stand over the signs.
      await context.addInitScript(() => localStorage.setItem("ryntra.city.firstHint", "1"));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU stall|city read failed|env not configured/.test(m.text()) && errors.push(m.text()));
      await page.goto(`${base}/?hall=${hall}&launch=stub&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForFunction(() => window.__city?.getState().layout.towers.length > 0 && window.__cityView && window.__hall, null, { timeout: 180_000 });
      await page.waitForTimeout(5000);
      // The market holds still for the shots: its refresh would rebuild the city and send the camera home mid-shot.
      await page.evaluate(() => window.__city.setState({ setSnapshot: () => {} }));
      await page.getByRole("button", { name: w.later }).click({ timeout: 5_000 }).catch(() => {});
      await page.evaluate(() => window.__city.getState().enter());
      // The flight home after entering ends first; then the camera stands where the shot asks.
      await page.waitForTimeout(5000);
      await page.evaluate(([eye, target]) => window.__cityView(eye, target), [s.eye, s.target]);
      await page.waitForTimeout(1000);
      await page.evaluate(([eye, target]) => window.__cityView(eye, target), [s.eye, s.target]);
      await page.waitForTimeout(3000);
      // The market's refresh rebuilds the city and sends the camera home: before each shot it stands on the plaza again.
      const shot = async (state) => {
        await page.evaluate(([eye, target]) => window.__cityView(eye, target), [s.eye, s.target]);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(out, `${state}-${s.name}-${lang}.jpg`), type: "jpeg", quality: 82, timeout: 240_000 });
      };
      /** A tap where the biggest ×'s sign stands on the screen — a finger on a phone, the mouse on a desk. */
      const tapSign = async () => {
        const at = await page.evaluate((point) => {
          const camera = window.__camera;
          const p = camera.position.clone().set(...point).project(camera);
          const rect = document.querySelector("canvas").getBoundingClientRect();
          return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
        }, CATCH_SIGN);
        if (s.mobile) await page.touchscreen.tap(at.x, at.y);
        else await page.mouse.click(at.x, at.y);
        return at;
      };
      const panel = () => page.getByRole("dialog", { name: w.hall }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
      const done = async () => {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 0) problems.push(`${s.name} ${lang} ${hall}: the page scrolls sideways by ${overflow}px`);
        if (errors.length) problems.push(`${s.name} ${lang} ${hall}: ${errors.join(" | ")}`);
        await context.close();
      };
      return { page, shot, tapSign, panel, done };
    };

    // A full week: every sign says «This week».
    const week = await session("stub");
    await week.shot("plaza-week");
    await week.done();

    // A quiet week reaching back over 30 days: the biggest × and the hunters say «This month», the creators — whose
    // engine counts no 30 days — «All time». A tap on the sign opens the panel on its board, the span beside the title;
    // the details behind the «i» give the dates.
    const month = await session("month");
    await month.shot("plaza-month");
    await month.tapSign();
    if (!(await month.panel())) problems.push(`${s.name} ${lang}: a tap on a live sign did not open the panel`);
    await month.page.waitForTimeout(700);
    await month.shot("panel-month");
    await month.page.getByRole("tab", { name: w.creators }).click();
    await month.page.waitForTimeout(300);
    await month.page.getByRole("button", { name: w.details }).click();
    await month.page.waitForTimeout(500);
    await month.shot("details-month");
    await month.done();

    // A quiet month reaching back over all time.
    const all = await session("all");
    await all.shot("plaza-all");
    await all.tapSign();
    await all.panel();
    await all.page.waitForTimeout(700);
    await all.shot("panel-all");
    await all.done();

    // Nobody on the boards even over all time: each sign and the panel are one action, «Launch yours».
    const empty = await session("empty");
    await empty.shot("plaza-empty");
    await empty.page.evaluate(() => window.__hall.getState().show("catch"));
    await empty.panel();
    await empty.page.waitForTimeout(700);
    await empty.shot("panel-empty");
    await empty.page.evaluate(() => window.__hall.getState().close());
    await empty.page.waitForTimeout(500);
    // A tap on the empty sign itself opens the launch sheet from the city.
    const at = await empty.tapSign();
    const opened = await empty.page.locator("[data-launch-sheet]").waitFor({ timeout: 20_000 }).then(() => true, () => false);
    await empty.page.waitForTimeout(1200);
    if (!opened) problems.push(`${s.name} ${lang}: a tap on the empty sign at ${Math.round(at.x)},${Math.round(at.y)} did not open the launch sheet`);
    await empty.shot("tap-empty");
    await empty.done();
  }
}

await browser.close();
console.log(problems.length ? `hall 230 shots → ${out}\n${problems.join("\n")}` : `hall 230 shots → ${out}`);
