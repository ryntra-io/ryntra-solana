// Run from repo root: node --test lib/predictions/assistant/assistant.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_TOOLS, assertToolBoundary, forbiddenWordsIn } from "../../agent/tools/registry.ts";
import { resolveAgentBudgetConfig } from "../../agent/budget.ts";
import { createFixtureAgentModel } from "../../agent/model.ts";
import { createMemoryGuardStore } from "../../guard/store.ts";
import { createPredictionAgentTools, PREDICTION_AGENT_TOOL_NAMES } from "./agent-tools.ts";
import { planDraftFrom } from "./draft.ts";
import { brier, JOURNAL_LINE_GAP_MS, readJournal, scoreJournal, settleJournal, writeJournalLine } from "./journal.ts";
import { askRyntraOnMarket, disclaimerText, planPredictionCalls } from "./service.ts";
import { ASK_BUTTONS, topicOf, topicQuestion } from "./topics.ts";

const H = 3_600_000;
const NOW = Date.parse("2026-10-21T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const GUEST = `guest_${"a".repeat(32)}`;
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function makeEvent({ status = "open", endDate = iso(NOW + 10 * 24 * H), yes = 0.62, winner = null, rules = true, differences = 2 } = {}) {
  const market = {
    id: "m-fed",
    venue: "polymarket",
    question: "Will the Fed cut rates in October?",
    status,
    outcomes: [
      { id: "o-yes", label: "Yes", probability: yes, venueMarketId: "m-fed", winner: winner === null ? null : winner === "yes", matched: [] },
      { id: "o-no", label: "No", probability: 1 - yes, venueMarketId: "m-fed", winner: winner === null ? null : winner === "no", matched: [] },
    ],
    volume: 1_250_000,
    endDate,
    resolutionDate: iso(Date.parse(endDate) + 24 * H),
    description: rules ? "This market will resolve to Yes if the Federal Reserve announces a cut to the federal funds target range at its October meeting. The resolution source will be the official statement of the Federal Reserve (https://www.federalreserve.gov). If the meeting is postponed, the market resolves to No." : null,
    rules: { primary: null, secondary: null },
    tickSize: 0.01,
    minOrderSize: 1,
    aggKey: null,
    arbReturn: null,
    matched: [{ id: "m-fed-k", venue: "kalshi", question: "Fed cut in October?", status: "open", outcomes: [], volume: 400_000, description: null, rules: { primary: null, secondary: null } }],
    image: null,
  };
  return {
    id: "e-fed",
    title: "Fed decision in October",
    subtitle: null,
    image: null,
    status,
    venue: "polymarket",
    venues: ["polymarket", "kalshi"],
    volume: 1_650_000,
    endDate,
    categories: [],
    marketCount: 1,
    aggKey: null,
    structureType: null,
    arbReturn: null,
    leading: [],
    description: null,
    startDate: null,
    markets: [market],
    settlement: { sharedSummary: "Both settle on the Fed's statement.", differences: Array.from({ length: differences }, (_, i) => ({ type: "source", title: i === 0 ? "Resolution source" : "Postponement", summary: null, perVenue: {} })) },
  };
}

function makeProvider({ event = makeEvent(), news = null, bars = null, book = null, fail = {} } = {}) {
  const calls = [];
  const ok = (value) => ({ ok: true, value });
  const down = { ok: false, code: "UNAVAILABLE", message: "down" };
  return {
    calls,
    async event(id) {
      calls.push(`event:${id}`);
      return fail.event ? down : id === event.id ? ok(event) : { ok: false, code: "NOT_FOUND", message: "no" };
    },
    async news(id) {
      calls.push(`news:${id}`);
      if (fail.news) return down;
      return ok(news ?? { window: "7d", query: "fed", articles: [
        { title: "Fed officials signal a cut is on the table", source: "Reuters", publishedAt: iso(NOW - 3 * H), url: "https://example.org/a", summary: "" },
        { title: "Markets weigh the October meeting", source: "Bloomberg", publishedAt: iso(NOW - 40 * H), url: "https://example.org/b", summary: "" },
      ] });
    },
    async book(id) {
      calls.push(`book:${id}`);
      if (fail.book) return down;
      return ok(book ?? { venueMarketId: id, status: "ok", error: null, requested: null, venues: [{ venue: "polymarket", venueMarketId: id, tickSize: 0.01, bids: [], asks: [] }], matched: [], aggregated: { bids: [{ price: 0.61, size: 2000, venues: {} }], asks: [{ price: 0.63, size: 300, venues: {} }, { price: 0.66, size: 400, venues: {} }] }, readAt: iso(NOW) });
    },
    async chart(id) {
      calls.push(`chart:${id}`);
      if (fail.chart) return down;
      const list = bars ?? Array.from({ length: 30 }, (_, i) => ({ t: NOW - (29 - i) * H, o: 0.5, h: 0.6, l: 0.5, c: i <= 5 ? 0.55 : 0.62, v: null }));
      return ok({ outcomeId: id, venue: "polymarket", resolution: "1h", bars: list, staleSeconds: 0, lastBarAt: list.at(-1)?.t ?? null });
    },
  };
}

const budget = (on = true) => ({ ...resolveAgentBudgetConfig({}), modelEnabled: on });
const deps = (over = {}) => ({ store: createMemoryGuardStore(), provider: makeProvider(), model: null, budget: budget(false), now: () => NOW, ...over });
const ask = (over = {}) => ({ asker: { kind: "guest", key: GUEST }, eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-yes", topic: "yes", text: "", locale: "uk", amountUsd: 10, ...over });
const allText = (answer) => Object.values(answer).flatMap((v) => (Array.isArray(v) ? v.map((s) => s.text) : [])).join(" \n");

/* ------------------------------------------------------------ the boundary */

test("the prediction tools hold the assistant's own boundary: two kinds, snake case, no verb of execution, no name twice", () => {
  const tools = createPredictionAgentTools(makeProvider());
  assert.doesNotThrow(() => assertToolBoundary(tools));
  // Registered beside the assistant's own tools, none collides.
  assert.doesNotThrow(() => assertToolBoundary([...AGENT_TOOLS, ...tools]));
  assert.deepEqual(tools.map((t) => t.name), [...PREDICTION_AGENT_TOOL_NAMES]);
  for (const tool of tools) assert.deepEqual(forbiddenWordsIn(tool.name), [], tool.name);
  assert.deepEqual(tools.filter((t) => t.kind === "prepare").map((t) => t.name), ["prediction_plan_prepare"]);
});

test("a tool's input is held to its schema: an id with a slash or a negative stake is refused before any read", () => {
  const [market, , , , , plan] = createPredictionAgentTools(makeProvider());
  assert.equal(market.input.safeParse({ eventId: "../x", venueMarketId: "m" }).success, false);
  assert.equal(plan.input.safeParse({ eventId: "e", venueMarketId: "m", amountUsd: -1 }).success, false);
  assert.equal(market.input.safeParse({ eventId: "e", venueMarketId: "m", extra: 1 }).success, false);
});

test("the server decides the reads by topic; the plan draft is the only prepare and only on its topic", () => {
  const scope = { eventId: "e", venueMarketId: "m", outcomeId: "o" };
  for (const topic of ["yes", "basis", "news", "risks", "overview"]) assert.equal(planPredictionCalls(topic, scope).some((c) => c.name === "prediction_plan_prepare"), false, topic);
  assert.deepEqual(planPredictionCalls("plan", scope, 25).at(-1), { name: "prediction_plan_prepare", input: { ...scope, amountUsd: 25 } });
  assert.deepEqual(planPredictionCalls("news", scope).map((c) => c.name), ["prediction_move_read", "prediction_news_read", "prediction_market_read"]);
});

/* ------------------------------------------------------------ topics */

test("a typed question is read into its topic by its words, in both languages", () => {
  assert.equal(topicOf("Що потрібно, щоб виграло «Так»?"), "yes");
  assert.equal(topicOf("What has to happen for Yes to win?"), "yes");
  assert.equal(topicOf("Де підстава?"), "basis");
  assert.equal(topicOf("why did it move today"), "news");
  assert.equal(topicOf("Які ризики?"), "risks");
  assert.equal(topicOf("склади план"), "plan");
  assert.equal(topicOf("привіт"), "overview");
  assert.equal(topicOf(""), "overview");
  assert.deepEqual(ASK_BUTTONS, ["yes", "basis", "news", "risks", "plan"]);
  assert.equal(topicQuestion("yes", "uk", "No"), "Що потрібно, щоб виграло «Ні»?");
  assert.match(topicQuestion("yes", "en", "Trump"), /“Trump”/);
});

/* ------------------------------------------------------------ the answer */

test("«what makes Yes win»: the price as the market's, the venue's condition quoted, the source, the dates — every sentence cited, «not advice»", async () => {
  const d = deps();
  const r = await askRyntraOnMarket(d, ask());
  assert.equal(r.topic, "yes");
  assert.equal(r.composedBy, "deterministic");
  const text = allText(r.answer);
  assert.match(text, /учасники ринку оцінюють шанс у 62 %/);
  assert.match(text, /власного шансу Ryntra не дає/);
  assert.match(text, /Коли виграє «Так», словами майданчика: “This market will resolve to Yes if the Federal Reserve/);
  assert.match(text, /Що вирішує результат:/);
  assert.doesNotMatch(text, /https?:\/\//, "no link in a sentence");
  assert.match(text, /Торги закриваються 31 жовтня 2026/);
  assert.equal(r.disclaimer, disclaimerText("uk"));
  assert.match(r.disclaimer, /^Це не порада/);
  for (const section of ["observation", "meaning", "risks", "checks"]) for (const s of r.answer[section]) if (!/Ryntra/.test(s.text)) assert.ok(s.cites.length > 0 || section !== "observation", `${section}: ${s.text}`);
  // The rules' address waits in the sources, with its time.
  const rules = r.sources.find((s) => s.kind === "rules");
  assert.equal(rules.href, "https://www.federalreserve.gov");
  assert.equal(rules.at, iso(NOW));
  assert.equal(r.draft, null);
  assert.ok(!/\bRyn\b/.test(text));
});

test("«where is the catch»: the venues settle it differently, said as a counter-argument with the differences", async () => {
  const r = await askRyntraOnMarket(deps(), ask({ topic: "basis", locale: "en" }));
  const text = allText(r.answer);
  assert.match(text, /The venues settle this market differently in 2 ways/);
  assert.match(text, /Where they differ: Resolution source; Postponement\./);
  assert.match(text, /its rules, not another's, decide the payout/);
  // The order book is not read for a question about the rules.
  assert.equal(deps().provider.calls.length, 0);
});

test("«24 hours»: the move with its two prices, the news apart with each headline's own time and link, a headline marked as a report", async () => {
  const d = deps();
  const r = await askRyntraOnMarket(d, ask({ topic: "news" }));
  const text = allText(r.answer);
  assert.match(text, /За 24 години «Так» змінився з 55 % до 62 % \(\+7 п\.п\.\)/);
  assert.match(text, /За останні 24 години пошук знайшов новин про цей ринок: 1/);
  assert.match(text, /Reuters: “Fed officials signal a cut is on the table”/);
  const reuters = r.sources.find((s) => s.label === "Reuters");
  assert.equal(reuters.at, iso(NOW - 3 * H));
  assert.equal(reuters.href, "https://example.org/a");
  assert.match(text, /Заголовок — це чиєсь повідомлення, а не результат/);
});

test("«risks»: thin liquidity, a wide spread, a move without news — each on the reads that met", async () => {
  const d = deps({ provider: makeProvider({ news: { window: "7d", query: "fed", articles: [] } }) });
  const r = await askRyntraOnMarket(d, ask({ topic: "risks" }));
  const text = allText(r.answer);
  assert.match(text, /Мала ліквідність/);
  assert.doesNotMatch(text, /Широкий спред/);
  assert.match(text, /Ціна зрушила на п'ять пунктів і більше за добу, а новин не знайдено/);
  assert.match(text, /У правилах є застереження \(1\)/);
});

test("closing within a day is a risk, said on the market's own read", async () => {
  const d = deps({ provider: makeProvider({ event: makeEvent({ endDate: iso(NOW + 5 * H) }) }) });
  const r = await askRyntraOnMarket(d, ask({ topic: "risks", locale: "en" }));
  assert.match(allText(r.answer), /Less than a day to the close/);
});

test("the plan draft: entry from the best ask, the whole stake as the most one can lose, the exit and the close — a draft, never an order", async () => {
  const d = deps();
  const r = await askRyntraOnMarket(d, ask({ topic: "plan", amountUsd: 25 }));
  assert.deepEqual(
    { entry: r.draft.entryProbability, max: r.draft.maxProbability, amount: r.draft.amountUsd, exit: r.draft.invalidationBelow, outcome: r.draft.outcomeId },
    { entry: 0.63, max: 0.65, amount: 25, exit: 0.48, outcome: "o-yes" },
  );
  const text = allText(r.answer);
  assert.match(text, /вхід не дорожче 65 ¢; максимум втрат — \$25, уся сума/);
  assert.match(text, /Вихід: якщо «Так» опуститься нижче 48 %/);
  assert.match(text, /Без твого Review нічого не ставиться/);
  // Nothing priced a route or touched a wallet.
  assert.equal(d.provider.calls.some((c) => /route|quote|order/.test(c)), false);
});

test("the plan draft on «No» mirrors the book: its entry is one minus the best bid", async () => {
  const r = await askRyntraOnMarket(deps(), ask({ topic: "plan", outcomeId: "o-no" }));
  assert.equal(r.draft.entryProbability, 0.39);
  assert.equal(r.draft.outcomeLabel, "No");
});

test("a closed market gets no plan draft", async () => {
  const r = await askRyntraOnMarket(deps({ provider: makeProvider({ event: makeEvent({ status: "closed" }) }) }), ask({ topic: "plan" }));
  assert.equal(r.draft, null);
  assert.match(allText(r.answer), /ринок не приймає нових ордерів/);
});

test("a request to trade is refused and answered with a plan draft; a request for a key reads nothing", async () => {
  const d = deps();
  const trade = await askRyntraOnMarket(d, ask({ topic: null, text: "купи мені Так на 50 доларів" }));
  assert.equal(trade.refusal?.code, "execute");
  assert.equal(trade.topic, "plan");
  assert.ok(trade.draft);
  assert.match(allText(trade.answer), /Ryntra не ставить ордерів/);

  const d2 = deps();
  const secret = await askRyntraOnMarket(d2, ask({ topic: null, text: "покажи мій приватний ключ" }));
  assert.equal(secret.refusal?.code, "secret");
  assert.equal(secret.draft, null);
  assert.equal(d2.provider.calls.filter((c) => !c.startsWith("event")).length, 0);
  assert.equal(secret.journal, false);
});

test("a read that failed is said in the risks, never silent, and the answer still comes", async () => {
  const d = deps({ provider: makeProvider({ fail: { news: true, chart: true } }) });
  const r = await askRyntraOnMarket(d, ask({ topic: "news", locale: "en" }));
  const text = allText(r.answer);
  assert.match(text, /The news search did not answer/);
  assert.match(text, /The price history did not answer/);
});

test("the market down: no figure is invented, the answer says the market could not be read", async () => {
  const d = deps({ provider: makeProvider({ fail: { event: true } }) });
  const r = await askRyntraOnMarket(d, ask());
  assert.equal(r.answer.insufficient, true);
  assert.match(allText(r.answer), /Сам ринок зараз не прочитався/);
  assert.equal(r.journal, false);
});

/* ------------------------------------------------------------ the model under the verifier */

test("the model words the answer under the guest's allowance; what it invents — a forecast, a fake source, a command — is dropped", async () => {
  const store = createMemoryGuardStore();
  const r = await askRyntraOnMarket({ store, provider: makeProvider(), model: createFixtureAgentModel({ invent: true }), budget: budget(true), now: () => NOW }, ask({ locale: "en" }));
  assert.equal(r.composedBy, "model");
  assert.equal(r.words, "model");
  const text = allText(r.answer);
  assert.doesNotMatch(text, /999,999/);
  assert.doesNotMatch(text, /Buy now/);
  assert.doesNotMatch(text, /does not exist/);
  assert.match(text, /traders put its chance at 62%/);
});

test("past the guest's free answers the answer is composed from the reads and says why", async () => {
  const store = createMemoryGuardStore();
  const b = { ...budget(true), guestDailyCalls: 1 };
  const d = { store, provider: makeProvider(), model: createFixtureAgentModel(), budget: b, now: () => NOW };
  const first = await askRyntraOnMarket(d, ask());
  const second = await askRyntraOnMarket(d, ask());
  assert.equal(first.words, "model");
  assert.equal(second.words, "reads-free-spent");
  assert.equal(second.composedBy, "deterministic");
});

test("a wallet's question rides the wallet's allowance; a model that failed costs nothing and the reads answer", async () => {
  const store = createMemoryGuardStore();
  const r = await askRyntraOnMarket({ store, provider: makeProvider(), model: createFixtureAgentModel({ fail: "timeout" }), budget: budget(true), now: () => NOW }, ask({ asker: { kind: "wallet", wallet: WALLET } }));
  assert.equal(r.composedBy, "deterministic");
  assert.match(allText(r.answer), /62 %/);
});

test("no model on the deployment: nothing is reserved and the reads answer", async () => {
  const r = await askRyntraOnMarket(deps({ model: createFixtureAgentModel(), budget: budget(false) }), ask());
  assert.equal(r.composedBy, "deterministic");
  assert.equal(r.words, "reads");
});

/* ------------------------------------------------------------ the journal */

test("each answer writes the journal: the market's price then, Ryntra's own probability none — one line an hour", async () => {
  const store = createMemoryGuardStore();
  let now = NOW;
  const d = { store, provider: makeProvider(), model: null, budget: budget(false), now: () => now };
  assert.equal((await askRyntraOnMarket(d, ask())).journal, true);
  assert.equal((await askRyntraOnMarket(d, ask({ topic: "news" }))).journal, false, "the same hour");
  now += JOURNAL_LINE_GAP_MS;
  assert.equal((await askRyntraOnMarket(d, ask({ topic: "risks" }))).journal, true);
  const [record] = await readJournal(store);
  assert.equal(record.lines.length, 2);
  assert.deepEqual(record.lines[0], { at: iso(NOW), topic: "yes", market: 0.62, ryntra: null });
  assert.equal(record.outcomeLabel, "Yes");
  assert.equal(JSON.stringify(record).includes(WALLET), false);
});

test("after the settlement the journal scores the market's price with Brier beside Ryntra's (none yet) and a calibration table", async () => {
  const store = createMemoryGuardStore();
  await writeJournalLine(store, { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-yes", outcomeLabel: "Yes", question: "Q", topic: "yes", market: 0.8, nowMs: NOW });
  await writeJournalLine(store, { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-yes", outcomeLabel: "Yes", question: "Q", topic: "yes", market: 0.6, nowMs: NOW + 2 * H });
  // Not settled yet: nothing is scored.
  assert.equal(await settleJournal(store, makeProvider(), NOW + 3 * H), 0);
  let score = scoreJournal(await readJournal(store));
  assert.equal(score.brierMarket, null);
  // Checked again only after the gap; then the venue names the winner.
  const settledProvider = makeProvider({ event: makeEvent({ status: "resolved", winner: "yes" }) });
  assert.equal(await settleJournal(store, settledProvider, NOW + 4 * H), 0, "too soon to check again");
  assert.equal(await settleJournal(store, settledProvider, NOW + 10 * H), 1);
  score = scoreJournal(await readJournal(store));
  assert.equal(score.settledMarkets, 1);
  assert.equal(score.brierMarket, 0.1); // ((0.8-1)^2 + (0.6-1)^2) / 2
  assert.equal(score.brierRyntra, null);
  assert.equal(score.ryntraLines, 0);
  assert.deepEqual(score.calibration.filter((b) => b.lines > 0).map((b) => [b.from, b.lines, b.won]), [[0.6, 1, 1], [0.8, 1, 1]]);
  // A settled market takes no more lines.
  assert.equal(await writeJournalLine(store, { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-yes", outcomeLabel: "Yes", question: "Q", topic: "yes", market: 1, nowMs: NOW + 20 * H }), false);
});

test("a resolved market without a named winner is no score", async () => {
  const store = createMemoryGuardStore();
  await writeJournalLine(store, { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-yes", outcomeLabel: "Yes", question: "Q", topic: "yes", market: 0.5, nowMs: NOW });
  assert.equal(await settleJournal(store, makeProvider({ event: makeEvent({ status: "resolved" }) }), NOW + 10 * H), 0);
  assert.equal(scoreJournal(await readJournal(store)).settledMarkets, 0);
});

test("Brier: perfect is 0, a coin's half every time is 0.25", () => {
  assert.equal(brier([]), null);
  assert.equal(brier([{ p: 1, won: true }, { p: 0, won: false }]), 0);
  assert.equal(brier([{ p: 0.5, won: true }, { p: 0.5, won: false }]), 0.25);
});

test("planDraftFrom: no price, no draft; a low price leaves no exit number; the stake defaults to $10", () => {
  const base = { eventId: "e", venueMarketId: "m", outcomeId: "o", outcomeLabel: "Yes", question: "Q", deadline: null, readAt: iso(NOW) };
  assert.equal(planDraftFrom({ ...base, price: null, amountUsd: 10 }), null);
  assert.equal(planDraftFrom({ ...base, price: 1, amountUsd: 10 }), null);
  const low = planDraftFrom({ ...base, price: 0.1, amountUsd: null });
  assert.equal(low.invalidationBelow, null);
  assert.equal(low.amountUsd, 10);
  assert.equal(planDraftFrom({ ...base, price: 0.985, amountUsd: 5 }).maxProbability, 0.99);
});

test("the journal scores forecasts only: no line on a closed, settled or past-close market", async () => {
  for (const event of [makeEvent({ status: "closed" }), makeEvent({ status: "resolved", winner: "yes", yes: 0.99 }), makeEvent({ endDate: iso(NOW - 2 * H) })]) {
    const store = createMemoryGuardStore();
    const r = await askRyntraOnMarket({ store, provider: makeProvider({ event }), model: null, budget: budget(false), now: () => NOW }, ask());
    assert.equal(r.journal, false, event.markets[0].status);
    assert.deepEqual(await readJournal(store), []);
  }
  // Closing within the day is still a forecast.
  const store = createMemoryGuardStore();
  const closing = await askRyntraOnMarket({ store, provider: makeProvider({ event: makeEvent({ endDate: iso(NOW + 3 * H) }) }), model: null, budget: budget(false), now: () => NOW }, ask());
  assert.equal(closing.journal, true);
});

test("a market of three outcomes: the draft starts from the outcome's own price, never the first outcome's book mirrored", async () => {
  const event = makeEvent();
  const market = event.markets[0];
  const three = { ...event, markets: [{ ...market, outcomes: [
    { id: "o-a", label: "Alice", probability: 0.5, venueMarketId: "m-fed", winner: null, matched: [] },
    { id: "o-b", label: "Bob", probability: 0.3, venueMarketId: "m-fed", winner: null, matched: [] },
    { id: "o-c", label: "Carol", probability: 0.2, venueMarketId: "m-fed", winner: null, matched: [] },
  ] }] };
  const r = await askRyntraOnMarket(deps({ provider: makeProvider({ event: three }) }), ask({ topic: "plan", outcomeId: "o-c", locale: "en" }));
  assert.equal(r.draft.entryProbability, 0.2);
  assert.doesNotMatch(allText(r.answer), /offered from/, "no book read is said for a third outcome");
  const first = await askRyntraOnMarket(deps({ provider: makeProvider({ event: three }) }), ask({ topic: "plan", outcomeId: "o-a" }));
  assert.equal(first.draft.entryProbability, 0.63, "the first outcome's own book");
});

test("a credits store that does not answer: the model is not called, the reads answer", async () => {
  const store = createMemoryGuardStore();
  let calls = 0;
  const model = { ...createFixtureAgentModel(), compose: async (...a) => { calls += 1; return createFixtureAgentModel().compose(...a); } };
  const credits = { config: {}, lookup: async () => { throw new Error("down"); } };
  const broken = { ...credits, get config() { throw new Error("down"); } };
  const r = await askRyntraOnMarket({ store, provider: makeProvider(), model, budget: budget(true), credits: broken, now: () => NOW }, ask({ asker: { kind: "wallet", wallet: WALLET } }));
  assert.equal(calls, 0);
  assert.equal(r.words, "reads-busy");
  assert.equal(r.composedBy, "deterministic");
});
