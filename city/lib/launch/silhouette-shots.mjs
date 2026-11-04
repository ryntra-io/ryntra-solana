// The silhouette and the crown's rings for review (L7, CITY-144), from the live 3D scene on the development stand-in
// (`?launch=stub`), in English through the city's own link (`?lang=en`), at 1440×900 and 390×844:
//   <out>/crown-<size>.png       Night Owl's crown, three rings (days 7, 30 and 90), the HUD hidden
//   <out>/skyline-<size>.png     from above: Night Owl, which passed the rule, in the skyline with its rings, the HUD hidden
//   <out>/docks-<size>.png       from above: Zipline (fast exit) and Reef (too few buyers), kept in the Docks, the HUD hidden
//   <out>/window-<symbol>[-about]-<size>.png   the tower's window: its status on top, the rings, the «i» opened
//   node city/lib/launch/silhouette-shots.mjs [out] [baseUrl]   (npm run dev running; PRESS_CHROME may point at a Chromium)
// The camera goes where a shot asks through the development hook window.__cityView (`DevView.tsx`). Made-up
// devnet-shaped answers only; nothing is sent anywhere.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/silhouette-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const quality = process.env.QUALITY ?? "mid";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const HIDE_HUD = "body * { visibility: hidden !important; } canvas { visibility: visible !important; }";

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-unsafe-swiftshader"] });
const errors = [];
for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/?launch=stub&pace=0.2&quality=${quality}&lang=en`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForFunction(() => ["OWL", "MOTH", "ZIP", "REEF"].every((symbol) => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === symbol)), null, { timeout: 600_000 });
  await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: 180_000 }).catch(() => {});
  await page.evaluate(() => window.__city.getState().enter());
  // The city's own flight in after «enter» runs slowly on a software-rendered canvas: let it land first.
  await page.waitForTimeout(9000);

  /* The scene, the HUD hidden: the camera put exactly where each frame asks. */
  const hide = await page.addStyleTag({ content: HIDE_HUD });
  for (const shot of ["crown", "skyline", "docks"]) {
    const ok = await page.evaluate(
      ({ shot, mobile }) => {
        const towers = window.__city.getState().layout.towers;
        const of = (symbol) => towers.find((t) => t.tower.symbol === symbol);
        const owl = of("OWL");
        const around = (t, dist, up, look, turn = 0.5) => {
          const a = Math.atan2(t.x, t.z) + turn;
          return [[t.x + Math.sin(a) * dist, t.height * up, t.z + Math.cos(a) * dist], [t.x, t.height * look, t.z]];
        };
        let v = null;
        if (shot === "crown") v = around(owl, owl.width * (mobile ? 9 : 6.5), 1.04, 0.9);
        else {
          // From above, so the launches' low towers read among the market's tall ones: the two that passed the rule in
          // the skyline, or the two the Docks keep.
          const [a, b] = shot === "skyline" ? [owl, owl] : [of("ZIP"), of("REEF")];
          const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          const span = Math.max(8, Math.hypot(a.x - b.x, a.z - b.z));
          const out = Math.atan2(mid.x, mid.z) + (shot === "skyline" ? 0.35 : -0.35);
          const d = span * 0.55 + (mobile ? 22 : 14);
          v = [[mid.x + Math.sin(out) * d, (mobile ? 30 : 22) + span * 0.35, mid.z + Math.cos(out) * d], [mid.x, 3, mid.z]];
        }
        if (!v || typeof window.__cityView !== "function") return false;
        window.__cityView(v[0], v[1]);
        window.__shotView = v;
        return true;
      },
      { shot, mobile: s.mobile },
    );
    if (!ok) continue;
    // The city's own camera may still be settling: put the camera there again until it stays.
    for (let tries = 0; tries < 6; tries += 1) {
      await page.waitForTimeout(1500);
      const away = await page.evaluate(() => {
        const [eye] = window.__shotView;
        const at = window.__camera.position;
        return Math.hypot(at.x - eye[0], at.y - eye[1], at.z - eye[2]);
      });
      if (away < 1) break;
      await page.evaluate(() => window.__cityView(window.__shotView[0], window.__shotView[1]));
    }
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, `${shot}-${s.name}.png`), timeout: 300_000 });
  }
  await page.evaluate(() => window.__cityView?.(null));
  await hide.evaluate((node) => node.remove());

  /* The tower's window: its status on top, the rings, and the rule and «not advice» behind the «i». */
  for (const symbol of ["OWL", "ZIP", "REEF"]) {
    await page.evaluate((symbol) => {
      const st = window.__city.getState();
      st.select(st.layout.towers.find((t) => t.tower.symbol === symbol).tower.id);
    }, symbol);
    await page.locator("[data-launch-status]").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    // The window from its top: on a phone the sheet keeps its scroll from the last tower.
    await page.evaluate(() => {
      for (let node = document.querySelector("[data-launch-status]"); node; node = node.parentElement) if (node.scrollHeight > node.clientHeight + 4) node.scrollTop = 0;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `window-${symbol.toLowerCase()}-${s.name}.png`), timeout: 300_000 });
    if (symbol !== "ZIP") {
      // A DOM click: the software-rendered canvas leaves too few frames for Playwright's own checks of a tap.
      const tap = () => page.evaluate(() => document.querySelector("[data-launch-status]").click());
      await tap();
      await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector("[data-launch-status]").scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `window-${symbol.toLowerCase()}-about-${s.name}.png`), timeout: 300_000 });
      await tap();
    }
  }
  await context.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`wrote ${out}`);
