// Run from repo root: node --test city/lib/ring/arena.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

/**
 * CITY-217 «Арена»: the Arena's window state — «my agent» read when it opens (no garage visit), a first agent made in
 * the account's own garage in the Arena after a sign-in when one is needed, a closed Ring that shows nothing and asks
 * nothing again, and the board of a format.
 */

const { createArenaStore, entryWord, fighterOf } = await import("./arena.ts");
const { ringStore } = await import("./store.ts");
const { RingClientError } = await import("./client.ts");
const { useDuels, RIVAL } = await import("./duels.ts");

const BAY = { quarter: "bay-0123456789abcdef0123456789abcdef", slot: 0 };
const agentOf = (over = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  quarterId: BAY.quarter,
  slot: 0,
  name: "Scout 0000",
  archetype: "scout",
  brain: { id: "a/haiku", name: "Haiku", provider: "anthropic", providerName: "Anthropic", weight: "light", matchMicroUsd: 14_000 },
  formats: ["duo-crack", "market-replay"],
  ratings: [],
  status: "active",
  version: 1,
  createdAt: "",
  updatedAt: "",
  ...over,
});

function fake({ signedIn = true, agents = [], fail = null } = {}) {
  const state = { signedIn, agents, mineCalls: 0, boardCalls: [] };
  return {
    state,
    client: {
      async mine() {
        state.mineCalls += 1;
        if (fail) throw fail;
        return { signedIn: state.signedIn, agents: state.signedIn ? state.agents : [], bay: state.signedIn ? BAY : null };
      },
      async board(format) {
        state.boardCalls.push(format);
        return { format, rows: [{ rank: 1, id: "x", name: "Host 00ab", archetype: "host", weight: "light", brain: "Haiku", rating: { format, rating: 1224, low: 900, high: 1500, games: 1, wins: 1, draws: 0, losses: 0, provisional: true }, mine: false }] };
      },
    },
  };
}

test("opening reads «my agent»; the fighter is the first active one", async () => {
  const { client, state } = fake({ agents: [agentOf({ id: "a1", status: "off" }), agentOf({ id: "a2" })] });
  const arena = createArenaStore({ client: () => client });
  arena.getState().show("agent");
  await arena.getState().readMine();
  assert.equal(arena.getState().tab, "agent");
  assert.equal(arena.getState().mine.status, "read");
  assert.equal(fighterOf(arena.getState().mine).id, "a2");
  assert.ok(state.mineCalls >= 1 && state.mineCalls <= 2, "one read at a time");
  arena.getState().close();
  assert.equal(arena.getState().open, false);
});

test("signed out, «Make your agent» signs in first, then opens the making screen in the Arena's garage", async () => {
  const { client, state } = fake({ signedIn: false });
  let asked = 0;
  const arena = createArenaStore({
    client: () => client,
    signIn: async () => {
      asked += 1;
      state.signedIn = true;
      return true;
    },
  });
  await arena.getState().readMine();
  assert.equal(arena.getState().mine.signedIn, false);
  await arena.getState().makeAgent();
  assert.equal(asked, 1);
  assert.equal(arena.getState().tab, "agent");
  const editor = ringStore.getState().editor;
  assert.deepEqual([editor.quarterId, editor.slot, editor.agent], [BAY.quarter, 0, null]);
  ringStore.getState().closeEditor();
});

test("a declined sign-in opens nothing; an agent already there opens no second one", async () => {
  const declined = fake({ signedIn: false });
  const arena = createArenaStore({ client: () => declined.client, signIn: async () => false });
  await arena.getState().makeAgent();
  assert.equal(ringStore.getState().editor, null);
  assert.equal(arena.getState().signing, false, "nothing is left waiting");

  const had = fake({ agents: [agentOf()] });
  const second = createArenaStore({ client: () => had.client });
  await second.getState().readMine();
  await second.getState().makeAgent();
  assert.equal(ringStore.getState().editor, null);
});

test("a closed Ring shows nothing and is not asked again as a failure; another failure keeps the last good read", async () => {
  const closed = fake({ fail: new RingClientError(404, "CLOSED", "closed") });
  const arena = createArenaStore({ client: () => closed.client });
  await arena.getState().readMine();
  assert.deepEqual(arena.getState().mine, { status: "read", signedIn: false, agents: [], bay: null });

  const flaky = fake({ agents: [agentOf()] });
  const kept = createArenaStore({ client: () => flaky.client });
  await kept.getState().readMine();
  flaky.client.mine = async () => {
    throw new RingClientError(0, "OFFLINE", "offline");
  };
  await kept.getState().readMine();
  assert.equal(kept.getState().mine.status, "read");
  assert.equal(kept.getState().mine.agents.length, 1);
});

