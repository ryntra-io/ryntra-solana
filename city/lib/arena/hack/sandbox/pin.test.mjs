// Run from repo root: node --test city/lib/arena/hack/sandbox/pin.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { sb, toy, makeSnapshot, pinFor, TARGET, SLOT, PROGRAM, VAULT, PROTOCOL } from "./fixtures.mjs";

test("a recorded snapshot pins to one hash set the run is held to", () => {
  const snapshot = makeSnapshot();
  const pin = pinFor(snapshot);
  assert.equal(sb.checkPin(pin), null);
  assert.equal(sb.checkPin(pin, TARGET), null);
  assert.equal(sb.snapshotMatches(snapshot, pin), true);
  assert.deepEqual(pin.target, TARGET);
  assert.deepEqual(pin.clock, { slot: SLOT, unixTimestamp: snapshot.unixTimestamp });
  assert.deepEqual(pin.engine, { id: "toy", version: "1" });
  assert.equal(pin.programs.length, 1);
  assert.equal(pin.programs[0].address, PROGRAM);
});

test("the same snapshot pins the same; one byte of one account, or the clock, is another pin", () => {
  const a = pinFor(makeSnapshot());
  const b = pinFor(makeSnapshot());
  assert.equal(sb.pinHash(a), sb.pinHash(b));

  const changed = makeSnapshot();
  const vault = { ...changed.accounts[0], data: toy.toyData({ t: "vault", supply: 1_000_001, accounts: [changed.accounts[1].address] }) };
  const other = { ...changed, accounts: [vault, changed.accounts[1]] };
  assert.notEqual(pinFor(other).stateHash, a.stateHash);
  assert.equal(sb.snapshotMatches(other, a), false);

  const later = makeSnapshot({ unixTimestamp: makeSnapshot().unixTimestamp + 1 });
  assert.equal(sb.snapshotMatches(later, a), false);

  const lamports = makeSnapshot();
  const richer = { ...lamports, accounts: [{ ...lamports.accounts[0], lamports: "1000000001" }, lamports.accounts[1]] };
  assert.equal(sb.snapshotMatches(richer, a), false);
});

test("the state hash does not depend on the order accounts are listed in, and an empty account does not exist", () => {
  const rows = [
    { address: VAULT, owner: PROGRAM, lamports: 5n, data: new Uint8Array([1, 2]), executable: false },
    { address: PROTOCOL, owner: PROGRAM, lamports: 7n, data: new Uint8Array([3]), executable: false },
  ];
  const ghost = { address: TARGET.program, owner: PROGRAM, lamports: 0n, data: new Uint8Array([9]), executable: false };
  assert.equal(sb.accountsHash(rows), sb.accountsHash([...rows].reverse()));
  assert.equal(sb.accountsHash(rows), sb.accountsHash([...rows, ghost]));
});

test("only a fork is pinned: a devnet deploy is a live network, not a copy", () => {
  assert.throws(() => sb.pinOf(makeSnapshot(), { kind: "devnet", program: PROGRAM }, toy.TOY_ENGINE), /only a mainnet fork/);
  const pin = pinFor();
  assert.equal(sb.checkPin({ ...pin, target: { kind: "devnet", program: PROGRAM } }).code, "NOT_A_FORK");
  assert.equal(sb.checkPin(pin, { kind: "devnet", program: PROGRAM }).code, "NOT_A_FORK");
});

test("a snapshot recorded at another slot is not the target's copy", () => {
  assert.throws(() => sb.pinOf(makeSnapshot({ slot: SLOT + 1 }), TARGET, toy.TOY_ENGINE), /recorded at slot/);
  assert.equal(sb.checkPin(pinFor(), { ...TARGET, slot: SLOT + 1 }).code, "PIN_MISMATCH");
  assert.equal(sb.checkPin(pinFor(), { ...TARGET, program: VAULT }).code, "PIN_MISMATCH");
  assert.equal(sb.checkPin({ ...pinFor(), clock: { slot: SLOT + 1, unixTimestamp: 1 } }).code, "BAD_PIN");
});

test("a snapshot is recorded, never fetched: a URL, a duplicate, an empty account or loose base64 is refused", () => {
  const url = makeSnapshot({ source: { kind: "recorded", label: "https://api.mainnet-beta.solana.com", recordedAt: "2026-11-08" } });
  assert.match(sb.checkSnapshot(url).detail, /URL/);
  const live = makeSnapshot({ source: { kind: "live", label: "mainnet", recordedAt: "now" } });
  assert.equal(sb.checkSnapshot(live).code, "BAD_SNAPSHOT");
  const s = makeSnapshot();
  assert.match(sb.checkSnapshot({ ...s, accounts: [s.accounts[0], s.accounts[0]] }).detail, /twice/);
  assert.match(sb.checkSnapshot({ ...s, accounts: [{ ...s.accounts[0], lamports: "0" }] }).detail, /lamports/);
  assert.match(sb.checkSnapshot({ ...s, accounts: [{ ...s.accounts[0], data: "AAA" }] }).detail, /base64/);
  assert.match(sb.checkSnapshot({ ...s, accounts: [{ ...s.accounts[0], lamports: "18446744073709551616" }] }).detail, /lamports/);
  assert.equal(sb.checkSnapshot(s), null);
});

test("a pin's fields are checked: hashes, sorted programs, engine", () => {
  const pin = pinFor();
  assert.equal(sb.checkPin({ ...pin, stateHash: "nope" }).code, "BAD_PIN");
  assert.equal(sb.checkPin({ ...pin, engine: { id: "toy" } }).code, "BAD_PIN");
  assert.equal(sb.checkPin({ ...pin, programs: [pin.programs[0], pin.programs[0]] }).code, "BAD_PIN");
  assert.equal(sb.checkPin({ ...pin, format: "other" }).code, "BAD_PIN");
  assert.equal(sb.checkPin(null).code, "BAD_PIN");
});
