import assert from "node:assert/strict";
import test from "node:test";
import {createMemoryGuardStore} from "../guard/store.ts";
import {ensureRewardAccount,bindReferrer} from "../rewards/ledger.ts";
import {recordOperationPoints} from "./record.server.ts";
import {listPointsEntries,pointsSummary} from "./ledger.ts";

const A="6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp", B="3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const NOW="2026-09-12T12:00:00.000Z", NEXT="2026-09-13T00:00:00.000Z";
const USDC="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", SOL="So11111111111111111111111111111111111111112";
function action(id="operation-1",dollars=6){return {schema:"ryntra.solana.wallet-action",schemaVersion:"1.0.0",version:1,network:"mainnet",wallet:A,actionId:id,lane:"SWAP",outcome:"DONE",out:{mint:USDC,amountRaw:String(BigInt(dollars)*1000000n),decimals:6,symbol:"USDC"},in:{mint:SOL,amountRaw:"10000000",decimals:9,symbol:"SOL"},destination:null,signature:id,receiptHash:null,sourceTx:null,destinationTx:null,fee:null,origin:null,startedAt:NOW,updatedAt:NOW};}
const record=(store,op,settledAt=NOW)=>recordOperationPoints(store,{action:op,settledAt,now:settledAt,env:{}});

test("replaying one $6 trade cannot manufacture a $12 active day",async()=>{
 const store=createMemoryGuardStore();await record(store,action());await record(store,action());
 const mine=pointsSummary(await listPointsEntries(store,A));assert.equal(mine.points,6n);assert.equal(mine.byReason.ACTIVE_DAY,0n);assert.equal(mine.trades,1);
});
test("parallel trades use one day's diminishing tiers and hard cap",async()=>{
 for(const [size,expected] of [[1000,1500n],[100000,10000n]]){
  const store=createMemoryGuardStore();await Promise.all([record(store,action("parallel-a",size)),record(store,action("parallel-b",size))]);
  const mine=pointsSummary(await listPointsEntries(store,A));assert.equal(mine.byReason.TRADE_VOLUME,expected);assert.equal(mine.byReason.ACTIVE_DAY,10n);assert.equal(mine.trades,2);
 }
});
test("a retry on another UTC day cannot credit the same operation twice",async()=>{
 const store=createMemoryGuardStore();await record(store,action());await record(store,action(),NEXT);
 const mine=pointsSummary(await listPointsEntries(store,A));assert.equal(mine.trades,1);assert.equal(mine.points,6n);
});
test("a failed qualification write is recoverable with no partial or duplicate bonus",async()=>{
 const base=createMemoryGuardStore(), account=await ensureRewardAccount(base,B,NOW);await bindReferrer(base,{wallet:A,code:account.code,now:NOW});
 let fail=true;
 const store={...base,collection(name){const c=base.collection(name);return {...c,async insertIfAbsent(key,value){if(name==="pointsEntries"&&value.reason==="QUALIFIED_REFERRAL"&&fail){fail=false;throw Error("injected write outage")}return c.insertIfAbsent(key,value)}}},async compareAndSetMany(writes){if(fail&&writes.some(w=>w.collection==="pointsEntries"&&w.next.reason==="QUALIFIED_REFERRAL")){fail=false;throw Error("injected atomic write outage")}return base.compareAndSetMany(writes)}};
 await record(store,action("qualification",10));await record(store,action("qualification",10));await record(store,action("qualification",10));
 assert.equal(pointsSummary(await listPointsEntries(base,B)).byReason.QUALIFIED_REFERRAL,100n);
 assert.equal(pointsSummary(await listPointsEntries(base,A)).points,20n);
});
test("an unreadable internal-wallet exclusion list cannot award points",async()=>{
 const base=createMemoryGuardStore();const store={...base,collection(name){const c=base.collection(name);return name==="adminInternalWallets"?{...c,async valuesWithPrefix(){throw Error("unavailable")}}:c}};
 assert.equal((await record(store,action())).state,"SKIPPED");assert.equal((await listPointsEntries(base,A)).length,0);
});

test("a referral bound after a settled trade cannot receive its delayed qualification",async()=>{
 const store=createMemoryGuardStore(),b=await ensureRewardAccount(store,B,NOW);await bindReferrer(store,{wallet:A,code:b.code,now:NOW});
 const earlier="2026-09-12T11:59:00.000Z";
 await record(store,{...action("earlier-trade",10),startedAt:earlier,updatedAt:earlier},earlier);
 assert.equal(pointsSummary(await listPointsEntries(store,A)).points,20n);
 assert.equal((await listPointsEntries(store,B)).length,0);
});

test("an unvalued trade can earn once when its own valuation becomes available",async()=>{
 const store=createMemoryGuardStore();const op=action("late-valuation",20);
 op.out={mint:SOL,amountRaw:"1000000000",decimals:9,symbol:"SOL"};op.in={mint:"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",amountRaw:"10000000",decimals:5,symbol:"BONK"};
 await record(store,op);assert.equal(pointsSummary(await listPointsEntries(store,A)).points,0n);
 const input={action:op,settledAt:NEXT,now:NEXT,env:{},statedUsd:{value:"20",sourceRef:"observed-value"}};
 await recordOperationPoints(store,input);await recordOperationPoints(store,input);
 const rows=await listPointsEntries(store,A), summary=pointsSummary(rows);
 assert.equal(summary.points,30n);assert.equal(summary.trades,1);assert.equal(summary.volumeUsdMicros,20000000n);
 assert.equal(rows.find(r=>r.reason==="TRADE_VOLUME").points,"0","the original row is preserved");
 assert.ok(rows.every(r=>r.day==="2026-09-12"),"a later read does not move the settlement day");
});
test("earning Points seals the same inviter choice that money rewards use",async()=>{
 const store=createMemoryGuardStore();const b=await ensureRewardAccount(store,B,NOW);await record(store,action());
 assert.equal((await bindReferrer(store,{wallet:A,code:b.code,now:NOW})).code,"ALREADY_EARNING");
});
