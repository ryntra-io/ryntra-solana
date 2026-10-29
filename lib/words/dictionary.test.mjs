// Run from repo root: node --test lib/words/dictionary.test.mjs
//
// One concept — one word, in both languages, with the same keys (SOL-C17; the
// UX audit of 21.10, cards UX-973, UX-953, UX-751).
//
// The audit's §4.6 table was a proposal in a document. A proposal in a document
// is how «Add funds» ended up in the menu over a «Top up» button and «Between
// networks» over a card called «Bridge»: nothing held it. These tests hold it —
// the shape of the dictionary, the word each reconciled concept settled on, and
// the sentences that share a banned word's letters and are not the defect.
import assert from "node:assert/strict";
import test from "node:test";

import { BANNED, CONCEPTS, deniesClaim, lineLocale, scanLine, termPattern } from "./dictionary.ts";

const LOCALES = ["en", "uk"];
const ids = (findings) => findings.map((finding) => finding.id);

test("every rule carries both languages under the same keys", () => {
  const seen = new Set();
  for (const concept of CONCEPTS) {
    assert.ok(!seen.has(concept.id), `two concepts called ${concept.id}`);
    seen.add(concept.id);
    assert.deepEqual(Object.keys(concept.word).sort(), LOCALES, `${concept.id}.word`);
    assert.deepEqual(Object.keys(concept.instead).sort(), LOCALES, `${concept.id}.instead`);
    if (concept.keep) assert.deepEqual(Object.keys(concept.keep).sort(), LOCALES, `${concept.id}.keep`);
    for (const locale of LOCALES) {
      assert.ok(concept.word[locale].length > 1, `${concept.id}.word.${locale}`);
      assert.ok(Array.isArray(concept.instead[locale]), `${concept.id}.instead.${locale}`);
      /* A word may not be its own synonym: that is an infinite fix. */
      assert.ok(!concept.instead[locale].includes(concept.word[locale]), `${concept.id}: ${locale} forbids the word it asks for`);
    }
    assert.ok(concept.about.length > 3, `${concept.id}.about`);
  }
  for (const rule of BANNED) {
    assert.ok(!seen.has(rule.id), `two rules called ${rule.id}`);
    seen.add(rule.id);
    assert.deepEqual(Object.keys(rule.pattern).sort(), LOCALES, `${rule.id}.pattern`);
    if (rule.say) assert.deepEqual(Object.keys(rule.say).sort(), LOCALES, `${rule.id}.say`);
    if (rule.keep) assert.deepEqual(Object.keys(rule.keep).sort(), LOCALES, `${rule.id}.keep`);
    if (rule.keepWhole) assert.deepEqual(Object.keys(rule.keepWhole).sort(), LOCALES, `${rule.id}.keepWhole`);
    for (const locale of LOCALES) assert.ok(rule.pattern[locale] instanceof RegExp, `${rule.id}.pattern.${locale}`);
    assert.match(rule.why, /§\d|UX-\d/, `${rule.id}.why names the rule the ban comes from`);
  }
});

test("no concept's word is another concept's banned synonym", () => {
  for (const concept of CONCEPTS) {
    for (const other of CONCEPTS) {
      if (other.id === concept.id) continue;
      for (const locale of LOCALES) {
        assert.ok(
          !other.instead[locale].includes(concept.word[locale]),
          `${locale}: ${other.id} forbids «${concept.word[locale]}», which is ${concept.id}'s own word`,
        );
      }
    }
  }
});

test("a Cyrillic term matches as a word, not as a run of letters", () => {
  /* `\b` is defined on ASCII word characters, so a naive guard reports «очки»
     inside «очкування» and never matches «не» at all. */
  /* A term matches in the case it is written in: the dictionary lists «Очки»
     and «очки» separately, because one is a heading and the other a word in a
     sentence, and a case-blind rule would rename a ticker. */
  assert.ok(termPattern("Очки").test("Очки зараз недоступні"));
  assert.ok(!termPattern("очки").test("очкування"));
  assert.ok(!termPattern("міст").test("містить дані"));
  assert.ok(termPattern("Міст").test("Міст між мережами"));
  assert.ok(!termPattern("Deposit").test("Deposits and withdrawals"));
  assert.ok(deniesClaim("ніколи не гарантована максимальна втрата", "uk"));
  assert.ok(deniesClaim("Not a guarantee of safety", "en"));
  assert.ok(!deniesClaim("Повністю безпечно", "uk"));
});

