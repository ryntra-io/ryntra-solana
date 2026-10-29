// The quarter kit's gallery for review: screens of every kind at every level, and frame measurements.
//   node city/components/quarter/kit/gallery-shots.mjs shots [out] [baseUrl]   (npm run dev running)
//   node city/components/quarter/kit/gallery-shots.mjs fps [baseUrl]
// Screens: the overview, each kind's five levels, two close-ups and the detail levels, at 1440×860 and 390×844.
// Frame measurements use the city's phone profile — 390×844, pixel ratio 1.75, the processor four times slower — on
// the city's home, the gallery with the city behind it, and the gallery alone. They count every animation frame's
// script time (all requestAnimationFrame work: the scene, three.js, the composer), the draw calls and triangles of a
// frame, and the frame rate. PRESS_CHROME may point at a Chromium (on Windows, Chrome with --use-angle=d3d11 for the GPU).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [command = "shots", ...rest] = process.argv.slice(2);
const out = path.resolve(command === "shots" ? (rest[0] ?? "out/kit-shots") : "out/kit-shots");
const base = (command === "shots" ? rest[1] : rest[0]) ?? "http://localhost:3000";

const LAPTOP = { name: "laptop", viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 };
const PHONE = { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true };
const KINDS = ["home", "coin_tower", "harbor", "workshop", "crew_hq", "garage", "oracle", "showcase", "billboard", "decor"];

const executablePath = process.env.PRESS_CHROME || undefined;
const browser = await chromium.launch({
  executablePath,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-unsafe-swiftshader", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])],
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

async function open(device, url) {
  const context = await browser.newContext(device);
  await context.addInitScript(timeFrames);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => window.__kit?.meter?.() || window.__gl, null, { timeout: 300_000 });
  return { context, page, errors };
}

if (command === "shots") {
  mkdirSync(out, { recursive: true });
  const views = [
    ["overview", ""],
    ...KINDS.map((kind) => [kind, `kind=${kind}`]),
    ["home-5", "kind=home&level=5"],
    ["harbor-5", "kind=harbor&level=5"],
    ["lod", "lod=debug"],
  ];
  // SIZES=laptop,phone and VIEWS=overview,harbor,… take a part of the set.
  const sizes = process.env.SIZES?.split(",");
  const only = process.env.VIEWS?.split(",");
  for (const device of [LAPTOP, PHONE].filter((d) => !sizes || sizes.includes(d.name))) {
    for (const [name, query] of views.filter(([name]) => !only || only.includes(name))) {
      const { context, page, errors } = await open(device, `${base}/city/kit${query ? `?${query}` : ""}`);
      await page.waitForTimeout(7000);
      await page.screenshot({ path: path.join(out, `${name}-${device.name}.jpg`), type: "jpeg", quality: 82 });
      console.log(`${device.name} ${name}${errors.length ? ` errors: ${errors[0].slice(0, 160)}` : ""}`);
      await context.close();
    }
  }
} else {
  const pages = [
    ["city home", "/"],
    ["gallery with the city", "/city/kit"],
    ["gallery, kit only", "/city/kit?bare"],
    ["one kind, levels 1-5", "/city/kit?kind=home"],
    // The home steps its pixel ratio down while frames are slow (to 1.25 in software rendering); these compare at it.
    ["gallery with the city, ratio 1.25", "/city/kit?dpr=1.25"],
    ["gallery, kit only, ratio 1.25", "/city/kit?bare&dpr=1.25"],
  ];
  for (const [name, route] of pages) {
    const { context, page, errors } = await open(PHONE, `${base}${route}`);
    await page.waitForTimeout(8000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.waitForTimeout(3000);
    const result = await page.evaluate(async () => {
      const gl = window.__gl ?? null;
      const frames = window.__frames;
      frames.clear();
      if (gl && !window.__kit) {
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
      // The gallery counts its own frame (it resets the renderer's counters every frame); the home is counted here.
      const meter = window.__kit?.meter?.() ?? null;
      return {
        fps: +(count / seconds).toFixed(2),
        dpr: gl?.getPixelRatio?.() ?? null,
        scriptMs: { p50: +pick(0.5).toFixed(1), p95: +pick(0.95).toFixed(1) },
        callsPerFrame: meter ? meter.calls : gl ? Math.round(gl.info.render.calls / count) : null,
        trianglesPerFrame: meter ? meter.triangles : gl ? Math.round(gl.info.render.triangles / count) : null,
        kit: meter?.kit ?? null,
      };
    });
    console.log(JSON.stringify({ page: name, route, ...result, errors: errors.slice(0, 2) }));
    await context.close();
  }
}
await browser.close();
