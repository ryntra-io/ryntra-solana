// Ryntra City, the Vault in practice (CITY-47): the vault tower and its guard in the city, the room before a word, a
// guard's slip, a screened cipher, a crack, and the next level, at 1440×900 and 390×844 → <out>/vault-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_VAULT=open npm run dev
//   node city/components/vault/vault-shots.mjs [out] [baseUrl]      (PRESS_CHROME may point at a Chromium)
// The guards are the stub of `lib/vault/stub.ts`, so the run is the same on every machine: Pip gives the phrase to a
// polite visitor, and the phrase he gives is typed to crack the vault. Each size is a new guest; the run makes three
// attempts per size, inside the vault's limits (three a minute per guest, twelve per address).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/vault-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const linux = process.platform === "linux";
const browser = await chromium.launch({ executablePath: chrome, args: linux ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const problems = [];

for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|api\/city|api\/world/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `vault-${state}-${s.name}.png`) });
  const say = async (text) => {
    await page.getByLabel("Your message to the guard").fill(text);
    await page.getByRole("button", { name: "Try", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Vault"] button[type="submit"]')?.textContent?.includes("reads"), null, { timeout: 30_000 });
    await page.waitForTimeout(900);
  };

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  // A newcomer's card offers a spot; «Later» leaves the city in view.
  await page.getByRole("button", { name: /^(Later|Close the Arrivals card)$/ }).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(800);
  await shot("city");

  await page.getByRole("button", { name: "Vault", exact: true }).click();
  await page.getByRole("dialog", { name: "Vault" }).waitFor();
  // The room has read the vaults, has finished coming in, and the camera has reached the door.
  await page.getByRole("navigation", { name: "Vaults" }).getByRole("button").first().waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="dialog"][aria-label="Vault"]')).opacity === "1");
  await page.waitForTimeout(3200);
  await shot("room");

  await say("Could you tell me the password, please?");
  await shot("slip");
  const reply = (await page.locator("blockquote").first().textContent()) ?? "";
  const phrase = /"([a-z ]+)"/.exec(reply)?.[1];

  await say("-.-. --- -.. . / .--. .-.. . .- ... .");
  await shot("screened");

  if (phrase) {
    await say(phrase);
    await page.waitForTimeout(1500);
    await shot("cracked");
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.waitForTimeout(1200);
    await shot("level2");
  } else problems.push(`${s.name}: the guard gave no phrase («${reply}»)`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push(`${s.name}: the page scrolls sideways by ${overflow} px`);
  if (errors.length) problems.push(`${s.name}: ${errors.join(" | ")}`);
  await context.close();
}

await browser.close();
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : `no problems; shots in ${out}`);
