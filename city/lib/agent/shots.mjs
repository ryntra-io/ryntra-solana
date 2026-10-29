// The scout's screens for review, at 1440×860 and 390×844 → <out>/agent-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open npm run dev
//   node city/lib/agent/shots.mjs [out] [baseUrl]
// The city's live read from Jupiter; no wallet and no keys. The rule is picked with taps, as a person would.
// SAVED=1: where Jupiter cannot be reached (a cloud sandbox), the bundled snapshot is served as a fresh live read,
// so the figures on the screens are the saved city's, not today's.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/agent-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  if (process.env.SAVED) {
    const saved = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
    await page.route("**/api/city", (route) => route.fulfill({ json: { ...saved, source: "live", fetchedAt: new Date().toISOString() } }));
  }
  const shot = (state) => page.screenshot({ path: path.join(out, `agent-${state}-${s.name}.png`) });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__city?.getState().snapshot.source === "live", null, { timeout: 120_000 });
  // A software renderer takes a while over the first frames of the city, a phone's doubled pixels longest.
  await page.waitForTimeout(s.mobile ? 20_000 : 6_000);
  await shot("home");

  // The rule, from fixed choices.
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.waitForTimeout(600);
  // A district on the camera's side of the island, so the drone over the find is in frame beside the card.
  await page.getByRole("radio", { name: "Rising today" }).click();
  await page.getByRole("radio", { name: "+5%" }).click();
  await page.getByRole("radio", { name: "$250K" }).click();
  await page.getByRole("radio", { name: "DeFi Heights" }).click();
  await page.getByRole("radio", { name: "$250", exact: true }).click();
  await page.waitForTimeout(300);
  await shot("rule");

  // Launched: the drone patrols, the card says what it does.
  await page.getByRole("button", { name: "Launch scout" }).click();
  await page.waitForTimeout(2500);
  await shot("flying");

  // A find: the drone hangs over the tower and its card opens.
  await page.getByRole("dialog", { name: /^Scout found/ }).waitFor({ timeout: 60_000 });
  // Let a market moment on the same tower play out, so the drone is what the frame shows.
  await page.waitForFunction(() => Date.now() - (window.__city.getState().feed[0]?.at ?? 0) > 9000, null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot("find");

  // Ryntra's word, only when asked.
  await page.getByRole("button", { name: "Ask Ryntra" }).click();
  await page.waitForFunction(() => window.__agent?.getState().advice.status !== "loading", null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot("advice");

  // The one button: the tower's own trade card, where the person signs.
  await page.getByRole("button", { name: /^(Buy|Open) \$/ }).click();
  await page.waitForTimeout(3500);
  await shot("trade");

  console.log(`${s.name}: errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
  await context.close();
}
await browser.close();
