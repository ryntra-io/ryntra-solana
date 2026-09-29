import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  AGENT_CONTROL_MCP_MAX_RESULT_BYTES,
  createAgentControlMcpServer,
} from "./src/server.ts";

const fixturePath = fileURLToPath(new URL("./test/stdio-fixture.ts", import.meta.url));
const stdioPath = fileURLToPath(new URL("./src/stdio.ts", import.meta.url));
const readmePath = fileURLToPath(new URL("./README.md", import.meta.url));
const cwd = fileURLToPath(new URL("../..", import.meta.url));
const documentedLauncherArgument = "packages/agent-control-mcp/src/stdio.ts";

const agentverseAddress = "agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyyw9";
const tokenAddress = `0x${"a".repeat(40)}`;
const txHash = `0x${"b".repeat(64)}`;

const intent = {
  schemaVersion: "1.0.0",
  id: "intent-mcp-fixture",
  source: {
    kind: "MCP",
    agentId: agentverseAddress,
    agentName: "Fixture agent",
    requestId: "request-mcp-fixture",
  },
  subjectRef: "subject-fixture",
  requestText: "Draft a bounded BSC Testnet job without execution.",
  action: {
    kind: "CREATE_JOB_DRAFT",
    provider: "BNB_APEX",
    chainRef: "eip155:97",
    jobType: "integration-proof",
    deliverable: "Return a deterministic read-only integration report.",
    budget: null,
    providerRef: null,
    evaluatorRef: null,
    deadline: "2026-08-14T12:20:00.000Z",
    expectedEffects: ["No provider write occurs."],
  },
  policyRef: { id: "fixture-policy", version: 1 },
  evidenceRequirements: ["agentverse-profile"],
  humanAuthorizationRequired: true,
  createdAt: "2026-08-14T12:00:00.000Z",
  expiresAt: "2026-08-14T12:30:00.000Z",
  revision: 1,
  idempotencyKey: "fixture-idempotency-key",
};

async function withClient(run) {
  const client = new Client({ name: "ryntra-agent-control-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fixturePath],
    cwd,
    stderr: "pipe",
    maxBufferSize: 128 * 1_024,
  });
  await client.connect(transport);
  try {
    return await run(client, transport);
  } finally {
    await client.close();
  }
}

async function withDocumentedLauncher(run) {
  const readme = await readFile(readmePath, "utf8");
  assert.match(
    readme,
    /\$env:RYNTRA_AGENT_CONTROL_ORIGIN = "https:\/\/ryntra\.io"\r?\nnode packages\/agent-control-mcp\/src\/stdio\.ts/,
  );
  assert.doesNotMatch(readme, /npm run agent-control:mcp/);

  const client = new Client({ name: "ryntra-documented-launcher-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [documentedLauncherArgument],
    cwd,
    env: {
      ...process.env,
      RYNTRA_AGENT_CONTROL_ORIGIN: "http://127.0.0.1:3000",
    },
    stderr: "pipe",
    maxBufferSize: 128 * 1_024,
  });
  await client.connect(transport);
  try {
    return await run(client, transport);
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

function assertStructuredFailure(result, expected) {
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(expected) }]);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= AGENT_CONTROL_MCP_MAX_RESULT_BYTES);
}

