// Do the network's launches in the Docks (CITY-142) cost the phone frames? One page, the same camera, twice: with the
// launches laid into the Docks, then with them let go — frames per second, the 95th-percentile frame and the draws.
//   npm run dev      then      node city/lib/lens/new-fps.mjs [baseUrl] [--seconds 6]
// A phone (375×812, DPR 2, touch, the CPU slowed ×4) and a desk at 1440×900, on the development stand-in
// (`?launch=stub`); CPU=1 leaves the phone's CPU as it is. PRESS_CHROME=<path> runs on a real GPU; without it the numbers are a software GL's — compare the two
// rows of one device, not the devices. CHROME=<path> picks a Chromium of its own (a cloud session: /opt/pw-browsers/chromium).
import { chromium } from "playwright";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const at = process.argv.indexOf("--seconds");
const seconds = at > 0 ? Number(process.argv[at + 1]) : 6;
const gl = process.env.PRESS_CHROME ? ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] : ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || process.env.CHROME || undefined, args: gl });

const DEVICES = [
  { name: `phone cpu×${process.env.CPU ?? 4}`, viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, cpu: Number(process.env.CPU ?? 4) },
  { name: "desk", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1 },
];

async function count(page, ms) {
  return page.evaluate(async (ms) => {
    const times = [];
    const draws = [];
    const triangles = [];
    // Every pass of a frame counted, not the last one's: the renderer's own count is reset by hand once a frame.
    const info = window.__gl?.info;
    if (info) info.autoReset = false;
    let last = performance.now();
    const t0 = last;
    await new Promise((done) => {
      const tick = (t) => {
        times.push(t - last);
        if (info) {
          draws.push(info.render.calls);
          triangles.push(info.render.triangles);
          info.reset();
        }
        last = t;
        if (t - t0 < ms) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    if (info) info.autoReset = true;
    times.shift();
    draws.shift();
    triangles.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const mean = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
    return {
      fps: Math.round(((times.length * 1000) / times.reduce((a, b) => a + b, 0)) * 10) / 10,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
      draws: mean(draws),
      triangles: mean(triangles),
      towers: window.__city.getState().layout.towers.length,
      docks: window.__city.getState().layout.towers.filter((t) => t.tower.district === "docks").length,
    };
  }, ms);
}

const results = [];
for (const d of DEVICES) {
  const context = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch });
  const page = await context.newPage();
  await page.addInitScript(() => window.localStorage.setItem("ryntra.city.firstHint", "1"));
  await page.goto(`${base}/?launch=stub&quality=mid`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => window.__newLaunches?.getState().status === "live" && (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 240_000 });
  await page.evaluate(() => {
    window.__city.getState().enter();
    window.__lens.getState().pick("new");
    // One camera for both counts, over the Docks.
    const docks = window.__city.getState().layout.towers.filter((t) => t.tower.district === "docks");
    const cx = docks.reduce((a, t) => a + t.x, 0) / docks.length;
    const cz = docks.reduce((a, t) => a + t.z, 0) / docks.length;
    window.__cityView?.([cx * 1.9, 70, cz * 1.9], [cx * 0.6, 4, cz * 0.6]);
  });
  const cdp = await context.newCDPSession(page);
  if (d.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: d.cpu });
  await page.waitForTimeout(6000);
  const laid = await count(page, seconds * 1000);
  // The launches let go: the rings emptied first, so the city is not given them again.
  await page.evaluate(() => {
    const stages = window.__newLaunches.getState().stages;
    window.__newLaunches.setState({ rings: { fresh: [], near: [], graduated: [] }, stages: new Map() });
    const city = window.__city.getState();
    const own = new Set(window.__launch.getState().feed.map((l) => l.token));
    city.setSnapshot({ ...city.snapshot, towers: city.snapshot.towers.filter((t) => !(t.district === "docks" && stages.has(t.id) && !own.has(t.id))) });
  });
  await page.waitForTimeout(6000);
  const without = await count(page, seconds * 1000);
  results.push({ device: d.name, with: laid, without });
  await context.close();
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
