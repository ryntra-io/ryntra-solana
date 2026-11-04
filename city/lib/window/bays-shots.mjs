// CITY-84 review shots → docs/shots/city-84/: the bays, the tray, the tabs and the layouts, on a desk (1440) and a
// phone (390), with the deployment's own switches (no wallet: the honest no-wallet states). Against a running build:
//   npx next build && npx next start -p 3200   (with the stand's file store)
//   node city/lib/window/bays-shots.mjs docs/shots/city-84 http://localhost:3200 [desk|phone|all]
// `?quality=low` keeps a software GPU drawing; CHROME may point at a Chromium. Presses only the city's own buttons and
// signs nothing.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";
const out = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3200";
const only = process.argv[4] ?? "all";
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
async function open(size) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${size.name}: ${String(e).slice(0, 300)}`));
  await page.addInitScript(() => localStorage.setItem("ryntra.city.firstHint", "1"));
  await page.goto(`${base}/?quality=low`, { waitUntil: "load", timeout: 240000 });
  await page.locator("canvas").first().waitFor({ state: "attached", timeout: 240000 });
  await page.waitForTimeout(25000);
  return { ctx, page };
}
const frames = (page, n) => page.evaluate((n) => new Promise((resolve) => { let i = 0; const f = () => (++i >= n ? resolve() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (page, name) => {
  const t = Date.now();
  await frames(page, 4);
  await page.waitForTimeout(2500);
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 84 });
  writeFileSync(path.join(out, `${name}.jpg`), Buffer.from(data, "base64"));
  await cdp.detach();
  console.log("shot", name, Date.now() - t, "ms");
};
const tap = async (page, selector) => {
  const b = await page.locator(selector).first().boundingBox({ timeout: 60000 });
  if (!b) throw new Error(`no box: ${selector}`);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};
const touch = async (page, selector) => {
  const b = await page.locator(selector).first().boundingBox({ timeout: 60000 });
  if (!b) throw new Error(`no box: ${selector}`);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};
const state = (page) => page.evaluate(() => [...document.querySelectorAll("[data-window]:not([class*=layer])")].map((n) => `${n.getAttribute("data-window")}:${n.getAttribute("data-window-bay") ?? "-"}:${n.hasAttribute("data-window-folded") ? "folded" : n.getAttribute("aria-hidden") ? "tab" : "shown"}`).join(" "));

if (only === "all" || only === "desk") {
  const desk = { name: "desk", width: 1440, height: 900, mobile: false };
  const { ctx, page } = await open(desk);
  await tap(page, "[data-window-desks] button[aria-expanded]");
  await page.waitForTimeout(800);
  await shot(page, "desk-1440-layouts");
  await tap(page, '[data-desk="trader"]');
  await page.locator('[data-window="spot"]').waitFor({ timeout: 120000 });
  await page.locator('[data-window="money"]').waitFor({ timeout: 120000 });
  await page.waitForTimeout(8000);
  console.log("trader:", await state(page), "| dim:", await page.evaluate(() => Boolean(document.querySelector("[data-city-dim]"))), "| dpr:", await page.evaluate(() => document.documentElement.dataset.cityDpr));
  await shot(page, "desk-1440-trader");
  // Money dragged by its head onto the trade card's head: the head lights up; let go there it becomes a tab.
  const from = await page.locator('[data-window="money"] h2').boundingBox();
  const to = await page.locator('[data-window="spot"] h2').boundingBox();
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i += 1) await page.mouse.move(from.x + 20 + ((to.x + 40 - from.x - 20) * i) / 14, from.y + from.height / 2 + ((to.y - from.y) * i) / 14);
  await page.waitForTimeout(1500);
  await shot(page, "desk-1440-landing");
  await page.mouse.up();
  await page.waitForTimeout(3000);
  console.log("tabs:", await state(page));
  await shot(page, "desk-1440-tabs");
  await tap(page, '[data-window]:not([aria-hidden]) button[aria-label="Minimise"]');
  await page.waitForTimeout(3000);
  console.log("tray:", await state(page));
  await shot(page, "desk-1440-tray");
  await ctx.close();
}
if (only === "all" || only === "phone") {
  const phone = { name: "phone", width: 390, height: 844, mobile: true };
  const { ctx, page } = await open(phone);
  await touch(page, '[data-deck-place="spot"]');
  await page.waitForTimeout(1200);
  await touch(page, '[data-deck-door="swap"]');
  await page.locator('[data-window] button[aria-label="Minimise"]').first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(8000);
  await shot(page, "phone-390-sheet");
  await touch(page, '[data-window] button[aria-label="Minimise"]');
  await page.waitForTimeout(3000);
  await shot(page, "phone-390-tray");
  await ctx.close();
}
console.log(errors.join("\n") || "no page errors");
await browser.close();
