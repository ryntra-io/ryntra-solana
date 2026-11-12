// Run from repo root: node --test city/lib/arena/hack/machine/machine.test.mjs
//
// The machine with no network (CITY-238): the entry a machine runs, the backend that sends it jobs, the two drivers.
// The entry is run for real, as a process, over the made-up engine (no LiteSVM on this computer needed); Vercel's API
// is a fake that keeps the files it is sent. The same entry on LiteSVM in a real network namespace is the stand
// (`docs/research/city-238-hack-open/stand.mjs`).
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { f, inProc, session, EXPLOIT, FINDING_META } from "../runner/fixtures.mjs";

const { createMachineBackend } = await import("./backend.ts");
const { createProcessDriver, toWslPath } = await import("./drivers/process.ts");
const { createVercelDriver, vercelTransport, VERCEL_ROOT, ENTRY_IN_IMAGE } = await import("./drivers/vercel.ts");
const { MACHINE_PROTOCOL, MachineFailed } = await import("./protocol.ts");
const { tar, tarGz } = await import("./tar.ts");
const { closure, imageFiles, SVM_PACKAGE } = await import("./image.mjs");
const { RANGE_ENGINE } = await import("../ranges/range.ts");

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const ENTRY = here("./entry.mjs");
const TOY_RIG = here("./testing/toy-rig.mjs");
const HANG_RIG = here("./testing/hang-rig.mjs");
const NET_RIG = here("./testing/net-rig.mjs");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const stamp = { stamp: f.judgeLib.createStamper(privateKey), signer: f.judgeLib.signerOf(publicKey) };
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });

/** A port on this computer nothing listens on: what a machine with no way out sees everywhere. */
async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A machine as a process over a rig, whose probe looks at `probe` instead of the public internet. */
const machine = (probe, over = {}) => createProcessDriver({ entry: ENTRY, rig: TOY_RIG, isolated: false, env: { RYNTRA_HACK_PROBE: probe }, ...over });
const prove = { at: f.AT, window: f.WINDOW, costMicroUsd: 1_234 };

