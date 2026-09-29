import assert from "node:assert/strict";
import test from "node:test";
import {decodeWalletCollection,holdingValue,holdingSymbol,shownRaw,usdValue,usdValueIn,walletValue} from "./wallet-view-model.ts";

test("failed and malformed reads cannot become empty wallets",()=>{
  for(const payload of [null,{error:{code:"UNAVAILABLE"}},{data:{}},{data:{holdings:[{amountRaw:"oops",decimals:6}]}}]) assert.throws(()=>decodeWalletCollection(true,payload,"holdings"),/READ_FAILED/);
  assert.throws(()=>decodeWalletCollection(false,{data:{holdings:[]}},"holdings"));
  assert.deepEqual(decodeWalletCollection(true,{data:{holdings:[],tokenRead:"COMPLETE"}},"holdings").data,[]);
  for(const tokenRead of ["PARTIAL","UNAVAILABLE",undefined]) assert.equal(decodeWalletCollection(true,{data:{holdings:[],tokenRead}},"holdings").complete,false);
});
test("unknown and very small prices remain distinct from zero",()=>{
  const holding={mint:null,amountRaw:"1000000000",decimals:6,symbol:"TOKEN",catalog:{usdPrice:"0.00000091"}};
  assert.equal(holdingValue(holding),910n);
  assert.equal(usdValue(910n),"<$0.01");
  const value=walletValue([holding,{...holding,catalog:null}]);
  assert.equal(value.total,910n);assert.equal(value.unpriced,1);
});
test("a scaled mint is valued in the unit the wallet shows: $10 of SpaceX PreStocks (×5) reads $9.89, not a fifth of it",()=>{
  /* The venue's own figures of 2026-09-25: 16,907,000 raw at 9 decimals is 0.084535 SPACEX in the wallet, priced $116.99 per that unit. */
  const spacex={kind:"TOKEN",mint:"PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",amountRaw:"16907000",decimals:9,symbol:"SPACEX",catalog:{usdPrice:"116.99428567854382"},uiMultiplier:5};
  assert.equal(shownRaw(spacex),84_535_000n);
  assert.equal(usdValue(holdingValue(spacex)),"$9.89");
  /* Without the multiplier the old reading was a fifth of it — the defect this fixes. */
  assert.equal(usdValue(holdingValue({...spacex,uiMultiplier:null})),"$1.97");
  /* OpenAI's 1.4861347 is carried exactly enough for cents. */
  assert.equal(shownRaw({amountRaw:"1000000000",uiMultiplier:1.4861347}),1_486_134_700n);
  assert.equal(shownRaw({amountRaw:"123",uiMultiplier:1}),123n);
  assert.equal(shownRaw({amountRaw:"123"}),123n);
});
test("native SOL identity wins over the wrapped pricing token's name",()=>{
  assert.equal(holdingSymbol({kind:"NATIVE_SOL",mint:null,amountRaw:"1",decimals:9,symbol:null,catalog:{symbol:"WSOL",usdPrice:"100"}}),"SOL");
});

test('a failed read or a different wallet has no spendable rows from an earlier owner',async()=>{
  const {walletRowsForOwner}=await import('./wallet-view-model.ts');
  const rows=[{mint:'SOL',spendableRaw:'9007199254740993'}];
  const snapshot={owner:'wallet-a',rows};
  assert.equal(walletRowsForOwner(snapshot,'wallet-a'),rows);
  assert.deepEqual(walletRowsForOwner(snapshot,'wallet-b'),[]);
  assert.deepEqual(walletRowsForOwner(snapshot,null),[]);
  assert.deepEqual(walletRowsForOwner(null,'wallet-a'),[]);
});

test("every ledger lane passes the activity read, and an unknown one costs a row rather than the page", async () => {
  /* This has now happened twice on production. The first RECEIVE row — a paid
     payment request — failed the whole wallet read on 2026-09-07, and the fix
     added one string to the copy of the lane list this decoder carried. On
     2026-09-08 the founder's first CROSS_SWAP row did it again, minutes after
     the swap had settled correctly on both chains. So the list is imported,
     every lane in it is asserted here, and a lane from some future build is
     dropped with the read marked incomplete instead of throwing. */
  const { SOLANA_ACTION_LANES } = await import("../../lib/solana/action-lanes.ts");
  const row = { actionId: "receive:C4N7mA3hQvbE8kmCyFxPwWBmUoZwsJb8SCpCnDb9J6WQ", lane: "RECEIVE", outcome: "DONE", out: null, in: { mint: null, amountRaw: "10000000", decimals: 9, symbol: "SOL" }, signature: null, updatedAt: "2026-09-07T16:05:47.000Z" };
  assert.ok(SOLANA_ACTION_LANES.includes("CROSS_SWAP"));
  for (const lane of SOLANA_ACTION_LANES) {
    const decoded = decodeWalletCollection(true, { data: { actions: [{ ...row, lane }], complete: true } }, "activity");
    assert.equal(decoded.data.length, 1, lane);
    assert.equal(decoded.complete, true, lane);
  }
  const future = decodeWalletCollection(true, { data: { actions: [row, { ...row, lane: "REFUND" }], complete: true } }, "activity");
  assert.equal(future.data.length, 1, "the known row survives");
  assert.equal(future.complete, false, "and the read says it is not the whole story");
  /* A malformed row is still a failed read: a missing id is not a new lane. */
  assert.throws(() => decodeWalletCollection(true, { data: { actions: [{ ...row, actionId: 7 }], complete: true } }, "activity"), /READ_FAILED/);
});

test("a sum reads the same on Home and in Portfolio, in the reader's language",()=>{
  assert.equal(usdValueIn(141_010_000n,"en"),"$141.01");
  assert.equal(usdValueIn(141_010_000n,"uk"),"$141,01");
  assert.equal(usdValueIn(1_234_560_000n,"uk"),"$1 234,56");
  assert.equal(usdValueIn(5_000n,"uk"),"<$0,01");
  assert.equal(usdValueIn(0n,"uk"),"$0,00");
});
