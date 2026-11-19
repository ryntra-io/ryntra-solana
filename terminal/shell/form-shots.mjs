// The terminal's one form for the eyes: every screen on a desk 1440×900 and 1920×1080 and on a phone
// 390×844, in English and Ukrainian — and the corner of every visible box, measured.
//
//   node terminal/shell/form-shots.mjs <outDir> [base]        base defaults to http://localhost:3182
//
// A stand runs as people will get it (next build + next start with the production switches). Public pages only: no
// wallet is connected, nothing is signed. Every screen says its corners in one line — «кути на екрані: 0, 4, коло» and
// how many boxes carry the cut (../styles/corners.mjs). The report (`form.json`) names every box that is neither square, the
// control's 4 px, a circle nor the brand's cut, every phone panel marked `edge` that does not run from edge to edge, and every part
// a phone cuts off at its side; the run fails on any of them.
//   ONLY=home,coin,rail,fold — a few screens or checks;  SIZES=desk,wide,phone;  LANGS=uk,en
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { addTally, corners } from "../styles/corners.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-282");
const base = process.argv[3] ?? "http://localhost:3182";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SCREENS = [
  ["home", "/"],
  ["coin", "/c/So11111111111111111111111111111111111111112"],
  ["swap", "/swap"],
  ["earn", "/earn"],
  ["agents", "/agent"],
  ["launch", "/launch"],
  ["portfolio", "/portfolio"],
];
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name) => (process.env[name] ?? "").split(",").filter(Boolean);
const only = list("ONLY");
const sizes = list("SIZES");
const langs = list("LANGS").length ? list("LANGS") : ["uk", "en"];

/** Runs in the page: the shape of every visible framed or filled box, and what a phone gets wrong at its sides. */
function measure(mobile) {
  const boxes = [];
  const clear = /rgba\(0, 0, 0, 0\)|transparent/;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 14 || r.height < 14) continue;
    if (r.bottom < 0 || r.top > innerHeight * 4 || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    if (el.tagName === "HTML" || el.tagName === "BODY" || el.closest("svg")) continue;
    const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && !clear.test(cs[`border${s}Color`]));
    const framed = sides.length >= 3;
    const filled = !clear.test(cs.backgroundColor) || cs.backgroundImage !== "none";
    const cls = String(el.className?.baseVal ?? el.className ?? "").split(" ")[0].replace(/__[A-Za-z0-9_-]{4,}$/, "").slice(0, 36);
    const corners = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((c) => parseFloat(cs[`border${c}Radius`]) || 0);
    const px = Math.max(...corners);
    const half = Math.min(r.width, r.height) / 2;
    const cut = cs.clipPath && cs.clipPath !== "none" && !/^inset/.test(cs.clipPath);
    const round = px >= half - 0.5;
    const shape = cut ? "cut" : px === 0 ? "square" : round ? "pill" : `r${Math.round(px)}`;
    const box = { shape, cls, tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top + scrollY), text: (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 28) };
    // A round box is a circle (a logo, a dot, a knob) or the switch's track — never a wide pill.
    if (shape === "pill" && (framed || filled) && r.width > r.height * 2.2) box.wrong = "a pill";
    if (shape !== "pill" && shape !== "cut" && shape !== "square" && shape !== "r4" && (framed || filled || el.tagName === "IMG")) box.wrong = "a corner of its own";
    // A panel that says it is the width of its screen (`Panel edge`) reaches both edges of a phone — unless it stands in a sheet.
    if (mobile && /ui_edge/.test(String(el.className)) && !el.closest("[class*='split_side']") && (Math.abs(r.left) > 0.5 || Math.abs(r.right - innerWidth) > 0.5)) box.wrong = "a phone panel off the edges";
    if (framed || filled || box.wrong) boxes.push(box);
  }
  const wide = mobile ? Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth : 0;
  return { boxes, sideways: wide > 1 ? wide : 0 };
}

