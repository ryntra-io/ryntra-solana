// Run from repo root: node --test city/lib/x/files.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readStudioEvent } from "./event.ts";
import { launchNight } from "./facts.ts";
import { installClock } from "./clock.mjs";
import { bytesOf, clipProblems, encodeArgs, journalFromRehearsal, keepRead, keptReads, openEncoder, probe, putDraft, QUEUE_MAX_BYTES, studioEvent } from "./files.mjs";

const REHEARSAL = new URL("../../../docs/research/launch-devnet-rehearsal-2026-10-10-micro/evidence.json", import.meta.url);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("the clip X takes: H.264 High, about 8 Mbit/s, a key frame a second, video range BT.709, the index first, no sound", () => {
  const a = encodeArgs("out.mp4", { fps: 30 }).join(" ");
  for (const part of ["-c:v libx264", "-profile:v high", "-b:v 8M", "-g 30", "-movflags +faststart", "-an", "format=yuv420p", "-colorspace bt709", "out_range=tv"]) assert.ok(a.includes(part), part);
  assert.ok(encodeArgs("o.mp4", { fps: 60 }).join(" ").includes("-framerate 60"));
});

test("a clip’s problems: size, frame rate, length, the index", () => {
  const good = { codec: "h264", width: 1080, height: 1350, fps: 30, pix: "yuv420p", seconds: 9, mbps: 7.6, faststart: true };
  assert.deepEqual(clipProblems(good, { width: 1080, height: 1350, fps: 30 }), []);
  assert.deepEqual(clipProblems({ ...good, seconds: 61, faststart: false, height: 1080 }, { width: 1080, height: 1350, fps: 30 }), ["size 1080×1080", "61 s", "the index is not first"]);
});

test("a real encode: JPEG frames in, an MP4 ffprobe reads as X wants it", { skip: !hasFfmpeg && "no ffmpeg" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "x-files-"));
  try {
    // Two seconds of a plain frame, made by ffmpeg itself as JPEG.
    const jpeg = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x2A1640:s=1080x1350:d=0.04", "-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-"]).stdout;
    const enc = openEncoder(path.join(dir, "clip.mp4"), { fps: 30 });
    for (let i = 0; i < 60; i += 1) await enc.write(jpeg);
    const p = probe(await enc.close());
    assert.deepEqual(clipProblems(p, { width: 1080, height: 1350, fps: 30 }), []);
    assert.equal(p.profile, "High");
    assert.equal(p.frames, 60);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a devnet rehearsal’s evidence becomes a flight log: the launch and the graduation, each its transaction", () => {
  const j = journalFromRehearsal(JSON.parse(readFileSync(REHEARSAL, "utf8")));
  assert.equal(j.network, "solana:devnet");
  assert.deepEqual(j.events.map((e) => e.kind), ["LAUNCHED", "GRADUATED"]);
  const f = launchNight(j);
  assert.equal(f.seconds, 71);
  assert.equal(f.launchedAt, "2026-10-09T21:50:05.000Z");
  assert.equal(journalFromRehearsal({ cluster: "devnet", launches: { micro: { receipt: { curve: { migrated: false } } } } }), null);
});

test("reads are kept once each and come back oldest first", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "x-reads-"));
  try {
    const s = (at) => ({ fetchedAt: at, source: "live", towers: [] });
    keepRead(dir, s("2026-10-27T12:00:00.000Z"));
    keepRead(dir, s("2026-10-20T12:00:00.000Z"));
    keepRead(dir, s("2026-10-27T12:00:00.000Z"));
    writeFileSync(path.join(dir, "city-broken.json"), "{");
    assert.deepEqual(keptReads(dir).map((r) => r.fetchedAt), ["2026-10-20T12:00:00.000Z", "2026-10-27T12:00:00.000Z"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the queue’s event: the facts the server reads, and an id that keeps the same facts one draft", () => {
  const hour = { template: "hour", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "$BONK", district: "strip", change: 4, mcap: 1e9, readAt: "2026-10-27T12:00:00.000Z", live: true };
  const e = studioEvent(hour);
  assert.equal(e.id, studioEvent({ ...hour }).id);
  assert.notEqual(e.id, studioEvent({ ...hour, readAt: "2026-10-27T13:00:00.000Z" }).id);
  assert.ok(readStudioEvent(e).ok);
  assert.equal(bytesOf("data:image/png;base64,iVBORw0K").subarray(0, 4).toString("hex"), "89504e47");
});

test("a draft goes in through the machine routes only, the file at most 4 MB", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "x-queue-"));
  try {
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, Buffer.alloc(16));
    const calls = [];
    const fake = async (url, init) => {
      calls.push([init.method, url.replace("http://stand", ""), init.headers.Authorization]);
      if (url.endsWith("/events")) return new Response(JSON.stringify({ draft: { id: "00000000-0000-4000-8000-000000000001", status: "filming" } }), { status: 201 });
      return new Response(JSON.stringify({ draft: { id: "00000000-0000-4000-8000-000000000001", status: "ready" } }), { status: 200 });
    };
    const r = await putDraft("http://stand", "k".repeat(24), { template: "banner", towers: 82, readAt: "2026-10-27T12:00:00.000Z", live: true }, file, "video/mp4", fake);
    assert.equal(r.ok, true);
    assert.deepEqual(calls.map((c) => [c[0], c[1]]), [["POST", "/api/moments/events"], ["PUT", "/api/moments/drafts/00000000-0000-4000-8000-000000000001/clip"]]);
    assert.ok(calls.every((c) => c[2] === `Bearer ${"k".repeat(24)}`));
    writeFileSync(file, Buffer.alloc(QUEUE_MAX_BYTES + 1));
    const big = await putDraft("http://stand", "k".repeat(24), { template: "banner", towers: 82, readAt: "2026-10-27T12:00:00.000Z", live: true }, file, "video/mp4", fake);
    assert.equal(big.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the studio clock: a page on virtual time, stepped frame by frame, its timers in order", () => {
  const real = { raf: [], timers: [] };
  const win = {
    requestAnimationFrame: (fn) => real.raf.push(fn),
    setTimeout: (fn) => real.timers.push(fn),
    clearTimeout: () => {},
  };
  const perf = { now: () => 1000 };
  const doc = { visibilityState: "visible" };
  const saved = { window: globalThis.window, performance: globalThis.performance, document: globalThis.document, Date: globalThis.Date };
  Object.defineProperty(globalThis, "performance", { value: perf, configurable: true, writable: true });
  globalThis.window = win;
  globalThis.document = doc;
  try {
    installClock.call(null, 1000 / 60);
    const clock = win.__xclock;
    clock.hold(true);
    const seen = [];
    win.setTimeout(() => seen.push(["timeout 20", perf.now()]), 20);
    win.setTimeout(() => seen.push(["timeout 5", perf.now()]), 5);
    win.requestAnimationFrame((t) => seen.push(["frame", t]));
    clock.step(1000 / 60);
    assert.deepEqual(seen.map((s) => s[0]), ["timeout 5", "frame"]);
    assert.equal(Math.round(seen[1][1] - 1000), 17);
    clock.step(1000 / 60);
    assert.deepEqual(seen.map((s) => s[0]), ["timeout 5", "frame", "timeout 20"]);
    assert.equal(win.Date.now() - new win.Date().getTime(), 0);
  } finally {
    Object.defineProperty(globalThis, "performance", { value: saved.performance, configurable: true, writable: true });
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.Date = saved.Date;
  }
});