test("each word this task reconciled: the old name is caught, the new one passes", () => {
  const cases = [
    ["add-funds", "Top up", "Add funds", "en"],
    ["add-funds", "Депозит", "Поповнити", "uk"],
    ["bridge", "Bridge", "Between networks", "en"],
    ["bridge", "Міст між мережами", "Між мережами", "uk"],
    ["alerts", "Monitoring", "Alerts", "en"],
    ["alerts", "Нотатка Нагляду", "Нотатка Сповіщень", "uk"],
    ["history", "Activity", "History", "en"],
    ["history", "Активність", "Історія", "uk"],
    ["portfolio", "Holdings", "Assets", "en"],
    ["assistant", "Ryntra, the AI assistant", "The Ryntra assistant", "en"],
    ["assistant", "Ryntra — ШІ-помічник", "Помічник Ryntra", "uk"],
    ["connect-wallet", "Connect a wallet", "Connect wallet", "en"],
    ["portfolio", "Holdings · Ryntra", "Portfolio · Ryntra", "en"],
    ["account", "Обліковий запис готовий.", "Акаунт готовий.", "uk"],
    ["review", "Точну суму покаже Review.", "Точну суму покаже Перевірка.", "uk"],
    ["points", "Скільки коштують бали?", "Скільки коштують очки?", "uk"],
    ["points", "Ryntra Points", "points", "en"],
    ["simulation", "Paper trading is simulated", "The simulation uses no real money", "en"],
    ["simulation", "тестуй її на paper-даних", "тестуй її в симуляції", "uk"],
    ["mint-open", "Mint open", "Can mint more", "en"],
    ["mint-open", "Випуск відкритий", "Можна випустити ще", "uk"],
    ["launch", "Створення лаунчу", "Створення токена", "uk"],
  ];
  for (const [id, before, after, locale] of cases) {
    assert.ok(ids(scanLine(before, locale)).includes(id), `${locale}: «${before}» must be caught by ${id}`);
    assert.deepEqual(scanLine(after, locale), [], `${locale}: «${after}» is the word the dictionary asks for`);
  }
});

test("each word forbidden anywhere: the promise is caught, the fact and the denial are not", () => {
  const banned = [
    ["earn", "Заробляй у пулі", "Додати ліквідність", "uk"],
    ["earn", "Earn from the pool", "Add liquidity", "en"],
    ["earn", "Торгуй, заробляй, зростай з Ryntra.", "Частина власної комісії Ryntra повертається тобі.", "uk"],
    ["earn", "Trade, earn, and grow with Ryntra.", "A share of Ryntra's own fee comes back to you.", "en"],
    ["profit-if", "Profit if right", "Gain if right", "en"],
    ["profit-if", "Прибуток, якщо праві", "Виграш, якщо маєш рацію", "uk"],
    ["safe", "Ризик: Безпечно", "Стан рахунку: Здоровий", "uk"],
    ["safe", "Risk: Safe", "Account state: Healthy", "en"],
    ["signal", "Згенеровані сигнали", "Тези моделі (не порада)", "uk"],
    ["passive-income", "Пасивний дохід щомісяця", "Частка комісії пулу", "uk"],
    ["risk-free", "Risk-free trading", "Capital at risk", "en"],
    ["real-shares", "справжні акції NVIDIA", "Токенізовані акції — не акції", "uk"],
  ];
  for (const [id, promise, instead, locale] of banned) {
    assert.ok(ids(scanLine(promise, locale)).includes(id), `${locale}: «${promise}» must be caught by ${id}`);
    assert.deepEqual(scanLine(instead, locale), [], `${locale}: «${instead}» is what the rules ask for`);
  }

  /* The facts a pool, a receipt and an order type state keep their words: the
     ban is on promising income, not on saying how a fee is earned. Every line
     here was reported by the first run of this guard and is not a defect. */
  for (const [line, locale] of [
    ["Fees earned", "en"],
    ["Earns no fees until the price returns.", "en"],
    ["Не заробляє комісій, доки ціна не повернеться.", "uk"],
    ["No deposit fee, no withdrawal fee, no share of what you earn.", "en"],
    ["Earn", "en"],
    ["what their two locked positions earn while they are its only liquidity", "en"],
    ["Заробіток на ботах", "uk"],
    ["Take profit", "en"],
    ["Тейк-профіт і стоп-лос", "uk"],
    ["Чистий прибуток", "uk"],
    ["A model, never a guaranteed maximum loss.", "en"],
    ["Модель, а не гарантована максимальна втрата.", "uk"],
    ["Ryntra has no token promise, no airdrop and no allocation.", "en"],
    ["Allowed by policy does not mean safe, legal or profitable.", "en"],
    ["Безпека ключів", "uk"],
    ["Tokenized stocks are not shares. Capital at risk", "en"],
  ]) {
    assert.deepEqual(scanLine(line, locale), [], `${locale}: «${line}» is a fact or a denial, not a promise`);
  }
});

