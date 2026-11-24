import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SEEKER_CONNECT_WALLET } from "../../lib/solana/seeker-connect.ts";
import { KNOWN, backpackBrowseUrl, okxBrowseUrl, placeOf, walletName, walletRows } from "./wallet-catalog.ts";
import { WALLET } from "./words.ts";

/* «Connect wallet»: the wallets a browser has first, then the popular Solana wallets it does
   not have — each with its logo and one honest step for the place: its install page on a computer, a link that opens
   Ryntra in its app on a phone. Nothing here connects or signs. */

const HERE = { url: "https://ryntra.io/swap?pair=SOL#secret", origin: "https://ryntra.io" };
const REPO = fileURLToPath(new URL("../..", import.meta.url));

test("the popular wallets are named, in order, each with a logo the site has", () => {
  assert.deepEqual(
    KNOWN.map((known) => known.name),
    ["Phantom", "Solflare", "Backpack", "Jupiter", "OKX Wallet", "Seeker"],
  );
  for (const known of KNOWN) {
    assert.match(known.logo, /^\/terminal\/wallets\/[a-z]+\.(svg|png)$/, `${known.name}: a file of the site, never another host`);
    assert.ok(existsSync(`${REPO}public${known.logo}`), `${known.name}: ${known.logo}`);
    if (known.logo.endsWith(".svg")) assert.match(readFileSync(`${REPO}public${known.logo}`, "utf8"), /^<svg[^>]*viewBox/, `${known.name}: an SVG`);
  }
});

