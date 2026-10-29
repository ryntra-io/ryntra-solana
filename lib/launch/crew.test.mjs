import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GUARD_COLLECTIONS, createMemoryGuardStore } from "../guard/store.ts";
import { CREW_FAILURE_CODES, LAUNCH_CREWS, answerCrew, createCrew, crewSharesFor, crewView, holdCrew, readFlyingCrews, releaseCrew } from "./crew.server.ts";
import { launchKey } from "./record-key.ts";

const CREATOR = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const ADA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTO = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const NOW = Date.parse("2026-10-25T12:00:00Z");

const depsOf = (store, cluster = "devnet", at = NOW) => ({ store, cluster, now: () => new Date(at) });
const input = (over = {}) => ({ creator: CREATOR, creatorHandle: "kite_cap", symbol: "kite", name: "Kite", preset: "classic", window: "2026-10-25T20:00Z", invites: [{ handle: "ada", bps: 2000 }, { handle: "@oto", bps: 1500 }], ...over });

test("a crew's record is a collection of the store", () => {
  assert.ok(GUARD_COLLECTIONS.includes(LAUNCH_CREWS));
});

test("mainnet stays closed; the devnet stand makes crews", async () => {
  const store = createMemoryGuardStore();
  const closed = await createCrew(depsOf(store, "mainnet"), input());
  assert.equal(closed.ok, false);
  assert.equal(closed.code, "CLOSED");
  assert.equal(CREW_FAILURE_CODES.CLOSED, "CAPABILITY_UNAVAILABLE");
  const made = await createCrew(depsOf(store), input());
  assert.equal(made.ok, true);
  assert.equal(made.crew.symbol, "KITE");
  assert.deepEqual(made.crew.members.map((m) => [m.handle, m.state]), [["ada", "INVITED"], ["oto", "INVITED"]]);
  assert.equal((await createCrew(depsOf(store), input({ preset: "community" }))).code, "INVALID", "«Спільнота» keeps its own rows");
  assert.equal((await createCrew(depsOf(store), input({ window: "2026-10-25T09:00Z" }))).code, "INVALID", "a window already gone");
  assert.equal((await createCrew(depsOf(store), input({ invites: [{ handle: "kite_cap", bps: 1000 }] }))).code, "INVALID", "the creator is not their own member");
});

test("each invitee answers themselves: never the creator, a wallet once, a yes taken back until liftoff", async () => {
  const store = createMemoryGuardStore();
  const deps = depsOf(store);
  const { crew } = await createCrew(deps, input());
  assert.equal((await answerCrew(deps, { id: crew.id, handle: "ada", wallet: CREATOR, answer: "accept" })).code, "IS_CREATOR");
  assert.equal((await answerCrew(deps, { id: crew.id, handle: "kai", wallet: ADA, answer: "accept" })).code, "NOT_INVITED");
  assert.equal((await answerCrew(deps, { id: crew.id, handle: "oto", wallet: ADA, answer: "decline" })).code, "WALLET_TAKEN", "a stranger never answers no for a handle");
  const yes = await answerCrew(deps, { id: crew.id, handle: "ADA", wallet: ADA, answer: "accept" });
  assert.equal(yes.ok, true);
  assert.equal(yes.crew.members[0].wallet, ADA);
  assert.equal((await answerCrew(deps, { id: crew.id, handle: "oto", wallet: ADA, answer: "accept" })).code, "WALLET_TAKEN", "one wallet, one member");
  assert.equal((await answerCrew(deps, { id: crew.id, handle: "ada", wallet: OTO, answer: "decline" })).code, "WALLET_TAKEN", "only the wallet that said yes takes it back");
  const view = crewView(yes.crew, NOW);
  assert.equal(view.creatorBps, 8000);
  assert.equal(view.members[1].wallet, null, "no wallet shown for those who did not say yes");
  assert.match(view.members[0].consent.join(" "), /I am @ada on X and I join the crew of \$KITE/);
  const back = await answerCrew(deps, { id: crew.id, handle: "ada", wallet: ADA, answer: "decline" });
  assert.equal(back.crew.members[0].state, "DECLINED");
  assert.equal(back.crew.members[0].wallet, null);
  const late = await answerCrew(depsOf(store, "devnet", NOW + 8 * 86_400_000), { id: crew.id, handle: "oto", wallet: OTO, answer: "accept" });
  assert.equal(late.code, "EXPIRED");
});

