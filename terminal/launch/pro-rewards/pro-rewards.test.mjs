/**
 * The reward for a pool's liquidity on the Launch screen: its switch closed by default, its choices the
 * engine's own terms, the supply it leaves locked, its words in both languages, and its one mount in the form.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DLMM_PRO_LAUNCH_TERMS } from "../../../lib/core/launch/dlmm-pro.ts";
import { POOL_DEFAULT } from "../../../city/lib/launch/pool.ts";
import { PRO_REWARDS_SWITCH, REWARD_DAYS, REWARD_DEFAULT, REWARD_SHARES, lockedShareBps, rewardCoins, rewardDayOf, rewardHowOf, rewardOf, withReward } from "./view.ts";
import { PRO_REWARDS } from "./words.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the step's switch is closed unless the deployment opens it", () => {
  assert.equal(process.env.NEXT_PUBLIC_RYNTRA_POOL_LAUNCH_REWARDS, undefined);
  assert.equal(PRO_REWARDS_SWITCH, false);
  assert.match(read("./view.ts"), /process\.env\.NEXT_PUBLIC_RYNTRA_POOL_LAUNCH_REWARDS === 'open'/, "only «open» opens it");
});

test("the choices are the engine's own terms, and the default is one of them", () => {
  assert.deepEqual([...REWARD_SHARES], [...DLMM_PRO_LAUNCH_TERMS.reward.shares]);
  assert.deepEqual([...REWARD_DAYS], [...DLMM_PRO_LAUNCH_TERMS.reward.days]);
  assert.ok(REWARD_SHARES.includes(REWARD_DEFAULT.shareBps) && REWARD_DAYS.includes(REWARD_DEFAULT.days));
  assert.equal(rewardCoins(200), 20_000_000, "2 % of a billion");
});

test("switched on it starts at the default or as it was; switched off it is gone; outside the terms it is none", () => {
  const on = withReward(POOL_DEFAULT, true);
  assert.deepEqual(on.reward, REWARD_DEFAULT);
  assert.equal(withReward(on, false).reward, null);
  assert.deepEqual(withReward({ ...POOL_DEFAULT, reward: { shareBps: 1_000, days: 90 } }, true).reward, { shareBps: 1_000, days: 90 });
  assert.equal(rewardOf(POOL_DEFAULT), null, "the format's default pays none");
  for (const reward of [{ shareBps: 5, days: 30 }, { shareBps: 2_000, days: 30 }, { shareBps: 200, days: 0 }, { shareBps: 200, days: 400 }]) assert.equal(rewardOf({ reward }), null, JSON.stringify(reward));
});

test("what stays locked is the supply less the ladder and the reward", () => {
  assert.equal(lockedShareBps(POOL_DEFAULT), 10_000);
  assert.equal(lockedShareBps({ ladder: true, reward: null }), 9_500);
  assert.equal(lockedShareBps({ ladder: false, reward: { shareBps: 200, days: 30 } }), 9_800);
  assert.equal(lockedShareBps({ ladder: true, reward: { shareBps: 1_000, days: 7 } }), 8_500);
  assert.equal(lockedShareBps(null), 10_000);
});

test("the launch's «i» says the reward where there is one, in both languages", () => {
  assert.equal(rewardHowOf(POOL_DEFAULT, "en"), null);
  const en = rewardHowOf({ ladder: true, reward: { shareBps: 200, days: 30 } }, "en");
  assert.match(en, /93% of the supply/);
  assert.match(en, /5% stays yours on the ladder/);
  assert.match(en, /2% pays liquidity providers/);
  const uk = rewardHowOf({ ladder: false, reward: { shareBps: 500, days: 7 } }, "uk");
  assert.match(uk, /95%/);
  assert.match(uk, /5% — нагорода вкладникам/);
});

test("the day of the reward Ryntra's locked part earns until others add liquidity — the engine's own arithmetic", () => {
  assert.equal(rewardDayOf(POOL_DEFAULT), null, "no reward, nothing to say");
  const day = rewardDayOf({ reward: { shareBps: 200, days: 30 } });
  assert.equal(Math.round(day.perDay), 666_667, "20M over 30 days");
  assert.equal(Math.round(day.ryntra), 400_000, "60 % of it Ryntra's while nobody else is at the price");
  assert.equal(Math.round(day.creator), 266_667, "40 % the creator's own locked position's");
  assert.deepEqual([day.creatorBps, day.ryntraBps], [4_000, 6_000]);
  const alone = rewardDayOf({ reward: { shareBps: 200, days: 30 } }, false);
  assert.equal(alone.ryntra, 0, "without the split none of it is Ryntra's");
  assert.equal(Math.round(rewardDayOf({ reward: { shareBps: 1_000, days: 7 } }).ryntra), 8_571_429, "10 % over 7 days");
});

test("the one line before the signature says how much, for how long, how much of each day goes to Ryntra's locked part until others come, and that it does not come back", () => {
  const en = PRO_REWARDS.en.line("20M $KITE", PRO_REWARDS.en.days(30), "400K $KITE");
  assert.equal(en, "20M $KITE over 30 days · until others add liquidity: 400K $KITE a day to Ryntra’s locked part · cannot be taken back");
  const uk = PRO_REWARDS.uk.line("20 млн $KITE", PRO_REWARDS.uk.days(30), "400 тис. $KITE");
  assert.equal(uk, "20 млн $KITE на 30 днів · доки інших вкладників немає: 400 тис. $KITE на день — замкненій частці Ryntra · назад не забрати");
  assert.match(PRO_REWARDS.en.line("20M $KITE", "30 days", null), /comes back to your locked part/, "a launch without the split says so");
  assert.match(PRO_REWARDS.uk.line("20 млн $KITE", "30 днів", null), /твоїй замкненій частці/);
  assert.deepEqual([1, 2, 7, 21, 90].map((n) => PRO_REWARDS.uk.days(n)), ["1 день", "2 дні", "7 днів", "21 день", "90 днів"]);
  assert.deepEqual([1, 7].map((n) => PRO_REWARDS.en.days(n)), ["1 day", "7 days"]);
  /* Behind the «i»: who earns it until others come, and that it never comes back but for what found no liquidity. */
  const how = PRO_REWARDS.en.how("2%", "40%", "60%", "266.7K", "400K");
  for (const said of [/cannot leave a position out/, /40% yours \(266\.7K a day, you collect it\), 60% Ryntra’s \(400K a day\)/, /The more others add, the more goes to them/, /cannot be stopped or taken back/, /no liquidity stands at the price comes back to you/]) assert.match(how, said);
  const howUk = PRO_REWARDS.uk.how("2%", "40%", "60%", "266,7 тис.", "400 тис.");
  for (const said of [/не може оминути позицію/, /40% тобі \(266,7 тис\. на день, забираєш сам\), 60% Ryntra \(400 тис\. на день\)/]) assert.match(howUk, said);
});

test("the form mounts the step once, after the ladder, with the pool format alone; the card counts what stays locked", () => {
  const form = read("../Form.tsx");
  assert.equal(form.match(/<ProRewards /g)?.length, 1);
  assert.ok(form.indexOf("<ProRewards ") > form.indexOf('mark="ladder"'), "after the ladder");
  assert.match(form, /m\.format === 'pool' && m\.choice \? <ProRewards /);
  assert.match(read("../Side.tsx"), /lockedShareBps\(m\.choice\)/);
  const step = read("./ProRewards.tsx");
  assert.match(step, /if \(!open\) return null;/, "nothing shows behind a closed switch");
  assert.doesNotMatch(step, /lib\/launch-pool|meteora-dlmm-pro|dlmm-pro-sdk/, "the screen loads no engine and no venue");
});
