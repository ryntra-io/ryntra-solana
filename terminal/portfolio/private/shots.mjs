// Ryntra Private for the eyes and on the test network at once — the private balance in Portfolio, a private link's page
// and the wallet check, driven through the page itself, Ryntra's relay and Helius devnet.
//   node terminal/portfolio/private/shots.mjs [out] [baseUrl]
// A stand with NEXT_PUBLIC_RYNTRA_TERMINAL=stand, NEXT_PUBLIC_RYNTRA_PRIVATE=devnet and HELIUS_DEVNET_API_KEY in the
// server's environment. The system Chrome draws (PRESS_CHROME may point at another).
//
// The wallet in the page is a Wallet Standard stub on `solana:devnet` that declares versions legacy, 0 and 1. Every
// signature it is asked for goes to this script, which signs the exact bytes with a devnet stand key (PASS_PERSON_KEY;
// the claim page — a fresh key with no SOL) and gives them back: the page builds, the person «signs», the relay sends.
// Keys stay in this process and are never printed. Out: <state>-<size>-<lang>.jpg and signatures.md (what landed).
//   SIZES=wide2560,wide,phone  LANGS=uk,en  SHOTS_COPY=<a key copy from an earlier run>
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

globalThis.isSecureContext = true;
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const out = path.resolve(process.argv[2] ?? "docs/shots/city-273");
const base = process.argv[3] ?? "http://localhost:3273";
if (/mainnet/i.test(base)) process.exit(3);
mkdirSync(out, { recursive: true });

const sdk = await import(pathToFileURL(path.join(ROOT, "public/privacy/spr-0.9.0-alpha.mjs")).href);
const keyFile = process.env.PASS_PERSON_KEY;
if (!keyFile) {
  console.error("PASS_PERSON_KEY — a devnet key file outside the repository, with ≈ 0.05 devnet SOL.");
  process.exit(2);
}
const raw = JSON.parse(readFileSync(keyFile, "utf8"));
const person = await sdk.createKeyPairSignerFromPrivateKeyBytes(new Uint8Array((Array.isArray(raw) ? raw : raw.secretKey).slice(0, 32)));
const taker = await sdk.createKeyPairSignerFromPrivateKeyBytes(crypto.getRandomValues(new Uint8Array(32)));
const stranger = await sdk.createKeyPairSignerFromPrivateKeyBytes(crypto.getRandomValues(new Uint8Array(32)));

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "wide2560", width: 2560, height: 1440, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const landed = [];
const errors = [];

