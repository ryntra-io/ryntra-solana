// Run from repo root: node --test lib/predictions/watch/rules.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { WATCH_RULE_KINDS, WATCH_RULE_SHAPES, normalizeRule, ruleComplete, ruleFromWords, ruleIdentity, thresholdShape } from "./rules.ts";
import { ruleSentence } from "./words.ts";

/*
 * The rule shape, and the sentence a person dictates read into it. The
 * reading is a parse, not a model: the same words always give the same rule,
 * and a rule the parser is unsure of comes back marked so the person sees the
 * figures before anything is watched.
 */

const SUBJECT = { eventId: "ev1", eventTitle: "December rate decision", venueMarketId: "m1", question: "Will the rate hold in December?", outcomeId: "o-yes", outcomeLabel: "Yes" };
const input = (over) => ({ kind: "price", subject: SUBJECT, direction: "above", threshold: null, windowMinutes: null, note: null, ...over });

test("a figure outside its bounds is brought to the nearest, not refused", () => {
  assert.equal(normalizeRule(input({ threshold: 1.5 })).threshold, 0.99);
  assert.equal(normalizeRule(input({ threshold: 0 })).threshold, 0.01);
  /* Nothing given: the kind's own default, which the person then sees. */
  assert.equal(normalizeRule(input({ threshold: null })).threshold, WATCH_RULE_SHAPES.price.threshold.default);
});

test("a kind keeps only what it has a use for", () => {
  const news = normalizeRule(input({ kind: "news", threshold: 0.6, windowMinutes: 60 }));
  assert.deepEqual([news.threshold, news.windowMinutes, news.direction], [null, null, "any"]);
  /* A watch about the whole market holds no side: a rules change is not about one of them. */
  assert.equal(news.subject.outcomeId, null);
  const move = normalizeRule(input({ kind: "probability_move", windowMinutes: 99_999 }));
  assert.equal(move.windowMinutes, WATCH_RULE_SHAPES.probability_move.window.max);
});

test("a direction a kind does not offer becomes the one it does", () => {
  assert.equal(normalizeRule(input({ kind: "venue_spread", direction: "below" })).direction, "above");
  assert.equal(normalizeRule(input({ kind: "price", direction: "any" })).direction, "above");
});

test("a watch about one outcome is incomplete until a side is named", () => {
  assert.equal(ruleComplete(normalizeRule(input({ kind: "price" }))), true);
  assert.equal(ruleComplete(normalizeRule(input({ kind: "price", subject: { ...SUBJECT, outcomeId: null, outcomeLabel: null } }))), false);
  /* A watch about the market needs none. */
  assert.equal(ruleComplete(normalizeRule(input({ kind: "news", subject: { ...SUBJECT, outcomeId: null, outcomeLabel: null } }))), true);
});

test("the same watch set twice is one rule", () => {
  const a = normalizeRule(input({ threshold: 0.6, note: "first" }));
  const b = normalizeRule(input({ threshold: 0.6, note: "second" }));
  assert.equal(ruleIdentity(a), ruleIdentity(b), "the person's own note does not make it another rule");
  assert.notEqual(ruleIdentity(a), ruleIdentity(normalizeRule(input({ threshold: 0.7 }))));
  assert.notEqual(ruleIdentity(a), ruleIdentity(normalizeRule(input({ direction: "below", threshold: 0.6 }))));
});

/* ------------------------------------------------------------------ words into a rule */

const read = (text) => ruleFromWords(text, SUBJECT);

test("a sentence that names the kind and the figure reads as that rule, in either language", () => {
  const en = read("tell me if Yes goes above 60%");
  assert.equal(en.rule.kind, "price");
  assert.equal(en.rule.direction, "above");
  assert.equal(en.rule.threshold, 0.6);
  assert.equal(en.confidence, "named");

  const uk = read("скажи, якщо ціна нижче 35%");
  assert.equal(uk.rule.kind, "price");
  assert.equal(uk.rule.direction, "below");
  assert.equal(uk.rule.threshold, 0.35);
});

