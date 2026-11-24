// For the eyes: the private balance's keys from the wallet — every new state, desk and phone, EN and UK —
// with no money, no Helius key and no network. The relay is answered here: the ring's registry holds what each state
// needs (no record; a record with this wallet's own keys; a record with other keys), the chain is a fixed blockhash, and
// the wallet in the page is a Wallet Standard stub that signs messages with a throwaway key made by this script and
// never returns a signed transaction (the shot stops at «sign in your wallet»). Nothing is sent anywhere.
//   node terminal/portfolio/private/keys-shots.mjs [out] [baseUrl]
// A stand with NEXT_PUBLIC_RYNTRA_TERMINAL=stand and NEXT_PUBLIC_RYNTRA_PRIVATE=devnet. SIZES=desk,phone LANGS=en,uk
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

globalThis.isSecureContext = true;
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const out = path.resolve(process.argv[2] ?? "docs/shots/city-344");
const base = process.argv[3] ?? "http://localhost:3344";
mkdirSync(out, { recursive: true });

const sdk = await import(pathToFileURL(path.join(ROOT, "public/privacy/spr-0.9.0-alpha.mjs")).href);
await sdk.initializePoseidon();
const OFFLINE = { prove: async () => { throw new Error("offline"); }, proveMerge: async () => { throw new Error("offline"); } };
const signer = await sdk.createKeyPairSignerFromPrivateKeyBytes(crypto.getRandomValues(new Uint8Array(32)));
const sign = async (bytes) => new Uint8Array(await sdk.signBytes(signer.keyPair.privateKey, bytes));

// The record this wallet's own keys would make, and one with other keys (another app, older keys).
const request = sdk.ed25519DerivationMessage(sdk.getAddressEncoder().encode(signer.address));
const ownAddress = sdk.LocalKeys.fromDerivationSeed({ solanaPublicKey: signer.address, derivationSeed: await sign(request) }, OFFLINE).address();
const otherAddress = sdk.ShieldedAddress.fromPublicKeys(
  sdk.ShieldedPublicKey.fromEd25519(sdk.getAddressEncoder().encode(signer.address)),
  sdk.NullifierKey.fromSecret(crypto.getRandomValues(new Uint8Array(31))).publicKey(),
  sdk.ViewingKey.generate().publicKey(),
);
// 32 bytes as base58, the way the indexer writes a hash (an address decoder does exactly that).
const b58 = (bytes) => sdk.getAddressDecoder().decode(bytes);
const recordOf = (address) => ({ owner: signer.address, nullifierPubkey: b58(address.nullifierPublicKey), viewingPubkey: Buffer.from(address.viewingPublicKey.toBytes()).toString("base64"), mergeEncryption: 0 });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const errors = [];
const unanswered = new Set();

/**
 * A page with the stub wallet and the relay answered here. `record` — what the registry holds for the wallet: null,
 * 'own' or 'other'. `wallet` — 'steady' signs the key request the same way every time; 'fickle' differently each time;
 * 'mute' has no message signing. `slow` — ms the chain takes to answer while the registration is prepared.
 */