test("a run and its proof on the machine: the same log as in process, PASS — and the stamp key never goes there", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hack-machine-test-"));
  const backend = createMachineBackend({ driver: machine(`127.0.0.1:${await closedPort()}`, { dir }), stamp, engine: f.toy.TOY_ENGINE });
  try {
    const out = await backend.execute({ attempt: f.attempt(), prove });
    assert.equal(out.run.ok, true);
    assert.equal(out.run.reproduced, true);
    assert.equal(out.proof.judgement.verdict, "PASS");
    assert.equal(out.proof.proof.deterministic, true);
    const local = await inProc().execute({ attempt: f.attempt(), prove });
    assert.equal(out.run.logHash, local.run.logHash, "the machine wrote the same log");
    assert.equal(out.proof.judgement.logHash, out.run.logHash);

    // Everything that crossed to the machine is in these files: two jobs, and no key in either.
    const sent = readdirSync(dir).filter((name) => name.startsWith("job-")).map((name) => readFileSync(path.join(dir, name), "utf8"));
    assert.equal(sent.length, 2);
    for (const job of sent) assert.ok(!job.includes("PRIVATE KEY") && !job.includes(PEM.split("\n")[1]), "no key in a job");
    const proveJob = JSON.parse(sent[1]);
    assert.equal(proveJob.phase, "prove");
    assert.equal(proveJob.signer, stamp.signer);
    assert.equal(typeof proveJob.stamp.signature, "string");
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a machine that can reach a network does not play: the run voids, nothing is run", async () => {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const faults = [];
  const backend = createMachineBackend({ driver: machine(`127.0.0.1:${server.address().port}`), stamp, onFault: (line) => faults.push(line) });
  try {
    await assert.rejects(backend.execute({ attempt: f.attempt(), prove }), (error) => error instanceof MachineFailed && error.fault === "NETWORK_REACHABLE");
    assert.equal(faults.length, 1);
    assert.match(faults[0], /NETWORK_REACHABLE/);
  } finally {
    await backend.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a step that reaches for the network inside the machine is refused whole (NETWORK): the second wall still stands", async () => {
  const backend = createMachineBackend({ driver: machine(`127.0.0.1:${await closedPort()}`, { rig: NET_RIG }), stamp });
  try {
    const out = await backend.execute({ attempt: f.attempt(), prove });
    assert.equal(out.run.ok, false);
    assert.equal(out.run.refusal, "NETWORK");
    assert.equal(out.proof, null);
  } finally {
    await backend.close();
  }
});

test("the hard wall: a step that never ends is killed with its process — the seat loses, the request does not hang", async () => {
  const backend = createMachineBackend({ driver: machine(`127.0.0.1:${await closedPort()}`, { rig: HANG_RIG }), stamp, graceMs: 300 });
  try {
    const started = Date.now();
    const out = await backend.execute({ attempt: f.attempt({ limits: { ...f.sb.DEFAULT_LIMITS, ms: 1_500 } }), prove });
    assert.equal(out.run.ok, false);
    assert.equal(out.run.refusal, "ENGINE");
    assert.match(out.run.detail, /hard-timeout/);
    assert.equal(out.proof, null);
    assert.ok(Date.now() - started < 8_000, "the wall came down near the limit");
    // The next attempt opens a fresh machine.
    const again = await backend.execute({ attempt: f.attempt({ limits: { ...f.sb.DEFAULT_LIMITS, ms: 1_000 } }), prove: null });
    assert.match(again.run.detail, /hard-timeout/);
  } finally {
    await backend.close();
  }
});

test("the machine plays only a pin it holds itself: a job cannot bring its own state", async () => {
  const backend = createMachineBackend({ driver: machine(`127.0.0.1:${await closedPort()}`), stamp });
  try {
    const other = f.makeSnapshot({ slot: f.SLOT + 1 });
    const target = { ...f.TARGET, slot: f.SLOT + 1 };
    const out = await backend.execute({ attempt: f.attempt({ pin: f.pinFor(other, target), target }), prove });
    assert.equal(out.run.ok, false);
    assert.equal(out.run.refusal, "NO_SNAPSHOT");
  } finally {
    await backend.close();
  }
});

test("a machine on another engine than the ranges' is a fault, not a run", async () => {
  const backend = createMachineBackend({ driver: machine(`127.0.0.1:${await closedPort()}`), stamp, engine: RANGE_ENGINE });
  try {
    await assert.rejects(backend.execute({ attempt: f.attempt(), prove: null }), (error) => error instanceof MachineFailed && error.fault === "PROTOCOL");
  } finally {
    await backend.close();
  }
});

test("a session over the machine backend submits a finding end to end", async () => {
  const backend = createMachineBackend({ driver: machine(`127.0.0.1:${await closedPort()}`), stamp });
  try {
    const out = await session(backend).submit(EXPLOIT, { ...FINDING_META, costMicroUsd: 900 });
    assert.equal(out.ok, true);
    assert.equal(out.judgement.verdict, "PASS");
    assert.equal(out.finding.logHash, out.logHash);
  } finally {
    await backend.close();
  }
});

test("the process machine is a stand's: it is refused in production", () => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createProcessDriver({ entry: ENTRY, isolated: true }), /production/);
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
  assert.equal(toWslPath("D:\\work\\x\\job.json"), "/mnt/d/work/x/job.json");
});

// ------------------------------------------------------------------------------------------------ Vercel Sandbox

