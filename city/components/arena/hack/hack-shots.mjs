// Ryntra City, the Arena's Hack door (CITY-227): a person's whole way through the window over the live city — the
// Arena's tray with its Hack door, the orders, an order's card and what is behind «i», «Send an agent», the run live and
// done, the finding it filed; the protocol's owner on its own order and its word on a finding; the board; signed out;
// a refusal; an agent's way from the order's record; the empty door — at 1440×900 and 390×844, in English and Ukrainian
// → <out>/<lang>-<size>-<n>-<state>.jpg
//
//   NEXT_PUBLIC_RYNTRA_CITY_HACK=open NEXT_PUBLIC_RYNTRA_CITY_RING=open npx next dev -p 3227
//   node city/components/arena/hack/hack-shots.mjs [out] [baseUrl]
//
// No database on this machine, so the routes are the stand's (`city/lib/arena/hack/view/stand.mjs`): the real routes of
// CITY-226 over the memory store and a seeded world, answered in this process for the page's `/api/arena/hack/**`; the
// run's own route — no server serves it yet — plays the real step runner's journal (CITY-225, the stub brain on the
// made-up copy), one turn a read. «My agent» (`/api/ring/mine`) is the stand's too. Nothing else is routed or drawn.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createStand, OWNER_A, PROTOCOL } from "../../../lib/arena/hack/view/stand.mjs";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-227");
const base = process.argv[3] ?? "http://localhost:3227";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
/** English shows every step; Ukrainian the screens a person stops on. */
const FULL = new Set((process.env.FULL ?? "en").split(","));
const HOUR = 3_600_000;

