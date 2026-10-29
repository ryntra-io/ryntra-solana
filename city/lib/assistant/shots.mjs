// Ryntra in the city (CITY-10) for review: the button, the panel's ready questions, an answer that flies the camera to
// the towers it names and lights them, its Details, a question about the picked tower, and the city's own read while
// Ryntra cannot answer — at 1440×860 and 390×844 → <out>/assistant-<state>-<size>.jpg
//   node city/lib/assistant/shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Ryntra's words come from a stand-in for the assistant's guest seam, written from the city's own towers and their real
// figures (a cloud session has no model key); «away» is the real seam answering without one.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "city/lib/assistant/shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

const chrome = process.env.PRESS_CHROME || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: chrome, args: ["--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

/** Ryntra's turn as the guest seam writes it, from the towers the city stands and their real figures. */
function standIn(question, towers, subject) {
  const at = new Date().toISOString();
  const s = (text, cites = ["c_1"]) => ({ text, cites });
  const risers = towers.filter((t) => t.verified && t.liquidity >= 50_000 && t.change24h > 0).sort((a, b) => b.change24h - a.change24h).slice(0, 3);
  const lead = subject ?? risers[0];
  const observation = subject
    ? [s(`${lead.symbol} is ${pct(lead.change24h)} over 24 hours on $${(lead.volume24h / 1e6).toFixed(1)}M of volume.`)]
    : [s(`${risers.map((t) => `${t.symbol} ${pct(t.change24h)}`).join(", ")} lead the day's rise.`)];
  const meaning = subject ? [s(`The move came with more traders than usual, not with a single large buy.`)] : [s(`Volume rose with the moves, so they are not thin-book prints.`)];
  return {
    person: { id: "turn_p1", role: "person", at, text: question, class: "market", answer: null, cards: [], citations: [], handoffs: [], tools: [], composedBy: null, refusal: null, brief: null, critic: null },
    ryn: {
      id: "turn_r1",
      role: "ryn",
      at,
      text: subject ? `About ${lead.symbol} today` : "What is rising today",
      class: "market",
      answer: {
        observation,
        meaning,
        counter: [s("A list of movers is what moved most, often in thin markets; it is not a list of what to buy.")],
        risks: [s(`Liquidity under ${lead.symbol} is $${(lead.liquidity / 1e6).toFixed(1)}M: a large order moves the price.`)],
        checks: [s("Check whether the volume holds over the next hours."), s("Check the holders' concentration before deciding.")],
        actions: [],
        insufficient: false,
      },
      cards: [
        {
          kind: "move",
          mint: lead.id,
          symbol: lead.symbol,
          window: "24h",
          change: null,
          rows: [
            { mark: "fact", text: `${lead.symbol} moved ${pct(lead.change24h)} over 24 hours.`, cites: ["c_1"] },
            { mark: "inference", text: "The rise came in two steps, each with a jump in traders.", cites: ["c_1"] },
            { mark: "unknown", text: "No source names a cause for the move.", cites: [] },
          ],
        },
      ],
      citations: [
        { id: "c_1", tool: "movers_read", source: "Pulse (Jupiter's lists)", observedAt: at, state: "current", ref: null, href: "/app/home" },
        { id: "c_2", tool: "news_read", source: "News (allow-listed feeds)", observedAt: at, state: "current", ref: null, href: null },
      ],
      handoffs: [],
      tools: [],
      composedBy: "model",
      refusal: null,
      brief: null,
      critic: null,
    },
    guest: { day: { used: 2, allowance: 5, resetsAt: at }, model: "configured", needsWallet: false },
  };
}

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = (state) => page.screenshot({ path: path.join(out, `assistant-${state}-${s.name}.jpg`), quality: 82 });
  const tap = (locator) => (s.mobile ? locator.tap() : locator.click());

  let mode = "stand-in";
  await page.route("**/api/v1/assistant/guest", async (route) => {
    if (mode === "away") return route.continue();
    const body = JSON.parse(route.request().postData() ?? "{}");
    const state = await page.evaluate(() => window.__city.getState().snapshot.towers);
    const subject = body.context?.mint ? state.find((t) => t.id === body.context.mint) : null;
    await new Promise((r) => setTimeout(r, 900));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(standIn(body.text, state, subject)) });
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__city?.getState().snapshot.towers.length > 0 && window.__assistant, null, { timeout: 120_000 });
  await page.waitForTimeout(9000);
  // The newcomer's card and the first-visit tip step aside, as a returning visitor sees the city.
  for (const name of ["Later", "Got it"]) {
    const b = page.getByRole("button", { name, exact: true });
    if (await b.count()) await tap(b.first()).catch(() => {});
  }
  await page.waitForTimeout(800);
  await shot("button");

  // The software renderer here draws a frame in hundreds of milliseconds: the panels get time to finish rising.
  await tap(page.getByRole("button", { name: "Ask Ryntra" }));
  await page.waitForTimeout(2500);
  await shot("panel");

  await tap(page.getByRole("button", { name: "What’s rising and why?" }));
  await page.waitForTimeout(500);
  await shot("asking");
  await page.waitForFunction(() => window.__assistant.getState().phase === "answered", null, { timeout: 30_000 });
  // The camera's tour: the first tower of the answer, then each in turn, then all of them in one frame.
  await page.waitForTimeout(2200);
  await shot("tour");
  await page.waitForTimeout(10_000);
  await shot("answer");

  await tap(page.getByRole("button", { name: "Details" }));
  await page.waitForTimeout(1500);
  await shot("details");

  // A tower from the answer opens its own card; Ryntra, asked from the card, answers about that tower.
  await tap(page.getByRole("button", { name: /^Open / }).first());
  await page.waitForTimeout(3000);
  await shot("card");
  await tap(page.getByRole("button", { name: "Ask Ryntra" }));
  await page.waitForTimeout(2500);
  await shot("tower-panel");
  await tap(page.getByRole("button", { name: /^What’s with / }));
  await page.waitForFunction(() => window.__assistant.getState().phase === "answered", null, { timeout: 30_000 });
  await page.waitForTimeout(4000);
  await shot("tower-answer");

  // Ryntra away (the real seam with no model key here): the city still shows its own movers.
  mode = "away";
  await tap(page.getByRole("button", { name: "Close" }).last());
  await page.waitForTimeout(1500);
  await tap(page.getByRole("button", { name: "Ask Ryntra" }));
  await tap(page.getByRole("button", { name: "What’s falling?" }));
  await page.waitForFunction(() => window.__assistant.getState().phase === "answered", null, { timeout: 60_000 });
  await page.waitForTimeout(4000);
  await shot("away");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${s.name}: overflow=${overflow}px errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 200) : ""}`);
  await context.close();
}
await browser.close();
