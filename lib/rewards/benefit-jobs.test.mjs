import assert from "node:assert/strict";
import test from "node:test";
import {createMemoryGuardStore} from "../guard/store.ts";
import {enqueueBenefitJob,drainBenefitJobs} from "./benefit-jobs.ts";
const A="6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp",B="3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL",NOW="2026-09-12T12:00:00.000Z";
const data={kind:"POINTS",wallet:A,operationId:"test-operation",settledAt:NOW,action:{}};
test("one operation queues once, and one wallet's refresh cannot drain another wallet",async()=>{
 const store=createMemoryGuardStore();await enqueueBenefitJob(store,data,NOW);await enqueueBenefitJob(store,data,NOW);await enqueueBenefitJob(store,{...data,wallet:B},NOW);
 const seen=[];await drainBenefitJobs(store,{wallet:A,now:NOW,process:async job=>{seen.push(job.wallet);return true}});
 assert.deepEqual(seen,[A]);assert.equal((await store.collection("benefitJobs").valuesWithPrefix(`${B}:`)).length,1);
});
test("a transient recorder failure keeps the job and a later run completes it",async()=>{
 const store=createMemoryGuardStore();await enqueueBenefitJob(store,data,NOW);
 await drainBenefitJobs(store,{now:NOW,process:async()=>{throw Error("temporary")}});
 assert.equal((await store.collection("benefitJobs").valuesWithPrefix("")).length,1);
 await drainBenefitJobs(store,{now:"2026-09-12T12:02:00.000Z",process:async()=>true});
 assert.equal((await store.collection("benefitJobs").valuesWithPrefix("")).length,0);
});
test("concurrent workers claim one pending job only once",async()=>{
 const store=createMemoryGuardStore();await enqueueBenefitJob(store,data,NOW);let runs=0;
 await Promise.all(Array.from({length:3},()=>drainBenefitJobs(store,{now:NOW,process:async()=>{runs++;return true}})));
 assert.equal(runs,1);
});