test("a computer with no wallet: every popular wallet with its install page, the Seeker's not among them", () => {
  const { installed, more } = walletRows([], "desk", HERE);
  assert.deepEqual(installed, []);
  assert.deepEqual(
    more.map((row) => [row.key, row.kind === "get" ? row.step : row.kind]),
    [["phantom", "install"], ["solflare", "install"], ["backpack", "install"], ["jupiter", "install"], ["okx", "install"]],
  );
  for (const row of more) assert.match(row.kind === "get" ? row.href : "", /^https:\/\//);
});

test("a phone with no wallet: links that open Ryntra inside each app, never with the page's fragment", () => {
  const { more } = walletRows([], "ios", HERE);
  const href = Object.fromEntries(more.map((row) => [row.key, row.kind === "get" ? row.href : ""]));
  assert.equal(href.phantom, "https://phantom.app/ul/browse/https%3A%2F%2Fryntra.io%2Fswap%3Fpair%3DSOL?ref=https%3A%2F%2Fryntra.io");
  assert.equal(href.solflare, "https://solflare.com/ul/v1/browse/https%3A%2F%2Fryntra.io%2Fswap%3Fpair%3DSOL?ref=https%3A%2F%2Fryntra.io");
  assert.equal(href.backpack, "https://backpack.app/ul/v1/browse/https%3A%2F%2Fryntra.io%2Fswap%3Fpair%3DSOL?ref=https%3A%2F%2Fryntra.io");
  assert.equal(href.okx, "https://web3.okx.com/download?deeplink=okx%3A%2F%2Fwallet%2Fdapp%2Furl%3FdappUrl%3Dhttps%253A%252F%252Fryntra.io%252Fswap%253Fpair%253DSOL");
  assert.equal(href.jupiter, "https://jup.ag/mobile", "Jupiter's app has no link of that kind: the row leads to the app");
  for (const link of Object.values(href)) assert.ok(!link.includes("secret"), "a fragment never leaves the page");
  assert.equal(backpackBrowseUrl("https://a.io/x#k", "https://a.io"), "https://backpack.app/ul/v1/browse/https%3A%2F%2Fa.io%2Fx?ref=https%3A%2F%2Fa.io");
  assert.ok(!okxBrowseUrl("https://a.io/x#k").includes("%23k"));
});

test("what the browser has comes first, by its own name and icon; it is not offered again below", () => {
  const { installed, more } = walletRows(
    [
      { name: "Trust", icon: "data:image/svg+xml;base64,AA==" },
      { name: "Phantom", icon: "data:image/svg+xml;base64,BB==" },
      { name: SEEKER_CONNECT_WALLET, icon: null },
    ],
    "android",
    HERE,
    true,
  );
  assert.deepEqual(installed.map((row) => row.wallet), [SEEKER_CONNECT_WALLET, "Trust", "Phantom"], "the Seeker's first, the rest as ranked");
  assert.equal(installed[0].name, "Seeker");
  assert.equal(installed[0].seeker, true);
  assert.equal(installed[1].logo, "data:image/svg+xml;base64,AA==", "a wallet keeps the icon it registered");
  assert.equal(installed[2].logo, "data:image/svg+xml;base64,BB==", "a known one too: its own icon is the official one");
  assert.equal(installed[0].logo, "/terminal/wallets/seeker.svg", "a known wallet that gave no icon takes the site's");
  assert.ok(!more.some((row) => row.key === "phantom" || row.key === "seeker"));
});

test("on Android a registered Seeker wallet a Seeker is not certain of is a quiet row that connects it; elsewhere it is not offered", () => {
  const android = walletRows([], "android", HERE, true).more;
  assert.deepEqual(android.at(-1), { kind: "seeker", key: "seeker", wallet: SEEKER_CONNECT_WALLET, name: "Seeker", logo: "/terminal/wallets/seeker.svg" });
  assert.ok(!walletRows([], "android", HERE, false).more.some((row) => row.key === "seeker"));
  assert.ok(!walletRows([], "ios", HERE, true).more.some((row) => row.key === "seeker"));
});

test("names and places as a person and a browser give them", () => {
  assert.equal(walletName(SEEKER_CONNECT_WALLET), "Seeker");
  assert.equal(walletName("OKX Wallet"), "OKX Wallet");
  assert.equal(walletName("Jupiter Wallet"), "Jupiter");
  assert.equal(walletName("Glow"), "Glow");
  assert.equal(placeOf("Mozilla/5.0 (Linux; Android 14; Seeker)"), "android");
  assert.equal(placeOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(placeOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desk");
  assert.equal(placeOf(undefined), "desk");
});

test("the window's words stand in both languages", () => {
  for (const lang of ["en", "uk"]) {
    for (const key of ["connectTitle", "noneHere", "openInApp", "installed", "moreWallets", "install", "open", "onSeeker"]) assert.equal(typeof WALLET[lang][key], "string", `${lang}.${key}`);
    assert.match(WALLET[lang].installName("Phantom"), /Phantom/);
    assert.match(WALLET[lang].openIn("Solflare"), /Solflare/);
  }
});

test("the phone's header says a word beside the wallet's icon — «Connect», on a Seeker its Seed Vault", () => {
  for (const lang of ["en", "uk"]) {
    assert.ok(WALLET[lang].connectShort.length <= 12, `${lang}: one short word`);
    assert.equal(WALLET[lang].seedVault, "Seed Vault");
  }
  const button = readFileSync(new URL("./Wallet.tsx", import.meta.url), "utf8");
  assert.match(button, /seeker \? w\.seedVault : w\.connectShort/u);
  // The word shown stands in the button's name: «Connect wallet» holds «Connect»; a Seeker's name says its Seed Vault.
  assert.match(button, /aria-label=\{seeker \? `\$\{label\} · \$\{w\.seedVault\}` : label\}/u);
  for (const lang of ["en", "uk"]) assert.ok(WALLET[lang].connect.startsWith(WALLET[lang].connectShort), lang);
  // The Seeker's wallet by one name in the window too.
  assert.doesNotMatch(button, /w\.inYourPhone|w\.onSeeker/u);
  assert.equal(button.match(/s\.choiceSub\}>\{w\.seedVault\}/gu)?.length, 2);
  const css = readFileSync(new URL("./shell.module.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 767px) {\n  .app {"));
  // On the home page, where the header has no agent's line; elsewhere that line keeps the room (never cut to «Tell you»).
  assert.match(phone, /\.app:has\(\[data-terminal='hero'\]\) \.walletShort \{\n    display: inline;/u, "the word stands on the phone's first screen");
  assert.match(phone, /\.app:has\(\[data-terminal='hero'\]\) \.wallet\[data-connect\] \{\n    width: auto;/u);
  // The agent's tab has one look on every page: no page, the home page included, dresses it otherwise.
  const gemRules = css.split("\n").filter((line) => /\.gem\b/u.test(line) && line.includes("{"));
  assert.deepEqual(gemRules, [".gem {"], "no page-bound rule for the agent's tab");
  const gem = css.slice(css.indexOf("\n.gem {"));
  assert.match(gem.slice(0, gem.indexOf("}")), /background: linear-gradient\(180deg, var\(--amber-hi\), var\(--amber\)\);/u);
});

test("under the window's action, one calm line on what connecting does — the address only, money by a signature", () => {
  assert.match(WALLET.en.closeCalm, /only shows your address/u);
  assert.match(WALLET.uk.closeCalm, /лише показує адресу/u);
  // Beside «One signature and your wallet is connected»: this signature is not the money's.
  assert.match(WALLET.en.closeCalm, /moves no money/u);
  assert.match(WALLET.uk.closeCalm, /не рухає гроші/u);
});

test("the tickets' wallet list is the window's own — Seeker Connect first, its Seed Vault named, each with its logo", () => {
  const rows = walletRows([{ name: "Phantom", icon: null }, { name: SEEKER_CONNECT_WALLET, icon: null }], "android", HERE).installed;
  assert.equal(rows[0].wallet, SEEKER_CONNECT_WALLET, "Seeker Connect first");
  const pick = readFileSync(fileURLToPath(new URL("../coin/WalletPick.tsx", import.meta.url)), "utf8");
  assert.match(pick, /walletRows\(/u, "the ticket orders its wallets as the window does");
  assert.match(pick, /row\.seeker \? <span className=\{s\.doorSub\}>\{w\.seedVault\}<\/span>/u);
  assert.match(pick, /<DoorLogo src=\{row\.logo\}/u);
  assert.doesNotMatch(pick, /wallets\.map\(/u, "never the browser's raw order");
});
