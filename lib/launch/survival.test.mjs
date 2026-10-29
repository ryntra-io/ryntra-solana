// SOL-L3: the survival answer reads each week still open on its own, keeps what is decided, never keeps «not read», and
// gives no rate while a market at that age is not read.
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { assembleLaunchSurvival } from "./survival.server.ts";

const DAY = 86_400;
const NOW = 1_770_000_000;
/* Synthetic addresses and signatures only. */
const CREATOR = "Creator".padEnd(44, "2");
const RYNTRA = "Ryntra".padEnd(44, "3");
const BUYER = "Buyer".padEnd(44, "4");
const token = (n) => `Mint${String(n).padStart(4, "x").replaceAll("0", "z")}`.padEnd(44, "1");

async function setup(markets) {
  const store = createMemoryGuardStore();
  for (const [n, market] of markets.entries()) {
    await store.collection("launches").set(`solana:mainnet:${token(n)}`, {
      cluster: "mainnet",
      state: "LAUNCHED",
      token: token(n),
      pool: `Curve${n}`.padEnd(44, "5"),
      creator: market.creator ?? CREATOR,
      symbol: `T${n}`,
      launchedAt: new Date((NOW - market.age * DAY) * 1000).toISOString(),
    });
  }
  return store;
}

const deps = (store, complete = true) => ({
  network: { cluster: "mainnet", chain: "solana:mainnet" },
  connection: null,
  store,
  now: () => new Date(NOW * 1000),
  ryntraWallets: async () => ({ wallets: new Set([RYNTRA]), complete }),
});

/** A reader whose weeks answer as `answer(token, from, to)` says. */
function reader(answer) {
  const asked = [];
  return {
    asked,
    state: async ({ token: mint }) => ({ token: mint }),
    windowTrades: async ({ token: mint, from, to, found }) => {
      asked.push({ mint, from, to });
      const read = answer(mint, from, to);
      return { trades: read.trades, complete: read.complete, found: read.trades.some(found) };
    },
  };
}

const trade = (at, trader = BUYER) => ({ signature: `Sig${at}`.padEnd(88, "6"), at, trader, payer: trader });

test("a busy market's week is read on its own and proven alive; the decision is kept and not read again", async () => {
  const store = await setup([{ age: 40 }]);
  /* Busy: the week is not read whole within the budget, but a trade by someone else is found in it. */
  const busy = reader((mint, from) => ({ trades: [trade(from + 3_600)], complete: false }));
  const first = await assembleLaunchSurvival(deps(store), busy);
  assert.deepEqual(first.markets[0].outcomes.map((outcome) => outcome.state), ["alive", "alive", "young"]);
  assert.ok(first.markets[0].outcomes[0].proof.signature.startsWith("Sig"));
  assert.deepEqual(first.horizons[1].people, { eligible: 1, alive: 1, quiet: 0, unread: 0 });
  assert.equal(busy.asked.length, 2, "one read per week still open");
  const again = reader(() => assert.fail("a decided week is never read again"));
  const second = await assembleLaunchSurvival(deps(store), again);
  assert.deepEqual(second.markets[0].outcomes.map((outcome) => outcome.state), ["alive", "alive", "young"]);
});

test("a week not read whole without a proof stays «not read» and is not kept; quiet only from a whole read", async () => {
  const store = await setup([{ age: 10 }, { age: 10 }]);
  const partial = reader((mint) => (mint === token(0) ? { trades: [trade(NOW - 9 * DAY, CREATOR)], complete: false } : { trades: [], complete: true }));
  const answer = await assembleLaunchSurvival(deps(store), partial);
  const states = Object.fromEntries(answer.markets.map((market) => [market.token, market.outcomes[0].state]));
  assert.equal(states[token(0)], "unread", "the creator's own trade proves nothing, and the week was not read whole");
  assert.equal(states[token(1)], "quiet");
  assert.equal(answer.complete, false);
  assert.equal(await store.collection("launchSurvival").get(`mainnet:${token(0)}:7`), undefined, "«not read» is never kept");
  assert.ok(await store.collection("launchSurvival").get(`mainnet:${token(1)}:7`));
});

test("nothing is kept while Ryntra's own wallets were not read whole", async () => {
  const store = await setup([{ age: 10 }]);
  await assembleLaunchSurvival(deps(store, false), reader(() => ({ trades: [trade(NOW - 9 * DAY)], complete: true })));
  assert.equal(await store.collection("launchSurvival").get(`mainnet:${token(0)}:7`), undefined);
});

test("Ryntra's own launches are counted apart", async () => {
  const store = await setup([{ age: 10, creator: RYNTRA }, { age: 10 }]);
  const answer = await assembleLaunchSurvival(deps(store), reader(() => ({ trades: [trade(NOW - 9 * DAY)], complete: true })));
  assert.deepEqual(answer.horizons[0].ryntra, { eligible: 1, alive: 1, quiet: 0, unread: 0 });
  assert.deepEqual(answer.horizons[0].people, { eligible: 1, alive: 1, quiet: 0, unread: 0 });
});

test("past 500 markets the list names the newest 500 and says so; the tallies count every one", async () => {
  const store = await setup(Array.from({ length: 501 }, (_, n) => ({ age: 1 + (n % 3) })));
  const answer = await assembleLaunchSurvival(deps(store), reader(() => assert.fail("no week is open yet")));
  assert.equal(answer.markets.length, 500);
  assert.equal(answer.listedAll, false);
  const { LaunchSurvivalResponseSchema } = await import("../api/v1/contract.ts");
  const parsed = LaunchSurvivalResponseSchema.safeParse(answer);
  assert.equal(parsed.success, true, `the answer keeps its own contract: ${JSON.stringify(parsed.error?.issues?.slice(0, 2))}`);
});
