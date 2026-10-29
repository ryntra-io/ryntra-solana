// Run from repo root: node --test lib/assistant/web-ai06.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { API_CONTRACT_VERSION, AssistantProfileResponseSchema, AssistantProfileUpdateSchema } from "../api/v1/contract.ts";
import { resolveAgentBudgetConfig } from "../agent/budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OTHER_WALLET, OWNER } from "../agent/fixtures.ts";
import { AGENT_PROMPT_VERSION, createFixtureAgentModel, modelInput } from "../agent/model.ts";
import { handleAgentMessage, handleGuestMessage, openAgentSession } from "../agent/service.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { preferencesOf, readPreferences } from "../monitoring/store.ts";
import { readerOf, readProfileSurface, updateProfile } from "./profile/service.ts";
import { readProfileRecord } from "./profile/store.ts";

/**
 * AI-06 — «Помічник у вебі»: the side panel from the header with the five tabs (Розмова · Стежу · Плани · Огляди ·
 * Кредити), «Пояснити рух» · «Стежити» · «План» on a token's page and over its chart, «Що бачить Ryntra», and
 * «Знайомство» — five questions, once. The answers shape only the words; nothing here signs, sends, trades, approves
 * a spend or reads a key, and no answer costs a credit.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-20T18:00:00.000Z");
const ANSWERS = { goal: "learn", experience: "new", riskPct: 1, horizon: "days" };

test("«Знайомство»: null until answered; the four answers and where notes go are written once, read back the same", async () => {
  const store = createMemoryGuardStore();
  const before = await readProfileSurface(store, OWNER);
  AssistantProfileResponseSchema.parse(before);
  assert.equal(before.profile, null, "never answered: the assistant asks the five questions");
  assert.deepEqual(before.delivery, { inbox: true, telegram: true, push: true, quietHours: null }, "Нагляд's defaults until the person changes them");

  const quietHours = { start: "23:00", end: "08:00", timezone: "Europe/Kyiv" };
  const written = await updateProfile(store, OWNER, { ...ANSWERS, delivery: { telegram: false, push: true, quietHours } }, NOW);
  assert.deepEqual(written, { ok: true });
  const after = await readProfileSurface(store, OWNER);
  AssistantProfileResponseSchema.parse(after);
  assert.deepEqual({ ...after.profile, updatedAt: undefined }, { skipped: false, ...ANSWERS, updatedAt: undefined });
  assert.deepEqual(after.delivery, { inbox: true, telegram: false, push: true, quietHours }, "the fifth answer is Нагляд's own preferences — no second copy");
  const prefs = await readPreferences(store, OWNER);
  assert.equal(prefs.telegram, false);
  assert.deepEqual(prefs.quietHours, quietHours);

  /* Another wallet reads its own nothing. */
  assert.equal((await readProfileSurface(store, OTHER_WALLET)).profile, null);

  /* Changed later: a new version over the one read; the first answer's time of creation stays. */
  const first = await readProfileRecord(store, OWNER);
  await updateProfile(store, OWNER, { ...ANSWERS, experience: "pro" }, NOW + 60_000);
  const second = await readProfileRecord(store, OWNER);
  assert.equal(second.version, first.version + 1);
  assert.equal(second.experience, "pro");
  assert.equal(second.createdAt, first.createdAt);
  assert.equal((await readPreferences(store, OWNER)).telegram, false, "answers without `delivery` leave where notes go as it was");
});

test("«Пропустити» is an answer: the questions are not asked again, and Ryntra words answers for anyone", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await updateProfile(store, OWNER, { skipped: true }, NOW), { ok: true });
  const surface = await readProfileSurface(store, OWNER);
  assert.equal(surface.profile.skipped, true);
  assert.equal(surface.profile.goal, null);
  assert.equal(readerOf(surface.profile), null);
  assert.equal(readerOf(null), null);
  const answered = await updateProfile(store, OWNER, ANSWERS, NOW + 1);
  assert.ok(answered.ok);
  assert.deepEqual(readerOf((await readProfileSurface(store, OWNER)).profile), { experience: "new", goal: "learn", horizon: "days" }, "the risk per trade never reaches the model");
});

