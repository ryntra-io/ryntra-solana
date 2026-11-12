// Run from repo root: node --test city/lib/arena/hack/ranges/ranges.test.mjs
/*
 * CITY-238: an order's checks as data, the ranges they are kept in, the deployment's own training ranges and the known
 * moves on them. No engine is needed here: a check is run against accounts as an engine would hand them over. The same
 * ranges on LiteSVM, on a machine with no network, are `../machine/check.mjs` and the stand.
 */
import "../../../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { checkSpecIssue, checksIssue, invariantOf, invariantsOf, CHECKS_MAX } = await import("./checks.ts");
const { createRangeStore, rangeIssue, readyRange, RANGE_ENGINE } = await import("./range.ts");
const { catalogue } = await import("./catalogue.ts");
const { RECORDED } = await import("./recorded.ts");
const { practiceMoves } = await import("./practice.ts");
const { createCopyActors } = await import("../runner/assemble.ts");
const sb = await import("../sandbox/index.ts");

const A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const account = (data, lamports = 1_000n) => ({ address: A, owner: B, lamports, data: Uint8Array.from(data), executable: false });
const reading = (found) => (address) => (address === A ? found : null);

test("a check is data of three kinds; anything else does not read", () => {
  const bytes = { kind: "bytes-equal", id: "authority", version: "1", address: A, offset: 2, hex: "0a0b" };
  const amount = { kind: "u64-at-least", id: "vault-holds", version: "1", address: A, offset: 0, min: "1000" };
  const lamports = { kind: "lamports-at-least", id: "treasury", version: "2", address: A, min: "5" };
  for (const check of [bytes, amount, lamports]) assert.equal(checkSpecIssue(check), null, check.kind);
  assert.equal(checksIssue([bytes, amount, lamports]), null);

  assert.match(checkSpecIssue({ ...bytes, kind: "run-this-code" }), /kind is/);
  assert.match(checkSpecIssue({ ...bytes, hex: "0A0B" }), /lowercase hex/);
  assert.match(checkSpecIssue({ ...bytes, hex: "abc" }), /lowercase hex/);
  assert.match(checkSpecIssue({ ...bytes, offset: -1 }), /offset/);
  assert.match(checkSpecIssue({ ...bytes, code: "() => true" }), /kind, id, version/, "no field a check does not have");
  assert.match(checkSpecIssue({ ...amount, min: "18446744073709551616" }), /u64/);
  assert.match(checkSpecIssue({ ...amount, min: 1000 }), /u64/);
  assert.match(checkSpecIssue({ ...lamports, address: "not an address" }), /address/);
  assert.match(checkSpecIssue({ ...lamports, id: "has spaces" }), /id and a version/);
  assert.match(checkSpecIssue(null), /object/);
  assert.match(checksIssue([]), /1…/);
  assert.match(checksIssue(Array.from({ length: CHECKS_MAX + 1 }, (_x, i) => ({ ...lamports, id: `c${i}` }))), /1…/);
  assert.match(checksIssue([bytes, { ...bytes }]), /twice/);
  assert.throws(() => invariantsOf([{ ...bytes, kind: "x" }]), TypeError);
});

test("a check only reads the copy: it holds, it does not hold, and an account that is gone or too short does not hold", () => {
  const bytes = invariantOf({ kind: "bytes-equal", id: "authority", version: "1", address: A, offset: 2, hex: "0a0b" });
  assert.deepEqual([bytes.id, bytes.version], ["authority", "1"]);
  assert.equal(bytes.holds(reading(account([0, 0, 10, 11, 0]))), true);
  assert.equal(bytes.holds(reading(account([0, 0, 10, 12, 0]))), false);
  assert.equal(bytes.holds(reading(account([0, 0, 10]))), false, "shorter than the slice");
  assert.equal(bytes.holds(reading(null)), false, "gone");

  const amount = invariantOf({ kind: "u64-at-least", id: "vault-holds", version: "1", address: A, offset: 1, min: "1000000000000" });
  const u64 = (value) => {
    const out = Buffer.alloc(9);
    out.writeBigUInt64LE(value, 1);
    return [...out];
  };
  assert.equal(amount.holds(reading(account(u64(1_000_000_000_000n)))), true);
  assert.equal(amount.holds(reading(account(u64(18_446_744_073_709_551_615n)))), true, "the whole u64, not a float");
  assert.equal(amount.holds(reading(account(u64(999_999_999_999n)))), false);
  assert.equal(amount.holds(reading(account([1, 2, 3]))), false);

  const lamports = invariantOf({ kind: "lamports-at-least", id: "treasury", version: "1", address: A, min: "1000" });
  assert.equal(lamports.holds(reading(account([], 1_000n))), true);
  assert.equal(lamports.holds(reading(account([], 999n))), false);
  assert.equal(lamports.holds(reading(null)), false);
});

