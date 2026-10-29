import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

/*
 * B18 «Гроші» — the B13 review's item 12 and its blueprint (`audit/2026-10/solana-web-review/critics/money.md` §5):
 * logos instead of letters, one name instead of repeats, a 560 px form with a side column, USDC by default, «Між
 * мережами» everywhere, old addresses by their content. Each rule here is one the review found broken.
 */

const ROOT = new URL("../../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const PAGES = {
  send: "app/solana/workspace/send/send-card.tsx",
  receive: "app/solana/workspace/receive/receive-card.tsx",
  bridge: "app/solana/workspace/bridge/bridge-surface.tsx",
  deposit: "app/app/top-up/top-up-surface.tsx",
};

test("the four pages of «Гроші» are one frame, named once by the menu's word", () => {
  for (const [item, path] of Object.entries(PAGES)) {
    const source = read(path);
    assert.match(source, /<MoneyPage\b/, `${path} draws the frame of «Гроші»`);
    assert.match(source, new RegExp(`title=\\{NAV_WORDS\\[(?:lang|locale)\\]\\.items\\.${item}\\}`), `${path} is named by the menu's word, once`);
    /* A card with a title of its own repeated the heading: «Надіслати» four times on one screen. */
    assert.doesNotMatch(source, /<Panel\b/, `${path} gives its card a title of its own again`);
  }
  for (const page of ["app/solana/workspace/send/page.tsx", "app/solana/workspace/receive/page.tsx", "app/solana/workspace/bridge/page.tsx"]) {
    const source = read(page);
    assert.doesNotMatch(source, /<PageHead\b|<PanelGrid\b|ry-money-flow/, `${page} draws a second heading or the old narrow column`);
  }
});

test("the form is 560 px with a side column of its context beside it on a desk, one pair in the middle", () => {
  const css = read("app/solana/workspace/money/money-page.module.css");
  assert.match(css, /--money-form: 560px;/);
  assert.match(css, /@media \(min-width: 1280px\) \{\s*\.page\[data-has-aside="true"\] \{\s*max-width: calc\(var\(--money-form\) \+ var\(--money-gap\) \+ var\(--money-aside\)\);/);
  assert.match(css, /margin-inline: auto;/, "the pair stands in the middle of the canvas");
  /* On a phone the one action is pinned above the bottom bar, under its sheet. */
  const phone = css.slice(css.indexOf("@media (max-width: 767px)"));
  assert.match(phone, /\.action \{[^}]*position: fixed;[^}]*bottom: calc\(var\(--sol-phonebar-h, 65px\) \+ env\(safe-area-inset-bottom, 0px\)\);[^}]*z-index: calc\(var\(--ryntra-z-sticky, 10\) - 1\);/s);
  for (const path of Object.values(PAGES)) assert.match(read(path), /<MoneyAction>/, `${path} pins its one action on a phone`);
  assert.match(read("app/solana/workspace/bridge/cross-swap-engine.tsx"), /<MoneyAction>/, "the transfer's own action is pinned too");
});

