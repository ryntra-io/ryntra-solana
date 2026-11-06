// «Learn» (CITY-202) from the command line: a question about how Ryntra works opens the guide on its chapter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { learnAsk } from "./ask.ts";

test("a question about how a part works names its chapter", () => {
  assert.equal(learnAsk("how does the agent work?"), "agent");
  assert.equal(learnAsk("як працює агент"), "agent");
  assert.equal(learnAsk("Як працює запуск монети?"), "launch");
  assert.equal(learnAsk("how do strategies work"), "strategies");
  assert.equal(learnAsk("як працює заробіток"), "earn");
  assert.equal(learnAsk("how does the guard work"), "security");
  assert.equal(learnAsk("навчання"), null);
  assert.equal(learnAsk("learn"), null);
});

test("everything else is not the guide's", () => {
  assert.equal(learnAsk("buy SOL for 50"), undefined);
  assert.equal(learnAsk("what's rising and why?"), undefined);
  assert.equal(learnAsk("як справи у SOL?"), undefined);
});