test("the board of a format is read and kept per format", async () => {
  const { client, state } = fake();
  const arena = createArenaStore({ client: () => client });
  await arena.getState().readBoard("duo-crack");
  assert.equal(arena.getState().boards["duo-crack"].rows[0].rating.rating, 1224);
  assert.equal(arena.getState().boards["market-replay"].status, "idle");
  assert.deepEqual(state.boardCalls, ["duo-crack"]);
});

test("a rated fight asks the server for a rival; practice, or no agent, fights the house", async () => {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ error: { code: "NO_RIVAL" } }), { status: 409 });
  };
  useDuels.getState().setMode("rated");
  await useDuels.getState().start("agent-1");
  assert.equal(useDuels.getState().error, "noRival");
  useDuels.getState().setMode("practice");
  await useDuels.getState().start("agent-1");
  await useDuels.getState().start(null);
  assert.deepEqual(sent.map((b) => b.opponent), [RIVAL, "chatty", "chatty"]);
  assert.deepEqual(sent.map((b) => b.agent), ["agent-1", "agent-1", "wall"]);
});

test("a sign-in that lands while a read is out is read once more: «my agent» never stays signed out", async () => {
  const { client, state } = fake({ signedIn: false });
  let release;
  const slow = client.mine;
  client.mine = () => new Promise((resolve) => (release = () => resolve(slow())));
  const arena = createArenaStore({ client: () => client });
  const first = arena.getState().readMine();
  state.signedIn = true;
  client.mine = slow;
  const second = arena.getState().readMine();
  release();
  await Promise.all([first, second]);
  assert.equal(arena.getState().mine.signedIn, true);
});

test("an agent's name is its body's word in the language on screen, never a piece of its id (review 8.11)", async () => {
  const { agentLabel } = await import("./format.ts");
  const { setLang } = await import("../i18n/lang.ts").catch(() => ({}));
  assert.equal(agentLabel("fighter"), "Fighter");
  assert.equal(agentLabel("host"), "Host");
  for (const archetype of ["fighter", "host", "scout", "guardian", "tactician", "engineer"]) assert.doesNotMatch(agentLabel(archetype), /[0-9]/, archetype);
  if (setLang) {
    setLang("uk");
    assert.equal(agentLabel("fighter"), "Боєць");
    setLang("en");
  }
});

test("closed duels: opening the window reads no duels — the Fight tab is not there (review 8.11)", async () => {
  const asked = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ duels: [], formats: ["duo-crack"] }), { status: 200 });
  };
  try {
    const { client } = fake();
    const closed = createArenaStore({ client: () => client, duelsOpen: () => false });
    closed.getState().show("agent");
    await closed.getState().readMine();
    assert.deepEqual(asked, [], "no GET /api/ring/duels while the duels' switch is closed");
    closed.getState().close();
    const open = createArenaStore({ client: () => client, duelsOpen: () => true });
    open.getState().show("fight");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(asked, ["/api/ring/duels"], "open, the latest duels are read for the stage");
    open.getState().close();
  } finally {
    globalThis.fetch = before;
  }
});

test("picking another mode clears a finished fight from the stage; a live one stays", () => {
  const done = { id: "duel-x", format: "duo-crack", status: "done", duel: { rounds: [] } };
  useDuels.setState({ duel: done, mode: "practice" });
  useDuels.getState().setMode("rated");
  assert.equal(useDuels.getState().duel, null);
  const live = { ...done, status: "live" };
  useDuels.setState({ duel: live, mode: "rated", open: false });
  useDuels.getState().setMode("practice");
  assert.equal(useDuels.getState().duel, live);
});

