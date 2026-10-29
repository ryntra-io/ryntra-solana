import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { resolveInboxLink } from "../monitoring/inbox.ts";
import { listInbox, outboxOf, preferencesOf } from "../monitoring/store.ts";
import { launchNetwork } from "./config.server.ts";
import { creatorNoteWords, holderMark, noteLaunch, runCreatorNotes } from "./creator-notes.server.ts";

const CREATOR = "D6qfb7KivAR1RUHQSWqvyNejxmbft7bq4u3dos8yKwgU";
const OTHER = "Fb2AbDwuQ4yNvmQRK7bTZWXoDZRE3AYLcqamPyhg4tL8";
const TOKEN = "4JVXtA1x8h3bF4m4rjmVw5yTQXgMzGv7z9jMkGk5QRLa";
const NOW = Date.parse("2026-10-19T18:00:00.000Z");
const network = launchNetwork({});

const record = (over = {}) => ({
  cluster: "mainnet",
  state: "LAUNCHED",
  token: TOKEN,
  pool: "7UNrdHXvsj9yRZd1Ld1t1bQZgqZ7xR6aXJ2XWdmGfMtD",
  config: "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G",
  pairMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  preset: "protected",
  creator: CREATOR,
  name: "Stair",
  symbol: "STAIR",
  metadataUri: "https://ryntra.io/api/launch/metadata/x",
  signature: "sig",
  validUntil: "0",
  firstBuyInRaw: "0",
  firstBuyOutRaw: "0",
  lock: null,
  buildId: "b",
  referralCode: null,
  launchedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
  ...over,
});

/** The creator's fees as the chain counts them: the curve's unclaimed counter alone, unshared. */
const fees = ({ unclaimed = "0", migrated = false, graduatedAt = null } = {}) => ({
  token: TOKEN,
  pool: "p",
  config: "c",
  pairMint: "m",
  roleOwner: CREATOR,
  migrated,
  reserveRaw: "0",
  graduatedAt,
  graduated: null,
  sharing: null,
  read: {
    roleOwner: CREATOR,
    curve: { totalTradingRaw: "0", creatorPct: 40, unclaimedRaw: unclaimed },
    graduation: { migrated, thresholdRaw: "0", feePct: 2, creatorPct: 40, withdrawn: true },
    lp: null,
    sharing: null,
  },
});

function deps(store, chain) {
  return { network, store, connection: null, now: () => new Date(chain.now ?? NOW), readFees: async () => chain.fees, readHolders: async () => chain.holders };
}

async function telegramOn(store, owner) {
  await preferencesOf(store).compareAndSet(`solana:mainnet:${owner}`, null, { version: 0, owner, inbox: true, telegram: true, push: false, quietHours: null, updatedAt: new Date(NOW).toISOString() });
}

test("the holder marks: the highest passed, nothing under ten", () => {
  assert.equal(holderMark(0), 0);
  assert.equal(holderMark(9), 0);
  assert.equal(holderMark(10), 10);
  assert.equal(holderMark(99), 50);
  assert.equal(holderMark(12_000), 10_000);
});

test("a launch's notes: launched once; a holder mark only when passed after the first read; graduation once; fees from $1, again only after a claim", async () => {
  const store = createMemoryGuardStore();
  await telegramOn(store, CREATOR);
  const chain = { holders: 12, fees: fees() };
  /* First read: the launch is news; 12 holders already stand — not news. */
  assert.deepEqual((await noteLaunch(deps(store, chain), record())).wrote, ["launched"]);
  assert.deepEqual((await noteLaunch(deps(store, chain), record())).wrote, [], "a second pass writes nothing");
  chain.holders = 55;
  assert.deepEqual((await noteLaunch(deps(store, chain), record())).wrote, ["holders"]);
  chain.fees = fees({ unclaimed: "1000000" });
  assert.deepEqual((await noteLaunch(deps(store, chain), record())).wrote, ["fees"]);
  chain.fees = fees({ unclaimed: "3000000" });
  assert.deepEqual((await noteLaunch(deps(store, chain), record())).wrote, [], "still waiting to be taken: no second note");
  /* Claimed: what waits fell under half the threshold — the next $1 is news again. */
  chain.fees = fees({ unclaimed: "100000" });
  await noteLaunch(deps(store, chain), record());
  chain.fees = fees({ unclaimed: "1200000", migrated: true, graduatedAt: Math.floor(NOW / 1000) - 600 });
  assert.deepEqual((await noteLaunch(deps(store, chain), record())).wrote, ["graduated", "fees"]);

  const notes = await listInbox(store, CREATOR);
  assert.equal(notes.length, 5);
  for (const note of notes) {
    assert.equal(note.subject.kind, "launch-creator");
    assert.doesNotMatch(`${note.text.en.reason} ${note.text.uk.reason}`, /\$\d/, "never an amount on a lock screen");
  }
  assert.equal(await resolveInboxLink(store, CREATOR, notes[0].id), "/app/launch/mine?from=monitoring");
  const outbox = (await outboxOf(store).valuesWithPrefix("")).filter((row) => row.owner === CREATOR);
  assert.equal(outbox.length, 5, "each note once to Telegram, where the wallet connected it");
  assert.ok(outbox.every((row) => row.channel === "telegram"), "no push until the phone opens these notes");
});

