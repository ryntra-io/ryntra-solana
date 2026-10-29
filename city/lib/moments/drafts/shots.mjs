// The desk for X for review (CITY-3): four drafts made from events (a Ryntra launch, its move into the skyline, a big x,
// an agent's find), each filmed by the city, one approved, the switch off; at 1440×860 and 390×844, each draft alone,
// and each draft's clip or card → <out>/
//   RYNTRA_MOMENTS_STORE=memory RYNTRA_MOMENTS_SECRET=<key> npm run dev
//   DESK_KEY=<key> DESK_COOKIE=<rta cookie of an operator signed in to the admin> \
//     node city/lib/moments/drafts/shots.mjs [out] [baseUrl]      (PRESS_CHROME may point at a Chromium)
// The key only sends the events in (a machine route); the desk itself opens for an operator's session alone.
// The events are staged on towers of the bundled city (development only, the queue in memory): nothing is posted.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/drafts-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const key = process.env.DESK_KEY ?? "";
const cookie = process.env.DESK_COOKIE ?? "";
mkdirSync(out, { recursive: true });

const auth = { Authorization: `Bearer ${key}` };
const operator = { Cookie: `rta=${cookie}`, Origin: new URL(base).origin };
const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const EVENTS = [
  { kind: "launch", id: "shots-launch", mint: "3V9fB1Q9s9Cv8Qoe4TmuHUBKAQqBUqJ5uKe3npFVfdHy", symbol: "PUMPFILES", named: false, district: "docks", sourceAt: at(42) },
  { kind: "graduate", id: "shots-graduate", mint: "769c7f6iLH1S2axabmR8Dua2gHAviNway9msYxmK1iYi", symbol: "TikTok", named: false, district: "docks", sourceAt: at(31) },
  { kind: "bigx", id: "shots-bigx", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", named: true, district: "heights", sourceAt: at(18), multiple: 6.2, tx: "5".repeat(88) },
  { kind: "agent", id: "shots-agent", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "Bonk", named: true, district: "strip", sourceAt: at(7), agent: "Scout 7", rule: "traders tripled", change: 18.4, window: "1H" },
];

for (const e of EVENTS) {
  const res = await fetch(`${base}/api/moments/events`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(e) });
  if (!res.ok && res.status !== 200) throw new Error(`${e.kind}: ${res.status} ${await res.text()}`);
}
const queue = async () => (await (await fetch(`${base}/api/moments/drafts`, { headers: operator })).json()).drafts;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const open = async (s) => {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  await context.addCookies([{ name: "rta", value: cookie, url: base }]);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/#drafts`, { waitUntil: "domcontentloaded" });
  await page.getByRole("complementary", { name: "Drafts for X" }).waitFor({ timeout: 120_000 });
  return { page, context };
};

// The laptop desk films every draft: the city stages each moment and the clip lands in the queue.
const laptop = await open({ width: 1440, height: 860, mobile: false });
const until = Date.now() + 420_000;
while ((await queue()).some((d) => d.status === "filming") && Date.now() < until) await laptop.page.waitForTimeout(2000);
const drafts = await queue();
const graduate = drafts.find((d) => d.kind === "graduate");
if (graduate?.status === "ready") await fetch(`${base}/api/moments/drafts/${graduate.id}/approve`, { method: "POST", headers: operator });
await laptop.page.reload({ waitUntil: "domcontentloaded" });
await laptop.page.locator("aside li img").first().waitFor({ timeout: 120_000 });
await laptop.page.waitForTimeout(3000);
await laptop.page.screenshot({ path: path.join(out, "desk-1440.png") });
for (const d of await queue()) {
  const card = laptop.page.locator("aside li", { hasText: d.text.slice(0, 40) });
  await card.scrollIntoViewIfNeeded();
  await laptop.page.waitForTimeout(600);
  await card.screenshot({ path: path.join(out, `draft-${d.kind}.png`) });
  const media = await fetch(`${base}/api/moments/drafts/${d.id}/clip`, { headers: operator });
  const ext = { "video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg" }[d.media?.type];
  if (media.ok && ext) writeFileSync(path.join(out, `media-${d.kind}.${ext}`), Buffer.from(await media.arrayBuffer()));
}
await laptop.context.close();

const phone = await open({ width: 390, height: 844, mobile: true });
await phone.page.locator("aside li img").first().waitFor({ timeout: 120_000 });
await phone.page.waitForTimeout(3000);
const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await phone.page.screenshot({ path: path.join(out, "desk-390.png") });
await phone.context.close();

await browser.close();
writeFileSync(path.join(out, "queue.json"), JSON.stringify(await queue(), null, 2));
console.log(JSON.stringify({ drafts: (await queue()).map((d) => [d.kind, d.status, d.media]), overflow, errors }, null, 2));
