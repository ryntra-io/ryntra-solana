import assert from "node:assert/strict";
import test from "node:test";
import {createMemoryGuardStore} from "../guard/store.ts";
import {serviceFeeQuoted,settleServiceFee} from "../swap/service-fee.ts";
import {recordOperationRewards} from "./record.server.ts";
import {bindReferrer,ensureRewardAccount,listRewardEntries,totalRewards} from "./ledger.ts";
const A="6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp", B="3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL", C="9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", NOW="2026-09-12T12:00:00.000Z";
function fee(){return settleServiceFee(serviceFeeQuoted("JUPITER_REFERRAL",{basisPoints:50,asset:MINT,symbol:null,decimals:null,amountRaw:"5000000",providerRetainedPercent:20}),{collected:true,amountRaw:"5000000",settlement:{operationRef:"settled-swap",userPaidRaw:"5000000",providerRaw:"1000000",ryntraRaw:"4000000",asset:MINT,symbol:null,decimals:null,basis:"RYNTRA_OBSERVED_SPLIT_DOCUMENTED"}})}
async function chain(store){const a=await ensureRewardAccount(store,A,NOW),b=await ensureRewardAccount(store,B,NOW);await bindReferrer(store,{wallet:B,code:a.code,now:NOW});await bindReferrer(store,{wallet:C,code:b.code,now:NOW})}
const args={fee:fee(),trader:C,settledAt:NOW,now:NOW,env:{RYNTRA_REWARDS_ACTIVATION_AT:"2026-09-10T15:25:00Z"}};
test("a confirmed Jupiter fee with missing display metadata still accrues the exact 50/10/5 shares",async()=>{
 const store=createMemoryGuardStore();await chain(store);const result=await recordOperationRewards(store,args);assert.equal(result.state,"RECORDED");
 for(const [wallet,amount] of [[C,2500000n],[B,500000n],[A,250000n]])assert.equal(totalRewards(await listRewardEntries(store,wallet)).entitledUsdMicros,amount);
});
test("a failed reward batch leaves no partial liability and retries to exactly three entries",async()=>{
 const base=createMemoryGuardStore();await chain(base);let fail=true;
 const store={...base,collection(name){const c=base.collection(name);return {...c,async insertIfAbsent(key,value){if(name==="rewardEntries"&&value.type==="REFERRAL_L2"&&fail){fail=false;throw Error("injected last-row failure")}return c.insertIfAbsent(key,value)},async insertAllIfAbsent(entries){if(name==="rewardEntries"&&fail){fail=false;throw Error("injected atomic failure")}return c.insertAllIfAbsent(entries)}}},async compareAndSetMany(writes){if(fail&&writes.some(w=>w.collection==="rewardEntries")){fail=false;throw Error("injected atomic failure")}return base.compareAndSetMany(writes)}};
 await recordOperationRewards(store,{...args,fee:{...args.fee,symbol:"USDC",decimals:6,settlement:{...args.fee.settlement,symbol:"USDC",decimals:6}}});
 assert.equal((await listRewardEntries(base,C)).length,0);
 await recordOperationRewards(store,args);await recordOperationRewards(store,args);
 assert.equal((await listRewardEntries(base,C)).length,1);assert.equal((await listRewardEntries(base,B)).length,1);assert.equal((await listRewardEntries(base,A)).length,1);
});

test("a pending fee valuation completes once without changing the original earned rows",async()=>{
 const store=createMemoryGuardStore();await chain(store);
 const native={...args.fee,asset:"So11111111111111111111111111111111111111112",decimals:9,symbol:"SOL",settlement:{...args.fee.settlement,asset:"So11111111111111111111111111111111111111112",decimals:9,symbol:"SOL"}};
 const input={...args,fee:native,deps:{readPrice:async()=>null}};
 await recordOperationRewards(store,input);
 assert.equal(totalRewards(await listRewardEntries(store,C)).unvaluedCount,1);
 await recordOperationRewards(store,{...input,providerUsd:2});await recordOperationRewards(store,{...input,providerUsd:2});
 const entries=await listRewardEntries(store,C),totals=totalRewards(entries);
 assert.equal(entries.find(e=>e.type==="CASHBACK").usdMicros,null,"the original row remains immutable");
 assert.equal(entries.filter(e=>e.type==="ADJUSTMENT").length,1);
 assert.equal(totals.unvaluedCount,0);assert.equal(totals.bySource.CASHBACK,1000000n);assert.equal(totals.entitledUsdMicros,1000000n);
});
test("today's price cannot become a valuation at yesterday's settlement",async()=>{
 const store=createMemoryGuardStore();const native={...args.fee,asset:"So11111111111111111111111111111111111111112",decimals:9,settlement:{...args.fee.settlement,asset:"So11111111111111111111111111111111111111112",decimals:9}};
 await recordOperationRewards(store,{...args,fee:native,price:{price:"100",sourceRef:"today",observedAt:"2026-09-13T12:00:00.000Z"}});
 assert.equal(totalRewards(await listRewardEntries(store,C)).unvaluedCount,1);
});

test("an unrepresentable price still records the exact fee share as pending",async()=>{
 const store=createMemoryGuardStore();const native={...args.fee,asset:"So11111111111111111111111111111111111111112",decimals:9,settlement:{...args.fee.settlement,asset:"So11111111111111111111111111111111111111112",decimals:9}};
 const result=await recordOperationRewards(store,{...args,fee:native,price:{price:"1e-8",sourceRef:"catalog",observedAt:NOW}});
 assert.equal(result.state,"RECORDED");
 const entries=await listRewardEntries(store,C);assert.equal(entries.length,1);assert.equal(entries[0].shareRaw,"2500000");
 assert.equal(entries[0].valuation.basis,"UNVALUED");assert.equal(entries[0].usdMicros,null);
});

test("a later referral binding cannot claim an earlier settlement during replay",async()=>{
 const store=createMemoryGuardStore();await chain(store);
 await recordOperationRewards(store,{...args,settledAt:"2026-09-12T11:59:00.000Z"});
 assert.equal((await listRewardEntries(store,B)).length,0);assert.equal((await listRewardEntries(store,A)).length,0);
 assert.equal(totalRewards(await listRewardEntries(store,C)).entitledUsdMicros,2500000n);
});
