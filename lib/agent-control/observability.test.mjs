import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AGENT_CONTROL_LOG_KIND,
  CredentialInLogError,
  agentControlMetricsSnapshot,
  createAgentControlObserver,
} from "./observability.ts";

function observer() {
  const lines = [];
  return {
    lines,
    observer: createAgentControlObserver({ sink: (line) => lines.push(line) }),
  };
}

const REQUEST = {
  route: "/api/agents/preflight",
  method: "POST",
  requestUrl:
    "https://ryntra.io/api/agents/preflight?apiKey=ryn_ac_0123456789abcdef01234567_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&sig=deadbeef",
  headers: {
    authorization: "Bearer ryn_at_0123456789abcdef01234567_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    cookie: "session=abc123",
    "x-api-key": "ryn_ac_ffffffffffffffffffffffff_ccccccccccccccccccccccccccccccccccccccccccc",
    "user-agent": "grok-connector/1.0",
  },
};

test("one request produces exactly one structured record", () => {
  const { lines, observer: o } = observer();
  o.record({ ...REQUEST, status: 200, outcome: "OK", principal: null, durationMs: 12 });
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.kind, AGENT_CONTROL_LOG_KIND);
  assert.equal(entry.route, "/api/agents/preflight");
  assert.equal(entry.method, "POST");
  assert.equal(entry.status, 200);
  assert.equal(entry.outcome, "OK");
  assert.equal(entry.principal, "anonymous");
  assert.equal(typeof entry.durationMs, "number");
});

test("a record carrying a bearer token, an API key, a cookie and a signed URL prints none of them", () => {
  /*
   * The four places a credential actually arrives, on one real request shape.
   * `redactAgentControlLog` handles the header map and the query string; the
   * assertion here is on the emitted bytes, because that is what a log
   * aggregator stores.
   */
  const { lines, observer: o } = observer();
  o.record({ ...REQUEST, status: 401, outcome: "SECRET_MISMATCH", principal: null, durationMs: 3 });
  const line = lines[0];
  for (const secret of [
    "ryn_ac_0123456789abcdef01234567_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "ryn_at_0123456789abcdef01234567_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "ryn_ac_ffffffffffffffffffffffff_ccccccccccccccccccccccccccccccccccccccccccc",
    "session=abc123",
    "deadbeef",
  ]) {
    assert.ok(!line.includes(secret), `the emitted record contains ${secret.slice(0, 24)}…`);
  }
  const entry = JSON.parse(line);
  assert.equal(entry.headers.authorization, "[REDACTED]");
  assert.equal(entry.headers.cookie, "[REDACTED]");
  assert.equal(entry.headers["x-api-key"], "[REDACTED]");
  assert.equal(entry.headers["user-agent"], "grok-connector/1.0", "harmless headers stay readable");
  assert.ok(!entry.url.includes("aaaa"), entry.url);
});

test("a credential that slipped past redaction stops the line rather than printing it", () => {
  /*
   * Defence in depth, and the gate this module is proved by breaking. Redaction
   * works by field name, so a credential in a field nobody classified would be
   * emitted. The final scan is on the serialized bytes and knows only the three
   * credential shapes this product mints.
   */
  const { lines, observer: o } = observer();
  assert.throws(
    () =>
      o.record({
        route: "/api/agents/preflight",
        method: "POST",
        status: 200,
        outcome: "OK",
        principal: null,
        durationMs: 1,
        detail: {
          /* A field name no redaction list has heard of. */
          debugNote: "ryn_ac_0123456789abcdef01234567_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    (error) => error instanceof CredentialInLogError,
  );
  assert.equal(lines.length, 0, "nothing may be emitted once a credential is detected");
});

test("the principal is a tenant id, never a key", () => {
  const { lines, observer: o } = observer();
  o.record({
    ...REQUEST,
    status: 200,
    outcome: "OK",
    principal: { tenantId: "ten_0123456789abcdef", keyId: "0123456789abcdef01234567", displayName: "Grok", scopes: ["evidence:read"] },
    durationMs: 5,
  });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.principal, "ten_0123456789abcdef");
  assert.equal(entry.keyId, "0123456789abcdef01234567", "the key id identifies which key, and is not the secret");
  assert.ok(!lines[0].includes("Grok") || entry.principal === "ten_0123456789abcdef");
});

test("counters accumulate per route and per outcome", () => {
  const { observer: o } = observer();
  o.record({ route: "/api/agents/verify", method: "POST", status: 200, outcome: "OK", principal: null, durationMs: 4 });
  o.record({ route: "/api/agents/verify", method: "POST", status: 200, outcome: "OK", principal: null, durationMs: 6 });
  o.record({ route: "/api/agents/verify", method: "POST", status: 429, outcome: "RATE_LIMITED", principal: null, durationMs: 1 });
  o.record({ route: "/api/agents/passport", method: "GET", status: 200, outcome: "OK", principal: null, durationMs: 2 });

  const snapshot = agentControlMetricsSnapshot(o);
  const verify = snapshot.routes.find((row) => row.route === "/api/agents/verify");
  assert.equal(verify.requests, 3);
  assert.equal(verify.byOutcome.OK, 2);
  assert.equal(verify.byOutcome.RATE_LIMITED, 1);
  assert.equal(verify.byStatusClass["2xx"], 2);
  assert.equal(verify.byStatusClass["4xx"], 1);
  assert.equal(snapshot.totals.requests, 4);
  assert.equal(snapshot.totals.refused, 1);
  assert.ok(snapshot.observedFromMs <= Date.now());
});

test("the counter map is bounded, so a hostile route or outcome cannot grow it forever", () => {
  const { observer: o } = observer();
  for (let i = 0; i < 500; i += 1) {
    o.record({ route: `/api/agents/x${i}`, method: "GET", status: 200, outcome: `CODE_${i}`, principal: null, durationMs: 1 });
  }
  const snapshot = agentControlMetricsSnapshot(o);
  assert.ok(snapshot.routes.length <= 64, `routes grew to ${snapshot.routes.length}`);
  assert.equal(snapshot.totals.requests, 500, "the total is still exact even when detail is capped");
  assert.ok(snapshot.truncated, "a capped snapshot must say so rather than reading as complete");
});

test("the module writes through the shared redaction pass and never through console", () => {
  const source = readFileSync("lib/agent-control/observability.ts", "utf8");
  assert.ok(source.includes("redactAgentControlLog"), "logging must reuse the audited redaction pass");
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(source), "records go to the sink, not to console");
});
