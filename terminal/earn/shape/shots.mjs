// «My shape» on the DLMM Pro ticket of «Earn», for the eyes: 2560×1440 and 1920×1080 on a desk, 390×844 on a
// phone, English and Ukrainian → <out>/<state>-<size>-<lang>.jpg, with a report of what each screen said, its corners
// and any page that scrolls sideways.
//   node terminal/earn/shape/shots.mjs [out] [baseUrl] [source]          SIZES=w2560,w1920,phone  LANGS=en,uk
// The stand runs with production's switches and the shape's own (`NEXT_PUBLIC_RYNTRA_EARN_PRO_SHAPE=open`). Every
// read is the engine's on `source` (ryntra.io): the catalogue, DLMM Pro's piers on mainnet, the pool's bins. A stub
// wallet of the Wallet Standard connects and never signs. The Review is the rehearsal's own answer for the same grid —
// «Near price» on «Narrow» — built and landed through the surface in LiteSVM (S5 of
// docs/research/meteora-dlmm-pro-2026-11-14/results/shape-rehearsal-mainnet.json), its price-made figures moved onto the
// pool on screen (`answerFor`); nothing is built, signed or sent.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-325");
const base = process.argv[3] ?? "http://localhost:3132";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const REHEARSAL = JSON.parse(readFileSync("docs/research/meteora-dlmm-pro-2026-11-14/results/shape-rehearsal-mainnet.json", "utf8"));
const S5 = REHEARSAL.facts.narrow;
const PIERS = await fetch(`${source}/api/v1/earn/pro/piers`, { headers: { origin: source, referer: `${source}/earn` } }).then((answer) => answer.json(), () => null).catch(() => null);
/**
 * The Review for the pool on screen. What the grid alone decides — its ranges, the rent, the network's fee, the swap —
 * is the rehearsal's own answer for «Near price» on «Narrow» (S5). What the pool's price decides is moved onto the pool
 * on screen: the range's two edges (5 steps of its spacing under, 6 over), the band of the price (an eighth of the
 * nearer edge), and the coin that goes in, at the same worth in SOL. A frame of the layout, never a quote.
 */
function answerFor(pool) {
  const pier = PIERS?.piers?.find((entry) => entry.address === pool);
  const base = { ...S5.answer, network: "mainnet", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  if (!pier || pier.solIsX) return base;
  const step = (n) => Math.pow(1.0001, n * pier.tickSpacing);
  const worth = (Number(S5.answer.summary.goesIn.xRaw) / 1e6) * S5.priceBefore;
  const xRaw = String(Math.round((worth / pier.price) * 10 ** pier.x.decimals));
  const downBps = (1 - 1 / step(5)) * 10_000;
  const upBps = (step(6) - 1) * 10_000;
  return {
    ...base,
    summary: {
      ...S5.answer.summary,
      lowerPrice: pier.price / step(5),
      upperPrice: pier.price * step(6),
      bandBps: Math.max(1, Math.floor(Math.min(downBps, upBps) / 8)),
      goesIn: { ...S5.answer.summary.goesIn, xRaw, lamports: String(Math.round(worth * 1e9) + Number(S5.answer.summary.goesIn.yRaw)) },
    },
  };
}

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "w2560", width: 2560, height: 1440, mobile: false },
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const WORDS = {
  en: { card: "DLMM Pro", mine: "My shape", near: "Near price", narrow: "Narrow", save: "Save as mine", keep: "Save", details: "Pool details", connect: "Connect wallet" },
  uk: { card: "DLMM Pro", mine: "Своя форма", near: "Біля ціни", narrow: "Вузький", save: "Зберегти як мою", keep: "Зберегти", details: "Деталі пулу", connect: "Підключити гаманець" },
};
const report = [];

