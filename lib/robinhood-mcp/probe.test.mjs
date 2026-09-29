import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PROBE_TARGETS } from "./reachability.ts";
import { probeRobinhoodMcp, resetProbeMemo } from "./probe.ts";

beforeEach(function () { resetProbeMemo(); });

function deps(handler, clock = { value: 1_000 }) {
  const calls = [];
  return {
    calls,
    clock,
    fetcher: async function (url, init) {
      calls.push({
        url,
        method: init.method,
        body: init.body ?? null,
        redirect: init.redirect,
        hasSignal: init.signal instanceof AbortSignal,
      });
      return handler(url);
    },
    now: function () { return clock.value; },
    nowIso: function () { return "2026-08-24T00:00:00.000Z"; },
  };
}

function response(status, body, headers) {
  return new Response(body, { status, headers });
}

function targetById(id) {
  return PROBE_TARGETS.find(function (target) { return target.id === id; });
}

test("the probe asks the pinned targets and reads nothing from a caller", async function () {
  const d = deps(function () { return response(403, "blocked"); });
  await probeRobinhoodMcp(d);
  assert.deepEqual(
    d.calls.map(function (call) { return call.url; }).sort(),
    PROBE_TARGETS.map(function (target) { return target.url; }).sort(),
  );
  for (const call of d.calls) {
    assert.equal(call.redirect, "manual", "a redirect is an answer, not a hop to follow");
    assert.equal(call.hasSignal, true, "every request must be bounded by a timeout");
  }
});

test("a refusal is reported in the venue's own words", async function () {
  const sentence = "Your request has been blocked due to originating from a jurisdiction restricted by US sanctions.";
  const report = await probeRobinhoodMcp(deps(function () { return response(403, sentence); }));
  assert.equal(report.state, "JURISDICTION_BLOCKED");
  assert.equal(report.discoveryPossible, false);
  for (const entry of report.observed) {
    assert.equal(entry.httpStatus, 403);
    assert.equal(entry.providerMessage, sentence);
    assert.equal(entry.sentence, sentence);
  }
  assert.deepEqual(
    report.observed.map(function (entry) { return entry.id; }).sort(),
    PROBE_TARGETS.map(function (target) { return target.id; }).sort(),
  );
});

test("a 200 body is never kept, because this probe is not a reader of venue data", async function () {
  const report = await probeRobinhoodMcp(deps(function () { return response(200, '{"tools":["place_equity_order"]}'); }));
  assert.equal(report.state, "REACHABLE");
  assert.equal(report.discoveryPossible, true);
  for (const entry of report.observed) {
    assert.equal(entry.providerMessage, null, "an answered body must not be captured");
  }
});

test("a thrown request becomes UNREACHABLE, never a status", async function () {
  const report = await probeRobinhoodMcp(deps(function () { throw new Error("socket hang up"); }));
  assert.equal(report.state, "UNREACHABLE");
  assert.equal(report.discoveryPossible, false);
  for (const entry of report.observed) {
    assert.equal(entry.httpStatus, null);
  }
});

test("one open door does not open the report", async function () {
  const report = await probeRobinhoodMcp(deps(function (url) {
    return url === PROBE_TARGETS[0].url ? response(200, "") : response(403, "no");
  }));
  assert.equal(report.state, "JURISDICTION_BLOCKED");
  assert.equal(report.discoveryPossible, false);
});

test("caller volume does not become upstream volume", async function () {
  const clock = { value: 1_000 };
  const d = deps(function () { return response(403, "no"); }, clock);
  const first = await probeRobinhoodMcp(d);
  assert.equal(first.cached, false);
  for (let i = 0; i < 25; i += 1) {
    const again = await probeRobinhoodMcp(d);
    assert.equal(again.cached, true);
    assert.equal(again.state, first.state);
  }
  assert.equal(d.calls.length, PROBE_TARGETS.length, "26 callers, one round of upstream calls");

  /* And the memo expires rather than freezing a stale answer in place. */
  clock.value += 300_001;
  const fresh = await probeRobinhoodMcp(d);
  assert.equal(fresh.cached, false);
  assert.equal(d.calls.length, PROBE_TARGETS.length * 2);
});

