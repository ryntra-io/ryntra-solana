// The Hall of Fame for review: the billboards on the plaza, the panel on each board, an empty week, and the
// Hall as the real route answers it, at 1440×900 and 390×844 → <out>/hall-<state>-<size>.png
//   node city/lib/launch/hall-shots.mjs [out] [baseUrl]
//   (NEXT_PUBLIC_RYNTRA_CITY_HALL=open npm run dev running; PRESS_CHROME may point at a Chromium)
// The boards with rows run on the development stand-in (`?hall=stub`, made-up coins, every screen saying «Stub data»);
// `?hall=empty` is a Hall nobody is on (CITY-230: its signs and panel are «Launch yours»; `hall-230-shots.mjs` shoots the
// spans and the action); the last state reads the real `/api/city/hall` of the stand.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/hall-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const executablePath = process.env.PRESS_CHROME || undefined;
const browser = await chromium.launch({ executablePath, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const problems = [];

for (const s of SIZES) {
  // Each scene on a page of its own: a headless canvas reloaded again and again can lose its WebGL context.
  const session = async (query) => {
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${base}/${query}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.__city?.getState().layout.towers.length > 0, null, { timeout: 120_000 });
    await page.waitForTimeout(5000);
    // A newcomer's first card would cover the dock: «Later» puts it away.
    await page.getByRole("button", { name: /^(Later|Close the Arrivals card)$/ }).click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const shot = (state) => page.screenshot({ path: path.join(out, `hall-${state}-${s.name}.png`) });
    const open = async () => {
      await page.getByRole("button", { name: "Hall of Fame" }).click();
      await page.getByRole("dialog", { name: "Hall of Fame" }).waitFor();
      await page.waitForTimeout(700);
    };
    const done = async () => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) problems.push(`${s.name} ${query}: the page scrolls sideways by ${overflow}px`);
      if (errors.length) problems.push(`${s.name} ${query}: ${errors.join(" | ")}`);
      await context.close();
    };
    return { page, shot, open, done };
  };

  // The billboards on the plaza, from the establishing shot; then the panel, each board as a table, and the details
  // behind the «i» once. A board without a public source (scouts) has no tab.
  const stub = await session("?hall=stub");
  await stub.shot("plaza");
  await stub.open();
  await stub.shot("catch");
  for (const [tab, state] of [["Hunters", "hunters"], ["Creators", "creators"]]) {
    await stub.page.getByRole("tab", { name: tab }).click();
    await stub.page.waitForTimeout(400);
    await stub.shot(state);
  }
  await stub.page.getByRole("button", { name: "Details" }).click();
  await stub.page.waitForTimeout(300);
  await stub.shot("details");
  await stub.done();

  // Nobody on the boards even over all time: one action, «Launch yours» — never a figure.
  const empty = await session("?hall=empty");
  await empty.open();
  await empty.shot("empty");
  await empty.done();

  // The Hall as the stand's own route answers it — the engine and the honest count, nothing stood in. The first read
  // of a cold stand works the week out first: give it a minute.
  const live = await session("");
  const shown = await live.page.getByRole("button", { name: "Hall of Fame" }).waitFor({ timeout: 60_000 }).then(() => true, () => false);
  if (shown) {
    await live.shot("live-plaza");
    await live.open();
    await live.shot("live");
  } else {
    problems.push(`${s.name}: the real route showed no Hall (switch closed, or the engine not served here)`);
    await live.shot("live-closed");
  }
  await live.done();
}

await browser.close();
console.log(problems.length ? `hall shots → ${out}\n${problems.join("\n")}` : `hall shots → ${out}`);
