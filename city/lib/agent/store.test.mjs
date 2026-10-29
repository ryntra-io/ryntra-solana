import { test } from "node:test";
import assert from "node:assert/strict";

import { useAgent } from "./store.ts";

const NOW = Date.parse("2026-10-27T12:00:00Z");

const tower = (id, change1h) => ({
  id,
  symbol: id,
  name: id,
  icon: null,
  district: "core",
  price: 1,
  mcap: 1e8,
  liquidity: 5e6,
  holders: 1e4,
  change5m: 0,
  change1h,
  change24h: 3,
  volume24h: 1e6,
  traders1h: 400,
  organic: 70,
  verified: true,
  launchedAt: null,
});

const towers = [tower("JUP", 8), tower("RAY", 6), tower("ORCA", 1)];

test("the scout flies only after its rule is launched, and finds what fits", () => {
  const a = useAgent.getState();
  a.look(towers, true, NOW);
  assert.equal(useAgent.getState().phase, "off");

  a.toggle();
  assert.equal(useAgent.getState().panel, "rule");
  a.setDraft({ ...useAgent.getState().draft, signal: "rise1h", move: 5, liquidity: 1_000_000, area: "any", budget: 50 });
  a.launch(NOW);
  let st = useAgent.getState();
  assert.equal(st.on, true);
  assert.equal(st.rule.budget, 50);
  assert.equal(st.phase, "patrol");

  a.look(towers, true, NOW + 6000);
  st = useAgent.getState();
  assert.equal(st.phase, "found");
  assert.equal(st.find.tower.id, "JUP");
  // The card waits for the drone to get there.
  assert.equal(st.arrived, false);
  // On arrival the rule is checked again on the tower's figures now, and the card shows those.
  a.arrive(tower("JUP", 9), true, NOW + 6500);
  st = useAgent.getState();
  assert.equal(st.arrived, true);
  assert.equal(st.find.facts[0].value, "+9.0%");

  // While a find waits, the scout does not look again.
  a.look([tower("BONK", 40)], true, NOW + 7000);
  assert.equal(useAgent.getState().find.tower.id, "JUP");
});

test("skipping flies on to the next match; the skipped tower waits hours", () => {
  const a = useAgent.getState();
  a.skip(NOW + 8000);
  assert.equal(useAgent.getState().phase, "patrol");
  a.look(towers, true, NOW + 15000);
  assert.equal(useAgent.getState().find.tower.id, "RAY");
});

test("a pressed find is remembered so its buy counts; a spent budget rests the scout", () => {
  const a = useAgent.getState();
  a.bring(NOW + 20000);
  let st = useAgent.getState();
  assert.equal(st.brought.mint, "RAY");
  assert.equal(st.find, null);
  a.record({ at: NOW + 30000, mint: "RAY", usd: 50 });
  a.look(towers, true, NOW + 40000);
  st = useAgent.getState();
  assert.equal(st.phase, "resting");
  assert.equal(st.until, NOW + 30000 + 7 * 24 * 60 * 60 * 1000);
});

test("old data brings nothing; stopping lands the scout", () => {
  const a = useAgent.getState();
  a.edit();
  a.setDraft({ ...useAgent.getState().rule, budget: 500 });
  a.launch(NOW + 50000);
  a.look([tower("WIF", 20)], false, NOW + 60000);
  assert.equal(useAgent.getState().phase, "waiting");
  a.stop();
  const st = useAgent.getState();
  assert.equal(st.on, false);
  assert.equal(st.phase, "off");
  assert.equal(st.panel, "none");
});

test("a find that no longer stands is dropped on arrival, and any find goes old after three minutes", () => {
  const a = useAgent.getState();
  const fly = (at) => {
    a.edit();
    a.setDraft({ ...useAgent.getState().rule, signal: "rise1h", move: 5, liquidity: 1_000_000, area: "any", budget: 500 });
    a.launch(at);
    useAgent.setState({ seen: {} });
    a.look(towers, true, at + 1000);
    assert.equal(useAgent.getState().find.tower.id, "JUP");
  };

  // The tower cooled off on the way: no card over figures that no longer fit.
  fly(NOW + 100_000);
  a.arrive(tower("JUP", 1), true, NOW + 102_000);
  let st = useAgent.getState();
  assert.equal(st.find, null);
  assert.equal(st.arrived, false);
  assert.equal(st.phase, "patrol");

  // The tower left the city's read, or the read is not live.
  fly(NOW + 200_000);
  a.arrive(undefined, true, NOW + 202_000);
  assert.equal(useAgent.getState().find, null);
  fly(NOW + 300_000);
  a.arrive(tower("JUP", 9), false, NOW + 302_000);
  assert.equal(useAgent.getState().find, null);

  // Too old by the time the drone gets there.
  fly(NOW + 400_000);
  a.arrive(tower("JUP", 9), true, NOW + 401_000 + 3 * 60 * 1000 + 1);
  assert.equal(useAgent.getState().find, null);

  // An open card goes old too.
  fly(NOW + 500_000);
  a.arrive(tower("JUP", 9), true, NOW + 502_000);
  assert.equal(useAgent.getState().arrived, true);
  a.expire(NOW + 501_000 + 2 * 60 * 1000);
  assert.equal(useAgent.getState().arrived, true);
  a.expire(NOW + 501_000 + 3 * 60 * 1000 + 1);
  st = useAgent.getState();
  assert.equal(st.find, null);
  assert.equal(st.arrived, false);
  a.stop();
});
