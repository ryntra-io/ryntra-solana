// Run from repo root:
// node --test --test-isolation=none lib/agent-control/mcp/write-gate.test.mjs
//
// The first Agent Control write path, and the boundary that makes it safe to
// have one. Gates the task card marks "proved red" are labelled GATE-PROVED
// where they appear; each was broken deliberately, seen fail, and reverted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MCP_WRITE_EFFECTS,
  MCP_WRITE_OUTPUT_KINDS,
  MCP_WRITE_PHASE,
  MCP_WRITE_TOOLS,
  MCP_WRITE_TOOL_NAMES,
  mcpWriteTool,
} from "./write-tools.ts";
import {
  MCP_WRITE_REFUSALS,
  McpWriteError,
  admitMcpWrite,
  mcpWriteRefusal,
} from "./write-gate.ts";
import { AGENT_CONTROL_REGISTRY, RegistryResolutionError, resolveRegistryRef } from "../registry.ts";

const gateSource = readFileSync(new URL("./write-gate.ts", import.meta.url), "utf8");
const catalogueSource = readFileSync(new URL("./write-tools.ts", import.meta.url), "utf8");
const ledgerSource = readFileSync(new URL("./proposal-ledger.ts", import.meta.url), "utf8");

/**
 * Source with comments removed.
 *
 * Every absence check in this packet runs against this rather than raw text,
 * and the reason showed up three separate times in one session before it was
 * named: a module that documents why it never touches a thing contains the name
 * of that thing, so a raw scan refuses the explanation along with what it
 * explains. The property under test is what the code *does*.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const gateCode = withoutComments(gateSource);
const catalogueCode = withoutComments(catalogueSource);

const FUND_JOB = "action:bnb-apex/fund-job@1";
const CREATE_DRAFT = "action:bnb-apex/create-job-draft@1";
const DEMO_TRANSFER = "action:demo/transfer@1";
const A2A_TASK = "action:a2a/inbound-task@1";

function throwsWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    assert.equal(
      mcpWriteRefusal(error),
      reasonCode,
      `expected ${reasonCode}, got ${mcpWriteRefusal(error)}: ${error?.message ?? error}`,
    );
    return error;
  }
  assert.fail(`expected ${reasonCode}, nothing was refused`);
}

/**
 * Split source into lowercase code words, with comments and string literals
 * removed first.
 *
 * The stripping is what makes the scan usable: these modules have to be able to
 * *talk* about signing in prose and to carry banned key names as data in a
 * denylist. Reading the word is not doing the thing. What must not exist is a
 * code identifier that performs it.
 */