test("«Заробіток» is a noun, and §12 forbids the verb (the Growth line's question of 26.10)", () => {
  /* The menu's group is «Заробіток». So the group's name needs no rename, and the dictionary says so in
     the only place that can be checked. */
  for (const line of ["Заробіток", "Заробіток · Пули · Винагороди", "твій заробіток", "з твого заробітку"]) {
    assert.deepEqual(scanLine(line, "uk"), [], `«${line}» is the noun, which §12 does not forbid`);
  }
  for (const line of ["Заробляй", "Заробляй у пулі", "заробляй із кваліфікованої активності"]) {
    assert.ok(ids(scanLine(line, "uk")).includes("earn"), `«${line}» is the verb §12 forbids`);
  }
});

test("a staged row is reported and does not fail a run", () => {
  const staged = CONCEPTS.filter((concept) => concept.staged);
  assert.deepEqual(staged.map((concept) => concept.id), ["loaded"], "only the read metaphor waits on its own row");
  const findings = scanLine("Угоди прочитано не всі", "uk");
  assert.deepEqual(ids(findings), ["loaded"]);
  assert.equal(findings[0].staged, "UX-975");
  /* Everything else fails a run the moment it is drawn. */
  assert.equal(scanLine("Top up", "en")[0].staged, null);
});

test("a line is read in its own language, not the page's", () => {
  assert.equal(lineLocale("Заробляй у пулі"), "uk");
  assert.equal(lineLocale("Earn from the pool"), "en");
  assert.equal(lineLocale("Powered by Jupiter"), "en");
  assert.equal(lineLocale("Комісія Jupiter"), "uk", "a provider's name inside a Ukrainian sentence is still Ukrainian");
  /* What the guard does with a page that carries both: «no» in an English rule
     must never fire on a Ukrainian line, and an English sentence left on a
     Ukrainian page is still held to English rules. */
  const drawn = ["Додати ліквідність", "Top up", "Прибуток, якщо праві"];
  const findings = drawn.flatMap((line) => scanLine(line, lineLocale(line)));
  assert.deepEqual(ids(findings).sort(), ["add-funds", "profit-if"]);
});

test("a label-only concept reads the control, never the paragraph", () => {
  /* The first run of the live guard reported three sentences the audit itself
     writes that way (pair 10 of UX-953's microcopy) — and one real defect, the
     browser tab «Holdings · Ryntra» over an H1 that says «Portfolio». A rule
     that cannot tell a button from a paragraph reports the product's own voice
     as a bug, so «Connect a wallet» counts only when it is the whole of what
     is drawn. */
  assert.deepEqual(ids(scanLine("Connect a wallet", "en")), ["connect-wallet"]);
  assert.deepEqual(scanLine("Connect a wallet — your assets and positions will be here.", "en"), []);
  assert.deepEqual(scanLine("Connect a wallet to see your pool positions.", "en"), []);
  assert.deepEqual(ids(scanLine("Під'єднати гаманець", "uk")), ["connect-wallet"]);
  assert.deepEqual(scanLine("Підключи гаманець, щоб побачити свої позиції в пулах.", "uk"), []);
  /* The tab title is not a sentence, and it is a different concept's word. */
  assert.deepEqual(ids(scanLine("Holdings · Ryntra", "en")), ["portfolio"]);
});

test("a tab's title is «〈Page〉 · Ryntra», and the live guard reads it", () => {
  /* Three titles the copy scan could not see, because a tab's title is composed
     at run time out of the page's own name and the product's: «Holdings ·
     Ryntra» over an H1 that says «Portfolio», «AI assistant · Ryntra» for the
     one assistant, and «Earn · Ryntra» — which is the lending section's own
     name (decision 47) and no instruction at all. */
  assert.deepEqual(ids(scanLine("Holdings · Ryntra", "en")), ["portfolio"]);
  assert.deepEqual(ids(scanLine("AI assistant · Ryntra", "en")), ["assistant"]);
  assert.deepEqual(scanLine("Portfolio · Ryntra", "en"), []);
  assert.deepEqual(scanLine("Ryntra assistant · Ryntra", "en"), []);
  assert.deepEqual(scanLine("Earn · Ryntra", "en"), []);
  assert.ok(ids(scanLine("Earn from the pool", "en")).includes("earn"), "the invitation is still the invitation");
});
