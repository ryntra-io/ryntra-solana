// The studio for X (CITY-38): premium posts filmed in the city itself, ready for a person to approve.
//   npm run dev                                   (a development stand: the studio hangs on its development hooks)
//   node city/lib/x/film.mjs [baseUrl] [--out out/x] [--only hour,justin,launch,billboard,banner] [--fps 30|60]
//        [--journal <file.json> | --mint <mint> | --rehearsal <evidence.json>] [--reads <dir>]
//        [--queue [--queue-to <url>] [--queue-stale]] [--quick]
// → <out>/<date>/<template>/: clip-4x5.mp4 and clip-1x1.mp4 (1080 wide, H.264 High, ~8 Mbit/s, 30 or 60 fps), their
//   stills (poster-4x5.png, poster-1x1.png) or the card (card-4x5.png, card-1x1.png, banner.png), post.txt (the words,
//   as the queue would write them) and sources.json (every number with its source and read time); manifest.json over all.
//
// The five templates: the tower of the hour (a 9 s clip: the camera flies to the named tower that grew the most in the
// hour, fireworks, one big figure), JUST IN (one figure: the city's 24h volume, or a new tower in Sol Core), Launch
// Night (a 12 s clip of a Ryntra launch from the docks to its pool, from the engine's flight log), the week's billboard
// (the five towers that rose the most since a read a week old — or, until one is kept, the five busiest by 24h volume,
// and it says so) and the X banner in action. Every number comes from the city's read (/api/city: Jupiter, with its
// read time) or the flight log (the chain, with each transaction). No number is typed in here.
//
// The page lives on the studio's clock (clock.mjs): a city drawn in software at a frame a second still films every
// frame on its beat. Launch Night needs a flight log: `--mint` reads GET /api/v1/launch/{mint}/journal from the stand,
// `--journal` takes a saved answer, `--rehearsal` builds one from a devnet rehearsal's evidence (the default on a stand
// without the engine: docs/research/launch-devnet-rehearsal-2026-10-10-micro/evidence.json, labelled DEVNET on screen).
//
// `--queue` puts each post in the drafts queue (CITY-3) with the desk's machine key, RYNTRA_MOMENTS_SECRET: the event
// (its words are the server's) and the 4:5 clip — a copy under 4 MB — or the card. Only facts fresh enough for their
// template go in; `--queue-stale` lets older ones into a local stand's queue (its bundled read is days old), never a
// remote one. Nothing is ever posted: the queue waits for a person, and no sender is connected.
// The studio films on a development stand (its hooks never reach production); `--queue-to https://ryntra.io` puts the
// takes in production's queue instead of the stand's, with production's machine key in RYNTRA_MOMENTS_SECRET.
// PRESS_CHROME may point at a Chromium.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installClock } from "./clock.mjs";
import { bytesOf, clipProblems, journalFromRehearsal, keepRead, keptReads, openEncoder, probe, putDraft, QUEUE_MAX_BYTES, queueCopy, studioEvent } from "./files.mjs";
import { readStudioEvent } from "./event.ts";
import { isFresh } from "./facts.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const REHEARSAL = path.join(ROOT, "docs/research/launch-devnet-rehearsal-2026-10-10-micro/evidence.json");
const ALL = ["hour", "justin", "launch", "billboard", "banner"];

function args(argv) {
  const o = { base: "http://localhost:3000", out: "out/x", only: ALL, fps: 30, journal: null, mint: null, rehearsal: null, reads: null, queue: false, queueTo: null, stale: false, quick: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === "--out") o.out = v();
    else if (a === "--only") o.only = v().split(",").filter((t) => ALL.includes(t));
    else if (a === "--fps") o.fps = Number(v()) === 60 ? 60 : 30;
    else if (a === "--journal") o.journal = v();
    else if (a === "--mint") o.mint = v();
    else if (a === "--rehearsal") o.rehearsal = v();
    else if (a === "--reads") o.reads = v();
    else if (a === "--queue") o.queue = true;
    else if (a === "--queue-to") o.queueTo = v().replace(/\/$/, "");
    else if (a === "--queue-stale") o.stale = true;
    else if (a === "--quick") o.quick = true;
    else if (!a.startsWith("--")) o.base = a.replace(/\/$/, "");
  }
  return o;
}

