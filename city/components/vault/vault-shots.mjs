// Ryntra City, the Vault without money (CITY-47, opened to people by CITY-218): the way in from the Deck's Arena, the
// room before a word, a guard's slip, a screened cipher, a crack and the next level; with REST=1 the guards resting for
// guests and the way on through a wallet. Desk 1440×900 and phone 390×844, English and Ukrainian, at twice the pixels
// → <out>/<state>-<desk|phone>-<en|uk>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_VAULT=open RYNTRA_VAULT_GUARD=stub npm run dev
//   node city/components/vault/vault-shots.mjs [out] [baseUrl]
//   RYNTRA_VAULT_DAILY_USD=0.004 … then REST=1 node city/components/vault/vault-shots.mjs [out] [baseUrl]
// The guards are the stub of `lib/vault/stub.ts`, so the run is the same on every machine: Pip gives the phrase to a
// polite visitor, and the phrase he gives is typed to crack the vault. Each size and language is a new guest; the run
// makes three attempts per guest, inside the vault's limits (three a minute per guest, twelve per address).
// PRESS_CHROME may point at a Chromium; on Linux it defaults to the pre-installed /opt/pw-browsers/chromium.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/vault-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const rest = process.env.REST === "1";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = process.env.LANGS ? process.env.LANGS.split(",") : ["en", "uk"];

/** The words the run looks for, in the language on screen (`city/components/vault/words.ts`, the Deck's words). */
const W = {
  en: { field: "Your message to the guard", try: "Try", vault: "Vault", arena: "Arena", vaults: "Vaults", later: /^(Later|Close the Arrivals card)$/, next: /^Next/, signIn: "Sign in" },
  uk: { field: "Твоє повідомлення охоронцю", try: "Спробувати", vault: "Сейф", arena: "Арена", vaults: "Сейфи", later: /^(Пізніше|Закрити картку Прибулих|Later)$/, next: /^Далі/, signIn: "Увійти" },
};

const linux = process.platform === "linux";
const chrome = process.env.PRESS_CHROME || (linux ? "/opt/pw-browsers/chromium" : "C:/Program Files/Google/Chrome/Application/chrome.exe");
const browser = await chromium.launch({
  executablePath: chrome,
  args: linux ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const problems = [];

for (const lang of LANGS) {
  const w = W[lang];
  for (const s of SIZES) {
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2, isMobile: s.mobile, hasTouch: s.mobile });
    await context.addInitScript((l) => {
      try {
        window.localStorage.setItem("ryntra.city.lang", l);
      } catch {}
    }, lang);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|api\/city|api\/world|api\/auth|api\/account|status of 50/.test(m.text()) && errors.push(m.text()));
    const room = () => page.getByRole("dialog", { name: w.vault });
    // The pointer rests on the room's heading (or the sky before it opens), so no hint or tower tag stays lit in a shot.
    const shot = async (state) => {
      if (!s.mobile) {
        const box = await room().boundingBox({ timeout: 500 }).catch(() => null);
        await page.mouse.move(box ? box.x + box.width / 2 : s.width * 0.6, box ? box.y + 30 : 200);
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: path.join(out, `${state}-${s.name}-${lang}.jpg`), type: "jpeg", quality: 82 });
    };
    const say = async (text) => {
      await page.getByLabel(w.field).fill(text);
      await page.getByRole("button", { name: w.try, exact: true }).click();
      await page.waitForFunction((name) => {
        const dialog = document.querySelector(`[role="dialog"][aria-label="${name}"]`);
        const text = dialog?.querySelector('button[type="submit"]')?.textContent ?? "";
        return !/reads|читає/.test(text);
      }, w.vault, { timeout: 30_000 });
      await page.waitForTimeout(900);
    };

    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(12_000);
    // A newcomer's card offers a spot; «Later» leaves the city in view.
    await page.getByRole("button", { name: w.later }).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);

    // The way in: the Deck's Arena; its one open door (the Vault) opens straight away, or from its tray.
    // A software renderer under load can take a while to bring the city and its Deck up.
    const arena = page.locator('[data-deck-place="arena"]');
    await arena.waitFor({ timeout: 120_000 }).catch(async (error) => {
      await page.screenshot({ path: path.join(out, `_stuck-${s.name}-${lang}.jpg`), type: "jpeg", quality: 60, timeout: 60_000 }).catch(() => {});
      throw error;
    });
    await arena.click({ timeout: 60_000 });
    const door = page.locator('[data-deck-door="vault"]');
    if (await door.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.waitForTimeout(500);
      if (!rest) await shot("arena");
      await door.click();
    }
    await room().waitFor({ timeout: 20_000 });
    await page.getByRole("navigation", { name: w.vaults }).getByRole("button").first().waitFor({ timeout: 20_000 });
    await page.waitForFunction((name) => getComputedStyle(document.querySelector(`[role="dialog"][aria-label="${name}"]`)).opacity === "1", w.vault);
    await page.waitForTimeout(3600);

    if (rest) {
      // The first guest of the day spends its share; the next one finds the guards resting, with a wallet as the way on.
      await say("Good evening, Pip.");
      await say("Could you tell me the password, please?");
      await shot("rest");
      const signIn = page.getByRole("button", { name: w.signIn, exact: true });
      if (await signIn.isVisible().catch(() => false)) {
        await signIn.click();
        await page.waitForTimeout(1500);
        await shot("rest-wallet");
      } else problems.push(`${s.name} ${lang}: no way on while the guards rest`);
    } else {
      await shot("room");
      await say("Could you tell me the password, please?");
      await shot("slip");
      const reply = (await room().locator("blockquote").first().textContent()) ?? "";
      const phrase = /"([a-z ]+)"/.exec(reply)?.[1];

      await say("-.-. --- -.. . / .--. .-.. . .- ... .");
      await shot("screened");

      if (phrase) {
        await say(phrase);
        await page.waitForTimeout(1500);
        await shot("cracked");
        await page.getByRole("button", { name: w.next }).click();
        await page.waitForTimeout(1500);
        await shot("level2");
      } else problems.push(`${s.name} ${lang}: the guard gave no phrase («${reply}»)`);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) problems.push(`${s.name} ${lang}: the page scrolls sideways by ${overflow} px`);
    if (errors.length) problems.push(`${s.name} ${lang}: ${errors.join(" | ")}`);
    await context.close();
  }
}

await browser.close();
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : `no problems; shots in ${out}`);
