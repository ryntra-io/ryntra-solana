// Run from repo root: node --test lib/assistant/telegram-ai07.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { connectTelegramChannel, disconnectTelegramChannel } from "../account/notifications.ts";
import { resolveAgentBudgetConfig } from "../agent/budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER, SOL } from "../agent/fixtures.ts";
import { createFixtureAgentModel } from "../agent/model.ts";
import { handleAgentMessage } from "../agent/service.ts";
import { deliverOutbox } from "../monitoring/deliver.ts";
import { grantCredits, readCredits, walletHolder } from "./credits/ledger.ts";
import { resolveCreditsConfig } from "./credits/prices.ts";
import { assistantCallback, assistantCommand, assistantMessage, assistantStart } from "./telegram/bot.ts";
import { CHAT_UPDATES_PER_MINUTE, readChat, readVoiceDay, rememberChat, resolveChat, solanaWalletsOf } from "./telegram/link.ts";
import { noteKeyboard } from "./telegram/notes.ts";
import { answerText, clip, TG_CALLBACK_MAX, TG_TEXT_MAX } from "./telegram/render.ts";
import { createOpenAiTranscriber, judgeVoice, transcribeMicroUsd, VOICE_GLOSSARY, voiceBlocks, voiceCredits } from "./telegram/voice.ts";
import { BOT_COMMANDS, BOT_PROFILE, credits, wordsFor } from "./telegram/words.ts";
import { createWatch } from "./watch/service.ts";

/**
 * AI-07 — the assistant in Telegram: a chat bound to an account asks by text
 * or voice the web's own way (the same session store, model and credits), a
 * chat with no binding gets only the way to connect, the price comes before
 * the balance is touched, a voice message is priced by its length before it
 * is heard and is never a question until «Так», the notifications carry
 * «Чому?», «Мій план», «Пауза», and nothing sells or signs. On fakes — a
 * Telegram that records, the fixture world and model, a transcriber that
 * says what it was given — nothing here reaches the network.
 */

const TG_ID = 5550001;
const OTHER_TG = 5550002;
const ACCOUNT = "4b1c2d3e-0000-4000-8000-00000000abcd";
const NOW = FIXTURE_NOW_MS;

function fakeTelegram() {
  const out = [];
  let id = 100;
  return {
    out,
    port: {
      async send(chatId, text, keyboard) {
        id += 1;
        out.push({ method: "send", chatId, text, keyboard, message_id: id });
        return { message_id: id };
      },
      async edit(chatId, messageId, text, keyboard) {
        out.push({ method: "edit", chatId, messageId, text, keyboard });
        return true;
      },
      async answer(callbackId, text) {
        out.push({ method: "answer", callbackId, text });
        return true;
      },
      async typing(chatId) {
        out.push({ method: "typing", chatId });
        return true;
      },
      async download(fileId, maxBytes) {
        out.push({ method: "download", fileId, maxBytes });
        return { ok: true, bytes: new Uint8Array([79, 103, 103, 83]), mime: "audio/ogg" };
      },
    },
    sends: () => out.filter((row) => row.method === "send"),
    last: () => out.filter((row) => row.method === "send").at(-1),
  };
}

async function world(options = {}) {
  const fixture = await createFixtureWorld();
  const store = fixture.store;
  const tg = fakeTelegram();
  let clock = options.now ?? NOW;
  const heardCalls = [];
  const agentCalls = [];
  const creditsConfig = { ...resolveCreditsConfig({}), ...(options.credits ?? {}) };
  const agent = {
    store,
    readers: fixture.readers,
    model: options.model === undefined ? createFixtureAgentModel() : options.model,
    budget: { ...resolveAgentBudgetConfig({}), modelEnabled: options.model !== null },
    credits: { config: creditsConfig, lookup: null },
    now: () => clock,
  };
  const transcriber =
    options.transcriber === null
      ? null
      : options.transcriber ??
        (async (input) => {
          heardCalls.push(input);
          return { ok: true, text: "яка ціна SOL зараз?", billedSeconds: input.seconds, costMicroUsd: transcribeMicroUsd("gpt-transcribe", input.seconds), model: "gpt-transcribe", latencyMs: 5 };
        });
  const deps = {
    store,
    tg: tg.port,
    walletsOf: options.walletsOf ?? (async () => [OWNER]),
    agentFor: async (owner, telegramId) => {
      agentCalls.push({ owner, telegramId });
      return agent;
    },
    transcriber,
    lookupToken: async (mint) => (mint === SOL ? { symbol: "SOL", suspicious: false, priceUsd: 180, priced: true } : null),
    voiceDailySeconds: options.voiceDailySeconds ?? 21_600,
    origin: "https://ryntra.io",
    now: () => clock,
  };
  const bind = async (telegramId = TG_ID, accountId = ACCOUNT) => {
    const bound = await connectTelegramChannel(store, { accountId, telegramId, username: "person", now: new Date(clock).toISOString() });
    assert.ok(bound);
    await rememberChat(store, { telegramId, accountId, locale: "uk", nowMs: clock });
  };
  const msg = (text, extra = {}) => ({ message_id: 1, chat: { id: extra.chatId ?? TG_ID, type: "private" }, from: { id: extra.from ?? TG_ID, language_code: "uk" }, text, ...extra.more });
  const voice = (duration, extra = {}) => ({ message_id: 2, chat: { id: TG_ID, type: "private" }, from: { id: TG_ID, language_code: "uk" }, voice: { file_id: "file-1", file_unique_id: extra.unique ?? "uniq-1", duration, mime_type: "audio/ogg", file_size: extra.size ?? 12_000 } });
  const press = (data, from = TG_ID) => assistantCallback(deps, { id: `cb-${Math.random()}`, from: { id: from, language_code: "uk" }, data, message: { message_id: 77, chat: { id: from, type: "private" } } });
  const holder = walletHolder(OWNER);
  const balance = () => readCredits(store, holder, creditsConfig, clock);
  return { store, tg, deps, agent, bind, msg, voice, press, holder, balance, heardCalls, agentCalls, creditsConfig, fixture, tick: (ms) => (clock += ms), at: () => clock };
}

const buttonsOf = (row) => (row?.keyboard ?? []).flat();
const callbacks = (row) => buttonsOf(row).map((button) => button.callback_data).filter(Boolean);

/* ------------------------------------------------------------ linking */