test("each target is probed with the method it declares, not with one method for all", function () {
  /* The first version declared a method per target and then sent GET to every
     one of them. Production answered `405 method not allowed` on the transport,
     which is a true statement about a GET and says nothing about whether the MCP
     endpoint would answer a client. A probe whose request does not match what it
     claims to be probing produces a measurement of itself. */
  const d = deps(function () { return response(401, "no"); });
  return probeRobinhoodMcp(d).then(function () {
    const byUrl = new Map(d.calls.map(function (call) { return [call.url, call]; }));
    for (const target of PROBE_TARGETS) {
      assert.equal(byUrl.get(target.url).method, target.method, target.id);
    }
    const transport = byUrl.get(targetById("mcp-transport").url);
    assert.equal(transport.method, "POST");
    const body = JSON.parse(transport.body);
    assert.equal(body.method, "initialize");
    assert.equal(body.jsonrpc, "2.0");
    /* The handshake carries a client name and nothing else about anybody. */
    assert.equal(body.params.clientInfo.name, "ryntra-reachability-probe");
    for (const metadata of ["protected-resource-metadata", "authorization-server-metadata"]) {
      assert.equal(byUrl.get(targetById(metadata).url).method, "GET");
      assert.equal(byUrl.get(targetById(metadata).url).body, null);
    }
  });
});

test("a WWW-Authenticate challenge is captured, because it is a question and not an answer", async function () {
  const challenge = 'Bearer resource_metadata="https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading"';
  const report = await probeRobinhoodMcp(deps(function () {
    return response(401, "unauthorized", { "www-authenticate": challenge });
  }));
  assert.equal(report.state, "AUTHENTICATION_REQUIRED");
  assert.equal(report.discoveryPossible, false);
  for (const entry of report.observed) {
    assert.equal(entry.challenge, challenge);
  }
});

test("an OAuth metadata document is read into the standards' own fields, and nothing else", async function () {
  const document = JSON.stringify({
    issuer: "https://agent.robinhood.com",
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    client_secret: "must never appear",
  });
  const report = await probeRobinhoodMcp(deps(function (url) {
    return url === targetById("mcp-transport").url
      ? response(401, "unauthorized")
      : response(200, document, { "content-type": "application/json" });
  }));
  const metadata = report.observed.find(function (entry) { return entry.id === "authorization-server-metadata"; });
  assert.equal(metadata.state, "REACHABLE");
  assert.deepEqual(metadata.metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(metadata.metadata.code_challenge_methods_supported, ["S256"]);
  assert.ok(!("client_secret" in metadata.metadata));
  /* The transport's own body is still never kept, whatever it answers. */
  const transport = report.observed.find(function (entry) { return entry.id === "mcp-transport"; });
  assert.equal(transport.metadata, null);
});

test("a metadata document that is not JSON yields no facts rather than a guess", async function () {
  const report = await probeRobinhoodMcp(deps(function () {
    return response(200, "<html>login</html>", { "content-type": "text/html" });
  }));
  for (const entry of report.observed) {
    assert.equal(entry.metadata, null);
  }
});

test("the probe holds no credential and no way to disguise its origin", function () {
  const source = readFileSync(new URL("./probe.ts", import.meta.url), "utf8");
  for (const forbidden of [
    /authorization/i,
    /\bbearer\b/i,
    /process\.env/,
    /\bvpn\b/i,
    /\bproxy\b/i,
    /x-forwarded-for/i,
    /searchParams/,
    /req\./,
  ]) {
    assert.ok(!forbidden.test(source), "probe.ts must not contain " + forbidden);
  }
});