test("logos, never letters: every network and coin wears its own mark, a file of this site", async () => {
  for (const path of [PAGES.send, PAGES.bridge]) {
    const source = read(path);
    assert.doesNotMatch(source, /styles\.(?:tokenGlyph|glyph|glyphNetwork|glyphAsset)\b/, `${path} draws a letter where a mark belongs`);
    assert.match(source, /<AssetMark\b/, `${path} draws the coin's mark`);
  }
  assert.match(read(PAGES.bridge), /<NetworkMark\b/);
  assert.doesNotMatch(read(PAGES.send), /\{chosen \? ticker\.slice\(0, 1\) : "\?"\}/, "«? Актив» is back");
  const { SWAP_NETWORKS } = await import(new URL("lib/swap/catalog.ts", ROOT));
  for (const network of SWAP_NETWORKS) assert.ok(existsSync(new URL(`public/marks/networks/${network}.svg`, ROOT)), `${network} has no mark`);
  for (const coin of ["eth", "bnb", "pol", "usdt", "usdg"]) assert.ok(existsSync(new URL(`public/marks/coins/${coin}.svg`, ROOT)), `${coin} has no mark`);
  const marks = read("app/solana/workspace/money/marks.tsx");
  assert.doesNotMatch(marks, /https?:\/\//, "a mark never waits on a third host");
  /* A look-alike token never wears the real coin's picture: a coin with an address is known by its address. */
  assert.match(marks, /const local = mint \? MINT_PICTURE\[mint\] :/);
});

test("«Надіслати» opens on USDC, a guest may type the amount, and the field's role is said once", () => {
  const send = read(PAGES.send);
  assert.match(send, /openingSendAsset\(preferredSendAsset\(window\.sessionStorage, owner, available\), available\)/);
  assert.match(send, /const pillTicker = chosen \? ticker : connection \? "" : "USDC";/);
  assert.match(send, /\{text\("Amount"\)\}<\/label>/, "the amount field says «Сума», not the page's name");
  assert.match(send, /\{text\("To"\)\}<\/label>/);
  assert.doesNotMatch(send, /\{text\("Send"\)\}<\/span>/, "the field's label repeats the page's name");
  assert.doesNotMatch(send, /Solana mainnet/, "a technical chip names the network");
  assert.match(send, /rememberSendRecipient\(window\.localStorage, connection\.address, bundle\.plan\.recipient\)/, "a chip is only an address the chain confirmed");
});

test("«Між мережами» everywhere, never «Міст», and USDC → USDC by default", async () => {
  const { translateSolana } = await import(new URL("app/solana/workspace/i18n/catalog.ts", ROOT));
  assert.equal(translateSolana("uk", "Bridge"), "Між мережами");
  const { PAGE_LABELS } = await import(new URL("app/shell/domains.ts", ROOT));
  assert.deepEqual(PAGE_LABELS.bridge, { en: "Between networks", uk: "Між мережами" });
  for (const path of [PAGES.bridge, PAGES.deposit, "app/app/top-up/deposit-words.ts", "app/solana/workspace/history/history-lines.ts"]) {
    const visible = read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(visible, /Міст|мосту|text\("Bridge"\)/, `${path} still calls the work «Міст»`);
  }
  const page = read("app/solana/workspace/bridge/page.tsx");
  assert.match(page, /toAsset: assetOk\(params\.to, params\.ta\) \?\? \(toNetwork === undefined \? "USDC" : undefined\)/);
  assert.doesNotMatch(page, /"SOL" : undefined/, "the default pair turns dollars into SOL again");
  /* No badge, no dotted row repeating the direction the two legs already say. */
  const surface = read(PAGES.bridge);
  assert.doesNotMatch(surface, /badge=\{badge\}|const badge =/);
});

test("«Отримати»: the code is the bare address; payment links and their state beside the form", () => {
  const receive = read(PAGES.receive);
  assert.match(receive, /const qrValue = mode === "ADDRESS" \? address : \(created\?\.url \?\? null\);/, "Phantom's scanner refuses a `solana:` link");
  assert.match(receive, /<PaymentRequests address=\{connection\.address\} proven=\{proven\} version=\{requestsVersion\} \/>/);
  const requests = read("app/solana/workspace/money/payment-requests.tsx");
  assert.match(requests, /\/api\/pay\/requests\?address=/);
  assert.match(requests, /PAID: \{ en: "Paid", uk: "Оплачено"/);
  assert.match(requests, /AWAITING: \{ en: "Waiting", uk: "Чекає"/);
  assert.match(requests, /EXPIRED: \{ en: "Expired", uk: "Минув"/);
});

test("«Поповнити»: a guest sees what a purchase needs and every way, the wallet is asked once", () => {
  const deposit = read(PAGES.deposit);
  const guest = deposit.slice(deposit.indexOf("function GuestTopUp"), deposit.indexOf("function Ways"));
  assert.match(guest, /<FundLine symbol="USDC"[^>]*value="—"/);
  assert.match(guest, /<Ways mode=\{mode\}/, "the ways are open to read before connecting");
  assert.equal((guest.match(/<ConnectWalletButton/g) ?? []).length, 1, "one connect button (B14)");
  const ways = deposit.slice(deposit.indexOf("function Ways"), deposit.indexOf("function AddressAside"));
  /* A card, an exchange, another network, another wallet — the order a person reaches for them. */
  const order = ["way=\"card\"", "way=\"exchange\"", "way=\"network\"", "way=\"receive\""].map((needle) => ways.indexOf(needle));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the ways stand in the blueprint's order");
  assert.ok(order.every((at) => at > 0));
});