test("each kind is reachable in words", () => {
  const said = {
    price: "if the price goes above 70%",
    probability_move: "if the probability moves by 12 points in a day",
    volume_spike: "if volume triples today",
    liquidity: "if the order book goes thin",
    news: "when news comes out",
    resolution: "if the rules change",
    position_value: "if my position goes below $40",
    venue_spread: "if the venues differ by 4 points",
    related_move: "if a related market moves 15 points in a week",
  };
  for (const kind of WATCH_RULE_KINDS) {
    const draft = read(said[kind]);
    assert.ok(draft, `${kind} was heard`);
    assert.equal(draft.rule.kind, kind, `${said[kind]} → ${kind}`);
  }
});

test("a period said in words becomes minutes", () => {
  assert.equal(read("if the probability moves 10 points in 6 hours").rule.windowMinutes, 360);
  assert.equal(read("якщо ймовірність рухнула на 10 п. п. за добу").rule.windowMinutes, 1_440);
  assert.equal(read("if a related market moves 20 points this week").rule.windowMinutes, 10_080);
});

test("a figure written without its percent sign is still a probability", () => {
  assert.equal(read("tell me if it goes above 60").rule.threshold, 0.6);
  assert.equal(read("tell me if the price goes above 0.6").rule.threshold, 0.6);
});

test("words that name a kind but no figure come back marked, with the kind's own default", () => {
  const draft = read("tell me if the price moves");
  assert.equal(draft.confidence, "assumed");
  assert.equal(draft.rule.threshold, WATCH_RULE_SHAPES[draft.rule.kind].threshold.default);
});

test("words that name nothing to watch read as nothing, rather than as a guess", () => {
  assert.equal(read("what do you think about this market?"), null);
  assert.equal(read("   "), null);
});

test("the rule reads back as a sentence in both languages", () => {
  const rule = normalizeRule(input({ threshold: 0.6 }));
  assert.match(ruleSentence(rule.kind, rule.direction, rule.threshold, rule.windowMinutes, "en"), /price goes above 60%/);
  assert.match(ruleSentence(rule.kind, rule.direction, rule.threshold, rule.windowMinutes, "uk"), /ціна вище 60%/);
  /* Every kind says something in both languages, so no rule reads as a code. */
  for (const kind of WATCH_RULE_KINDS) {
    const shape = WATCH_RULE_SHAPES[kind];
    for (const locale of ["en", "uk"]) {
      const said = ruleSentence(kind, shape.directions[0], shape.threshold?.default ?? null, shape.window?.default ?? null, locale);
      assert.ok(said.length > kind.length, `${kind} ${locale}`);
      assert.ok(!said.includes("_"), `${kind} ${locale} reads as words, not as a code`);
    }
  }
});

test("the book's figure means points for a wide spread and dollars for a thin one, and «either way» takes none", () => {
  const spread = normalizeRule(input({ kind: "liquidity", direction: "above", threshold: 0.08 }));
  assert.equal(spread.threshold, 0.08, "a spread in probability points is not clamped to a dollar floor");
  assert.equal(thresholdShape("liquidity", "above").unit, "points");

  const depth = normalizeRule(input({ kind: "liquidity", direction: "below", threshold: 400 }));
  assert.equal(depth.threshold, 400);
  assert.equal(thresholdShape("liquidity", "below").unit, "usd");

  /* Asked for either, the product's own two bounds decide and the person sets no figure. */
  const either = normalizeRule(input({ kind: "liquidity", direction: "any", threshold: 400 }));
  assert.equal(either.threshold, null);
  assert.equal(thresholdShape("liquidity", "any"), null);
  /* And it is still a rule the engine will judge. */
  assert.equal(ruleComplete(either), true);
});

test("a dictated spread is read on the spread's own scale", () => {
  const draft = read("if the spread goes above 7 points");
  assert.equal(draft.rule.kind, "liquidity");
  assert.equal(draft.rule.direction, "above");
  assert.equal(draft.rule.threshold, 0.07);
});