test("a chat with no binding gets only the way to connect — nothing is read, nothing is asked", async () => {
  const w = await world();
  await assistantMessage(w.deps, w.msg("яка ціна SOL?"));
  const reply = w.tg.last();
  assert.match(reply.text, /підключи Telegram у Ryntra/);
  assert.deepEqual(buttonsOf(reply).map((button) => button.url), ["https://ryntra.io/app/settings"]);
  assert.equal(w.agentCalls.length, 0, "no agent for a chat nobody bound");
  await assistantMessage(w.deps, w.voice(10));
  assert.match(w.tg.last().text, /підключи Telegram/);
  assert.equal(await assistantCommand(w.deps, w.msg("/credits"), "/credits", ""), true);
  assert.match(w.tg.last().text, /підключи Telegram/);
  assert.equal(await w.press("a:k"), true);
  assert.match(w.tg.last().text, /підключи Telegram/);
  assert.equal(w.agentCalls.length, 0);
  assert.equal(await readChat(w.store, TG_ID), null);
});

test("a binding made before AI-07 is found once in the channels, and the chat is remembered", async () => {
  const w = await world();
  const OLD = 5550099;
  await connectTelegramChannel(w.store, { accountId: ACCOUNT, telegramId: OLD, username: null, now: new Date(NOW).toISOString() });
  const link = await resolveChat(w.store, OLD, { walletsOf: async () => [OWNER], locale: "uk", nowMs: NOW });
  assert.equal(link.state, "linked");
  assert.equal(link.wallet, OWNER);
  assert.equal((await readChat(w.store, OLD)).accountId, ACCOUNT);
});

test("the binding is read again on every message: disconnected or moved to another chat, the old chat reads nothing", async () => {
  const w = await world();
  await w.bind();
  await assistantMessage(w.deps, w.msg("привіт"));
  assert.equal(w.agentCalls.length, 1);
  await connectTelegramChannel(w.store, { accountId: ACCOUNT, telegramId: OTHER_TG, username: null, now: new Date(NOW + 1).toISOString() });
  await assistantMessage(w.deps, w.msg("привіт ще раз"));
  assert.match(w.tg.last().text, /підключи Telegram/, "the account moved to another chat");
  assert.equal(w.agentCalls.length, 1);
  assert.equal(await readChat(w.store, TG_ID), null, "the old chat's memory is gone");
  await disconnectTelegramChannel(w.store, ACCOUNT);
  assert.equal((await resolveChat(w.store, OTHER_TG, { walletsOf: async () => [OWNER], locale: "uk", nowMs: NOW })).state, "unlinked");
});