const browser = await chromium.launch({ ...(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [];

for (const lang of LANGS) {
  for (const s of SIZES) {
    const full = FULL.has(lang);
    // The stand's clock ends its seeding three and a half hours on: start it so that is now.
    const stand = await createStand({ now: Date.now() - 3.5 * HOUR });
    stand.as(OWNER_A);
    let emptyDoor = false;
    let dropTake = false;

    const context = await browser.newContext({ locale: lang === "uk" ? "uk-UA" : "en-US", viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
    await context.addInitScript((l) => window.localStorage.setItem("ryntra.city.lang", l), lang);
    await context.route("**/api/arena/hack/**", async (route) => {
      const req = route.request();
      if (emptyDoor && /\/orders(\?|$)/.test(req.url())) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [] }) });
      if (dropTake && /\/take$/.test(new URL(req.url()).pathname)) return route.abort("connectionreset");
      const res = await stand.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined });
      await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
    });
    await context.route("**/api/ring/mine", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stand.mine()) }));

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|api\/city|api\/world|api\/v1|api\/market|api\/auth|api\/account|api\/ring|ERR_|status of 5\d\d|status of 4\d\d|connectionreset/i.test(m.text()) && errors.push(m.text()));
    let n = 0;
    const shot = async (state, always = false) => {
      n += 1;
      if (!full && !always) return;
      // The 3D city keeps the renderer busy on a machine without a GPU: wait for two fresh frames before the shot.
      await page.waitForTimeout(1600);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) problems.push(`${lang} ${s.name} ${state}: the page scrolls sideways by ${wide} px`);
      await page.screenshot({ path: path.join(out, `${lang}-${s.name}-${String(n).padStart(2, "0")}-${state}.jpg`), type: "jpeg", quality: 80 });
    };
    /** The window's own store, as a tap would move it: `hack("openOrder", "vault-audit")`. */
    const hack = (name, ...args) => page.evaluate(([n, a]) => window.__hack.getState()[n](...a), [name, args]);
    const readMine = () => page.evaluate(() => window.__arena.getState().readMine());
    const primary = (kind) => page.locator(`[data-hack-primary="${kind}"]`);

    await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => !!window.__hack && !!window.__arena, null, { timeout: 300_000 });
    await page.waitForTimeout(8000);
    await page.getByRole("button", { name: /^(Later|Пізніше|Close the Arrivals card|Закрити картку Прибуття)$/ }).click({ timeout: 4000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});

    // 1 · The Arena's tray: the Ring and Hack side by side.
    await page.locator('[data-deck-place="arena"]').click({ timeout: 20_000 });
    await page.locator('[data-deck-door="hack"]').waitFor({ timeout: 20_000 });
    await shot("tray", true);

    // 2 · The door: the orders open now, the one closing soonest on top, one action.
    await page.locator('[data-deck-door="hack"]').click();
    // The window's contents load the first time it opens; a developer's server builds them on that first ask.
    await page.locator("[data-hack-order]").first().waitFor({ timeout: 240_000 });
    await primary("take").waitFor({ timeout: 30_000 });
    await shot("orders", true);

    // 3 · An order's card: the copy, its scope in one name, the reward as a description, the side, one action.
    await primary("take").click();
    await primary("send").waitFor({ timeout: 30_000 });
    await shot("order", true);

    // 4 · Behind «i»: the scope, the copy, the owner's permission, the window, the honest lines.
    await page.locator("[data-hack-info]").click();
    await page.locator("[data-hack-details]").waitFor();
    await shot("order-details");
    await page.locator("[data-hack-info]").click();

    // 5–7 · «Send an agent»: the run live, step by step from the harness's journal; then done, and its finding.
    await primary("send").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-step]").length >= 3, null, { timeout: 60_000 });
    stand.hold(true);
    await page.waitForTimeout(1600);
    await shot("run-live", true);
    stand.hold(false);
    await primary("finding").waitFor({ timeout: 60_000 });
    await page.locator('[data-step="broke"]').click();
    await shot("run-done", true);
    await primary("finding").click();
    await page.locator('[data-hack-screen="finding"]').waitFor();
    await page.waitForTimeout(600);
    await shot("finding", true);

    // 8 · An agent's way from the order's own record, where no journal is served.
    await hack("openOrder", "vault-audit");
    await primary("watch").waitFor({ timeout: 30_000 });
    await primary("watch").click();
    await page.locator('[data-step="finding"]').first().waitFor({ timeout: 30_000 });
    await shot("run-record");

    // 9–11 · The protocol's owner on its own order: «Stop», what waits for its word on top; then «Confirm».
    stand.as(PROTOCOL);
    await hack("setMe", PROTOCOL);
    await readMine();
    await hack("setTab", "orders");
    await hack("openOrder", "vault-audit");
    await primary("pause").waitFor({ timeout: 30_000 });
    await shot("owner-order", true);
    await page.locator("[data-hack-finding]").first().click();
    await primary("confirm").waitFor({ timeout: 30_000 });
    await shot("owner-finding", true);
    await primary("confirm").click();
    await page.locator('[data-hack-screen="finding"] [data-tone="confirmed"]').first().waitFor({ timeout: 30_000 });
    await shot("owner-confirmed");

    // 12–13 · The board: attackers by their confirmed findings, defenders by the orders they held.
    stand.as(OWNER_A);
    await hack("setMe", null);
    await readMine();
    await hack("setTab", "board");
    await page.locator("[data-hack-board-row]").first().waitFor({ timeout: 30_000 });
    await shot("board", true);
    await page.locator('[data-hack-side="defender"]').click();
    await shot("board-defenders");

    // 14 · A refusal with its way on: the connection drops while sending.
    dropTake = true;
    await hack("setTab", "orders");
    await hack("openOrder", "staking-claims");
    await primary("send").waitFor({ timeout: 30_000 });
    await primary("send").click();
    await page.locator("[data-hack-problem]").waitFor({ timeout: 30_000 });
    await shot("problem");
    dropTake = false;

    // 15 · Signed out: the wallet first.
    stand.as(null);
    await readMine();
    await hack("dismiss");
    await hack("setTab", "orders");
    await hack("openOrder", "staking-claims");
    await primary("connect").waitFor({ timeout: 30_000 });
    await shot("signed-out", true);

    // 16 · The empty door: the Arena's quarter at night, one way on.
    stand.as(OWNER_A);
    await readMine();
    emptyDoor = true;
    await hack("setTab", "orders");
    await page.locator("[data-hack-empty]").waitFor({ timeout: 30_000 });
    await shot("empty", true);

    if (errors.length) problems.push(`${lang} ${s.name}: ${errors.join(" | ").slice(0, 1500)}`);
    await context.close();
  }
}

await browser.close();
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : `no problems; shots in ${out}`);