async function pageFor(size, lang, { record = null, wallet = "steady", slow = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem("ryntra-lang", l);
      localStorage.setItem("ryntra.city.lang", l);
      localStorage.setItem("ryntra.solana.wallet-hint.v1", "Backpack");
    } catch {}
  }, lang);
  await context.exposeFunction("__keysSign", async (b64) => {
    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    const signature = wallet === "fickle" ? crypto.getRandomValues(new Uint8Array(64)) : await sign(bytes);
    return Buffer.from(signature).toString("base64");
  });
  await context.exposeFunction("__keysSignTx", async (b64) => {
    // Version 1 for the wallet check: signed and given back. The private balance's own transactions wait forever.
    const tx = sdk.getTransactionDecoder().decode(Uint8Array.from(Buffer.from(b64, "base64")));
    const signed = await sdk.partiallySignTransactionWithSigners([signer], tx);
    return Buffer.from(sdk.getTransactionEncoder().encode(signed)).toString("base64");
  });
  await context.addInitScript(({ address, mute }) => {
    const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
    const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
    const features = mute ? ["solana:signTransaction"] : ["solana:signTransaction", "solana:signMessage"];
    const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet", "solana:devnet"], features, label: "Test" };
    const wallet = {
      version: "1.0.0",
      name: "Backpack",
      icon,
      chains: ["solana:mainnet", "solana:devnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0, 1],
          signTransaction: async (...inputs) => {
            if (!location.pathname.startsWith("/private/check")) return new Promise(() => {});
            return Promise.all(inputs.map(async ({ transaction }) => ({ signedTransaction: unb64(await window.__keysSignTx(b64(transaction))) })));
          },
        },
        ...(mute
          ? {}
          : {
              "solana:signMessage": {
                version: "1.0.0",
                signMessage: async (...inputs) => {
                  await new Promise((resolve) => setTimeout(resolve, window.__keysPause ?? 0));
                  return Promise.all(inputs.map(async ({ message }) => ({ signedMessage: message, signature: unb64(await window.__keysSign(b64(message))) })));
                },
              },
            }),
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { address: signer.address, mute: wallet === "mute" });

  // The ring's indexer: the registry's record; the rest of a balance read answers empty.
  const held = record === "own" ? recordOf(ownAddress) : record === "other" ? recordOf(otherAddress) : null;
  const ctxAnswer = { slot: 400000000, blockTime: 1763500000 };
  await context.route("**/api/v1/privacy/devnet/spr**", async (route) => {
    const body = route.request().postDataJSON?.() ?? null;
    const method = body?.method;
    if (method === "getUserRecords") return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: { context: ctxAnswer, records: body.params.owners.map((o) => (o === signer.address ? held : null)) } } });
    if (method === "getEncryptedUtxosByTags" || method === "getShieldedTransactionsByTags" || method === "getShieldedTransactionsByNullifiers") {
      return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: { context: ctxAnswer, data: [], paginationToken: null, outputTreeId: 0 } } });
    }
    unanswered.add(`spr ${method ?? route.request().url()}`);
    return route.fulfill({ status: 503, body: "" });
  });
  await context.route("**/api/v1/privacy/devnet/rpc**", async (route) => {
    const body = route.request().postDataJSON?.() ?? null;
    const one = (call) => {
      const context = { slot: 400000000 };
      if (call.method === "getLatestBlockhash") return { jsonrpc: "2.0", id: call.id, result: { context, value: { blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N", lastValidBlockHeight: 400000150 } } };
      if (call.method === "getAccountInfo") return { jsonrpc: "2.0", id: call.id, result: { context, value: null } };
      if (call.method === "getMultipleAccounts") return { jsonrpc: "2.0", id: call.id, result: { context, value: (call.params?.[0] ?? []).map(() => null) } };
      if (call.method === "getSlot") return { jsonrpc: "2.0", id: call.id, result: 400000000 };
      unanswered.add(`rpc ${call.method}`);
      return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "not on this stand" } };
    };
    if (slow) await new Promise((resolve) => setTimeout(resolve, slow));
    return route.fulfill({ json: Array.isArray(body) ? body.map(one) : one(body) });
  });
  // Portfolio's own reads are not this pass: the wallet's open money from a recorded shape, the rest answers 503.
  await context.route("**/api/v1/portfolio?*", (route) => {
    const at = new Date().toISOString();
    const sol = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, amountRaw: "80000000", usd: 11.2, role: "held" };
    const refs = { program: "11111111111111111111111111111111", pool: null, position: null, nftMint: null, market: null, account: null };
    const row = { id: "wallet:sol", protocol: "wallet", kind: "coin", label: "SOL", platform: null, state: "read", origin: "chain", earned: null, inRange: null, value: { usd: 11.2, sol: 0.08 }, tokens: [sol], exit: { oneStep: true, how: "swap", reason: null, partBps: 10_000, untilEpoch: null, untilTime: null }, refs, readAt: at };
    return route.fulfill({ json: { network: "solana:mainnet", owner: signer.address, at, solUsd: 140, totals: { usd: 11.2, sol: 0.08, earnedUsd: 0, projectedUsd: 0, complete: true }, positions: [row], sources: [{ source: "wallet", state: "read", reason: null, readAt: at, positions: 1 }] } });
  });
  for (const pattern of ["**/api/v1/portfolio/exit?*", "**/api/liquidity/positions?*", "**/api/v1/wallet/clean?*", "**/api/v1/wallet/clean/back?*", "**/api/solana/activity*"]) await context.route(pattern, (route) => route.fulfill({ status: 503, json: {} }));
  await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ json: { signedIn: false, walletAddress: null, proof: null, at: Date.now() } }));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${size.name}: ${String(error)}`));
  return { context, page };
}

const block = (page) => page.locator('section[aria-label="Приватний баланс"], section[aria-label="Private balance"]').first();
const button = (page, uk, en) => page.getByRole("button", { name: new RegExp(`^(${uk}|${en})`) }).first();

async function shot(page, name, size, lang, locator) {
  if (locator) await locator.scrollIntoViewIfNeeded().catch(() => {});
  const failure = await page.locator("[data-failure]").first().getAttribute("data-failure", { timeout: 500 }).catch(() => null);
  if (failure) errors.push(`${name}-${size.name}-${lang}: the block says ${failure}`);
  await page.waitForTimeout(300);
  const file = path.join(out, `${name}-${size.name}-${lang}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 82 });
  console.log(`  ${path.basename(file)}`);
}