test("the wallet read for is one the account proves; none — nothing of anyone's own; the accounts store silent — the last wallet for a day", async () => {
  const w = await world({ walletsOf: async () => [] });
  await w.bind();
  await assistantMessage(w.deps, w.msg("що в мене в портфелі?"));
  assert.match(w.tg.last().text, /не прив'язано гаманця Solana/);
  assert.equal(w.agentCalls.length, 0);

  const v = await world();
  await v.bind();
  const first = await resolveChat(v.store, TG_ID, { walletsOf: async () => [OWNER], locale: "uk", nowMs: NOW });
  assert.equal(first.wallet, OWNER);
  const silent = await resolveChat(v.store, TG_ID, { walletsOf: async () => undefined, locale: "uk", nowMs: NOW + 11 * 60_000 });
  assert.equal(silent.state, "linked", "a recent read stands in when the accounts store is silent");
  const late = await resolveChat(v.store, TG_ID, { walletsOf: async () => undefined, locale: "uk", nowMs: NOW + 25 * 60 * 60_000 });
  assert.equal(late.state, "unavailable", "never a wallet nobody read in a day");
  const unlinked = await resolveChat(v.store, TG_ID, { walletsOf: async () => ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"], locale: "uk", nowMs: NOW + 26 * 60 * 60_000 });
  assert.equal(unlinked.wallet, "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "a wallet the account no longer proves is dropped");
});

test("the accounts store's projection gives the Solana wallets only, oldest proof first", () => {
  const raw = { account: { wallets: [{ chain: "evm", address: "0xabc", verified_at: "2026-01-01" }, { chain: "solana", address: OWNER, verified_at: "2026-09-02" }, { chain: "solana", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", verified_at: "2026-09-01" }, { chain: "solana", address: "not-a-wallet" }] } };
  assert.deepEqual(solanaWalletsOf(raw), ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", OWNER]);
  assert.deepEqual(solanaWalletsOf(null), []);
  assert.deepEqual(solanaWalletsOf({ account: { wallets: "x" } }), []);
});

/* ------------------------------------------------------------ the question */

test("a question from Telegram goes the web's own way: the same session store, the same model, the same credits", async () => {
  const w = await world();
  await w.bind();
  await assistantMessage(w.deps, w.msg("привіт"));
  const reply = w.tg.last();
  assert.match(reply.text, /Привіт/);
  assert.match(reply.text, /Питання — 2 кредити · безкоштовних сьогодні: 18 з 20/);
  assert.ok(callbacks(reply).every((data) => /^a:q:\d$/.test(data)), "a talk's questions are its buttons");
  assert.equal((await w.balance()).free.used, 2, "the account's credits, as on the web");
  const chat = await readChat(w.store, TG_ID);
  assert.ok(chat.sessionId, "the conversation is a session of the wallet");
  /* The web sees the same conversation and pays from the same credits. */
  const web = await handleAgentMessage(w.agent, { owner: OWNER, sessionId: chat.sessionId, text: "дякую", locale: "uk", acceptCredits: null });
  assert.ok(web.ok);
  assert.equal((await w.balance()).free.used, 4);
  assert.equal(web.response.ryn.text.length > 0, true);
  /* A pressed suggestion asks it. */
  const before = w.tg.sends().length;
  await w.press("a:q:0");
  assert.equal(w.tg.sends().length, before + 1);
  assert.equal((await w.balance()).free.used, 6);
});

test("past the free credits the price comes first: nothing from the balance until «Спитати · 2 кредити»", async () => {
  const w = await world({ credits: { freeDaily: 0 } });
  await w.bind();
  await grantCredits(w.store, w.holder, { credits: 10, bucket: "bonus", reason: "welcome", idem: "g1", nowMs: NOW });
  await assistantMessage(w.deps, w.msg("яка ціна SOL?"));
  const offer = w.tg.last();
  assert.match(offer.text, /Безкоштовні кредити на сьогодні скінчились/);
  assert.match(offer.text, /2 кредити з балансу \(на балансі 10\)/);
  assert.deepEqual(callbacks(offer), ["a:k", "a:x:question"]);
  assert.equal((await w.balance()).bonus, 10, "nothing taken before the press");
  await w.press("a:k");
  assert.equal((await w.balance()).bonus, 8, "the price shown is the price taken");
  assert.match(w.tg.last().text, /SOL/);
  /* A second press of the same offer acts once. */
  await w.press("a:k");
  assert.match(w.tg.last().text, /вже не діє/);
  assert.equal((await w.balance()).bonus, 8);
  /* An offer past fifteen minutes asks again. */
  await assistantMessage(w.deps, w.msg("а JUP?"));
  w.tick(16 * 60_000);
  await w.press("a:k");
  assert.match(w.tg.last().text, /вже не діє/);
  assert.equal((await w.balance()).bonus, 8);
});

test("with no credits left the answer still comes, composed without the model, and says so", async () => {
  const w = await world({ credits: { freeDaily: 0 } });
  await w.bind();
  await assistantMessage(w.deps, w.msg("яка ціна SOL?"));
  const reply = w.tg.last();
  assert.match(reply.text, /відповідаю без моделі/);
  assert.doesNotMatch(reply.text, /http|купи кредит|buy credits|оплат|Stars/i, "no sale and no payment in Telegram");
});

test("an execution or a secret is refused in Telegram as on the web; no tool signs, sends or trades", async () => {
  const w = await world();
  await w.bind();
  await assistantMessage(w.deps, w.msg("купи 1 SOL зараз"));
  assert.match(w.tg.last().text, /не купує/);
  await assistantMessage(w.deps, w.msg("дай мені приватний ключ гаманця"));
  assert.match(w.tg.last().text, /не розкриває ключі/);
  const sources = readdirSync(new URL("./telegram/", import.meta.url)).filter((name) => name.endsWith(".ts")).map((name) => readFileSync(new URL(`./telegram/${name}`, import.meta.url), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /signTransaction|sendTransaction|sendRawTransaction|Keypair|secretKey|privateKey|approve\(/, "no tool that signs, sends, approves or reads a key");
  }
});

test("a long question is refused before anything is asked; HTML in an answer is escaped; a long answer is cut at a paragraph", async () => {
  const w = await world();
  await w.bind();
  await assistantMessage(w.deps, w.msg("а".repeat(2_001)));
  assert.match(w.tg.last().text, /до 2000 знаків/);
  assert.equal((await w.balance()).free.used, 0);
  const turn = { id: "t", role: "ryn", at: new Date(NOW).toISOString(), text: "<b>SOL</b> & co", class: "market", answer: { observation: [{ text: "x <script>", cites: [] }], meaning: [], counter: [], risks: [], checks: [], actions: [], insufficient: false }, cards: [], citations: [], handoffs: [], tools: [], composedBy: "model", refusal: null, brief: null, critic: null };
  const text = answerText(turn, "uk", null);
  assert.match(text, /^<b>&lt;b&gt;SOL&lt;\/b&gt; &amp; co<\/b>/);
  assert.match(text, /x &lt;script&gt;/);
  const long = clip(Array.from({ length: 200 }, (_, i) => `абзац ${i} ${"слово ".repeat(5)}`).join("\n\n"));
  assert.ok(long.length <= TG_TEXT_MAX + 3 && long.endsWith("…"));
});

/* ------------------------------------------------------------ the voice */

test("voice is priced by each started 30 s, up to two minutes; the length is decided on Telegram's word, before any download", () => {
  assert.deepEqual([1, 30, 31, 60, 61, 90, 91, 120].map(voiceBlocks), [1, 1, 2, 2, 3, 3, 4, 4]);
  const cfg = resolveCreditsConfig({});
  assert.deepEqual([10, 47, 75, 120].map((s) => voiceCredits(cfg, s)), [6, 12, 18, 24]);
  assert.deepEqual(judgeVoice({ seconds: 121, bytes: 1, mime: "audio/ogg" }), { ok: false, why: "too-long" });
  assert.deepEqual(judgeVoice({ seconds: 10, bytes: 21 * 1024 * 1024, mime: "audio/ogg" }), { ok: false, why: "too-big" });
  assert.deepEqual(judgeVoice({ seconds: 10, bytes: 10, mime: "video/mp4" }), { ok: false, why: "not-voice" });
  assert.deepEqual(judgeVoice({ seconds: 0.4, bytes: 10, mime: undefined }), { ok: true, seconds: 1 });
  assert.equal(transcribeMicroUsd("gpt-transcribe", 60), 4_500, "$0.0045 a minute");
  assert.equal(transcribeMicroUsd("gpt-transcribe", 47), 3_525);
  assert.equal(transcribeMicroUsd("unknown-model", 47), null);
});

test("a voice message: length and price first → «Розпізнати» hears it once → the words with «Так / Виправити» → only «Так» asks", async () => {
  const w = await world();
  await w.bind();
  await assistantMessage(w.deps, w.voice(47));
  const offer = w.tg.last();
  assert.match(offer.text, /Голосове 0:47/);
  assert.match(offer.text, /Розпізнати — 12 кредитів/);
  assert.deepEqual(callbacks(offer), ["a:v", "a:x:voice"]);
  assert.equal(w.heardCalls.length, 0, "nothing heard before the press");
  assert.equal(w.tg.out.filter((row) => row.method === "download").length, 0, "nothing downloaded before the press");
  assert.equal((await w.balance()).free.used, 0);

  await w.press("a:v");
  assert.equal(w.heardCalls.length, 1);
  assert.equal(w.heardCalls[0].locale, "uk", "the language is always given");
  assert.equal((await w.balance()).free.used, 12, "12 credits for 47 seconds");
  assert.deepEqual(await readVoiceDay(w.store, NOW), { seconds: 47, microUsd: 3_525 }, "the seconds and dollars of the day are measured");
  const heard = w.tg.last();
  assert.match(heard.text, /Я почула:\n«яка ціна SOL зараз\?»/);
  assert.deepEqual(callbacks(heard), ["a:y", "a:f"]);
  const asked = w.agentCalls.length;

  await w.press("a:v");
  assert.match(w.tg.last().text, /вже не діє/, "one voice is heard once");
  assert.equal(w.heardCalls.length, 1);

  await w.press("a:y");
  assert.equal(w.agentCalls.length > asked, true);
  assert.match(w.tg.last().text, /SOL/);
  assert.equal((await w.balance()).free.used, 14, "then the question's own price");
});

test("«Виправити» gives the words back to send corrected — nothing is asked; a new message replaces the offer", async () => {
  const w = await world();
  await w.bind();
  await assistantMessage(w.deps, w.voice(20));
  await w.press("a:v");
  const used = (await w.balance()).free.used;
  await w.press("a:f");
  assert.match(w.tg.last().text, /Надішли виправлений текст/);
  assert.match(w.tg.last().text, /<code>яка ціна SOL зараз\?<\/code>/);
  assert.equal((await w.balance()).free.used, used, "nothing asked");
  await w.press("a:y");
  assert.match(w.tg.last().text, /вже не діє/);
  await assistantMessage(w.deps, w.voice(20, { unique: "uniq-2" }));
  await assistantMessage(w.deps, w.msg("яка ціна JUP?"));
  await w.press("a:v");
  assert.match(w.tg.last().text, /вже не діє/, "a new message replaced the voice offer");
});

test("a voice not heard costs nothing: the credits and the day's seconds come back", async () => {
  const w = await world({ transcriber: async () => ({ ok: false, reason: "provider down" }) });
  await w.bind();
  await assistantMessage(w.deps, w.voice(65));
  assert.match(w.tg.last().text, /18 кредитів/);
  await w.press("a:v");
  assert.match(w.tg.last().text, /кредити повернуто/);
  assert.equal((await w.balance()).free.used, 0);
  assert.equal((await w.balance()).reserved, 0);
  assert.deepEqual(await readVoiceDay(w.store, NOW), { seconds: 0, microUsd: 0 });
});

test("voice limits: past two minutes, no transcriber, the deployment's day of seconds, the chat's day, credits that do not cover it", async () => {
  const w = await world();
  await w.bind();
  await assistantMessage(w.deps, w.voice(121));
  assert.match(w.tg.last().text, /довше за 2 хвилини/);
  assert.equal((await readChat(w.store, TG_ID)).pending, null);

  const off = await world({ transcriber: null });
  await off.bind();
  await assistantMessage(off.deps, off.voice(10));
  assert.match(off.tg.last().text, /недоступне/);

  const day = await world({ voiceDailySeconds: 30 });
  await day.bind();
  await assistantMessage(day.deps, day.voice(47));
  await day.press("a:v");
  assert.match(day.tg.last().text, /Голосових на сьогодні забагато/);
  assert.equal(day.heardCalls.length, 0);
  assert.equal((await day.balance()).free.used, 0, "refused before the credits were held");

  const poor = await world({ credits: { freeDaily: 0 } });
  await poor.bind();
  await assistantMessage(poor.deps, poor.voice(47));
  assert.match(poor.tg.last().text, /не вистачає/);
  assert.equal(callbacks(poor.tg.last()).length, 0, "no button for what cannot be paid");

  const paid = await world({ credits: { freeDaily: 0 } });
  await paid.bind();
  await grantCredits(paid.store, paid.holder, { credits: 50, bucket: "bonus", reason: "welcome", idem: "g", nowMs: NOW });
  await assistantMessage(paid.deps, paid.voice(47));
  assert.match(paid.tg.last().text, /з балансу \(на балансі 50\)/, "the balance's price is said before the press");
  await paid.press("a:v");
  assert.equal((await paid.balance()).bonus, 38);
});

/* ------------------------------------------------------------ limits */

test("a chat's minute: twelve updates answered, the thirteenth told to slow down, the rest dropped", async () => {
  const w = await world();
  await w.bind();
  for (let i = 0; i < CHAT_UPDATES_PER_MINUTE; i += 1) await assistantMessage(w.deps, w.msg(`привіт ${i}`));
  assert.equal(w.agentCalls.length, CHAT_UPDATES_PER_MINUTE);
  await assistantMessage(w.deps, w.msg("ще"));
  assert.match(w.tg.last().text, /Забагато повідомлень/);
  const sent = w.tg.sends().length;
  await assistantMessage(w.deps, w.msg("і ще"));
  assert.equal(w.tg.sends().length, sent, "silent past the warning");
  w.tick(60_000);
  await assistantMessage(w.deps, w.msg("наступна хвилина"));
  assert.equal(w.agentCalls.length, CHAT_UPDATES_PER_MINUTE + 1);
});

/* ------------------------------------------------------------ the commands */

test("/credits reads the balance and the prices — and sells nothing, links nothing", async () => {
  const w = await world();
  await w.bind();
  await assistantCommand(w.deps, w.msg("/credits"), "/credits", "");
  const reply = w.tg.last();
  assert.match(reply.text, /Безкоштовних сьогодні: 20 з 20/);
  assert.match(reply.text, /питання — 2, «Чому\?» — 2, голос — 6 за кожні 30 с/);
  assert.equal(buttonsOf(reply).length, 0);
  assert.doesNotMatch(reply.text, /http|USDC|\$|купи|оплат|buy/i);
});

test("/plans shows the plans there are, each a link to its page on ryntra.io", async () => {
  const w = await world();
  await w.bind();
  await assistantCommand(w.deps, w.msg("/plans"), "/plans", "");
  const reply = w.tg.last();
  assert.match(reply.text, /Твої плани/);
  assert.match(reply.text, /NVDAx — активний/);
  assert.match(reply.text, /SOL — активний/);
  const urls = buttonsOf(reply).map((button) => button.url);
  assert.ok(urls.includes(`https://ryntra.io/app/strategies/plans/${w.fixture.plans.nvdax}`));
  assert.ok(urls.every((url) => url.startsWith("https://ryntra.io/")));
});

test("/watch: empty, then «/watch SOL» → the presets → a watch that writes to Telegram → pause and resume", async () => {
  const w = await world();
  await w.bind();
  await assistantCommand(w.deps, w.msg("/watch"), "/watch", "");
  assert.match(w.tg.last().text, /ще ні за чим не стежу/);
  await assistantCommand(w.deps, w.msg("/watch SOL"), "/watch", "SOL");
  const pick = w.tg.last();
  assert.match(pick.text, /Коли написати про SOL/);
  assert.ok(callbacks(pick).every((data) => data.startsWith("a:wn:") && data.endsWith(SOL)));
  await w.press(callbacks(pick)[0]);
  assert.match(w.tg.last().text, /Стежу за SOL: Падіння на 10 % за добу/);
  const pause = callbacks(w.tg.last())[0];
  assert.match(pause, /^a:wp:wch_[0-9a-f]{24}$/);
  await assistantCommand(w.deps, w.msg("/watch"), "/watch", "");
  assert.match(w.tg.last().text, /SOL — Падіння на 10 % за добу · стежу/);
  await w.press(pause);
  assert.match(w.tg.last().text, /SOL — на паузі/);
  await assistantCommand(w.deps, w.msg("/watch"), "/watch", "");
  assert.match(w.tg.last().text, /на паузі/);
  await assistantCommand(w.deps, w.msg("/watch NOPE"), "/watch", "NOPE");
  assert.match(w.tg.last().text, /Не знайшла токен/);
});

test("/brief: off by default, turned on and off by its button", async () => {
  const w = await world();
  await w.bind();
  await assistantCommand(w.deps, w.msg("/brief"), "/brief", "");
  assert.match(w.tg.last().text, /Ранковий огляд/);
  const on = callbacks(w.tg.last()).find((data) => data === "a:b1");
  assert.ok(on);
  await w.press("a:b1");
  assert.match(w.tg.last().text, /Огляд увімкнено/);
  await assistantCommand(w.deps, w.msg("/brief"), "/brief", "");
  assert.match(w.tg.last().text, /Щодня о 09:00/);
  await w.press("a:b0");
  assert.match(w.tg.last().text, /Огляд вимкнено/);
});

test("/settings: the language, the wallet, the brief, the broadcasts, disconnecting — each the person's own press", async () => {
  const second = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const w = await world({ walletsOf: async () => [second, OWNER] });
  await w.bind();
  await assistantCommand(w.deps, w.msg("/settings"), "/settings", "");
  const reply = w.tg.last();
  assert.match(reply.text, /Гаманець: F9pV…YPUv/, "the wallet proven last, never in full");
  assert.deepEqual(callbacks(reply), ["a:lang", "a:wl", "a:b1", "a:np", "a:dc"]);
  await w.press("a:lang");
  assert.equal((await readChat(w.store, TG_ID)).locale, "en");
  assert.match(w.tg.out.at(-1).text, /Language: English/);
  await w.press("a:wl");
  assert.deepEqual(callbacks(w.tg.last()), [`a:ws:${second}`, `a:ws:${OWNER}`]);
  await w.press(`a:ws:${second}`);
  assert.equal((await readChat(w.store, TG_ID)).wallet, second);
  await w.press("a:ws:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
  assert.equal((await readChat(w.store, TG_ID)).wallet, second, "a wallet the account does not prove is never chosen");
  assert.equal(await w.press("a:np"), false, "the broadcast settings are the bot's own");
  await w.press("a:dc");
  assert.deepEqual(callbacks(w.tg.last()), ["a:dc1", "a:x:none"]);
  await w.press("a:dc1");
  assert.match(w.tg.last().text, /Telegram is disconnected/);
  await assistantMessage(w.deps, w.msg("hello"));
  assert.match(w.tg.last().text, /підключи Telegram у Ryntra/, "disconnected: only the way to connect, in the person's Telegram language");
});

test("/start: who Ryntra is and how to connect; after the binding, the greeting with the wallet; /help answers anyone", async () => {
  const w = await world();
  await assistantStart(w.deps, w.msg("/start"));
  assert.match(w.tg.last().text, /Я Ryntra — твій ринковий помічник для Solana/);
  assert.match(w.tg.last().text, /Налаштування → «Підключити Telegram»/);
  assert.doesNotMatch(w.tg.last().text, /бет|beta|чекліст/i, "no beta checklist");
  await assistantCommand(w.deps, w.msg("/help"), "/help", "");
  assert.match(w.tg.last().text, /\/watch — стеження за токенами/);
  assert.match(w.tg.last().text, /не купую, не продаю й не підписую/);
  await w.bind();
  await assistantStart(w.deps, w.msg("/start"), { connected: true });
  assert.match(w.tg.last().text, /Telegram підключено до твого акаунта Ryntra/);
  assert.match(w.tg.last().text, /Читаю для гаманця F9pV…YPUv/);
  assert.doesNotMatch(w.tg.last().text, /Ryn\b/, "the assistant is «Ryntra», never «Ryn»");
});

/* ------------------------------------------------------------ the notifications */

test("a watch's note carries «Чому? · 2 кредити», «Мій план», «Пауза» under its link; every callback fits Telegram's 64 bytes", () => {
  const link = { text: "Керувати стеженням", url: "https://ryntra.io/app/ryn?watch=wch_0123456789abcdef01234567" };
  const watch = noteKeyboard({ id: "inb_0123456789abcdef01234567", subject: { kind: "token-watch", id: "wch_0123456789abcdef01234567" }, locale: "uk" }, link, 2);
  assert.deepEqual(watch, [[link], [{ text: "Чому? · 2 кредити", callback_data: "a:wy:wch_0123456789abcdef01234567:2" }], [{ text: "Мій план", callback_data: "a:pl:wch_0123456789abcdef01234567" }, { text: "Пауза", callback_data: "a:wp:wch_0123456789abcdef01234567" }]]);
  const plan = noteKeyboard({ id: "inb_0123456789abcdef01234567", subject: { kind: "trading-plan", id: "plan_x" }, locale: "en" }, { text: "Review plan", url: "https://ryntra.io/app/strategies/plans/x" }, 2);
  assert.deepEqual(plan[1], [{ text: "Why? · 2 credits", callback_data: "a:ny:inb_0123456789abcdef01234567:2" }]);
  const brief = noteKeyboard({ id: "inb_0123456789abcdef01234567", subject: { kind: "assistant-brief", id: "2026-10-20" }, locale: "uk" }, link, 2);
  assert.deepEqual(brief[1], [{ text: "Пауза", callback_data: "a:b0" }]);
  assert.deepEqual(noteKeyboard({ id: "inb_0123456789abcdef01234567", subject: { kind: "limit-order", id: "x" }, locale: "uk" }, link, 2), [[link]]);
  const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  for (const data of [`a:wn:5:${mint}`, `a:wt:${mint}`, `a:ws:${mint}`, ...[...watch, ...plan, ...brief].flat().map((button) => button.callback_data ?? "")]) {
    assert.ok(Buffer.byteLength(data) <= TG_CALLBACK_MAX, data);
  }
});

/** A fake Jupiter Price v3 and DexScreener for one pass of the watches: SOL at `price`, −11 % over the day. */
function fakeMarketFetch(price) {
  return async (url) => {
    if (url.includes("/price/v3")) return Response.json({ [SOL]: { usdPrice: price, priceChange24h: -11, decimals: 9 } });
    if (url.includes("/tokens/v1/solana/")) {
      return Response.json([{ chainId: "solana", dexId: "raydium", pairAddress: "pair", baseToken: { address: SOL, symbol: "SOL" }, quoteToken: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC" }, priceUsd: String(price), liquidity: { usd: 1_000_000 }, volume: { m5: 1_000, h1: 10_000, h6: 60_000, h24: 240_000 }, priceChange: { m5: 0, h1: 0, h6: 0, h24: -11 }, txns: { h1: { buys: 10, sells: 10 }, h24: { buys: 100, sells: 100 } } }]);
    }
    throw new Error(`unexpected ${url}`);
  };
}

/** A watch on SOL that rang in this world, its note in the inbox and its Telegram delivery written. */
async function rangWatch(w) {
  const { runWatchPass } = await import("./watch/run.ts");
  const { readWatchMarkets } = await import("./watch/reads.ts");
  const made = await createWatch(w.store, OWNER, { mint: SOL, preset: "drop24h", cooldownMinutes: 60, channels: { telegram: true, push: false }, locale: "uk" }, w.at(), w.deps.lookupToken);
  assert.ok(made.ok, JSON.stringify(made));
  const clock = () => w.at();
  await runWatchPass({ store: w.store, clock, read: (mints) => readWatchMarkets(mints, { fetchImpl: fakeMarketFetch(160), jupiter: { url: "https://lite-api.jup.ag/price/v3", apiKey: null }, clock }) });
  return made.watch;
}

test("a watch rings: the delivery puts «Чому?», «Мій план», «Пауза» under the note's link — only when the production side passes them", async () => {
  const w = await world();
  await w.bind();
  const watch = await rangWatch(w);
  const plain = [];
  const withButtons = [];
  const telegram = { accountByWallet: async () => ACCOUNT, send: async (chatId, text, keyboard) => (plain.push({ chatId, text, keyboard }), true) };
  /* The pass's own delivery waits for the monitoring cron (90 s): deliver past it, once with the plain side, once — on a copy of the world — with the buttons. */
  const { outboxOf } = await import("../monitoring/store.ts");
  const rows = await outboxOf(w.store).valuesWithPrefix("");
  assert.equal(rows.filter((row) => row.channel === "telegram").length, 1);
  const copy = structuredClone(rows);
  await deliverOutbox(w.store, w.at() + 3 * 60_000, { telegram });
  assert.equal(plain.length, 1);
  assert.equal(plain[0].chatId, TG_ID, "the note goes to the chat the account bound");
  assert.equal(plain[0].keyboard.length, 1, "without the production buttons: the link alone, as before AI-07");
  for (const row of copy) await outboxOf(w.store).set(row.id, row);
  await deliverOutbox(w.store, w.at() + 3 * 60_000, { telegram: { ...telegram, send: async (chatId, text, keyboard) => (withButtons.push({ chatId, text, keyboard }), true), buttons: (inbox, link) => noteKeyboard(inbox, link, 2) } });
  assert.equal(withButtons.length, 1);
  const keyboard = withButtons[0].keyboard;
  assert.equal(keyboard[0][0].url, `https://ryntra.io/app/ryn?watch=${watch.id}`, "the note's own link first");
  assert.deepEqual(keyboard.slice(1).flat().map((button) => button.callback_data), [`a:wy:${watch.id}:2`, `a:pl:${watch.id}`, `a:wp:${watch.id}`]);
});

test("«Чому?» under a watch's note asks the watch's own question at the price the button showed; «Мій план» shows that token's plans; «Пауза» pauses it", async () => {
  const w = await world({ credits: { freeDaily: 0 } });
  await w.bind();
  await grantCredits(w.store, w.holder, { credits: 10, bucket: "bonus", reason: "welcome", idem: "g", nowMs: NOW });
  const watch = await rangWatch(w);
  await w.press(`a:wy:${watch.id}:2`);
  assert.equal((await w.balance()).bonus, 8, "asked at once, at the price the button showed");
  assert.match(w.tg.last().text, /SOL/);
  await w.press(`a:wy:${watch.id}:1`);
  assert.match(w.tg.last().text, /2 кредити з балансу/, "a button whose price is not the price shows the price again");
  assert.equal((await w.balance()).bonus, 8);
  await w.press(`a:pl:${watch.id}`);
  assert.match(w.tg.last().text, /SOL — активний/);
  assert.doesNotMatch(w.tg.last().text, /NVDAx/, "only the plans on that token");
  await w.press(`a:wp:${watch.id}`);
  assert.match(w.tg.last().text, /SOL — на паузі/);
  await w.press("a:wy:wch_000000000000000000000000:2");
  assert.match(w.tg.last().text, /Цього стеження вже немає/);
});

test("«Чому?» under a plan's note asks «why did I get this?» in the note's own context, as «Спитати Ryntra» on the web", async () => {
  const w = await world();
  await w.bind();
  await w.press(`a:ny:${w.fixture.note.id}:2`);
  const chat = await readChat(w.store, TG_ID);
  const { readSession } = await import("../agent/session.ts");
  const session = await readSession(w.store, OWNER, chat.sessionId, NOW);
  assert.deepEqual(session.context, { kind: "note", inboxId: w.fixture.note.id });
  assert.equal(session.turns[0].text, "Чому мені прийшло це сповіщення?");
  await w.press("a:ny:inb_000000000000000000000000:2");
  assert.match(w.tg.last().text, /вже немає у Вхідних/);
});

/* ------------------------------------------------------------ the words */

test("the words: plural credits, two-line paragraphs, «Ryntra» not «Ryn», no payment anywhere; the bot's profile fits Telegram", () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map((n) => credits("uk", n)), ["1 кредит", "2 кредити", "4 кредити", "5 кредитів", "11 кредитів", "12 кредитів", "21 кредит", "22 кредити", "25 кредитів"]);
  assert.equal(credits("en", 1), "1 credit");
  for (const locale of ["uk", "en"]) {
    const words = wordsFor(locale);
    for (const [key, value] of Object.entries(words)) {
      const texts = typeof value === "function" ? [value(12, 34, 56)] : typeof value === "string" ? [value] : Object.values(value);
      for (const text of texts) {
        if (key === "help") continue;
        for (const paragraph of String(text).split("\n\n")) assert.ok(paragraph.split("\n").length <= 2, `${locale}.${key}: ${paragraph}`);
        assert.doesNotMatch(String(text), /\bRyn\b|USDC|Stars|оплат|payment|pay\b|купи кредит|buy credits/i, `${locale}.${key}`);
      }
    }
    assert.ok(BOT_PROFILE[locale].description.length <= 512);
    assert.ok(BOT_PROFILE[locale].short.length <= 120);
    assert.deepEqual(BOT_COMMANDS[locale].map((row) => row.command), ["start", "watch", "plans", "brief", "credits", "settings", "help"]);
  }
});

test("the old /start checklist is gone from the bot; its buttons on old messages still answer; the token never in code", () => {
  const handlers = readFileSync(new URL("../telegram/handlers.ts", import.meta.url), "utf8");
  assert.doesNotMatch(handlers, /welcomeText\(lang\), accessKeyboard/);
  assert.match(handlers, /await assistantStart\(assistantBotDeps\(\), msg\)/);
  assert.match(handlers, /case "confirm": \{/, "a confirm pressed on an old message still answers");
  for (const name of ["bot.ts", "link.ts", "voice.ts", "render.ts", "words.ts", "notes.ts", "runtime.server.ts"]) {
    const source = readFileSync(new URL(`./telegram/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|\d{8,10}:[A-Za-z0-9_-]{30,}/, `${name}: the bot's token is read only by lib/telegram/api.ts, from the environment`);
  }
});


test("the bot sets its own profile and commands through the Bot API — read first, written only where they differ, no BotFather", async () => {
  const { ensureBotProfile } = await import("./telegram/profile.ts");
  const held = { commands: { "": [{ command: "start", description: "Open the beta and confirm access" }], uk: [], ru: [{ command: "start", description: "Открыть бету" }] }, description: {}, short: {}, name: { "": "Ryntra Beta", uk: "Ryntra Beta" } };
  const calls = [];
  const api = async (method, body) => {
    calls.push(method);
    const lang = body.language_code ?? "";
    if (method === "getMyCommands") return held.commands[lang] ?? [];
    if (method === "setMyCommands") return ((held.commands[lang] = body.commands), true);
    if (method === "deleteMyCommands") return ((held.commands[lang] = []), true);
    if (method === "getMyDescription") return { description: held.description[lang] ?? "" };
    if (method === "setMyDescription") return ((held.description[lang] = body.description), true);
    if (method === "getMyShortDescription") return { short_description: held.short[lang] ?? "" };
    if (method === "setMyShortDescription") return ((held.short[lang] = body.short_description), true);
    if (method === "getMyName") return { name: held.name[lang] ?? "" };
    if (method === "setMyName") return ((held.name[lang] = body.name), true);
    return null;
  };
  const first = await ensureBotProfile(api);
  assert.equal(first.state, "applied");
  assert.deepEqual(held.commands[""].map((row) => row.command), ["start", "watch", "plans", "brief", "credits", "settings", "help"]);
  assert.equal(held.commands.uk[1].description, "Стеження за токенами");
  assert.equal(held.description.uk, BOT_PROFILE.uk.description);
  assert.equal(held.name[""], "Ryntra");
  assert.deepEqual(held.commands.ru, [], "the beta's Russian list is gone");
  calls.length = 0;
  const second = await ensureBotProfile(api);
  assert.deepEqual(second, { state: "same", written: [] });
  assert.ok(calls.every((method) => method.startsWith("get")), "a release that changed nothing writes nothing — and never setMyName");
  assert.equal((await ensureBotProfile(async () => null)).state, "failed");
});

test("critic: a note about another wallet of the account is acted on for that wallet — never the chat's chosen one", async () => {
  const second = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  /* The chat reads for `second` (proven last); the watch that rang is OWNER's. */
  const w = await world({ walletsOf: async () => [OWNER, second] });
  await w.bind();
  assert.equal((await resolveChat(w.store, TG_ID, { walletsOf: w.deps.walletsOf, locale: "uk", nowMs: NOW })).wallet, second);
  const watch = await rangWatch(w);
  await w.press(`a:wp:${watch.id}`);
  assert.match(w.tg.last().text, /SOL — на паузі/, "paused on the wallet that holds it");
  const { readWatch } = await import("./watch/store.ts");
  assert.equal((await readWatch(w.store, OWNER, watch.id)).status, "paused");
  await w.press(`a:wy:${watch.id}:2`);
  assert.doesNotMatch(w.tg.last().text, /вже немає/);
  await w.press(`a:pl:${watch.id}`);
  assert.match(w.tg.last().text, /SOL — активний/, "the plans of the watch's own wallet");
  /* The brief's pause names its wallet: OWNER's brief goes off, `second`'s stays as it was. */
  const { readBriefSurface, updateBriefSettings } = await import("./brief/service.ts");
  for (const wallet of [OWNER, second]) await updateBriefSettings(w.store, wallet, { enabled: true, time: "09:00", zone: "Europe/Kyiv", locale: "uk" }, NOW);
  const keyboard = noteKeyboard({ id: "inb_0123456789abcdef01234567", owner: OWNER, subject: { kind: "assistant-brief", id: "2026-10-20" }, locale: "uk" }, { text: "Відкрити огляд", url: "https://ryntra.io/app/ryn" }, 2);
  await w.press(keyboard[1][0].callback_data);
  assert.equal((await readBriefSurface(w.store, OWNER, NOW, "uk")).settings.enabled, false);
  assert.equal((await readBriefSurface(w.store, second, NOW, "uk")).settings.enabled, true);
  /* A watch no wallet of the account holds is gone, whatever the button says. */
  const stranger = await world({ walletsOf: async () => [second] });
  await stranger.bind();
  const theirs = await rangWatch(stranger);
  void theirs;
  const other = await world({ walletsOf: async () => [second] });
  await other.bind();
  await other.press(`a:wp:${theirs.id}`);
  assert.match(other.tg.last().text, /Цього стеження вже немає/);
});

test("critic: /settings from a chat with no binding still reaches the broadcast toggles", async () => {
  const w = await world();
  await assistantCommand(w.deps, w.msg("/settings"), "/settings", "");
  assert.ok(callbacks(w.tg.last()).includes("a:np"));
  await assistantMessage(w.deps, w.msg("питання"));
  assert.ok(!callbacks(w.tg.last()).includes("a:np"), "only /settings carries them");
});

test("critic: a voice whose file is larger than its stated length allows is not heard and costs nothing", async () => {
  assert.equal(judgeVoice({ seconds: 1, bytes: 3 * 1024 * 1024, mime: "audio/ogg" }).why, "too-big", "hours behind «1 s» are refused before the download");
  assert.equal(judgeVoice({ seconds: 47, bytes: 120_000, mime: "audio/ogg" }).ok, true, "an honest note passes");
  const w = await world();
  await w.bind();
  const big = { ...w.deps, tg: { ...w.deps.tg, download: async (fileId, maxBytes) => (w.tg.out.push({ method: "download", maxBytes }), { ok: false, reason: "the file is too big" }) } };
  await assistantMessage(big, w.voice(2, { size: 2_000 }));
  await assistantCallback(big, { id: "cb", from: { id: TG_ID, language_code: "uk" }, data: "a:v", message: { message_id: 1, chat: { id: TG_ID, type: "private" } } });
  assert.equal(w.tg.out.find((row) => row.method === "download").maxBytes, 64 * 1024, "the download is capped by the stated length");
  assert.equal(w.heardCalls.length, 0);
  assert.equal((await w.balance()).free.used, 0, "nothing charged");
  assert.deepEqual(await readVoiceDay(w.store, NOW), { seconds: 0, microUsd: 0 });
});

test("critic: «Скасувати» cancels only what its own message offered", async () => {
  const w = await world();
  await w.bind();
  await assistantMessage(w.deps, w.voice(10));
  await w.press("a:x:question");
  assert.equal((await readChat(w.store, TG_ID)).pending.kind, "voice", "an old question's cancel leaves the newer voice offer");
  await w.press("a:x:voice");
  assert.equal((await readChat(w.store, TG_ID)).pending, null);
});

/** An Ogg page header with the given granule position (48 kHz samples): enough for `oggSeconds`. */
function oggWith(seconds) {
  const page = new Uint8Array(64);
  page.set([0x4f, 0x67, 0x67, 0x53, 0, 4], 0);
  let granule = BigInt(Math.round(seconds * 48_000));
  for (let i = 0; i < 8; i += 1) {
    page[6 + i] = Number(granule & 0xffn);
    granule >>= 8n;
  }
  return page;
}

test("critic 2: the real length is read from the Ogg container — a note that lasts longer than it says is not heard and costs nothing", async () => {
  const { oggSeconds } = await import("./telegram/voice.ts");
  assert.equal(oggSeconds(oggWith(47)), 47);
  assert.equal(oggSeconds(new Uint8Array([1, 2, 3])), null);
  /* A crafted tail of another stream does not stand for the recording's length. */
  const tail = oggWith(10);
  tail[14] = 9;
  const crafted = new Uint8Array(128);
  crafted.set(oggWith(2_400), 0);
  crafted.set(tail, 64);
  assert.equal(oggSeconds(crafted), 2_400);
  const w = await world();
  await w.bind();
  const longer = { ...w.deps, tg: { ...w.deps.tg, download: async () => ({ ok: true, bytes: oggWith(2_400), mime: "audio/ogg" }) } };
  await assistantMessage(longer, w.voice(10));
  await assistantCallback(longer, { id: "cb", from: { id: TG_ID, language_code: "uk" }, data: "a:v", message: { message_id: 1, chat: { id: TG_ID, type: "private" } } });
  assert.match(w.tg.last().text, /довше за 2 хвилини/);
  assert.equal(w.heardCalls.length, 0, "never sent to be heard");
  assert.equal((await w.balance()).free.used, 0);
  assert.deepEqual(await readVoiceDay(w.store, NOW), { seconds: 0, microUsd: 0 });
  const honest = { ...w.deps, tg: { ...w.deps.tg, download: async () => ({ ok: true, bytes: oggWith(10.4), mime: "audio/ogg" }) } };
  await assistantMessage(honest, w.voice(10, { unique: "u-honest" }));
  await assistantCallback(honest, { id: "cb2", from: { id: TG_ID, language_code: "uk" }, data: "a:v", message: { message_id: 1, chat: { id: TG_ID, type: "private" } } });
  assert.equal(w.heardCalls.length, 1, "a note as long as it says is heard");
});

test("critic 2: a bound chat with no Solana wallet still reaches the broadcasts from /settings; an unknown command is no paid question", async () => {
  const w = await world({ walletsOf: async () => [] });
  await w.bind();
  await assistantCommand(w.deps, w.msg("/settings"), "/settings", "");
  assert.match(w.tg.last().text, /не прив'язано гаманця Solana/);
  assert.deepEqual(callbacks(w.tg.last()), ["a:np"]);
  const v = await world();
  await v.bind();
  await assistantMessage(v.deps, v.msg("/foo"));
  assert.match(v.tg.last().text, /\/watch — стеження за токенами/);
  assert.equal((await v.balance()).free.used, 0);
});

test("critic 2: «Чому?» about another wallet's note leaves the chat's own conversation; its price offer is asked for that wallet", async () => {
  const second = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const w = await world({ walletsOf: async () => [OWNER, second], credits: { freeDaily: 0 } });
  await w.bind();
  await grantCredits(w.store, w.holder, { credits: 10, bucket: "bonus", reason: "welcome", idem: "g", nowMs: NOW });
  await assistantMessage(w.deps, w.msg("привіт"));
  await w.press("a:k");
  const own = (await readChat(w.store, TG_ID)).sessionId;
  assert.ok(own);
  const watch = await rangWatch(w);
  await w.press(`a:wy:${watch.id}:1`);
  assert.equal((await readChat(w.store, TG_ID)).pending.wallet, OWNER, "the offer remembers the note's wallet");
  const before = w.agentCalls.length;
  await w.press("a:k");
  assert.equal(w.agentCalls.at(-1).owner, OWNER, "asked for the note's wallet");
  assert.ok(w.agentCalls.length > before);
  assert.equal((await readChat(w.store, TG_ID)).sessionId, own, "the chat's own conversation is untouched");
});

/* ------------------------------------------------------------ AI-21: the same silence in Telegram */

test("AI-21: a Telegram voice heard as the glossary is not heard — nothing charged, the words not offered, nothing asked", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ text: VOICE_GLOSSARY, usage: { type: "duration", seconds: 26 } }), { status: 200 });
  const info = console.info;
  console.info = () => undefined;
  try {
    const w = await world({ transcriber: createOpenAiTranscriber({ OPENAI_API_KEY: "sk-test", RYNTRA_AGENT_MODEL_ENABLED: "1" }, fetchImpl) });
    await w.bind();
    await assistantMessage(w.deps, w.voice(26));
    await w.press("a:v");
    assert.match(w.tg.last().text, /Не вдалося розібрати голосове — кредити повернуто/);
    assert.ok(!w.tg.sends().some((row) => row.text.includes("dogwifhat")), "the glossary is never offered as the person's words");
    assert.equal((await w.balance()).free.used, 0);
    assert.equal((await w.balance()).reserved, 0);
    assert.equal((await readChat(w.store, TG_ID)).pending?.kind === "heard", false, "no words wait for «Так»");
    /* The provider billed the silence: free to the person, counted in the deployment's day (the cap holds). */
    assert.deepEqual(await readVoiceDay(w.store, NOW), { seconds: 26, microUsd: 1_950 });
    assert.equal((await readChat(w.store, TG_ID)).voiceDay.count, 1, "the chat's day of voice counts it too");
  } finally {
    console.info = info;
  }
});
