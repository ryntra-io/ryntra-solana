// The guardian for review: frames of every state, moment and movement, a contact sheet of all animations, a video,
// the turnaround and silhouette, the detail levels, the visor's faces, and frame measurements on a phone profile.
//   node city/components/characters/shots.mjs shots [out] [baseUrl]   (npm run dev running)
//   node city/components/characters/shots.mjs video [out] [baseUrl]   frames at 30 a second; ffmpeg (FFMPEG or PATH) makes guardian.mp4
//     VIDEO_SIZE=960x540 (default) · VIDEO_BARE=1 leaves the city out (a software renderer draws it far faster)
//   node city/components/characters/shots.mjs fps [baseUrl]
// Every frame is a still of the clip at an exact time (`&t`), so frames and video are the same on any machine.
// Measurements use the city's phone profile — 390×844, pixel ratio 1.75, the processor four times slower — as
// `city/components/quarter/kit/gallery-shots.mjs` does. PRESS_CHROME may point at a Chromium (on Windows, Chrome with
// --use-angle=d3d11 for the GPU).
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [command = "shots", ...rest] = process.argv.slice(2);
const out = path.resolve(command === "fps" ? "out/characters-shots" : (rest[0] ?? "out/characters-shots"));
const base = (command === "fps" ? rest[0] : rest[1]) ?? "http://localhost:3000";

const LAPTOP = { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true };
const [videoW, videoH] = (process.env.VIDEO_SIZE ?? "960x540").split("x").map(Number);
const VIDEO = { viewport: { width: videoW, height: videoH }, deviceScaleFactor: 1 };

/** Every play in order, with the second its hero frame is taken at and how long the video shows it. */
const PLAYS = [
  ["ready", 1.0, 4],
  ["thinking", 1.2, 4],
  ["acting", 0.7, 4],
  ["done", 2.2, 4],
  ["attempt", 0.9, null],
  ["laugh", 0.5, null],
  ["alarm", 1.0, null],
  ["defeat", 3.0, null],
  ["celebrate", 1.1, null],
  ["greet", 1.0, null],
  ["idleA", 3.2, 4],
  ["idleB", 2.95, null],
  ["walk", 0.35, 4],
  ["look", 2.0, 6],
];

const executablePath = process.env.PRESS_CHROME || undefined;
const browser = await chromium.launch({
  executablePath,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-unsafe-swiftshader", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : ["--use-gl=angle", "--use-angle=swiftshader"])],
});

// Times every requestAnimationFrame callback, summed per frame: the script work the processor does for one frame.
const timeFrames = () => {
  const raf = window.requestAnimationFrame.bind(window);
  const work = new Map();
  window.__frames = work;
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const start = performance.now();
      cb(t);
      work.set(t, (work.get(t) ?? 0) + performance.now() - start);
    });
};

async function open(device, query) {
  const context = await browser.newContext(device);
  await context.addInitScript(timeFrames);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${base}/city/characters?${query}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => window.__guardian && window.__gl, null, { timeout: 300_000 });
  // The model arrives after the page: wait for the body that will be drawn.
  await page.waitForFunction(() => window.__guardian.body() !== "loading", null, { timeout: 120_000 });
  return { context, page, errors };
}

/** Lets a few frames draw, so what is on screen is what was asked for. */
const settle = (page, frames = 4) =>
  page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), frames);

async function still(page, patch, frames = 4) {
  await page.evaluate((p) => window.__guardian.set(p), patch);
  await settle(page, frames);
}

/** Lays out images (PNG buffers) in a grid with labels, in the city's colours, and returns a JPEG. */
async function sheet(items, { cols, width, height, title }) {
  const context = await browser.newContext({ viewport: { width: cols * width, height: 60 + Math.ceil(items.length / cols) * (height + 26) } });
  const page = await context.newPage();
  const cells = items
    .map(({ png, label }) => `<figure><img src="data:image/png;base64,${png.toString("base64")}" width="${width}" height="${height}"><figcaption>${label}</figcaption></figure>`)
    .join("");
  await page.setContent(`<style>
    body{margin:0;background:#06050C;color:#EEF1FF;font:600 14px system-ui,sans-serif}
    h1{margin:0;padding:18px 16px 12px;font:900 22px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
    main{display:grid;grid-template-columns:repeat(${cols},${width}px)}
    figure{margin:0}img{display:block}figcaption{height:26px;padding:4px 8px;color:#FFB23F;letter-spacing:.04em}
  </style><h1>${title}</h1><main>${cells}</main>`);
  const jpg = await page.screenshot({ type: "jpeg", quality: 84, fullPage: true });
  await context.close();
  return jpg;
}