async function portfolio(size, lang, opts) {
  const made = await pageFor(size, lang, opts);
  await made.page.goto(`${base}/portfolio?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await block(made.page).waitFor({ timeout: 120_000 });
  await made.page.waitForFunction(() => !/Читаємо приватний|Reading the private/.test(document.body.innerText), null, { timeout: 120_000 });
  return made;
}

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
for (const size of SIZES) {
  for (const lang of LANGS) {
    console.log(`${size.name} ${lang}`);

    // 1. Not turned on: three signatures named before the first one.
    {
      const { context, page } = await portfolio(size, lang, { slow: 9_000 });
      await shot(page, "1-off", size, lang, block(page));
      // 2. Turning on: the key request, then preparing with the seconds, then the wallet's signature.
      await page.evaluate(() => (window.__keysPause = 2500));
      await button(page, "Увімкнути", "Turn on").click();
      await page.getByRole("button", { name: /^(Підпиши запит ключів|Sign the key request)/ }).waitFor({ timeout: 30_000 });
      await shot(page, "2-keys", size, lang, block(page));
      await page.getByRole("button", { name: /^(Готуємо приватно|Preparing privately) · [1-9]/ }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(4_000);
      await shot(page, "3-preparing", size, lang, block(page));
      await page.getByRole("button", { name: /^(Підпиши в гаманці|Sign in your wallet)$/ }).waitFor({ timeout: 60_000 });
      await shot(page, "4-sign", size, lang, block(page));
      await context.close();
    }
    // 5. Turned on with this wallet's keys, not open in this tab yet: one signature opens it.
    {
      const { context, page } = await portfolio(size, lang, { record: "own" });
      await shot(page, "5-locked", size, lang, block(page));
      await button(page, "Відкрити", "Open").click();
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 60_000 });
      await page.waitForTimeout(800);
      await shot(page, "6-open", size, lang, block(page));
      await context.close();
    }
    // 7. Turned on elsewhere with other keys (Solflare Private Mode, older keys): nothing is written.
    {
      const { context, page } = await portfolio(size, lang, { record: "other" });
      await button(page, "Відкрити", "Open").click();
      await page.getByText(/Увімкнено деінде|Turned on elsewhere/).first().waitFor({ timeout: 60_000 });
      await shot(page, "7-elsewhere", size, lang, block(page));
      await context.close();
    }
    // 8. A wallet whose two answers differ: one honest line, nothing written.
    {
      const { context, page } = await portfolio(size, lang, { wallet: "fickle" });
      await button(page, "Увімкнути", "Turn on").click();
      await page.getByText(/поки не вміє|can't open a private balance/).first().waitFor({ timeout: 60_000 });
      await shot(page, "8-cannot", size, lang, block(page));
      await context.close();
    }
    // 9. The wallet check: all three checks run, the summary one tap away.
    {
      const { context, page } = await pageFor(size, lang, { record: "other" });
      await page.goto(`${base}/private/check?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await button(page, "Підписати запит ключів двічі", "Sign the key request twice").click();
      await page.getByText(/Дає ключі|Gives the keys/).waitFor({ timeout: 60_000 });
      await button(page, "Підписати v1", "Sign v1").click();
      await page.getByText(/Підписує версію 1|Signs version 1/).waitFor({ timeout: 60_000 });
      await button(page, "Перевірити адресу", "Check this address").click();
      await page.getByText(/з іншими ключами|with other keys/).waitFor({ timeout: 60_000 });
      await shot(page, "9-check", size, lang);
      await button(page, "Деталі", "Details").click();
      await shot(page, "10-check-details", size, lang, page.locator("dl").first());
      await context.close();
    }
  }
}
await browser.close();
writeFileSync(path.join(out, "errors.txt"), [...errors, ...[...unanswered].map((u) => `unanswered: ${u}`)].join("\n") || "none");
console.log(errors.length ? `page errors: ${errors.length} (errors.txt)` : "no page errors");
if (unanswered.size) console.log(`unanswered on the stand: ${[...unanswered].join(", ")}`);
