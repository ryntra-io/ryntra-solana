import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { SPL_TRANSFER_ACTION_REF } from "../../lib/agent-control/adapters/solana-token-2022.ts";
import { createSolanaEvidenceMcpServer, SOLANA_MCP_MAX_RECEIPT_INPUT_BYTES } from "./src/server.ts";

const cwd = fileURLToPath(new URL("../..", import.meta.url));
const readmePath = fileURLToPath(new URL("./README.md", import.meta.url));
const documentedLauncherArgument = "packages/solana-evidence-mcp/src/stdio.ts";

const TOOL_NAMES = [
  "inspect_solana_mint",
  "preflight_solana_action",
  "verify_solana_receipt",
  "read_example_owner_policy",
];

function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`../../lib/solana/fixtures/${name}.json`, import.meta.url), "utf8"),
  );
}

function stubRpc(raw) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: JSON.parse(init.body).id,
      result: {
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
  return () => {
    globalThis.fetch = original;
  };
}

/**
 * The receipt fixtures were minted by the real Ryntra issuer path with a
 * throwaway key that was discarded, and each carries its own public key — so a
 * signature check here is the same computation an outside reader performs on a
 * real receipt, with nothing stubbed.
 */
const signedReceipt = fixture("receipt-solana-matched-signed");
const otherChainReceipt = fixture("receipt-other-chain-signed");
const tamperedReceipt = fixture("receipt-solana-tampered");