/** A context whose page holds a stub wallet signing with `signer` — on devnet, versions legacy, 0 and 1. */
/** A phone's own browser, as a person without a wallet app opens a link from a chat. */
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** `walletless` — no wallet in the page at all; on a phone, a phone's own browser. */
async function contextFor(signer, size, lang, { walletless = false } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", ...(walletless && size.mobile ? { userAgent: PHONE_UA } : {}) });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem("ryntra-lang", l);
      localStorage.setItem("ryntra.city.lang", l);
    } catch {}
  }, lang);
  await context.exposeFunction("__standSign", async (b64) => {
    const tx = sdk.getTransactionDecoder().decode(Uint8Array.from(Buffer.from(b64, "base64")));
    const signed = await sdk.partiallySignTransactionWithSigners([signer], tx);
    return Buffer.from(sdk.getTransactionEncoder().encode(signed)).toString("base64");
  });
  await context.exposeFunction("__standSignMessage", async (b64) => {
    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    const [signatures] = await signer.signMessages([{ content: bytes, signatures: {} }]);
    return Buffer.from(signatures[signer.address]).toString("base64");
  });
  if (!walletless) await context.addInitScript(({ address }) => {
    const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
    const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
    const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Test" };
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
          signTransaction: async (...inputs) => Promise.all(inputs.map(async ({ transaction }) => ({ signedTransaction: unb64(await window.__standSign(b64(transaction))) }))),
        },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async (...inputs) => Promise.all(inputs.map(async ({ message }) => ({ signedMessage: message, signature: unb64(await window.__standSignMessage(b64(message))) }))),
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { address: signer.address });
  // The wallet's open money is not this pass: Portfolio's own read answers from a recorded shape (the main column), so
  // the side column — the private balance, live on the test network — stands. Reads it does not need answer 503 at once.
  await context.route("**/api/v1/portfolio?*", (route) => {
    const at = new Date().toISOString();
    const owner = new URL(route.request().url()).searchParams.get("owner") ?? signer.address;
    const sol = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, amountRaw: "80000000", usd: 11.2, role: "held" };
    const refs = { program: "11111111111111111111111111111111", pool: null, position: null, nftMint: null, market: null, account: null };
    const row = { id: "wallet:sol", protocol: "wallet", kind: "coin", label: "SOL", platform: null, state: "read", origin: "chain", earned: null, inRange: null, value: { usd: 11.2, sol: 0.08 }, tokens: [sol], exit: { oneStep: true, how: "swap", reason: null, partBps: 10_000, untilEpoch: null, untilTime: null }, refs, readAt: at };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ network: "solana:mainnet", owner, at, solUsd: 140, totals: { usd: 11.2, sol: 0.08, earnedUsd: 0, projectedUsd: 0, complete: true }, positions: [row], sources: [{ source: "wallet", state: "read", reason: null, readAt: at, positions: 1 }] }) });
  });
  for (const pattern of ["**/api/v1/portfolio/exit?*", "**/api/liquidity/positions?*", "**/api/v1/wallet/clean?*", "**/api/v1/wallet/clean/back?*", "**/api/solana/activity*"]) await context.route(pattern, (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  // The person's sign-in to Ryntra is not this pass: the stand answers «not signed in».
  await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${size.name}: ${String(error)}`));
  if (process.env.SHOTS_TRACE) {
    page.on("console", (m) => console.log("  console:", m.type(), m.text().slice(0, 300)));
    page.on("response", (r) => /privacy/.test(r.url()) && console.log("  relay:", r.status(), r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 90)));
  }
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource|503|404|401/.test(message.text())) errors.push(`${size.name}: ${message.text()}`);
  });
  return { context, page };
}

/** Opens a page; a stand that answered 500 (the market's upstream said 429) is asked again, a few times. */
async function open(page, url) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const here = attempt > 0 || page.url() === url;
    const answer = here ? await page.reload({ waitUntil: "domcontentloaded", timeout: 300_000 }) : await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300_000 });
    if (answer && answer.status() < 500) return;
    await page.waitForTimeout(15_000);
  }
  throw new Error(`${url}: the stand kept answering 500`);
}

/** Connects the stub the way a returning person's wallet comes back: the wallet's hint, then the page again. */
async function connect(page) {
  await page.evaluate(() => localStorage.setItem("ryntra.solana.wallet-hint.v1", "Backpack"));
  await open(page, page.url());
  await page.waitForTimeout(4500);
}

const shot = async (page, name, size, lang, locator) => {
  const file = path.join(out, `${name}-${size.name}-${lang}.jpg`);
  if (locator) await locator.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, type: "jpeg", quality: 82 });
  console.log(`  ${path.basename(file)}`);
};

const block = (page) => page.locator('section[aria-label="Приватний баланс"], section[aria-label="Private balance"]').first();
const button = (page, uk, en) => page.getByRole("button", { name: new RegExp(`^(${uk}|${en})$`) }).first();
const waitIdle = async (page, label) => {
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 240_000 });
  if (!label) return;
  const href = await page.locator('a[href*="explorer.solana.com/tx/"]').last().getAttribute("href", { timeout: 5_000 }).catch(() => null);
  const sig = href ? /\/tx\/([1-9A-HJ-NP-Za-km-z]+)/.exec(href)?.[1] : null;
  landed.push([label, sig ?? "(no signature on the screen)"]);
};

/*
 * SHOTS_CLAIM=<a link's address> — only the link's page, without spending it: no wallet (a computer: «connect»; a phone's
 * own browser: «copy the link and open it in your wallet's browser»), and the wallet of PASS_PERSON_KEY, which has a
 * private balance (its first action: «take to my private balance», recipient and amount hidden).
 */
if (process.env.SHOTS_CLAIM) {
  const url = process.env.SHOTS_CLAIM;
  const settled = (page) => page.waitForFunction(() => !/Читаємо приватний|Reading the private/.test(document.body.innerText) && document.querySelector('[data-screen="private-claim"] button'), null, { timeout: 180_000 });
  for (const size of SIZES) {
    for (const lang of LANGS) {
      console.log(`${size.name} ${lang}`);
      const bare = await contextFor(person, size, lang, { walletless: true });
      await open(bare.page, url.replace("#", `?lang=${lang}#`));
      await settled(bare.page);
      await shot(bare.page, "8-claim-connect", size, lang);
      if (size.mobile) {
        const text = await bare.page.locator('[data-screen="private-claim"]').innerText();
        if (!/скопіюй|copy it/i.test(text) || /Phantom/.test(text)) throw new Error(`phone without a wallet: ${text.slice(0, 200)}`);
      }
      await bare.context.close();
      const own = await contextFor(person, size, lang);
      await open(own.page, url.replace("#", `?lang=${lang}#`));
      await connect(own.page);
      await own.page.getByRole("button", { name: /^(Забрати в приватний баланс|Take to my private balance)$/ }).first().waitFor({ timeout: 180_000 });
      await shot(own.page, "9-claim-private", size, lang);
      await own.context.close();
    }
  }
  await browser.close();
  writeFileSync(path.join(out, "errors.txt"), errors.join("\n") || "none");
  console.log(errors.length ? `page errors: ${errors.length} (errors.txt)` : "no page errors");
  process.exit(0);
}

