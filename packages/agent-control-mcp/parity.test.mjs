import assert from "node:assert/strict";
import { test } from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { z } from "zod";

import { AgentActionIntentSchema } from "../../lib/agent-control/contracts.ts";
import { createAgentControlDemo } from "../../lib/agent-control/demo.ts";
import { verifyAgentArtifact } from "../../lib/agent-control/verify.ts";
import { RyntraAgentControlClient } from "../agent-control-sdk/src/index.ts";
import { McpAgentActionIntentSchema } from "./src/intent-schema.ts";
import { createAgentControlMcpServer } from "./src/server.ts";

const now = new Date("2026-08-14T12:00:00.000Z");

const GOLDEN = Object.freeze({
  intentHash: "0xdfd3eaaa322e59bcda143d5c8f434da7d0e14e07fe203179655a656129557194",
  evidenceRoot: "0x1152614f39f01f6eea3814a747ff0b08574ea733c2c80b9cf08484fafc38eee3",
  policyDigest: "0xdba1366fd3f315b0350229a474a0543efbf7548bb6fbf525e969efafd5d16cb4",
  passportHash: "0x80d1fe04e54b570be6dc4d7526e1ad16ff5587a557b9cc138b82443e8f758a03",
  integrityHash: "0xed607e024d4ea8bd62a5038ee0dd6ca2798d03ba65a6a1ae3b749b73729ccc35",
});

function jsonResponse(data) {
  return new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });
}

function readOutput(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

function goldenFrom(passport) {
  return {
    intentHash: passport.intentHash,
    evidenceRoot: passport.evidence.root,
    policyDigest: passport.policy.result.policyDigest,
    passportHash: passport.passportHash,
    integrityHash: passport.integrity.hash,
  };
}

test("kernel, typed SDK, and MCP preserve the same literal Action Passport golden vector", async () => {
  const kernelResult = createAgentControlDemo({ now });
  const fetchImpl = async (input, init = {}) => {
    const path = new URL(input).pathname;
    if (path === "/api/agents/preflight") {
      const body = JSON.parse(init.body);
      return jsonResponse(createAgentControlDemo({
        now,
        intent: body.intent,
        recordDemoDecision: body.recordDemoDecision,
      }));
    }
    if (path === "/api/agents/verify") {
      const body = JSON.parse(init.body);
      return jsonResponse(verifyAgentArtifact(body.artifact));
    }
    throw new Error("The parity fixture received an unexpected route.");
  };
  const sdk = new RyntraAgentControlClient({
    baseUrl: "https://ryntra.example",
    fetchImpl,
    timeoutMs: 2_000,
  });

  const sdkResult = await sdk.preflight({
    intent: kernelResult.preflight.intent,
    recordDemoDecision: false,
  });
  assert.deepEqual(sdkResult.passport, kernelResult.passport);

  const server = createAgentControlMcpServer(sdk);
  const client = new Client({ name: "ryntra-parity-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const mcpPreflight = await client.callTool({
      name: "run_agent_action_preflight",
      arguments: { intent: kernelResult.preflight.intent, recordDemoDecision: false },
    });
    const mcpPassport = readOutput(mcpPreflight).data;
    assert.deepEqual(mcpPassport, kernelResult.passport);

    assert.deepEqual(goldenFrom(kernelResult.passport), GOLDEN);
    assert.deepEqual(goldenFrom(sdkResult.passport), GOLDEN);
    assert.deepEqual(goldenFrom(mcpPassport), GOLDEN);

    const verification = await client.callTool({
      name: "verify_action_passport_preview",
      arguments: { passport: mcpPassport },
    });
    assert.deepEqual(readOutput(verification).data, {
      recognised: true,
      generation: "legacy-1.0.0",
      kind: "ACTION_PASSPORT_PREVIEW",
      schemaVersion: "1.0.0",
      integrity: { valid: true, issues: [] },
      issuer: {
        verdict: "UNSIGNED",
        keyId: null,
        detail: "this artifact generation predates issuer signatures",
      },
      authorization: {
        verdict: "NOT_AUTHORIZED",
        detail: "no authorization of any kind is recorded",
      },
      observation: { verdict: "NOT_OBSERVED", detail: "a preview carries no observed outcome" },
    });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test("the extraction-safe MCP intent schema remains identical to the Evidence Kernel projection", () => {
  assert.deepEqual(
    z.toJSONSchema(McpAgentActionIntentSchema),
    z.toJSONSchema(AgentActionIntentSchema),
  );

  const valid = createAgentControlDemo({ now }).preflight.intent;
  const cases = [
    valid,
    { ...valid, unknown: true },
    { ...valid, humanAuthorizationRequired: false },
    { ...valid, action: { ...valid.action, budget: { amount: "1", assetRef: "eip155:97/erc20:0x1" } } },
    { ...valid, expiresAt: valid.createdAt },
  ];
  for (const value of cases) {
    assert.equal(
      McpAgentActionIntentSchema.safeParse(value).success,
      AgentActionIntentSchema.safeParse(value).success,
    );
  }
});
