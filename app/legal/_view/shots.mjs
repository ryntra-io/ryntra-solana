// The legal pages for the eyes → <out>/*.jpg and <out>/REPORT.md
//   node app/legal/_view/shots.mjs <out> <baseUrl> [before]
// 2560×1440, 1920×1080, 1440×900 and 390×844, English and Ukrainian: each page's first screen and the whole page; on the Terms,
// the page read halfway (the contents follow the reader) and the store's address `/legal/privacy#android`; «More» open
// on a desk and on a phone, and About's foot. Each page also measured: no sideways scroll, the face of the title, the
// contents beside the text on a desk, the part an anchor names under the header. `before` takes the live site's pages
// as they were, for the record.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-335");
const base = process.argv[3] ?? "http://localhost:3335";
const before = process.argv[4] === "before";
mkdirSync(out, { recursive: true });

const PAGES = before ? ["/legal/terms", "/legal/privacy", "/legal/licenses"] : ["/legal/terms", "/legal/privacy", "/legal/licenses", "/legal/review/terms", "/about"];
const SIZES = [
  { name: "2560", width: 2560, height: 1440, scale: 1, mobile: false },
  { name: "1920", width: 1920, height: 1080, scale: 1, mobile: false },
  { name: "1440", width: 1440, height: 900, scale: 1, mobile: false },
  { name: "390", width: 390, height: 844, scale: 2, mobile: true },
];

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const report = [`# The legal pages${before ? ", before" : ""}`, "", `Stand: ${base}`, ""];
const prefix = before ? "before-" : "";

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const name = (at, state) => path.join(out, `${prefix}${at.replace(/[/#]/g, "_").replace(/^_/, "")}-${state}-${size.name}-${lang}.jpg`);
    for (const at of PAGES) {
      await page.goto(`${base}${at}?lang=${lang}`, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const facts = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        const side = document.querySelector("[data-page-side]");
        return {
          sideways: document.documentElement.scrollWidth - window.innerWidth,
          title: document.title,
          lang: document.documentElement.lang,
          h1: h1 ? `${h1.textContent} · ${getComputedStyle(h1).fontFamily.split(",")[0]}` : "—",
          side: side && getComputedStyle(side).display !== "none" ? "beside" : "none",
          parts: document.querySelectorAll("article section[id]").length,
        };
      });
      await page.screenshot({ path: name(at, "fold"), type: "jpeg", quality: 80 });
      await page.screenshot({ path: name(at, "full"), type: "jpeg", quality: 70, fullPage: true });
      report.push(`- ${at} · ${size.name} · ${lang}: sideways ${facts.sideways}px, h1 «${facts.h1}», parts ${facts.parts}, contents ${facts.side}, <html lang=${facts.lang}>, «${facts.title}»`);
      console.log(at, size.name, lang, JSON.stringify(facts));
    }
    if (!before) {
      // The Terms read halfway: the contents stand beside the text and light the part in view.
      await page.goto(`${base}/legal/terms?lang=${lang}`, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await page.evaluate(() => document.getElementById("liability")?.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(600);
      const mid = await page.evaluate(() => {
        const side = document.querySelector("[data-page-side]");
        const lit = document.querySelector("[aria-current='location']");
        return { sideTop: side ? Math.round(side.getBoundingClientRect().top) : null, lit: lit?.textContent ?? "—" };
      });
      await page.screenshot({ path: name("/legal/terms", "read"), type: "jpeg", quality: 80 });
      report.push(`- /legal/terms read to §13 · ${size.name} · ${lang}: contents' top at ${mid.sideTop}px, lit «${mid.lit}»`);

      // The store's address: the Android part under the header.
      await page.goto(`${base}/legal/privacy?lang=${lang}#android`, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(1800);
      const anchor = await page.evaluate(() => Math.round(document.getElementById("android")?.getBoundingClientRect().top ?? -1));
      await page.screenshot({ path: name("/legal/privacy#android", "fold"), type: "jpeg", quality: 80 });
      report.push(`- /legal/privacy#android · ${size.name} · ${lang}: the part's top at ${anchor}px`);

      // «More»: on a desk from the rail, on a phone from the sheet.
      await page.goto(`${base}/legal/terms?lang=${lang}`, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (size.mobile) {
        const button = (await page.locator("[data-terminal='menu-button']").count()) ? page.locator("[data-terminal='menu-button']") : page.locator("[data-terminal='mark']");
        await button.tap().catch(() => {});
        const sheet = page.locator("[role='dialog'][aria-modal='true']");
        await sheet.waitFor({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(600);
        await sheet.evaluate((el) => {
          const scroller = el.querySelector("[data-terminal='sheet-scroll']") ?? el;
          scroller.scrollTop = scroller.scrollHeight;
        }).catch(() => {});
        await page.waitForTimeout(500);
      } else {
        await page.locator("[data-terminal='more']").click().catch(() => {});
        await page.waitForTimeout(600);
      }
      const legalRow = await page.evaluate(() => [...document.querySelectorAll("nav a[href^='/legal/']")].filter((a) => a.getBoundingClientRect().height > 0 && a.closest("[role='dialog']")).map((a) => `${a.textContent} → ${a.getAttribute("href")} (${Math.round(a.getBoundingClientRect().height)}px)`));
      await page.screenshot({ path: name("more", "open"), type: "jpeg", quality: 82 });
      report.push(`- «More» · ${size.name} · ${lang}: ${legalRow.join(", ") || "no legal row"}`);
    }
    if (errors.length) report.push(`  - page errors (${size.name} ${lang}): ${[...new Set(errors)].slice(0, 5).join(" | ")}`);
    await context.close();
  }
}

if (!before) {
  // Every address answers on the stand, and the old short ones lead to the documents.
  report.push("", "## Addresses", "");
  const context = await browser.newContext();
  for (const at of ["/legal/terms", "/legal/privacy", "/legal/licenses", "/legal/review/terms", "/legal/review/privacy", "/legal/review/disclosures", "/terms", "/privacy", "/tos", "/legal"]) {
    const response = await context.request.get(`${base}${at}`, { maxRedirects: 5 }).catch((error) => ({ status: () => `ERR ${error.message}`, url: () => `${base}${at}`, headers: () => ({}) }));
    report.push(`- ${at} → ${new URL(response.url()).pathname}: ${response.status()}${response.headers()["x-robots-tag"] ? ` (x-robots-tag: ${response.headers()["x-robots-tag"]})` : ""}`);
    console.log("ADDR", at, new URL(response.url()).pathname, response.status());
  }
}
await browser.close();
writeFileSync(path.join(out, before ? "REPORT-before.md" : "REPORT.md"), `${report.join("\n")}\n`);
