import assert from "node:assert/strict";
import test from "node:test";

import {
  LIT_MS, READ_FRESH_MS, TOWER_LIMIT, beaconOf, checkBeacons, draftOf, firstDraft, isLit, mergeStates, roundLine, sanitizeBeacon, sanitizeBeacons,
  sanitizeCondition, sanitizeStates, stateOf, tellsTelegram,
} from "./rules.ts";
import { conditionWords, ruleWords, telegramWords, usd } from "./words.ts";

/*
 * The beacons' family on the engine: a price, a move over a period and a
 * pool's depth, each read from the city's market read; a stale read or a
 * tower that is not in the read is not known.
 */

const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const OTHER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

const tower = (over = {}) => ({ price: 1, liquidity: 1_000_000, change5m: 0, change1h: 0, change24h: 0, ...over });

const beacon = (over = {}) =>
  sanitizeBeacon({
    id: "beacon01",
    version: 1,
    groups: [[{ kind: "price", op: "above", value: 1.1 }]],
    holdSeconds: 0,
    hysteresis: 0.01,
    cooldownSeconds: 0,
    repeat: true,
    expiresAt: null,
    quiet: null,
    on: true,
    createdAt: T0,
    mint: MINT,
    symbol: "BONK",
    notify: true,
    ...over,
  });

/** Every read a minute apart, fresh; the indexes of the reads that fired. */
function run(rules, reads, { stale = false } = {}) {
  let states = {};
  const fired = [];
  reads.forEach((read, i) => {
    const now = T0 + i * 60_000;
    const towers = new Map(read ? [[MINT, tower(read)]] : []);
    const step = checkBeacons(rules, states, towers, stale ? now - READ_FRESH_MS - 1 : now, now);
    states = step.states;
    if (step.fired.length) fired.push(i);
  });
  return { fired, states };
}

test("a price fires on its crossing, once while it hovers, again only past its slack", () => {
  assert.deepEqual(run([beacon()], [{ price: 1 }, { price: 1.2 }, { price: 1.3 }]).fired, [1]);
  assert.deepEqual(run([beacon()], [{ price: 1.2 }, { price: 1.3 }]).fired, [], "already above when first seen: waits for the next crossing");
  assert.deepEqual(run([beacon()], [{ price: 1 }, { price: 1.11 }, { price: 1.095 }, { price: 1.11 }, { price: 1.08 }, { price: 1.11 }]).fired, [1, 5]);
});

test("a move over a period and a pool's depth read their own numbers", () => {
  const drop = beacon({ groups: [[{ kind: "move", period: "1h", op: "below", value: -5 }]] });
  assert.deepEqual(run([drop], [{ change1h: -1 }, { change1h: -6, change24h: 40 }]).fired, [1]);
  assert.deepEqual(run([drop], [{ change24h: -1 }, { change24h: -9 }]).fired, [], "the day's move is not the hour's");
  const deep = beacon({ groups: [[{ kind: "liquidity", op: "above", value: 2_000_000 }]] });
  assert.deepEqual(run([deep], [{ liquidity: 1e6 }, { liquidity: 3e6 }]).fired, [1]);
});

test("not known: a stale read, or a tower out of the read, neither fires nor arms", () => {
  assert.deepEqual(run([beacon()], [{ price: 1 }, { price: 1.2 }], { stale: true }).fired, []);
  assert.deepEqual(run([beacon()], [{ price: 1 }, null, { price: 1.2 }]).fired, [2], "a gap is not a crossing, the next read still is");
  const rules = [beacon()];
  const away = checkBeacons(rules, {}, new Map([[OTHER, tower({ price: 9 })]]), T0, T0);
  assert.equal(away.fired.length, 0);
  assert.equal(away.states.beacon01.state.seen, false);
});

test("hold, pause, and «and» / «or»", () => {
  assert.deepEqual(run([beacon({ holdSeconds: 120 })], [{ price: 1 }, { price: 1.2 }, { price: 1.2 }, { price: 1.2 }]).fired, [3]);
  assert.deepEqual(run([beacon({ cooldownSeconds: 180 })], [{ price: 1 }, { price: 1.2 }, { price: 1 }, { price: 1.2 }, { price: 1 }, { price: 1.2 }]).fired, [1, 5]);
  const both = beacon({ groups: [[{ kind: "price", op: "above", value: 1.1 }, { kind: "move", period: "5m", op: "above", value: 3 }]] });
  assert.deepEqual(run([both], [{ price: 1 }, { price: 1.2, change5m: 1 }, { price: 1.2, change5m: 4 }]).fired, [2]);
  const either = beacon({ groups: [[{ kind: "price", op: "above", value: 1.1 }], [{ kind: "liquidity", op: "below", value: 5e5 }]] });
  assert.deepEqual(run([either], [{ price: 1 }, { liquidity: 4e5 }]).fired, [1]);
});

test("a one-time beacon is spent after it fires; an edit starts it over", () => {
  const once = beacon({ repeat: false });
  const { fired, states } = run([once], [{ price: 1 }, { price: 1.2 }, { price: 1 }, { price: 1.2 }]);
  assert.deepEqual(fired, [1]);
  assert.equal(states.beacon01.spent, true);
  const edited = { ...once, version: 2 };
  assert.equal(stateOf(edited, states).spent, false);
  assert.equal(stateOf(edited, states).state.seen, false);
});

