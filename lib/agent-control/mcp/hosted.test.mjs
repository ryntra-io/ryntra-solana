import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { MCP_WRITE_EFFECTS } from "./write-tools.ts";
import {
  HOSTED_LOCAL_READ_TOOLS,
  HOSTED_MCP_REFUSALS,
  HOSTED_MCP_TOOLS,
  WITHHELD_UPSTREAM_READ_TOOLS,
  admitHostedToolCall,
  digestArguments,
  hostedToolsFor,
  localMcpToolNames,
  readHostedCallReceipts,
  recordHostedCallReceipt,
} from "./hosted.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const ALL_SCOPES = ["evidence:read", "proposal:write", "metrics:read"];

test("every hosted name is one of the twelve the local server already carries", () => {
  const local = new Set(localMcpToolNames());
  for (const tool of HOSTED_MCP_TOOLS) {
    assert.ok(local.has(tool.name), `${tool.name} is hosted but is not a local tool`);
  }
  assert.ok(HOSTED_MCP_TOOLS.length < local.size, "the hosted inventory must be a strict subset");
});

test("every read tool is classified: hosted, or withheld with a reason", () => {
  /*
   * The classification cannot be forgotten. A read tool added later that nobody
   * decided about fails here rather than defaulting into a hosted inventory.
   */
  const withheld = new Set(WITHHELD_UPSTREAM_READ_TOOLS.map((entry) => entry.name));
  const hosted = new Set(HOSTED_LOCAL_READ_TOOLS);
  const reads = localMcpToolNames().filter((name) => !name.startsWith("propose_") && !hosted.has(name));
  for (const name of reads) {
    if (hosted.has(name)) continue;
    if (withheld.has(name)) continue;
    assert.ok(
      HOSTED_MCP_TOOLS.some((tool) => tool.name === name),
      `${name} is neither hosted nor withheld with a reason`,
    );
  }
  for (const entry of WITHHELD_UPSTREAM_READ_TOOLS) {
    assert.ok(entry.reason.length > 10, `${entry.name} is withheld without a reason worth reading`);
    assert.ok(!hosted.has(entry.name), `${entry.name} is both hosted and withheld`);
  }
});

test("no hosted tool can carry an effect other than the one PROPOSAL_ONLY value", () => {
  /* The write-effect union is what makes a generic signer unrepresentable. If
     it ever grows a second member, a hosted write could carry it, so the
     property is re-asserted at the edge that exposes those tools to the
     internet. */
  assert.deepEqual([...MCP_WRITE_EFFECTS], ["PROPOSAL_ONLY"]);
});

test("a tool that is not hosted refuses even for a token holding every scope", () => {
  for (const name of ["observe_bnb_apex_testnet_job", "inspect_agentverse_agent", "tool_execute", "sign"]) {
    const admission = admitHostedToolCall(name, ALL_SCOPES);
    assert.equal(admission.admitted, false, name);
    assert.equal(admission.reasonCode, "TOOL_NOT_HOSTED", name);
  }
});

test("a hosted tool the token lacks the scope for refuses by scope, not by absence", () => {
  const admission = admitHostedToolCall("propose_action", ["evidence:read"]);
  assert.equal(admission.admitted, false);
  assert.equal(admission.reasonCode, "SCOPE_NOT_GRANTED");
  assert.equal(admission.requiredScope, "proposal:write");
});

test("the filtered list is an ergonomic; calling past it is still refused", () => {
  /*
   * The call-time scope property, stated as a test. A caller who never sees
   * `propose_action` in `tools/list` and calls it anyway gets the same refusal
   * the filter was expressing — so the filter is not what is protecting
   * anything.
   */
  const readOnly = hostedToolsFor(["evidence:read"]);
  assert.ok(!readOnly.some((tool) => tool.name === "propose_action"));
  const called = admitHostedToolCall("propose_action", ["evidence:read"]);
  assert.equal(called.admitted, false);
  assert.equal(called.reasonCode, "SCOPE_NOT_GRANTED");

  const both = hostedToolsFor(["evidence:read", "proposal:write"]);
  assert.equal(both.length, HOSTED_MCP_TOOLS.length);
  assert.equal(admitHostedToolCall("propose_action", ["proposal:write"]).admitted, true);
});