test("stdio startup rejects a malformed origin without reflecting its query or stack", async () => {
  const sentinel = ["AUDIT", "SENTINEL"].join("_");
  const child = spawn(process.execPath, [stdioPath], {
    cwd,
    env: {
      ...process.env,
      RYNTRA_AGENT_CONTROL_ORIGIN: `?token=${sentinel}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });

  assert.notEqual(exitCode, 0);
  assert.equal(stdout, "");
  assert.equal(stderr.trim(), "[ryntra-agent-control-mcp] startup failed");
  assert.doesNotMatch(stderr, new RegExp(`${sentinel}|ERR_INVALID_URL|at .*stdio`, "i"));
});

const READ_TOOL_NAMES = [
  "draft_agent_action_intent",
  "inspect_agent_launch_testnet_token",
  "inspect_agentverse_agent",
  "list_agent_launch_testnet_tokens",
  "observe_bnb_apex_testnet_job",
  "run_agent_action_preflight",
  "verify_action_passport_preview",
];

const WRITE_TOOL_NAMES = [
  "attach_proposal_evidence",
  "ingest_a2a_task",
  "propose_action",
  "request_human_review",
  "retract_proposal",
];

test("official MCP client lists exactly twelve tools through the documented direct-Node launcher", async () => {
  await withDocumentedLauncher(async (client) => {
    const result = await client.listTools();
    assert.deepEqual(
      result.tools.map((tool) => tool.name).sort(),
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort(),
    );

    /* The name tripwire now covers the whole inventory rather than the seven
       read tools, and the write-tool release tightened it rather than relaxing
       it. Two proposed write tools were first called `submit_action_proposal`
       and `withdraw_proposal`; both tripped this list, and the fix was to
       rename them to `propose_action` and `retract_proposal`. Weakening a check
       to fit a name is how a tripwire stops being one. */
    for (const tool of result.tools) {
      assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} is destructive`);
      assert.doesNotMatch(
        tool.name,
        /sign_|fund_|submit_|settle_|trade_|tokenize|execute|withdraw_|transfer_|approve_/i,
        `${tool.name} is named for something no tool here may do`,
      );
      assert.equal(typeof tool.annotations?.openWorldHint, "boolean");
    }

    for (const name of READ_TOOL_NAMES) {
      assert.equal(
        result.tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint,
        true,
        `${name} must still publish itself as a read`,
      );
    }
    for (const name of WRITE_TOOL_NAMES) {
      const tool = result.tools.find((candidate) => candidate.name === name);
      assert.equal(tool?.annotations?.readOnlyHint, false, `${name} must not claim to be a read`);
      assert.equal(tool?.annotations?.openWorldHint, false, `${name} must not claim to leave the process`);
      /* A published schema a client can read, with the allowlist visible in it
         — a courtesy, never the control. */
      assert.equal(tool?.inputSchema?.type, "object");
    }

    assert.equal(
      result.tools.find((tool) => tool.name === "verify_action_passport_preview")?.annotations?.openWorldHint,
      true,
    );
    assert.equal(
      result.tools.find((tool) => tool.name === "draft_agent_action_intent")?.annotations?.openWorldHint,
      false,
    );
  });
});

test("no tool accepts an endpoint from its caller — over every schema", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 12);
    const shapes = ["endpoint", "url", "uri", "host", "baseUrl", "rpcUrl"];
    for (const tool of tools) {
      const schema = JSON.stringify(tool.inputSchema);
      for (const shape of shapes) {
        assert.ok(
          !schema.includes(JSON.stringify(shape)),
          `${tool.name} takes ${shape} from its caller`,
        );
      }
    }
  });
});

