// Run from repo root:
// node --test --test-isolation=none lib/agent-control/a2a/inbound.test.mjs
//
// Inbound A2A, and the one thing it may become. Gates proved red are labelled
// GATE-PROVED; each was broken deliberately, seen fail, and reverted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  A2A_CALLER_AUTHENTICATION,
  A2A_CARD_AUTHENTICITY,
  A2A_INTERRUPTED_STATES,
  A2A_PROTOCOL_VERSION,
  A2A_TASK_STATES,
  A2A_TERMINAL_STATES,
  A2aIngestError,
  RYNTRA_OWNER_AUTHORIZATION,
  ingestA2aTask,
} from "./inbound.ts";
import { mcpWriteRefusal } from "../mcp/write-gate.ts";

const source = readFileSync(new URL("./inbound.ts", import.meta.url), "utf8");

const CARD = {
  name: "Counterparty research agent",
  protocolVersion: A2A_PROTOCOL_VERSION,
  version: "2.4.0",
  skills: ["market-research", "filing-summary"],
  cardAuthenticity: "NOT_ASSERTED",
};

function inbound(overrides = {}) {
  return {
    actionRef: "action:a2a/inbound-task@1",
    task: {
      id: "task-9f2",
      contextId: "ctx-41",
      state: "TASK_STATE_SUBMITTED",
      artifacts: [],
      terminalResult: null,
      ...(overrides.task ?? {}),
    },
    agentCard: { ...CARD, ...(overrides.agentCard ?? {}) },
    callerAuthentication: overrides.callerAuthentication ?? "UNAUTHENTICATED",
  };
}

function refusedWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    const code = error instanceof A2aIngestError ? error.reasonCode : mcpWriteRefusal(error);
    assert.equal(code, reasonCode, `expected ${reasonCode}, got ${code}: ${error?.message ?? error}`);
    return error;
  }
  assert.fail(`expected ${reasonCode}, nothing was refused`);
}

test("GATE-PROVED: the nine task states are pinned from A2A 1.0.0, not from an earlier revision", function () {
  assert.deepEqual([...A2A_TASK_STATES], [
    "TASK_STATE_UNSPECIFIED",
    "TASK_STATE_SUBMITTED",
    "TASK_STATE_WORKING",
    "TASK_STATE_COMPLETED",
    "TASK_STATE_FAILED",
    "TASK_STATE_CANCELED",
    "TASK_STATE_INPUT_REQUIRED",
    "TASK_STATE_REJECTED",
    "TASK_STATE_AUTH_REQUIRED",
  ]);

  /* Earlier A2A revisions published hyphenated strings. Those are not what
     1.0.0 publishes, and a mirror that drifted back to them would silently stop
     matching every real payload. */
  for (const legacy of ["auth-required", "input-required", "submitted", "working", "completed"]) {
    assert.ok(
      !A2A_TASK_STATES.includes(legacy),
      `${legacy} is a pre-1.0 spelling and must not be a value`,
    );
    assert.doesNotMatch(source, new RegExp(`"${legacy}"`), `${legacy} appears as a literal`);
  }

  /* The specification's own classification, not a reading of it. */
  assert.deepEqual([...A2A_TERMINAL_STATES], [
    "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED",
  ]);
  assert.deepEqual([...A2A_INTERRUPTED_STATES], ["TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"]);
});

test("every ingestible state produces one proposal at PROPOSE and nothing else", function () {
  for (const state of A2A_TASK_STATES) {
    if (state === "TASK_STATE_UNSPECIFIED") continue;
    const terminal = A2A_TERMINAL_STATES.includes(state);
    const proposal = ingestA2aTask(inbound({
      task: { state, terminalResult: terminal ? "the counterparty returned a summary" : null },
    }));

    assert.equal(proposal.kind, "AGENT_CONTROL_PROPOSAL", `${state} produced a foreign kind`);
    assert.equal(proposal.phase, "PROPOSE", `${state} left the record past PROPOSE`);
    assert.equal(proposal.promotes, null, `${state} promoted something`);
    assert.equal(proposal.admission.effect, "PROPOSAL_ONLY");
    assert.notEqual(proposal.ownerAuthorization, "GRANTED_BY_OWNER", `${state} granted authority`);
  }
});

