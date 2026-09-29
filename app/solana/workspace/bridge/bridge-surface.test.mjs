import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Source pins for the unified Swap surface (`RYN-SOL-MONEY-FLOWS-001F`).
 *
 * What these assert is the product law of the owner task, in the place it can
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
  /* Owner decision 2026-09-10. The two properties that make the split real are
     both here: the page mounts the Jupiter card directly rather than a surface
     that could classify its way into a bridge, and a link naming a network that
     is not Solana is **redirected** to Bridge rather than reinterpreted —
     reinterpreting a link is how a Robinhood Chain pair silently reopened
     Solana once already. */
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
  /* The lane has carried two providers since `RYN-SOL-MONEY-FLOWS-001H`, so
     "the engine never names one" stopped being the way to state this rule and
     started being a rule against a comment. What must stay true is stronger and
     is what this asserts: the engine never *chooses*. It has no provider
     branch, no fallback, no second attempt against another rail — it renders
     the label the plan gives it and posts to the same four routes whichever
     provider answered. A provider named in prose is fine; a provider named in
     a condition is the defect. */
  assert.doesNotMatch(engine, /(if|\?|&&|\|\|)[^\n]*\b(provider|engine)\s*===\s*"(MAYAN|RELAY)"/, "the engine never branches on which provider carried the order");
  assert.doesNotMatch(engine, /\b(deBridge|LI\.FI|Across|Chainflip)\b/, "no provider outside the two the Owner approved is named at all");
  assert.doesNotMatch(engine, /fallback|retryWith|otherProvider/i, "no fallback to a second rail exists");
  assert.match(engine, /plan\.quote\.routeLabel/, "the provider a person reads is the plan's own label, never one the engine picked");
  assert.match(engine, /bridgeSubmitNeedsRecovery\(result.failure\)/, "unknown and crossed responses go to recovery; its behavior is covered by bridge-client-state tests");
  assert.doesNotMatch(engine, /intentDigest\}\s*<\//, "the intent digest is never printed");
  assert.doesNotMatch(engine, /providerStatus\}/, "the provider's raw status word is never printed");
  /* The Review states the exact figures the owner task lists. */
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

test("the destination address can be read from the person's own wallet, and a refusal says so", () => {
  assert.match(engine, /text\("Use my Base wallet"\)/);
  assert.match(engine, /askEvmWallet/);
  assert.match(engine, /case "NO_WALLET":/, "a browser with no wallet is told to paste instead of watching a dead button");
  assert.match(surface, /return wallet\.code === "NO_WALLET"/);
});

test("an approval is waited out on chain, not handed back to the person to guess", () => {
  /* The founder's Base -> Solana canary of 2026-09-07: approve at 21:32:51,
     swap at 21:36:39, and everything between was a person wondering whether the
     allowance existed yet. A second early press would have asked them to
     approve twice. */
  const wallet = read("../../../../lib/base/wallet.client.ts");
  assert.match(wallet, /export async function waitForEvmReceipt/);
  assert.match(wallet, /eth_getTransactionReceipt/);
  assert.doesNotMatch(wallet, /eth_sendRawTransaction/, "the waiter reads; it never sends");
  assert.match(engine, /const landed = await waitForEvmReceipt\(sent\.transactionHash\)/);
  assert.match(engine, /await review\(\);/, "a landed approval reprices the swap without a second press");
  assert.ok(engine.includes('case "APPROVAL_SLOW":'), "a slow approval is named as slow, never as a failure");
  assert.ok(engine.includes('"TIMEOUT" ? "APPROVAL_SLOW"'), "a timeout is a timeout, not APPROVAL_FAILED");
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
  /* The founder's first cross-chain swap read "Sent 3.347272 USDC" on the Solana
     home feed, "3.347272 USDC" on the app Home feed, "Sending" while it was in
     flight, and showed only its outgoing leg on the receipt line. Four surfaces became three when Home folded into Portfolio,
     one omission each: the lane was added to the ledger and to Activity and
     nowhere else. A swap must never be worded as a send. */
  for (const [file, path] of [
    ["home-surface", "../home-surface.tsx"],
    ["holdings-card", "../holdings/holdings-card.tsx"],
    ["local-receipts", "../receipts/local-receipts.tsx"],
    ["history-card", "../history/history-card.tsx"],
  ]) {
    assert.ok(read(path).includes('CROSS_SWAP'), file);
  }
  /* And the lane union itself is imported, never retyped. */
  const surface = read("../home-surface.tsx");
  assert.match(surface, /lane: SolanaActionLane;/);
  assert.doesNotMatch(surface, /lane: "SEND" \| "SWAP"/, "a hand-copied lane union is how this happened");
});

