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