const opts = args(process.argv.slice(2));
const date = new Date().toISOString().slice(0, 10);
const dir = path.resolve(opts.out, date);
const readsDir = path.resolve(opts.reads ?? path.join(opts.out, "reads"));
const started = Date.now();
const log = (...a) => console.log(`[x-studio ${((Date.now() - started) / 1000).toFixed(0)}s]`, ...a);
const key = process.env.RYNTRA_MOMENTS_SECRET ?? "";
if (opts.queue && key.length < 16) throw new Error("--queue needs RYNTRA_MOMENTS_SECRET (the desk's machine key, 16+ characters)");
// Where the takes go: the stand's own queue, or the one `--queue-to` names (production's).
const queueBase = opts.queueTo ?? opts.base;
if (opts.queueTo && !/^https:\/\//i.test(queueBase)) throw new Error("--queue-to takes an https address");
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(queueBase);
if (opts.stale && !local) throw new Error("--queue-stale is for a local stand only");

/** The flight log for Launch Night: the engine's, a saved one, or a devnet rehearsal's evidence. */
async function flightLog() {
  if (opts.journal) return { journal: JSON.parse(readFileSync(opts.journal, "utf8")), from: opts.journal };
  if (opts.mint) {
    const res = await fetch(`${opts.base}/api/v1/launch/${encodeURIComponent(opts.mint)}/journal`, { headers: { "X-Ryntra-API": "1", accept: "application/json" } });
    if (!res.ok) throw new Error(`flight log of ${opts.mint}: HTTP ${res.status}`);
    return { journal: await res.json(), from: `${opts.base}/api/v1/launch/${opts.mint}/journal` };
  }
  const file = opts.rehearsal ?? REHEARSAL;
  return { journal: journalFromRehearsal(JSON.parse(readFileSync(file, "utf8"))), from: path.relative(ROOT, path.resolve(file)) };
}

// The city's read, kept for next week's billboard.
const city = await (await fetch(`${opts.base}/api/city`, { cache: "no-store" })).json();
keepRead(readsDir, city);
const earlier = keptReads(readsDir).filter((s) => s.fetchedAt !== city.fetchedAt);
const log0 = opts.only.includes("launch") ? await flightLog() : null;
log(`city read ${city.fetchedAt} (${city.source}, ${city.towers.length} towers); ${earlier.length} earlier reads kept`);

const browser = await chromium.launch({
  executablePath: process.env.PRESS_CHROME || undefined,
  args: ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", ...(process.env.CITY_CHROME_ARGS ?? "").split(" ").filter(Boolean)],
});
const errors = [];

/** A page of the city on the studio's clock, ready when the city is drawn and its type loaded. */
async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addInitScript(installClock);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e?.message ?? e).slice(0, 300)));
  await page.goto(`${opts.base}/`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => window.__xstudio?.ready(), null, { timeout: 300_000, polling: 500 });
  // A moment for the scene's first frames, on the page's own clock.
  await page.waitForTimeout(opts.quick ? 2000 : 8000);
  return { page, context };
}