/** Reads a `.tar.gz` back: name → text. */
function untar(bytes) {
  const data = gunzipSync(bytes);
  const files = {};
  for (let at = 0; at + 512 <= data.length; ) {
    const header = data.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const cut = (from, len) => header.subarray(from, from + len).toString("utf8").replace(/\0.*$/, "");
    // The header's checksum, as tar reads it: the sum of its bytes with the checksum field as spaces.
    const sum = header.reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0);
    assert.equal(parseInt(cut(148, 8), 8), sum, "the header's checksum");
    assert.equal(cut(257, 6), "ustar");
    const name = (cut(345, 155) ? `${cut(345, 155)}/` : "") + cut(0, 100);
    const size = parseInt(cut(124, 12), 8);
    files[name] = data.subarray(at + 512, at + 512 + size).toString("utf8");
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Vercel's API as far as the driver uses it. `answer(job)` plays the machine; `policy` is what the firewall reads back as. */
function fakeVercel({ policy = "deny-all", answer, exitCode = 0 } = {}) {
  const calls = [];
  const disk = {};
  const json = (status, body) => ({ status, body: new Uint8Array(Buffer.from(JSON.stringify(body))) });
  const transport = async (request) => {
    calls.push(request);
    const { method, path: route } = request;
    if (method === "POST" && route === "/v4/sandboxes") return json(200, { sandbox: { name: request.json.name }, session: { id: "sbx_1", networkPolicy: { mode: policy } } });
    if (method === "POST" && route.endsWith("/fs/write")) {
      for (const [name, text] of Object.entries(untar(request.bytes))) disk[`${request.headers["x-cwd"]}/${name}`] = text;
      return json(200, {});
    }
    if (method === "POST" && route.endsWith("/cmd")) {
      const [, jobPath, answerPath] = request.json.args;
      const made = answer ? answer(JSON.parse(disk[jobPath])) : undefined;
      if (made !== undefined) disk[answerPath] = JSON.stringify(made);
      const line = (code) => JSON.stringify({ command: { id: "cmd_1", exitCode: code } });
      return { status: 200, body: new Uint8Array(Buffer.from(`${line(null)}\n${line(exitCode)}\n`)) };
    }
    if (method === "POST" && route.endsWith("/fs/read")) return request.json.path in disk ? { status: 200, body: new Uint8Array(Buffer.from(disk[request.json.path])) } : json(404, { error: "no such file" });
    if (method === "POST" && route.endsWith("/stop")) return json(200, { session: { id: "sbx_1", status: "stopping" } });
    if (method === "DELETE") return json(200, {});
    return json(404, {});
  };
  return { transport, calls, disk };
}

const vercel = (fake, over = {}) => createVercelDriver({ transport: fake.transport, snapshotId: "snap_1", projectId: "prj_1", teamId: "team_1", newName: () => "ryntra-hack-test", ...over });

test("Vercel Sandbox: a machine starts from the image with every way out denied, plays a job from a file, and is stopped", async () => {
  const run = { ok: false, runId: "run-1", refusal: "BAD_ATTEMPT", detail: "x" };
  const fake = fakeVercel({ answer: (job) => ({ v: MACHINE_PROTOCOL, ok: true, phase: job.phase, run, engine: RANGE_ENGINE }) });
  const backend = createMachineBackend({ driver: vercel(fake), stamp, engine: RANGE_ENGINE });
  const out = await backend.execute({ attempt: f.attempt({ limits: { ...f.sb.DEFAULT_LIMITS, ms: 5_000 } }), prove: null });
  assert.deepEqual(out.run, run);
  await backend.close();
  await backend.close();

  const [create, write, cmd, read, stop, remove] = fake.calls;
  assert.equal(create.path, "/v4/sandboxes");
  assert.deepEqual(create.query, { teamId: "team_1" });
  assert.deepEqual(create.json.networkPolicy, { mode: "deny-all" });
  assert.deepEqual(create.json.source, { type: "snapshot", snapshotId: "snap_1" });
  assert.equal(create.json.persistent, false);
  assert.equal(create.json.projectId, "prj_1");
  assert.equal(write.headers["x-cwd"], VERCEL_ROOT);
  assert.deepEqual(Object.keys(untar(write.bytes)), ["jobs/job-1.json"]);
  assert.equal(cmd.json.command, "node");
  assert.deepEqual(cmd.json.args, [`${VERCEL_ROOT}/${ENTRY_IN_IMAGE}`, `${VERCEL_ROOT}/jobs/job-1.json`, `${VERCEL_ROOT}/jobs/answer-1.json`]);
  assert.equal(cmd.json.wait, true);
  assert.equal(cmd.json.timeout, 7_000, "the machine kills the process at the run's limit and the grace");
  assert.equal(read.json.path, `${VERCEL_ROOT}/jobs/answer-1.json`);
  assert.match(stop.path, /\/sessions\/sbx_1\/stop$/);
  assert.equal(remove.method, "DELETE");
  assert.equal(fake.calls.length, 6, "stopped once");
});

test("Vercel Sandbox: a machine whose firewall does not read back as deny-all is stopped and never played on", async () => {
  const fake = fakeVercel({ policy: "allow-all", answer: () => ({ v: MACHINE_PROTOCOL, ok: true, phase: "run", run: {}, engine: RANGE_ENGINE }) });
  const backend = createMachineBackend({ driver: vercel(fake), stamp });
  await assert.rejects(backend.execute({ attempt: f.attempt(), prove: null }), (error) => error instanceof MachineFailed && error.fault === "NETWORK_REACHABLE");
  assert.ok(!fake.calls.some((call) => call.path.endsWith("/cmd")), "nothing ran");
  assert.ok(fake.calls.some((call) => call.path.endsWith("/stop")), "the machine was stopped");
});

test("Vercel Sandbox: a process killed at the wall leaves no answer — the seat loses", async () => {
  const fake = fakeVercel({ exitCode: 137 });
  const backend = createMachineBackend({ driver: vercel(fake), stamp });
  const out = await backend.execute({ attempt: f.attempt(), prove: null });
  assert.equal(out.run.ok, false);
  assert.match(out.run.detail, /hard-timeout/);
  assert.ok(fake.calls.some((call) => call.path.endsWith("/stop")), "the machine was dropped");
});

test("Vercel Sandbox: an API that refuses is a fault of the machine, never the agent's", async () => {
  const transport = async () => ({ status: 402, body: new Uint8Array(Buffer.from("payment required")) });
  const backend = createMachineBackend({ driver: createVercelDriver({ transport, snapshotId: "snap_1", projectId: "prj_1" }), stamp });
  await assert.rejects(backend.execute({ attempt: f.attempt(), prove: null }), (error) => error instanceof MachineFailed && error.fault === "UNREACHABLE" && /402/.test(error.message));
});

test("the server's transport: a bearer token read on every call, the team in the query, bytes sent as they are", async () => {
  const seen = [];
  const send = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  };
  let token = "t-1";
  const transport = vercelTransport({ token: () => token, fetch: send });
  await transport({ method: "POST", path: "/v4/sandboxes", query: { teamId: "team_1" }, json: { a: 1 } });
  token = "t-2";
  await transport({ method: "POST", path: "/v2/x/fs/write", headers: { "x-cwd": "/a" }, bytes: new Uint8Array([1, 2, 3]) });
  assert.equal(seen[0].url, "https://api.vercel.com/v4/sandboxes?teamId=team_1");
  assert.equal(seen[0].init.headers.authorization, "Bearer t-1");
  assert.equal(seen[0].init.body, '{"a":1}');
  assert.equal(seen[1].init.headers.authorization, "Bearer t-2");
  assert.deepEqual([...seen[1].init.body], [1, 2, 3]);
  token = null;
  await assert.rejects(transport({ method: "GET", path: "/v2/x" }), /no token/);
});

