// The real screens the documentation's sections show (CITY-180): filmed from the live site, never drawn, one file per language →
// public/city/docs/<screen>-<lang>.webp. It only looks: no wallet is connected and nothing is signed.
//   node city/lib/docs/screens.mjs [out] [baseUrl]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const out = path.resolve(process.argv[2] ?? "public/city/docs");
const base = process.argv[3] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--enable-unsafe-swiftshader"] });

const WORD = {
  en: { later: /^(Later|Got it)$/, ask: /^Ask Ryntra/i, limit: /^Limit$/i, earn: /^Earn$/i, money: /^Money$/i, guard: /^Guard$/i, topup: /^Top up$/i },
  uk: { later: /^(Пізніше|Зрозуміло)$/, ask: /^Спитати Ryntra/i, limit: /^Ліміт$/i, earn: /^Заробіток$/i, money: /^Гроші$/i, guard: /^Охорона$/i, topup: /^Поповнити$/i },
};

async function shot(page, name, lang) {
  await page.waitForTimeout(4500);
  const raw = await page.screenshot({ type: "png" });
  await sharp(raw).resize({ width: 1280 }).webp({ quality: 78 }).toFile(path.join(out, `${name}-${lang}.webp`));
  console.log("screen", name, lang);
}

/** A fresh page each time: every screen starts from the plain city, with nothing left open. */
async function city(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: lang === "uk" ? "uk-UA" : "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(22_000);
  const hint = page.getByRole("button", { name: WORD[lang].later }).first();
  if (await hint.isVisible().catch(() => false)) await hint.click({ timeout: 4000, force: true }).catch(() => {});
  return { ctx, page, w: WORD[lang] };
}

const SCREENS = {
  city: async () => {},
  tower: async ({ page }) => void (await page.mouse.click(720, 420)),
  limit: async ({ page, w }) => {
    await page.mouse.click(720, 420);
    await page.waitForTimeout(5000);
    await page.getByRole("button", { name: w.limit }).or(page.getByRole("radio", { name: w.limit })).or(page.getByRole("tab", { name: w.limit })).first().click({ timeout: 8000 });
  },
  earn: async ({ page, w }) => page.getByRole("button", { name: w.earn }).first().click({ timeout: 8000 }),
  money: async ({ page, w }) => {
    await page.getByRole("button", { name: w.money }).first().click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: w.topup }).or(page.getByRole("tab", { name: w.topup })).first().click({ timeout: 8000 }).catch(() => {});
  },
  guard: async ({ page, w }) => page.getByRole("button", { name: w.guard }).first().click({ timeout: 8000 }),
  ask: async ({ page, w }) => page.getByRole("button", { name: w.ask }).first().click({ timeout: 8000 }),
};

const only = process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(SCREENS);
for (const lang of (process.env.LANGS ?? "en,uk").split(",")) {
  for (const name of only) {
    const open = await city(lang);
    try {
      await SCREENS[name](open);
      await shot(open.page, name, lang);
    } catch (error) {
      console.error("failed", name, lang, String(error).slice(0, 200));
    }
    await open.ctx.close();
  }
}
await browser.close();
