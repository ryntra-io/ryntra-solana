// The QA of 19.11 day for the eyes → <out>/*.jpg and <out>/report.txt: Earn's filters and their menus on
// every desk (B-2, B-7), the phone's list and tabs (B-18), `/pro` «Active» and «All» (B-6, B-15), MET/SOL with no
// Position tab (B-4), JitoSOL/SOL 0.01 %'s Limit (B-5), TTWO/SOL's book on a tall desk (B-10), 1WIN/SOL on DAMM v2
// (B-12), a DLMM pool with no Position tab, and staking's amount (B-22).
//   node terminal/pool/shots-333.mjs [out] [baseUrl] [source]
// `baseUrl` a stand (`next start`), every `/api/**` read asked from `source` (ryntra.io by default) with the site's own
// origin; or `baseUrl` = the source itself for the «before» set (nothing routed). Reads only; the wallet is never
// connected; nothing is sent. SIZES=desk2560,desk1920,desk1440,phone, LANGS=uk,en and
// PAGES=earn,pro,met,jito,ttwo,damm,dlmm,stake narrow the run.
import { chromium } from "playwright";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-333/after");
const base = process.argv[3] ?? "http://localhost:3333";
const source = process.argv[4] ?? "https://ryntra.io";
const live = base === source;
mkdirSync(out, { recursive: true });

const MET_POOL = "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d";
const JITO_POOL = "EBEQoUmLTYoBMLShvubK7RBniYyx9CyLLos221c1u1kW";
const TTWO_PRO = "GEhkDiHnZ5m6eYp6AtRqcsmqwN8YNnvfXaDUPoBRAMoA";
const TTWO_DLMM = "7qZPiJ2Lvwh9DV9gUBH2EwConBE3RUrAvGRjpN8vTjtT";
const DAMM_POOL = "3Uq381E8SfUit1AG5zXMQC9VmjJJJDMzenPm26DkvLeK";
const HOLD_POOL = "2gc7BgE3WJ9P8A7hKDjYEDzSXw4Ux2DxyPrr9YijvkLL";
const EXE = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: EXE, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk2560", width: 2560, height: 1440, mobile: false, only: ["earn", "pro", "met", "ttwo"] },
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "desk1440", width: 1440, height: 900, mobile: false, also: ["metlimit"] },
  { name: "phone", width: 390, height: 844, mobile: true, only: ["earn", "pro", "met", "stake"] },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const PAGES = (process.env.PAGES ?? "earn,pro,met,jito,ttwo,damm,dlmm,stake,hold,metlimit").split(",");
// Each line goes to <out>/report.txt as it comes, so a run cut short keeps what it saw; REPORT_APPEND=1 adds to the
// report of an earlier run (a second run for the sizes the first did not reach).
const reportFile = path.join(out, "report.txt");
if (process.env.REPORT_APPEND !== "1") writeFileSync(reportFile, "");
const report = {
  push: (line) => {
    appendFileSync(reportFile, `${line}\n`);
    console.log(line);
  },
};

const ask = (url, init = {}) => fetch(`${source}${url}`, { ...init, headers: { "content-type": "application/json", accept: "application/json", origin: source, referer: `${source}/`, ...(init.headers ?? {}) } });

