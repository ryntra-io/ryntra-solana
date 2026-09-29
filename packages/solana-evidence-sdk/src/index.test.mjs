import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXAMPLE_CAUTIOUS_POLICY,
  SOLANA_EVIDENCE_KIT_LIMITATIONS,
  SPL_TRANSFER_ACTION_REF,
  inspectSolanaMint,
  preflightSolanaAction,
  verifySolanaReceipt,
} from "./index.ts";

/**
 * The fixtures are the bytes a real mainnet RPC returned, captured by
 * `scripts/solana-check.mjs`. Serving them through a stubbed `fetch` exercises
 * the real transport, the real decoder and the real passport builder — the
 * only thing that is fake is the network, which is the one thing a test may
 * not depend on.
 */
function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`../../../lib/solana/fixtures/${name}.json`, import.meta.url), "utf8"),
  );
}

function stubRpc(raw, { onRequest } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(init.body);
    onRequest?.(body);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: raw === null
          ? { context: { apiVersion: "2.1.0", slot: 1 }, value: null }
          : {
              context: { apiVersion: "2.1.0", slot: Number(raw.slot) },
              value: {
                data: [raw.dataBase64, "base64"],
                executable: false,
                lamports: 1_000_000,
                owner: raw.owner,
                rentEpoch: 0,
                space: 0,
              },
            },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}

test("inspectSolanaMint returns the passport a real PYUSD account produces", async function () {
  const raw = fixture("pyusd-t22");
  const restore = stubRpc(raw);
  try {
    const result = await inspectSolanaMint(raw.mint, { network: "mainnet" });
    assert.equal(result.ok, true);
    assert.equal(result.passport.identity.mint, raw.mint);
    assert.equal(result.passport.identity.programKind, "TOKEN_2022");
    const kinds = result.passport.extensions.map((extension) => extension.kind);
    assert.ok(kinds.includes("PermanentDelegate"), "PYUSD carries a permanent delegate");
    assert.ok(kinds.includes("TransferFeeConfig"));
    /* Every fact carries how it is known, which is the point of a passport. */
    for (const extension of result.passport.extensions) {
      assert.ok(extension.meaning.length > 0);
      assert.ok(typeof extension.affectsTransfers === "boolean");
    }
  } finally {
    restore();
  }
});

test("a plain SPL mint reads as SPL_TOKEN with no extensions", async function () {
  const raw = fixture("usdc-spl");
  const restore = stubRpc(raw);
  try {
    const result = await inspectSolanaMint(raw.mint, { network: "mainnet" });
    assert.equal(result.ok, true);
    assert.equal(result.passport.identity.programKind, "SPL_TOKEN");
    assert.deepEqual(result.passport.extensions, []);
  } finally {
    restore();
  }
});