test("the body is one of two shapes, each strict: no half answers, no risk outside 0.5 / 1 / 2 %, no skip with answers", () => {
  assert.ok(AssistantProfileUpdateSchema.safeParse(ANSWERS).success);
  assert.ok(AssistantProfileUpdateSchema.safeParse({ skipped: true }).success);
  assert.ok(AssistantProfileUpdateSchema.safeParse({ ...ANSWERS, riskPct: 0.5 }).success);
  assert.equal(AssistantProfileUpdateSchema.safeParse({ ...ANSWERS, riskPct: 3 }).success, false);
  assert.equal(AssistantProfileUpdateSchema.safeParse({ goal: "learn" }).success, false);
  assert.equal(AssistantProfileUpdateSchema.safeParse({ skipped: true, ...ANSWERS }).success, false);
  assert.equal(AssistantProfileUpdateSchema.safeParse({ skipped: false }).success, false);
  assert.equal(AssistantProfileUpdateSchema.safeParse({ ...ANSWERS, wallet: OTHER_WALLET }).success, false, "no field names another wallet");
  assert.equal(AssistantProfileUpdateSchema.safeParse({ ...ANSWERS, delivery: { telegram: true, push: true, quietHours: { start: "25:00", end: "08:00", timezone: "Europe/Kyiv" } } }).success, false);
  /* 1.58.0 brought «Знайомство»; a later contract only adds (AI-18 and AI-19 — 1.59.0). */
  assert.ok(API_CONTRACT_VERSION.split(".").map(Number).reduce((acc, part) => acc * 1000 + part, 0) >= 1_058_000, API_CONTRACT_VERSION);
});

test("a store that lost the race is retried once; preferences written by another tab meanwhile are not overwritten blind", async () => {
  const store = createMemoryGuardStore();
  await updateProfile(store, OWNER, ANSWERS, NOW);
  /* Another tab writes Нагляд's preferences between the read and the write: compare-and-set fails once, the retry reads the new version. */
  const prefs = preferencesOf(store);
  const original = prefs.compareAndSet.bind(prefs);
  let raced = false;
  store.versioned = ((versioned) => (name) => {
    const collection = versioned(name);
    if (name !== "monitoringPreferences") return collection;
    return {
      ...collection,
      async compareAndSet(key, expected, next) {
        if (!raced) {
          raced = true;
          await original(key, null, { version: 1, owner: OWNER, inbox: true, telegram: true, push: false, quietHours: null, updatedAt: new Date(NOW).toISOString() });
          return false;
        }
        return collection.compareAndSet(key, expected, next);
      },
    };
  })(store.versioned.bind(store));
  const written = await updateProfile(store, OWNER, { ...ANSWERS, delivery: { telegram: false, push: true, quietHours: null } }, NOW + 1);
  assert.deepEqual(written, { ok: true });
  const after = await readPreferences(store, OWNER);
  assert.equal(after.version, 2, "written over the other tab's version, not under it");
  assert.equal(after.telegram, false);
});

test("the reader rides to the model with the wallet's question — only how to word it; a guest's question carries none", async () => {
  const fixture = await createFixtureWorld();
  const base = createFixtureAgentModel();
  const seen = [];
  const model = {
    ...base,
    async compose(packet, key) {
      seen.push(modelInput(packet).reader ?? null);
      return base.compose(packet, key);
    },
  };
  const deps = { store: fixture.store, readers: fixture.readers, model, budget: { ...resolveAgentBudgetConfig({}), modelEnabled: true }, now: () => FIXTURE_NOW_MS };
  await updateProfile(fixture.store, OWNER, ANSWERS, FIXTURE_NOW_MS);
  const opened = await openAgentSession(deps, { owner: OWNER, locale: "uk", context: null });
  const asked = await handleAgentMessage(deps, { owner: OWNER, sessionId: opened.response.session.id, text: "Чому SOL рухається?", locale: "uk" });
  assert.ok(asked.ok);
  assert.deepEqual(seen.at(-1), { experience: "new", goal: "learn", horizon: "days" });
  const calls = seen.length;
  const guest = await handleGuestMessage(deps, { guest: `guest_${"a6".repeat(16)}`, text: "Чому SOL рухається?", locale: "uk", context: null });
  assert.ok(guest.ok);
  assert.equal(seen.length, calls + 1, "the guest's question reached the model too");
  assert.equal(seen.at(-1), null, "a guest has no answers and the wallet's never reach it");
  /* The words the model reads: the reader shapes depth and window, never a figure, never a buy or a sell. */
  const model_ts = read("../agent/model.ts");
  assert.equal(AGENT_PROMPT_VERSION, "ryntra-text-v6");
  assert.match(model_ts, /When the packet has a reader, it says only how to word the answer, never what is true or what to do/);
  assert.match(model_ts, /The reader never adds a figure and never turns into a buy, a sell or a hold\./);
});

