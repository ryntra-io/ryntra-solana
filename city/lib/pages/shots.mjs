// The city's pages for review (CITY-157): the menu (☰), each page as a window over the city and as a page of its own at
// its address, on a desk (1440×900) and a phone (390×844), English and Ukrainian → <out>/<name>.jpg
//   npm run dev      then      node city/lib/pages/shots.mjs [out] [baseUrl]
// Help's form is sent against a stubbed inbox (`/api/feedback` answers with a fixture reference): nothing reaches the
// real inbox from here.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-157");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const want = (name) => !ONLY || ONLY.has(name);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];

async function context(size, lang) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
  await ctx.addInitScript((lang) => {
    try {
      window.localStorage.setItem("ryntra.city.lang", lang);
    } catch {}
  }, lang);
  await ctx.route("**/api/feedback", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ref: "RYN-FB-0A1B2C3D" }) }));
  await ctx.route("**/api/icon/*", (route) => route.fulfill({ status: 204 }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${size.name} ${lang}: ${e}`));
  return { ctx, page };
}

/** Two drawn frames: what a tap changed (a section open, its chevron turned) is on screen before the picture. */
const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))).catch(() => {});

const shot = async (page, name) => {
  await frames(page);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 82 });
  console.log("shot", name);
};

/** The images on screen are drawn, so no still is caught half-loaded. */
const settle = (page, ms = 1500) =>
  page
    .waitForFunction(() => [...document.images].filter((img) => img.getBoundingClientRect().height > 0).every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 60_000 })
    .catch(() => {})
    .then(() => page.waitForTimeout(ms));

async function city(size, lang) {
  const { ctx, page } = await context(size, lang);
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForFunction(() => typeof window.__pages?.getState === "function" && (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 480_000 });
  await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const later = page.getByRole("button", { name: /^(Later|Пізніше|Got it|Зрозуміло)$/ });
  // The first visit's hint steps aside, as a visitor sends it; one that will not settle is clicked through.
  if (await later.first().isVisible().catch(() => false)) await later.first().click({ timeout: 10_000, force: true }).catch(() => {});
  return { ctx, page };
}

const menuButton = (page) => page.locator("[data-city-menu] > button").first();

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const tag = `${lang}-${size.name}`;
    if (want(`city-${tag}`)) {
      const { ctx, page } = await city(size, lang);
      // The menu: the four doors and the two documents open windows of the city.
      await menuButton(page).click();
      await page.waitForTimeout(800);
      await shot(page, `menu-${tag}`);
      const all = lang === "en" ? ["help", "docs", "developers", "about", "terms", "privacy"] : ["help", "terms"];
      // IDS=terms,privacy: only those windows (a second pass over a few).
      const ids = process.env.IDS ? all.filter((id) => process.env.IDS.split(",").includes(id)) : all;
      for (const id of ids) {
        await page.evaluate(() => window.__pages.getState().closeAll());
        await page.waitForTimeout(400);
        if (!(await page.locator("#city-menu").isVisible().catch(() => false))) await menuButton(page).click();
        const label = { help: /^(Help|Допомога)$/, docs: /^(Docs|Документація)$/, developers: /^(Developers|Розробникам)$/, about: /^(About|Про Ryntra)$/, terms: /^(Terms|Умови)$/, privacy: /^(Privacy|Приватність)$/ }[id];
        await page.locator("#city-menu").getByRole("button", { name: label }).click();
        await page.locator(`[data-city-page="${id}"]`).waitFor({ timeout: 120_000 });
        await settle(page, 2500);
        if (id === "terms" || id === "privacy") {
          // One section open, as a reader opens it.
          await page.locator(`[data-city-page="${id}"] details`).nth(id === "terms" ? 5 : 1).locator("summary").click();
          await page.waitForTimeout(600);
        }
        await shot(page, `window-${id}-${tag}`);
      }
      if (lang === "en" && !process.env.IDS) {
        // Help sent: the inbox's reference.
        await page.evaluate(() => window.__pages.getState().closeAll());
        await page.evaluate(() => window.__pages.getState().show("help"));
        const form = page.locator('[data-city-page="help"]');
        await form.locator("textarea").waitFor({ timeout: 60_000 });
        await form.getByRole("radio", { name: "Problem" }).click();
        await form.locator("textarea").fill("The swap sheet froze after I signed. Wallet 4EeX…GKPW, transaction link attached.");
        await page.waitForTimeout(300);
        await shot(page, `window-help-filled-${tag}`);
        await form.getByRole("button", { name: "Send" }).click();
        await form.getByText("RYN-FB-0A1B2C3D").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(500);
        await shot(page, `window-help-sent-${tag}`);
      }
      await ctx.close();
    }
    // The same pages at their own addresses.
    const pages = lang === "en" ? ["/support", "/docs", "/developers", "/about", "/legal/terms", "/legal/privacy#android"] : ["/support", "/legal/terms#launch", "/legal/privacy#android"];
    if (want(`pages-${tag}`)) {
      const { ctx, page } = await context(size, lang);
      for (const address of pages) {
        await page.goto(`${base}${address}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
        await page.locator("[data-city-doc]").waitFor({ timeout: 120_000 });
        await settle(page, address.includes("#") ? 2500 : 1500);
        const name = address.replace(/^\//, "").replace(/[/#]/g, "-");
        await shot(page, `page-${name}-${tag}`);
      }
      await ctx.close();
    }
  }
}

await browser.close();
if (errors.length) {
  console.log("page errors:\n" + errors.join("\n"));
  process.exitCode = 1;
}