const manifest = { task: "CITY-38", base: opts.base, queue: opts.queue ? queueBase : null, date, fps: opts.fps, city: { fetchedAt: city.fetchedAt, source: city.source, towers: city.towers.length }, posts: [], errors };
const save = (sub, name, buf) => {
  const file = path.join(dir, sub, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return path.relative(ROOT, file);
};

/** The words, the sources and the queue for a post whose files are made. */
async function finish(plan, files, queueFile) {
  const sub = plan.template;
  save(sub, "post.txt", `${plan.text}\n`);
  save(sub, "sources.json", JSON.stringify({ template: plan.template, text: plan.text, link: plan.link, facts: plan.facts, sources: plan.sources, read: plan.read, ...(plan.journalFrom ? { flightLog: plan.journalFrom } : {}) }, null, 2));
  const entry = { template: plan.template, text: plan.text, files, sources: plan.sources, problems: plan.problems ?? [] };
  const event = readStudioEvent(studioEvent(plan.facts));
  if (!event.ok) entry.problems.push(`the queue would refuse it: ${event.error}`);
  if (opts.queue) {
    if (!isFresh(plan.facts, new Date()) && !opts.stale) entry.queue = { ok: false, reason: "facts too old for this template" };
    else if (!event.ok) entry.queue = { ok: false, reason: event.error };
    else entry.queue = await putDraft(queueBase, key, plan.facts, path.join(ROOT, queueFile.file), queueFile.type).then((r) => (r.ok ? { ok: true, id: r.draft.id, status: r.draft.status } : r));
    log(`${plan.template}: queue`, JSON.stringify(entry.queue));
  }
  manifest.posts.push(entry);
}

async function clip(page, template, input) {
  const plan = await page.evaluate((i) => window.__xstudio.plan(i), input);
  if (!plan.ok) {
    manifest.posts.push({ template, skipped: plan.error });
    log(`${template}: no post (${plan.error})`);
    return;
  }
  plan.journalFrom = input.journalFrom;
  const take = await page.evaluate(({ board, fps }) => window.__xstudio.begin({ board, fps }), { board: plan.board, fps: opts.fps });
  log(`${template}: ${take.frames} frames, ${take.seconds} s — ${plan.board.hook.kicker} ${plan.board.hook.figure}`);
  const enc = { "4:5": openEncoder(path.join(dir, template, "clip-4x5.mp4"), { fps: opts.fps }), "1:1": openEncoder(path.join(dir, template, "clip-1x1.mp4"), { fps: opts.fps }) };
  const files = {};
  try {
    for (;;) {
      const f = await page.evaluate(() => window.__xstudio.frame());
      if (!f) break;
      for (const a of ["4:5", "1:1"]) {
        await enc[a].write(bytesOf(f.jpeg[a]));
        if (f.png[a]) files[`poster ${a}`] = save(template, `poster-${a.replace(":", "x")}.png`, bytesOf(f.png[a]));
      }
      if (f.index % 60 === 0) log(`${template}: frame ${f.index + 1}/${take.frames}`);
    }
  } finally {
    await page.evaluate(() => window.__xstudio.end()).catch(() => {});
  }
  for (const [a, e] of Object.entries(enc)) {
    const file = await e.close();
    const [width, height] = a === "4:5" ? [1080, 1350] : [1080, 1080];
    const p = probe(file);
    const problems = clipProblems(p, { width, height, fps: opts.fps });
    files[`clip ${a}`] = path.relative(ROOT, file);
    files[`clip ${a} probe`] = p;
    if (problems.length) plan.problems = [...(plan.problems ?? []), ...problems.map((x) => `${a}: ${x}`)];
  }
  // The queue holds a file up to 4 MB: a copy of the 4:5 clip at the bitrate that fits, the master keeps its 8 Mbit/s.
  const master = path.join(ROOT, files["clip 4:5"]);
  let queueFile = { file: files["clip 4:5"], type: "video/mp4" };
  if (statSync(master).size > QUEUE_MAX_BYTES) {
    const copy = queueCopy(master, path.join(dir, template, "queue-4x5.mp4"), plan.board.seconds);
    files["queue copy 4:5"] = path.relative(ROOT, copy.file);
    files["queue copy 4:5 probe"] = probe(copy.file);
    queueFile = { file: files["queue copy 4:5"], type: "video/mp4" };
  }
  await finish(plan, files, queueFile);
}

async function card(page, template, input) {
  const plan = await page.evaluate((i) => window.__xstudio.plan(i), input);
  if (!plan.ok) {
    manifest.posts.push({ template, skipped: plan.error });
    log(`${template}: no post (${plan.error})`);
    return;
  }
  await page.evaluate(({ board }) => window.__xstudio.begin({ board, fps: 30 }), { board: plan.board });
  const files = {};
  try {
    const f = await page.evaluate(() => window.__xstudio.frame());
    for (const a of ["4:5", "1:1"]) files[`card ${a}`] = save(template, `card-${a.replace(":", "x")}.png`, bytesOf(f.png[a]));
  } finally {
    await page.evaluate(() => window.__xstudio.end()).catch(() => {});
  }
  log(`${template}: ${plan.board.hook.kicker} ${plan.board.hook.figure}`);
  await finish(plan, files, { file: files["card 4:5"], type: "image/png" });
}

try {
  const wanted = (t) => opts.only.includes(t);
  if (["hour", "launch", "justin", "billboard"].some(wanted)) {
    // The clips and cards: a 4:5 page (the scene draws at 1.5 × 720 × 900 = 1080 × 1350); 1:1 is its middle.
    const { page, context } = await open(720, 900);
    if (wanted("hour")) await clip(page, "hour", { template: "hour" });
    if (wanted("launch")) await clip(page, "launch", { template: "launch", journal: log0?.journal ?? null, journalFrom: log0?.from });
    if (wanted("justin")) await card(page, "justin", { template: "justin", before: earlier.at(-1) ?? null });
    if (wanted("billboard")) await card(page, "billboard", { template: "billboard", earlier });
    await context.close();
  }
  if (wanted("banner")) {
    const { page, context } = await open(1500, 500);
    const plan = await page.evaluate(() => window.__xstudio.plan({ template: "banner" }));
    const made = plan.ok ? await page.evaluate(() => window.__xstudio.banner()) : null;
    if (made) {
      const files = { banner: save("banner", "banner.png", bytesOf(made.banner)), "banner on a profile": save("banner", "banner-preview.png", bytesOf(made.preview)) };
      log("banner: made");
      await finish(plan, files, { file: files.banner, type: "image/png" });
    } else manifest.posts.push({ template: "banner", skipped: plan.ok ? "no_frame" : plan.error });
    await context.close();
  }
} finally {
  await browser.close();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  log(`manifest → ${path.relative(ROOT, path.join(dir, "manifest.json"))}`);
}
const bad = manifest.posts.filter((p) => p.problems?.length || p.skipped);
for (const p of manifest.posts) log(`${p.template}: ${p.skipped ? `skipped (${p.skipped})` : p.problems.length ? p.problems.join("; ") : "ok"}`);
if (errors.length) log(`page errors: ${errors.length}`, errors.slice(0, 5));
process.exitCode = bad.length ? 1 : 0;
