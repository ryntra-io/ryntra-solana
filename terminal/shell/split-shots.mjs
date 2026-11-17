// For the eyes: the side column that drags, folds and is remembered, «Pro», the phone's sheet, sign-in in one
// window, and every screen in the v2 look — desk 1440×900, wide 1920×1080, phone 390×844, English and Ukrainian.
//   node terminal/shell/split-shots.mjs [out] [baseUrl]
// A stand runs with NEXT_PUBLIC_RYNTRA_TERMINAL=stand. Only the market's read and the coins' logos reach the stand; every
// other read answers 503 at once. The test wallets refuse every signature: nothing is ever signed or sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-277");
const base = process.argv[3] ?? "http://localhost:3177";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const ALL_SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = ALL_SIZES.filter((size) => (process.env.SIZES ?? "desk,wide,phone").split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const SCREENS = (process.env.SCREENS ?? "market,coin/So11111111111111111111111111111111111111112,swap,earn,agent,launch,portfolio").split(",");
const ONLY = process.env.ONLY ?? "kit,screens,login";
const report = [];

/** Two test wallets in the browser: the Seeker's and Phantom; each refuses every signature. */
function wallets() {
  const asked = [];
  window.__standAsked = asked;
  const make = (name, owner) => {
    const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: name };
    const refuse = (what) => async () => {
      asked.push(`${name}:${what}`);
      throw new Error("User rejected the request.");
    };
    const wallet = {
      version: "1.0.0",
      name,
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse("signTransaction") },
        "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: refuse("signAndSendTransaction") },
        "solana:signMessage": { version: "1.0.0", signMessage: refuse("signMessage") },
      },
    };
    return wallet;
  };
  // The Seeker's is listed only where a Seeker is likely; three more keep the list a list everywhere.
  const list = [
    make("Seeker Connect", "Seek3r1111111111111111111111111111111111111"),
    make("Phantom", "Phant0m111111111111111111111111111111111111"),
    make("Solflare", "So1f1are11111111111111111111111111111111111"),
    make("Backpack", "Backpack11111111111111111111111111111111111"),
  ];
  const register = (api) => list.forEach((w) => api.register(w));
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    await context.route("**/api/**", (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/city" || pathname.startsWith("/api/icon/") || pathname.startsWith("/api/spot/candles")) return route.continue();
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const tag = `${size.name}/${lang}`;
    const shot = async (state) => {
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg" });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1000);
    };
    const open = async (where) => {
      await page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("[data-terminal='rail'], [data-terminal='tabs']", { state: "attached", timeout: 180_000 });
      await settle();
    };
    const sideWidth = () => page.evaluate(() => Math.round(document.querySelector("aside[aria-label]")?.getBoundingClientRect().width ?? 0));
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());

    if (ONLY.includes("kit")) {
      await open("/terminal/kit/market");
      await page.evaluate(() => {
        try {
          localStorage.removeItem("ryntra.terminal.side.v1");
          localStorage.removeItem("ryntra.terminal.rail.v1");
        } catch {}
      });
      await open("/terminal/kit/market");
      report.push(`${tag}: kit — side ${await sideWidth()} px by default, sideways ${await sideways()} px`);
      await shot("kit");
      if (!size.mobile) {
        // Drag the strip 140 px to the left: wider.
        const handle = page.locator("[role='separator']");
        const box = await handle.boundingBox();
        const y = box.y + Math.min(box.height / 2, 300);
        await page.mouse.move(box.x + box.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 - 70, y, { steps: 6 });
        await page.mouse.move(box.x + box.width / 2 - 140, y, { steps: 6 });
        await shot("kit-dragging");
        await page.mouse.up();
        const wider = await sideWidth();
        await page.mouse.move(10, 10);
        await shot("kit-wider");
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("[role='separator']");
        await settle();
        report.push(`${tag}: dragged to ${wider} px; after a reload ${await sideWidth()} px`);
        // The keyboard: End — the widest; Home — the narrowest.
        await page.locator("[role='separator']").focus();
        await page.keyboard.press("Home");
        await page.waitForTimeout(200);
        const least = await sideWidth();
        await page.keyboard.press("End");
        await page.waitForTimeout(200);
        report.push(`${tag}: Home ${least} px, End ${await sideWidth()} px, sideways ${await sideways()} px`);
        await page.locator("[role='separator']").dblclick();
        await page.waitForTimeout(200);
        report.push(`${tag}: a double click gives back ${await sideWidth()} px`);
        // Fold and bring back.
        await page.getByRole("button", { name: lang === "uk" ? "Сховати панель" : "Hide the panel" }).click();
        await page.waitForTimeout(400);
        report.push(`${tag}: folded — side ${await sideWidth()} px`);
        await shot("kit-folded");
        await page.getByRole("button", { name: lang === "uk" ? "Показати панель" : "Show the panel" }).click();
        await page.waitForTimeout(300);
        // The rail folds to its icons and back.
        await page.locator("[data-terminal='rail-fold']").click();
        await page.waitForTimeout(400);
        report.push(`${tag}: rail folded — ${await page.evaluate(() => Math.round(document.querySelector("[data-terminal='rail']").getBoundingClientRect().width))} px`);
        await shot("kit-rail-folded");
        await page.locator("[data-terminal='rail-fold']").click();
      } else {
        // The phone: the sheet over the tabs; its grip folds it to the coin's bar.
        await page.locator("aside[aria-label] button[aria-expanded]").first().tap();
        await page.waitForTimeout(500);
        await shot("kit-sheet-folded");
        report.push(`${tag}: folded sheet ${await sideWidth()} px wide, sideways ${await sideways()} px`);
      }
    }

    if (ONLY.includes("screens")) {
      for (const screen of SCREENS) {
        await open(`/${screen}`);
        const name = screen.split("/")[0];
        report.push(`${tag}: ${name} — sideways ${await sideways()} px`);
        await shot(`screen-${name}`);
      }
    }

    if (ONLY.includes("login")) try {
      await context.addInitScript(wallets);
      await open("/market");
      await tap(page.locator("[data-terminal='wallet']").first());
      await page.waitForSelector("[data-login]", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(500);
      report.push(`${tag}: sign-in — ${await page.locator("[data-login] button").count()} buttons; first «${(await page.locator("[data-login] button").first().textContent().catch(() => "?"))?.trim()}»`);
      await shot("login");
      // Sign in with the Seeker; the test wallet refuses the message: the calm line, nothing changed.
      await tap(page.locator("[data-login] button").last());
      await page.waitForTimeout(2500);
      await shot("login-closed");
      report.push(`${tag}: the wallets were asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
    } catch (error) {
      report.push(`${tag}: sign-in shot failed — ${String(error).slice(0, 200)}`);
    }

    if (errors.length) report.push(`${tag}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