test("lit for half an hour after it fired; the later of two firings wins", () => {
  const rule = beacon();
  const { states } = run([rule], [{ price: 1 }, { price: 1.2 }]);
  const firedAt = states.beacon01.state.firedAt;
  assert.equal(isLit(rule, states.beacon01, firedAt + LIT_MS - 1), true);
  assert.equal(isLit(rule, states.beacon01, firedAt + LIT_MS), false);
  assert.equal(isLit({ ...rule, on: false }, states.beacon01, firedAt), false);
  assert.equal(isLit({ ...rule, version: 2 }, states.beacon01, firedAt), false);
  const later = { beacon01: { ...states.beacon01, state: { ...states.beacon01.state, firedAt: firedAt + 5 } } };
  assert.equal(mergeStates([rule], states, later).beacon01.state.firedAt, firedAt + 5);
  assert.equal(mergeStates([rule], later, states).beacon01.state.firedAt, firedAt + 5);
});

test("checked: a beacon reads whole, a list keeps its limits, states only for beacons that exist", () => {
  assert.equal(beacon({ mint: "0xabc" }), null);
  assert.equal(beacon({ groups: [[{ kind: "price", op: "above", value: -1 }]] }), null);
  assert.equal(beacon({ groups: [[{ kind: "move", period: "7d", op: "above", value: 1 }]] }), null);
  assert.equal(beacon({ groups: [[{ kind: "eval", op: "above", value: 1 }]] }), null);
  assert.equal(beacon({ symbol: "<b>" }).symbol, "");
  assert.equal(beacon({ notify: undefined }).notify, false, "Telegram is opt-in: a beacon that does not say so stays quiet");
  assert.equal(beacon({ notify: "yes" }).notify, false);
  assert.deepEqual(sanitizeCondition({ kind: "move", period: "5m", op: "below", value: -3 }), { kind: "move", period: "5m", op: "below", value: -3 });
  const many = Array.from({ length: TOWER_LIMIT + 2 }, (_, i) => ({ ...beacon(), id: `beacon${i}x` }));
  assert.equal(sanitizeBeacons(many).length, TOWER_LIMIT, "a tower holds a few beacons, not a list");
  assert.deepEqual(sanitizeStates({ gone01: { version: 1, state: { armed: true, since: null, firedAt: null, seen: true } } }, [beacon()]), {});
  assert.deepEqual(sanitizeStates({ beacon01: { version: 1, state: { armed: 1 } } }, [beacon()]), {}, "a state that does not read is not kept");
  assert.equal(sanitizeStates({ beacon01: { version: 1, state: { armed: 1, since: null, firedAt: null, seen: true } } }, [beacon()]).beacon01.state.armed, false);
});

test("a draft makes a beacon and comes back from it; an edit is one version on", () => {
  const t = { id: MINT, symbol: "$bonk" };
  const draft = { ...firstDraft({ price: 0.00002345 }), conditions: [{ kind: "price", op: "above", value: 0.0000246 }, { kind: "move", period: "1h", op: "above", value: 5 }], join: "or" };
  const made = beaconOf(draft, t, null, T0, () => 0.5);
  assert.equal(made.symbol, "bonk");
  assert.equal(made.groups.length, 2);
  assert.deepEqual(draftOf(made).conditions, draft.conditions);
  assert.equal(draftOf(made).join, "or");
  const again = beaconOf({ ...draftOf(made), join: "and" }, t, made, T0 + 1000);
  assert.equal(again.id, made.id);
  assert.equal(again.version, 2);
  assert.equal(again.groups.length, 1);
  assert.equal(beaconOf({ ...draft, conditions: [] }, t, null, T0), null);
  assert.equal(firstDraft({ price: 0.00002345 }).conditions[0].value, roundLine(0.00002345 * 1.05));
  assert.equal(firstDraft({ price: 1 }).notify, false, "a new beacon tells Telegram only once the person turns it on");
});

test("the switch: closed unless the deployment says device or open", async () => {
  const { beaconsMode } = await import("./switch.ts");
  assert.equal(beaconsMode(undefined), "closed");
  assert.equal(beaconsMode(""), "closed");
  assert.equal(beaconsMode("true"), "closed");
  assert.equal(beaconsMode("device"), "device");
  assert.equal(beaconsMode("open"), "open");
});

test("words: short, plain, the number now; Telegram only when asked and not in quiet hours", () => {
  assert.equal(usd(0.0000312), "$0.0000312");
  assert.equal(usd(1_234_567), "$1.23M");
  assert.equal(usd(12.5), "$12.5");
  assert.equal(conditionWords({ kind: "move", period: "1h", op: "below", value: -5 }), "1h move below −5.0%");
  const rule = beacon({ groups: [[{ kind: "price", op: "above", value: 1.1 }], [{ kind: "liquidity", op: "below", value: 5e5 }]] });
  assert.equal(ruleWords(rule), "Price above $1.1 or Liquidity below $500K");
  assert.equal(telegramWords(rule, tower({ price: 1.2 }), "https://ryntra.io/c/x"), "Ryntra · Beacon lit\n$BONK · Price above $1.1 or Liquidity below $500K\nNow $1.2\nhttps://ryntra.io/c/x");
  assert.equal(tellsTelegram(rule, T0), true);
  assert.equal(tellsTelegram({ ...rule, notify: false }, T0), false);
  assert.equal(tellsTelegram({ ...rule, quiet: { from: 600, to: 900, zone: "UTC" } }, T0), false);
});
