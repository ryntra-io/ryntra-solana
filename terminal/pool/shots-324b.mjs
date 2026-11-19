// Any Meteora pool's page for the eyes → <out>/*.jpg: MET/SOL on DLMM Pro with the ticket's three tabs
// (Limit · Position with the any-pool switch closed and open · Swap), the pair's pools picker, and SOL/USDC on DLMM with
// its full page (Position · Swap).
//   node terminal/pool/shots-324b.mjs [out] [baseUrl] [source]
// A stand: `next build` with the production flags and `NEXT_PUBLIC_RYNTRA_EARN_PRO_ANY_POOL=open`, then `next start`.
// Every read is asked from `source` (ryntra.io by default) with the site's own origin, as a browser on it asks. The
// switch's two states are the server's answer of its piers: «closed» is ryntra.io's own (MET/SOL is no pier there), «open»
// is that answer with MET/SOL as the engine serves it where `RYNTRA_EARN_PRO_ANY_POOL=open` (built here from the pool's
// own row). Reads only; the wallet is never connected; nothing is sent. SIZES=desk2560,desk1920,phone and LANGS=uk,en
// narrow the run.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-324b");
const base = process.argv[3] ?? "http://localhost:3136";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const MET_POOL = "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d";
const SOL_USDC = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const JITO_POOL = "EBEQoUmLTYoBMLShvubK7RBniYyx9CyLLos221c1u1kW";
const SOL = "So11111111111111111111111111111111111111112";
const EXE = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: EXE, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk2560", width: 2560, height: 1440, mobile: false },
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const report = [];

const ask = (url, init = {}) => fetch(`${source}${url}`, { ...init, headers: { "content-type": "application/json", accept: "application/json", origin: source, referer: `${source}/`, ...(init.headers ?? {}) } });

/** The piers as the engine answers them with the any-pool switch open: MET/SOL beside ryntra.io's own. */
async function openPiers() {
  const [piers, one] = await Promise.all([ask("/api/v1/earn/pro/piers").then((r) => r.json()), ask(`/api/pro/pools/${MET_POOL}`).then((r) => r.json())]);
  const row = one.pool;
  const solIsX = row.x.mint === SOL;
  const price = row.price;
  const xs = Number(row.reserves.xRaw) / 10 ** row.x.decimals;
  const ys = Number(row.reserves.yRaw) / 10 ** row.y.decimals;
  const depth = solIsX ? xs + ys / price : ys + xs * price;
  const pier = {
    address: row.address,
    x: { mint: row.x.mint, symbol: row.x.symbol, decimals: row.x.decimals },
    y: { mint: row.y.mint, symbol: row.y.symbol, decimals: row.y.decimals },
    solIsX,
    price,
    feeBps: row.fee.totalBps,
    tickSpacing: row.tickSpacing,
    tickId: Math.floor(Math.log(price / 10 ** (row.x.decimals - row.y.decimals)) / Math.log(1.0001)),
    depthLamports: String(Math.round(depth * 1e9)),
    rewards: [],
    takesDeposits: row.open.deposits,
  };
  return { ...piers, piers: [pier, ...piers.piers.filter((entry) => entry.address !== MET_POOL)] };
}
const OPEN_PIERS = await openPiers();

/** A read asked from the source with the site's own origin; a source that does not answer is a 503. */
const fromSource = (mode) => async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (mode === "open" && url.pathname === "/api/v1/earn/pro/piers") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OPEN_PIERS) });
  const readPost = request.method() === "POST" && (url.pathname === "/api/solana/swap/quote" || url.pathname === "/api/v1/ladders/quote");
  if (request.method() !== "GET" && !readPost) return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await ask(`${url.pathname}${url.search}`, { method: request.method(), headers: { accept: request.headers().accept ?? "*/*" }, body: readPost ? request.postData() : undefined });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const mode of ["closed", "open"]) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.mobile ? 2 : 1,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
      });
      await context.route("**/api/**", fromSource(mode));
      await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
      const shot = async (state) => {
        await page.waitForTimeout(800);
        const file = path.join(out, `${state}-${size.name}-${lang}.jpg`);
        await page.screenshot({ path: file, quality: 86, type: "jpeg" });
        const overflow = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
        report.push(`${state}-${size.name}-${lang}: overflow ${overflow.join("×")} px`);
      };
      const open = async (where, wait = 10_000) => {
        await page.goto(`${base}${where}${where.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
        await page.waitForSelector(".ryntra-chart canvas", { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(wait);
      };
      /** On a phone the ticket stands under the chart and the pool: it is brought into view. */
      const toTicket = async () => {
        if (!size.mobile) return;
        await page.evaluate(() => document.querySelector('[role="tablist"][aria-label="Ticket"], [role="tablist"][aria-label="Квиток"]')?.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(600);
      };

      if (mode === "closed") {
        await open(`/pool/${MET_POOL}`, 14_000);
        await shot("met-limit");
        await toTicket();
        if (size.mobile) await shot("met-limit-ticket");
        await open(`/pool/${MET_POOL}?tab=position`);
        await toTicket();
        await shot("met-position-closed");
        await open(`/pool/${MET_POOL}?tab=swap`);
        await toTicket();
        await shot("met-swap");
        if (!size.mobile) {
          await page.evaluate(() => window.scrollTo(0, 0));
          const pick = page.locator("[data-pool-head] button[aria-haspopup='dialog']");
          if (await pick.count()) {
            await pick.click();
            await page.waitForTimeout(1_200);
            await shot("met-pairs");
            await page.keyboard.press("Escape");
          } else report.push(`met-pairs-${size.name}-${lang}: no picker`);
        }
        // A pier Earn already serves (JitoSOL/SOL): «Position» is the full form with its signature, no switch needed.
        await open(`/pool/${JITO_POOL}`, 12_000);
        await toTicket();
        await shot("jito-position");
        await open(`/pool/${SOL_USDC}?tab=position`, 14_000);
        await shot("solusdc-position");
        await toTicket();
        if (size.mobile) await shot("solusdc-position-ticket");
        await open(`/pool/${SOL_USDC}?tab=swap`);
        await toTicket();
        await shot("solusdc-swap");
      } else {
        await open(`/pool/${MET_POOL}?tab=position`, 14_000);
        await toTicket();
        await shot("met-position-open");
        // The person's own shape: the fourth goal opens the painter.
        const own = page.getByRole("radio", { name: lang === "uk" ? /Своя/ : /My shape|Own/ });
        if (await own.count()) {
          await own.first().click();
          await page.waitForTimeout(1_500);
          await shot("met-position-open-shape");
        }
      }
      if (errors.length) report.push(`${mode}-${size.name}-${lang}: page errors — ${errors.join(" | ")}`);
      await context.close();
    }
  }
}

writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
await browser.close();