test("an account that is not a mint is refused with its reason, never guessed at", async function () {
  const raw = fixture("not-a-mint");
  const restore = stubRpc(raw);
  try {
    const result = await inspectSolanaMint(raw.mint, { network: "mainnet" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_A_MINT");
    assert.match(result.reason, /is not a mint/);
  } finally {
    restore();
  }
});

test("a missing account is ACCOUNT_NOT_FOUND rather than an empty passport", async function () {
  const restore = stubRpc(null);
  try {
    const result = await inspectSolanaMint("So11111111111111111111111111111111111111112", {
      network: "devnet",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "ACCOUNT_NOT_FOUND");
  } finally {
    restore();
  }
});

test("preflight over PYUSD is BLOCKED and names the powers the policy refuses", async function () {
  const raw = fixture("pyusd-t22");
  const restore = stubRpc(raw);
  try {
    const result = await preflightSolanaAction({
      input: {
        schemaVersion: "1.0.0",
        actionRef: SPL_TRANSFER_ACTION_REF,
        network: "mainnet",
        mint: raw.mint,
        sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
        amountRaw: "1000000",
      },
      policy: EXAMPLE_CAUTIOUS_POLICY,
      now: new Date(raw.observedAt),
    });
    assert.equal(result.ok, true);
    assert.equal(result.verdict.verdict, "BLOCKED");
    const rules = result.verdict.findings
      .filter((finding) => finding.outcome === "BLOCKED")
      .map((finding) => finding.rule);
    assert.deepEqual(rules, ["PERMANENT_DELEGATE_ACCEPTED"]);
    /* PYUSD carries the TransferHook extension with the all-zero program id,
       which is how the token program stores "no hook". The distinction is the
       whole reason this rule reads the preflight's resolved program rather
       than the extension's presence: a listed power that cannot run is not a
       blocker, and calling it one would be a false refusal. */
    assert.equal(result.preflight.hookProgramId, null);
    const hook = result.verdict.findings.find((finding) => finding.rule === "TRANSFER_HOOK_ALLOWLISTED");
    assert.equal(hook.outcome, "ALLOWED");
    assert.match(hook.detail, /No transfer-hook program runs/);
    /* The floor of the verdict ladder is never the word this product refuses. */
    assert.ok(!JSON.stringify(result.verdict).includes("SAFE"));
  } finally {
    restore();
  }
});

test("a real transfer fee reduces what the recipient receives, to the mint's own rule", async function () {
  const raw = fixture("bern-t22");
  const restore = stubRpc(raw);
  try {
    const result = await preflightSolanaAction({
      input: {
        schemaVersion: "1.0.0",
        actionRef: SPL_TRANSFER_ACTION_REF,
        network: "mainnet",
        mint: raw.mint,
        sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
        amountRaw: "1000000",
      },
      policy: EXAMPLE_CAUTIOUS_POLICY,
      now: new Date(raw.observedAt),
    });
    assert.equal(result.ok, true);
    const { transferFee, estimatedReceivedRaw, amountRequestedRaw } = result.preflight;
    assert.ok(transferFee.basisPoints > 0, "the BERN fixture carries a real fee config");
    assert.equal(
      BigInt(estimatedReceivedRaw),
      BigInt(amountRequestedRaw) - BigInt(transferFee.feeRaw),
      "what arrives is what was sent minus the mint's own fee",
    );
    /* Which of the two epoch configs produced the number is data, not a
       hidden default — a later reader can tell the fee apart from the guess. */
    assert.ok(["NEWER", "OLDER"].includes(transferFee.configUsed));
  } finally {
    restore();
  }
});

test("preflight reads the network the proposal names, not the connection's default", async function () {
  const raw = { ...fixture("usdc-spl"), network: "devnet" };
  const seen = [];
  const restore = stubRpc(raw);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    seen.push(String(input));
    return originalFetch(input, init);
  };
  try {
    const result = await preflightSolanaAction({
      input: {
        schemaVersion: "1.0.0",
        actionRef: SPL_TRANSFER_ACTION_REF,
        network: "devnet",
        mint: raw.mint,
        sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
        amountRaw: "1000000",
      },
      policy: EXAMPLE_CAUTIOUS_POLICY,
      connection: { network: "mainnet" },
      now: new Date(raw.observedAt),
    });
    assert.equal(result.ok, true);
    assert.equal(result.preflight.network, "devnet");
    assert.ok(seen.every((url) => url.includes("devnet")), `read the wrong endpoint: ${seen.join(", ")}`);
  } finally {
    restore();
  }
});

test("a malformed proposal is refused before any network read happens", async function () {
  let requested = false;
  const restore = stubRpc(fixture("usdc-spl"), { onRequest: () => { requested = true; } });
  try {
    const result = await preflightSolanaAction({
      input: {
        schemaVersion: "1.0.0",
        actionRef: SPL_TRANSFER_ACTION_REF,
        network: "mainnet",
        mint: "not-a-base58-mint",
        sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
        amountRaw: "1000000",
      },
      policy: EXAMPLE_CAUTIOUS_POLICY,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_INPUT");
    assert.equal(requested, false, "a rejected proposal still hit the network");
  } finally {
    restore();
  }
});

test("a fractional amount cannot even be expressed — raw base units only", async function () {
  const result = await preflightSolanaAction({
    input: {
      schemaVersion: "1.0.0",
      actionRef: SPL_TRANSFER_ACTION_REF,
      network: "mainnet",
      mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
      amountRaw: "1.5",
    },
    policy: EXAMPLE_CAUTIOUS_POLICY,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_INPUT");
});

test("an invalid policy is refused as a policy problem, not as an evidence problem", async function () {
  const result = await preflightSolanaAction({
    input: {
      schemaVersion: "1.0.0",
      actionRef: SPL_TRANSFER_ACTION_REF,
      network: "mainnet",
      mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
      amountRaw: "1000000",
    },
    policy: { ...EXAMPLE_CAUTIOUS_POLICY, allowedNetworks: [] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_POLICY");
});

test("verifySolanaReceipt reaches no network and refuses anything that is not a receipt", function () {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("verifySolanaReceipt made a network call");
  };
  try {
    const result = verifySolanaReceipt({ kind: "ACTION_PASSPORT" });
    assert.equal(result.recognised, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("the kit states its own boundary, and the boundary says what it cannot do", function () {
  assert.equal(SOLANA_EVIDENCE_KIT_LIMITATIONS.length, 3);
  assert.match(SOLANA_EVIDENCE_KIT_LIMITATIONS[0], /READ-ONLY/);
  assert.ok(SOLANA_EVIDENCE_KIT_LIMITATIONS.some((line) => /not a safety judgement/.test(line)));
});
