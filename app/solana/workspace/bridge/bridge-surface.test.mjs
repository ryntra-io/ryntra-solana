import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Source pins for the unified Swap surface.
 *
 * What these assert is the product law of this surface, in the place it can
 * drift: the page renders one surface; the surface classifies with the shared
 * table and never chooses a provider by itself; the engines it embeds are the
 * accepted ones, reached through their embedded mode rather than copied; and no
 * provider's raw words, request ids or intent digests are rendered at rest.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("./page.tsx");
const surface = read("./bridge-surface.tsx");
const engine = read("./cross-swap-engine.tsx");
const swapCard = read("../trade/swap-card.tsx");
const bridgeCard = read("./bridge-card.tsx");

test("the Bridge page mounts the cross-chain surface and nothing Solana-only", () => {
  assert.match(page, /BridgeSurface/);
  assert.doesNotMatch(page, /<SwapCard\b/, "Bridge never mounts the Jupiter card");
});

test("Swap is Solana-only: no network selector, and a cross-network link leaves for Bridge", () => {
  /* Swap is Solana-only and every cross-network pair belongs to Bridge. The
     two properties that make the split real are both here: the page mounts the
     Jupiter card directly rather than a surface that could classify its way
     into a bridge, and a link naming a network that is not Solana is
     **redirected** to Bridge rather than reinterpreted — reinterpreting a link
     is how a Robinhood Chain pair silently reopened Solana once already. */
  const swapPage = read("../swap/page.tsx");
  assert.match(swapPage, /<SwapCard\b/, "Swap mounts the Solana card itself");
  assert.doesNotMatch(swapPage, /BridgeSurface|CrossSwapEngine/, "Swap can reach no cross-chain engine");
  assert.match(swapPage, /redirect\(`\/app\/bridge/, "a cross-network link must leave for Bridge");
  assert.match(swapPage, /params\.in/);
  assert.match(swapPage, /params\.out/);
});

test("the surface classifies with the shared table and reaches exactly one engine", () => {
  assert.match(surface, /classifySwapRoute\(from, to\)/);
  assert.match(surface, /classification\.kind === "CROSS_SWAP"[\s\S]*<CrossSwapEngine/);
  /* The two engines this surface used to mount are gone from it entirely —
     not merely unreachable behind a condition, which is a thing an edit can
     undo without noticing. */
  assert.doesNotMatch(surface, /<SwapCard\b/, "Bridge must never mount the Jupiter card");
  assert.doesNotMatch(surface, /<BridgeCard\b/, "Bridge must never mount the CCTP card");
  /* No provider is picked here: the surface never names Jupiter, Circle or Mayan as a choice. */
  assert.doesNotMatch(surface, /"JUPITER"|"MAYAN"|"CCTP"/);
  /* A Solana pair is a signpost to Swap rather than a wall or a silent carry. */
  assert.match(surface, /SAME_NETWORK_IS_SWAP/);
  assert.match(surface, /href="\/app\/swap"/);
});

test("the accepted engines expose an embedded mode instead of being rewritten", () => {
  assert.match(swapCard, /export type SwapCardEmbedded/);
  assert.match(swapCard, /embedded \? null : \(/);
  assert.match(swapCard, /if \(embedded\) return;/, "the embedded card does not fight the surface for the address bar");
  assert.match(bridgeCard, /export type BridgeCardEmbedded/);
  assert.match(bridgeCard, /embedded \? null : \(/);
  /* The money paths are untouched: the same routes, in the same order. */
  for (const path of ["/api/solana/swap/quote", "/api/solana/swap/order", "/api/solana/swap/execute", "/api/solana/swap/recover"]) {
    assert.match(swapCard, new RegExp(path.replace(/\//g, "\\/")));
  }
  for (const path of ["/api/solana/bridge/plan", "/api/solana/bridge/burn", "/api/solana/bridge/attestation", "/api/solana/bridge/mint", "/api/solana/bridge/recover"]) {
    assert.match(bridgeCard, new RegExp(path.replace(/\//g, "\\/")));
  }
});

test("the cross-chain engine never falls back to another provider, never resubmits, and keeps technical words off the resting surface", () => {
  assert.match(engine, /\/api\/solana\/cross-swap\/quote/);
  assert.match(engine, /\/api\/solana\/cross-swap\/plan/);
  assert.match(engine, /\/api\/solana\/cross-swap\/submit/);
  assert.match(engine, /\/api\/solana\/cross-swap\/status/);
  assert.match(engine, /submitting\.current/, "one in-flight submit at a time");
  /* The lane now carries two providers, so "the engine never names one"
     stopped being the way to state this rule and started being a rule against
     a comment. What must stay true is stronger and is what this asserts: the engine never *chooses*. It has no provider
     branch, no fallback, no second attempt against another rail — it renders
     the label the plan gives it and posts to the same four routes whichever
     provider answered. A provider named in prose is fine; a provider named in
     a condition is the defect. */
  assert.doesNotMatch(engine, /(if|\?|&&|\|\|)[^\n]*\b(provider|engine)\s*===\s*"(MAYAN|RELAY)"/, "the engine never branches on which provider carried the order");
  assert.doesNotMatch(engine, /\b(deBridge|LI\.FI|Across|Chainflip)\b/, "no provider outside the two approved ones is named at all");
  assert.doesNotMatch(engine, /fallback|retryWith|otherProvider/i, "no fallback to a second rail exists");
  assert.match(engine, /plan\.quote\.routeLabel/, "the provider a person reads is the plan's own label, never one the engine picked");
  assert.match(engine, /bridgeSubmitNeedsRecovery\(result.failure\)/, "unknown and crossed responses go to recovery; its behavior is covered by bridge-client-state tests");
  assert.doesNotMatch(engine, /intentDigest\}\s*<\//, "the intent digest is never printed");
  assert.doesNotMatch(engine, /providerStatus\}/, "the provider's raw status word is never printed");
  /* The Review states each of these exact figures. */
  for (const word of ["You pay", "You receive at least", "Provider fees", "Wallet prompts", "Expected time", "Provider", "Destination"]) {
    assert.match(engine, new RegExp(`text\\("${word}"\\)`), word);
  }
});

test("the lane is fail-closed, and the ten tuples are the only cross-asset pairs", () => {
  const laneState = read("../../../../lib/solana/lane-state.ts");
  assert.match(laneState, /CROSS_SWAP: "RYNTRA_SOLANA_CROSS_SWAP_STATE"/);
  /* Robinhood Chain arrived with a second provider and a second switch beneath
     the lane's. Both are asserted here, because a new money route that shipped
     open would be the defect this test family exists to catch. */
  assert.match(laneState, /robinhood: "RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE"/);
  assert.match(laneState, /export function resolveSolanaCrossSwapRouteState/);
  const catalog = read("../../../../lib/swap/catalog.ts");
  const tuples = [...catalog.matchAll(/id: "([A-Z_]+_TO_[A-Z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tuples, [
    "ETHEREUM_ETH_TO_SOLANA_SOL",
    "SOLANA_SOL_TO_ETHEREUM_ETH",
    "BASE_USDC_TO_SOLANA_SOL",
    "SOLANA_SOL_TO_BASE_USDC",
    "SOLANA_SOL_TO_ROBINHOOD_USDG",
    "ROBINHOOD_USDG_TO_SOLANA_SOL",
    "SOLANA_USDC_TO_ROBINHOOD_USDG",
    "ROBINHOOD_USDG_TO_SOLANA_USDC",
    "ROBINHOOD_ETH_TO_SOLANA_SOL",
    "SOLANA_SOL_TO_ROBINHOOD_ETH",
  ]);
  /* Every tuple names the provider approved for it, so the classifier can read
     the engine off the tuple rather than inferring it from the networks. */
  const providers = [...catalog.matchAll(/provider: "(MAYAN|RELAY)"/g)].map((match) => match[1]);
  assert.equal(providers.length, tuples.length, "every tuple names a provider");
  assert.equal(providers.filter((entry) => entry === "RELAY").length, 6);
});

test("the largest amount offered is the largest amount signable, and an amount above it is named", () => {
  /* Found on production with a wallet connected: 0.1 SOL typed against a
     0.0323637 SOL balance, and the surface said nothing — the button was grey
     for the paused lane and would have stayed grey for the shortfall. */
  assert.match(surface, /crossSwapOfferableRaw\(/, "the shares and MAX fill from the offerable amount, not the raw balance");
  assert.match(surface, /const overBalance =/);
  assert.match(surface, /offerableRaw=\{offerable\?\.raw \?\? null\}/, "the engine is told what can actually be signed");
  assert.match(engine, /const overBalance = amountRaw !== null && offerableRaw != null/);
  assert.match(engine, /text\("Not enough"\)/);
  /* The button says which of its five reasons is stopping it. */
  for (const reason of ["Enter an amount", "Add the destination address", "Check the destination address", "Not open yet"]) {
    assert.ok(engine.includes(`text("${reason}")`), reason);
  }
  assert.doesNotMatch(engine, /disabled=\{!q \|\| !amountRaw/, "the unexplained five-way grey button is gone");
});

test("the destination on another network is text the person types, never a wallet to connect (SOL-W1)", () => {
  assert.doesNotMatch(engine, /Use my Base wallet|askEvmWallet|onConnectEvm|evmAddress/);
  assert.match(engine, /className=\{styles\.address\}/, "the receiving address is an input");
  assert.match(engine, /That is not an Ethereum-style address\./, "a mistyped address is named before Review");
});
test("nothing on a Solana page signs on another network: the EVM-origin branch is gone, a non-Solana plan is refused (SOL-W1)", () => {
  assert.doesNotMatch(engine, /lib\/base\/wallet\.client|sendEvmTransaction|waitForEvmReceipt|EVM_WALLET_CHAINS/);
  assert.match(engine, /if \(plan\.plan\.origin === "solana"\) \{[\s\S]*?signTransaction\(\{ wallet: solana\.wallet/, "Solana sends are signed by the Solana wallet");
  assert.match(engine, /Not a Solana plan: nothing on a Solana page signs it/);
});
test("a finished step is readable, not dark ink on a dark panel", () => {
  /* --rt-reconciled-green-ink is the ink that sits ON the verified green fill
     (#0B3D2A) and the receipts surface uses it on paper. On this dark panel the
     pill has no fill, so every completed step rendered as an empty capsule. */
  const css = read("./bridge-surface.module.css");
  const done = css.slice(css.indexOf('.progress li[data-state="done"]'));
  const rule = done.slice(0, done.indexOf("}"));
  assert.doesNotMatch(rule, /--rt-reconciled-green-ink/, "fill ink never colours text on an unfilled pill");
  assert.match(rule, /color: var\(--rt-reconciled-green/);
});

test("every surface that words a lane words the cross-chain one", () => {
  /* The first cross-chain swap read "Sent 3.347272 USDC" on the Solana home
     feed, "3.347272 USDC" on the app Home feed, "Sending" while it was in
     flight, and showed only its outgoing leg on the receipt line. Four
     surfaces became three when Home folded into Portfolio, one omission each:
     the lane was added to the ledger and to Activity and nowhere else. A swap
     must never be worded as a send. */
  for (const [file, path] of [
    ["home-surface", "../home-surface.tsx"],
    ["holdings-card", "../holdings/holdings-card.tsx"],
    ["receipt-lines", "../receipts/receipt-lines.ts"],
    /* A row's words live in `history-lines.ts` since B2b, shared with Home's «Останні операції». */
    ["history-lines", "../history/history-lines.ts"],
  ]) {
    assert.ok(read(path).includes('CROSS_SWAP'), file);
  }
  /* And the lane union itself is imported, never retyped. */
  const surface = read("../home-surface.tsx");
  assert.match(surface, /lane: SolanaActionLane;/);
  assert.doesNotMatch(surface, /lane: "SEND" \| "SWAP"/, "a hand-copied lane union is how this happened");
});

test("only the Solana balance is read: another network has no wallet on this page (SOL-W1)", () => {
  assert.doesNotMatch(surface, /BASE_TO_SOLANA|ETHEREUM_TO_SOLANA/, "no CCTP direction is inferred from a swap network");
  assert.doesNotMatch(surface, /"\/api\/swap\/balance"|evmBalance|evmAddress/);
  assert.match(surface, /Another network's balance is not read: no wallet of that network is connected here\./);
});
test("only the Solana leg carries a wallet; money in from another network is a deposit address (SOL-W1)", () => {
  assert.match(surface, /const walletChip = /);
  assert.match(surface, /if \(network !== "solana"\) return null;/);
  assert.match(surface, /\{walletChip\("from"\)\}/);
  assert.doesNotMatch(surface, /lib\/base\/wallet\.client|connectEvmWallet|readEvmWalletAddress|watchEvmWalletAddress/);
  assert.match(surface, /<NetworkDeposit\s+key=\{connection\.address\}\s+recipient=\{connection\.address\}/, "into Solana is an address to send to");
  assert.match(surface, /const depositView = !outbound && !runOpen;/, "a transfer already under way keeps its engine, to its receipt");
  assert.match(surface, /ryntra\.solana\.cross-swap-run\.v1/);
  assert.match(engine, /const RUN_KEY = "ryntra\.solana\.cross-swap-run\.v1";/, "the surface reads the engine's own record");
});
test("an unmapped failure never claims a send, and a missing address is named", () => {
  /* The default read *Something did not go through. Nothing was sent twice.*
     under a quote that had never been priced — a sentence about a submission
     that never happened. `QUOTE_NO_ROUTE` is what Relay answers and was the
     one code missing from the list, so the whole Robinhood Chain lane printed
     it. */
  assert.ok(engine.includes('case "QUOTE_NO_ROUTE":'), "Relay's own no-route code is worded");
  assert.doesNotMatch(engine, /Something did not go through/, "the sentence that claimed a send is gone");
  assert.match(engine, /stage === "QUOTE"/, "the default says which step stopped, because that is all it knows");
  assert.match(engine, /failureCopy\(quoteFailure, "QUOTE"\)/);
  assert.match(engine, /failureCopy\(failure, "ACTION"\)/);
  /* `needs` distinguishes the two addresses; the sentence must read it rather
     than always naming the destination. */
  assert.match(engine, /entry\.extra\?\.needs/);
  assert.ok(engine.includes('needs.includes("sourceAddress")'));
  assert.ok(engine.includes('text("Connect the wallet you are sending from — this route is priced for the wallet that signs it.")'));
  const service = read("../../../../lib/swap/cross-swap-service.ts");
  assert.match(service, /const needs = \[\.\.\.\(user \? \[\] : \["sourceAddress"\]\), \.\.\.\(recipient \? \[\] : \["destinationAddress"\]\)\]/);
});

test("switching a network tab opens an asset that network actually has", () => {
  /* `network === "solana" ? SOL : "USDC"` — and Robinhood Chain has no USDC,
     so its tab seeded an asset that does not exist there and the card went to
     `UNKNOWN_ASSET`: no route, no balance, no share buttons. */
  assert.doesNotMatch(surface, /net === "solana" \? SOLANA_NATIVE_SOL_MINT : "USDC"/);
  assert.match(surface, /defaultSwapAssetFor\(network, to\)/);
  assert.match(surface, /defaultSwapAssetFor\(network, from\)/);
  assert.match(surface, /defaultSwapAssetFor\(net, null\)/, "a seeded link falls back the same way");
  const catalog = read("../../../../lib/swap/catalog.ts");
  assert.match(catalog, /export function defaultSwapAssetFor/);
  assert.match(catalog, /robinhood: "USDG"/);
  /* And every reason the classifier can give is worded, so no unavailable pair
     falls through to a sentence about a different one. */
  for (const reason of ["ASSET_NOT_ROUTABLE_ON_NETWORK", "UNKNOWN_ASSET", "EVM_SAME_NETWORK"]) {
    assert.ok(surface.includes(`"${reason}"`), reason);
  }
  assert.doesNotMatch(surface, /Swaps on Base and Ethereum are not offered yet/, "Robinhood Chain was told about Base and Ethereum");
});

test("the address bar can be read back for every network and asset the card can write", () => {
  /* The card writes `?from=robinhood&fa=USDG` into the address bar and the page
     threw both away: its guards were written-out lists — `solana|base|ethereum`
     and `SOL|ETH|USDC` — that went stale the day Robinhood Chain and USDG
     arrived. Reloading, bookmarking or sharing a Robinhood Chain pair silently
     reopened Solana. The gate is now the table the card classifies with, so a
     pair can never again be writable in one direction and unreadable in the
     other. */
  /* Asserted on the guards themselves rather than on the words, because the
     comment explaining the defect necessarily quotes both lists. */
  assert.doesNotMatch(page, /const NETWORK_SHAPE\s*=/, "the network list is not written out a second time");
  assert.doesNotMatch(page, /const CODE_SHAPE\s*=/, "nor is the asset list");
  assert.match(page, /isSwapNetwork\(value\)/);
  assert.match(page, /resolveSwapAsset\(\{ network, asset \}\)/, "an asset is valid exactly when its own network has it");
  assert.match(page, /fromAsset: assetOk\(params\.from, params\.fa\)/, "the asset is checked against the network it was named with");
});

test("both legs say what the amount is worth, and say nothing when they do not know", () => {
  /* A person typing `5` saw `5`, and whether that was five dollars or five
     hundred was on no surface. */
  assert.match(surface, /"\/api\/swap\/price"/);
  assert.match(surface, /const sendUsd = usdText\(from, amountRaw, amountDecimals\)/);
  assert.match(surface, /const receiveUsd = usdText\(to, receiveAmount\?\.raw \?\? null, receiveAmount\?\.decimals \?\? null\)/);
  /* Rendered only when there is a figure. `$0.00` under a real amount would be
     a lie and an empty line holding space reads as one that failed to load. */
  assert.match(surface, /\{sendUsd \? \(/);
  assert.match(surface, /\{receiveUsd \? \(/);
  assert.match(surface, /if \(raw === null \|\| decimals === null \|\| unit === undefined\) return null/);
  assert.match(surface, /`≈ < \$\{formatUsdMoney\(0\.01, numbers\)\}`/, "a sum below a cent is a sum, not nothing — in the page's own number language (B18)");

  /* And it decides nothing. No button, no amount and no plan may read a price:
     what is signed is the quote's own minimum, from the rail that fills it. */
  assert.doesNotMatch(surface, /disabled=\{[^}]*unitUsd/, "no control is gated on a price");
  assert.doesNotMatch(surface, /offerable[^\n]*unitUsd/, "no amount is sized by a price");
  const priceRoute = read("../../../../app/api/swap/price/route.ts");
  assert.match(priceRoute, /decides nothing/i);
  const price = read("../../../../lib/swap/price.ts");
  assert.match(price, /PRICE_SCALE = 1_000_000_000_000n/, "six decimal places priced a million BONK eleven per cent high");
  assert.doesNotMatch(price, /coingecko:/, "no token is priced by a name on another chain");
});

test("a network and an asset are told apart by their own marks, never by a letter or the action colour", () => {
  /* Measured on ryntra.io 2026-09-10: four identical discs in the colour of the button a person is meant to press.
     Then letters: «B» for Base and BNB Chain, «A» for Arbitrum and the arrival-only network (the B13 review, item 12).
     Since B18 every network and coin wears its own mark, a file of this site (`../money/marks.tsx`, `public/marks/`),
     so a chain and a token are told apart by sight and the action colour is spent only on the action. */
  assert.match(surface, /<NetworkMark network=\{ref\.network\}/, "the network beside each amount");
  assert.match(surface, /<NetworkMark network=\{candidate\}/, "every row of the network menu");
  assert.match(surface, /<AssetMark symbol=\{codeFor\(ref\)\} mint=\{markMint\(ref\)\}/, "the coin beside each amount");
  assert.doesNotMatch(surface, /styles\.glyph|\.slice\(0, 1\)\}<\/span>/, "no first letter stands where a mark should");
  const marks = read("../money/marks.tsx");
  assert.match(marks, /\/marks\/networks\/\$\{network\}\.svg/, "a network's mark is a file of this site");
  assert.doesNotMatch(marks, /https?:\/\//, "never a picture waiting on a third host");

  /* One primary orange on the surface. The embedded Solana card filled its CTA
     with `--accent`, which is `--rt-action-blue-fg` — the colour of action
     *text* — so the same button was #FF8552 on a Solana pair and #E8490F two
     rows down on a cross-chain one. */
  const embedded = read("../trade/swap-card.module.css");
  const cta = embedded.slice(embedded.indexOf("\n.cta {"));
  assert.match(cta.slice(0, cta.indexOf("}")), /background: var\(--rt-action-blue,/);
});

test("an amount over the balance can be read, and the ink that fills is never the ink that writes", () => {
  /* `--rt-blocked-red-ink` is the dark ink meant to sit ON a solid red fill.
     Over the unfilled leg ground it measured 1.22:1 on production — the number
     a person had just typed, all but invisible at the moment they most needed
     to read it. The stylesheet already carried a comment about fixing exactly
     this once, for `.error`, one selector away. */
  const css = read("./bridge-surface.module.css");
  const over = css.slice(css.indexOf('.amountInput[data-state="over"]'));
  const rule = over.slice(0, over.indexOf("}"));
  assert.doesNotMatch(rule, /--rt-blocked-red-ink/, "fill ink never writes on an unfilled ground");
  assert.match(rule, /--rt-blocked-red-fg/);
  /* The `≈` on an estimate is a qualifier, not a digit inside the figure. */
  assert.match(surface, /styles\.approx/);
  assert.match(css, /\.approx \{/);
});

test("the asset links at the foot of a Solana swap say what they are", () => {
  /* Two bare tickers with no label, no underline and nothing marking them as
     links: `SOL   USDC`, reading as something left behind rather than somewhere
     to go. The label existed only on the `aria-label`, so the one audience that
     could tell what the row was for was the one that could not see it. */
  /* SOL-C13: each asset's row in the pair beside the converter carries its own visible «About» link (REDUNDANT, M4). */
  const pair = read("../trade/swap-pair.tsx");
  assert.match(pair, /href=\{`\/app\/assets\?mint=\$\{side\.mint\}`\}[^>]*>\s*\{text\("About"\)\}/);
  const css = read("../trade/swap-pair.module.css");
  assert.match(css, /\.details \{[^}]*text-decoration: underline/);
});

test("a Solana page never speaks to an Ethereum wallet at all (SOL-W1)", () => {
  /* Phantom answers \`window.ethereum\` on a Solana account with its own «Unsupported account» modal
     (found on production 2026-09-10). Since SOL-W1 nothing here asks it anything. */
  for (const source of [surface, engine]) assert.doesNotMatch(source, /window\.ethereum|eth_accounts|eth_requestAccounts|EvmWallet/);
});
test("a provider refusal carries the provider's own words", () => {
  /* Jupiter states its reason in the 400 body, in plain words, and this threw it
     away and printed the status number. The sibling branch — a 200 with no
     transaction — has carried the venue's sentence since it was written
     ("Insufficient funds"), which is the whole reason that path is diagnosable
     and this one was not: a wallet could not swap at all, the screen said the
     provider refused the request, the log said HTTP 400, and the sentence
     Jupiter had written was in a body nobody kept. */
  const quotes = read("../../../../lib/solana/quotes.ts");
  assert.ok(
    quotes.includes("`Jupiter refused the order with HTTP ${response.status}: ${stated}`"),
    "a refusal must repeat what the provider said, not only its status number",
  );
  /* Bounded, so a provider cannot write a paragraph onto this surface. */
  assert.ok(quotes.includes("rawBody.error.length <= 300"));
  /* The fee-drop retry still reads the body first: a refusal that names the fee
     costs the fee, never the swap. */
  assert.ok(quotes.includes("refusedForTheFee(response.status, body)"));
});
