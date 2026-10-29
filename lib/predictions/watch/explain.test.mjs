// Run from repo root: node --test lib/predictions/watch/explain.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { EXPLANATION_LIMIT, keepExplanation, readFigures } from "./explain.ts";

/*
 * The one place a language model touches a watch, and the gate it goes
 * through. The engine's own sentence always stands; what a model adds is kept
 * only if every figure in it was read, it tells nobody what to do, it promises
 * nothing and it adds something.
 */

const ASK = {
  locale: "en",
  kind: "price",
  eventTitle: "December rate decision",
  question: "Will the rate hold in December?",
  outcomeLabel: "Yes",
  facts: { was: 0.52, now: 0.65, level: 0.6, way: "above", question: "Will the rate hold in December?" },
  said: "Yes on Will the rate hold in December? is 65% — above your level of 60% (it was 52%).",
};

const refusal = (sentence, ask = ASK) => {
  const kept = keepExplanation(sentence, ask);
  return kept.ok ? "kept" : kept.refusal;
};

test("a sentence over the figures that were read is kept, with its full stop", () => {
  const kept = keepExplanation("The move puts the market above the 60% level its own rules do not touch", ASK);
  assert.equal(kept.ok, true);
  assert.equal(kept.text.endsWith("."), true);
});

test("a figure nobody read is a figure invented, and the sentence goes", () => {
  assert.equal(refusal("This is the fourth such move in 9 days"), "figure_not_read");
  /* The same figure rounded differently is still that figure. */
  assert.equal(refusal("The market now sits at 65.0%, past the 60% level"), "kept");
});

test("advice and instructions never reach a person, however they are phrased", () => {
  assert.equal(refusal("You should buy before the next print"), "advice");
  assert.equal(refusal("Consider buying while the level holds"), "advice");
  assert.equal(refusal("Now is a good time to enter"), "advice");
  assert.equal(refusal("Buy the dip here"), "command");
  assert.equal(refusal("Варто купити, поки тримається межа", { ...ASK, locale: "uk" }), "advice");
});

test("a promise about the outcome is not Ryntra's to make", () => {
  assert.equal(refusal("The market will resolve Yes at this rate"), "promise");
  assert.equal(refusal("This is certain to settle above the level"), "promise");
});

test("a link, another name for the assistant, more than one sentence or nothing at all is dropped", () => {
  assert.equal(refusal("See polymarket.com for the full rules"), "link");
  assert.equal(refusal("Ryn thinks the level matters here"), "persona");
  assert.equal(refusal("The level was crossed. The rules did not change."), "many_sentences");
  assert.equal(refusal("   "), "empty");
  assert.equal(refusal(`${"a word ".repeat(60)}`), "too_long");
  assert.ok(EXPLANATION_LIMIT > 100);
});

test("a sentence that only says the engine's sentence again adds nothing", () => {
  assert.equal(refusal("Yes on Will the rate hold in December? is 65% — above your level of 60%"), "repeats");
});

test("the figures read include the ones inside a headline, so a sentence may quote them", () => {
  const figures = readFigures({ headline: "Inflation came in at 3.4% in September", change: 0.12 });
  assert.ok(figures.includes(3.4));
  assert.ok(figures.includes(12), "a probability given as a share is also readable as points");
});
