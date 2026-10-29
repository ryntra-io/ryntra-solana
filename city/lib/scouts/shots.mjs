// «Scouts» screens for review (CITY-8), at 1440×860 and 390×844 → <out>/scouts-<state>-<size>.png
//   npm run dev      then      node city/lib/scouts/shots.mjs [out] [baseUrl]
// No wallet and no keys: a stub wallet registers through the Wallet Standard events and comes back silently, as a wallet
// this site was granted does; it signs nothing. `/api/rewards` answers with a fixture in the Growth engine's own shape,
// so every figure on these screens is a fixture; the live pass with a real wallet is the owner's on production.
// FILM=1 also films (FILM=only: nothing else) the window's head still from the live city — the flags on their towers, no HUD — into
// <out>/scouts-film.png; public/city/art/scouts-{800,1440}.webp are that frame resized to WebP with `sharp`.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/scouts-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const row = (kind, amount, detail, minutes) => ({ kind, display: `${kind === "CLAIM" ? "−" : "+"}$${amount}`, amount, valued: true, detail, at: at(minutes) });

/** `/api/rewards` for a proven wallet (`app/api/rewards/route.ts`). */
const REWARDS = {
  ok: true,
  address: OWNER,
  available: "0.00",
  pending: "1.10",
  lifetime: "48.62",
  cashback: "11.37",
  referralL1: "34.80",
  referralL2: "2.45",
  claimable: false,
  referrals: { level1: 14, level2: 5 },
  referral: { code: "K7Q2M9XW4HPT", link: "https://ryntra.io/r/K7Q2M9XW4HPT" },
  rows: [
    row("REFERRAL_L1", "2.14", "Bonk", 7),
    row("CASHBACK", "0.62", "SOL", 31),
    row("REFERRAL_L1", "1.08", "POPCAT", 95),
    row("REFERRAL_L2", "0.21", "MEW", 60 * 5),
    row("REFERRAL_L1", "0.87", "SOL", 60 * 9),
    row("REFERRAL_L1", "3.40", "$WIF", 60 * 26),
    row("REFERRAL_L1", "0.55", "PENGU", 60 * 50),
    row("CASHBACK", "0.31", "SOL", 60 * 75),
  ],
  rank: { rank: "SILVER", friendShare: 15, secondLevelShare: 5 },
  programme: { inviterWindow: { share: 30, days: 90 } },
  started: true,
};

const EMPTY = { ...REWARDS, lifetime: "0.00", cashback: "0.00", referralL1: "0.00", referralL2: "0.00", pending: "0.00", referrals: { level1: 0, level2: 0 }, rows: [], rank: { rank: "BRONZE", friendShare: 10, secondLevelShare: 5 } };

const gl = process.env.PRESS_CHROME ? ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] : ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
// CHROME: a Chromium of its own (a cloud session: /opt/pw-browsers/chromium), on the software GL.
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || process.env.CHROME || undefined, args: gl });

async function open(size, { connected = true, rewards = REWARDS } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(({ taker, connected }) => {
    if (!connected) return;
    window.localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
        "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { taker: OWNER, connected });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  // Coin logos: none here, as the engine answers without a network — each coin shows its letter, at once.
  await page.route("**/api/icon/*", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: [] } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/rewards?*", (route) => (rewards ? json(route, 200, rewards) : json(route, 401, { error: "proof required", proof: false })));
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => typeof window.__scouts?.getState === "function" && (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 180_000 });
  // The skyline's models arrive after the first frame; a software GL takes its time.
  await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: Number(process.env.SKYLINE_WAIT ?? 120_000) }).catch(() => {});
  await page.waitForTimeout(6000);
  // The first visit's welcome steps aside, as a visitor would send it.
  const later = page.getByRole("button", { name: /^(Later|Close the Arrivals card)$/ });
  if (await later.isVisible().catch(() => false)) await later.click();
  return { page, context, errors };
}

const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const show = async (page) => {
  await page.evaluate(() => window.__scouts.getState().show());
  // The window's code loads the first time it opens.
  await page.getByText(/^(Earned|Show my link|Connect wallet)$/).first().waitFor({ timeout: 180_000 });
  // The head still: a busy development server can take a while to hand it over.
  await page.waitForFunction(() => { const img = document.querySelector('div[aria-label="Scouts"] img'); return Boolean(img?.complete && img.naturalWidth > 0); }, null, { timeout: 90_000 }).catch(() => {});
  // A software GL draws the city slowly and the page's own layers wait behind it: give the window time to settle.
  await page.waitForTimeout(8000);
};
/**
 * The camera on the flagged towers: `wide` — the whole group from the south-east, a little above the roofs; `close` —
 * the window's head still, beside the tallest flagged roof with the others behind it against the sky.
 */
