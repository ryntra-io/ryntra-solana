// «Вигляд термінала — однакові вікна й порожні стани»: the pages the lead's eyes pass of 23.11 named, without a
// wallet, at 1440×900 and 390×844, in Ukrainian → <out>/<page>-<size>.jpg.
//   node terminal/shell/city383-shots.mjs [out] [baseUrl]
// A stand with the terminal on and every tab of «Money» open (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`,
// `NEXT_PUBLIC_RYNTRA_CITY_MONEY=open`, `NEXT_PUBLIC_RYNTRA_CONTACTS=1`, `NEXT_PUBLIC_RYNTRA_AUTOPAY=devnet`,
// `NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`). SIZES=desk,phone and ONLY=<page,page> narrow a run. No wallet connects; nothing
// is signed or sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-383");
const base = process.argv[3] ?? "http://localhost:3383";
mkdirSync(out, { recursive: true });

// The bridge's networks as the engine answers them (`/api/swap/bridge/chains`) — a stand-in of the same shape, as
// terminal/swap/eyes-g3-shots.mjs has it; a price is never asked for.
const SOLANA = 792703809;
const EVM_NATIVE = "0x0000000000000000000000000000000000000000";
const token = (chainId, address, symbol, name, decimals) => ({ chainId, address, symbol, name, decimals, verified: true, logo: true });
const chain = (id, label, vm, native) => ({ id, name: label.toLowerCase(), label, vm, wallet: vm === "svm" ? "solana" : "evm", owner: vm === "svm" ? "solana" : "evm", send: true, deposit: true, explorer: null, native, featured: [] });
const CHAINS = {
  chains: [
    chain(SOLANA, "Solana", "svm", token(SOLANA, "11111111111111111111111111111111", "SOL", "Solana", 9)),
    chain(1, "Ethereum", "evm", token(1, EVM_NATIVE, "ETH", "Ether", 18)),
    chain(8453, "Base", "evm", token(8453, EVM_NATIVE, "ETH", "Ether", 18)),
  ],
};

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const PAGES = [
  ["money-send", "/money"],
  ["money-payouts", "/money?tab=payouts"],
  ["money-contacts", "/money?tab=contacts"],
  ["money-autopay", "/money?tab=autopay"],
  ["launch-mine", "/launch?tab=mine"],
  ["bridge", "/bridge"],
  ["bots", "/bots"],
  ["agent-trader", "/agent?ai=trader"],
  ["agent-scout", "/agent?ai=scout"],
  ["agent-own", "/agent?ai=own"],
].filter(([name]) => !process.env.ONLY || process.env.ONLY.split(",").includes(name));

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: "uk-UA" });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("ryntra.city.lang", "uk");
    } catch {}
  });
  await context.route("**/api/swap/bridge/chains", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CHAINS) }));
  await context.route("**/api/swap/bridge/quote", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  const page = await context.newPage();
  for (const [name, href] of PAGES) {
    await page.goto(`${base}${href}${href.includes("?") ? "&" : "?"}lang=uk`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("[data-page]", { timeout: 120_000 }).catch(() => undefined);
    // Hydrated: the page's language is read and written on the document.
    await page.waitForFunction(() => document.documentElement.lang === "uk", null, { timeout: 120_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: path.join(out, `${name}-${size.name}.jpg`), type: "jpeg", quality: 82 });
    console.log(`${name}-${size.name}`);
  }
  await context.close();
}
await browser.close();