async function withInMemoryClient(run) {
  const server = createSolanaEvidenceMcpServer();
  const client = new Client({ name: "ryntra-solana-evidence-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function readOutput(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

test("the server advertises exactly four read-only tools and each declares it", async function () {
  await withInMemoryClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} is not marked read-only`);
      assert.equal(tool.annotations.destructiveHint, false);
      assert.ok(tool.description.length > 0);
    }
    /* Only the two that touch a mint reach outside this process. */
    const openWorld = tools.filter((tool) => tool.annotations.openWorldHint).map((tool) => tool.name).sort();
    assert.deepEqual(openWorld, ["inspect_solana_mint", "preflight_solana_action"]);
  });
});

test("inspect_solana_mint returns a passport with its limitations attached", async function () {
  const raw = fixture("pyusd-t22");
  const restore = stubRpc(raw);
  try {
    await withInMemoryClient(async (client) => {
      const result = await client.callTool({
        name: "inspect_solana_mint",
        arguments: { mint: raw.mint, network: "mainnet" },
      });
      assert.notEqual(result.isError, true);
      const output = readOutput(result);
      assert.equal(output.data.passport.identity.programKind, "TOKEN_2022");
      assert.ok(output.limitations.some((line) => /READ-ONLY/.test(line)));
    });
  } finally {
    restore();
  }
});

test("preflight_solana_action judges the mint against the example policy by default", async function () {
  const raw = fixture("pyusd-t22");
  const restore = stubRpc(raw);
  try {
    await withInMemoryClient(async (client) => {
      const result = await client.callTool({
        name: "preflight_solana_action",
        arguments: {
          input: {
            schemaVersion: "1.0.0",
            actionRef: SPL_TRANSFER_ACTION_REF,
            network: "mainnet",
            mint: raw.mint,
            sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
            recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
            amountRaw: "1000000",
          },
        },
      });
      assert.notEqual(result.isError, true);
      const output = readOutput(result);
      assert.equal(output.data.verdict.verdict, "BLOCKED");
      assert.ok(output.data.preflight.estimatedReceivedRaw.length > 0);
    });
  } finally {
    restore();
  }
});

test("verify_solana_receipt runs entirely locally — with the network removed", async function () {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("verify_solana_receipt reached the network");
  };
  try {
    await withInMemoryClient(async (client) => {
      const result = await client.callTool({
        name: "verify_solana_receipt",
        arguments: { receipt: signedReceipt, trustedPublicKeys: [signedReceipt.issuer.publicKey] },
      });
      assert.notEqual(result.isError, true);
      const { data } = readOutput(result);
      assert.equal(data.integrity.valid, true);
      assert.equal(data.issuer.verdict, "SIGNATURE_VALID");
      assert.equal(data.binding.verdict, "SOLANA_PINNED");
      assert.equal(data.outcome.network, "devnet");
      assert.equal(data.outcome.observedEffects, 2);
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("a sound signature from a key nobody published is reported as untrusted, not as valid", async function () {
  await withInMemoryClient(async (client) => {
    const result = await client.callTool({
      name: "verify_solana_receipt",
      arguments: { receipt: signedReceipt, trustedPublicKeys: [otherChainReceipt.issuer.publicKey.slice(0, -4) + "AAAA"] },
    });
    const { data } = readOutput(result);
    assert.equal(data.integrity.valid, true);
    assert.equal(data.issuer.verdict, "UNTRUSTED_KEY");
  });
});

test("one edited field breaks the hashes while the rest of the receipt still reads", async function () {
  await withInMemoryClient(async (client) => {
    const result = await client.callTool({
      name: "verify_solana_receipt",
      arguments: { receipt: tamperedReceipt },
    });
    const { data } = readOutput(result);
    assert.equal(data.integrity.valid, false);
    assert.deepEqual(
      [...data.integrity.issues].sort(),
      ["CONTENT_HASH_MISMATCH", "INTEGRITY_HASH_MISMATCH"],
    );
  });
});

test("a receipt that is not this kit's still verifies its own bytes and reports NOT_SOLANA", async function () {
  await withInMemoryClient(async (client) => {
    const result = await client.callTool({
      name: "verify_solana_receipt",
      arguments: { receipt: otherChainReceipt },
    });
    const { data } = readOutput(result);
    assert.equal(data.integrity.valid, true);
    assert.equal(data.issuer.verdict, "SIGNATURE_VALID");
    assert.equal(data.binding.verdict, "NOT_SOLANA");
    assert.equal(data.outcome.network, null);
  });
});

test("an oversized receipt is refused by byte budget before the schema runs", async function () {
  await withInMemoryClient(async (client) => {
    const result = await client.callTool({
      name: "verify_solana_receipt",
      arguments: { receipt: { kind: "OUTCOME_RECEIPT", filler: "x".repeat(SOLANA_MCP_MAX_RECEIPT_INPUT_BYTES + 1) } },
    });
    assert.equal(result.isError, true);
    assert.equal(readOutput(result).error.code, "PAYLOAD_TOO_LARGE");
  });
});

test("an unknown tool and a malformed argument both fail closed without echoing input", async function () {
  await withInMemoryClient(async (client) => {
    const unknown = await client.callTool({ name: "sign_solana_transaction", arguments: { secret: "leak-me" } });
    assert.equal(unknown.isError, true);
    assert.equal(readOutput(unknown).error.code, "UNKNOWN_TOOL");
    assert.doesNotMatch(JSON.stringify(unknown), /leak-me/);

    const malformed = await client.callTool({
      name: "inspect_solana_mint",
      arguments: { mint: "short", network: "mainnet", endpoint: "http://169.254.169.254/latest" },
    });
    assert.equal(malformed.isError, true);
    assert.equal(readOutput(malformed).error.code, "VALIDATION_ERROR");
    /* The endpoint is an operator decision, not a tool argument: a rejected
       call must never echo the URL it was asked to reach. */
    assert.doesNotMatch(JSON.stringify(malformed), /169\.254\.169\.254/);
  });
});

test("no tool accepts an RPC endpoint from its caller", async function () {
  await withInMemoryClient(async (client) => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const schema = JSON.stringify(tool.inputSchema);
      assert.doesNotMatch(schema, /"endpoint"/, `${tool.name} takes an endpoint from its caller`);
      assert.doesNotMatch(schema, /"url"/i, `${tool.name} takes a url from its caller`);
    }
  });
});

test("the documented launcher command starts a real stdio server", async function () {
  const readme = await readFile(readmePath, "utf8");
  assert.match(readme, /node packages\/solana-evidence-mcp\/src\/stdio\.ts/);

  const client = new Client({ name: "ryntra-solana-launcher-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [documentedLauncherArgument],
    cwd,
    stderr: "pipe",
    maxBufferSize: 128 * 1_024,
  });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
  } finally {
    await client.close();
  }
});
