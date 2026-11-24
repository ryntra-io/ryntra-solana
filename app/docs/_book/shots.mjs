// Frames of the live ryntra.io for the documentation → public/docs/shots/<id>-<desk|phone>-<en|uk>.webp
//   node app/docs/_book/shots.mjs [only-id,…] [baseUrl]
// Desk 1440×900 and phone 390×844, English and Ukrainian. No wallet is connected and nothing is signed: every frame is
// what a stranger sees. The system Chrome draws the page (PRESS_CHROME may point at another).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.join(ROOT, "public/docs/shots");
const only = process.argv[2] ? process.argv[2].split(",") : null;
const BASE = process.argv[3] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
/** The MET / SOL pool of Meteora DLMM Pro — the deepest on the list the day the frames were cut. */
const MET_POOL = "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d";
const STOCK_POOL = "Cuwq452DQpCoti14YML8f8WMCeahTDt1T5hnC75Vcu8N";

export const SHOTS = [
  { id: "market", path: "/" },
  { id: "market-table", path: "/", scroll: "table" },
  // A sentence typed in the agent's line, and the screen it opened.
  { id: "say", path: "/earn", say: { en: "Buy JUP for 1 SOL", uk: "Купи JUP на 1 SOL" } },
  { id: "trade", path: "/swap" },
  { id: "bridge", path: "/bridge" },
  { id: "spot", path: `/coin/${SOL}` },
  { id: "stocks", path: "/?tab=stock", scroll: "table" },
  { id: "launch", path: "/launch" },
  { id: "bots", path: "/bots/recurring" },
  { id: "grid", path: "/bots/grid" },
  { id: "ladder", path: "/bots/ladder" },
  { id: "agent", path: "/agent" },
  { id: "earn", path: "/earn" },
  { id: "pro", path: "/pro" },
  { id: "pool", path: `/pool/${MET_POOL}` },
  /** A verified stock's Meteora DLMM Pro pool on its Position tab — the deepest stock pool on the list the day the frames were cut. */
  { id: "stock-pool", path: `/pool/${STOCK_POOL}?tab=position`, form: /You put|Платиш/ },
  { id: "portfolio", path: "/portfolio" },
  { id: "money", path: "/money" },
  { id: "rewards", path: "/rewards" },
];

const SIZES = [
  { name: "desk", width: 1440, height: 900, scale: 1, mobile: false },
  { name: "phone", width: 390, height: 844, scale: 2, mobile: true },
];

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
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
    for (const shot of SHOTS) {
      if (only && !only.includes(shot.id)) continue;
      await page.goto(`${BASE}${shot.path}${shot.path.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(9000);
      if (shot.say) {
        // The agent's line in the header (on a phone, the Market's own «Say» line).
        let line = page.locator("input[role=combobox]:visible").first();
        if (!(await line.count())) {
          await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
          await page.waitForTimeout(7000);
          line = page.locator("main input:visible").first();
        }
        await line.click();
        await line.pressSequentially(shot.say[lang], { delay: 30 });
        await page.waitForTimeout(2000);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(9000);
      }
      if (shot.form) {
        // The order form draws after the pool is read: wait for it, and on a phone bring it into view.
        await page.getByText(shot.form).first().waitFor({ timeout: 30_000 }).catch(() => {});
        if (size.mobile) {
          await page.getByRole("tab").filter({ hasText: /Position|Позиція/ }).first().evaluate((node) => {
            node.scrollIntoView({ block: "start", behavior: "instant" });
            const head = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
            window.scrollBy({ top: -(head + 12), behavior: "instant" });
          }).catch(() => {});
        }
        await page.waitForTimeout(2500);
      }
      if (shot.scroll === "table") {
        // The table of every coin: its tabs at the top of the frame.
        await page.evaluate(() => {
          const tabs = [...document.querySelectorAll("main [role=tablist], main [role=tab]")].map((node) => node.closest("section, div"));
          const target = tabs.find((node) => node && /Memes|Меми/.test(node.textContent ?? "")) ?? null;
          const scroller = document.querySelector("main")?.closest("[data-scroll], main") ?? document.scrollingElement;
          if (target) target.scrollIntoView({ block: "start", behavior: "instant" });
          else scroller?.scrollBy(0, window.innerHeight * 0.8);
          // The terminal's header stays on top of the page: the table's title is brought out from under it.
          const head = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
          window.scrollBy({ top: -(head + 12), behavior: "instant" });
        });
        await page.waitForTimeout(1500);
      }
      const png = await page.screenshot({ type: "png" });
      const file = path.join(out, `${shot.id}-${size.name}-${lang}.webp`);
      await sharp(png).webp({ quality: 74 }).toFile(file);
      console.log(path.relative(ROOT, file));
    }
    await context.close();
  }
}
await browser.close();
