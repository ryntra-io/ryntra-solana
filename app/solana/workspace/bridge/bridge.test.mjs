import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { solanaNavigation } from "../hub/manifest.ts";

const read = (path) => readFileSync(path, "utf8");

const CARD = "app/solana/workspace/bridge/bridge-card.tsx";
/* The page that mounts the cross-chain engine. It was Swap until the Owner
   split the two on 2026-09-10; it is Bridge now, and the guards below are about
   the mounting page rather than about a name. */
const SWAP_PAGE = "app/solana/workspace/bridge/page.tsx";
const COPY = "app/solana/workspace/bridge/bridge-copy.ts";

test("the transfer keeps its record even though it no longer has a surface", () => {
  /* It used to be a railed module with a page. The owner's instruction of
     2026-09-08 replaced the page with the cross-chain swap, and the record
     stayed: deleting it would erase the owner canary of 2026-09-02 that proved
     the lane, which is a fact about what this product has done rather than a
     fact about where a menu points. So the module is map-only — recorded, not
     rendered — and nothing in the rail offers a door to a page that is gone. */
  const modules = read("app/solana/workspace/hub/modules.ts");
  assert.match(modules, /id: "bridge"/);
  assert.match(modules, /mapped\(\{\s*id: "bridge"/);
  assert.doesNotMatch(modules, /railed\(\{\s*id: "bridge"/);
  assert.doesNotMatch(modules, /route: `\$\{BASE\}\/bridge`/);
  assert.match(modules, /lastVerifiedAt: "2026-09-02"/);

  const rail = solanaNavigation("en").flatMap((group) => group.entries);
  assert.equal(rail.find((row) => row.id === "bridge"), undefined, "the retired transfer page is back in the rail.");

  /* And `/app/bridge` is a page again rather than a redirect into Swap. */
  assert.ok(!read("lib/product/customer-routing.ts").includes('["/app/bridge", "/app/swap"]'));
});

test("the CCTP card is rollback code: compiled, and mounted by nothing", () => {
  const card = read(CARD);
  /* Owner instruction of 2026-09-08: the cross-chain swap replaces the bridge.
     The lane is untouched — the same CCTP engine, the same review, the same
     recovery — but it is mounted by the one Swap surface that classifies a pair
     into it, and `/app/bridge` is a redirect rather than a screen.

     The rule the old assertion protected survives in a stronger form: one card,
     one primary action, no second inert column, and the evidence panel that
     says where the money is can no longer be hidden by being embedded. */
  assert.match(card, /<Panel[\s\S]{0,120}id="bridge-transfer"[\s\S]{0,200}w=\{4\}/, "The transfer ticket is not the domain's four-column card.");
  assert.match(card, /\{embedded \? null : <MoneyContext span=\{transferRows\} \/>\}/, "The Money domain must not be mounted a second time inside Swap.");
  /* Bridge has no asset picker and makes no balance read of its own, so the
     panel makes the one this page needs. Send and Receive hand theirs over. */
  assert.equal((card.match(/api\/solana\/holdings/g) ?? []).length, 0,
    "The transfer engine grew a balance read of its own beside the panel's.");
  assert.match(card, /className=\{styles\.cta\}/, "The single full-width action is gone.");
  assert.match(card, /\{plan \|\| burnSignature \? <Panel/, "Where the money is must render inside Swap, not only on a page that no longer exists.");
  /* `./page.tsx` exists again, and it is **Bridge's** — the Relay cross-chain
     surface, not this CCTP card. The property worth pinning is no longer "this
     has no page" but "nothing mounts this": CCTP left default routing on
     2026-09-10 with its code kept for rollback, and rollback means compiled and
     tested, not reachable. */
  assert.ok(existsSync(new URL("./page.tsx", import.meta.url)), "Bridge is a page again");
  const bridgePage = read("app/solana/workspace/bridge/page.tsx");
  assert.doesNotMatch(bridgePage, /<BridgeCard\b/, "the CCTP card must not be mounted by the Bridge page");
  const surface = read("app/solana/workspace/bridge/bridge-surface.tsx");
  assert.doesNotMatch(surface, /<BridgeCard\b/, "the CCTP card must not be mounted by the Bridge surface");
  const swapPage = read("app/solana/workspace/swap/page.tsx");
  assert.doesNotMatch(swapPage, /<BridgeCard\b/, "the CCTP card must not be mounted by Swap either");
});

test("Simple shows the journey and one next action; Pro holds the evidence", () => {
  const card = read(CARD);
  assert.match(card, /id="bridge-transfer"[\s\S]{0,400}essential/, "The transfer card is not essential.");
  assert.match(card, /id="bridge-evidence"[\s\S]{0,400}advanced/, "Evidence is not held behind Pro.");
  /* One progress line, five steps, and the current one marked. A person's
     question during a cross-chain transfer is where it is, not what the
     protocol calls that. */
  assert.match(card, /className=\{styles\.progress\}/);
  /* Both lanes, because the line is now chosen by direction. A card that only
     named one of them would be telling half its readers the money is leaving a
     chain it is arriving on. */
  for (const step of [
    "Review",
    "Leaves Solana",
    "Leaves Base",
    "Circle signs",
    "Arrives on Base",
    "Arrives on Solana",
    "Checked both sides",
  ]) {
    assert.ok(card.includes(`text("${step}")`), `The progress line does not name ${step}.`);
  }
});

test("the direction is a control the person can see, and it clears what belonged to the old lane", () => {
  const card = read(CARD);
  assert.match(card, /className=\{styles\.swap\}/, "There is no control for turning the transfer round.");
  const swap = card.slice(card.indexOf("const swapDirection"), card.indexOf("const prepare ="));
  assert.ok(swap.length > 0, "The direction control's handler is missing.");
  /* An address for the chain you just turned away from is the one mistake this
     control could cause, and a stale plan is the other. */
  assert.match(swap, /setRecipient\(""\)/, "Turning the transfer round keeps the old chain's address.");
  assert.match(swap, /setPlan\(null\)/, "Turning the transfer round keeps a Review built for the other lane.");
});

test("the second wallet prompt is explained before it can appear", () => {
  const card = read(CARD);
  const explanation = card.match(
    /Signing opens your wallet once\. A second signature happens here in this tab[^"]*/,
  );
  assert.ok(explanation, "The card never explains why a second signature exists.");
  assert.match(explanation[0], /can never move money/, "The explanation does not say what the second key cannot do.");

  /* It has to sit inside the Review the person reads, not somewhere the flow
     reaches afterwards. The wallet is opened by the action on that same
     Review, so anything below it would be an explanation nobody saw in time. */
  const reviewSection = card.slice(card.indexOf("styles.exactReview"), card.indexOf("</section>"));
  assert.ok(
    reviewSection.includes("Signing opens your wallet once"),
    "The second-signature explanation is not inside the Review the person confirms.",
  );
  assert.ok(
    reviewSection.includes("Receiving on Base is a second, separate step you take yourself"),
    "The Review does not say that receiving on Base is a separate step.",
  );
  assert.ok(
    reviewSection.includes("Receiving on Solana is a second, separate step you take yourself"),
    "The Review does not say that receiving on Solana is a separate step.",
  );

  /* The reverse lane's second prompt is a token approval rather than a
     one-time key, and it has to be announced in the same place and with the
     same precision: how many prompts, and what the first one grants. */
  assert.ok(
    reviewSection.includes("This will open your wallet twice"),
    "The Review never says the reverse lane can take two wallet prompts.",
  );
  assert.ok(
    reviewSection.includes("never for your whole balance"),
    "The Review does not say the approval is bounded to this amount.",
  );
  assert.ok(reviewSection.includes('text("Wallet approvals")'), "The Review does not print the number of prompts.");
});

test("permissionless is stated and never promised", () => {
  const card = read(CARD);
  assert.match(card, /Anyone holding this transfer's message can complete it/);
  /* `destinationCaller` being zero makes the last step permissionless. That is
     not a promise that funds cannot be stuck, and no surface may say it is. */
  assert.doesNotMatch(card, /cannot (?:be )?(?:get )?stuck/i);
  assert.doesNotMatch(card, /guaranteed|guarantee/i);
  assert.doesNotMatch(card, /instant/i, "Fast is never described as instant, and Standard is not fast.");
});

test("the card speaks to the person, not to the engine", () => {
  const card = read(CARD);
  const copy = read(COPY);
  /* The ban is on what a person reads, not on what a helper is called:
     `lamportsToSol` converts the unit away precisely so the word never
     reaches the screen. */
  const pattern = new RegExp('text\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)', "g");
  for (const source of [card, copy]) {
    for (const match of source.matchAll(pattern)) {
      assert.doesNotMatch(match[1], /\blamports\b/i, "A person is never shown lamports.");
      assert.doesNotMatch(match[1], /\b[A-Z]{2,}_[A-Z_]{2,}\b/, `A machine name reached the copy: ${match[1]}`);
    }
    assert.doesNotMatch(source, /RYN-SOL-/, "An internal task id has no place on a customer surface.");
    assert.doesNotMatch(source, /replace(?:All)?\(\/_\/g|replaceAll\("_"/, "Machine enum names must not be prettified into copy.");
  }
  /* Every machine code the routes emit is translated into a sentence rather
     than printed. A screen showing a refusal code has told the reader only
     that they are not the audience. */
  assert.match(copy, /bridgePlanFailureCopy/);
  assert.match(copy, /bridgeBurnFailureCopy/);
  assert.match(copy, /bridgeRecoveryCopy/);
  /* `${x.code}` builds a lookup key for the copy table and never reaches the
     screen; `{x.code}` in JSX is the code itself, rendered. Only the second
     is banned. */
  assert.doesNotMatch(card, /(?<!\$)\{[a-zA-Z.]*\.code\}/, "A raw failure code is rendered.");
  assert.doesNotMatch(card, /(?<!\$)\{[a-zA-Z.]*\.(?:state|verdict|decision)\}/, "A raw machine state is rendered.");
});

test("nothing in the card can burn twice or send without the routes", () => {
  const card = read(CARD);
  /* Every place value can move, counted. The lane now has four of them and
     each is a different action, so the rule is one call site per action rather
     than one in total: a Solana burn, a Base burn, the approval that precedes
     a Base burn, and the destination step on whichever chain it lands on. A
     second of any one of them is how a retry becomes a second transfer. */
  assert.equal((card.match(/\/api\/solana\/bridge\/burn/g) ?? []).length, 1, "Solana burn");
  assert.equal((card.match(/phase: "ARM"/g) ?? []).length, 1, "Base burn arming");
  assert.equal((card.match(/\/api\/solana\/bridge\/receive/g) ?? []).length, 1, "Solana destination submit");
  /* Three EVM sends: the approval, the burn, and the EVM-side destination
     step. Each lives in its own named callback and none is reachable twice.
     Since 2026-09-05 every one of them names the chain it sends on — Base or
     Ethereum, from the lane — rather than assuming Base. */
  assert.equal((card.match(/sendEvmTransaction\(/g) ?? []).length, 3, "EVM wallet sends");
  assert.equal((card.match(/sendBaseTransaction\(/g) ?? []).length, 0, "A send still assumes Base.");
  assert.equal((card.match(/chain: EVM_WALLET_CHAINS\[network\]/g) ?? []).length, 3, "An EVM send does not name its chain.");
  for (const owner of ["const approve = useCallback", "const sendFromEvm = useCallback"]) {
    assert.ok(card.includes(owner), `A named owner for an EVM send is missing: ${owner}`);
  }
  /* The boundary is crossed before the wallet opens on the reverse lane, and
     the only way back is the server reading the chain. The card may ask for
     that and may never decide it. */
  assert.match(card, /phase: "ABANDON"/, "A declined Base wallet never asks for its claim to be looked at.");
  assert.doesNotMatch(card, /markCctpBurnNeverBroadcast/, "The card must not release its own boundary.");
  /* The rule is that no timer may reach the burn or the Base send. Counting
     timers was a proxy for it, and the proxy started failing an honest change:
     the Review now rebuilds itself on a timer so that what a person is reading
     stays signable, instead of the press silently rebuilding and never opening
     the wallet. A rebuild is a POST that produces unsigned bytes; it submits
     nothing. So this asserts the property rather than the count — every timer
     in the card is named, and every one of them is checked against both
     financial call sites. */
  const timerBlocks = {
    reviewRefresh: card.slice(card.indexOf('currentStage !== "REVIEW" || !plan'), card.indexOf("/** Seconds until the card")),
    attestation: card.slice(card.indexOf('currentStage !== "ATTESTING"'), card.indexOf("/** True when the reverse lane")),
    /* The wait for a token approval to appear on Base. It reads a balance and
       nothing else, and it is a separate function from the one that sends the
       approval precisely so this rule can be checked. */
    allowanceWait: card.slice(card.indexOf("const awaitAllowance"), card.indexOf("const approve = useCallback")),
  };
  assert.ok(timerBlocks.attestation.includes("checkAttestation"), "The attestation timer must drive the attestation read.");
  assert.ok(timerBlocks.reviewRefresh.includes("prepare()"), "The review timer must drive a rebuild and nothing else.");
  assert.ok(
    timerBlocks.allowanceWait.includes("/api/solana/bridge/balances"),
    "The allowance wait must read a balance and nothing else.",
  );
  for (const [name, block] of Object.entries(timerBlocks)) {
    assert.ok(block.length > 0, `${name} timer block not found — this test's slices have drifted from the card.`);
    assert.match(block, /set(?:Interval|Timeout)\(/, `${name} is supposed to be a timer.`);
    for (const financial of ["/api/solana/bridge/burn", "sendEvmTransaction(", "signTransaction("]) {
      assert.ok(!block.includes(financial), `The ${name} timer must never reach ${financial}.`);
    }
  }
  /* And no third timer appears without being named here. */
  assert.equal(
    [...card.matchAll(/set(?:Interval|Timeout)\(/g)].length,
    Object.keys(timerBlocks).length,
    "A timer exists that this test does not name and therefore does not check.",
  );
  /* The burn route is the only thing that submits. The card holds no key
     except the one-transaction message account, and discards it. */
  assert.match(card, /account\.discard\(\)/);
});

/**
 * The network chooser, 2026-09-05.
 *
 * The card draws the deployment's own route matrix and nothing else: Base
 * open, Ethereum gated until its first verified transfer, Robinhood Chain
 * named as having no USDC route. Three rules follow. A row the person cannot
 * choose is never a button — a dead control is the failure `MASTER-PLAN` §4
 * names by that phrase. Choosing a network clears what belonged to the old
 * one, exactly as turning the transfer round does. And nothing the card does
 * derives a lane from an address: the direction is looked up by network.
 */
test("the network chooser draws the route matrix and never a dead button", () => {
  const card = read(CARD);
  assert.match(card, /\/api\/solana\/bridge\/routes/, "The chooser does not read the deployment's route matrix.");
  assert.equal((card.match(/\/api\/solana\/bridge\/routes/g) ?? []).length, 1, "The matrix is read from more than one place.");
  const chooser = card.slice(card.indexOf("className={styles.networks}"), card.indexOf("className={styles.legs}"));
  assert.ok(chooser.length > 0, "The chooser is missing or sits below the legs it decides.");
  /* Only an available network is a button; every other row is a labelled span. */
  assert.match(chooser, /row\.state === "AVAILABLE"[\s\S]{0,200}<button/, "An available network is not a button.");
  assert.match(chooser, /<span className=\{styles\.networkOff\} aria-disabled="true"/, "A closed network is drawn as something other than a labelled, non-interactive row.");
  assert.match(chooser, /aria-pressed=\{row\.id === network\}/, "The chosen network is not announced as chosen.");
  assert.match(chooser, /bridgeNetworkReasonCopy\(row\.reason, text, row\.id\)/, "A closed network's reason never becomes a sentence.");
  assert.ok(chooser.includes('text("Not open yet")') && chooser.includes('text("No route")'), "The two closed states are not captioned.");
  /* The asset boundary is stated on the card itself, once. */
  assert.ok(chooser.includes("ETH and SOL would change asset on the way"), "The card does not say why ETH and SOL are not on it.");

  const choose = card.slice(card.indexOf("const chooseNetwork"), card.indexOf("const prepare ="));
  assert.ok(choose.length > 0, "Choosing a network has no handler.");
  assert.match(choose, /setRecipient\(""\)/, "Choosing a network keeps the old chain's address.");
  assert.match(choose, /setPlan\(null\)/, "Choosing a network keeps a Review built for the other lane.");
  assert.match(choose, /DIRECTIONS\[next\]/, "The lane is not looked up by network.");
  /* A closed network cannot open a wallet: the primary control says so. */
  assert.match(card, /if \(!chosenNetworkOpen\)[\s\S]{0,120}text\("Not open yet"\)/, "A closed network still offers to connect a wallet.");
  /* The direction module's rule, kept on the client: no lane from an address. */
  assert.doesNotMatch(card, /direction\s*=\s*[^;\n]*(?:test\(|startsWith\(|includes\(")/, "The card works out the direction from the shape of a string.");
});

test("the surface that mounts the engine builds nothing and holds no key", () => {
  const page = read(SWAP_PAGE);
  for (const forbidden of [/signTransaction\s*\(/, /depositForBurn\s*\(/, /receiveMessage\s*\(/, /randomPrivateKey/]) {
    assert.doesNotMatch(page, forbidden);
  }
  assert.match(page, /<BridgeSurface seed=\{seed\} \/>/);
  /* And the surface it mounts reaches one provider. Two rails on one page is
     the thing the split removed. */
  assert.doesNotMatch(page, /<SwapCard\b|<BridgeCard\b/);
});

test("every English string the Bridge surface renders has a Ukrainian projection", () => {
  const catalog = read("app/solana/workspace/i18n/catalog.ts");
  const pattern = new RegExp('text\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)', "g");
  const missing = [];
  for (const file of [CARD, COPY, SWAP_PAGE]) {
    for (const match of read(file).matchAll(pattern)) {
      const english = JSON.parse(`"${match[1]}"`);
      if (!catalog.includes(JSON.stringify(english))) missing.push(english);
    }
  }
  assert.deepEqual(missing, [], "Ukrainian Bridge copy is missing and the uk render would throw.");
});

test("a resumed transfer can never start a second burn", () => {
  const card = read(CARD);
  /* The restore path exists so a reopened tab can finish a transfer that is
     already in flight. The one thing it must never do is put the card back
     somewhere the burn button is reachable — that would turn a recovery into a
     second transfer, which is the failure the whole lane is built around. */
  const restore = card.slice(card.indexOf("readBridgeRun(window.localStorage)"), card.indexOf("While Circle is signing"));
  assert.ok(restore.length > 0, "The restore path is missing.");
  assert.ok(!/setStage\(\s*"REVIEW"/.test(restore), "A resumed transfer must never land back on Review.");
  assert.ok(!/setStage\(\s*"(?:COMPOSE|PREPARING|SIGNING|SENDING)"/.test(restore), "A resumed transfer must never land before the burn.");
  for (const stage of ["OBSERVING", "MINTING", "ATTESTING"]) {
    assert.ok(restore.includes(`"${stage}"`), `The restore path does not handle ${stage}.`);
  }
  /* What decides whether a transfer may be resumed is the server's claim, not
     anything the browser remembered. The reverse lane writes its run *before*
     the wallet opens — it has to, because an EVM wallet sends the moment it
     signs — so a declined prompt leaves a remembered run whose claim was since
     released, and restoring that would show a waiting screen for money still
     sitting in the person's own wallet. */
  assert.ok(restore.includes("found.data.claim.state"), "The resumed stage must come from the server's claim.");
  for (const settled of ["EXPIRED_BEFORE_BURN", "RESERVED", "BURN_REVERTED"]) {
    assert.ok(restore.includes(settled), `A claim in ${settled} must not be resumed as a transfer in flight.`);
  }
  assert.ok(
    restore.includes("clearBridgeRun(window.localStorage)"),
    "A remembered run whose transfer never left is never forgotten.",
  );
});

test("the remembered run holds nothing signable and is forgotten at the receipt", () => {
  const card = read(CARD);
  assert.match(card, /saveBridgeRun\(window\.localStorage/);
  assert.match(card, /clearBridgeRun\(window\.localStorage\)/);
  const saveBlock = card.slice(card.indexOf("saveBridgeRun(window.localStorage"), card.indexOf('setStage("ATTESTING")'));
  assert.ok(!saveBlock.includes("signedTransactionBase64"), "A signed transaction must never reach browser storage.");
  assert.ok(!saveBlock.includes("account"), "The one-transaction key must never reach browser storage.");
});
