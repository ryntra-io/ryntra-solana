import assert from "node:assert/strict";
import test from "node:test";
import {createMemoryGuardStore} from "../guard/store.ts";
import * as claims from "./claim.ts";
import {heldUsdMicros,holdReserve,readReserveLedger} from "./reserve.ts";
import {listRewardEntries,totalRewards} from "./ledger.ts";

const WALLET="6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp",DEST="3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL",NOW="2026-09-12T12:00:00.000Z";
const signature="3".repeat(88),blockhash="11111111111111111111111111111111";
async function opened(){const store=createMemoryGuardStore();const result=await claims.openClaim(store,{wallet:WALLET,usdMicros:1000000n,now:NOW});await holdReserve(store,{wallet:WALLET,claimId:result.claim.claimId,usdMicros:1000000n,treasuryUsdMicros:10000000n,now:NOW});return {store,claim:result.claim}}
async function reconcile(store,claim,status,extra={}){const {reconcileRewardClaim}=await import("./claim-settlement.ts");return reconcileRewardClaim(store,claim,{now:NOW,readStatus:async()=>status,...extra})}

test("a still-preparing payout retains its slot and reserve",async()=>{
 const {store,claim}=await opened();await reconcile(store,claim,{seen:false});
 assert.equal((await claims.readClaim(store,WALLET)).state,"CLAIMING");
 assert.equal(heldUsdMicros(await readReserveLedger(store),NOW),1000000n);
 assert.equal((await claims.openClaim(store,{wallet:WALLET,usdMicros:1000000n,now:NOW})).ok,false);
});
test("persisting the signature before broadcast has only one winner",async()=>{
 const {store,claim}=await opened();const args={wallet:WALLET,claimId:claim.claimId,signature,destination:DEST,blockhash,lastValidBlockHeight:"100",at:NOW};
 const results=await Promise.all([claims.armClaim(store,args),claims.armClaim(store,args)]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal((await claims.readClaim(store,WALLET)).signature,signature);
});
test("processed acceptance does not mean paid; confirmed settlement deducts once",async()=>{
 const {store,claim}=await opened();await claims.armClaim(store,{wallet:WALLET,claimId:claim.claimId,signature,destination:DEST,blockhash,lastValidBlockHeight:"100",at:NOW});
 const armed=await claims.readClaim(store,WALLET);await reconcile(store,armed,{seen:true,confirmationStatus:"processed",err:null});
 assert.equal((await listRewardEntries(store,WALLET)).length,0);
 await Promise.all([reconcile(store,armed,{seen:true,confirmationStatus:"confirmed",err:null}),reconcile(store,armed,{seen:true,confirmationStatus:"confirmed",err:null})]);
 assert.equal((await claims.readClaim(store,WALLET)).state,"PAID");assert.equal((await listRewardEntries(store,WALLET)).length,1);
 assert.equal(totalRewards(await listRewardEntries(store,WALLET)).claimedUsdMicros,1000000n);
});
test("unknown payout stays reserved until expiry is independently verified and status read again",async()=>{
 const {store,claim}=await opened();await claims.armClaim(store,{wallet:WALLET,claimId:claim.claimId,signature,destination:DEST,blockhash,lastValidBlockHeight:"100",at:NOW});
 const armed=await claims.readClaim(store,WALLET);await reconcile(store,armed,{seen:false},{blockhashValid:async()=>null});
 assert.equal((await claims.readClaim(store,WALLET)).state,"SUBMITTED_UNKNOWN");
 let reads=0;await reconcile(store,armed,{seen:false},{readStatus:async()=>{reads++;return reads===1?{seen:false}:{seen:true,confirmationStatus:"confirmed",err:null}},blockhashValid:async()=>false});
 assert.equal(reads,2);assert.equal((await claims.readClaim(store,WALLET)).state,"PAID");
});
test("an old signatureless claim is not expired using assumptions from the new protocol",async()=>{
 const {store,claim}=await opened();const legacy={...claim};delete legacy.protocolVersion;delete legacy.preparationExpiresAt;
 await store.collection("rewardClaims").set(WALLET,legacy);
 await reconcile(store,legacy,{seen:false},{now:"2026-09-13T12:00:00.000Z"});
 assert.equal((await claims.readClaim(store,WALLET)).state,"CLAIMING");
});

test("an expired new preparation may release but its old builder can never arm afterwards",async()=>{
 const {store,claim}=await opened();const later="2026-09-12T12:03:00.000Z";
 await reconcile(store,claim,{seen:false},{now:later});assert.equal((await claims.readClaim(store,WALLET)).state,"FAILED");
 assert.equal((await claims.armClaim(store,{wallet:WALLET,claimId:claim.claimId,signature,destination:DEST,blockhash,lastValidBlockHeight:"100",at:later})).ok,false);
 assert.equal(heldUsdMicros(await readReserveLedger(store),later),0n);
});
