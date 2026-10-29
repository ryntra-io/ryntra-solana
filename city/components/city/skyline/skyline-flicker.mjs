// Flicker in motion (CITY-56, after the frame-time fix #1041): reads every frame the renderer puts on the screen
// (60 fps) and counts, per pixel, how often its brightness turns direction; ≥ 4 turns in K frames is a flickering pixel.
//   node city/components/city/skyline/skyline-flicker.mjs <out> [baseUrl]   (npm run dev running)
//   env: W H QUALITY K, MODE=orbit,frozen,hold,pan
//     orbit  the home screen's attract orbit as it runs        frozen  a fixed far view
//     hold   the camera frozen where the orbit is (what is left is driven by time, not by the camera)
//     pan    a fixed pose turned 0.02 rad/s about the island: the same path on every run, so runs compare
//   HIDE=a,b hides objects by name (~part matches a part); PATCH="from=>to;;…" edits the skyline shader in the page,
//   a term at a time, to find what flickers. <out>/<mode>-heat.png: the first frame, flickering pixels in red.
// Based on the supervising session's frames.mjs.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2]);
const base = process.argv[3] ?? "http://localhost:3000";
const W = +(process.env.W ?? 1440), H = +(process.env.H ?? 900);
const Q = process.env.QUALITY ?? "high";
const K = +(process.env.K ?? 30);
const MODES = (process.env.MODE ?? "orbit,frozen").split(",");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DSF ?? 1) })).newPage();
page.on("pageerror", (e) => console.log("pageerror", String(e)));
await page.goto(`${base}/?quality=${Q}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 180_000 });
await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: 90_000 }).catch(() => {});
await page.evaluate((q) => window.__city.getState().setQuality(q), Q);
await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
await page.waitForTimeout(7000);

if (process.env.PROBE) {
  const names = await page.evaluate(() => {
    const rows = [];
    const walk = (o, d) => {
      if (d > 3) return;
      let tris = 0;
      o.traverse((c) => { if (c.isMesh || c.isPoints || c.isLine) tris++; });
      rows.push(`${"  ".repeat(d)}${o.type} "${o.name}" children=${o.children.length} drawables=${tris}`);
      if (o.children.length < 40) o.children.forEach((c) => walk(c, d + 1));
    };
    walk(window.__scene, 0);
    return rows;
  });
  fs.writeFileSync(path.join(out, "scene.txt"), names.join("\n"));
  console.log(names.slice(0, 120).join("\n"));
}

// Installs the per-frame reader: after every render to the screen, the luminance of every pixel.
await page.evaluate(() => {
  const gl = window.__gl;
  const ctx = gl.getContext();
  const orig = gl.render.bind(gl);
  window.__cap = { on: false, frames: [], w: 0, h: 0 };
  gl.render = (scene, camera) => {
    orig(scene, camera);
    const c = window.__cap;
    if (!c.on || gl.getRenderTarget() !== null) return;
    const w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    const L = new Uint8Array(w * h);
    for (let i = 0; i < L.length; i++) L[i] = (54 * px[i * 4] + 183 * px[i * 4 + 1] + 19 * px[i * 4 + 2]) >> 8;
    c.frames.push(L); c.w = w; c.h = h;
  };
});

async function measure(label) {
  return page.evaluate(async ({ K, label }) => {
    const c = window.__cap;
    c.frames = []; c.on = true;
    const t0 = performance.now();
    await new Promise((r) => { const tick = () => (c.frames.length >= K ? r() : requestAnimationFrame(tick)); requestAnimationFrame(tick); });
    c.on = false;
    const ms = (performance.now() - t0) / K;
    const { w, h, frames } = c;
    const n = w * h, T = 18;
    const rev = new Uint8Array(n);
    let changed = 0;
    for (let p = 0; p < n; p++) {
      let last = 0, r = 0;
      for (let t = 1; t < frames.length; t++) {
        const d = frames[t][p] - frames[t - 1][p];
        if (d > T || d < -T) { changed++; const s = d > 0 ? 1 : -1; if (last && s !== last) r++; last = s; }
      }
      rev[p] = r;
    }
    let flick = 0;
    for (let p = 0; p < n; p++) if (rev[p] >= 4) flick++;
    // Heat map (the image is upside down in GL order: flip rows).
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d"); const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (h - 1 - y) * w + x, q = (y * w + x) * 4;
      const base = frames[0][p] * 0.4, k = Math.min(1, rev[p] / 8);
      img.data[q] = Math.min(255, base + k * 255); img.data[q + 1] = base * (1 - k); img.data[q + 2] = base * (1 - k); img.data[q + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const GX = 8, GY = 6, grid = [];
    for (let gy = 0; gy < GY; gy++) {
      const row = [];
      for (let gx = 0; gx < GX; gx++) {
        let cnt = 0, all = 0;
        for (let y = Math.floor((gy * h) / GY); y < Math.floor(((gy + 1) * h) / GY); y++)
          for (let x = Math.floor((gx * w) / GX); x < Math.floor(((gx + 1) * w) / GX); x++) { all++; if (rev[(h - 1 - y) * w + x] >= 4) cnt++; }
        row.push(((100 * cnt) / all).toFixed(1).padStart(5));
      }
      grid.push(row.join(" "));
    }
    c.frames = [];
    return { label, msPerFrame: +ms.toFixed(1), w, h, flickerPct: +((100 * flick) / n).toFixed(2), changedPct: +((100 * changed) / (n * (K - 1))).toFixed(2), grid, heat: cv.toDataURL("image/png") };
  }, { K, label });
}

function save(r) {
  fs.writeFileSync(path.join(out, `${r.label}-heat.png`), Buffer.from(r.heat.split(",")[1], "base64"));
  console.log(`${r.label}: flicker ${r.flickerPct}%  changed/frame ${r.changedPct}%  ${r.msPerFrame} ms/frame  ${r.w}x${r.h}`);
  if (process.env.GRID) console.log(r.grid.join("\n"));
}

const hide = async (names, on) => page.evaluate(({ names, on }) => {
  const hit = [];
  window.__scene.traverse((o) => { if (names.some((n) => (n.startsWith("~") ? o.name.includes(n.slice(1)) : o.name === n))) { o.visible = !on; hit.push(o.name); } });
  return hit.length;
}, { names, on });

if (process.env.PATCH) {
  // PATCH="from=>to;;from=>to": edits the skyline material's fragment shader in the page (a term at a time).
  const pairs = process.env.PATCH.split(";;").map((p) => p.split("=>"));
  console.log("patched", await page.evaluate((pairs) => {
    const mats = new Set();
    window.__scene.traverse((o) => { if (o.material?.fragmentShader?.includes("roomAt")) mats.add(o.material); });
    let hits = 0;
    for (const m of mats) for (const [a, b] of pairs) if (m.fragmentShader.includes(a)) { m.fragmentShader = m.fragmentShader.split(a).join(b); m.needsUpdate = true; hits++; }
    return hits;
  }, pairs));
  await page.waitForTimeout(2000);
}
if (process.env.HIDE) console.log("hidden", await hide(process.env.HIDE.split(","), true));

for (const m of MODES) {
  if (m === "hold") {
    // Freeze the camera where the orbit is now: what still flickers is driven by time, not by the camera.
    await page.evaluate(() => {
      const c = window.__camera, d = new c.position.constructor();
      c.getWorldDirection(d);
      const p = c.position.toArray();
      window.__cityView(p, [p[0] + d.x * 50, p[1] + d.y * 50, p[2] + d.z * 50]);
    });
    await page.waitForTimeout(800);
  }
  if (m === "frozen") { await page.evaluate(() => window.__cityView([0, 44, 182], [0, 26, 0])); await page.waitForTimeout(1500); }
  if (m === "pan") {
    // A fixed pose turned slowly about the island (0.02 rad/s, a little faster than the attract orbit): the same
    // camera path on every run, so runs compare.
    await page.evaluate(() => {
      const t0 = performance.now();
      window.__panOn = true;
      const step = () => {
        if (!window.__panOn) return;
        const a = ((performance.now() - t0) / 1000) * 0.02 - 0.3;
        window.__cityView([Math.sin(a) * 182, 44, Math.cos(a) * 182], [0, 26, 0]);
        requestAnimationFrame(step);
      };
      step();
    });
    await page.waitForTimeout(500);
  }
  save(await measure(m));
  if (m === "pan") await page.evaluate(() => { window.__panOn = false; });
}

if (process.env.SWEEP) {
  const groups = process.env.SWEEP.split(",");
  for (const g of groups) {
    const n = await hide(g.split("+"), true);
    await page.waitForTimeout(300);
    const r = await measure(`sweep-${g.replace(/[^a-z0-9+~]/gi, "_")}`);
    console.log(`  hide ${g} (${n} objects) →`);
    save(r);
    await hide(g.split("+"), false);
  }
}
const state = await page.evaluate(() => ({ q: document.documentElement.dataset.cityQuality, dpr: document.documentElement.dataset.cityDpr, sky: window.__skyline?.quality }));
console.log("state", JSON.stringify(state));
await browser.close();
