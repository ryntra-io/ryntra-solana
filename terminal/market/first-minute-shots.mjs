// The first minute, second pass, for the eyes: the Market as the home page and the agent's ticket it opens,
// at 1440×900, 1920×1080 and 390×844, in English and Ukrainian → <out>/*.jpg and <out>/report.txt.
//   node terminal/market/first-minute-shots.mjs <out> [baseUrl]
// A stand runs as people will get it: NEXT_PUBLIC_RYNTRA_TERMINAL=open with production's switches, next build && next
// start. The system Chrome draws the page (PRESS_CHROME may point at another). Moments:
//   home    — no wallet: the agent's panel with the risk's edge in words, the header's wallet with its word;
//   wallets — the header's wallet tapped: the window, its one calm line on what connecting does;
//   said    — «Trade JUP every day» tapped: the agent's ticket, the edge before a budget, «Practice first» first;
//   plan    — a day of 0.5 SOL written: the edge says the person's own day;
//   note    — a sentence the agent asks about: its answer by the field (over a phone's dock);
//   practice— «Practice first» tapped with no wallet: the agent on paper, nothing connected, nothing signed;
//   seeker  — a phone that says it is a Seeker: «Seed Vault» in the header, Seeker Connect first in a ticket's wallets.
// The test wallet answers the browser's wallet standard and refuses every signature it is asked for: nothing is signed.
// The funnel: every moment the page sends to /api/track is caught (never stored) and written to the report.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-281");
const base = process.argv[3] ?? "http://localhost:3281";
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
const SEEKER_UA = "Mozilla/5.0 (Linux; Android 14; Seeker) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const report = [];
const funnel = [];

