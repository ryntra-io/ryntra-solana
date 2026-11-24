/* «Сітка» and «Сигнали» on the budget, as the screens choose them: every choice is a plan the engine reads, a
   bot's row stands on its own page, and the window's switch reads the server's words. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { planFrom, planText } from '../../lib/mandate/plans.ts';
import { botMoneyShown, GRID_LEVEL_PICKS, GRID_STEPS, gridPlanOf, rowBot, SIGNAL_NUMBERS, SIGNAL_PICKS, signalPlanOf, triggerNumber, triggerOf } from './budget-bots.ts';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('every grid and every signal the card offers is a plan the engine reads back exactly', () => {
  for (const step of GRID_STEPS) {
    for (const levels of GRID_LEVEL_PICKS) {
      const text = planText(gridPlanOf(step, levels));
      assert.equal(planText(planFrom(text)), text);
      assert.match(text, /,sell:1$/u, 'the grid of the budget sells its levels');
    }
  }
  for (const kind of SIGNAL_PICKS) {
    const numbers = kind === 'cross' ? [null] : SIGNAL_NUMBERS[kind];
    for (const value of numbers) {
      const text = planText(signalPlanOf(triggerOf(kind, value)));
      assert.ok(planFrom(text), text);
      assert.equal(planText(planFrom(text)), text);
    }
  }
  /* A number the card does not offer falls back to the condition's own. */
  assert.deepEqual(triggerOf('above', 7), { kind: 'above', bps: 500 });
  assert.deepEqual(triggerOf('volume', null), { kind: 'volume', pct: 200 });
  assert.equal(triggerNumber(triggerOf('cross', 300)), null);
});

test("a bot's row stands on its own page; regular buys and every plan of before stay with «Recurring buys»", () => {
  const row = (policy) => ({ role: 'trader', stop: { record: { policy } } });
  const views = { g: { plan: 'grid:500:5,sell:1' }, s: { plan: 'signal:cross:6:24' }, r: { plan: 'steady' }, o: { plan: 'grid:500:5' } };
  assert.equal(rowBot(row('g'), views), 'grid');
  assert.equal(rowBot(row('s'), views), 'signals');
  assert.equal(rowBot(row('r'), views), null);
  assert.equal(rowBot(row('o'), views), null, 'a grid that only buys is the budget\'s own plan');
  assert.equal(rowBot(row('x'), views), null, 'a view not read yet');
  assert.equal(rowBot({ role: 'pilot', stop: { record: { policy: 'g' } } }, views), null);
  assert.equal(rowBot({ role: 'keeper', stop: { care: 'p' } }, views), null);
});

test("the window's switch: closed by default, «on» opens, a bot's own word over the shared one", () => {
  assert.equal(botMoneyShown('grid', {}), false);
  assert.equal(botMoneyShown('grid', { RYNTRA_BOTS_MONEY: 'on' }), true);
  assert.equal(botMoneyShown('signals', { RYNTRA_BOTS_MONEY: 'on', RYNTRA_BOTS_SIGNALS_MONEY: 'off' }), false);
  const source = read('./budget-bots.ts');
  for (const name of ['NEXT_PUBLIC_RYNTRA_BOTS_MONEY', 'NEXT_PUBLIC_RYNTRA_BOTS_GRID_MONEY', 'NEXT_PUBLIC_RYNTRA_BOTS_SIGNALS_MONEY']) assert.match(source, new RegExp(`process\\.env\\.${name}`), name);
});

test('the pages: the grid switches between orders and the budget; signals stand on the budget; the card is the shared one', () => {
  const grid = read('./GridScreen.tsx');
  assert.match(grid, /<BotBudget bot="grid"/);
  assert.match(grid, /useOpenBots\(\)\.includes\('recurring'\)/, 'the budget way stands where the budget engine does');
  const bots = read('./BotsScreen.tsx');
  assert.match(bots, /<BotBudget bot="signals"/);
  const card = read('./BotBudget.tsx');
  assert.match(card, /<Trader /, 'the week on paper and «Start with money» are the budget card every bot shares');
  assert.match(card, /closed: open \? null : w\.moneyComing/, 'money closed says «coming»; the paper stays open');
  assert.match(card, /useAutopilot\.setState\(\{ plan: null \}\)/, 'leaving the page leaves no plan behind');
  /* No money words of hype, no promise. */
  const words = read('./budget-words.ts');
  assert.doesNotMatch(words, /profit|guarantee|x1000|прибут|гарант/iu);
});