test("GATE-PROVED: a completed A2A task promotes nothing — no Receipt, no MATCHED, no authorization", function () {
  const completed = ingestA2aTask(inbound({
    task: {
      state: "TASK_STATE_COMPLETED",
      terminalResult: "delivered",
      artifacts: [{ id: "artifact-1", name: "summary.md" }],
    },
  }));

  assert.equal(completed.taskStateClass, "TERMINAL");
  assert.equal(completed.promotes, null);
  assert.equal(completed.ownerAuthorization, "NOT_REQUESTED");
  assert.equal(completed.event, null);

  /* `completed` is the state of somebody else's task. No *field* of the
     produced record may carry a Ryntra settlement word.

     `limitations` is excluded from the scan on purpose, and the exclusion took
     one red run to find: the honest sentence a terminal record has to carry is
     "It is not a Ryntra MATCHED", so a blanket search for the word refuses the
     denial along with the claim. The distinction the test needs is between a
     status the record *asserts* and a status it *disclaims*. */
  const { limitations, ...asserted } = completed;
  const serialized = JSON.stringify(asserted);
  assert.doesNotMatch(serialized, /MATCHED/);
  assert.doesNotMatch(serialized, /OUTCOME_RECEIPT/);
  assert.doesNotMatch(serialized, /SETTLED/);
  assert.ok(
    limitations.some((line) => /not a Ryntra MATCHED/.test(line)),
    "a terminal record must say what it is not",
  );
});

test("GATE-PROVED: a credential is not an authorization — the two axes never meet", function () {
  /* A2A §7.6.1 permits an agent to resume work the moment a credential arrives.
     That is a fine protocol rule and a catastrophic product rule, so nothing
     here reads `callerAuthentication` when deciding `ownerAuthorization`. */
  for (const authentication of A2A_CALLER_AUTHENTICATION) {
    const open = ingestA2aTask(inbound({ callerAuthentication: authentication }));
    assert.equal(open.callerAuthentication, authentication);
    assert.equal(
      open.ownerAuthorization,
      "NOT_REQUESTED",
      `${authentication} moved the authorization axis`,
    );

    const asking = ingestA2aTask(inbound({
      task: { state: "TASK_STATE_AUTH_REQUIRED" },
      callerAuthentication: authentication,
    }));
    assert.equal(
      asking.ownerAuthorization,
      "REQUESTED",
      `${authentication} changed what asking means`,
    );
  }

  /* And the absence is structural: the module has no expression that reads the
     authentication axis while computing the authorization one. */
  const decision = source.slice(source.indexOf("const ownerAuthorization"));
  const statement = decision.slice(0, decision.indexOf(";"));
  assert.doesNotMatch(statement, /callerAuthentication/, "authorization was derived from authentication");
});

test("GATE-PROVED: TASK_STATE_AUTH_REQUIRED raises the canonical event and asks, at PROPOSE", function () {
  const asking = ingestA2aTask(inbound({ task: { state: "TASK_STATE_AUTH_REQUIRED" } }));
  assert.equal(asking.event, "A2A_AUTH_REQUIRED", "the stored record names this event");
  assert.equal(asking.phase, "PROPOSE");
  assert.equal(asking.taskStateClass, "INTERRUPTED");
  assert.equal(asking.ownerAuthorization, "REQUESTED");

  /* Every other state raises no event at all. */
  for (const state of A2A_TASK_STATES) {
    if (state === "TASK_STATE_UNSPECIFIED" || state === "TASK_STATE_AUTH_REQUIRED") continue;
    const other = ingestA2aTask(inbound({
      task: { state, terminalResult: A2A_TERMINAL_STATES.includes(state) ? "done" : null },
    }));
    assert.equal(other.event, null, `${state} raised an authorization event`);
  }
});

test("GRANTED_BY_OWNER is on the ladder and unreachable from every input this module accepts", function () {
  /* Drawn rather than omitted, the same way `PROVEN` is drawn and unreachable
     for an ERC-8004 reputation signal: a ladder that stops early reads as a
     product where nobody ever authorizes anything. */
  assert.ok(RYNTRA_OWNER_AUTHORIZATION.includes("GRANTED_BY_OWNER"));

  const reached = new Set();
  for (const state of A2A_TASK_STATES) {
    if (state === "TASK_STATE_UNSPECIFIED") continue;
    for (const authentication of A2A_CALLER_AUTHENTICATION) {
      for (const authenticity of A2A_CARD_AUTHENTICITY) {
        const proposal = ingestA2aTask(inbound({
          task: {
            state,
            terminalResult: A2A_TERMINAL_STATES.includes(state) ? "done" : null,
          },
          agentCard: { cardAuthenticity: authenticity },
          callerAuthentication: authentication,
        }));
        reached.add(proposal.ownerAuthorization);
      }
    }
  }
  assert.deepEqual([...reached].sort(), ["NOT_REQUESTED", "REQUESTED"]);
});

test("GATE-PROVED: a signed Agent Card is evidence, never authority", function () {
  /* A2A §8.4 lets a card carry a JWS block. It attests that the card was not
     modified. It says nothing at all about what the holder may do. */
  const asserted = ingestA2aTask(inbound({ agentCard: { cardAuthenticity: "ASSERTED_UNVERIFIED" } }));
  assert.equal(asserted.agentCardAuthenticity, "ASSERTED_UNVERIFIED");
  assert.equal(asserted.ownerAuthorization, "NOT_REQUESTED");

  const plain = ingestA2aTask(inbound({ agentCard: { cardAuthenticity: "NOT_ASSERTED" } }));
  assert.equal(plain.ownerAuthorization, asserted.ownerAuthorization);
  assert.equal(plain.phase, asserted.phase);

  /* Ryntra never claims to have checked it. `ASSERTED_UNVERIFIED` is the whole
     vocabulary — there is no `VERIFIED` value to reach by accident. */
  assert.deepEqual([...A2A_CARD_AUTHENTICITY], ["NOT_ASSERTED", "ASSERTED_UNVERIFIED"]);
});

