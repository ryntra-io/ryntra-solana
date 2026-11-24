// The Launch screen for the eyes, at 1440×900, 1920×1080 and 390×844 (2560×1440 with SIZES=xl), in English and Ukrainian
// → <out>/*.jpg and <out>/report.json
//   node terminal/launch/shots.mjs <out> [baseUrl]
// A stand runs with the terminal's switch and Launch's own switches, its server on the devnet stand of Launch:
//   NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_LAUNCH=open NEXT_PUBLIC_RYNTRA_CITY_POOL_LAUNCH=open
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet next build, then next start with RYNTRA_LAUNCH_STAND=devnet (as
//   scripts/launch-qa/dev.mjs sets it: its own store, its pool payer's key file, the lane open).
// The system Chrome draws the page (PRESS_CHROME may point at another). A test wallet of the page's own answers the
// browser's wallet standard: it connects, keeps the bytes it is handed, and refuses every signature — nothing is ever
// signed or sent. The market's read is ryntra.io's own (a read only); every launch route is the stand's.
import { chromium } from "playwright";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "launch-shots");
const base = process.argv[3] ?? "http://localhost:3257";
const LIVE = "https://ryntra.io";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const PRO = process.env.PRO === "1";
/** «Pro» as the browser remembers it; its shots carry «-pro». */
const proOn = (context) => (PRO ? context.addInitScript(() => window.localStorage.setItem("ryntra.terminal.pro.v1", "1")) : Promise.resolve());
const PRO_TAG = PRO ? "-pro" : "";
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
  // The widest desk the operator looks on: only when named.
  { name: "xl", width: 2560, height: 1440, mobile: false, named: true },
].filter((size) => (process.env.SIZES ? process.env.SIZES.split(",").includes(size.name) : !size.named));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const SAY = { en: "launch me a token Kite $KITE", uk: "запусти мені токен Kite $KITE" };
// The test wallet's address: a stand wallet's own public address (STAND_OWNER) — it holds devnet SOL, so the engine's
// simulation passes and the bytes reach the wallet — or a fresh one.
const OWNER = process.env.STAND_OWNER || Keypair.generate().publicKey.toBase58();
const WALLET = "Stand Wallet";
const report = { owner: OWNER, states: [], asked: [] };

/* ---------------------------------------------------------------- the coin's picture, drawn here */

const picture = path.join(out, "kite.png");
{
  const page = await browser.newPage();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const g = canvas.getContext("2d");
    const sky = g.createLinearGradient(0, 256, 256, 0);
    sky.addColorStop(0, "#2a1640");
    sky.addColorStop(1, "#9945ff");
    g.fillStyle = sky;
    g.fillRect(0, 0, 256, 256);
    const kite = g.createLinearGradient(128, 40, 128, 210);
    kite.addColorStop(0, "#fff6e6");
    kite.addColorStop(1, "#ffb23f");
    g.fillStyle = kite;
    g.beginPath();
    g.moveTo(128, 38);
    g.lineTo(196, 112);
    g.lineTo(128, 206);
    g.lineTo(60, 112);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(11,10,20,0.55)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(128, 38);
    g.lineTo(128, 206);
    g.moveTo(60, 112);
    g.lineTo(196, 112);
    g.stroke();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  writeFileSync(picture, Buffer.from(data, "base64"));
  await page.close();
}

/* ---------------------------------------------------------------- the test wallet */