test("the profile's route is the proven wallet's own: a proof to read, a mutation proof to write, a durable store", () => {
  const route = read("../../app/api/v1/assistant/profile/route.ts");
  assert.match(route, /export async function GET[\s\S]*requireWalletProof\(request, "read"\)/);
  assert.match(route, /export async function PUT[\s\S]*requireWalletProof\(request, "mutation"\)[\s\S]*readApiBody\(request, AssistantProfileUpdateSchema, 1_024\)/);
  assert.match(route, /storeSurvivesColdStart\(guard\.store\)/);
  assert.match(read("../guard/store.ts"), /"assistantProfiles",/);
});

test("no tool of the web assistant signs, sends, trades, approves a spend, reads a key or charges a credit", () => {
  const files = [
    "../../app/api/v1/assistant/profile/route.ts",
    "./profile/service.ts",
    "./profile/store.ts",
    "../../app/app/ryn/meet.tsx",
    "../../app/app/ryn/plans-tab.tsx",
    "../../app/app/ryn/explain-move.tsx",
    "../../app/app/ryn/assistant-open.ts",
    "../../app/app/ryn/assistant-panel.tsx",
    "../../app/app/ryn/trade-plan.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /signTransaction|sendTransaction|signAllTransactions|signMessage|privateKey|secretKey|approve\(|\/api\/v1\/(spot|swap|send|money)|reserveCall|chargeCredits|credits\/orders/, file);
  }
  /* «Чому?» puts words in the field; only the person's press asks, at the price shown under it. */
  const surface = read("../../app/app/ryn/ryn-surface.tsx");
  assert.match(surface, /const intoChat = useCallback\(\(question: string\) => \{\s*setTab\("chat"\);\s*setText\(question\);\s*\}, \[\]\);/);
  /* AI-11: «Скласти з Ryntra» composes a plan with its critic in the tab, only on the press, at the price the server showed. */
  assert.match(read("../../app/app/ryn/plans-tab.tsx"), /<TradePlanComposer locale=\{locale\} mint=\{mint\} symbol=\{symbol\} prices=\{ryntra\.read\?\.prices \?\? null\} onCancel=\{\(\) => setComposing\(false\)\} \/>/);
  assert.match(read("../../app/app/ryn/trade-plan.tsx"), /acceptCredits: cost/);
  /* A plan is opened in the builder, where the person writes and saves it; Ryntra saves none. */
  assert.match(read("../../app/app/ryn/plans-tab.tsx"), /`\/app\/strategies\/new\?mint=\$\{encodeURIComponent\(mint\)\}`/);
});

