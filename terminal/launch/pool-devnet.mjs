// «Straight to a pool» on devnet, through the Launch screen itself: the form, «Launch», the three steps the
// wallet signs, the engine's own sends, the coin standing in its pool.
//   STAND_KEY=<devnet key file> node terminal/launch/pool-devnet.mjs <out> [baseUrl]
// A stand built with the terminal's switches and Launch's pool door open (`NEXT_PUBLIC_RYNTRA_CITY_POOL_LAUNCH=open`),
// `next start` on the devnet stand of Launch (`RYNTRA_LAUNCH_STAND=devnet`). The page's test wallet answers the
// browser's wallet standard and hands every transaction to this process, which signs it with the devnet test key —
// only for `solana:devnet`, only on a stand at localhost; the key never enters the page. A transaction for any other
// chain is refused. → <out>/pool-devnet.json (each step's signatures) and shots of each state.
import { chromium } from "playwright";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.resolve(process.argv[2] ?? "pool-devnet");
const base = process.argv[3] ?? "http://localhost:3121";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("A stand at localhost only.");
const keyFile = process.env.STAND_KEY;
if (!keyFile) throw new Error("STAND_KEY names the devnet test key file, outside the repository.");
// The key file lives outside the repository: a stand's test key is never one of its files.
if (path.resolve(keyFile).toLowerCase().startsWith(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..").toLowerCase())) throw new Error("The key file must live outside the repository.");
const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile, "utf8"))));
const OWNER = key.publicKey.toBase58();
const LIVE = "https://ryntra.io";
const LANG = process.env.LANG_UI ?? "uk";
const LADDER = process.env.LADDER !== "0";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const journal = { owner: OWNER, base, ladder: LADDER, signed: [], refused: [], builds: [], submits: [], states: [] };

/* The coin's picture, drawn here. */
const picture = path.join(out, "pool-coin.png");
{
  const page = await browser.newPage();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const g = canvas.getContext("2d");
    const sky = g.createRadialGradient(128, 110, 10, 128, 128, 180);
    sky.addColorStop(0, "#ff8a3d");
    sky.addColorStop(1, "#1b0f2e");
    g.fillStyle = sky;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "rgba(255,246,230,0.92)";
    g.beginPath();
    g.arc(128, 128, 56, 0, Math.PI * 2);
    g.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  writeFileSync(picture, Buffer.from(data, "base64"));
  await page.close();
}

function walletScript({ owner, name }) {
  try {
    localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
  } catch {}
  const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const b64 = (bytes) => {
    let s = "";
    for (const byte of bytes) s += String.fromCharCode(byte);
    return btoa(s);
  };
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: ["solana:signTransaction"], label: name };
  const sign = async (...inputs) => {
    const out = [];
    for (const input of inputs) {
      const signed = await window.__standSign(input.chain ?? null, b64(input.transaction));
      if (!signed) throw new Error("User rejected the request.");
      out.push({ signedTransaction: bytesOf(signed) });
    }
    return out;
  };
  const wallet = {
    version: "1.0.0",
    name,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    chains: ["solana:devnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: sign },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

async function fromLive(route, request) {
  const url = new URL(request.url());
  const answer = await fetch(`${LIVE}${url.pathname}${url.search}`, { headers: { accept: request.headers().accept ?? "*/*" } }).catch(() => null);
  if (!answer) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
}

const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: LANG === "uk" ? "uk-UA" : "en-US" });
await context.exposeFunction("__standSign", (chain, wire) => {
  if (chain !== "solana:devnet") {
    journal.refused.push({ chain, at: new Date().toISOString() });
    return null;
  }
  const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((k) => k.toBase58());
  if (!signers.includes(OWNER)) {
    journal.refused.push({ chain, at: new Date().toISOString(), why: "not a signer" });
    return null;
  }
  tx.sign([key]);
  journal.signed.push({ at: new Date().toISOString(), signers, instructions: tx.message.compiledInstructions.length, bytes: tx.serialize().length });
  return Buffer.from(tx.serialize()).toString("base64");
});
await context.route("**/api/**", (route, request) => {
  const { pathname } = new URL(request.url());
  if (pathname === "/api/city" || pathname.startsWith("/api/icon/")) return fromLive(route, request);
  return route.continue();
});
await context.addInitScript(walletScript, { owner: OWNER, name: "Stand Wallet" });
await context.addInitScript((value) => {
  try {
    localStorage.setItem("ryntra.city.lang", value);
  } catch {}
  document.cookie = `ryntra_lang=${value}; path=/`;
}, LANG);

