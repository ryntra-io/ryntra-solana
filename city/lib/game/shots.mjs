// The Play layer's screens for review (CITY-81): the city's first screen without the game, Play with its dock, the
// Map and a district flown to, then Escape back to City — at 1440×900 and 390×844 → <out>/<state>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_{ORACLE,HARBOR,AGENTS,EXCHANGE,LAUNCH,VAULT,RUN,RING,HALL}=open npm run dev -- -p 3137,
//   then: node city/lib/game/shots.mjs [out] [baseUrl]
// The figures are fixtures: the city's read is the bundled snapshot served as a live read stamped now. The device
// starts with a kept «Arrivals: on» from before the migration, to show it no longer comes back. No wallet, no keys.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-play-2910");
const base = process.argv[3] ?? "http://localhost:3137";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const ALL = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  // A device that kept «Arrivals» on before CITY-81, and has learned the first-visit hint.
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem("ryntra.city.feed")) localStorage.setItem("ryntra.city.feed", JSON.stringify({ arrivals: true }));
      localStorage.setItem("ryntra.city.firstHint", "1");
    } catch {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = async (state, wait = 900) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(out, `${state}-${size.name}.jpg`), type: "jpeg", quality: 80 });
    const seen = await page.evaluate(() => ({
      layer: document.querySelector("[data-layer]")?.getAttribute("data-layer") ?? null,
      dock: [...document.querySelectorAll("nav button")].map((b) => b.getAttribute("aria-label")),
      soon: /\bsoon\b/i.test(document.body.innerText),
      quarterCard: !!document.querySelector("button[aria-label='Close the Arrivals card']"),
      map: !!document.querySelector("[data-game-map]"),
    }));
    report.push({ size: size.name, state, ...seen });
  };
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));

  await page.goto(`${base}/?quality=low`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.locator("[data-city-feed]").waitFor({ timeout: 180_000 });
  // The skyline's first frame takes a while in a software renderer, longer on a large screen.
  await page.waitForTimeout(50_000);
  await shot("city");

  await page.locator("[data-city-top] button[aria-label='Play']").click();
  await shot("play", 5000);

  await page.locator("nav button[aria-label='Map']").click();
  await shot("map", 4000);
  await page.locator("[data-game-map] button[aria-label='Meme Strip']").click();
  await shot("map-district", 3000);

  if (size.mobile) {
    // On a phone the Map gives the view to the flight: open it again for the Escape below.
    await page.locator("nav button[aria-label='Map']").click();
    await page.waitForTimeout(400);
  }

  // Escape: the Map closes first, then Play returns to City.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await shot("city-again", 5000);

  // Your quarter, from Play: no wallet here, so its card opens on the claim.
  await page.locator("[data-city-top] button[aria-label='Play']").click();
  await page.waitForTimeout(500);
  await page.locator("nav button[aria-label='My quarter']").click();
  await shot("quarter", 4500);
  await page.locator("[data-city-top] button[aria-label='City']").click();
  await page.waitForTimeout(800);

  // A phone's Back: into Play, then Back returns to City, still on the page.
  await page.locator("[data-city-top] button[aria-label='Play']").click();
  await page.waitForTimeout(500);
  await page.goBack();
  await shot("after-back", 4000);
  report.push({ size: size.name, url: page.url() });

  if (errors.length) report.push({ size: size.name, errors });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