test("the write path is server-enforced, and the client's view of it decides nothing", async () => {
  await withClient(async (client) => {
    /* A proposal is created, and everything about it says "not decided". */
    const proposed = await client.callTool({
      name: "propose_action",
      arguments: {
        actionRef: "action:bnb-apex/create-job-draft@1",
        subjectRef: "book-golden-rwa",
        summary: "Draft a bounded integration job.",
      },
    });
    assert.equal(proposed.isError, undefined);
    const record = readOutput(proposed).data;
    assert.equal(record.kind, "AGENT_CONTROL_PROPOSAL");
    assert.equal(record.phase, "PROPOSE");
    assert.equal(record.ownerAuthorization, "NOT_REQUESTED");
    assert.equal(record.status, "OPEN");

    /* Asking for review is the whole effect. */
    const reviewed = await client.callTool({
      name: "request_human_review",
      arguments: { proposalId: record.id },
    });
    assert.equal(readOutput(reviewed).data.reviewRequested, true);
    assert.equal(readOutput(reviewed).data.phase, "PROPOSE");
    assert.equal(readOutput(reviewed).data.ownerAuthorization, "NOT_REQUESTED");

    /* The gate refuses an authority-shaped field before anything else looks at
       the request, and refuses it without echoing what was sent. */
    const smuggled = await client.callTool({
      name: "propose_action",
      arguments: {
        actionRef: "action:bnb-apex/create-job-draft@1",
        subjectRef: "book-golden-rwa",
        summary: "x",
        ownerAuthority: "GRANTED-BY-THE-CALLER",
      },
    });
    assert.equal(smuggled.isError, true);
    assert.equal(readOutput(smuggled).error.code, "OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER");
    assert.doesNotMatch(JSON.stringify(smuggled), /GRANTED-BY-THE-CALLER/);

    /* An action the registry knows and this tool does not allow. */
    const foreign = await client.callTool({
      name: "propose_action",
      arguments: {
        actionRef: "action:demo/transfer@1",
        subjectRef: "book-golden-rwa",
        summary: "x",
      },
    });
    assert.equal(foreign.isError, true);

    /* A completed A2A task promotes nothing, whatever the caller proved. */
    const ingested = await client.callTool({
      name: "ingest_a2a_task",
      arguments: {
        actionRef: "action:a2a/inbound-task@1",
        task: {
          id: "task-1",
          contextId: null,
          state: "TASK_STATE_COMPLETED",
          artifacts: [],
          terminalResult: "delivered",
        },
        agentCard: {
          name: "Counterparty agent",
          protocolVersion: "1.0.0",
          version: "1.2.3",
          skills: ["research"],
          cardAuthenticity: "ASSERTED_UNVERIFIED",
        },
        callerAuthentication: "CREDENTIAL_VERIFIED",
      },
    });
    assert.equal(ingested.isError, undefined);
    const proposal = readOutput(ingested).data;
    assert.equal(proposal.promotes, null);
    assert.equal(proposal.ownerAuthorization, "NOT_REQUESTED");
    assert.equal(proposal.callerAuthentication, "CREDENTIAL_VERIFIED");

    /* And a signing-shaped tool simply is not there. */
    const absent = await client.callTool({
      name: "sign_action_authorization",
      arguments: { proposalId: record.id },
    });
    assert.equal(absent.isError, true);
    assert.equal(readOutput(absent).error.code, "UNKNOWN_TOOL");
  });
});

test("current official MCP client calls every tool over stdio without network access", async () => {
  await withClient(async (client) => {
    const draft = await client.callTool({ name: "draft_agent_action_intent", arguments: { intent } });
    assert.equal(draft.isError, undefined);

    const agent = await client.callTool({
      name: "inspect_agentverse_agent",
      arguments: { address: agentverseAddress },
    });
    assert.equal(readOutput(agent).data.kind, "AGENT_PASSPORT");

    const list = await client.callTool({ name: "list_agent_launch_testnet_tokens", arguments: {} });
    assert.equal(readOutput(list).data.state, "ZERO_STATE");
    assert.equal(readOutput(list).data.chainId, 97);

    const token = await client.callTool({
      name: "inspect_agent_launch_testnet_token",
      arguments: { address: tokenAddress },
    });
    assert.equal(readOutput(token).data.state, "NOT_FOUND");

    const preflight = await client.callTool({
      name: "run_agent_action_preflight",
      arguments: { intent, recordDemoDecision: false },
    });
    const preview = readOutput(preflight).data;
    assert.equal(preview.kind, "ACTION_PASSPORT_PREVIEW");
    assert.equal(preview.outcome.status, "OUTCOME_NOT_OBSERVED");

    const verify = await client.callTool({
      name: "verify_action_passport_preview",
      arguments: { passport: preview },
    });
    assert.equal(readOutput(verify).data.observation.verdict, "NOT_OBSERVED");

    const observation = await client.callTool({
      name: "observe_bnb_apex_testnet_job",
      arguments: { jobId: "1", txHash },
    });
    assert.equal(readOutput(observation).data.state, "NOT_FOUND");
    assert.equal(readOutput(observation).data.chainId, 97);
  });
});