test("metrics:read grants no tool at all", () => {
  assert.deepEqual(hostedToolsFor(["metrics:read"]), []);
  for (const tool of HOSTED_MCP_TOOLS) {
    assert.equal(admitHostedToolCall(tool.name, ["metrics:read"]).admitted, false);
  }
});

test("every refusal is one of the declared reasons", () => {
  for (const name of ["nope", "propose_action"]) {
    const admission = admitHostedToolCall(name, []);
    assert.equal(admission.admitted, false);
    assert.ok(HOSTED_MCP_REFUSALS.includes(admission.reasonCode));
  }
});

/* ── the receipt ───────────────────────────────────────────────────────── */

test("an accepted call leaves a receipt that can be read back", async () => {
  const store = createMemoryGuardStore();
  await recordHostedCallReceipt(store, {
    receiptId: "rcp_0000000000000001",
    tenantId: "ten_0123456789abcdef",
    clientId: "cli_0123456789abcdef01234567",
    grantId: "0123456789abcdef01234567",
    toolName: "propose_action",
    scope: "proposal:write",
    outcome: "ACCEPTED",
    reasonCode: null,
    args: { actionRef: "action:bnb-apex/fund-job@1" },
    atMs: NOW,
  });
  const receipts = await readHostedCallReceipts(store, "ten_0123456789abcdef");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].toolName, "propose_action");
  assert.equal(receipts[0].outcome, "ACCEPTED");
  assert.equal(receipts[0].at, new Date(NOW).toISOString());
  assert.match(receipts[0].argumentsDigest, /^0x[0-9a-f]{64}$/);
});

test("a refusal leaves a receipt too, carrying its exact reason", async () => {
  const store = createMemoryGuardStore();
  await recordHostedCallReceipt(store, {
    receiptId: "rcp_0000000000000002",
    tenantId: "ten_0123456789abcdef",
    clientId: "cli_0123456789abcdef01234567",
    grantId: "0123456789abcdef01234567",
    toolName: "propose_action",
    scope: "proposal:write",
    outcome: "REFUSED",
    reasonCode: "SCOPE_NOT_GRANTED",
    args: {},
    atMs: NOW,
  });
  const [receipt] = await readHostedCallReceipts(store, "ten_0123456789abcdef");
  assert.equal(receipt.outcome, "REFUSED");
  assert.equal(receipt.reasonCode, "SCOPE_NOT_GRANTED");
});

test("a receipt carries a digest of the arguments and never the arguments", async () => {
  const store = createMemoryGuardStore();
  const args = { secretMemo: "the counterparty is Acme", amountRaw: "1000" };
  await recordHostedCallReceipt(store, {
    receiptId: "rcp_0000000000000003",
    tenantId: "ten_0123456789abcdef",
    clientId: "cli_0123456789abcdef01234567",
    grantId: "0123456789abcdef01234567",
    toolName: "propose_action",
    scope: "proposal:write",
    outcome: "ACCEPTED",
    reasonCode: null,
    args,
    atMs: NOW,
  });
  const dump = JSON.stringify(await readHostedCallReceipts(store, "ten_0123456789abcdef"));
  assert.ok(!dump.includes("Acme"), "a caller's business data was copied into the audit row");
  assert.ok(dump.includes(digestArguments(args)));
});

test("one tenant cannot read another tenant's receipts", async () => {
  const store = createMemoryGuardStore();
  for (const tenantId of ["ten_aaaaaaaaaaaaaaaa", "ten_bbbbbbbbbbbbbbbb"]) {
    await recordHostedCallReceipt(store, {
      receiptId: `rcp_${tenantId}`,
      tenantId,
      clientId: "cli_0123456789abcdef01234567",
      grantId: "0123456789abcdef01234567",
      toolName: "draft_agent_action_intent",
      scope: "evidence:read",
      outcome: "ACCEPTED",
      reasonCode: null,
      args: {},
      atMs: NOW,
    });
  }
  const a = await readHostedCallReceipts(store, "ten_aaaaaaaaaaaaaaaa");
  assert.equal(a.length, 1);
  assert.equal(a[0].tenantId, "ten_aaaaaaaaaaaaaaaa");
});
