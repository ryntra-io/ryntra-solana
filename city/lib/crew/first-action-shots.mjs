// CITY-222 — the first action of a newcomer, walked as a newcomer walks it: the first screen → one sentence to the agent
// (the hint, «Ask Ryntra» / ⌘K, Agents → Hire) → the agent's card → the wallet → «Sign» → the agent at work. Desk 1440×900
// and phone 390×844, English and Ukrainian, three times — a guest (no wallet in the browser: where the way out to a wallet
// leads and whether it comes back to the card), a wallet (a Wallet-Standard stub that connects and refuses to sign) and a
// wallet with too little SOL. The same walk serves «before» (master) and «after» (the branch).
//   NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open \
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_TRADE=open npx next dev -p 3222
//   node city/lib/crew/first-action-shots.mjs [out=docs/shots/city-222/after] [base=http://localhost:3222]
//   LANGS=en,uk  SIZES=desk,phone  PASSES=guest,wallet,low  PRESS_CHROME=<chromium>
// → <out>/<lang>-<size>-<pass>-<n>-<step>.jpg and <out>/walk.json (taps to the signature, funnel beacons, page errors).
//
// Every figure is a fixture: the city's read is the bundled snapshot; the agent's book answers as the engine does. The
// wallet's address is public and made up: nothing signs, nothing leaves the stand. The funnel's beacons are caught here and
// never reach a database.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-222/after");
const base = process.argv[3] ?? "http://localhost:3222";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const WALLET = "Rev1ewWa11etPub1icAddress1111111111111111111";
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const PASSES = (process.env.PASSES ?? "guest,wallet,low").split(",");
/* The sentence a newcomer says when the screen gives no example: the operator's own («торгуй на 0,1 SOL на день»). */
const SAY = { en: "trade for me with 0.1 SOL a day", uk: "торгуй за мене на 0,1 SOL на день" };
const ASK = { en: "Ask Ryntra", uk: "Спитати Ryntra" };

const now = Date.now();
const H = 3_600_000;
const RECORD = {
  owner: WALLET,
  settings: "4GYqmkrEEs1x2SXaFMAh299dskoD5VWLDe4dVVbusQj2",
  vault: "XJsZYQmFpRi7ApQ942wQiJm5nGX3eef15n3385bKcP6",
  policy: "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3",
  budget: "6KYi9ZNLkcyQR9Cf5UimuagUJcxMRPRqBdCoWfawSZNF",
  perTrade: "20000000",
  perDay: "100000000",
  expiresAt: String(Math.floor(now / 1000) + 30 * 86_400),
};
const COIN = SNAPSHOT.towers.find((t) => t.symbol === "BONK")?.id ?? "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
/* The minute after the signature: the agent on, its first buy within the hour, nothing bought yet. */
const FRESH = {
  network: "mainnet",
  status: "working",
  pausedBy: null,
  strategy: "steady",
  /* The plan the card proposed and the signature carried: the steady one at the city's calm pace, one buy a day. */
  plan: "steady,pace:1",
  receiveMint: COIN,
  symbol: "BONK",
  everyMs: 86_400_000,
  result: { trades: 0, spentRaw: "0", boughtRaw: "0", worthRaw: null, earnedRaw: null, multiple: null },
  last: [],
  updatedAt: now,
  frozen: false,
  mission: { state: "waiting", reason: "first", nextAt: now + 0.6 * H },
  books: { state: "exact", budgetRaw: "100000000", spentRaw: "0", leftRaw: "100000000", pendingRaw: "0", gapRaw: "0" },
};

