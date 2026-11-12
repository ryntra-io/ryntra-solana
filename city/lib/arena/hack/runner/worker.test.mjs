// Run from repo root: node --test city/lib/arena/hack/runner/worker.test.mjs
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { f, runner, inProc, session, FINDING_META, EXPLOIT } from "./fixtures.mjs";
import { ENGINE_PATH, CHECKS_PATH, HANG_PATH, NET_PATH } from "./fixtures.mjs";

const { createWorkerBackend } = runner;

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const stamp = { secretPem: privateKey.export({ type: "pkcs8", format: "pem" }), publicPem: publicKey.export({ type: "spki", format: "pem" }) };
const snapshot = f.makeSnapshot();

const workerBackend = (over = {}) =>
  createWorkerBackend({ enginePath: ENGINE_PATH, invariantsPath: CHECKS_PATH, invariantsArg: { vault: f.VAULT }, snapshot, stamp, ...over });

test("the worker runs the sandbox and proves it — the same log as in process, PASS", async () => {
  const backend = workerBackend();
  try {
    const out = await backend.execute({ attempt: f.attempt(), prove: { at: f.AT, window: f.WINDOW, costMicroUsd: 1_234 } });
    assert.equal(out.run.ok, true);
    assert.equal(out.run.reproduced, true);
    assert.equal(out.proof.judgement.verdict, "PASS");
    const here = await inProc().execute({ attempt: f.attempt(), prove: { at: f.AT, window: f.WINDOW, costMicroUsd: 1_234 } });
    assert.equal(out.run.logHash, here.run.logHash);
  } finally {
    await backend.close();
  }
});

test("the hard time wall stops a single long synchronous step — the seat loses, the request does not hang", async () => {
  const backend = createWorkerBackend({ enginePath: HANG_PATH, invariantsPath: CHECKS_PATH, invariantsArg: { vault: f.VAULT }, snapshot, graceMs: 200 });
  try {
    const started = Date.now();
    const out = await backend.execute({ attempt: f.attempt({ limits: { ...f.sb.DEFAULT_LIMITS, ms: 1_000 } }), prove: null });
    assert.equal(out.run.ok, false);
    assert.equal(out.run.refusal, "ENGINE");
    assert.match(out.run.detail, /hard-timeout/);
    assert.ok(Date.now() - started < 5_000, "the wall came down near the limit, not at the step's own end");
  } finally {
    await backend.close();
  }
});

test("a step that reaches for the network inside the worker is refused whole (NETWORK)", async () => {
  const backend = createWorkerBackend({ enginePath: NET_PATH, invariantsPath: CHECKS_PATH, invariantsArg: { vault: f.VAULT }, snapshot });
  try {
    const out = await backend.execute({ attempt: f.attempt(), prove: null });
    assert.equal(out.run.ok, false);
    assert.equal(out.run.refusal, "NETWORK");
  } finally {
    await backend.close();
  }
});

test("a session over the worker backend submits a finding end to end", async () => {
  const backend = workerBackend();
  try {
    const s = session(backend);
    const out = await s.submit(EXPLOIT, { ...FINDING_META, costMicroUsd: 900 });
    assert.equal(out.ok, true);
    assert.equal(out.judgement.verdict, "PASS");
    assert.equal(out.finding.logHash, out.logHash);
  } finally {
    await backend.close();
  }
});

test("the routes process keeps its own globals: the worker's offline wall never swaps them here", async () => {
  const before = globalThis.fetch;
  const backend = workerBackend();
  try {
    await backend.execute({ attempt: f.attempt(), prove: null });
    assert.equal(globalThis.fetch, before);
    assert.ok(!String(globalThis.fetch).includes("refused"));
  } finally {
    await backend.close();
  }
});
