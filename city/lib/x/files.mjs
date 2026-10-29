// The studio's files (CITY-38): H.264 clips through ffmpeg, their check with ffprobe, the city's reads kept for the
// week's billboard, a flight log from a devnet rehearsal's evidence, and the hand-off to the drafts queue (CITY-3).
// Used by city/lib/x/film.mjs; tested by city/lib/x/files.test.mjs.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** X's feed: 1080 wide, H.264 High, about 8 Mbit/s, the index first so it plays before it has arrived, no sound. */
export const VIDEO = { bitrate: "8M", maxrate: "10M", bufsize: "16M", profile: "high", level: "4.1" };
/** What a draft of the queue holds: one file up to 4 MB (`MEDIA_MAX_BYTES` in city/lib/moments/drafts/store.ts). */
export const QUEUE_MAX_BYTES = 4 * 1024 * 1024;

/** ffmpeg's arguments for a clip from JPEG frames on stdin. */
export function encodeArgs(out, { fps, bitrate = VIDEO.bitrate, maxrate = VIDEO.maxrate, bufsize = VIDEO.bufsize }) {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    // The browser's JPEG is full range; a feed expects video range in BT.709.
    "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-profile:v", VIDEO.profile, "-level", VIDEO.level,
    "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize,
    // A key frame every second, so X can cut and loop it cleanly.
    "-g", String(fps), "-keyint_min", String(fps), "-sc_threshold", "0",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-an", out,
  ];
}

/** An encoder that takes JPEG frames one by one and resolves when the MP4 is written. */
export function openEncoder(out, opts) {
  mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn("ffmpeg", encodeArgs(out, opts), { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => (err += d));
  const done = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg ${code}: ${err.trim().slice(0, 400)}`))));
  });
  return {
    write: (jpeg) => new Promise((resolve, reject) => (ff.stdin.write(jpeg, (e) => (e ? reject(e) : resolve())))),
    close: () => {
      ff.stdin.end();
      return done;
    },
  };
}

/** A smaller copy of a clip for the queue, at the bitrate that fits it under 4 MB (the master keeps its 8 Mbit/s). */
export function queueCopy(master, out, seconds) {
  // 4 MB over the clip's length, less a tenth for the container and the encoder's swing.
  const kbps = Math.floor((QUEUE_MAX_BYTES * 8 * 0.88) / seconds / 1000);
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", "-i", master,
    "-c:v", "libx264", "-preset", "slow", "-profile:v", VIDEO.profile, "-level", VIDEO.level, "-pix_fmt", "yuv420p",
    "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-g", "30",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-an", out,
  ];
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg queue copy: ${r.stderr.slice(0, 400)}`);
  return { file: out, kbps };
}

/** What ffprobe reads from a clip: codec, profile, size, frame rate, length, bitrate, and whether the index is first. */
export function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,nb_frames:format=duration,bit_rate,size", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const s = j.streams[0];
  const [n, d] = s.r_frame_rate.split("/").map(Number);
  const head = readFileSync(file).subarray(0, 64 * 1024);
  const moov = head.indexOf("moov");
  const mdat = head.indexOf("mdat");
  return {
    codec: s.codec_name,
    profile: s.profile,
    width: s.width,
    height: s.height,
    fps: Math.round((n / d) * 100) / 100,
    pix: s.pix_fmt,
    frames: Number(s.nb_frames),
    seconds: Math.round(Number(j.format.duration) * 100) / 100,
    mbps: Math.round(Number(j.format.bit_rate) / 10_000) / 100,
    bytes: Number(j.format.size),
    faststart: moov >= 0 && (mdat < 0 || moov < mdat),
  };
}

/** What a clip for X must be; empty when it holds. */
export function clipProblems(p, { width, height, fps }) {
  const out = [];
  if (p.codec !== "h264") out.push(`codec ${p.codec}`);
  if (p.width !== width || p.height !== height) out.push(`size ${p.width}×${p.height}`);
  if (Math.abs(p.fps - fps) > 0.01) out.push(`${p.fps} fps`);
  if (p.pix !== "yuv420p") out.push(p.pix);
  if (!(p.seconds > 0 && p.seconds <= 60)) out.push(`${p.seconds} s`);
  if (p.mbps > 12) out.push(`${p.mbps} Mbit/s`);
  if (!p.faststart) out.push("the index is not first");
  return out;
}