// The test wallets offer no account: a tap shows the list, a connect answers nothing, a signature is refused.
function walletScript({ names }) {
  const asked = [];
  window.__standAsked = asked;
  for (const name of names) {
    const refuse = (what) => async () => {
      asked.push(what);
      throw new Error("User rejected the request.");
    };
    const wallet = {
      version: "1.0.0",
      name,
      // No icon of its own: the window and the tickets take the catalog's logo of a wallet they know.
      icon: null,
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => (asked.push("connect"), { accounts: [] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => undefined },
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
}

async function open({ size, lang, ua = null }) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.mobile ? 2 : 1,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    locale: lang === "uk" ? "uk-UA" : "en-US",
    ...(ua ? { userAgent: ua } : {}),
  });
  const track = [];
  await context.route("**/api/track", (route) => {
    try {
      const body = JSON.parse(route.request().postData() ?? "{}");
      for (const row of Array.isArray(body.events) ? body.events : [body]) if (row?.name) track.push(row.name);
    } catch {}
    return route.fulfill({ status: 204, body: "" });
  });
  // Two wallets, so a tap shows the list — with one, the header connects it at once.
  await context.addInitScript(walletScript, { names: ["Phantom", "Solflare"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return { context, page, track, errors };
}

const settle = async (page) => {
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
};
const shot = async (page, name, full = false) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), quality: 86, type: "jpeg", fullPage: full });
};
const text = async (page, selector) => ((await page.locator(selector).first().textContent({ timeout: 5_000 }).catch(() => null)) ?? "—").replace(/\s+/g, " ").trim();
const tap = (size, locator) => (size.mobile ? locator.tap() : locator.click());
const home = async (page, lang) => {
  await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[data-terminal='hero']", { timeout: 180_000 });
  await page.waitForResponse((res) => res.url().includes("/api/city"), { timeout: 20_000 }).catch(() => {});
  await settle(page);
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const tag = `${size.name}-${lang}`;
    const { context, page, track, errors } = await open({ size, lang });

    // home — the panel, its edge in words, the header's wallet.
    await home(page, lang);
    // «Say» where this width draws it: the panel on a desk, the dock over the tab bar on a phone.
    const go = await page.locator(size.mobile ? "[data-terminal='ask-dock'] button[type='submit']" : "[data-terminal='hero'] button[type='submit']").boundingBox();
    report.push(`${tag} home: edge «${await text(page, "[data-hero-limit]")}» · wallet «${await text(page, "[data-terminal='wallet']")}» · «Say» at ${Math.round(go?.y ?? -1)}–${Math.round((go?.y ?? 0) + (go?.height ?? 0))} of ${size.height} px · sentences «${(await page.locator("[data-terminal='hero'] [data-say]").allTextContents()).join(" | ")}» · side scroll ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}`);
    await shot(page, `home-${tag}`);

    // wallets — the header's window and its one calm line.
    await tap(size, page.locator("[data-terminal='wallet']").first());
    await page.waitForTimeout(900);
    report.push(`${tag} wallets: «${(await page.locator("[role='dialog']").first().innerText().catch(() => "—")).replace(/\s+/g, " ").slice(0, 300)}»`);
    await shot(page, `wallets-${tag}`);

    // note — a sentence the agent must ask about: its answer stands by the field (over the phone's dock, in the desk's panel).
    // The model's read is held a few seconds, so the agent's «reading…» stands long enough to be seen and shot.
    await home(page, lang);
    await context.route("**/api/sentence", async (route) => {
      await new Promise((done) => setTimeout(done, 6_000));
      await route.continue().catch(() => {});
    });
    const field = page.locator(size.mobile ? "[data-terminal='ask-dock'] input" : "[data-terminal='hero'] input").first();
    await field.fill(lang === "uk" ? "купи ZZQX" : "buy ZZQX");
    await field.press("Enter");
    await page.waitForSelector("[data-say-note]:visible", { timeout: 8_000 }).catch(() => {});
    const noteBox = await page.locator("[data-say-note]:visible").first().boundingBox().catch(() => null);
    const dockBox = size.mobile ? await page.locator("[data-terminal='ask-dock'] form").first().boundingBox().catch(() => null) : null;
    report.push(`${tag} note: «${await text(page, "[data-say-note]:visible")}» at ${noteBox ? Math.round(noteBox.y) : "—"} px${dockBox ? ` (the dock's field at ${Math.round(dockBox.y)})` : ""} · page ${new URL(page.url()).pathname}`);
    if (noteBox) await page.screenshot({ path: path.join(out, `note-${tag}.jpg`), quality: 86, type: "jpeg" });
    await context.unroute("**/api/sentence");

    // said — the ready sentence opens the agent's ticket: the edge before a budget, «Practice first» before the wallet.
    await home(page, lang);
    const trade = page.locator("[data-terminal='hero'] [data-say='tradeDaily']");
    await tap(size, (await trade.count()) ? trade : page.locator("[data-terminal='hero'] [data-say]").first());
    await page.waitForURL((url) => url.pathname !== "/", { timeout: 30_000 }).catch(() => {});
    await page.waitForSelector("[data-agent-terms]", { timeout: 60_000 }).catch(() => {});
    await settle(page);
    const order = await page.evaluate(() => {
      const practice = document.querySelector("[data-agent-practice]");
      const connect = document.querySelector("[data-agent-connect]");
      if (!practice || !connect) return `practice ${Boolean(practice)} · connect ${Boolean(connect)}`;
      return practice.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING ? "practice, then connect" : "connect, then practice";
    });
    report.push(`${tag} said → ${new URL(page.url()).pathname}: edge «${await text(page, "[data-agent-terms]")}» · actions — ${order} · «${await text(page, "[data-agent-practice]")}» / «${await text(page, "[data-agent-connect]")}»`);
    // Both actions in sight, the second never under the phone's tab bar.
    await page.locator("[data-agent-connect]").first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    await shot(page, `said-${tag}`);

    // plan — her own day: the edge says it.
    const day = page.locator("section input:not([readonly])").first();
    if (await day.count()) {
      await day.fill(lang === "uk" ? "0,5" : "0.5");
      await page.waitForTimeout(1500);
      report.push(`${tag} plan: edge «${await text(page, "[data-agent-terms]")}» · fields «${(await page.locator("section input").evaluateAll((all) => all.map((i) => i.value))).join(" / ")}»`);
      await page.locator("[data-agent-connect]").first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
      await shot(page, `plan-${tag}`);
      // practice — with no wallet: on paper, nothing connected.
      await tap(size, page.locator("[data-agent-practice]").first());
      await page.waitForSelector("[data-agent-end-practice], [data-paper-result]", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      report.push(`${tag} practice: card «${(await page.locator("[data-agent-end-practice]").first().locator("xpath=ancestor::section[1]").innerText().catch(() => "—")).replace(/\s+/g, " ").slice(0, 320)}»`);
      await page.locator("[data-agent-end-practice]").first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
      await shot(page, `practice-${tag}`);
    }
    report.push(`${tag}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
    report.push(`${tag}: funnel — ${track.join(" → ") || "none"}`);
    funnel.push(...track);
    if (errors.length) report.push(`${tag}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();

    // seeker — a phone that says it is a Seeker.
    if (size.mobile) {
      const s = await open({ size, lang, ua: SEEKER_UA });
      await home(s.page, lang);
      await s.page.waitForTimeout(2000);
      report.push(`${tag} seeker: header «${await text(s.page, "[data-terminal='wallet']")}»`);
      await shot(s.page, `seeker-home-${tag}`);
      await s.page.goto(`${base}/swap?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await settle(s.page);
      const press = s.page.locator("main form button[type='submit'], main [data-swap-go], main button:has-text('Connect'), main button:has-text('Підключити')").first();
      await tap(size, press).catch(() => report.push(`${tag} seeker: the ticket's press could not be tapped`));
      await s.page.waitForTimeout(1500);
      report.push(`${tag} seeker: ticket wallets «${(await s.page.locator("[role='group'] [data-wallet]").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim()).join(" | ") || "—"}»`);
      await shot(s.page, `seeker-ticket-${tag}`);
      report.push(`${tag} seeker: funnel — ${s.track.join(" → ") || "none"}`);
      funnel.push(...s.track);
      await s.context.close();
    }
  }
}

await browser.close();
const count = (name) => funnel.filter((one) => one === name).length;
report.push(`funnel totals: ${["agent_home", "agent_hint", "agent_said", "agent_card", "agent_practice", "agent_wallet", "agent_connect", "agent_sign"].map((name) => `${name} ${count(name)}`).join(" · ")}`);
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