const report = {};
const wrong = [];
const seen = {};
for (const size of SIZES) {
  if (sizes.length && !sizes.includes(size.name)) continue;
  for (const lang of langs) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
      userAgent: size.mobile ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" : undefined,
    });
    const page = await context.newPage();
    for (const [name, where] of SCREENS) {
      if (only.length && !only.includes(name)) continue;
      const tag = `${name}-${size.name}-${lang}`;
      try {
        await page.goto(`${base}${where}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector("[data-terminal='rail'], [data-terminal='tabs']", { state: "attached", timeout: 60_000 }).catch(() => {});
        await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(4500);
        await page.screenshot({ path: path.join(out, `${tag}.jpg`), type: "jpeg", quality: 78 });
        if (process.env.FULL) await page.screenshot({ path: path.join(out, `${tag}-full.jpg`), type: "jpeg", quality: 70, fullPage: true });
        const { boxes, sideways } = await page.evaluate(measure, size.mobile);
        const tally = {};
        for (const b of boxes) tally[b.shape] = (tally[b.shape] ?? 0) + 1;
        const bad = boxes.filter((b) => b.wrong);
        if (sideways) bad.push({ wrong: `the page scrolls sideways by ${sideways}px`, cls: "page" });
        addTally(seen, tally);
        report[tag] = { url: page.url(), corners: corners(tally).line, tally, rail: await page.evaluate(() => Math.round(document.querySelector("[data-terminal='rail']")?.getBoundingClientRect().width ?? 0)), wrong: bad };
        for (const b of bad) wrong.push(`${tag}: ${b.wrong} — ${b.cls} ${b.shape ?? ""} ${b.w ?? ""}×${b.h ?? ""} «${b.text ?? ""}»`);
        console.log(tag, corners(tally).line, JSON.stringify(tally), bad.length ? `WRONG ${bad.length}` : "");
      } catch (error) {
        report[tag] = { error: String(error).slice(0, 300) };
        wrong.push(`${tag}: ${String(error).slice(0, 160)}`);
        console.log(tag, "ERROR", String(error).slice(0, 200));
      }
    }
    await context.close();
  }
}
/* The rail: by its names on a desk; the person folds it, the browser remembers through a reload; a desk under 1360 px
   folds it itself and offers no button; no «Pro» switch stands anywhere. */
if (!only.length || only.includes("rail")) {
  const railWidth = (page) => page.evaluate(() => Math.round(document.querySelector("[data-terminal='rail']")?.getBoundingClientRect().width ?? 0));
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "uk-UA" });
  const page = await context.newPage();
  const rail = {};
  try {
    await page.goto(`${base}/swap?lang=uk`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const fold = page.locator("[data-terminal='rail-fold']");
    await fold.waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(3000);
    rail.open = await railWidth(page);
    rail.names = await page.locator("[data-terminal='rail'] a[aria-current='page']").innerText();
    rail.noSwitch = (await page.locator("[data-terminal='pro']").count()) === 0 && !(await page.evaluate(() => document.documentElement.hasAttribute("data-pro")));
    await fold.click();
    await page.waitForTimeout(400);
    rail.folded = await railWidth(page);
    await page.screenshot({ path: path.join(out, "rail-folded-wide-uk.jpg"), type: "jpeg", quality: 78 });
    await page.reload({ waitUntil: "domcontentloaded" });
    rail.afterReloadFirstPaint = await railWidth(page);
    await fold.waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(3000);
    rail.afterReload = await railWidth(page);
    await fold.click();
    await page.waitForTimeout(400);
    rail.unfolded = await railWidth(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    rail.at1440 = await railWidth(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    rail.at1280 = await railWidth(page);
    rail.buttonAt1280 = await fold.isVisible();
    await page.screenshot({ path: path.join(out, "rail-1280-uk.jpg"), type: "jpeg", quality: 78 });
  } catch (error) {
    rail.error = String(error).slice(0, 300);
  }
  await context.close();
  report.rail = rail;
  console.log("rail", JSON.stringify(rail));
  const ok = rail.open === 228 && rail.folded === 72 && rail.afterReloadFirstPaint === 72 && rail.afterReload === 72 && rail.unfolded === 228 && rail.at1440 === 228 && rail.at1280 === 72 && rail.buttonAt1280 === false && rail.noSwitch === true;
  if (!ok) wrong.push(`rail: ${JSON.stringify(rail)}`);
}

/* The home page: the agent's line is short, so the market stands above the fold — five rows and more on a desk; one
   field for the agent on the screen; «Columns» starts with the main set at 1440 and with all from 1680, a press
   changes it and the browser remembers. */
if (!only.length || only.includes("fold")) {
  const fold = {};
  for (const size of SIZES.filter((s) => !s.mobile)) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, locale: "uk-UA" });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/?lang=uk`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector("[data-terminal='depth'] [role='table'] [role='row'] a", { timeout: 60_000 });
      await page.waitForTimeout(2500);
      const seen = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("[data-terminal='depth'] [role='table'] [role='row']")].filter((row) => row.querySelector("a"));
        const fields = [...document.querySelectorAll("header input, [data-terminal='hero'] input")].filter((el) => el.offsetParent !== null);
        const chosen = document.querySelector("[data-terminal='columns'] [aria-checked='true']");
        return { rows: rows.filter((row) => row.getBoundingClientRect().bottom <= innerHeight).length, of: rows.length, fields: fields.length, columns: chosen?.textContent ?? null, heads: [...document.querySelectorAll("[data-terminal='depth'] [role='table'] [role='row']:first-child > *")].map((el) => el.textContent.trim()).join(" · ") };
      });
      fold[size.name] = seen;
      if (size.name === "desk") {
        // A press on «All» changes the table's columns (at this width it trades some for the trader's ones), and the choice is there after a reload.
        await page.locator("[data-terminal='columns'] [role='radio']").nth(1).click();
        await page.waitForTimeout(400);
        const more = await page.evaluate(() => [...document.querySelectorAll("[data-terminal='depth'] [role='table'] [role='row']:first-child > *")].map((el) => el.textContent.trim()).join(" · "));
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("[data-terminal='depth'] [role='table'] [role='row'] a", { timeout: 60_000 });
        await page.waitForTimeout(1500);
        const kept = await page.evaluate(() => document.querySelector("[data-terminal='columns'] [aria-checked='true']")?.textContent ?? null);
        fold.columns = { main: seen.heads, all: more, kept };
        await page.screenshot({ path: path.join(out, "home-desk-uk-all-columns.jpg"), type: "jpeg", quality: 78 });
      }
    } catch (error) {
      fold[size.name] = { error: String(error).slice(0, 300) };
    }
    await context.close();
  }
  report.fold = fold;
  console.log("fold", JSON.stringify(fold));
  const ok =
    fold.desk?.rows >= 5 && fold.wide?.rows >= 5 && fold.desk?.fields === 1 && fold.wide?.fields === 1 && fold.desk?.columns === "Основні" && fold.wide?.columns === "Усі" && Boolean(fold.columns?.all) && fold.columns?.all !== fold.columns?.main && fold.columns?.kept === "Усі";
  if (!ok) wrong.push(`fold: ${JSON.stringify(fold)}`);
}

await browser.close();
report.corners = corners(seen, "на всіх екранах").line;
console.log(`\n${report.corners}`);
writeFileSync(path.join(out, "form.json"), JSON.stringify(report, null, 1));
if (wrong.length) {
  console.error(`\n${wrong.length} wrong:\n${wrong.join("\n")}`);
  process.exit(1);
}
console.log("\nOne form on every screen.");
