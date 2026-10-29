// The skyline's frame rate per quality tier (CITY-56), measured once the kit is on the screen, on the real GPU:
//   node city/components/city/skyline/skyline-fps.mjs [baseUrl] [--seconds 6]   (npm run dev running)
// A phone (390×844, DPR 2, touch) with the CPU slowed ×4 — DevTools' stand-in for a mid Android — and a desk at
// 1440×900. For each tier (High, Balanced = mid, Lite = low) it pins the tier, waits for it to settle, counts frames for
// a few seconds and prints FPS, the 95th-percentile frame time and the skyline's draws. Each tier is a fresh load with
// `?quality=` (the canvas's ladder starts there, city/lib/city/quality.ts); a fast GPU climbs the ladder back to the
// top, so once it has settled the tier is set again in the store and held for the count. The pixel ratio stays the
// ladder's; the tier and pixel ratio it ran at are printed.
import { chromium } from "playwright";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const at = process.argv.indexOf("--seconds");
const seconds = at > 0 ? Number(process.argv[at + 1]) : 6;
const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });

const DEVICES = [
  { name: "phone cpu×4", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, cpu: 4 },
  { name: "desk", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1 },
];
const results = [];
for (const d of DEVICES) {
  for (const quality of ["high", "mid", "low"]) {
    const context = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch });
    const page = await context.newPage();
    await page.goto(`${base}/?quality=${quality}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: 180_000 });
    const cdp = await context.newCDPSession(page);
    if (d.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: d.cpu });
    await page.waitForTimeout(5000);
    await page.evaluate((q) => window.__city.getState().setQuality(q), quality);
    await page.waitForTimeout(3000);
    const r = await page.evaluate(async (ms) => {
      const times = [];
      let last = performance.now();
      const t0 = last;
      await new Promise((done) => {
        const tick = (t) => {
          times.push(t - last);
          last = t;
          if (t - t0 < ms) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      times.shift();
      const sorted = [...times].sort((a, b) => a - b);
      const sk = window.__skyline;
      return {
        fps: Math.round((times.length * 1000) / times.reduce((a, b) => a + b, 0) * 10) / 10,
        p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
        tier: sk?.quality,
        lods: sk?.stats().lods,
        draws: sk?.stats().drawn,
        canvas: document.querySelector("canvas")?.width,
      };
    }, seconds * 1000);
    results.push({ device: d.name, quality, ...r, dpr: Math.round((r.canvas / d.viewport.width) * 100) / 100 });
    console.log(`${d.name} ${quality}: ${r.fps} fps, p95 ${r.p95} ms, ran at ${r.tier}, draws ${r.draws}, lods ${JSON.stringify(r.lods)}, dpr ${(r.canvas / d.viewport.width).toFixed(2)}`);
    await context.close();
  }
}
await browser.close();
console.log(JSON.stringify(results));