if (command === "shots") {
  mkdirSync(out, { recursive: true });
  const durations = await (async () => {
    const { context, page } = await open(VIDEO, "bare&clean&play=ready&t=0");
    const d = await page.evaluate(() => window.__guardian.clips());
    await context.close();
    return d;
  })();
  const clipOf = { ready: "idleA", thinking: "analyze", acting: "speak", done: "done", idleA: "idleA", idleB: "idleB", walk: "walk", look: "idleA" };
  const length = (play) => (play === "look" ? 6 : durations[clipOf[play] ?? play]);

  // Hero frames in the city, one per play.
  {
    const { context, page, errors } = await open(LAPTOP, "clean&play=ready&t=1");
    await page.waitForTimeout(4000);
    for (const [play, t] of PLAYS) {
      await still(page, { play, t, lod: "auto" });
      await page.screenshot({ path: path.join(out, `${play}-laptop.jpg`), type: "jpeg", quality: 84 });
      console.log(`laptop ${play}${errors.length ? ` errors: ${errors[0].slice(0, 160)}` : ""}`);
    }
    await still(page, { play: "ready", t: 1, lod: "lineup" });
    await page.screenshot({ path: path.join(out, "detail-lineup-laptop.jpg"), type: "jpeg", quality: 84 });
    await context.close();
  }
  // The phone.
  {
    const { context, page } = await open(PHONE, "clean&play=ready&t=1");
    await page.waitForTimeout(4000);
    for (const play of ["ready", "thinking", "alarm", "defeat", "celebrate"]) {
      await still(page, { play, t: PLAYS.find((p) => p[0] === play)[1], lod: "auto" });
      await page.screenshot({ path: path.join(out, `${play}-phone.jpg`), type: "jpeg", quality: 84 });
    }
    await still(page, { play: "ready", t: 1, lod: "lineup" });
    await page.screenshot({ path: path.join(out, "detail-lineup-phone.jpg"), type: "jpeg", quality: 84 });
    await context.close();
    console.log("phone");
  }
  // Every animation in six frames: one contact sheet.
  {
    const { context, page } = await open({ viewport: { width: 640, height: 400 } }, "bare&clean&quiet&play=ready&t=0&dist=4");
    await page.waitForTimeout(3000);
    const items = [];
    for (const [play] of PLAYS) {
      const len = length(play);
      for (let k = 0; k < 6; k += 1) {
        const t = +((len * (k + 0.5)) / 6).toFixed(2);
        await still(page, { play, t, lod: "auto" });
        items.push({ png: await page.screenshot({ clip: { x: 120, y: 0, width: 400, height: 400 } }), label: `${play} · ${t.toFixed(1)} s` });
      }
      console.log(`sheet ${play}`);
    }
    writeFileSync(path.join(out, "animations.jpg"), await sheet(items, { cols: 6, width: 240, height: 240, title: "Vault guardian · every animation, six frames each" }));
    await context.close();
  }
  // Turnaround, silhouette, faces.
  {
    const views = [];
    const shadows = [];
    for (const turn of [0, 90, 180, 270]) {
      for (const [list, extra] of [[views, ""], [shadows, "&silhouette"]]) {
        const { context, page } = await open({ viewport: { width: 400, height: 560 } }, `bare&clean&quiet&play=ready&t=1&dist=5.6&turn=${turn + 24}${extra}`);
        await page.waitForTimeout(2500);
        await settle(page);
        list.push({ png: await page.screenshot({ clip: { x: 0, y: 70, width: 400, height: 490 } }), label: ["front", "its left", "back", "its right"][turn / 90] });
        await context.close();
      }
    }
    writeFileSync(path.join(out, "turnaround.jpg"), await sheet(views, { cols: 4, width: 300, height: 368, title: "Turnaround" }));
    writeFileSync(path.join(out, "silhouette.jpg"), await sheet(shadows, { cols: 4, width: 300, height: 368, title: "Silhouette — read in two seconds" }));

    const { context, page } = await open({ viewport: { width: 640, height: 400 } }, "bare&clean&quiet&face&play=ready&t=0.5&dist=1.05&lift=0.8&turn=20");
    await page.waitForTimeout(3000);
    const faces = [];
    for (const [play, t, label] of [
      ["ready", 0.5, "ready"],
      ["thinking", 1.0, "thinking"],
      ["acting", 0.3, "acting · speaking"],
      ["done", 2.0, "done"],
      ["attempt", 0.9, "attempt"],
      ["laugh", 0.9, "laugh"],
      ["alarm", 0.7, "alarm"],
      ["defeat", 2.6, "defeat"],
      ["celebrate", 1.2, "celebrate"],
      ["greet", 0.9, "greet"],
    ]) {
      await still(page, { play, t });
      faces.push({ png: await page.screenshot({ clip: { x: 160, y: 60, width: 300, height: 260 } }), label });
    }
    writeFileSync(path.join(out, "faces.jpg"), await sheet(faces, { cols: 5, width: 300, height: 260, title: "The visor: emotion in light" }));
    await context.close();
    console.log("turnaround, silhouette, faces");
  }
  // Detail by distance: the same guardian, the camera stepping back.
  {
    const { context, page } = await open({ viewport: { width: 640, height: 480 } }, "clean&stats&play=ready&t=1&dist=3.2");
    await page.waitForTimeout(3000);
    const items = [];
    for (const dist of [4, 14, 34, 110]) {
      await still(page, { dist });
      await page.waitForTimeout(1200);
      await settle(page, 6);
      const detail = await page.evaluate(() => window.__guardian.handle()?.detail());
      items.push({ png: await page.screenshot(), label: `${dist} units · ${["hero", "standard", "crowd", "impostor"][detail]}` });
    }
    writeFileSync(path.join(out, "detail-auto.jpg"), await sheet(items, { cols: 4, width: 320, height: 240, title: "Detail chosen by size on screen" }));
    await context.close();
    console.log("detail");
  }
} else if (command === "video") {
  const frames = path.join(out, "video-frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const { context, page, errors } = await open(VIDEO, `${process.env.VIDEO_BARE ? "bare&" : ""}clean&play=ready&t=0`);
  await page.waitForTimeout(4000);
  const durations = await page.evaluate(() => window.__guardian.clips());
  const clipOf = { ready: "idleA", thinking: "analyze", acting: "speak", done: "done", idleB: "idleB" };
  let n = 0;
  for (const [play, , seconds] of PLAYS) {
    const len = seconds ?? durations[clipOf[play] ?? play] + 0.3;
    for (let f = 0; f < Math.round(len * 30); f += 1) {
      await still(page, { play, t: +(f / 30).toFixed(4), lod: "auto" }, 2);
      await page.screenshot({ path: path.join(frames, `${String(n).padStart(5, "0")}.png`) });
      n += 1;
    }
    console.log(`video ${play}: ${n} frames${errors.length ? ` errors: ${errors[0].slice(0, 160)}` : ""}`);
  }
  await context.close();
  const ffmpeg = process.env.FFMPEG || "ffmpeg";
  const made = spawnSync(ffmpeg, ["-y", "-framerate", "30", "-i", path.join(frames, "%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "27", "-preset", "slow", "-movflags", "+faststart", path.join(out, "guardian.mp4")], { stdio: "inherit" });
  console.log(made.status === 0 ? `guardian.mp4 from ${n} frames` : `ffmpeg not run (${made.error?.message ?? made.status}); frames are in ${frames}`);
} else {
  const pages = [
    ["city home", "/"],
    ["guardian in the studio (HDR, contact shadow), ready", "/city/characters?play=ready"],
    ["guardian in the city, ready", "/city/characters?set=city&play=ready"],
    ["guardian in the city, acting", "/city/characters?set=city&play=acting"],
    ["guardian in the city, thinking (hologram)", "/city/characters?set=city&play=thinking"],
    ["guardian in the city, walking", "/city/characters?set=city&play=walk"],
    ["guardian alone, ready", "/city/characters?set=city&bare&play=ready"],
    ["four guardians, every detail", "/city/characters?set=city&play=ready&lod=lineup"],
    ["guardian far (impostor)", "/city/characters?set=city&play=ready&lod=3"],
    ["the body in code (the stand-in) in the city, ready", "/city/characters?set=city&body=code&play=ready"],
  ];
  for (const [name, route] of pages) {
    // `ONLY=guardian` measures just the pages whose name holds it (a production build exposes no renderer on the home).
    if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
    const context = await browser.newContext(PHONE);
    await context.addInitScript(timeFrames);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => window.__gl, null, { timeout: 300_000 });
    // The model arrives after the page: wait for the body that will be drawn.
    if (route.startsWith("/city/characters")) await page.waitForFunction(() => window.__guardian?.body?.() !== "loading", null, { timeout: 120_000 });
    await page.waitForTimeout(8000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.waitForTimeout(3000);
    const result = await page.evaluate(async () => {
      const gl = window.__gl;
      const frames = window.__frames;
      frames.clear();
      if (!window.__guardianMeter) {
        gl.info.autoReset = false;
        gl.info.reset();
      }
      const started = performance.now();
      let count = 0;
      await new Promise((done) => {
        const tick = () => (++count >= 12 && performance.now() - started > 8000 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
      const seconds = (performance.now() - started) / 1000;
      const work = [...frames.values()].sort((a, b) => a - b);
      const pick = (q) => work[Math.min(work.length - 1, Math.floor(work.length * q))] ?? 0;
      const meter = window.__guardianMeter?.() ?? null;
      const g = window.__guardian?.handle?.();
      return {
        fps: +(count / seconds).toFixed(2),
        dpr: gl.getPixelRatio(),
        scriptMs: { p50: +pick(0.5).toFixed(1), p95: +pick(0.95).toFixed(1) },
        callsPerFrame: meter ? meter.calls : Math.round(gl.info.render.calls / count),
        trianglesPerFrame: meter ? meter.triangles : Math.round(gl.info.render.triangles / count),
        guardianUpdateUs: g ? Math.round(g.cost()) : null,
        detail: g ? ["hero", "standard", "crowd", "impostor"][g.detail()] : null,
        bodyTriangles: window.__guardian?.triangles?.() ?? null,
        body: window.__guardian?.body?.() ?? null,
      };
    });
    console.log(JSON.stringify({ page: name, route, ...result, errors: errors.slice(0, 2) }));
    await context.close();
  }
}
await browser.close();