const DATA_URL = /^data:image\/(png|jpeg);base64,/;

/** The bytes of a canvas's data address. */
export function bytesOf(dataUrl) {
  if (!DATA_URL.test(dataUrl ?? "")) throw new Error("not an image");
  return Buffer.from(dataUrl.replace(DATA_URL, ""), "base64");
}

/* ------------------------------------------------------------------------------------------------ */

const STAMP = (iso) => iso.replace(/[:.]/g, "-");

/** Keeps a read of the city (once per read time), so a billboard a week later can compare. */
export function keepRead(dir, snapshot) {
  if (!snapshot?.fetchedAt || !Array.isArray(snapshot.towers)) return null;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `city-${STAMP(new Date(snapshot.fetchedAt).toISOString())}.json`);
  if (!existsSync(file)) writeFileSync(file, JSON.stringify(snapshot));
  return file;
}

/** The kept reads, oldest first; anything unreadable is left out. */
export function keptReads(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^city-.*\.json$/.test(f) && statSync(path.join(dir, f)).size < 5_000_000)
    .flatMap((f) => {
      try {
        const s = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
        return s?.fetchedAt && Array.isArray(s.towers) ? [s] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt));
}

/**
 * A flight log, in the shape of `GET /api/v1/launch/{mint}/journal`, from the evidence of a devnet rehearsal
 * (docs/research/launch-devnet-rehearsal-*): the launch's receipt (its creation transaction and time) and the
 * migration transaction with its block time. Only what the chain recorded.
 */
export function journalFromRehearsal(evidence, preset = Object.keys(evidence?.launches ?? {})[0]) {
  const l = evidence?.launches?.[preset];
  const receipt = l?.receipt;
  const migration = l?.migration;
  if (!receipt?.created?.at || !receipt.created.signature || !migration?.signature || !Number.isFinite(migration.blockTime) || migration.error) return null;
  if (receipt.curve?.migrated !== true) return null;
  return {
    network: `solana:${evidence.cluster}`,
    token: receipt.token,
    events: [
      { kind: "LAUNCHED", at: new Date(receipt.created.at).toISOString(), signature: receipt.created.signature },
      { kind: "GRADUATED", at: new Date(migration.blockTime * 1000).toISOString(), signature: migration.signature },
    ],
    observedAt: receipt.observedAt,
  };
}

/* ------------------------------------------------------------------------------------------------ */

/** The queue's event for a studio post: its facts and an id that makes the same facts one draft. */
export function studioEvent(facts) {
  const at = (facts.template === "launch" ? facts.graduateTx : facts.readAt).replace(/[^A-Za-z0-9]/g, "").slice(0, 60);
  const what = facts.template === "hour" || (facts.template === "justin" && facts.metric === "core") ? facts.mint : facts.template === "justin" ? facts.metric : facts.template === "billboard" ? facts.ranking : "";
  return { kind: "studio", id: [facts.template, what.slice(0, 44), at].filter(Boolean).join("-"), facts };
}

/**
 * Puts a post in the drafts queue: the event (its words are the server's), then its file. Only the machine routes, with
 * the desk's key; the queue never posts by itself, and nothing here talks to X.
 */
export async function putDraft(base, key, facts, file, type, fetchImpl = fetch) {
  const auth = { Authorization: `Bearer ${key}` };
  const res = await fetchImpl(`${base}/api/moments/events`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(studioEvent(facts)) });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201 && res.status !== 200) return { ok: false, step: "event", status: res.status, body };
  const draft = body.draft;
  if (draft.status !== "filming" && draft.status !== "ready") return { ok: true, draft, already: true };
  const bytes = readFileSync(file);
  if (bytes.byteLength > QUEUE_MAX_BYTES) return { ok: false, step: "clip", status: 413, body: { error: "too_large" } };
  const put = await fetchImpl(`${base}/api/moments/drafts/${draft.id}/clip`, { method: "PUT", headers: { ...auth, "Content-Type": type }, body: bytes });
  const after = await put.json().catch(() => ({}));
  if (!put.ok) return { ok: false, step: "clip", status: put.status, body: after };
  return { ok: true, draft: after.draft };
}