async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() !== "GET") return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: request.headers().accept ?? "*/*", origin: source, referer: `${source}/earn` } });
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Every box on screen whose corner is not 0, 4 px or a circle: the form allows nothing else. */
const CORNERS = () => {
  const odd = new Map();
  for (const el of document.querySelectorAll("main *, [data-earn='sheet'] *")) {
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2 || box.bottom < 0 || box.top > innerHeight) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const r = parseFloat(style.borderTopLeftRadius) || 0;
    if (r === 0 || r === 4 || r >= Math.min(box.width, box.height) / 2 - 0.5) continue;
    const key = `${r}px ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]?.slice(0, 40)}`;
    odd.set(key, (odd.get(key) ?? 0) + 1);
  }
  return [...odd.entries()].map(([key, n]) => `${key} ×${n}`);
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const w = WORDS[lang];
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.route("**/api/**", fromSource);
    await context.route("**/api/v1/earn/pro/review", (route) => json(route, answerFor(route.request().postDataJSON()?.pool ?? null)));
    await context.route("**/api/v1/earn/pro/submit", (route) => json(route, { error: { code: "UNAVAILABLE", message: "" } }, 503));
    await context.route("**/api/v1/earn/pro/positions*", (route) => json(route, { network: "mainnet", owner: OWNER, positions: [], care: false }));
    await context.route("**/api/solana/holdings*", (route) => json(route, {}, 503));
    await context.route("**/api/auth/solana/session*", (route) => json(route, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await context.route("**/api/growth/cards?*", (route) => json(route, { error: "proof required", proof: false }, 401));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript(({ owner, value }) => {
      try {
        localStorage.setItem("ryntra.city.lang", value);
        localStorage.removeItem("ryntra.terminal.earn.shapes.v1");
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
      const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async (input) => (input?.silent ? { accounts: [] } : ((wallet.accounts = [account]), { accounts: [account] })) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { owner: OWNER, value: lang });

    const ticket = size.mobile ? page.locator("[data-earn='sheet']") : page.locator("aside section").first();
    const painter = page.locator("[data-earn-shape='painter']").first();
    const tap = async (locator) => (size.mobile ? locator.tap() : locator.click());
    const shot = async (state, scrollTo = null) => {
      if (scrollTo) await scrollTo.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const odd = await page.evaluate(CORNERS);
      const prices = await page.locator("[data-earn-shape='prices']").first().innerText().catch(() => "—");
      const goal = await ticket.locator("[role=radio][aria-checked=true]").first().innerText().catch(() => "—");
      report.push(`${state}-${size.name}-${lang}: goal «${goal.replace(/\s+/g, " ")}» · prices «${prices.replace(/\s+/g, " ")}» · sideways ${overflow} px${odd.length ? ` · corners off the form: ${odd.join(", ")}` : ""}`);
    };
    /** A stroke across the grid, from one share of it to another, as a finger or the mouse paints. */
    const paint = async (points) => {
      const box = await page.locator("[data-earn-shape='grid']").first().boundingBox();
      if (!box) return;
      const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
      const [x0, y0] = at(points[0]);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (const point of points.slice(1)) {
        const [x, y] = at(point);
        await page.mouse.move(x, y, { steps: 8 });
      }
      await page.mouse.up();
    };

    await page.goto(`${base}/earn?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
    const card = page.locator("button[aria-pressed]:visible").filter({ hasText: w.card }).first();
    if (!(await card.waitFor({ timeout: 120_000 }).then(() => true, () => false))) {
      report.push(`${size.name}/${lang}: no «${w.card}» card`);
      await context.close();
      continue;
    }
    await page.waitForTimeout(2_000);
    await tap(card);
    await ticket.waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    const mine = ticket.getByRole("radio", { name: w.mine });
    if (!(await mine.count())) {
      report.push(`${size.name}/${lang}: no «${w.mine}» on the ticket — is NEXT_PUBLIC_RYNTRA_EARN_PRO_SHAPE=open on the stand?`);
      await context.close();
      continue;
    }
    await tap(mine.first());
    await painter.waitFor({ timeout: 10_000 }).catch(() => {});
    await shot("shape-start", painter);
    /* «Wave», then a wall of support far under the price painted over it in one stroke. */
    await tap(painter.locator("[data-earn-shape='start-wave']").first());
    await paint([[0.004, 0.04], [0.09, 0.04]]);
    await shot("shape-painted", painter);
    /* A comb of teeth: too detailed for one position — the ticket says so and asks nothing. */
    await paint([[0.55, 0.06], [0.57, 0.95], [0.6, 0.06], [0.63, 0.95], [0.66, 0.06], [0.69, 0.95], [0.72, 0.06], [0.75, 0.95], [0.78, 0.06], [0.81, 0.95], [0.84, 0.06], [0.87, 0.95], [0.9, 0.06], [0.93, 0.95], [0.96, 0.06]]);
    await shot("shape-detailed", painter);
    await tap(painter.getByRole("button", { name: lang === "uk" ? "Скасувати" : "Undo" }).first());
    await tap(painter.getByRole("button", { name: w.save }).first());
    await page.waitForTimeout(300);
    await tap(painter.getByRole("button", { name: w.keep, exact: true }).first());
    await shot("shape-saved", painter);
    /* The rehearsal's own grid: «Near price» on «Narrow» — then the wallet, and the one line of the position behind «i». */
    await tap(painter.getByRole("button", { name: w.near, exact: true }).first());
    await tap(ticket.getByRole("radio", { name: w.narrow, exact: true }).first());
    const connect = ticket.getByRole("button", { name: w.connect }).first();
    if (await connect.count()) {
      await tap(connect);
      await page.waitForTimeout(900);
      const pick = page.getByRole("button", { name: "Phantom" });
      if (await pick.count()) await tap(pick.first()).catch(() => pick.first().click({ force: true }));
      await page.waitForTimeout(3_500);
      /* On a phone the wallet's door may close the ticket's sheet: it is opened again on the same pool, the grid as it was. */
      if (size.mobile && !(await ticket.isVisible().catch(() => false))) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(600);
        await tap(card).catch(() => {});
        await ticket.waitFor({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(2_500);
      }
    }
    const info = ticket.getByRole("button", { name: w.details }).first();
    if (await info.count()) {
      await tap(info);
      await page.waitForTimeout(600);
      const line = await ticket.locator("[role=note]").first().innerText().catch(() => "—");
      report.push(`${size.name}/${lang} details: ${line.replace(/\s+/g, " ").slice(0, 400)}`);
      await shot("shape-details", ticket.locator("[role=note]").first());
    } else report.push(`${size.name}/${lang}: no «${w.details}» on the ticket`);
    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
