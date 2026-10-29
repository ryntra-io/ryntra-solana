// Run from repo root: node --test app/solana/workspace/spot/fast-trade.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* SOL-R2 «Швидка торгівля мемами»: what the one tap, the exit plan and the ticket around them must keep, read off the
   source — the arithmetic itself is `lib/spot/meme-exits.test.mjs`'s. */

const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ticket = read("app/solana/workspace/spot/spot-ticket.tsx");
const panel = read("app/solana/workspace/spot/exit-plan.tsx");
const flow = read("app/solana/workspace/spot/use-spot-ticket.ts");

test("a tap opens the exact Review and never signs: the same path as a Pulse card's quick sum", () => {
  for (const handler of ["onQuickBuy", "onQuickSell", "onExitSale"]) {
    const body = ticket.slice(ticket.indexOf(`const ${handler} = `), ticket.indexOf("};", ticket.indexOf(`const ${handler} = `)));
    assert.ok(body.length > 0, `${handler} is written`);
    assert.doesNotMatch(body, /\.sign\(|signTransaction|openReview\(/, `${handler} only sets the order; the Review opens when the ticket can judge it`);
    assert.match(body, /if \(tapBusy(?: \|\| !connection)?\) return;/, `${handler} waits while an order is on its Review or its way`);
  }
  /* The Review opens only for exactly the tapped order, and only when the ticket judges it valid (the balance, the amount). */
  assert.match(ticket, /draft\.amount !== quickReview\.amount \|\| draft\.unit !== quickReview\.unit \|\| draft\.side !== quickReview\.side \|\| draft\.type !== "market"/);
  assert.match(ticket, /if \(pre\.fieldError \|\| blocked\) return;\s*openReview\(\);/);
  /* The amount the Review asks for is held from the press: a price that moves never changes it. */
  assert.match(ticket, /const openReview = useCallback\(\(\) => \{\s*setHeldAmount\(liveAmount\);/);
});

test("the one-tap row replaces the ticket's own buy chips, so a token page shows one set; never on SOL itself", () => {
  assert.match(ticket, /const quick = !underRule && !fastTrade && draft\.side === "buy"/);
  assert.match(ticket, /const fastTrade = !isStockMarket && baseMint !== null && baseMint !== WRAPPED_SOL_MINT && !bound && availability\.allowed;/);
  assert.match(ticket, /quietLegs=\{fastTrade\}/, "no grey «TP/SL not with the order» beside the exit plan");
});

test("a level's sale belongs to this tab while its Review is open, and every signature of exactly that sale is tied to it", () => {
  assert.match(ticket, /claimLeg\(plan, request\.legId, TAB_ID, Date\.now\(\)\)/);
  assert.match(ticket, /if \(!held \|\| held\.state !== "ready" \|\| held\.claim\?\.tab !== TAB_ID\)/);
  /* Tied by the raw units the wallet signed, the moment the signature is recorded — before the bytes are sent. */
  assert.match(ticket, /if \(!intent \|\| connection\?\.address !== intent\.owner \|\| signed\.inputMint !== baseMint \|\| signed\.inAmountRaw !== intent\.raw \|\| exitSettled\.current\.has\(signed\.signature\)\) return;/);
  assert.match(ticket, /markLegSent\(plan, intent\.legId, \{ signature: signed\.signature, requestId: signed\.requestId, sentRaw: BigInt\(intent\.raw\), tab: TAB_ID, now: Date\.now\(\) \}\)/);
  assert.doesNotMatch(ticket, /attemptSignature/, "a level is never tied after the fact from the attempt record");
  const signedAt = flow.indexOf("onSigned?.({ signature, requestId: prepared.order.requestId, inputMint: prepared.order.inputMint, inAmountRaw: prepared.order.inAmountRaw });");
  assert.ok(signedAt > flow.indexOf("rememberAttempt(pending);") && signedAt < flow.indexOf('post<SpotSettlement>("/api/solana/swap/execute"'), "the level is sent before the execute request leaves");
  assert.match(flow, /try \{\s*onSigned\?\.\([^)]*\);\s*\} catch \{/, "a listener never stops a signed order from being sent");
  /* The intent outlives a Review asked again after a refusal; it goes only when the order is no longer the level's. */
  assert.match(ticket, /if \(draft\.side !== "sell" \|\| draft\.type !== "market" \|\| draft\.amount !== exitIntent\.amount \|\| connection\?\.address !== exitIntent\.owner\) setExitIntent\(null\);/);
});

test("sign is pressed on a level's sale only after the level is read again from storage", () => {
  assert.match(ticket, /\? signReviewed\s*: undefined/);
  const body = ticket.slice(ticket.indexOf("const signReviewed = () => {"), ticket.indexOf("void ticket.sign();", ticket.indexOf("const signReviewed = () => {")));
  assert.match(body, /claimLeg\(plan, intent\.legId, TAB_ID, Date\.now\(\)\)/);
  assert.match(body, /readPlansNow\(\)/);
  assert.match(body, /leg\.claim\?\.tab !== TAB_ID/);
  assert.match(body, /void ticket\.cancelReview\(\);\s*return;/);
  /* A Review that is not exactly the level's raw units is refused, never signed untied. */
  assert.match(ticket, /const exitMatches = exitIntent !== null && side === "SELL" && prepared !== null && prepared\.order\.inputMint === baseMint && prepared\.order\.inAmountRaw === exitIntent\.raw;/);
  assert.match(body, /if \(exitIntent\) \{\s*\/\*[^*]*\*\/\s*if \(!exitMatches\) \{\s*setExitRefusal\(/);
});

test("a level reached earlier is said by the price now: the Review never calls a sale below its take profit «take profit»", () => {
  assert.match(ticket, /levelPastNow\(exitPlan\.open, exitLeg, exitPlan\.entry\?\.price \?\? null, exitPlan\.entry\?\.at \?\? null, now\) === false/);
  assert.match(ticket, /value: exitBack \? \(exitLeg\?\.kind === "tp" \? text\("Price is back below this level now\."\) : text\("Price is back above this level now\."\)\) : exitIntent\.label/);
  assert.match(panel, /word\.priceNow\(usd\(entry\.price\)\)/);
  assert.match(panel, /levelPastNow\(open, leg, entry\?\.price \?\? null, entry\?\.at \?\? null, now\) === false/);
  /* The page watches only while it is open — said in the plan's Review and beside an open plan. */
  assert.equal(panel.match(/\{word\.pageOnly\}/g)?.length, 2);
  assert.match(panel, /entry: "Price when set",/);
  assert.match(panel, /entry: "Ціна на момент плану",/);
});

test("only a settled answer moves a level: filled — sold; rejected or never landed — not sold; anything else stays sent", () => {
  assert.match(ticket, /outcome\.kind === "FILLED"\s*\? \{ kind: "sold", soldRaw:/);
  assert.match(ticket, /outcome\.kind === "NOT_FILLED" \|\| outcome\.kind === "NOTHING_HAPPENED"\s*\? \{ kind: "notSold" \}\s*: null;/);
  assert.match(ticket, /if \(!answer\) return;/);
  /* Bytes the server says never crossed the submit boundary were not sent: only a new refusal after this tab's signature makes its level ready again. */
  assert.match(ticket, /failure === linked\.failure \|\| failure\.submitBoundary !== "NOT_CROSSED"/);
  assert.match(ticket, /unsendLeg\(plan, linked\.signature\)/);
  /* A sent level is read by its signature through the ticket's own recovery route — nothing signed or sent again. */
  assert.match(panel, /fetch\("\/api\/solana\/swap\/recover"/);
  assert.match(panel, /classifySpotFill\(/);
});

test("a signed order whose execute answer is lost never reads «nothing was sent»", () => {
  const branch = flow.slice(flow.indexOf('const unknown = transitionSwapClientAttempt(pending, { kind: "FAILURE" });'), flow.indexOf('setPhase("RECOVERY");', flow.indexOf('const unknown = transitionSwapClientAttempt(pending, { kind: "FAILURE" });')));
  assert.ok(branch.length > 0);
  assert.match(branch, /setActionFailure\(null\);/);
  assert.doesNotMatch(branch, /setActionFailure\(executed\.failure\)/);
  assert.match(branch, /state: "SUBMITTED_UNKNOWN"/);
});

test("the panel draws the core's buttons; the plan is an intent with its Review and receipt, never a signature", () => {
  assert.match(panel, /import \{ Button \} from "@ryntra\/core\/ui";/);
  assert.doesNotMatch(panel, /<button\b/, "every action is the core's Button; the chips are the quick-buy row's own");
  assert.doesNotMatch(panel, /signTransaction|wallet\.client|\/api\/solana\/swap\/(?:order|execute|quote)/, "the panel neither signs nor orders");
  assert.match(panel, /data-exit-plan-review/);
  assert.match(panel, /data-exit-receipt/);
  /* An intent's receipt says what it is: never «paid», never a transaction. */
  const receipt = panel.slice(panel.indexOf("function PlanReceipt"));
  assert.doesNotMatch(receipt, /<Receipt\b|paid=|transaction=/);
});