test("a newcomer starts a watch in four presses: Ryntra → Стежу → a token → Увімкнути; from a token's page in two", () => {
  const watch = read("../../app/app/ryn/watch-panel.tsx");
  const surface = read("../../app/app/ryn/ryn-surface.tsx");
  const move = read("../../app/app/ryn/explain-move.tsx");
  /* A preset is chosen before the first press; the quick tokens are one press each; «Увімкнути» needs nothing else. */
  assert.match(watch, /useState<AssistantWatchesResponse\["presets"\]\[number\]\["id"\] \| null>\("drop24h"\)/);
  assert.match(watch, /QUICK_TOKENS\.map\(\(\[symbol, mint\]\) => \(\s*<button key=\{mint\} type="button" className=\{styles\.chip\} onClick=\{\(\) => setToken\(\{ mint, symbol, name: null, verified: true \}\)\}>/);
  assert.match(watch, /const ready = token !== null && \(detail \? detailRule !== null : preset !== null\);/);
  /* The panel opens on its tabs; «Стежу» is one of them, in the panel too. */
  assert.match(surface, /\["watch", "tabWatch", Bell, watchStatus\]/);
  assert.doesNotMatch(surface, /if \(!compact\) \{\s*\/\* The credits' tab/, "the panel is not the conversation alone any more");
  /* «Стежити» on a token's page opens «Стежу» with that token chosen. */
  assert.match(move, /tab: "watch" as const/);
  assert.match(surface, /initialToken=\{asset \? \{ mint: asset\.mint, symbol: asset\.symbol \?\? `\$\{asset\.mint\.slice\(0, 4\)\}…\$\{asset\.mint\.slice\(-4\)\}` \} : null\}/);
  assert.match(watch, /useState<Token \| null>\(initialToken \? \{ mint: initialToken\.mint, symbol: initialToken\.symbol, name: null, verified: null \} : null\)/);
});

test("«Що бачить Ryntra» says what it reads and what it never does, in both languages; «Ryntra», never «Ryn»", () => {
  const words = read("../../app/app/ryn/ryn-words.ts");
  assert.match(words, /seesWallet: \["Your wallet \{address\}: its holdings, plans, watches and notes — read only\.", "Твій гаманець \{address\}: активи, плани, стеження й нотатки — лише читає\."\]/);
  assert.match(words, /seesNever: \["It never sees keys and never signs, sends or trades\.", "Ключів не бачить і нічого не підписує, не надсилає й не торгує\."\]/);
  for (const key of ["obTitle", "obGoal", "obExperience", "obRisk", "obHorizon", "obWhere", "tabPlans", "actWatch", "actPlan", "seesLabel"]) {
    assert.match(words, new RegExp(`${key}: \\["[^"]+", "[^"]+"\\]`), key);
  }
  for (const file of ["../../app/app/ryn/meet.tsx", "../../app/app/ryn/plans-tab.tsx", "../../app/app/ryn/explain-move.tsx"]) {
    assert.doesNotMatch(read(file), /["«]Ryn["»\s]/, file);
  }
  /* One surface for the panel and the page. */
  assert.match(words, /tabChat: \["Chat", "Розмова"\]/);
  assert.match(words, /tabBrief: \["Briefs", "Огляди"\]/);
});

test("«Змінити» stays after «Пропустити», brings the card into view and opens on the questions, never on «Готово»", () => {
  const surface = read("../../app/app/ryn/ryn-surface.tsx");
  const meet = read("../../app/app/ryn/meet.tsx");
  /* A skip is said as «пропущено» with «Змінити» beside it, as the card's lead promises. */
  assert.match(surface, /\?\? \(profile\.read\?\.profile\?\.skipped \? word\("seesSkipped"\) : null\)/);
  assert.match(read("../../app/app/ryn/ryn-words.ts"), /obLead: \["[^"]*change it later\.", "[^"]*змінити потім\."\]/);
  /* A new card per mode: «Готово» of the first answers never stands in for the change's questions. */
  assert.match(surface, /key=\{profile\.shown === "edit" \? "edit" : "first"\}/);
  assert.match(surface, /const closing = next\.profile\?\.skipped \|\| profile\.shown === "edit";\s*profile\.setShown\(closing \? "closed" : "done"\);/);
  /* The change's card is at the top of the conversation; the press is at its foot: into view, the focus on its heading. */
  assert.match(meet, /if \(!onCancel\) return;\s*cardRef\.current\?\.scrollIntoView/);
  assert.match(meet, /<h2 id=\{heading\} className=\{styles\.title\} tabIndex=\{-1\}>/);
  /* A press that asked a question or opened a tab is answered first; the five questions wait. */
  assert.match(surface, /useProfile\(proven && phase\.status === "ready", initialQuestion !== null \|\| \(initialTab !== null && initialTab !== "chat"\)\)/);
});

test("a stored answer row of an older shape is written over by its own version, never stuck", async () => {
  const store = createMemoryGuardStore();
  await store.versioned("assistantProfiles").compareAndSet(`profile:solana:mainnet:${OWNER}`, null, { version: 3, owner: OWNER, legacy: true });
  assert.equal((await readProfileSurface(store, OWNER)).profile, null);
  assert.deepEqual(await updateProfile(store, OWNER, ANSWERS, NOW), { ok: true });
  const after = await readProfileRecord(store, OWNER);
  assert.equal(after.version, 4);
  assert.equal(after.goal, "learn");
});
