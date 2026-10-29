// The skyline's graphics pass (CITY-56): the same frames before and after, on the real GPU.
//   node city/components/city/skyline/skyline-shots.mjs [out] [baseUrl]   (npm run dev running)
// → <out>/home-<size>.png with the HUD, clean-<size>.png without it at 1440×900, 390×844 and 360×740, and close-ups at
// 1440×900 without the HUD: a tall tower, the Sol Spire, a stepped avenue tower, the docks, a street and the water.
// The camera goes where a shot asks through the development hook window.__cityView (`DevView.tsx`); the city's own
// controls never change. QUALITY=high|mid|low pins the tier (Lite is low, Balanced mid); SIZES=desk,phone,small and
// CLOSE=tower,street,… pick what to shoot.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/skyline-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const quality = process.env.QUALITY ? `?quality=${process.env.QUALITY}` : "";
const pin = process.env.QUALITY;
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "small", width: 360, height: 740, mobile: true },
];
// VIEWPORTS=1371x1206,1920x1080 adds desk windows of those sizes (home and clean frames only).
for (const v of (process.env.VIEWPORTS ?? "").split(",").filter(Boolean)) {
  const [width, height] = v.split("x").map(Number);
  ALL.push({ name: `desk-${width}x${height}`, width, height, mobile: false });
}
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

/** Close-ups, worked out in the page from today's layout so the same frame finds the same towers. */
const CLOSE = process.env.CLOSE ? process.env.CLOSE.split(",") : ["tower", "sol", "avenue", "docks", "street", "water", "kerb", "shore"];

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const HIDE_HUD = "body * { visibility: hidden !important; } canvas { visibility: visible !important; }";

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${base}/${quality}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 120_000 });
  // The skyline's models arrive after the first frame; before CITY-56 there is no such flag and the wait just runs out.
  await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: Number(process.env.SKYLINE_WAIT ?? 60_000) }).catch(() => {});
  if (pin) await page.evaluate((q) => window.__city.getState().setQuality(q), pin);
  // The reflection cube is drawn in a quiet moment a few seconds after the skyline appears.
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(out, `home-${s.name}.png`) });
  // What the skyline spends on this screen: quality tier, levels of detail, instances, draws and GPU memory.
  const spend = await page.evaluate(() => {
    const sk = window.__skyline;
    const gl = window.__gl;
    return sk ? { quality: sk.quality, ...sk.stats(), kit: sk.kit, renderer: gl ? { programs: gl.info.programs?.length, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures } : null } : null;
  });
  if (spend) writeFileSync(path.join(out, `spend-${s.name}.json`), JSON.stringify(spend, null, 2));
  await page.evaluate(() => window.__city.getState().enter());
  const hide = await page.addStyleTag({ content: HIDE_HUD });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, `clean-${s.name}.png`) });

  if (s.name === "desk") {
    for (const name of CLOSE) {
      const ok = await page.evaluate((name) => {
        const towers = window.__city.getState().layout.towers;
        const tallest = (d) => towers.filter((t) => t.tower.district === d).sort((a, b) => b.height - a.height)[0];
        const near = (t, dist, up, look) => {
          // A district with no tower today (the docks between launches) has no close-up.
          if (!t) return null;
          const a = Math.atan2(t.x, t.z) + 0.5;
          return [[t.x + Math.sin(a) * dist, t.height * up, t.z + Math.cos(a) * dist], [t.x, t.height * look, t.z]];
        };
        const deg = (d) => (d * Math.PI) / 180;
        let v;
        if (name === "tower") v = near(tallest("heights"), 26, 0.62, 0.66);
        else if (name === "sol") v = near(towers[0], 30, 0.55, 0.62);
        else if (name === "avenue") v = near(tallest("avenue"), 24, 0.55, 0.6);
        else if (name === "docks") v = near(tallest("docks"), 16, 0.9, 0.55);
        else if (name === "street") v = [[Math.sin(deg(-150)) * 30, 2.2, -Math.cos(deg(-150)) * 30], [Math.sin(deg(-128)) * 31, 7, -Math.cos(deg(-128)) * 31]];
        // kerb: down the ring road at a car's height; shore: the skyline across the water from the south-east.
        else if (name === "kerb") v = [[Math.sin(deg(-150)) * 31.2, 1.1, -Math.cos(deg(-150)) * 31.2], [Math.sin(deg(-132)) * 30.6, 0.9, -Math.cos(deg(-132)) * 30.6]];
        else if (name === "shore") v = [[Math.sin(deg(140)) * 118, 3.2, -Math.cos(deg(140)) * 118], [0, 18, 0]];
        else v = [[Math.sin(deg(168)) * 128, 4.5, -Math.cos(deg(168)) * 128], [0, 16, 0]];
        if (!v || !v[0] || Number.isNaN(v[0][0])) return false;
        window.__cityView(v[0], v[1]);
        return true;
      }, name);
      if (!ok) continue;
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(out, `close-${name}.png`) });
    }
    await page.evaluate(() => window.__cityView(null));
  }
  await hide.evaluate((el) => el.remove());
  console.log(`${s.name}: errors=${errors.length}${errors.length ? " → " + errors[0].slice(0, 200) : ""}`);
  await context.close();
}
await browser.close();