test("the Agent Card digest is computed here, never accepted from the caller", function () {
  const first = ingestA2aTask(inbound());
  const same = ingestA2aTask(inbound());
  assert.equal(first.agentCardDigest, same.agentCardDigest, "the same card must digest the same");
  assert.match(first.agentCardDigest, /^0x[0-9a-f]{64}$/);

  const different = ingestA2aTask(inbound({ agentCard: { version: "2.5.0" } }));
  assert.notEqual(first.agentCardDigest, different.agentCardDigest, "a changed card must change the digest");

  /* A caller-supplied digest is the caller telling us what its own document
     hashes to, so the schema refuses the field outright. */
  const withClaim = inbound();
  withClaim.agentCard.digest = `0x${"a".repeat(64)}`;
  refusedWith("A2A_TASK_MALFORMED", () => ingestA2aTask(withClaim));
});

test("an indeterminate state is refused rather than mapped to something", function () {
  refusedWith("A2A_TASK_STATE_INDETERMINATE", () =>
    ingestA2aTask(inbound({ task: { state: "TASK_STATE_UNSPECIFIED" } })));
  refusedWith("A2A_TASK_MALFORMED", () =>
    ingestA2aTask(inbound({ task: { state: "TASK_STATE_INVENTED" } })));
});

test("a result on a task that has not ended is a conclusion nobody reached", function () {
  refusedWith("A2A_TERMINAL_RESULT_WITHOUT_TERMINAL_STATE", () =>
    ingestA2aTask(inbound({ task: { state: "TASK_STATE_WORKING", terminalResult: "done" } })));
  refusedWith("A2A_TERMINAL_RESULT_WITHOUT_TERMINAL_STATE", () =>
    ingestA2aTask(inbound({ task: { state: "TASK_STATE_AUTH_REQUIRED", terminalResult: "done" } })));
});

test("only A2A 1.0.0 is read, and a different generation refuses by name", function () {
  refusedWith("A2A_PROTOCOL_VERSION_UNSUPPORTED", () =>
    ingestA2aTask(inbound({ agentCard: { protocolVersion: "0.3.0" } })));
  refusedWith("A2A_PROTOCOL_VERSION_UNSUPPORTED", () =>
    ingestA2aTask(inbound({ agentCard: { protocolVersion: "1.1.0" } })));
});

test("the write gate runs first, so A2A never gets its own private policy", function () {
  const authority = inbound();
  authority.task.approved = true;
  refusedWith("OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER", () => ingestA2aTask(authority));

  const endpoint = inbound();
  endpoint.agentCard.url = "https://agent.example/.well-known/agent-card.json";
  refusedWith("CALLER_SUPPLIED_ENDPOINT", () => ingestA2aTask(endpoint));

  /* Including the registry scope: this tool proposes A2A records and nothing
     else, whatever reference it is handed. */
  const foreign = inbound();
  foreign.actionRef = "action:bnb-apex/fund-job@1";
  refusedWith("ACTION_NOT_ALLOWED_BY_TOOL", () => ingestA2aTask(foreign));
});

test("the defined field set is what gets stored, and nothing extra", function () {
  const proposal = ingestA2aTask(inbound({
    task: {
      state: "TASK_STATE_AUTH_REQUIRED",
      artifacts: [{ id: "artifact-1", name: "draft.json" }],
    },
  }));

  assert.equal(proposal.taskId, "task-9f2");
  assert.equal(proposal.contextId, "ctx-41");
  assert.equal(proposal.taskState, "TASK_STATE_AUTH_REQUIRED");
  assert.deepEqual([...proposal.skills], ["market-research", "filing-summary"]);
  assert.deepEqual(proposal.artifacts.map((entry) => entry.name), ["draft.json"]);
  assert.equal(proposal.terminalResult, null);
  assert.equal(proposal.event, "A2A_AUTH_REQUIRED");
  assert.match(proposal.agentCardDigest, /^0x[0-9a-f]{64}$/);

  /* A context id is optional in A2A and stays optional here rather than being
     filled with the task id, which would invent a grouping nobody declared. */
  const solo = ingestA2aTask(inbound({ task: { contextId: null } }));
  assert.equal(solo.contextId, null);
});

test("the module reaches no network, no model and no clock", function () {
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /node:(net|http|https|tls|child_process)/);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /@anthropic|openai|@ai-sdk/i);
  assert.doesNotMatch(source, /Date\.now|new Date\(/);
});