test("a balance is read for the network and the asset actually chosen, not for a CCTP direction", () => {
  /* Found on production 2026-09-10 with USDG on Robinhood Chain: no
     `Available` line and no 25/50/75/MAX. The EVM balance came from the
     bridge's CCTP route, which takes a *direction* rather than a network, so
     `robinhood` fell through a ternary and asked **Ethereum** — a chain the
     person does not hold this money on — and the route reads only USDC and the
     native coin, so USDG could not have been read on any chain. */
  assert.doesNotMatch(surface, /BASE_TO_SOLANA|ETHEREUM_TO_SOLANA/, "no CCTP direction is inferred from a swap network");
  assert.match(surface, /"\/api\/swap\/balance"/, "the balance route asks by network, wallet and asset");
  assert.match(surface, /network,\s*owner: evmAddress,\s*asset,/);
  /* The reading has to be about this asset, or a figure read for one asset
     survives a change to another. */
  assert.match(surface, /evmBalance\.asset !== from\.asset/);
  assert.match(surface, /evmBalance\.owner !== evmAddress/);
  /* Decimals are never guessed: an unreadable scale shows no balance rather
     than one that is a million times wrong under a MAX button. */
  assert.match(surface, /fromAsset\.decimals \?\? evmBalance\.decimals/);
  const route = read("../../../../app/api/swap/balance/route.ts");
  assert.match(route, /readBaseErc20Balance/);
  assert.match(route, /readBaseErc20Decimals/, "a token outside the catalogue is asked for its own scale");
  assert.match(route, /NOT_AN_EVM_NETWORK/, "Solana holdings keep their one reader");
});

