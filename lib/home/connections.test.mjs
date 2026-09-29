import assert from "node:assert/strict";
import test from "node:test";

import {
  HOME_MAX_CONNECTIONS,
  addWatchConnection,
  emptyHomeConnectionState,
  parseHomeConnectionState,
  revokeConnection,
} from "./connections.ts";

const ownerRef = "owner_0123456789abcdef";
const evm = "0xAAbbccDDeeFf0011223344556677889900AaBbCc";
const solana = "11111111111111111111111111111111";
const stellar = "GA7QYNF7SOWQ3J4W6YIYVHZ3HIV4DNRQ6YRKFQAKQXCTAIW6HTVH2M3Q";

function add(state, draft, sequence = state.records.length + 1) {
  return addWatchConnection(state, draft, {
    id: `conn_${String(sequence).padStart(3, "0")}`,
    now: `2026-08-22T00:${String(sequence).padStart(2, "0")}:00.000Z`,
  });
}

test("a watch-only address stays user-declared read scope with no ownership or action authority", () => {
  const state = emptyHomeConnectionState(ownerRef);
  const result = add(state, {
    network: "EVM",
    address: evm,
    label: "Treasury watch",
    scopes: ["BALANCES", "POSITIONS"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.record, {
    id: "conn_001",
    kind: "WATCH_ONLY",
    state: "ACTIVE",
    network: "EVM",
    address: evm.toLowerCase(),
    label: "Treasury watch",
    scopes: ["BALANCES", "POSITIONS"],
    source: "USER_DECLARED",
    ownership: "UNPROVEN",
    authority: "NONE",
    storage: "THIS_BROWSER",
    createdAt: "2026-08-22T00:01:00.000Z",
    revokedAt: null,
  });
});

test("the exact supported address families validate without pretending to verify ownership", () => {
  let state = emptyHomeConnectionState(ownerRef);
  for (const [network, address, label] of [
    ["SOLANA", solana, "Solana read"],
    ["STELLAR", stellar, "Stellar read"],
  ]) {
    const result = add(state, {
      network,
      address,
      label,
      scopes: ["ASSET_EVIDENCE"],
    });
    assert.equal(result.ok, true, network);
    if (result.ok) state = result.state;
  }
  assert.equal(state.records.length, 2);
  assert.ok(state.records.every((record) => record.ownership === "UNPROVEN"));
  assert.ok(state.records.every((record) => record.authority === "NONE"));
});

test("malformed addresses, labels, scopes and control characters fail closed", () => {
  const state = emptyHomeConnectionState(ownerRef);
  const drafts = [
    { network: "EVM", address: "0x1234", label: "Bad", scopes: ["BALANCES"] },
    { network: "SOLANA", address: "O0Il", label: "Bad", scopes: ["BALANCES"] },
    { network: "STELLAR", address: stellar.slice(0, -1), label: "Bad", scopes: ["BALANCES"] },
    { network: "EVM", address: evm, label: "bad\u0000label", scopes: ["BALANCES"] },
    { network: "EVM", address: evm, label: "No scope", scopes: [] },
    { network: "EVM", address: evm, label: "Write", scopes: ["SIGN_TX"] },
  ];
  for (const draft of drafts) {
    assert.equal(add(state, draft).ok, false, JSON.stringify(draft));
  }
});

test("an active duplicate is refused and a revoked connection may be declared again as new history", () => {
  const first = add(emptyHomeConnectionState(ownerRef), {
    network: "EVM",
    address: evm,
    label: "Primary read",
    scopes: ["BALANCES"],
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const duplicate = add(first.state, {
    network: "EVM",
    address: evm.toUpperCase().replace("0X", "0x"),
    label: "Same account",
    scopes: ["ACTIVITY"],
  });
  assert.deepEqual(duplicate, { ok: false, error: "DUPLICATE_ACTIVE_CONNECTION" });

  const revoked = revokeConnection(first.state, first.record.id, "2026-08-22T01:00:00.000Z");
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  assert.equal(revoked.state.records[0].state, "REVOKED");
  assert.equal(revoked.state.records[0].revokedAt, "2026-08-22T01:00:00.000Z");

  const restored = add(revoked.state, {
    network: "EVM",
    address: evm,
    label: "Declared again",
    scopes: ["BALANCES"],
  }, 2);
  assert.equal(restored.ok, true);
  if (restored.ok) assert.equal(restored.state.records.length, 2);
});

test("the connection cap counts history so revocation cannot bypass the storage bound", () => {
  let state = emptyHomeConnectionState(ownerRef);
  for (let index = 0; index < HOME_MAX_CONNECTIONS; index += 1) {
    const address = `0x${index.toString(16).padStart(40, "0")}`;
    const result = add(state, {
      network: "EVM",
      address,
      label: `Watch ${index + 1}`,
      scopes: ["BALANCES"],
    }, index + 1);
    assert.equal(result.ok, true);
    if (result.ok) state = result.state;
  }
  assert.equal(state.records.length, HOME_MAX_CONNECTIONS);
  const overflow = add(state, {
    network: "EVM",
    address: "0xffffffffffffffffffffffffffffffffffffffff",
    label: "Overflow",
    scopes: ["BALANCES"],
  }, HOME_MAX_CONNECTIONS + 1);
  assert.deepEqual(overflow, { ok: false, error: "CONNECTION_LIMIT_REACHED" });
});

test("stored state rejects foreign owners, future schemas and authority inflation", () => {
  const active = add(emptyHomeConnectionState(ownerRef), {
    network: "EVM",
    address: evm,
    label: "Read",
    scopes: ["BALANCES"],
  });
  assert.equal(active.ok, true);
  if (!active.ok) return;

  assert.deepEqual(parseHomeConnectionState(active.state, "owner_foreign"), {
    ok: false,
    error: "FOREIGN_OWNER",
  });
  assert.deepEqual(
    parseHomeConnectionState({ ...active.state, schemaVersion: 2 }, ownerRef),
    { ok: false, error: "FUTURE_SCHEMA" },
  );
  assert.deepEqual(
    parseHomeConnectionState(
      {
        ...active.state,
        records: [{ ...active.state.records[0], authority: "SIGN_TX" }],
      },
      ownerRef,
    ),
    { ok: false, error: "INVALID_STATE" },
  );

  assert.deepEqual(
    parseHomeConnectionState(
      {
        ...active.state,
        records: [
          active.state.records[0],
          { ...active.state.records[0], id: "conn_002" },
        ],
      },
      ownerRef,
    ),
    { ok: false, error: "INVALID_STATE" },
  );
});
