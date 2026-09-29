import assert from "node:assert/strict";
import test from "node:test";
import {createMemoryGuardStore} from "../guard/store.ts";
import {openClaim,transitionClaim} from "./claim.ts";
import {ensureRewardAccount,bindReferrer,readRewardAccount,reconcileReferralEdges,referralCounts} from "./ledger.ts";
const A="6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp", B="3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL", NOW="2026-09-12T12:00:00.000Z";

test("a balance read before another claim cannot open a payout after that claim finishes",async()=>{
 const store=createMemoryGuardStore();const first=await openClaim(store,{wallet:A,usdMicros:1000000n,now:NOW});
 await transitionClaim(store,{wallet:A,claimId:first.claim.claimId,to:"PAID",at:NOW});
 const stale=await openClaim(store,{wallet:A,usdMicros:1000000n,now:NOW,expectedVersion:null});
 assert.equal(stale.ok,false);
});
test("concurrent opposite referrals cannot form a cycle",async()=>{
 const store=createMemoryGuardStore();const a=await ensureRewardAccount(store,A,NOW),b=await ensureRewardAccount(store,B,NOW);
 const outcomes=await Promise.all([bindReferrer(store,{wallet:A,code:b.code,now:NOW}),bindReferrer(store,{wallet:B,code:a.code,now:NOW})]);
 assert.equal(outcomes.filter(r=>r.ok).length,1);
});
test("an edge whose count write failed repairs itself on the next read",async()=>{
 const base=createMemoryGuardStore();const b=await ensureRewardAccount(base,B,NOW);let fail=true;
 const store={...base,versioned(name){const c=base.versioned(name);return {...c,async compareAndSet(key,version,next){if(name==="rewardAccounts"&&key===B&&next.directReferrals===1&&fail)throw Error("injected counter outage");return c.compareAndSet(key,version,next)}}}};
 await bindReferrer(store,{wallet:A,code:b.code,now:NOW});fail=false;await reconcileReferralEdges(store,A,NOW);
 assert.equal(referralCounts(await readRewardAccount(base,B)).level1,1);
});
