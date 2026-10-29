// Ryntra City's frames (CITY-64): the first second of `/` (the intro still instead of black, then the live city), the
// home with Home's frame on its card, the Market's card, each district that opens soon, and «How the city works» with
// its rules opened, at 1440×900 and 390×844 → <out>/art-<state>-<size>.png; with REDUCED=1 the same with reduced motion.
//   npm run dev   (or a production build: npm run build && npm start)
//   node city/components/art/art-shots.mjs [out] [baseUrl]      (PRESS_CHROME may point at a Chromium)
// It presses only what changes nothing on a server: «Later» (a local dismiss), a district that opens soon, the menu and
// «How the city works».
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/art-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const reduced = process.env.REDUCED === "1";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
/** The first second, frame by frame from the navigation's start. */
const FIRST = [250, 500, 1000];

const linux = process.platform === "linux";
const chrome = process.env.PRESS_CHROME || (linux ? undefined : "C:/Program Files/Google/Chrome/Application/chrome.exe");
const browser = await chromium.launch({
  executablePath: chrome,
  args: linux ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const problems = [];
/** Every picture of the selector on the screen has arrived. */
const pictures = (page, selector) =>
  page
    .waitForFunction(
      (sel) => [...document.querySelectorAll(sel)].filter((i) => i.getBoundingClientRect().top < innerHeight).every((i) => i.complete && i.naturalWidth > 0),
      selector,
      { timeout: 30_000 },
    )
    .catch(() => problems.push(`a picture did not arrive: ${selector}`));

for (const s of SIZES) {
  const context = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: s.mobile ? 2 : 1,
    isMobile: s.mobile,
    hasTouch: s.mobile,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|api\/city|api\/world/.test(m.text()) && errors.push(m.text()));
  const tag = reduced ? "-reduced" : "";
  // A capture in the first frames of a page can be refused while it paints: a few tries, a frame apart.
  const shot = async (state) => {
    for (let n = 0; ; n++) {
      try {
        return await page.screenshot({ path: path.join(out, `art-${state}${tag}-${s.name}.png`) });
      } catch (e) {
        if (n === 9) throw e;
        await page.waitForTimeout(40);
      }
    }
  };

  // The first second: the still is there from the first paint, under the HUD.
  const t0 = Date.now();
  await page.goto(base, { waitUntil: "commit" });
  let intro = "none";
  for (const at of FIRST) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
    if (at === FIRST[0]) intro = await page.evaluate(() => document.querySelector("[data-city-intro]")?.getAttribute("data-city-intro") ?? "none").catch(() => "none");
    await shot(`first-${String(at).padStart(4, "0")}ms`);
  }
  // On a fast machine the city is drawn within the first second and the intro is already fading by its end.
  if (intro !== "still") problems.push(`${s.name}: the intro is «${intro}» at ${FIRST[0]} ms`);

  // The live city in its place: the intro has left the page.
  const left = await page.waitForFunction(() => !document.querySelector("[data-city-intro]"), null, { timeout: 120_000 }).then(() => true, () => false);
  if (!left) problems.push(`${s.name}: the intro never left`);
  await page.waitForTimeout(1500);

  // The card above the dock: Home's claim for a newcomer, or the hot tower where the world is not reached.
  await page.getByRole("button", { name: /^(Claim your quarter|Fly to )/ }).first().waitFor({ timeout: 30_000 }).catch(() => problems.push(`${s.name}: no card above the dock`));
  await pictures(page, "[data-city-art] img");
  await page.waitForTimeout(1200);
  await shot("home");

  // «Later» shows the Market's card: the hot tower.
  const later = page.getByRole("button", { name: /^(Later|Close the Arrivals card)$/ });
  if (await later.isVisible().catch(() => false)) {
    await later.click();
    await pictures(page, "[data-city-art] img");
    await page.waitForTimeout(1200);
  }
  await shot("card-market");

  // The districts that open soon, each with its frame.
  for (const [label, state] of [
    ["Launch, opens soon", "card-launch"],
    ["Harbor, opens soon", "card-harbor"],
    ["Agents, opens soon", "card-agents"],
  ]) {
    const button = page.getByRole("button", { name: label });
    if (!(await button.isVisible().catch(() => false))) {
      problems.push(`${s.name}: «${label}» is not in the dock (the district may be open here)`);
      continue;
    }
    await button.click();
    await pictures(page, "[data-city-art] img");
    await page.waitForTimeout(1000);
    await shot(state);
    // A second press closes it.
    await button.click();
    await page.waitForTimeout(500);
  }

  // «How the city works»: the window, then scrolled through to its end.
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "How the city works" }).click();
  const how = page.getByRole("dialog", { name: "How the city works" });
  await how.waitFor({ timeout: 10_000 });
  await pictures(page, "[data-city-how] img");
  await page.waitForTimeout(1000);
  await shot("how-1");
  const pages = await page.evaluate(() => {
    const box = document.querySelector("[data-city-how]");
    return box ? Math.ceil(box.scrollHeight / box.clientHeight) : 1;
  });
  for (let n = 2; n <= Math.min(pages, 8); n++) {
    await page.evaluate((k) => {
      const box = document.querySelector("[data-city-how]");
      box.scrollTo({ top: box.clientHeight * 0.88 * (k - 1), behavior: "instant" });
    }, n);
    await pictures(page, "[data-city-how] img");
    await page.waitForTimeout(900);
    await shot(`how-${n}`);
  }
  // The rules, a tap away at the end.
  await page.getByRole("button", { name: "The rules of the city" }).click();
  await page.evaluate(() => {
    const box = document.querySelector("[data-city-how]");
    box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
  });
  await page.waitForTimeout(800);
  await shot("how-rules");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  if (await how.isVisible().catch(() => false)) problems.push(`${s.name}: Escape did not close «How the city works»`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push(`${s.name}: ${overflow}px sideways overflow`);
  if (errors.length) problems.push(`${s.name}: ${errors[0].slice(0, 200)}`);
  console.log(`${s.name}: intro=${intro} left=${left} overflow=${overflow}px errors=${errors.length}`);
  await context.close();
}
await browser.close();
if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
