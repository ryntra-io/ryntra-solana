// «Rewards» for the eyes, at 1920×1080, 1440×900 and 390×844, in English and Ukrainian
//   → <out>/<state>-<size>-<lang>.jpg
//   node terminal/rewards/shots.mjs [out] [baseUrl]
// A stand with the terminal open (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`). The page's own Chromium draws it (PRESS_CHROME
// may point at another). SIZES=wide,desk,phone, LANGS=en,uk and ONLY=<shot,shot> narrow a run; PARTNERS=1 adds «For
// partners» on a stand where the partner programme is open.
//
// What only a proven wallet has answers from the recorded answer of the Growth line's read (`./fixtures/answer.json`,
// the shape of `/api/rewards`): ready, asking for its one signature (401), still reading, or failed (503). The market is
// the page's own bundled snapshot (its SOL price turns dollars into SOL); every other route of the stand answers 503.
// The stand wallet connects and never signs.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? "docs/shots/city-308");
const base = process.argv[3] ?? "http://localhost:3308";
mkdirSync(out, { recursive: true });

const ANSWER = JSON.parse(readFileSync(path.join(here, "fixtures", "answer.json"), "utf8"));
const OWNER = ANSWER.address;

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const report = [];
/** The shapes one form allows: square, the cut, 4 px on what is pressed, circles («pill» — a logo, a dot, a switch). */
const FORM = new Set(["square", "cut", "r4", "pill"]);

/** Every visible box with a frame or a fill, and its shape. Runs in the page. */
function measure() {
  const boxes = [];
  const clear = /rgba\(0, 0, 0, 0\)|transparent/;
  for (const el of document.querySelectorAll("main *, [role='dialog'] *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 22) continue;
    if (r.bottom < 0 || r.top > innerHeight * 3 || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && !clear.test(cs[`border${s}Color`]));
    const framed = sides.length >= 3;
    const filled = !clear.test(cs.backgroundColor) || cs.backgroundImage !== "none";
    if (!framed && !filled) continue;
    const px = parseFloat(cs.borderTopLeftRadius) || 0;
    const half = Math.min(r.width, r.height) / 2;
    const cut = cs.clipPath && cs.clipPath !== "none";
    const shape = cut ? "cut" : px === 0 ? "square" : px >= half - 0.5 ? "pill" : `r${Math.round(px)}`;
    boxes.push({ shape, w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 28) });
  }
  return boxes;
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    /** How the Growth line's read answers now: the recorded answer, a proof asked for, never, or a failure. */
    const engine = { answer: "ready", asked: 0 };
    await context.route("**/api/**", (route) => json(route, {}, 503));
    await context.route("**/api/auth/solana/session*", (route) => json(route, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await context.route("**/api/rewards?*", (route) => {
      engine.asked += 1;
      if (engine.answer === "proof") return json(route, { error: "proof required", proof: false }, 401);
      if (engine.answer === "failed") return json(route, { ok: false, error: "REWARDS_UNAVAILABLE" }, 503);
      if (engine.answer === "reading") return undefined;
      return json(route, { ...ANSWER, address: new URL(route.request().url()).searchParams.get("address") ?? OWNER });
    });

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource|503|401|404/.test(message.text())) errors.push(`${new URL(page.url()).search} ${message.text().slice(0, 90)}`);
    });
    // A stub wallet in the Wallet Standard registry: it connects and never signs.
    await page.addInitScript(({ address }) => {
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
      const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { address: OWNER });

    const file = (name) => path.join(out, `${name}-${size.name}-${lang}.jpg`);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const ambers = () =>
      page.evaluate(() => [...document.querySelectorAll("main button, main a")].filter((el) => el.offsetParent !== null && /ui_act__|ui-module__.*__act\b/.test(String(el.className))).map((el) => el.textContent.trim()));
    const shot = async (name, { full = false } = {}) => {
      if (ONLY && !ONLY.has(name)) return;
      await page.waitForTimeout(600);
      await page.screenshot({ path: file(name), quality: 86, type: "jpeg", fullPage: full });
      const boxes = await page.evaluate(measure);
      const odd = boxes.filter((box) => !FORM.has(box.shape));
      const tally = {};
      for (const box of boxes) tally[box.shape] = (tally[box.shape] ?? 0) + 1;
      report.push(`${size.name}/${lang} ${name}: shapes ${JSON.stringify(tally)}${odd.length ? ` — outside the form: ${JSON.stringify(odd.slice(0, 4))}` : ""}; amber ${JSON.stringify(await ambers())}; overflow ${await overflow()}px`);
    };
    const open = async ({ wallet, tab = null, answer = "ready" }) => {
      engine.answer = answer;
      await page.goto(`${base}/rewards?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 }).catch(() => {});
      await page.evaluate((on) => {
        try {
          if (on) localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
          else localStorage.removeItem("ryntra.solana.wallet-hint.v1");
        } catch {}
      }, wallet);
      await page.goto(`${base}/rewards?lang=${lang}${tab ? `&tab=${tab}` : ""}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForSelector("[data-rewards-screen]", { timeout: 300_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForTimeout(wallet ? 4_000 : 1_500);
      if (wallet && answer !== "reading") await page.waitForSelector(`[data-rewards-screen][data-state="${answer === "proof" ? "prove" : answer}"]`, { timeout: 30_000 }).catch(() => report.push(`${size.name}/${lang}: the state «${answer}» did not come`));
    };

    // ── no wallet: one line of what earns, «Connect wallet», the rules beside ──
    await open({ wallet: false });
    await shot("points-no-wallet");
    await open({ wallet: false, tab: "invite" });
    await shot("invite-no-wallet");

    // ── a wallet whose proof is not here: one signature, no transaction ──
    await open({ wallet: true, answer: "proof" });
    await shot("points-sign");

    // ── the proven wallet: points, level, place, rank, cashback; the link and what friends brought ──
    await open({ wallet: true });
    await shot("points");
    if (size.mobile) await shot("points-full", { full: true });
    await open({ wallet: true, tab: "invite" });
    await shot("invite");
    if (size.mobile) await shot("invite-full", { full: true });

    // ── «For partners»: only on a stand where the programme is open (PARTNERS=1 says the stand was built so) ──
    if (process.env.PARTNERS === "1") {
      await open({ wallet: true, tab: "partners" });
      await shot("partners");
    }

    // ── the read under way, and a read that failed (one size is enough to see the place they keep) ──
    if (size.name !== "wide") {
      await open({ wallet: true, answer: "reading" });
      await shot("points-reading");
      await open({ wallet: true, answer: "failed" });
      await shot("points-failed");
    }

    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.slice(0, 3).join(" | ")}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
