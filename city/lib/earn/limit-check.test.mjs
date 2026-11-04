import { test } from "node:test";
import assert from "node:assert/strict";

import { checkLimitPool, checkMintFacts, checkStockRow, SAFE_EXTENSIONS } from "./limit-check.ts";

const MINT = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const row = (over = {}) => ({
  representation: { mint: MINT, issuerConfirmation: "issuer-catalogue", instrument: { class: "listed-equity", unitBasis: "share" }, tradingHalted: false, ...over.representation },
  market: { verified: true, ...over.market },
  lifecycle: { tradable: true, ...over.lifecycle },
});

const xstock = (over = {}) => ({
  programKind: "TOKEN_2022",
  extensions: ["MetadataPointer", "TokenMetadata", "ScaledUiAmountConfig", "PermanentDelegate", "PausableConfig"],
  transferFeeConfig: null,
  pausable: { paused: false },
  defaultAccountFrozen: null,
  ...over,
});

test("a stock is offered only as its issuer names it: a listed share, verified, not halted, still supported", () => {
  assert.deepEqual(checkStockRow(row(), MINT), { ok: true });
  assert.equal(checkStockRow(null, MINT).ok, false);
  assert.equal(checkStockRow(row(), SOL).ok, false, "the row must name this very mint");
  assert.equal(checkStockRow(row({ representation: { issuerConfirmation: "tag-only" } }), MINT).ok, false);
  assert.equal(checkStockRow(row({ representation: { instrument: { class: "pre-ipo", unitBasis: "token" } } }), MINT).ok, false, "a pre-IPO token is never offered");
  assert.equal(checkStockRow(row({ representation: { tradingHalted: true } }), MINT).ok, false);
  assert.equal(checkStockRow(row({ market: { verified: false } }), MINT).ok, false);
  assert.equal(checkStockRow(row({ lifecycle: { tradable: false } }), MINT).ok, false);
});

test("a mint passes only with extensions a limit order is safe with — an unknown one is refused, never assumed", () => {
  assert.deepEqual(checkMintFacts(xstock()), { ok: true });
  assert.deepEqual(checkMintFacts(xstock({ programKind: "SPL_TOKEN", extensions: [] })), { ok: true });
  assert.equal(checkMintFacts(null).ok, false);
  assert.match(checkMintFacts(xstock({ extensions: ["TransferHook"] })).reason, /TransferHook/);
  assert.match(checkMintFacts(xstock({ extensions: ["InterestBearingConfig"] })).reason, /InterestBearingConfig/);
  assert.match(checkMintFacts(xstock({ extensions: ["NonTransferable"] })).reason, /NonTransferable/);
  assert.match(checkMintFacts(xstock({ extensions: ["SomethingNew"] })).reason, /SomethingNew/);
  assert.equal(checkMintFacts(xstock({ extensions: ["TransferFeeConfig"], transferFeeConfig: { older: { basisPoints: 0 }, newer: { basisPoints: 0 } } })).ok, true, "a fee config at zero takes nothing");
  assert.equal(checkMintFacts(xstock({ extensions: ["TransferFeeConfig"], transferFeeConfig: { older: { basisPoints: 0 }, newer: { basisPoints: 300 } } })).ok, false);
  assert.equal(checkMintFacts(xstock({ pausable: { paused: true } })).ok, false);
  assert.equal(checkMintFacts(xstock({ defaultAccountFrozen: true })).ok, false);
  assert.equal(checkMintFacts(xstock({ programKind: "NOT_A_MINT" })).ok, false);
  assert.ok(SAFE_EXTENSIONS.has("ScaledUiAmountConfig"));
  assert.ok(!SAFE_EXTENSIONS.has("TransferHook"));
});

test("the pool: the program's, enabled, taking limit orders, and exactly the asset against the quote", () => {
  const pool = (over = {}) => ({ enabled: true, limitOrders: true, tokenX: { mint: MINT, program: TOKEN_2022 }, tokenY: { mint: USDC, program: TOKEN }, ...over });
  assert.deepEqual(checkLimitPool(pool(), MINT, USDC), { ok: true, assetIsX: true });
  assert.deepEqual(checkLimitPool(pool({ tokenX: { mint: USDC, program: TOKEN }, tokenY: { mint: MINT, program: TOKEN_2022 } }), MINT, USDC), { ok: true, assetIsX: false });
  assert.equal(checkLimitPool(pool({ limitOrders: false }), MINT, USDC).ok, false, "a pool running farm rewards takes no limit orders");
  assert.equal(checkLimitPool(pool({ enabled: false }), MINT, USDC).ok, false);
  assert.equal(checkLimitPool(pool(), MINT, SOL).ok, false, "another pair");
  assert.equal(checkLimitPool(pool({ tokenY: { mint: USDC, program: "Other1111111111111111111111111111111111111" } }), MINT, USDC).ok, false);
  assert.equal(checkLimitPool(null, MINT, USDC).ok, false);
});