function walletScript({ owner, name }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
  } catch {}
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"], label: name };
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const refuse = (what) => async (...inputs) => {
    asked.push({ what, at: Date.now(), inputs: inputs.map((input) => ({ chain: input?.chain ?? null, bytes: input?.transaction ? b64(input.transaction) : null })) });
    throw new Error("User rejected the request.");
  };
  const wallet = {
    version: "1.0.0",
    name,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    chains: ["solana:mainnet", "solana:devnet"],
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
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

/** ryntra.io's own read: the market and its logos. Nothing else goes there. */
async function fromLive(route, request) {
  const url = new URL(request.url());
  // ryntra.io answers its own pages' reads only: the origin and the page are said as its own.
  const headers = { accept: request.headers().accept ?? "*/*", origin: LIVE, referer: `${LIVE}/launch` };
  const answer = await fetch(`${LIVE}${url.pathname}${url.search}`, { headers }).catch(() => null);
  if (!answer) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
}

/** What the wallet was handed, read back: each transaction's network, its programs and its signers. */
function readAsked(asked) {
  return asked.map((entry) => ({
    what: entry.what,
    transactions: entry.inputs.map((input) => {
      if (!input.bytes) return { chain: input.chain, bytes: null };
      try {
        const tx = VersionedTransaction.deserialize(Buffer.from(input.bytes, "base64"));
        const keys = tx.message.staticAccountKeys.map((key) => key.toBase58());
        return {
          chain: input.chain,
          size: Buffer.from(input.bytes, "base64").length,
          feePayer: keys[0],
          signers: keys.slice(0, tx.message.header.numRequiredSignatures),
          programs: [...new Set(tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex] ?? `lookup#${ix.programIdIndex}`))],
          instructions: tx.message.compiledInstructions.length,
        };
      } catch (error) {
        return { chain: input.chain, unreadable: String(error) };
      }
    }),
  }));
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
    await proOn(context);
    await context.route("**/api/**", (route, request) => {
      const { pathname } = new URL(request.url());
      if (pathname === "/api/city" || pathname.startsWith("/api/icon/") || pathname === "/api/spot/icon") return fromLive(route, request);
      // LIVE_LAUNCH=1: a stand without Launch's devnet server reads the launch's lists from ryntra.io — reads only.
      const reads = ["/api/v1/launch/presets", "/api/v1/launch/markets", "/api/v1/market/depth"];
      if (process.env.LIVE_LAUNCH === "1" && request.method() === "GET" && (reads.includes(pathname) || pathname.startsWith("/api/launch/image/"))) return fromLive(route, request);
      if (pathname.startsWith("/api/v1/launch/") || pathname.startsWith("/api/launch/image/")) return route.continue();
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    await context.addInitScript(walletScript, { owner: OWNER, name: WALLET });
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("ryntra.city.lang", value);
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
    }, lang);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    const want = (state) => !ONLY || ONLY.has(state);
    // A whole page is drawn in one tall window, so the phone's fixed tab bar stands at its foot, not across the page.
    const shot = async (state, full = false) => {
      await page.waitForTimeout(600);
      const file = path.join(out, `${state}-${size.name}${PRO_TAG}-${lang}.jpg`);
      if (full) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: size.width, height });
        await page.waitForTimeout(400);
        await page.screenshot({ path: file, quality: 86, type: "jpeg" });
        await page.setViewportSize({ width: size.width, height: size.height });
      } else {
        await page.screenshot({ path: file, quality: 86, type: "jpeg" });
      }
      report.states.push({ state, size: size.name, lang });
    };
    const open = async (address = "/launch", ready = "[data-launch-screen]") => {
      await page.goto(`${base}${address}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.locator(ready).filter({ visible: true }).first().waitFor({ timeout: 60_000 });
      // The ready formats stand once the engine named its presets (where the pool's door is open).
      if (address === "/launch") await page.locator("[data-launch-ready]").first().waitFor({ timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(2500);
    };
    const visible = (selector) => page.locator(selector).filter({ visible: true }).first();
    const fill = async () => {
      await page.locator("[data-launch-picture] input[type=file]").setInputFiles(picture);
      await visible("[data-launch-name]").fill("Kite");
      // A line about the coin and its links, as a launchpad asks them.
      await visible("[data-launch-description]").fill(lang === "uk" ? "Повітряний змій над Solana. Летимо разом." : "A kite over Solana. We fly together.");
      await visible("[data-launch-link=x]").fill("x.com/kitecoin");
      await visible("[data-launch-link=telegram]").fill("t.me/kitecoin");
      await page.waitForTimeout(400);
    };

    await open();
    if (want("empty")) await shot("empty");
    if (want("empty") && size.mobile) await shot("empty-full", true);
    // EYES-2 №113: on two columns the side column ends on the form's last line — their bottoms, in px, for the report.
    const columns = async (state) => {
      const box = await page.evaluate(() => {
        const bottom = (selector) => {
          const node = [...document.querySelectorAll(selector)].find((each) => each.offsetParent !== null);
          return node ? Math.round(node.getBoundingClientRect().bottom + window.scrollY) : null;
        };
        return { main: bottom("[data-launch-screen] [data-page-main]"), side: bottom("[data-launch-screen] [data-page-side] > :last-child") };
      });
      report.states.push({ state: `columns-${state}`, size: size.name, lang, ...box });
    };
    if (!size.mobile) await columns("empty");
    await fill();
    // The pool's way, where its door is open: trading opens in an hour, with the ladder — the approved design's state.
    const poolDoor = await page.locator("[data-launch-ready=pool]").count();
    if (poolDoor) {
      await visible("[data-launch-ready=pool]").click();
      await visible("[data-launch-opening] [role=radio]:nth-child(2)").click();
      await visible("[data-launch-ladder] [role=switch]").click();
    }
    await page.waitForTimeout(1500);
    if (!size.mobile) await columns(poolDoor ? "pool" : "curve");
    if (want("form")) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(poolDoor ? "form-pool" : "form-curve");
      if (size.mobile) await shot(poolDoor ? "form-pool-full" : "form-curve-full", true);
    }
    if (want("settings")) {
      await visible("[data-launch-terms] button").click();
      await shot(poolDoor ? "details-pool" : "details-curve", size.mobile);
      await visible("[data-launch-terms] button").click();
    }
    if (poolDoor && want("curve")) {
      await visible("[data-launch-ready=quick]").click();
      await page.waitForTimeout(2500);
      if (!size.mobile) await columns("curve");
      await shot("form-curve");
      if (size.mobile) await shot("form-curve-full", true);
    }

    // «Launch»: the city's flow to the wallet — the engine stores the coin, builds its bytes, the screen reads them back,
    // and the test wallet is asked to sign them. It refuses: the refusal is said in the terminal's words.
    if (want("launch")) {
      for (const format of poolDoor ? ["curve", "pool"] : ["curve"]) {
        await open();
        await fill();
        if (poolDoor) await visible(`[data-launch-ready=${format === "pool" ? "pool" : "quick"}]`).click();
        // The curve's cost comes from Solana's simulation once the fields are stored: given its moment.
        await page.waitForTimeout(format === "curve" ? 6000 : 1500);
        const act = visible("[data-launch-act]");
        await act.waitFor({ timeout: 20_000 });
        const before = { act: await act.getAttribute("data-launch-act"), terms: await visible("[data-launch-terms]").innerText() };
        if (format === "curve") await shot("ready-curve", size.mobile);
        await act.click();
        const refusal = visible("[data-launch-refusal]");
        const stopped = await refusal.waitFor({ timeout: 150_000 }).then(() => true, () => false);
        const asked = await page.evaluate(() => window.__standAsked.slice());
        const kind = stopped ? await refusal.getAttribute("data-launch-refusal") : null;
        report.asked.push({ format, size: size.name, lang, before, refusal: kind, wallet: readAsked(asked) });
        await shot(`refused-${format}`, size.mobile);
      }
    }

    // The agent's line: the sentence fills the form here, and nothing is launched.
    if (want("agent")) {
      await open("/swap", "[data-city-command] input");
      const line = visible("[data-city-command] input");
      await line.click();
      await line.fill(SAY[lang]);
      await page.waitForTimeout(500);
      await line.press("Enter");
      await page.waitForSelector("[data-launch-screen]", { timeout: 60_000 });
      await page.waitForTimeout(2500);
      report.states.push({ state: "agent-filled", size: size.name, lang, name: await visible("[data-launch-name]").inputValue(), symbol: await visible("[data-launch-symbol]").inputValue() });
      await shot("agent");
    }

    // The two other views: the coins new on the market, and this wallet's own launches.
    if (want("tabs")) {
      await open();
      await visible("[role=tablist] [role=tab]:nth-child(3)").click();
      await shot("fresh");
      await visible("[role=tablist] [role=tab]:nth-child(2)").click();
      // The wallet's coins are read: their rows, or the blank state — never the rows' places still waiting.
      await page.locator("[data-launch-blank], [data-launch-resume], a[href*='/coin/']").filter({ visible: true }).first().waitFor({ timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await shot("mine");
    }

    // The Agents screen: «Launcher» is hired where Launch is open.
    if (want("agents") && !size.mobile) {
      await page.goto(`${base}/agent`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      await shot("agents");
    }

    report.states.push({ state: "errors", size: size.name, lang, errors: errors.slice(0, 12) });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2).slice(0, 4000));