test("an old launch, an old graduation and a first read of many holders send nothing; a read that failed is said as unread", async () => {
  const store = createMemoryGuardStore();
  const chain = { holders: 300, fees: fees({ migrated: true, graduatedAt: Math.floor(NOW / 1000) - 5 * 24 * 3600 }) };
  const old = record({ launchedAt: new Date(NOW - 10 * 24 * 3600 * 1000).toISOString() });
  assert.deepEqual((await noteLaunch(deps(store, chain), old)).wrote, []);
  assert.equal((await listInbox(store, CREATOR)).length, 0);
  const failed = await noteLaunch({ ...deps(store, chain), readFees: async () => { throw new Error("node down"); }, readHolders: async () => null }, old);
  assert.deepEqual(failed.unread, ["holders", "fees"]);
});

test("shared fees: each wallet with a part gets its own fees note", async () => {
  const store = createMemoryGuardStore();
  const shared = {
    ...fees({ unclaimed: "4000000" }),
    roleOwner: "VAULT1111111111111111111111111111111111111",
    sharing: { vault: "VAULT1111111111111111111111111111111111111", totalShare: 2, fundedRaw: "0", feePerShare: "0", users: [{ address: CREATOR, share: 1, claimedRaw: "0", checkpoint: "0" }, { address: OTHER, share: 1, claimedRaw: "0", checkpoint: "0" }] },
  };
  shared.read = { ...shared.read, roleOwner: shared.roleOwner, sharing: { vault: shared.roleOwner, totalShare: 2, fundedRaw: "0", feePerShare: "0", users: shared.sharing.users } };
  const old = record({ launchedAt: new Date(NOW - 10 * 24 * 3600 * 1000).toISOString() });
  assert.deepEqual((await noteLaunch(deps(store, { holders: 1, fees: shared }), old)).wrote, ["fees", "fees"]);
  assert.equal((await listInbox(store, OTHER)).length, 1);
});

test("a pass reads a few launches from where the last stopped", async () => {
  const store = createMemoryGuardStore();
  const tokens = ["A", "B", "C"].map((letter) => `${letter}${TOKEN.slice(1)}`);
  const old = new Date(NOW - 10 * 24 * 3600 * 1000).toISOString();
  for (const token of tokens) await store.collection("launches").set(`solana:mainnet:${token}`, record({ token, launchedAt: old }));
  const chain = { holders: 1, fees: fees() };
  const first = await runCreatorNotes(deps(store, chain), { budgetMs: 10_000, launches: 2 });
  assert.deepEqual(first.map((step) => step.token), tokens.slice(0, 2));
  const second = await runCreatorNotes(deps(store, chain), { budgetMs: 10_000, launches: 2 });
  assert.deepEqual(second.map((step) => step.token), [tokens[2], tokens[0]]);
  /* The young launches have their own turn in every pass, and the rest keep theirs. */
  const youngTokens = ["P", "Q", "R"].map((letter) => `${letter}${TOKEN.slice(1)}`);
  for (const token of youngTokens) await store.collection("launches").set(`solana:mainnet:${token}`, record({ token }));
  const third = await runCreatorNotes(deps(store, chain), { budgetMs: 10_000, launches: 2 });
  assert.deepEqual(third.map((step) => step.token), [youngTokens[0], youngTokens[1], tokens[1], tokens[2]]);
  const fourth = await runCreatorNotes(deps(store, chain), { budgetMs: 10_000, launches: 2 });
  assert.deepEqual(fourth.map((step) => step.token), [youngTokens[2], youngTokens[0], tokens[0], tokens[1]], "the third young launch gets its turn next pass");
});

test("the words: the token's symbol and what happened, in both languages", () => {
  const words = creatorNoteWords("holders", "STAIR", 100);
  assert.equal(words.uk.reason, "У $STAIR уже 100 власників");
  assert.equal(creatorNoteWords("fees", "ST<b>AIR").en.reason, "Your fees from $STbAIR are ready to claim");
});