test("liftoff takes the rows from the record: this creator, this ticker and name, someone aboard — then the submit holds the crew", async () => {
  const store = createMemoryGuardStore();
  const deps = depsOf(store);
  const { crew } = await createCrew(deps, input());
  const at = { creator: CREATOR, preset: "classic", symbol: "KITE", name: "Kite" };
  assert.equal((await crewSharesFor(deps, { id: crew.id, ...at })).code, "NOBODY_ABOARD");
  await answerCrew(deps, { id: crew.id, handle: "oto", wallet: OTO, answer: "accept" });
  assert.equal((await crewSharesFor(deps, { id: crew.id, ...at, creator: ADA })).code, "WRONG_CREATOR");
  assert.equal((await crewSharesFor(deps, { id: crew.id, ...at, preset: "protected" })).code, "INVALID");
  assert.equal((await crewSharesFor(deps, { id: crew.id, ...at, symbol: "KITE2" })).code, "INVALID");
  assert.equal((await crewSharesFor(deps, { id: crew.id, ...at, name: "Kite Two" })).code, "INVALID", "the crew said yes to this name");
  assert.equal((await crewSharesFor(depsOf(store, "mainnet"), { id: crew.id, ...at })).code, "CLOSED");
  const aboard = await crewSharesFor(deps, { id: crew.id, ...at, symbol: "$kite" });
  assert.deepEqual(aboard.shares, [{ address: CREATOR, bps: 8500 }, { address: OTO, bps: 1500 }], "ada's part, never accepted, stays the creator's");

  /* A yes taken back after the build: the submit refuses to hold, nothing goes. */
  await answerCrew(deps, { id: crew.id, handle: "oto", wallet: OTO, answer: "decline" });
  const iso = new Date(NOW).toISOString();
  assert.equal((await holdCrew(store, "devnet", { id: crew.id, token: MINT, shares: aboard.shares, at: iso })).code, "CHANGED");
  await answerCrew(deps, { id: crew.id, handle: "oto", wallet: OTO, answer: "accept" });
  const held = await holdCrew(store, "devnet", { id: crew.id, token: MINT, shares: aboard.shares, at: iso });
  assert.deepEqual(held, { ok: true, fresh: true });
  assert.deepEqual(await holdCrew(store, "devnet", { id: crew.id, token: MINT, shares: aboard.shares, at: iso }), { ok: true, fresh: false }, "the same submit again");
  assert.equal((await holdCrew(store, "devnet", { id: crew.id, token: "So11111111111111111111111111111111111111112", shares: aboard.shares, at: iso })).code, "LAUNCHED", "one crew, one launch");
  assert.equal((await crewSharesFor(deps, { id: crew.id, ...at })).code, "LAUNCHED");
  assert.equal((await answerCrew(deps, { id: crew.id, handle: "oto", wallet: OTO, answer: "decline" })).code, "LAUNCHED", "held: nobody answers it");
  /* A refused send lets it go — and only that token's hold. */
  await releaseCrew(store, "devnet", crew.id, "So11111111111111111111111111111111111111112");
  assert.equal((await crewSharesFor(deps, { id: crew.id, ...at })).code, "LAUNCHED");
  await releaseCrew(store, "devnet", crew.id, MINT);
  assert.equal((await crewSharesFor(deps, { id: crew.id, ...at })).ok, true);
  await holdCrew(store, "devnet", { id: crew.id, token: MINT, shares: aboard.shares, at: iso });

  /* On the scene only once the vault holds the creator role, with the members the vault pays. */
  const launches = store.collection("launches");
  await launches.set(launchKey("devnet", MINT), { creator: CREATOR, feeSharing: { state: "PENDING", shares: aboard.shares } });
  assert.deepEqual(await readFlyingCrews(deps), [], "a pending sharing flies the creator alone");
  await launches.set(launchKey("devnet", MINT), { creator: CREATOR, feeSharing: { state: "SHARED", shares: aboard.shares } });
  const [flying] = await readFlyingCrews(deps);
  assert.deepEqual(flying.members, [{ wallet: OTO, bps: 1500 }], "the vault's own rows, by wallet — never a handle");
  assert.equal("creatorHandle" in flying, false);
  assert.equal(flying.creatorBps, 8500);
  assert.equal(flying.window, "2026-10-25T20:00Z");
});

test("the build takes a crew only by its id and never with rows of the request; the routes prove each wallet as a mutation", () => {
  const flow = readFileSync(new URL("./flow.server.ts", import.meta.url), "utf8");
  assert.match(flow, /if \(input\.crew !== undefined\) return fail\("SHARES_INVALID", "A crew's launch takes its rows from the crew, not the request\."\)/);
  assert.match(flow, /crewSharesFor\(/);
  assert.match(flow, /const held = await holdCrew\([\s\S]*?if \(!held\.ok\) return fail\("SHARES_INVALID"[\s\S]*?const refused = await claimAttempt\(deps, build\)/, "held before anything is counted or sent");
  assert.match(flow, /if \(sent\.outcome === "REJECTED" \|\| sent\.outcome === "FAILED"\) \{[\s\S]*?if \(heldCrew && build\.crew\) await releaseCrew\(/, "a refused send lets the crew go");
  const venue = readFileSync(new URL("../core/venues/meteora-dbc/launch.server.ts", import.meta.url), "utf8");
  assert.match(venue, /options\.crew === true && \(preset\.id === "classic" \|\| preset\.id === "protected"\)/);
  for (const route of ["../../app/api/v1/launch/crews/route.ts", "../../app/api/v1/launch/crews/[id]/answer/route.ts"]) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    assert.match(source, /requireWalletProof\(request, "mutation"\)/, route);
    assert.match(source, /crewOpenOn\(deps\.network\.cluster\)/, route);
  }
  assert.match(readFileSync(new URL("../../app/api/v1/launch/crews/route.ts", import.meta.url), "utf8"), /proof\.address !== read\.body\.creator/);
});
