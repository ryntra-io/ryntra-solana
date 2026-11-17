// The first minute for the eyes: the Market as the home page, at 1440×900 and 390×844, in English and
// Ukrainian → <out>/*.jpg and <out>/report.txt.
//   node terminal/market/hero-shots.mjs <out> [baseUrl]
// A stand runs as people will get it: NEXT_PUBLIC_RYNTRA_TERMINAL=open with the city's production switches, next build
// && next start. The system Chrome draws the page (PRESS_CHROME may point at another). Three moments:
//   home      — no wallet: the agent's promise over the list, what it does with the money in one line;
//   said      — the first sentence tapped: its shelf opens with the agent's card;
//   wallet    — the header's wallet tapped: the list, or the connected wallet's menu;
//   connected — a test wallet of the page's own is already connected.
// The funnel: every moment the page sends to /api/track is caught (never stored) and written to the report —
// came → connected → first action.
// The test wallet answers the browser's wallet standard and refuses every signature it is asked for: nothing is signed.
// Every read reaches the stand's own server; the wallet's balance is a fixture (1.5 SOL); /api/track is caught.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-268");
const base = process.argv[3] ?? "http://localhost:3168";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const WALLET = "Stand Wallet";
const HOLDINGS = { data: { owner: OWNER, holdings: [{ kind: "NATIVE_SOL", mint: null, spendableRaw: "1500000000", decimals: 9 }], tokenRead: "COMPLETE" } };
const report = [];

function walletScript({ owner, name, hint }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    if (hint) localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
  } catch {}
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: name };
  const refuse = (what) => async () => {
    asked.push(what);
    throw new Error("User rejected the request.");
  };
  const wallet = {
    version: "1.0.0",
    name,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    chains: ["solana:mainnet"],
    accounts: hint ? [account] : [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse("signTransaction") },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: refuse("signAndSendTransaction") },
      "solana:signMessage": { version: "1.0.0", signMessage: refuse("signMessage") },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const moment of ["home", "connected"]) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.mobile ? 2 : 1,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
      });
      const track = [];
      await context.route("**/api/**", (route) => {
        const { pathname } = new URL(route.request().url());
        if (pathname === "/api/track") {
          try {
            const body = JSON.parse(route.request().postData() ?? "{}");
            for (const row of Array.isArray(body.events) ? body.events : [body]) if (row?.name) track.push(row.name);
          } catch {}
          return route.fulfill({ status: 204, body: "" });
        }
        if (pathname === "/api/solana/holdings") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HOLDINGS) });
        // Every other read is the stand's own server, as a person's page has it (the market's depth, the sign-in's checks):
        // a 503 here drew «The market did not answer» and «Sign-in is unavailable» that people never see.
        return route.continue();
      });
      await context.addInitScript(walletScript, { owner: OWNER, name: WALLET, hint: moment === "connected" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const shot = async (state, full = false) => {
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg", fullPage: full });
      };
      const settle = async () => {
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
        await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1200);
      };
      const tap = (locator) => (size.mobile ? locator.tap() : locator.click());

      await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("[data-terminal='hero']", { timeout: 180_000 });
      await page.waitForResponse((res) => res.url().includes("/api/city"), { timeout: 20_000 }).catch(() => {});
      await settle();
      const says = await page.locator("[data-terminal='hero'] [data-say]").allTextContents();
      const terms = (await page.locator("[data-terminal='hero'] p").allTextContents()).join(" / ");
      const box = await page.locator("[data-terminal='hero']").boundingBox();
      report.push(`${size.name}/${lang}/${moment}: sentences — ${says.join(" | ")}; line — «${terms}»; promise ${Math.round(box?.y ?? -1)}–${Math.round((box?.y ?? 0) + (box?.height ?? 0))}px`);
      report.push(`${size.name}/${lang}/${moment}: side scroll ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}`);

      if (moment === "home") {
        await shot("home");
        await shot("home-full", true);
        // The wallet in the header, one tap from the first screen.
        await tap(page.locator("[data-terminal='wallet']").first());
        await page.waitForTimeout(800);
        report.push(`${size.name}/${lang}/home: wallets — ${(await page.locator("[role='dialog'] button").allTextContents()).join(" | ")}`);
        await shot("wallets");
        await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("[data-terminal='hero']");
        await settle();
        // The first sentence said: its shelf opens with the card, and only there asks for a wallet.
        await tap(page.locator("[data-terminal='hero'] [data-say]").first());
        await page.waitForURL((url) => url.pathname !== "/", { timeout: 30_000 }).catch(() => {});
        await settle();
        report.push(`${size.name}/${lang}/home: first sentence → ${new URL(page.url()).pathname}`);
        await shot("said");
      } else {
        await page.waitForTimeout(2500);
        await shot("connected");
      }
      report.push(`${size.name}/${lang}/${moment}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      report.push(`${size.name}/${lang}/${moment}: funnel — ${track.join(" → ") || "none"}`);
      if (errors.length) report.push(`${size.name}/${lang}/${moment}: page errors — ${errors.join(" | ").slice(0, 600)}`);
      await context.close();
    }
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