let linkUrl = null;
// SHOTS_COPY — a key copy saved by an earlier run: the balance is already on, the run opens it with the copy.
let copyPath = process.env.SHOTS_COPY ?? null;
let first = !copyPath;
for (const size of SIZES) {
  for (const lang of LANGS) {
    console.log(`${size.name} ${lang}`);
    const { context, page } = await contextFor(person, size, lang);
    await open(page, `${base}/portfolio?lang=${lang}`);
    await connect(page);
    await block(page).waitFor({ timeout: 60_000 }).catch(async (error) => {
      await page.screenshot({ path: path.join(os.tmpdir(), "ryntra-private-shots-fail.jpg"), type: "jpeg" });
      throw error;
    });
    await page.waitForFunction(() => !/Читаємо приватний|Reading the private/.test(document.body.innerText), null, { timeout: 120_000 });
    if (first) {
      // The whole flow, once, on the test network: on, hide, a link.
      await shot(page, "1-off", size, lang, block(page));
      await button(page, "Увімкнути", "Turn on").click();
      await page.locator('a[href*="explorer.solana.com/tx/"], [data-failure]').first().waitFor({ timeout: 300_000 });
      await waitIdle(page, "turn on (registration)");
      await shot(page, "2-on-copy", size, lang, block(page));
      // The key copy, saved as a person would — outside the repository; the other sizes open the balance with it.
      const [download] = await Promise.all([page.waitForEvent("download"), button(page, "Зберегти копію ключів", "Save key copy").click()]);
      copyPath = path.join(os.tmpdir(), `ryntra-private-shots-${Date.now()}.txt`);
      await download.saveAs(copyPath);
      const amount = block(page).locator("input").first();
      await amount.fill("0.02");
      await shot(page, "3-hide-form", size, lang, block(page));
      const before = await page.locator('a[href*="explorer.solana.com/tx/"]').first().getAttribute("href");
      await button(page, "Сховати", "Hide").last().click();
      await page.waitForFunction((was) => document.querySelector("[data-failure]") || (document.querySelector('a[href*="explorer.solana.com/tx/"]')?.getAttribute("href") ?? was) !== was, before, { timeout: 300_000 });
      await waitIdle(page, "hide 0.02");
      await shot(page, "4-hidden", size, lang, block(page));
      await block(page).getByRole("radio", { name: /Надіслати|Send/ }).or(block(page).getByRole("tab", { name: /Надіслати|Send/ })).first().click();
      await block(page).getByPlaceholder(/^0$/).first().fill("0.004").catch(() => block(page).locator('input[inputmode="decimal"]').first().fill("0.004"));
      await block(page).getByPlaceholder(/Адреса Solana|Solana address/).fill(stranger.address);
      await button(page, "Надіслати приватно", "Send privately").click();
      await page.getByText(/посиланням|as a link/).first().waitFor({ timeout: 60_000 });
      await shot(page, "5-needs-link", size, lang, block(page));
      await button(page, "Надіслати посиланням", "Send as a link").click();
      // The link's secret is made before the step marks itself busy: wait for its result, not for «not busy».
      await page.locator('[class*="linkText"], [data-failure]').first().waitFor({ timeout: 300_000 });
      const failed = await page.locator("[data-failure]").first().getAttribute("data-failure").catch(() => null);
      if (failed) throw new Error(`link: ${failed}`);
      await waitIdle(page, "send 0.004 as a link (last of three)");
      linkUrl = (await block(page).locator('[class*="linkText"]').first().innerText({ timeout: 30_000 }).catch(async (error) => {
        await page.screenshot({ path: path.join(os.tmpdir(), "ryntra-private-shots-fail.jpg"), type: "jpeg" });
        throw error;
      })).trim();
      await shot(page, "6-link-ready", size, lang, block(page));
      first = false;
    } else {
      // Another browser: the balance is on, its keys are not here — opened with the saved copy.
      await page.getByText(/іншому пристрої|another device/).first().waitFor({ timeout: 60_000 });
      await shot(page, "0-elsewhere", size, lang, block(page));
      await block(page).locator('input[type="file"]').setInputFiles(copyPath);
      await page.waitForFunction(() => !/іншому пристрої|another device/.test(document.body.innerText), null, { timeout: 120_000 });
      await waitIdle(page);
      await shot(page, "4-hidden", size, lang, block(page));
    }
    // The private balance's «i», open.
    await block(page).getByRole("button", { name: /Як працює приватний|How the private balance/ }).click();
    await shot(page, "7-how", size, lang, block(page));
    await context.close();

    // A private link, opened by someone with no SOL at all.
    if (linkUrl) {
      const claim = await contextFor(taker, size, lang);
      await open(claim.page, linkUrl.replace("#", `?lang=${lang}#`));
      await claim.page.waitForFunction(() => !/Читаємо приватний|Reading the private/.test(document.body.innerText), null, { timeout: 120_000 });
      await shot(claim.page, "8-claim-connect", size, lang);
      await connect(claim.page);
      await shot(claim.page, "9-claim", size, lang);
      if (size === SIZES[0] && lang === LANGS[0]) {
        await button(claim.page, "Забрати в гаманець", "Take to my wallet").click();
        await claim.page.getByText(/^(Забрано|Taken)/).first().waitFor({ timeout: 240_000 });
        const href = await claim.page.locator('a[href*="explorer.solana.com/tx/"]').last().getAttribute("href").catch(() => null);
        landed.push(["link taken by a wallet with 0 SOL", href ? /\/tx\/([1-9A-HJ-NP-Za-km-z]+)/.exec(href)?.[1] : "(none)"]);
        await shot(claim.page, "10-claimed", size, lang);
      }
      await claim.context.close();
    }

    // The wallet check, with the stub: both envelope signatures and a v1 transaction.
    const check = await contextFor(person, size, lang);
    await open(check.page, `${base}/private/check?lang=${lang}`);
    await connect(check.page);
    await button(check.page, "Підписати конверт", "Sign envelope").click();
    await waitIdle(check.page);
    await button(check.page, "Підписати ще раз", "Sign again").click();
    await waitIdle(check.page);
    await button(check.page, "Підписати v1", "Sign v1").click();
    await waitIdle(check.page);
    await shot(check.page, "11-check", size, lang);
    await check.context.close();
  }
}
await browser.close();
if (copyPath && !process.env.SHOTS_COPY) rmSync(copyPath, { force: true });

writeFileSync(path.join(out, "signatures.md"), ["| Step (through the page and the relay) | Signature |", "| --- | --- |", ...landed.map(([label, sig]) => `| ${label} | \`${sig}\` |`)].join("\n") + "\n");
writeFileSync(path.join(out, "errors.txt"), errors.join("\n") || "none");
console.log(errors.length ? `page errors: ${errors.length} (errors.txt)` : "no page errors");
console.log(`person ${person.address} · taker ${taker.address} · link to ${stranger.address}`);
