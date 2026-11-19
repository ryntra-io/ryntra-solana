// The Bridge for the eyes at 1920×1080, 1440×900 and 390×844, in English and Ukrainian → <out>/*.jpg
//   node terminal/swap/bridge-shots.mjs <out> <baseUrl> [before|after]
// `before` reads the live page as it stands; `after` walks a stand built with the terminal open
// (a local file of production's switches, `next build`, then `next start`), where the networks, the coins and every price are
// Relay's own, asked by the stand's server — reads only. The wallets are stubs: a Solana wallet of the Wallet Standard
// and an EVM wallet announced by EIP-6963, each connects and refuses every signature. Their balances are fixtures. A
// deposit address is Relay's own answer for this order; nothing is ever sent to it.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-310");
const base = process.argv[3] ?? "http://localhost:3110";
const mode = process.argv[4] ?? "after";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;

const SOL_OWNER = Keypair.generate().publicKey.toBase58();
const EVM_OWNER = `0x${randomBytes(20).toString("hex")}`;
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** The stand's wallets hold this — fixtures, never a person's. */
const HOLDINGS = { data: { holdings: [{ kind: "NATIVE_SOL", mint: null, spendableRaw: "4200000000", decimals: 9 }, { kind: "SPL", mint: USDC_SOL, spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } }], tokenRead: "COMPLETE" } };
const EVM_BALANCE = { raw: "50000000000000000" };
const report = [`mode ${mode}`, `solana ${SOL_OWNER}`, `evm ${EVM_OWNER}`];