/* CITY-239: a wallet connected but not signed in read «Connect wallet» on the Ring's one button. */
test("the one button for a person not signed in: a connected wallet is asked to sign in, never to connect again", async () => {
  assert.equal(entryWord(false, false), "connect");
  assert.equal(entryWord(false, true), "connecting");
  assert.equal(entryWord(true, false), "signIn");
  assert.equal(entryWord(true, true), "checkWallet", "the message is in the wallet");
  const { readFileSync } = await import("node:fs");
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const { DUEL_UI, ENTRY_WORDS } = await import("../../components/ring/duel/words.ts");
  // The words the wallet's own panel uses for the same step (city/components/quarter/words.ts).
  const quarter = read("../../components/quarter/words.ts");
  for (const [lang, signIn, check] of [["en", "Sign in", "Check your wallet"], ["uk", "Увійти", "Перевір гаманець"]]) {
    assert.equal(DUEL_UI[lang][ENTRY_WORDS.signIn], signIn);
    assert.equal(DUEL_UI[lang][ENTRY_WORDS.checkWallet], check);
    assert.ok(quarter.includes(`signIn: '${signIn}',`) && quarter.includes(`checkYourWallet: '${check}',`), `${lang}: the panel's own words`);
    assert.notEqual(DUEL_UI[lang][ENTRY_WORDS.connect], signIn);
  }
  // Both tabs of the window ask the one rule, and the press is the city's own sign-in — the one the panel's button makes.
  const fight = read("../../components/ring/duel/DuelsWindow.tsx");
  const agent = read("../../components/ring/arena/AgentTab.tsx");
  assert.match(fight, /signedOut \|\| error === 'signIn' \? w\[ENTRY_WORDS\[entryWord\(connected, signing \|\| entering\)\]\] :/u);
  assert.match(agent, /mine\.signedIn \? w\.makeYours : w\[ENTRY_WORDS\[entryWord\(connected, signing \|\| entering\)\]\]/u);
  // A sign-in under way from the wallet's own list or panel is the same sign-in: the button follows the city's account.
  for (const tab of [fight, agent]) assert.match(tab, /const entering = useCityAccount\(\(st\) => st\.step === 'connecting' \|\| st\.step === 'signing' \|\| st\.step === 'opening'\);/u);
  for (const tab of [fight, agent]) assert.match(tab, /const connected = useWallet\(\(st\) => Boolean\(st\.connection\)\);/u);
  assert.match(read("./arena.ts"), /return cityAccount\.getState\(\)\.begin\(null, 'top'\);/u);
  assert.match(read("../../components/quarter/WalletChip.tsx"), /const signIn = \(\) => void cityAccount\.getState\(\)\.begin\(null, 'top'\);/u);
});

/* CITY-240: after a sign-in the wallet refused, the Ring's button stayed «Check your wallet», switched off, for as long
   as «my agent» took to answer — seconds on the site. A «no» changed nothing: the button is back at once. */
test("a refused sign-in gives the button back at once; one that worked still waits for «my agent»", async () => {
  const { client, state } = fake({ signedIn: false });
  let ok = false;
  const arena = createArenaStore({ client: () => client, signIn: async () => ok });
  await arena.getState().readMine();
  assert.equal(entryWord(true, arena.getState().signing), "signIn");
  // «My agent» answers slowly from here on.
  const quick = client.mine;
  const held = [];
  client.mine = () => new Promise((resolve) => held.push(() => resolve(quick())));
  assert.equal(await arena.getState().signIn(), false);
  assert.equal(arena.getState().signing, false, "the read is still out and the button already says «Sign in»");
  assert.equal(entryWord(true, arena.getState().signing), "signIn");
  assert.equal(held.length, 1, "«my agent» is still read again, behind the button");
  assert.equal(arena.getState().mine.status, "read", "a read that was good stays on screen meanwhile: nothing blinks");
  held.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(arena.getState().mine.signedIn, false);

  // A sign-in that worked: the button waits for whose agent stands here now.
  ok = true;
  state.signedIn = true;
  const going = arena.getState().signIn();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(arena.getState().signing, true, "signed in, «my agent» not read yet");
  assert.equal(entryWord(true, arena.getState().signing), "checkWallet");
  while (held.length) held.shift()();
  assert.equal(await going, true);
  assert.equal(arena.getState().signing, false);
  assert.equal(arena.getState().mine.signedIn, true);

  // A sign-in that threw is a «no» like any other.
  const thrown = createArenaStore({ client: () => fake({ signedIn: false }).client, signIn: async () => Promise.reject(new Error("wallet closed")) });
  assert.equal(await thrown.getState().signIn(), false);
  assert.equal(thrown.getState().signing, false);
});