test("a range is found by its order's target and by exactly its own pin; two ranges never share a target", () => {
  const [usdc, vault] = RECORDED;
  const store = createRangeStore([usdc, vault]);
  assert.equal(store.forTarget(usdc.target).id, "usdc-mint");
  assert.equal(store.forTarget({ ...usdc.target, slot: usdc.target.slot + 1 }), null);
  assert.equal(store.forTarget({ kind: "devnet", program: usdc.target.program }), null, "only a fork has a range");
  const range = store.forTarget(vault.target);
  assert.equal(store.forPin(range.pin).id, "open-multisig");
  assert.equal(store.forPin({ ...range.pin, stateHash: "0".repeat(64) }), null, "another state under the same target is not this range");
  assert.equal(store.forPin({ ...range.pin, engine: { id: "litesvm", version: "0.0.1" } }), null, "another engine is not this range");
  assert.deepEqual(range.claim, { invariant: "vault-holds", version: "1" });
  assert.equal(range.pin.engine.id, RANGE_ENGINE.id);
  assert.throws(() => createRangeStore([usdc, { ...vault, id: "other", target: usdc.target, snapshot: { ...vault.snapshot, slot: usdc.target.slot } }]), /share the target/);

  assert.equal(rangeIssue(usdc), null);
  assert.match(rangeIssue({ ...usdc, target: { kind: "devnet", program: usdc.target.program } }), /fork/);
  assert.match(rangeIssue({ ...usdc, target: { ...usdc.target, slot: 1 } }), /another slot/);
  assert.match(rangeIssue({ ...usdc, checks: [] }), /checks/);
  assert.match(rangeIssue({ ...usdc, snapshot: { ...usdc.snapshot, source: { kind: "recorded", label: "see https://example.com", recordedAt: "now" } } }), /URL/);
  assert.throws(() => readyRange({ ...usdc, title: "" }), TypeError);
});

test("the deployment's training ranges: three, on the engine's own token program, each with the pin it was recorded with", () => {
  const ranges = catalogue().list();
  assert.deepEqual(ranges.map((r) => r.id), ["usdc-mint", "open-multisig", "council-review"]);
  // The pins the machine's image and the stand were checked with: a changed byte of a recorded state changes these.
  assert.deepEqual(ranges.map((r) => r.pin.stateHash.slice(0, 16)), ["8a3eac39093e766d", "3cec46029ca37599", "b4501c04d565b1b1"]);
  for (const range of ranges) {
    assert.equal(range.target.program, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    assert.deepEqual(range.pin.engine, { id: "litesvm", version: "1.6.2" });
    assert.deepEqual(range.snapshot.programs, [], "the token program comes with the engine: no bytes are carried");
    assert.equal(sb.checkSnapshot(range.snapshot), null);
    assert.equal(sb.snapshotMatches(range.snapshot, range.pin), true);
    assert.equal(catalogue().forPin(range.pin), range);
    assert.equal(catalogue().forTarget(range.target), range);
  }
  const [usdc, vault, review] = ranges;
  assert.match(usdc.snapshot.source.label, /mainnet/);
  // A practice vault says what it is: made for training, not a recording of mainnet.
  for (const practice of [vault, review]) assert.match(practice.snapshot.source.label, /practice range.*not recorded from mainnet/);

  // In the recorded copies: the honest range and the practice vault hold their checks; the review range's does not.
  const holdsAtPin = (range) => {
    const accounts = new Map(sb.snapshotAccounts(range.snapshot).map((a) => [a.address, a]));
    return range.invariants.map((check) => check.holds((address) => accounts.get(address) ?? null));
  };
  assert.deepEqual(holdsAtPin(usdc), [true, true]);
  assert.deepEqual(holdsAtPin(vault), [true]);
  assert.deepEqual(holdsAtPin(review), [false], "a check its own copy does not meet: the judge cannot decide, the owner does");
});

test("the recorded states are what record.mjs writes: the same bytes every time", async () => {
  const { renderRecorded } = await import("./record.mjs");
  const kept = readFileSync(fileURLToPath(new URL("./recorded.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  assert.equal(renderRecorded(), kept);
  assert.equal(renderRecorded(), renderRecorded());
});

test("the known moves: each range's move is put together and signed for the run's own payer", () => {
  const actors = createCopyActors(1, [new Uint8Array(32).fill(3)]);
  for (const range of catalogue().list()) {
    const moves = practiceMoves(range, actors.addresses[0]);
    assert.ok(moves, range.id);
    assert.ok(range.watch.includes(moves.inspect));
    assert.equal(moves.finding.target.program, range.target.program);
    assert.ok(range.watch.includes(moves.finding.target.account), "the finding points inside the order's scope");
    const built = actors.assemble(moves.exploit[0].instructions);
    assert.equal(built.ok, true, `${range.id}: ${built.detail ?? ""}`);
    assert.equal(sb.parseInput(built.input).kind, "tx");
    assert.equal(moves.undecided === true, range.id === "council-review");
  }
  assert.equal(practiceMoves({ id: "unknown", target: { kind: "fork", program: A, slot: 1 }, watch: [] }, actors.addresses[0]), null);
});