test("stdio boundary rejects invalid and oversized tool input without exposing submitted secrets", async () => {
  await withClient(async (client) => {
    const sentinel = ["ATTACKER", "CONTROLLED"].join("_");
    const unknown = await client.callTool({
      name: `sign_or_fund_job_${sentinel}`,
      arguments: { authorization: "secret-value" },
    });
    assertStructuredFailure(unknown, {
      error: {
        code: "UNKNOWN_TOOL",
        message: "The requested tool is not available.",
      },
    });
    assert.doesNotMatch(JSON.stringify(unknown), new RegExp(`${sentinel}|secret-value`));

    const maliciousKey = `${sentinel}_${"k".repeat(8 * 1_024)}`;
    const invalid = await client.callTool({
      name: "inspect_agentverse_agent",
      arguments: {
        address: agentverseAddress,
        [maliciousKey]: "secret-value",
      },
    });
    assertStructuredFailure(invalid, {
      error: {
        code: "VALIDATION_ERROR",
        message: "The tool input was not accepted.",
      },
    });
    assert.doesNotMatch(JSON.stringify(invalid), new RegExp(`${sentinel}|secret-value|k{128}`));

    const upstream = await client.callTool({
      name: "inspect_agent_launch_testnet_token",
      arguments: { address: `0x${"f".repeat(40)}` },
    });
    assert.equal(upstream.isError, true);
    assert.deepEqual(readOutput(upstream), {
      error: {
        code: "UPSTREAM_FAILURE",
        message: "The read-only upstream observation could not be completed.",
      },
    });
    assert.doesNotMatch(JSON.stringify(upstream), /secret-value|authorization/i);

    const timeout = await client.callTool({
      name: "inspect_agent_launch_testnet_token",
      arguments: { address: `0x${"e".repeat(40)}` },
    });
    assert.equal(timeout.isError, true);
    assert.deepEqual(readOutput(timeout), {
      error: {
        code: "REQUEST_TIMEOUT",
        message: "The bounded read-only request exceeded its timeout.",
      },
    });
    assert.doesNotMatch(JSON.stringify(timeout), /secret-value|api_key/i);

    const abortController = new AbortController();
    const cancelled = client
      .callTool(
        {
          name: "inspect_agent_launch_testnet_token",
          arguments: { address: `0x${"d".repeat(40)}` },
        },
        { signal: abortController.signal, timeout: 2_000 },
      )
      .then((result) => ({ result }), (error) => ({ error }));
    setTimeout(() => abortController.abort(), 10);
    const cancelledOutcome = await cancelled;
    assert.doesNotMatch(JSON.stringify(cancelledOutcome), /secret-value|token=/i);
    assert.ok("error" in cancelledOutcome || cancelledOutcome.result.isError === true);

    const baseline = await client.callTool({
      name: "run_agent_action_preflight",
      arguments: { intent, recordDemoDecision: false },
    });
    const oversizedPassport = structuredClone(readOutput(baseline).data);
    oversizedPassport.limitations[0] = "x".repeat(70 * 1_024);
    const oversized = await client.callTool({
        name: "verify_action_passport_preview",
        arguments: { passport: oversizedPassport },
      }, { timeout: 1_000 });
    assert.equal(oversized.isError, true);
    assert.deepEqual(readOutput(oversized), {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The bounded tool payload exceeds the application byte limit.",
      },
    });
    assert.doesNotMatch(JSON.stringify(oversized), /x{128}/);
  });
});

test("application output cap returns a bounded error without reflecting or duplicating oversized data", async () => {
  const sentinel = ["OUTPUT", "SENTINEL"].join("_");
  const unavailable = async () => {
    throw Object.assign(new Error("unused"), { code: "UPSTREAM_FAILURE" });
  };
  const server = createAgentControlMcpServer({
    agentPassport: unavailable,
    preflight: unavailable,
    verifyArtifact: unavailable,
    agentLaunchToken: unavailable,
    observeBnbApex: unavailable,
    async agentLaunchTokens() {
      return {
        provider: "AGENT_LAUNCH",
        access: "PUBLIC_READ_ONLY_GET",
        endpoint: "TOKENS",
        chainId: 97,
        providerUrl: "https://agent-launch.ai/api/agents/tokens?chainId=97",
        observedAt: "2026-08-14T12:00:00.000Z",
        controllerVariant: "SUCCESS_DATA_ARRAY",
        state: "AVAILABLE",
        tokens: [],
        schemaDrift: [],
        raw: { sentinel, payload: "x".repeat(AGENT_CONTROL_MCP_MAX_RESULT_BYTES) },
      };
    },
  });
  const client = new Client({ name: "ryntra-output-bound-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "list_agent_launch_testnet_tokens", arguments: {} });
    assert.equal(result.isError, true);
    assert.deepEqual(readOutput(result), {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The bounded tool payload exceeds the application byte limit.",
      },
    });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1_024);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