test("every leg says which wallet it is attached to, and the EVM one can be connected there", () => {
  /* A Solana wallet has shown as a chip in the shell header since it shipped.
     An Ethereum-style one showed nowhere at all — on pairs whose sending side
     *is* the EVM one, which is every Robinhood Chain pair. */
  assert.match(surface, /const walletChip = /);
  assert.match(surface, /\{walletChip\("from"\)\}/);
  assert.match(surface, /from\.network !== to\.network \? walletChip\("to"\) : null/, "a same-wallet pair does not print the address twice");
  assert.match(surface, /styles\.walletConnect/);
  assert.match(surface, /styles\.walletAddress/);
  /* A reload must not lose a connection the wallet still holds, and an account
     switched in the wallet must not leave the old balance on screen. */
  const wallet = read("../../../../lib/base/wallet.client.ts");
  assert.match(wallet, /export async function readEvmWalletAddress/);
  assert.match(wallet, /eth_accounts/, "the silent read never opens a prompt");
  assert.match(wallet, /export function watchEvmWalletAddress/);
  assert.match(surface, /readEvmWalletAddress\(\)/);
  assert.match(surface, /watchEvmWalletAddress\(/);
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
  /* Owner instruction 2026-09-10: a person typing `5` saw `5`, and whether that
     was five dollars or five hundred was on no surface. */
  assert.match(surface, /"\/api\/swap\/price"/);
  assert.match(surface, /const sendUsd = usdText\(from, amountRaw, amountDecimals\)/);
  assert.match(surface, /const receiveUsd = usdText\(to, receiveAmount\?\.raw \?\? null, receiveAmount\?\.decimals \?\? null\)/);
  /* Rendered only when there is a figure. `$0.00` under a real amount would be
     a lie and an empty line holding space reads as one that failed to load. */
  assert.match(surface, /\{sendUsd \? \(/);
  assert.match(surface, /\{receiveUsd \? \(/);
  assert.match(surface, /if \(raw === null \|\| decimals === null \|\| unit === undefined\) return null/);
  assert.match(surface, /"≈ < \$0\.01"/, "a sum below a cent is a sum, not nothing");

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

test("a network and an asset are told apart without spending the action colour", () => {
  /* Measured on ryntra.io 2026-09-10: Solana, Robinhood Chain, USDG and SOL all
     rendered rgba(255,90,31,.14) behind #FF8552 — four identical discs in the
     colour of the button a person is meant to press, and nothing telling a
     chain from a token. This palette has no four network colours to give: the
     Brandbook froze the ramp and the only non-semantic accents are iris
     (action) and aurora. So the two are told apart by shape. */
  const css = read("./bridge-surface.module.css");
  assert.match(surface, /styles\.glyphNetwork/);
  assert.match(surface, /styles\.glyphAsset/);
  const network = css.slice(css.indexOf(".glyphNetwork {"));
  const networkRule = network.slice(0, network.indexOf("}"));
  const asset = css.slice(css.indexOf(".glyphAsset {"));
  const assetRule = asset.slice(0, asset.indexOf("}"));
  assert.doesNotMatch(networkRule, /action-blue|authorization-violet/, "the chain mark is not the action colour");
  assert.doesNotMatch(assetRule, /action-blue|authorization-violet/, "nor is the asset mark");
  assert.match(networkRule, /border-radius: var\(--rt-radius-xs/, "a chain is a square");
  assert.match(assetRule, /border-radius: 50%/, "an asset is a circle");
  /* The shape has to survive both grounds: a 12% wash alone vanishes on light. */
  assert.match(assetRule, /border: 1px solid/);

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
  const context = read("../trade/swap-context.tsx");
  assert.match(context, /<nav aria-label=\{uk\?"Відомості про активи":"Asset details"\}><span>/);
  const product = read("../../../../app/app/product.css");
  assert.match(product, /\.ry-swap-details nav > span/);
  assert.match(product, /\.ry-swap-details a \{[^}]*text-decoration: underline/);
});

test("a Solana-only pair never speaks to an Ethereum wallet", () => {
  /* Found on production 2026-09-10, by the founder, mid-swap. `eth_accounts` is
     the silent half of `eth_requestAccounts` in a wallet that speaks only
     Ethereum — and Phantom is not that wallet. It injects `window.ethereum`
     beside its Solana provider, and with a Solana account active it answers
     that call with a modal of its own: "Unsupported account — This website is
     trying to use Ethereum, which this Solana account doesn't support."
     It fired on a Solana-to-Solana swap, on a card with no Ethereum anything on
     it, because the restore effect ran on mount with no deps. */
  assert.match(surface, /const pairTouchesEvm = from\.network !== "solana" \|\| to\.network !== "solana"/);
  assert.match(surface, /if \(!pairTouchesEvm\) return;/);
  assert.match(surface, /if \(!readEvmWalletHint\(\)\) return;[\s\S]*?await readEvmWalletAddress/, "silent reads still require a prior connection");
  assert.match(surface, /\}, \[pairTouchesEvm, hasEvmAddress\]\);/, "the account listener also attaches after the first connection");
  assert.doesNotMatch(surface, /readEvmWalletAddress\(\);\s*\n\s*if \(live && address\) setEvmAddress\(address\);\s*\n\s*\}\)\(\);\s*\n[\s\S]{0,200}\}, \[\]\);/, "no unconditional mount read remains");

  /* And the hint is written where a wallet actually answered, cleared where the
     person let it go — so a browser that has never connected one is never asked. */
  const wallet = read("../../../../lib/base/wallet.client.ts");
  assert.match(wallet, /export function readEvmWalletHint/);
  assert.match(wallet, /export function writeEvmWalletHint/);
  assert.match(wallet, /writeEvmWalletHint\(true\);/);
  assert.match(surface, /writeEvmWalletHint\(false\);/);
  assert.match(wallet, /Phantom is not that wallet/, "the reason is written down where the next caller will read it");
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