// --------------------------------------------------------------------------------------------- the image, the tar

test("tar: plain ustar that reads back, long names cut at a slash, the same bytes every time", () => {
  const long = `${"a".repeat(90)}/${"b".repeat(90)}/c.json`;
  const files = [{ name: "jobs/job-1.json", data: '{"v":1}' }, { name: long, data: new Uint8Array([104, 105]) }];
  assert.deepEqual(untar(tarGz(files)), { "jobs/job-1.json": '{"v":1}', [long]: "hi" });
  assert.ok(tar(files).equals(tar(files)));
  assert.equal(tar(files).length % 512, 0);
  assert.throws(() => tar([{ name: "../up", data: "" }]), /relative/);
  assert.throws(() => tar([{ name: "/abs", data: "" }]), /relative/);
});

test("the image carries the entry, the sandbox, the ranges and the judge — and nothing of the server", () => {
  const files = closure();
  for (const need of ["city/lib/arena/hack/machine/entry.mjs", "city/lib/arena/hack/machine/litesvm.mjs", "city/lib/arena/hack/ranges/recorded.ts", "city/lib/arena/hack/sandbox/offline.ts", "lib/ring/judge/judge.ts"]) {
    assert.ok(files.includes(need), need);
  }
  // No store, no routes, no model gateway, no runner, no driver: the machine cannot hold what it never gets.
  for (const file of files) assert.ok(!/\/(store|runs|runner|drivers|view)\/|^lib\/(models|session|supabase)|^app\//.test(file), `${file} does not belong on the machine`);
  const image = imageFiles();
  assert.equal(JSON.parse(image.find((file) => file.name === "package.json").data).dependencies[SVM_PACKAGE.name], RANGE_ENGINE.version);
  assert.ok(image.every((file) => !/PRIVATE KEY|sk-or-|BETA_APP_SECRET/.test(Buffer.from(file.data).toString("utf8"))), "no secret in the image");
});

test("a driver that hangs never hangs the run: a machine that will not open is a fault, one that will not answer or stop is the wall", async () => {
  const never = new Promise(() => {});
  // It will not open.
  const stuckOpen = createMachineBackend({ driver: { name: "stuck", isolated: true, open: () => never }, stamp, openMs: 150 });
  const started = Date.now();
  await assert.rejects(stuckOpen.execute({ attempt: f.attempt(), prove: null }), (error) => error instanceof MachineFailed && error.fault === "UNREACHABLE" && /did not open/.test(error.message));
  assert.ok(Date.now() - started < 3_000);

  // It opens, then neither answers nor stops: the run is the seat's loss, and the backend comes back.
  let opened = 0;
  const silent = { name: "silent", isolated: true, open: async () => ((opened += 1), { play: () => never, close: () => never }) };
  const backend = createMachineBackend({ driver: silent, stamp, graceMs: 0, driverSlackMs: 100 });
  const before = Date.now();
  const out = await backend.execute({ attempt: f.attempt({ limits: { ...f.sb.DEFAULT_LIMITS, ms: 1_000 } }), prove: null });
  assert.equal(out.run.ok, false);
  assert.match(out.run.detail, /hard-timeout/);
  assert.ok(Date.now() - before < 9_000, "the wall, then at most a moment for the machine to go");
  // The next attempt opens a fresh machine rather than the one that went silent.
  await backend.execute({ attempt: f.attempt({ limits: { ...f.sb.DEFAULT_LIMITS, ms: 1_000 } }), prove: null });
  assert.equal(opened, 2);
});

test("the server's transport gives every call a time to answer in: the command's own, or a short one", async () => {
  const signals = [];
  const send = async (_url, init) => {
    signals.push(init.signal);
    return new Response("{}", { status: 200 });
  };
  const transport = vercelTransport({ token: () => "t", fetch: send, timeoutMs: 50 });
  await transport({ method: "GET", path: "/v2/x" });
  await transport({ method: "POST", path: "/v2/x/cmd", json: {}, timeoutMs: 30_000 });
  assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(signals[0].aborted, true, "a plain call is given up on soon");
  assert.equal(signals[1].aborted, false, "a command that waits for its end has the wall's own time");
  // A hung API is a fault of the machine, never a hung request.
  const hung = vercelTransport({ token: () => "t", fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))), timeoutMs: 40 });
  const backend = createMachineBackend({ driver: createVercelDriver({ transport: hung, snapshotId: "snap_1", projectId: "prj_1" }), stamp });
  await assert.rejects(backend.execute({ attempt: f.attempt(), prove: null }), (error) => error instanceof MachineFailed && error.fault === "UNREACHABLE");
});