const stubWallet = (address) => `
  (() => {
    const account = { address: ${JSON.stringify(address)}, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Test wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLz4=" };
    const refuse = async () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); };
    const wallet = {
      version: "1.0.0", name: "Test wallet", icon: account.icon, chains: ["solana:mainnet"], accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse },
        "solana:signAllTransactions": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAllTransactions: refuse },
        "solana:signMessage": { version: "1.0.0", signMessage: refuse },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => { try { event.detail.register(wallet); } catch {} });
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  })();
`;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const pass of PASSES) {
      /* A phone says it is one: the wallet picker offers the wallet app's browser there, as on a real phone. */
      const userAgent = size.mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" : undefined;
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", timezoneId: "Europe/Kyiv", reducedMotion: "reduce", ...(userAgent ? { userAgent } : {}) });
      if (pass !== "guest") await context.addInitScript(stubWallet(WALLET));
      const page = await context.newPage();
      const step = (what) => console.log(`${new Date().toISOString().slice(11, 19)} ${size.name} ${lang} ${pass} ${what}`);
      const errors = [];
      const beacons = [];
      let taps = 0;
      page.on("pageerror", (e) => {
        errors.push(String(e).slice(0, 300));
        step(`page error: ${String(e).slice(0, 160)}`);
      });
      const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      let view = null;
      await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
      await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
      await context.route(/\/api\/track$/, (route) => {
        try {
          beacons.push(JSON.parse(route.request().postData() ?? "{}"));
        } catch {}
        return route.fulfill({ status: 204, body: "" });
      });
      await context.route(/\/api\/run$/, (route) => route.fulfill({ status: 204, body: "" }));
      await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "mainnet", active: true, budgetLamports: "100000000" }));
      await context.route(/\/api\/bots\/mandate\/agent/, (route) => (view ? json(route, view) : json(route, { error: "none" }, 404)));
      await context.route(/\/api\/bots\/mandate\/report/, (route) => json(route, { on: false, hour: 20, kept: true }));
      await context.route(/\/api\/bots\/mandate\/review/, (route) => json(route, { error: { code: "STAND", message: "The stand builds nothing." } }, 400));
      /* «low»: a wallet with 0.04 SOL — less than the budget and the agent's fees — is offered «Add SOL». */
      const sol = pass === "low" ? "40000000" : "405000000";
      await context.route(/\/api\/solana\/holdings/, (route) => json(route, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: sol, spendableRaw: sol, decimals: 9, symbol: "SOL" }] } }));

      let n = 0;
      let walletLink = null;
      let cameBack = null;
      const shot = async (name) => {
        await page.waitForTimeout(900);
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        n += 1;
        const file = `${lang}-${size.name}-${pass}-${n}-${name}.jpg`;
        for (let tries = 1; ; tries += 1) {
          try {
            await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, timeout: 180_000 });
            break;
          } catch (error) {
            if (tries >= 3) throw error;
            await page.waitForTimeout(5_000);
          }
        }
        report.push({ size: size.name, lang, pass, name, file, taps });
        step(`shot ${name} (taps ${taps})`);
      };
      const tap = async (locator) => {
        taps += 1;
        await locator.first().click({ timeout: 30_000 });
      };

      step("open the city");
      await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForFunction(() => window.__city?.getState().snapshot.towers.length > 0 && typeof window.__openCommand === "function", null, { timeout: 600_000 });
      await page.waitForTimeout(9_000);
      await page.evaluate(() => window.__quarter?.setState({ later: true }));

      // 1 · The first screen: what it asks a newcomer to do.
      await page.locator("[data-city-hint]").waitFor({ timeout: 20_000 }).catch(() => step("no first hint"));
      const hint = await page.locator("[data-city-hint]").innerText().catch(() => null);
      await shot("first-screen");

      // 2 · The sentence: the first screen's one action and a ready sentence when it offers them, else «Ask Ryntra» and typing.
      let said = null;
      if (await page.locator("[data-first-action]").count()) {
        await tap(page.locator("[data-first-action]"));
        await page.locator("[data-city-command]").waitFor({ timeout: 20_000 });
        await shot("line-ready");
        const first = page.locator("[data-city-command] [data-crew-say]").first();
        said = (await first.innerText()).trim();
        await tap(first);
      } else {
        await tap(page.getByRole("button", { name: ASK[lang] }));
        await page.locator("[data-city-command]").waitFor({ timeout: 20_000 });
        await shot("line-empty");
        taps += 1; // typing the sentence counts as one action
        await page.locator("[data-city-command] input").fill(SAY[lang]);
        await page.waitForTimeout(500);
        await shot("line-typed");
        await page.locator("[data-city-command] input").press("Enter");
        said = SAY[lang];
      }

      // 3 · The agent's card.
      await page.locator("[data-autopilot]").waitFor({ timeout: 30_000 });
      await shot("card");
      const coinChip = page.locator('[data-autopilot] [role="radiogroup"] [role="radio"]');
      const needsCoin = !(await page.locator("[data-autopilot-coin]").count()) && (await coinChip.count()) > 0;
      if (needsCoin) {
        await tap(coinChip);
        await shot("card-coin");
      }

      // 4 · The wallet, from the card — and back to it.
      const connect = page.locator("[data-autopilot] [data-agent-connect], [data-autopilot] .action, [data-autopilot] button").filter({ hasText: lang === "uk" ? /Підключ/ : /Connect/ });
      if (await connect.count()) {
        await tap(connect);
        await page.waitForTimeout(800);
        if (pass === "guest" || (await page.locator("[data-autopilot] button").filter({ hasText: "Test wallet" }).count())) await shot("wallet-pick");
        if (pass === "guest") {
          // Where the way out to a wallet leads, and whether it comes back to the card.
          const out = page.locator("[data-autopilot] a").first();
          walletLink = await out.getAttribute("href").catch(() => null);
          if (size.mobile) {
            // A phone opens the page in the wallet app's own browser: it arrives on the agent's own address.
            await page.goto(`${base}/?quality=low&lang=${lang}&open=agent`, { waitUntil: "domcontentloaded", timeout: 300_000 });
          } else {
            // A computer installs the wallet and opens Ryntra again: the card it left is waiting.
            const popup = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
            await out.click().catch(() => {});
            await (await popup)?.close().catch(() => {});
            await page.reload({ waitUntil: "domcontentloaded", timeout: 300_000 });
          }
          await page.waitForFunction(() => window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 600_000 });
          cameBack = await page.locator("[data-autopilot]").waitFor({ timeout: 60_000 }).then(() => true, () => false);
          await page.waitForTimeout(1_500);
          await shot("card-back");
        }
        if (pass === "low") {
          const listed = page.locator("[data-autopilot] button").filter({ hasText: "Test wallet" });
          if (await listed.count()) await tap(listed);
          await page.locator("[data-agent-topup]").waitFor({ timeout: 30_000 }).catch(() => step("no Add SOL"));
          await shot("card-add-sol");
        }
        if (pass === "wallet") {
          // One wallet in the browser connects on the tap; a list only when there are more.
          const listed = page.locator("[data-autopilot] button").filter({ hasText: "Test wallet" });
          if (await listed.count()) await tap(listed);
          await page.locator("[data-autopilot-sign]").waitFor({ timeout: 30_000 }).catch(() => step("no sign button after connect"));
          await shot("card-connected");
        }
      }

      // 5 · «Sign»: the stand's wallet refuses — the card says so and stays.
      if (pass === "wallet" && (await page.locator("[data-autopilot-sign]").count())) {
        await tap(page.locator("[data-autopilot-sign]"));
        await page.waitForTimeout(2_500);
        await shot("sign-answered");

        // 6 · Signed (seated as the signature would leave it): the agent at work, in the card and in the city.
        view = FRESH;
        await page.evaluate(([record]) => {
          // As the signature leaves it: the wallet asked, then the agent on.
          window.__autopilotMandate.setState({ busy: "enable", note: null });
          window.__autopilotMandate.setState({ busy: null, note: { kind: "on", at: Date.now() } });
          window.__autopilotMandate.getState().keep(record);
          window.__autopilotMandate.getState().setStatus(record.policy, { active: true, budgetLamports: "100000000" });
        }, [RECORD]);
        await page.locator("[data-control]").first().waitFor({ timeout: 60_000 }).catch(() => step("no working card"));
        await page.evaluate(([policy, v]) => window.__autopilot.getState().setView(policy, v), [RECORD.policy, FRESH]);
        await page.waitForTimeout(1_500);
        await shot("working");
        await page.evaluate(() => window.__autopilot.getState().close());
        await page.waitForTimeout(2_500);
        await shot("city-after");
      }

      // 7 · The other way in: Agents in the menu → the bots window → the crew and the Trader's card.
      if (pass === "guest") {
        await page.evaluate(() => {
          window.__autopilot?.getState().close();
          window.__command?.setState?.({ open: false });
        });
        await page.waitForTimeout(600);
        const agents = page.locator('[data-deck-place="agents"]');
        if (await agents.count()) {
          await agents.first().click();
          await page.waitForTimeout(900);
          const bots = page.locator('[data-deck-door="bots"]');
          if (await bots.count()) await bots.first().click();
          await page.locator("[data-crew]").waitFor({ timeout: 30_000 }).catch(() => step("no crew"));
          await shot("agents-crew");
          await page.locator("[data-mandate]").scrollIntoViewIfNeeded().catch(() => {});
          await shot("agents-trader");
        }
      }

      report.push({ size: size.name, lang, pass, hint, said, tapsToSign: taps, walletLink, cameBack, beacons, errors });
      await context.close();
    }
  }
}

writeFileSync(path.join(out, "walk.json"), JSON.stringify(report, null, 2) + "\n");
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.tapsToSign !== undefined).map(({ size, lang, pass, hint, tapsToSign, walletLink, cameBack, beacons, errors }) => ({ size, lang, pass, hint, tapsToSign, walletLink, cameBack, beacons: beacons.map((b) => `${b.name}:${b.ref ?? ""}`), errors: errors.length })), null, 2));
