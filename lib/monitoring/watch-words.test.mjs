import assert from "node:assert/strict";
import test from "node:test";

import { ISSUER_PAUSED_DETAILS, WARN_HONEST_LIMIT, WATCH_ACTION_SHORT, WATCH_ACTION_WORDS, WATCH_STATE_SHORT, WATCH_STATE_WORDS, WATCH_WORDS, watchActionWord, watchLine, watchStateWord, watchTone } from "./watch-words.ts";
import { WATCH_ACTIONS, WATCH_REASONS, WATCH_STATES } from "./watch-state.ts";

/*
 * RYN-PROTECT-SIGNAL-001, subtask 1 — the words of Нагляд over a position,
 * both languages: the canon's names of the states, one action each, the
 * figures a state stands on, and never «ордер» in a signal (§5.2, B.6), never
 * «Захищено» (§6.1), never the persona.
 */

const money = (usd) => `$${usd.toFixed(2)}`;
const pct = (value) => `${Math.abs(value).toFixed(1)} %`;
const format = { money, pct };

test("every state and every action is named in both languages, the canon's words in Ukrainian", () => {
  for (const state of WATCH_STATES) {
    assert.ok(WATCH_STATE_WORDS[state].en && WATCH_STATE_WORDS[state].uk, state);
  }
  for (const action of WATCH_ACTIONS) {
    assert.ok(WATCH_ACTION_WORDS[action].en && WATCH_ACTION_WORDS[action].uk, action);
  }
  assert.equal(WATCH_STATE_WORDS["on-plan"].uk, "Все за планом");
  assert.equal(WATCH_STATE_WORDS.attention.uk, "Увага");
  assert.equal(WATCH_STATE_WORDS.action.uk, "Дія");
  assert.equal(WATCH_STATE_WORDS["issuer-paused"].uk, "Пауза емітента");
  assert.equal(WATCH_STATE_WORDS["exit-not-set"].uk, "Увага: куплено — вихід не налаштований");
  assert.equal(WATCH_ACTION_WORDS.look.uk, "Подивитись");
  assert.equal(WATCH_ACTION_WORDS["open-sale"].uk, "Відкрити продаж");
  assert.equal(WATCH_ACTION_WORDS.details.uk, "Деталі");
  assert.equal(WATCH_ACTION_WORDS.warn.uk, "Увімкнути «Ryntra попередить»");
  assert.equal(WATCH_ACTION_WORDS["connect-telegram"].uk, "Підключи Telegram");
  assert.equal(ISSUER_PAUSED_DETAILS.uk, "Продати зараз неможливо — чекаємо, поки емітент зніме паузу.");
});

test("a Portfolio row's short words: the amber names only what is missing, its action a verb; every other state keeps its name", () => {
  assert.equal(WATCH_STATE_SHORT["exit-not-set"].uk, "Вихід не налаштований");
  assert.equal(WATCH_STATE_SHORT["exit-not-set"].en, "No exit set");
  assert.equal(WATCH_ACTION_SHORT.warn.uk, "Налаштувати");
  assert.equal(WATCH_ACTION_SHORT.warn.en, "Set it up");
  for (const state of WATCH_STATES) if (state !== "exit-not-set") assert.deepEqual(WATCH_STATE_SHORT[state], WATCH_STATE_WORDS[state], state);
  for (const action of WATCH_ACTIONS) if (action !== "warn") assert.deepEqual(WATCH_ACTION_SHORT[action], WATCH_ACTION_WORDS[action], action);
  assert.equal(watchStateWord("exit-not-set", "uk", true), "Вихід не налаштований");
  assert.equal(watchStateWord("exit-not-set", "uk"), "Увага: куплено — вихід не налаштований");
  assert.equal(watchActionWord("warn", "uk", true), "Налаштувати");
});

test("no signal says «ордер», «Захищено» or the persona", () => {
  const all = [
    ...Object.values(WATCH_STATE_WORDS),
    ...Object.values(WATCH_ACTION_WORDS),
    ...Object.values(WATCH_STATE_SHORT),
    ...Object.values(WATCH_ACTION_SHORT),
    ...Object.values(WATCH_WORDS),
    ISSUER_PAUSED_DETAILS,
    WARN_HONEST_LIMIT,
  ].flatMap((pair) => [pair.en, pair.uk]);
  const exit = { limit: 164.2, target: 218.9 };
  for (const reason of WATCH_REASONS) {
    for (const lang of ["en", "uk"]) {
      const line = watchLine({ reason, price: 170, exit, toLimitPct: 1.4, deviationPct: 2.8, eventLine: "Обміняй SPACEX до 12 березня 2027" }, lang, format);
      if (line) all.push(line);
    }
  }
  for (const text of all) {
    assert.doesNotMatch(text, /ордер|order|Захищено|protected/i, text);
    assert.doesNotMatch(text, /(^|[^A-Za-z])Ryn(?![a-z])/, text);
  }
});

test("each line carries the figures its state stands on", () => {
  const exit = { limit: 164.2, target: 218.9 };
  const line = (reason, lang, over = {}) => watchLine({ reason, price: 170, exit, toLimitPct: 1.4, deviationPct: 2.8, ...over }, lang, format);
  assert.equal(line("between", "uk"), "Межа $164.20 · ціль $218.90");
  assert.equal(line("between", "en"), "Limit $164.20 · target $218.90");
  assert.equal(line("between", "uk", { exit: { limit: 164.2, target: null } }), "Межа $164.20");
  assert.equal(line("near-limit", "uk"), "До межі 1.4 % · межа $164.20");
  assert.equal(line("above-exchange", "uk"), "На 2.8 % дорожче за біржу");
  assert.equal(line("exchange-closed", "uk"), "Біржа зачинена — ціна може стрибнути на відкритті");
  assert.equal(line("limit", "uk", { price: 162.1 }), "Ціна $162.10 дійшла до межі збитку $164.20");
  assert.equal(line("target", "en", { price: 219.4 }), "The price $219.40 reached your target $218.90");
  assert.equal(line("issuer-event", "uk", { eventLine: "Обміняй SPACEX до 12 березня 2027" }), "Обміняй SPACEX до 12 березня 2027");
  assert.equal(line("no-exit", "uk"), null, "the amber line is the state's own name — one line, not two");
});

test("the tones: amber for what needs a look, the action's for «Дія», calm for «Все за планом», quiet for the rest", () => {
  assert.equal(watchTone("exit-not-set"), "caution");
  assert.equal(watchTone("attention"), "caution");
  assert.equal(watchTone("action"), "act");
  assert.equal(watchTone("on-plan"), "calm");
  assert.equal(watchTone("issuer-paused"), "quiet");
  assert.equal(watchTone("unknown"), "quiet");
});