const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("response", async (response) => {
  const url = response.url();
  if (!/\/api\/v1\/launch\/dlmm-pro\/(build|submit)/.test(url)) return;
  const body = await response.json().catch(() => null);
  const kind = url.includes("/build") ? "builds" : "submits";
  const trimmed = body && typeof body === "object" ? Object.fromEntries(Object.entries(body).filter(([k]) => k !== "unsignedWireBase64")) : body;
  journal[kind].push({ status: response.status(), at: new Date().toISOString(), body: trimmed });
});
const visible = (selector) => page.locator(selector).filter({ visible: true }).first();
const shot = async (state) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `devnet-${state}-${LANG}.jpg`), quality: 86, type: "jpeg" });
  journal.states.push(state);
};

await page.goto(`${base}/launch`, { waitUntil: "domcontentloaded" });
await visible("[data-launch-screen]").waitFor({ timeout: 90_000 });
await page.waitForTimeout(3000);
if (process.env.RESUME === "1") {
  // A launch half-way: «My launches» takes it up, the form continues it — never a new coin.
  await visible("[role=tablist] [role=tab]:nth-child(2)").click();
  await visible("[data-launch-resume] button").waitFor({ timeout: 60_000 });
  await visible("[data-launch-resume] button").click();
  await page.waitForTimeout(2500);
  await shot("resume");
  // A launch taken up half-way says so and holds its one way on: «Continue» in the refusal itself.
  const goOn = page.locator("[data-launch-refusal-act]").filter({ visible: true });
  await ((await goOn.count()) ? goOn.first() : visible("[data-launch-act]")).click();
  // The old refusal gives way to the launch's own progress before the watch below reads it.
  await page.locator("[data-launch-phase]").first().waitFor({ timeout: 30_000 }).catch(() => {});
} else {
  await page.locator("[data-launch-picture] input[type=file]").setInputFiles(picture);
  await visible("[data-launch-name]").fill(process.env.COIN_NAME ?? "Dawn");
  await page.waitForTimeout(500);
  await visible("[data-launch-format] [role=radio]:nth-child(2)").click();
  if (LADDER) await visible("[data-launch-ladder] [role=switch]").click();
  await page.waitForTimeout(1500);
  await shot("form");
  await visible("[data-launch-act]").click();
}

// Three steps, each signed as it comes; the screen sends each one itself. Done when the coin stands in its pool.
const deadline = Date.now() + 8 * 60_000;
let end = null;
while (Date.now() < deadline) {
  if (await page.locator("[data-launch-landed]").count()) {
    end = "landed";
    break;
  }
  if (await page.locator("[data-launch-refusal]").count()) {
    end = `refused:${await page.locator("[data-launch-refusal]").first().getAttribute("data-launch-refusal")}`;
    break;
  }
  await page.waitForTimeout(1500);
}
await shot(end === "landed" ? "pooled" : "stopped");
if (end !== "landed" && (await page.locator("[data-launch-refusal] button").count()) > 1) {
  await page.locator("[data-launch-refusal] button").last().click();
  await page.waitForTimeout(400);
  journal.details = await page.locator("[data-launch-refusal]").first().innerText();
}
journal.end = end;
journal.errors = errors.slice(0, 20);
writeFileSync(path.join(out, "pool-devnet.json"), JSON.stringify(journal, null, 2));
console.log(JSON.stringify({ end, signed: journal.signed.length, builds: journal.builds.map((b) => [b.status, b.body?.stage ?? b.body?.error?.code]), submits: journal.submits.map((s) => [s.status, s.body?.state, s.body?.signatures]) }, null, 2));
await browser.close();