const toFlags = (page, mode = "wide") =>
  page.evaluate((mode) => {
    const { layout } = window.__city.getState();
    const view = window.__scouts.getState().view;
    const symbols = new Set((view?.rows ?? []).filter((r) => r.kind.startsWith("REFERRAL") && r.coin).map((r) => r.coin.replace(/^\$/, "").toUpperCase()));
    const flagged = layout.towers.filter((t) => symbols.has(t.tower.symbol.replace(/^\$/, "").toUpperCase()));
    if (!flagged.length) return 0;
    const cx = flagged.reduce((a, t) => a + t.x, 0) / flagged.length;
    const cz = flagged.reduce((a, t) => a + t.z, 0) / flagged.length;
    const top = Math.max(...flagged.map((t) => t.height));
    if (mode === "close") {
      // From inside the city, at the group's roofs, looking out: the flags against the evening sky and the water.
      const out = Math.hypot(cx, cz) || 1;
      const [ux, uz] = [cx / out, cz / out];
      window.__cityView([cx - ux * 26 + uz * 9, top + 13, cz - uz * 26 - ux * 9], [cx + ux * 16, top * 0.5, cz + uz * 16]);
    } else {
      const d = 70;
      window.__cityView([cx + d * 0.7, top + d * 0.4, cz + d * 0.85], [cx, top * 0.75, cz]);
    }
    return flagged.length;
  }, mode);

const report = [];
// FILM=only: the head still and nothing else.
if (process.env.FILM === "only") {
  const { page, context } = await open(ALL[0]);
  await page.evaluate(() => window.__scouts.getState().read("4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW", true));
  await page.waitForTimeout(1500);
  await film(page);
  await context.close();
  await browser.close();
  process.exit(0);
}

async function film(page) {
  await toFlags(page, "close");
  // The still carries no coin and no logo: the signs over the roofs step out of the frame.
  await page.evaluate(() => window.__scene?.traverse((o) => o.material?.uniforms?.uAtlas && (o.visible = false)));
  const hide = await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(out, "scouts-film.png"), clip: { x: 0, y: 0, width: 1440, height: 808 } });
  await hide.evaluate((el) => el.remove());
}

for (const size of SIZES) {
  const shot = (page, state) => page.screenshot({ path: path.join(out, `scouts-${state}-${size.name}.png`) });

  {
    const { page, context, errors } = await open(size);
    await show(page);
    await shot(page, "ready");
    await page.evaluate(() => document.querySelector('div[aria-label="Scouts"]')?.scrollTo(0, 10_000));
    await page.waitForTimeout(4000);
    await shot(page, "history");
    await page.evaluate(() => document.querySelector('div[aria-label="Scouts"]')?.scrollTo(0, 0));
    await page.getByRole("button", { name: "How shares work" }).click();
    await page.waitForTimeout(4000);
    await shot(page, "rules");
    await page.evaluate(() => window.__scouts.getState().close());
    await page.waitForTimeout(800);
    const flagged = await toFlags(page);
    await page.waitForTimeout(8000);
    await shot(page, "flags");
    // From «Mine» and from the menu: the two ways in.
    await page.evaluate(() => window.__cityView?.(null));
    await page.getByRole("button", { name: "Menu" }).click();
    await page.waitForTimeout(4000);
    await shot(page, "menu");
    report.push(`${size.name}: flags=${flagged} overflow=${await overflowOf(page)}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);

    if (process.env.FILM === "1" && size.name === "desk") {
      await page.keyboard.press("Escape");
      await film(page);
    }
    await context.close();
  }

  {
    const { page, context } = await open(size, { rewards: EMPTY });
    await show(page);
    await shot(page, "new");
    await context.close();
  }
  {
    const { page, context } = await open(size, { rewards: null });
    await show(page);
    await shot(page, "sign-in");
    await context.close();
  }
  {
    const { page, context } = await open(size, { connected: false });
    await show(page);
    await shot(page, "connect");
    await context.close();
  }
}
console.log(report.join("\n"));
await browser.close();