/** A read asked from the source with the site's own origin; a source that does not answer is a 503. */
const fromSource = async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const readPost = request.method() === "POST" && (url.pathname === "/api/solana/swap/quote" || url.pathname === "/api/v1/ladders/quote");
  if (request.method() !== "GET" && !readPost) return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await ask(`${url.pathname}${url.search}`, { method: request.method(), headers: { accept: request.headers().accept ?? "*/*" }, body: readPost ? request.postData() : undefined });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body, headers: { "cache-control": "no-store" } });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    if (!live) await context.route("**/api/**", fromSource);
    await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    const page = await context.newPage();
    const asked = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/pro/pools/") && response.status() === 404) asked.push(url.pathname);
    });
    const tag = (state) => `${state}-${size.name}-${lang}`;
    const shot = async (state, full = false) => {
      await page.waitForTimeout(800);
      const file = path.join(out, `${tag(state)}.jpg`);
      await page.screenshot({ path: file, quality: 86, type: "jpeg", fullPage: full });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      report.push(`${tag(state)}: overflow-x ${overflow} px`);
    };
    const open = async (where, wait = 10_000) => {
      await page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(wait);
    };
    const note = async (state, fn) => report.push(`${tag(state)}: ${await page.evaluate(fn)}`);
    /** The ticket's tabs and the one in front. */
    const tabsOf = () => [...document.querySelectorAll("[aria-label] [role='tablist'], [role='tablist']")].map((list) => [...list.querySelectorAll("[role='tab']")].map((tab) => `${tab.getAttribute("aria-selected") === "true" ? "*" : ""}${tab.textContent}`).join("|")).join(" ‖ ");
    // A page a size carries over its list (`also`) — MET's ladder on a laptop's ticket (B-9) — or by the list itself.
    const wants = (name) => PAGES.includes(name) && (name === "metlimit" ? Boolean(size.also?.includes(name)) : !size.only || size.only.includes(name));

    // A page that fails says so in the report; the run goes on to the next size and language.
    try {
    if (wants("earn")) {
      await open("/earn", 12_000);
      // Every filter chip in sight (B-7), and whether its menu opens over the table (B-2).
      await note("earn", () => {
        const row = document.querySelector("[role='group'][class*='filters']");
        // On a desk the filters' own box is `display: contents` (the chips wrap with the bar's end): measure the bar.
        const box = (row && getComputedStyle(row).display === "contents" ? row.parentElement : row)?.getBoundingClientRect();
        const chips = [...(row?.querySelectorAll(":scope > button, :scope > div > button, [class*='strats'] > button") ?? [])];
        const cut = chips.filter((chip) => { const r = chip.getBoundingClientRect(); return box && (r.right > box.right + 1 || r.left < box.left - 1); }).map((chip) => chip.textContent);
        const tabs = [...document.querySelectorAll("[role='tablist'] [role='tab']")].map((tab) => { const r = tab.getBoundingClientRect(); return `${tab.textContent}${r.left < 0 || r.right > innerWidth ? " (cut)" : ""}`; });
        return `filters ${chips.length}, cut ${cut.length ? cut.join(", ") : "none"}, row ${Math.round(box?.height ?? 0)} px · tabs ${tabs.join(" | ")}`;
      });
      await shot("earn");
      if (!size.mobile) {
        for (const [name, word] of [["type", lang === "uk" ? "Тип" : "Type"], ["tvl", lang === "uk" ? "У пулі" : "In pool"]]) {
          const chip = page.locator("[role='group'] button[aria-expanded]", { hasText: word }).first();
          if (!(await chip.count())) continue;
          await chip.click();
          await page.waitForTimeout(500);
          await note(`earn-menu-${name}`, () => {
            const menu = document.querySelector("[role='menu']");
            if (!menu) return "no menu";
            const item = menu.querySelector("[role='menuitemradio']");
            const r = item?.getBoundingClientRect();
            const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
            return `menu open, its first item ${hit && menu.contains(hit) ? "on top" : `under ${hit?.tagName ?? "nothing"}`}`;
          });
          await shot(`earn-menu-${name}`);
          await page.keyboard.press("Escape");
          // Only a menu Escape left open is closed by its chip: a closed one is not opened again over «+ Filters».
          if (await page.locator("[role='menu']").count()) await chip.click({ timeout: 5_000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
        const more = page.locator("[data-earn='more-filters']");
        if (await more.count()) {
          await more.click();
          await page.waitForTimeout(500);
          await shot("earn-more");
          await more.click();
        }
        const view = page.locator("[data-earn-pick]", { hasText: lang === "uk" ? "Огляд" : "View" }).first();
        const damm = page.locator("[role='row']", { hasText: "DAMM v2" }).locator("[data-earn-pick]").first();
        if (await damm.count()) {
          await damm.click();
          await page.waitForTimeout(800);
          await shot("earn-damm-view");
        } else if (await view.count()) await view.click();
      } else {
        await shot("earn-phone-list", false);
      }
    }
    if (wants("pro")) {
      await open("/pro", 12_000);
      await note("pro", () => [...document.querySelectorAll("[role='row']")].slice(1, 12).map((row) => row.textContent?.replace(/\s+/g, " ").trim().slice(0, 60)).join(" ‖ "));
      await shot("pro");
      const every = page.locator("[role='radio'], button", { hasText: lang === "uk" ? "Усі" : "All" }).last();
      if (await every.count()) {
        await every.click();
        await page.waitForTimeout(1_200);
        await note("pro-all", () => [...document.querySelectorAll("[role='row']")].slice(1).map((row) => row.querySelector("[class*='sym']")?.textContent).join(", "));
        await shot("pro-all", !size.mobile);
      }
    }
    if (wants("met")) {
      await open(`/pool/${MET_POOL}?tab=position`, 14_000);
      await note("met", tabsOf);
      await shot("met", size.mobile);
    }
    if (wants("jito")) {
      await open(`/pool/${JITO_POOL}?tab=limit`, 14_000);
      await note("jito-limit", () => `${[...document.querySelectorAll("[role='tablist'] [role='tab'][aria-selected='true']")].map((tab) => tab.textContent).join("|")} · card «${document.querySelector("[data-pool-bonus]")?.textContent ?? "-"}»`);
      await shot("jito-limit");
    }
    if (wants("ttwo")) {
      await open(`/pool/${TTWO_PRO}`, 14_000);
      await note("ttwo", () => {
        const book = document.querySelector("[aria-label] ol")?.closest("div");
        const first = book?.querySelector("li")?.getBoundingClientRect();
        const cols = book?.previousElementSibling?.getBoundingClientRect();
        return `gap over the book ${first && cols ? Math.round(first.top - cols.bottom) : "-"} px`;
      });
      await shot("ttwo");
    }
    if (wants("damm")) {
      await open(`/pool/${DAMM_POOL}`, 14_000);
      await note("damm", () => `head «${document.querySelector("[data-pool-head]")?.textContent?.replace(/\s+/g, " ").slice(0, 120)}» · tabs ${[...document.querySelectorAll("[role='tablist']")].map((l) => l.textContent).join(" ‖ ")}`);
      await shot("damm");
    }
    if (wants("dlmm")) {
      await open(`/pool/${TTWO_DLMM}?tab=position`, 14_000);
      await note("dlmm", tabsOf);
      await shot("dlmm");
    }
    if (wants("hold")) {
      // A launch pool whose chart may not draw (B-13) and whose prices are tiny (B-11): the ladder and the chip.
      await open(`/pool/${HOLD_POOL}?tab=limit`, 16_000);
      await note("hold", () => `chip «${document.querySelector("[data-coin-layer] [class*='live']")?.textContent ?? "-"}» · reach «${document.querySelector("[class*='reachPrice']")?.textContent ?? "-"}»`);
      await shot("hold");
    }
    if (wants("metlimit")) {
      // MET's ladder with an amount typed: the four tiles whole on a laptop's ticket (B-9).
      await open(`/pool/${MET_POOL}?tab=limit`, 14_000);
      const amount = page.locator("input[inputmode='decimal']").first();
      if (await amount.count()) {
        await amount.fill("1");
        await page.waitForTimeout(4_000);
      }
      await note("metlimit", () => [...document.querySelectorAll("[class*='tile']")].map((tile) => tile.textContent?.replace(/\s+/g, " ").trim()).join(" | "));
      await shot("metlimit");
    }
    if (wants("stake")) {
      await open("/earn?tab=staking", 12_000);
      await note("stake", () => `amount «${document.querySelector("input[inputmode='decimal']")?.value ?? "-"}»`);
      await shot("stake", size.mobile);
    }
    } catch (error) {
      report.push(`${tag("error")}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
    if (asked.length) report.push(`${tag("console")}: 404 ${[...new Set(asked)].join(", ")}`);
    await context.close();
  }
}

await browser.close();
