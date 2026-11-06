// CITY-201: the city speaks to the person as «ти» in Ukrainian — the agent («Твій агент»), the hint («Торкнись»), Money,
// the quarter. Earn, the Guard, Partners and Connect said «ви» («Ваш заробіток», «Підключіть гаманець») beside it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const FILES = [
  "../earn/words.ts",
  "../earn/limit-words.ts",
  "../autopilot/words.ts",
  "../instruct/words.ts",
  "../bots/words.ts",
  "../../components/guard/words.ts",
  "../../components/partners/words.ts",
  "../../components/connect/words.ts",
  "../../components/money/words.ts",
];

/** «ваш», «вам», «вас» and the plural imperative («Підключіть», «Спробуйте») and future («заберете»). */
const FORMAL = /(?<!\p{L})(?:[Вв]аш\p{L}*|[Вв]ам|[Вв]ас|\p{L}+(?:іть|йте|єтесь|ете))(?!\p{L})/u;

test("the Ukrainian of the agent, Earn, Money, the Guard and Partners says «ти», never «ви»", () => {
  for (const file of FILES) {
    const lines = readFileSync(new URL(file, import.meta.url), "utf8").split("\n");
    const formal = lines.map((line, at) => [at + 1, line]).filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line) && FORMAL.test(line));
    assert.deepEqual(formal.map(([at, line]) => `${file}:${at} ${line.trim().slice(0, 120)}`), [], `${file} speaks «ви»`);
  }
});