function codeWords(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, ' "" ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, " '' ")
    .replace(/`(?:[^`\\]|\\.)*`/g, " `` ");
  const words = [];
  for (const identifier of stripped.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []) {
    for (const part of identifier.split(/[_$]|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      if (part) words.push(part.toLowerCase());
    }
  }
  return words;
}

test("a generic signing tool is unrepresentable, not merely forbidden", function () {
  /* The union has one member. A tool that signed something would need an effect
     value to carry, and there is none — so this is a type-level absence rather
     than a name on a blocklist, which RYN-BIN-AOS-003 proved is bypassable. */
  assert.deepEqual([...MCP_WRITE_EFFECTS], ["PROPOSAL_ONLY"]);
  assert.equal(MCP_WRITE_EFFECTS.length, 1, "a second effect value is a canon change, not a code edit");
  assert.deepEqual([...MCP_WRITE_OUTPUT_KINDS], ["AGENT_CONTROL_PROPOSAL"]);
  assert.equal(MCP_WRITE_PHASE, "PROPOSE");

  for (const tool of MCP_WRITE_TOOLS) {
    assert.equal(tool.effect, "PROPOSAL_ONLY", `${tool.name} carries a foreign effect`);
    assert.equal(tool.produces, "AGENT_CONTROL_PROPOSAL", `${tool.name} produces a foreign kind`);
    assert.equal(tool.phase, "PROPOSE", `${tool.name} leaves a record past PROPOSE`);
  }
});

test("GATE-PROVED: no signing-shaped identifier exists in the gate, the catalogue or the ledger", function () {
  const banned = new Set([
    "sign", "signs", "signed", "signer", "signing", "signature", "signatures",
    "mnemonic", "keypair", "privkey", "keystore", "passphrase",
  ]);
  const bannedPairs = [
    ["private", "key"],
    ["secret", "key"],
    ["seed", "phrase"],
    ["send", "transaction"],
    ["raw", "transaction"],
  ];

  for (const [label, source] of [
    ["write-gate.ts", gateSource],
    ["write-tools.ts", catalogueSource],
    ["proposal-ledger.ts", ledgerSource],
  ]) {
    const words = codeWords(source);
    for (const word of words) {
      assert.ok(!banned.has(word), `${label} carries the code identifier word "${word}"`);
    }
    for (let index = 0; index + 1 < words.length; index += 1) {
      for (const [first, second] of bannedPairs) {
        assert.ok(
          !(words[index] === first && words[index + 1] === second),
          `${label} carries the code identifier "${first}${second}"`,
        );
      }
    }
  }

  /* The scan has to be able to fail, or it proves nothing. */
  assert.ok(codeWords("const signTransaction = 1;").includes("sign"));
  assert.ok(!codeWords("const design = 1;").includes("sign"), "design must not trip the scan");
  assert.ok(!codeWords('const x = "signature";').includes("signature"), "a string literal is data");
});

test("GATE-PROVED: there is no meta-tool — no write accepts a tool, method or free-string action selector", function () {
  /* This is the RYN-BIN-AOS-003 defect by name. The Binance MCP server ships
     `tool_execute`, which takes a tool name as a string; any blocklist of names
     is therefore decoration. The only selector here is a registry reference,
     and a reference that does not resolve refuses. */
  for (const tool of MCP_WRITE_TOOLS) {
    for (const ref of tool.actionRefs) {
      assert.match(ref, /^action:[a-z0-9-]+\/[a-z0-9-]+@[1-9]\d*$/, `${tool.name} names a loose selector`);
      /* Every declared reference must exist in the shipped registry, or the
         allowlist is a list of strings rather than a list of actions. */
      const entry = resolveRegistryRef(AGENT_CONTROL_REGISTRY, ref, "ACTION_SCHEMA");
      assert.ok(tool.adapterRefs.includes(entry.adapterRef), `${tool.name} allows an unlisted adapter`);
    }
  }

  throwsWith("WRITE_TOOL_NOT_REGISTERED", () =>
    admitMcpWrite({ tool: "tool_execute", input: { name: "withdraw_all", arguments: {} } }));
  throwsWith("WRITE_TOOL_NOT_REGISTERED", () =>
    admitMcpWrite({ tool: "propose_action_v2", input: { actionRef: CREATE_DRAFT } }));
});

test("every admitted write produces exactly one kind of thing, whatever the input", function () {
  /* The property that separates propose_action(ref) from
     tool_execute(name): the reference is data recorded inside the outcome, not
     a selector of what the outcome is. */
  const admissions = [
    admitMcpWrite({ tool: "propose_action", input: { actionRef: CREATE_DRAFT } }),
    admitMcpWrite({ tool: "propose_action", input: { actionRef: FUND_JOB, budget: { amount: "1" } } }),
    admitMcpWrite({ tool: "attach_proposal_evidence", input: { proposalId: "proposal-1" } }),
    admitMcpWrite({ tool: "request_human_review", input: { proposalId: "proposal-1" } }),
    admitMcpWrite({ tool: "retract_proposal", input: { proposalId: "proposal-1", reason: "stale" } }),
    admitMcpWrite({ tool: "ingest_a2a_task", input: { actionRef: A2A_TASK } }),
  ];

  const kinds = new Set(admissions.map((admission) => admission.produces));
  const effects = new Set(admissions.map((admission) => admission.effect));
  const phases = new Set(admissions.map((admission) => admission.phase));
  const authorizations = new Set(admissions.map((admission) => admission.ownerAuthorization));

  assert.deepEqual([...kinds], ["AGENT_CONTROL_PROPOSAL"]);
  assert.deepEqual([...effects], ["PROPOSAL_ONLY"]);
  assert.deepEqual([...phases], ["PROPOSE"]);
  assert.deepEqual([...authorizations], ["NOT_REQUESTED"], "the gate has no path to any other value");
});

test("GATE-PROVED: a write carrying owner authority is refused first, by its own name", function () {
  /* Order is the point. Refused later it would come back as "unrecognized
     field", somebody would drop the field, resend, and read the success as
     permission to keep going. */
  const authorityShapes = [
    { actionRef: CREATE_DRAFT, authorization: "GRANTED" },
    { actionRef: CREATE_DRAFT, approved: true },
    { actionRef: CREATE_DRAFT, mandateRef: "mandate:owner@1" },
    { actionRef: CREATE_DRAFT, signature: "0xdeadbeef" },
    { actionRef: CREATE_DRAFT, nested: { deeper: { privateKey: "0x00" } } },
    { actionRef: CREATE_DRAFT, list: [{ apiKey: "k" }] },
    { actionRef: CREATE_DRAFT, "owner-authority": true },
    { actionRef: CREATE_DRAFT, accessToken: "t" },
  ];
  for (const input of authorityShapes) {
    throwsWith("OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER", () =>
      admitMcpWrite({ tool: "propose_action", input }));
  }

  /* It outranks every other refusal in the file, including an unknown tool and
     an action outside the allowlist. */
  throwsWith("OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER", () =>
    admitMcpWrite({ tool: "no_such_tool", input: { approval: true, endpoint: "https://x" } }));

  /* And it never echoes the value it refused. */
  const error = throwsWith("OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER", () =>
    admitMcpWrite({ tool: "propose_action", input: { actionRef: CREATE_DRAFT, mnemonic: "leak-me" } }));
  assert.doesNotMatch(error.message, /leak-me/);
});

test("the authority scan matches key segments, so a rename does not defeat it", function () {
  /* The first version of this gate compared whole normalized keys, so
     `authority` refused and `ownerAuthority` passed. That is exactly the
     bypassable-denylist shape RYN-BIN-AOS-003 documented, and it survived until
     one fixture used the hyphenated spelling. */
  for (const key of [
    "ownerAuthority", "owner-authority", "owner_authority", "OWNER_AUTHORITY",
    "taskAuthorization", "cardSignature", "delegatedMandate", "accessToken", "apiKey",
  ]) {
    throwsWith("OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER", () =>
      admitMcpWrite({ tool: "propose_action", input: { actionRef: CREATE_DRAFT, [key]: "x" } }));
  }

  /* And it must not refuse honest fields. `authentication` is what a caller
     proved about itself, which is a different axis from what the owner decided
     — collapsing them at the door would undo the separation this packet is for.
     `tokenRef` is an asset reference; a product about programmable assets that
     refuses the word "token" teaches callers to route around the gate. */
  for (const key of ["callerAuthentication", "cardAuthenticity", "tokenRef", "subjectRef", "designNote"]) {
    const admitted = admitMcpWrite({
      tool: "propose_action",
      input: { actionRef: CREATE_DRAFT, [key]: "x" },
    });
    assert.equal(admitted.produces, "AGENT_CONTROL_PROPOSAL", `${key} was refused and should not be`);
  }
});

test("GATE-PROVED: no write accepts an endpoint from its caller", function () {
  /* The RYN-SOL-A6 rule, applied to writes. Where a tool reaches is an operator
     decision, never a tool argument. */
  const endpointShapes = ["endpoint", "url", "uri", "host", "baseUrl", "rpcUrl", "webhook", "callbackUrl", "proxy"];
  for (const key of endpointShapes) {
    const error = throwsWith("CALLER_SUPPLIED_ENDPOINT", () =>
      admitMcpWrite({
        tool: "propose_action",
        input: { actionRef: CREATE_DRAFT, [key]: "http://169.254.169.254/latest" },
      }));
    assert.doesNotMatch(error.message, /169\.254\.169\.254/, "a refusal must not echo the address");
  }
});

test("an oversized or overdeep write is refused rather than partially read", function () {
  let deep = { leaf: true };
  for (let index = 0; index < 40; index += 1) deep = { deep };
  throwsWith("WRITE_INPUT_OUT_OF_BOUNDS", () =>
    admitMcpWrite({ tool: "propose_action", input: { actionRef: CREATE_DRAFT, deep } }));

  const wide = { actionRef: CREATE_DRAFT };
  for (let index = 0; index < 5_000; index += 1) wide[`k${index}`] = index;
  throwsWith("WRITE_INPUT_OUT_OF_BOUNDS", () =>
    admitMcpWrite({ tool: "propose_action", input: wide }));
});

test("GATE-PROVED: an action outside the tool's allowlist is refused, and a different adapter does not satisfy it", function () {
  /* `action:demo/transfer@1` is a real, allowlisted registry entry. It is not
     one this tool may name: the demo adapter exists to render source previews,
     not to receive proposals from an unauthenticated caller. */
  resolveRegistryRef(AGENT_CONTROL_REGISTRY, DEMO_TRANSFER, "ACTION_SCHEMA");
  throwsWith("ACTION_NOT_ALLOWED_BY_TOOL", () =>
    admitMcpWrite({ tool: "propose_action", input: { actionRef: DEMO_TRANSFER } }));

  /* The A2A action is allowlisted — for a different tool. */
  throwsWith("ACTION_NOT_ALLOWED_BY_TOOL", () =>
    admitMcpWrite({ tool: "propose_action", input: { actionRef: A2A_TASK } }));
  throwsWith("ACTION_NOT_ALLOWED_BY_TOOL", () =>
    admitMcpWrite({ tool: "ingest_a2a_task", input: { actionRef: CREATE_DRAFT } }));

  /* A tool that names no action refuses one, and a tool that needs one refuses
     its absence. Two different mistakes, two different codes. */
  throwsWith("ACTION_REF_NOT_ACCEPTED_BY_TOOL", () =>
    admitMcpWrite({ tool: "request_human_review", input: { proposalId: "proposal-1", actionRef: CREATE_DRAFT } }));
  throwsWith("ACTION_REF_REQUIRED_BY_TOOL", () =>
    admitMcpWrite({ tool: "propose_action", input: { subjectRef: "book-1" } }));
});

test("GATE-PROVED: an unknown, retired or hash-mismatched reference keeps the registry's own refusal", function () {
  throwsWith("REGISTRY_REF_UNKNOWN", () =>
    admitMcpWrite({
      tool: "propose_action",
      input: { actionRef: "action:bnb-apex/create-job-draft@9" },
    }));

  /* The hash pin is checked on resolution, so a tampered entry refuses even
     though its reference is in the tool's allowlist. Proved by mutating a live
     entry rather than by constructing a fake registry. */
  const entry = AGENT_CONTROL_REGISTRY.entries.find((candidate) => candidate.ref === CREATE_DRAFT);
  const originalHash = entry.contentHash;
  try {
    Object.defineProperty(entry, "contentHash", { value: `0x${"0".repeat(64)}`, configurable: true });
    throwsWith("REGISTRY_ENTRY_HASH_MISMATCH", () =>
      admitMcpWrite({ tool: "propose_action", input: { actionRef: CREATE_DRAFT } }));
  } finally {
    Object.defineProperty(entry, "contentHash", { value: originalHash, configurable: true });
  }
  assert.equal(
    admitMcpWrite({ tool: "propose_action", input: { actionRef: CREATE_DRAFT } }).actionRef,
    CREATE_DRAFT,
    "the pin must be restored for the rest of the suite",
  );
});

test("the registry's budget rule decides, and the tool does not restate it", function () {
  /* `fund-job` is VALUE_COMMIT with budget REQUIRED; `create-job-draft` is
     RECORD_ONLY with budget FORBIDDEN. Both facts come from the registry entry,
     so a new action arrives with its own rule rather than inheriting one. */
  throwsWith("BUDGET_REQUIRED_BY_ACTION", () =>
    admitMcpWrite({ tool: "propose_action", input: { actionRef: FUND_JOB } }));
  throwsWith("BUDGET_FORBIDDEN_BY_ACTION", () =>
    admitMcpWrite({ tool: "propose_action", input: { actionRef: CREATE_DRAFT, budget: { amount: "1" } } }));

  const funded = admitMcpWrite({
    tool: "propose_action",
    input: { actionRef: FUND_JOB, budget: { amount: "1.00", assetRef: "eip155:97/native" } },
  });
  assert.equal(funded.canonicalClass, "VALUE_COMMIT");
  assert.equal(funded.ownerAuthorization, "NOT_REQUESTED", "a funded proposal is still only a proposal");
});

test("an admitted write records the exact registry pin it resolved", function () {
  const admitted = admitMcpWrite({ tool: "propose_action", input: { actionRef: CREATE_DRAFT } });
  assert.equal(admitted.adapterRef, "adapter:bnb-apex@1");
  assert.equal(admitted.pin.registryDigest, AGENT_CONTROL_REGISTRY.digest);
  assert.deepEqual(
    admitted.pin.refs.map((entry) => entry.ref).sort(),
    ["action:bnb-apex/create-job-draft@1", "adapter:bnb-apex@1"],
  );

  /* A tool that names no action pins nothing, rather than pinning a default. */
  const evidence = admitMcpWrite({ tool: "attach_proposal_evidence", input: { proposalId: "proposal-1" } });
  assert.equal(evidence.pin, null);
  assert.equal(evidence.actionRef, null);
});

test("every write adapter is READ_ONLY, and a writing adapter would be refused", function () {
  for (const tool of MCP_WRITE_TOOLS) {
    for (const ref of tool.adapterRefs) {
      const adapter = resolveRegistryRef(AGENT_CONTROL_REGISTRY, ref, "ADAPTER");
      assert.equal(adapter.capability, "READ_ONLY", `${ref} is not read-only`);
    }
  }
  assert.ok(
    MCP_WRITE_REFUSALS.includes("ACTION_ADAPTER_NOT_READ_ONLY"),
    "the refusal must exist before an adapter needs it",
  );
});

test("GATE-PROVED: tool annotations decide nothing, in either polarity", function () {
  /* MCP 2026-07-28: "clients MUST consider tool annotations to be untrusted
     unless they come from trusted servers." The threat that follows is a caller
     that asserts the annotation it wants — `readOnlyHint: true` on a write, to
     be handled as a read. The gate cannot be fooled by it because annotations
     are not among its inputs at all, and every polarity of every hint sent as
     an argument leaves the verdict identical. */
  const hints = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
  const baseline = admitMcpWrite({
    tool: "propose_action",
    input: { actionRef: CREATE_DRAFT, subjectRef: "book-1" },
  });

  for (const hint of hints) {
    for (const polarity of [true, false]) {
      const claimed = admitMcpWrite({
        tool: "propose_action",
        input: { actionRef: CREATE_DRAFT, subjectRef: "book-1", [hint]: polarity },
      });
      assert.deepEqual(claimed, baseline, `${hint}: ${polarity} changed the verdict`);
    }
  }

  const allHints = { actionRef: CREATE_DRAFT, subjectRef: "book-1" };
  for (const hint of hints) allHints[hint] = true;
  assert.deepEqual(
    admitMcpWrite({ tool: "propose_action", input: allHints }),
    baseline,
    "a fully self-declared read is still a write",
  );

  /* And the absence is structural, not incidental: nothing in the gate is in a
     position to read an annotation, whatever a client sends. */
  for (const hint of [...hints, "annotation", "annotations"]) {
    assert.doesNotMatch(gateCode, new RegExp(`\\b${hint}\\b`), `the gate reads ${hint}`);
  }
});

test("the catalogue and the gate keep their jobs", function () {
  /* One gate owns every decision; the catalogue is data. The same split the
     402 engine proves for payments, checked the same way — from disk. */
  assert.doesNotMatch(catalogueSource, /\bfunction admit/, "the catalogue grew a resolver");
  assert.doesNotMatch(catalogueSource, /throw new .*Error/, "the catalogue grew a refusal vocabulary");

  for (const name of MCP_WRITE_TOOL_NAMES) {
    assert.doesNotMatch(
      gateSource,
      new RegExp(`case\\s+["']${name}["']`),
      `the gate branches on the tool name ${name}`,
    );
  }

  assert.equal(mcpWriteTool("propose_action").name, "propose_action");
  assert.equal(mcpWriteTool("nope"), null, "the catalogue returns null and lets the gate name the refusal");
});

test("the gate imports nothing that could reach a network or a model", function () {
  assert.doesNotMatch(gateCode, /\bfetch\s*\(/);
  assert.doesNotMatch(gateCode, /node:(net|http|https|tls|child_process)/);
  assert.doesNotMatch(gateCode, /process\.env/);
  assert.doesNotMatch(gateCode, /@anthropic|openai|@ai-sdk/i);
  assert.doesNotMatch(catalogueCode, /\bfetch\s*\(/);
});

test("a refusal collapses anything unexpected rather than leaking it", function () {
  assert.equal(mcpWriteRefusal(new McpWriteError("WRITE_TOOL_NOT_REGISTERED", "x")), "WRITE_TOOL_NOT_REGISTERED");
  assert.equal(
    mcpWriteRefusal(new RegistryResolutionError("REGISTRY_REF_UNKNOWN", "action:x/y@1", "x")),
    "REGISTRY_REF_UNKNOWN",
  );
  assert.equal(mcpWriteRefusal(new Error("internal detail with a path")), "WRITE_REFUSED");
  assert.equal(mcpWriteRefusal("a string"), "WRITE_REFUSED");
});
