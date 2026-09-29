import assert from "node:assert/strict";
import test from "node:test";
import { bridgeContextKey, bridgeQuoteMatches, bridgeReviewCurrent, bridgeSubmitNeedsRecovery, bridgeTokenKey } from "./bridge-client-state.ts";

const context = { from: { network: "base", asset: "USDC" }, to: { network: "solana", asset: "SOL" }, amountRaw: "5000000", source: "0xabc", destination: "sol-wallet" };
const quote = { from: { ...context.from, amountRaw: context.amountRaw }, to: context.to };
test("quote and Review bind all current choices, including both wallets and an empty amount", () => {
  const key = bridgeContextKey(context);
  assert.equal(bridgeQuoteMatches(quote, context), true);
  for (const change of [{amountRaw:null}, {amountRaw:"1"}, {source:"other"}, {destination:"other"}, {from:{network:"ethereum",asset:"USDC"}}, {to:{network:"solana",asset:"BONK"}}]) {
    assert.notEqual(bridgeContextKey({...context,...change}), key);
    assert.equal(bridgeReviewCurrent({key,expiresAt:"2026-09-12T12:01:00Z"}, bridgeContextKey({...context,...change}), Date.parse("2026-09-12T12:00:00Z")), false);
  }
  assert.equal(bridgeQuoteMatches(quote,{...context,amountRaw:null}), false);
  assert.equal(bridgeQuoteMatches({...quote,to:{...quote.to,asset:"BONK"}},context), false);
});
test("Review expiry uses wall time and rejects missing or unreadable expiry", () => {
  const key=bridgeContextKey(context), now=Date.parse("2026-09-12T12:00:00Z");
  assert.equal(bridgeReviewCurrent({key,expiresAt:"2026-09-12T12:00:30Z"},key,now),true);
  for(const expiresAt of ["broken","2026-09-12T12:00:00Z","2026-09-12T12:00:05Z"]) assert.equal(bridgeReviewCurrent({key,expiresAt},key,now),false);
});
test("a lost or ambiguous submit response cannot become permission to send another", () => {
  for(const failure of [{code:"NETWORK"},{code:"HTTP_ERROR"},{code:"SUBMIT_UNKNOWN",extra:{submitBoundary:"CROSSED"}},{code:"CROSS_SWAP_ALREADY_STARTED",extra:{submitBoundary:"NOT_CROSSED",state:"SUBMITTED_UNKNOWN"}}]) assert.equal(bridgeSubmitNeedsRecovery(failure),true);
  assert.equal(bridgeSubmitNeedsRecovery({code:"SIMULATION_FAILED",extra:{submitBoundary:"NOT_CROSSED"}}),false);
});
test("token identity includes its chain, while EVM address casing does not change it", () => {
  assert.notEqual(bridgeTokenKey("base","0xABC"),bridgeTokenKey("ethereum","0xABC"));
  assert.equal(bridgeTokenKey("base","0xABC"),bridgeTokenKey("base","0xabc"));
  assert.notEqual(bridgeTokenKey("solana","AbC"),bridgeTokenKey("solana","abc"));
});
