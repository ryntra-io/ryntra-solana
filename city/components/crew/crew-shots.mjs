// «Consultant and agents» (CITY-205) for review: desk and phone, English and Ukrainian, twice — without a wallet and with
// a devnet test wallet — on the real GPU.
//   node city/components/crew/crew-shots.mjs [out=docs/shots/city-205] [baseUrl=http://localhost:3045]   (npm run dev running,
//   with NEXT_PUBLIC_RYNTRA_CITY_MANDATE / _AUTOPILOT = devnet, _PILOT / _EARN = open, NEXT_PUBLIC_RYNTRA_AGENT_CARE = devnet)
// → <out>/<lang>-<size>-<pass>-<n>-<what>.jpg. Windows open through the development hooks (window.__openCommand,
// window.__assistant, window.__openBots); the test wallet is a Wallet-Standard stub on devnet that signs nothing — a tap on
// «Sign» must reach it and come back «Nothing was signed».
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-205");
const base = process.argv[3] ?? "http://localhost:3045";
mkdirSync(out, { recursive: true });
const ONLY = process.env.SIZES?.split(",") ?? null;
const SIZES_ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = ONLY ? SIZES_ALL.filter((x) => ONLY.includes(x.name)) : SIZES_ALL;
const SAY = {
  en: { keeper: "look after my pool", ask: "what is growing and why", hire: "hire a trader" },
  uk: { keeper: "доглядай мій пул", ask: "що росте й чому", hire: "найми трейдера" },
};
// A devnet test wallet: its public address only (no key exists here); it signs nothing.
const TEST_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const stubWallet = (address) => `
  (() => {
    const account = { address: ${JSON.stringify(address)}, publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: ["solana:signTransaction", "solana:signAllTransactions", "solana:signMessage"], label: "Test wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLz4=" };
    const refuse = async () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); };
    const wallet = {
      version: "1.0.0", name: "Test wallet", icon: account.icon, chains: ["solana:devnet", "solana:mainnet"], accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse },
        "solana:signAllTransactions": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAllTransactions: refuse },
        "solana:signMessage": { version: "1.0.0", signMessage: refuse },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => { try { event.detail.register(wallet); } catch {} });
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  })();
`;

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", `--disk-cache-dir=${process.env.PRESS_CACHE ?? path.join(os.tmpdir(), "city-205-chrome-cache")}`] });
const report = [];
for (const lang of (process.env.LANGS ?? "uk,en").split(",")) {
  for (const s of SIZES) {
    for (const pass of (process.env.PASSES ?? "guest,wallet").split(",")) {
      const context = await browser.newContext({ locale: lang === "uk" ? "uk-UA" : "en-US", viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
      if (pass === "wallet") await context.addInitScript(stubWallet(TEST_WALLET));
      const page = await context.newPage();
      page.setDefaultTimeout(120_000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      let n = 0;
      const shot = async (what) => {
        n += 1;
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(out, `${lang}-${s.name}-${pass}-${n}-${what}.jpg`), type: "jpeg", quality: 82 });
      };
      await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window.__city?.getState().layout.towers.length ?? 0) > 0 && window.__openCommand && window.__assistant && window.__openBots, null, { timeout: 240_000 });
      // The scene warms up before the first frame: the city behind the windows, not a black sky.
      await page.waitForTimeout(12000);
      const facts = { lang, size: s.name, pass };

      // 1 · The command line: a job for an agent comes first, marked «Agent»; a question is the consultant's.
      if (pass === "guest") {
        await page.evaluate(() => window.__openCommand());
        await page.locator("[data-city-command] input").fill(SAY[lang].keeper);
        await page.waitForTimeout(500);
        facts.hireRow = await page.locator("[data-city-command] [role=option]").first().innerText();
        await shot("line-hire");
        await page.locator("[data-city-command] input").fill(SAY[lang].ask);
        await page.waitForTimeout(500);
        facts.askRow = await page.locator("[data-city-command] [role=option]").last().innerText();
        await shot("line-consultant");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);

        // 2 · The consultant's panel: «hire a trader» brings the agent and «Hire», not words.
        await page.evaluate(() => window.__assistant.getState().show(null));
        await page.locator("input[enterkeyhint=send]").fill(SAY[lang].hire);
        await page.locator("input[enterkeyhint=send]").press("Enter");
        await page.waitForSelector("[data-job]");
        facts.job = await page.locator("[data-job]").innerText();
        await shot("panel-job");
        await page.locator("[data-job-hire]").click();
      } else {
        await page.evaluate(() => window.__openBots("launch"));
      }

      // 3 · «Bots → Start»: the crew on top, the Trader in view after «Hire».
      await page.waitForSelector("[data-crew]", { timeout: 180_000 });
      await page.waitForTimeout(1500);
      if (pass === "wallet") {
        await page.evaluate(async () => {
          const w = window.__autopilotWallet.getState();
          const name = w.wallets.find((x) => x.name === "Test wallet")?.name;
          if (name) await w.connect(name);
        });
        await page.waitForTimeout(2500);
        facts.connected = await page.evaluate(() => window.__autopilotWallet.getState().connection?.address ?? null);
      }
      await page.locator("[data-crew]").scrollIntoViewIfNeeded();
      facts.tiles = await page.locator("[data-crew] [data-role]").evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("data-role")}:${node.innerText.replace(/\s+/g, " ")}`));
      await shot("bots-crew");
      await page.locator("[data-crew] button[aria-expanded]").click();
      await page.waitForTimeout(400);
      await page.locator("[data-crew] ul").scrollIntoViewIfNeeded();
      await shot("bots-how");

      // 4 · With the test wallet: «Sign» reaches the wallet, which refuses — nothing moves.
      if (pass === "wallet") {
        const sign = page.locator("[data-mandate-sign]");
        await sign.scrollIntoViewIfNeeded();
        facts.signLabel = await sign.innerText();
        await sign.click();
        await page.waitForTimeout(6000);
        facts.afterSign = await page.locator("[data-mandate] [role=status]").innerText().catch(() => null);
        await shot("trader-sign-refused");
      }
      facts.sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      facts.errors = errors.slice(0, 3);
      report.push(facts);
      console.log(JSON.stringify(facts));
      await context.close();
    }
  }
}
await browser.close();