function solanaWallet({ owner, name }) {
  try {
    localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
  } catch {}
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction"], label: name };
  const refuse = async () => {
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
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: refuse },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

/** An EIP-1193 wallet announced by EIP-6963: it gives its address, switches networks, and refuses every signature. */
function evmWallet({ owner, name }) {
  const asked = [];
  window.__evmAsked = asked;
  let chainId = "0x1";
  // Like a wallet meeting a site for the first time: no address until the person connects.
  let granted = false;
  const listeners = {};
  const emit = (event, value) => (listeners[event] ?? []).forEach((listener) => listener(value));
  const refuse = () => Object.assign(new Error("User rejected the request."), { code: 4001 });
  const provider = {
    request: async ({ method, params }) => {
      asked.push(method);
      switch (method) {
        case "eth_requestAccounts":
          granted = true;
          return [owner];
        case "eth_accounts":
          return granted ? [owner] : [];
        case "eth_chainId":
          return chainId;
        case "net_version":
          return String(parseInt(chainId, 16));
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          chainId = params[0].chainId;
          emit("chainChanged", chainId);
          return null;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "eth_sendTransaction":
        case "eth_signTypedData_v4":
        case "personal_sign":
        case "wallet_sendCalls":
          throw refuse();
        default:
          throw Object.assign(new Error(`${method} is not supported`), { code: 4200 });
      }
    },
    on: (event, listener) => void (listeners[event] ??= []).push(listener),
    removeListener: (event, listener) => void (listeners[event] = (listeners[event] ?? []).filter((entry) => entry !== listener)),
  };
  const info = { uuid: "2f1d3a3e-6a8b-4c51-9b6e-310310310310", name, rdns: "io.ryntra.stand", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjOTk0NWZmIi8+PC9zdmc+" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    if (mode === "after") {
      await context.addInitScript(solanaWallet, { owner: SOL_OWNER, name: "Stand Wallet" });
      await context.addInitScript(evmWallet, { owner: EVM_OWNER, name: "Stand EVM" });
      await context.route("**/api/**", (route, request) => {
        const { pathname } = new URL(request.url());
        if (pathname === "/api/solana/holdings") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HOLDINGS) });
        if (pathname === "/api/swap/bridge/balance") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EVM_BALANCE) });
        // Nothing is ever told to Relay as sent from the stand.
        if (pathname.startsWith("/api/swap/bridge/relay/transactions")) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
        return route.continue();
      });
    }
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text().slice(0, 200)));
    const shot = async (state) => {
      if (ONLY && !ONLY.has(state)) return;
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 60_000 }).catch(() => {});
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const go = () => page.locator("[data-bridge-go]").first();
    const goSays = async () => `${await go().getAttribute("data-bridge-go").catch(() => "?")} «${(await go().textContent().catch(() => "?"))?.trim()}»`;
    const waitPress = async (wanted, ms = 30_000) => page.waitForFunction((list) => list.includes(document.querySelector("[data-bridge-go]")?.getAttribute("data-bridge-go") ?? ""), wanted, { timeout: ms }).catch(() => {});
    const typeAmount = async (value) => {
      const field = page.locator("[data-bridge-amount]");
      await tap(field);
      await field.fill(value);
    };
    const pick = async (side, net, symbol, search = "") => {
      await tap(page.locator(`[data-bridge-coin='${side}']`));
      await page.waitForSelector("[data-bridge-net]", { timeout: 20_000 });
      await tap(page.locator(`[data-bridge-net='${net}']`));
      if (search) await page.locator("[data-bridge-find]").fill(search);
      const token = page.locator(`[data-bridge-token='${symbol}']`).first();
      await token.waitFor({ timeout: 30_000 });
      await tap(token);
      await page.waitForTimeout(400);
    };

    await page.goto(`${base}/bridge?lang=${lang}`, { waitUntil: "domcontentloaded" });
    await settle();
    if (mode === "before") {
      await shot("before");
      const network = page.getByRole("button", { name: /Pick the network|Обрати мережу/ }).first();
      if (await network.isVisible().catch(() => false)) {
        await tap(network);
        await shot("before-networks");
      }
      await context.close();
      continue;
    }

    // 1. The form: ETH on Base into SOL on Solana, and a price before any EVM wallet is asked.
    await page.waitForSelector("[data-bridge-coin='from']:not([disabled])", { timeout: 30_000 });
    await shot("form");
    await typeAmount("0.01");
    await waitPress(["connectOrigin", "move", "noRoute", "unavailable", "busy"]);
    report.push(`${size.name}/${lang} eth-base→sol (no EVM wallet): ${await goSays()}`);
    await shot("quote-eth-base-sol");

    // 2. Every network Relay carries, and the coins of one, searched.
    await tap(page.locator("[data-bridge-coin='from']"));
    await page.waitForSelector("[data-bridge-net]", { timeout: 20_000 });
    report.push(`${size.name}/${lang} networks offered to send from: ${await page.locator("[data-bridge-net]").count()}`);
    await page.waitForSelector("[data-bridge-token]", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await shot("networks");
    await page.locator("[data-bridge-find]").fill("pepe");
    await page.waitForTimeout(1500);
    await page.waitForSelector("[data-bridge-token]", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await shot("coins-search");
    await tap(page.getByRole("button", { name: /Back|Назад/ }).first());

    // 3. The EVM wallet the browser carries: the press leads to it, a tap connects it, the price becomes the real one.
    await waitPress(["connectOrigin"]);
    await tap(go());
    await page.waitForSelector("[data-bridge-wallet]", { timeout: 15_000 }).catch(() => {});
    await shot("wallets");
    await tap(page.locator("[data-bridge-wallet='Stand EVM']"));
    await waitPress(["move", "noRoute", "unavailable", "busy"], 40_000);
    report.push(`${size.name}/${lang} eth-base→sol (EVM connected): ${await goSays()}`);
    await settle();
    await shot("quote-connected");
    const details = page.getByRole("button", { name: /Transfer details|Деталі переказу/ }).first();
    if (await details.isVisible().catch(() => false)) {
      await tap(details);
      await shot("details");
      await tap(details);
    }

    // 4. The move: the wallet is turned to Base and asked — and refuses. The form says so, and the transfer stays listed.
    if ((await go().getAttribute("data-bridge-go")) === "move") {
      await tap(go());
      await page.waitForFunction(() => /Cancelled in the wallet|Скасовано в гаманці|Did not go through|Не пройшло/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});
      report.push(`${size.name}/${lang} wallet asked: ${await page.evaluate(() => (window.__evmAsked ?? []).filter((m) => /send|switch|sign/i.test(m)).join(","))}`);
      await settle();
      await shot("refused");
      await tap(page.getByRole("button", { name: /New transfer|Новий переказ/ }).first());
      await page.waitForTimeout(500);
    }

    // 5. USDC on Solana into ETH on Arbitrum: the Solana wallet sends, the EVM wallet receives.
    await pick("from", "solana", "USDC", "usdc");
    await pick("to", "arbitrum", "ETH");
    await typeAmount("25");
    await waitPress(["move", "noRoute", "unavailable", "busy", "connectOrigin"], 40_000);
    report.push(`${size.name}/${lang} usdc-sol→eth-arb: ${await goSays()}`);
    await settle();
    await shot("quote-usdc-sol-eth-arb");

    // 6. Bitcoin: no wallet here signs on it — Relay's address for exactly this amount, with its code.
    await pick("from", "bitcoin", "BTC");
    await pick("to", "solana", "SOL", "sol");
    await typeAmount("0.002");
    await waitPress(["deposit", "noRoute", "unavailable", "busy", "tooSmall"], 40_000);
    report.push(`${size.name}/${lang} btc→sol: ${await goSays()}`);
    if ((await go().getAttribute("data-bridge-go")) === "deposit") {
      await tap(go());
      await page.waitForFunction(() => /Send exactly|Надішли рівно/.test(document.body.innerText), null, { timeout: 40_000 }).catch(() => {});
      await settle();
      await shot("deposit");
    }

    // 7. A transfer on its way, after a reload: from «My transfers», Relay asked where it is (answers held for the shot).
    await page.route("**/api/swap/bridge/relay/intents/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.evaluate(() => {
      const now = Date.now();
      const list = JSON.parse(localStorage.getItem("ryntra.bridge.transfers") ?? "[]");
      list.unshift({ requestId: `0x${"ab".repeat(32)}`, at: now - 40_000, state: "bridging", from: { chainId: 8453, symbol: "ETH", amountRaw: "10000000000000000", decimals: 18, address: "0x0000000000000000000000000000000000000000", logo: true }, to: { chainId: 792703809, symbol: "SOL", amountRaw: "240599370", decimals: 9, address: "11111111111111111111111111111111", logo: true }, originTx: [8453, `0x${"cd".repeat(32)}`], destinationTx: null, depositAddress: null });
      localStorage.setItem("ryntra.bridge.transfers", JSON.stringify(list));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle();
    await tap(page.locator("[data-bridge-transfer='bridging']").first());
    await page.waitForTimeout(600);
    await shot("progress");
    if (errors.length) report.push(`${size.name}/${lang} page errors: ${[...new Set(errors)].slice(0, 6).join(" | ")}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, `report-${mode}.txt`), `${report.join("\n")}\n`);
console.log(report.join("\n"));
