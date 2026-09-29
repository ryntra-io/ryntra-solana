import assert from "node:assert/strict";
import test from "node:test";
import { projectBridgeDetails, projectReverseBridgeArrival } from "./activity-bridge.ts";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "./cctp-registry.ts";

const wallet="4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const hash=`0x${"a".repeat(64)}`,nonce=`0x${"b".repeat(64)}`,signature="2".repeat(88);
const action={lane:"BRIDGE",network:"mainnet",wallet,actionId:hash,outcome:"DONE",out:null,in:null,signature:null,destination:null};
const claim={network:"mainnet",intentDigest:hash,direction:"BASE_TO_SOLANA",state:"RECEIPTED",destinationWallet:wallet,burnSignature:hash,mintTransactionHash:signature,messageNonce:nonce,sourceAccount:null};
const lookup={state:"ATTESTED",messagesReturned:1,transactionHash:hash,attested:{nonce,decoded:{header:{sourceDomain:6,destinationDomain:5},burn:{burnToken:"0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",amountRaw:"3000000",feeExecutedRaw:"1000",messageSender:"0x"+"0".repeat(64)}}}};

test("a recorded reverse bridge gains exact direction, Solana link and net USDC from its bound Circle message",()=>{
  const view=projectBridgeDetails(action,claim,lookup);
  assert.equal(view.destination,"SOLANA");assert.equal(view.signature,signature);
  assert.deepEqual(view.in,{mint:null,amountRaw:"2999000",decimals:6,symbol:"USDC"});assert.equal(view.out,null);
  assert.equal(action.in,null,"projection must not mutate the durable record");
});
test("missing, ambiguous or mismatched messages never invent an amount",()=>{
  for(const bad of [null,{...lookup,messagesReturned:2},{...lookup,transactionHash:"different"},{...lookup,attested:{...lookup.attested,nonce:"different"}},{...lookup,attested:{...lookup.attested,decoded:{...lookup.attested.decoded,header:{sourceDomain:5,destinationDomain:6}}}}]) {
    assert.equal(projectBridgeDetails(action,claim,bad).in,null);
  }
  assert.equal(projectBridgeDetails({...action,outcome:"IN_FLIGHT"},claim,lookup).in,null);
});
test("a bridge claim cannot cross wallets, intents, networks or reverse an already recorded direction",()=>{
  for(const bad of [{...claim,destinationWallet:"other"},{...claim,intentDigest:"other"},{...claim,network:"devnet"}]) assert.strictEqual(projectBridgeDetails(action,bad,lookup),action);
  const forward={...action,destination:"BASE"};assert.strictEqual(projectBridgeDetails(forward,claim,lookup),forward);
});
test("the forward lane uses its source Solana signature rather than a Base hash",()=>{
  const view=projectBridgeDetails(action,{...claim,direction:"SOLANA_TO_BASE",burnSignature:signature,mintTransactionHash:hash},null);
  assert.equal(view.destination,"BASE");assert.equal(view.signature,signature);assert.equal(view.out,null);
});

const usdc=SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address;
const programs=SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.components.map((component)=>component.address);
const recipientAccount="5XmJVGx1jLPPZd95WjtSni8fjQ6QKgmmZikAumxmwxXD";
const observation={
  observation:{network:"mainnet",signature,balanceDeltas:[
    {account:"6xTBTqJMBr5m7BKqVxmW2x11DfqUwtD3TJsqpxELx72L",mint:usdc,rawDelta:"-1000000"},
    {account:recipientAccount,mint:usdc,rawDelta:"1000000"},
  ]},
  transactionSucceeded:true,
  invokedPrograms:programs,
  postTokenAccounts:[{account:recipientAccount,mint:usdc,owner:wallet,tokenProgram:"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",amountRaw:"6461455",decimals:6}],
};

test("an exact terminal reverse claim gains net USDC from its wallet-owned Solana transaction delta",()=>{
  const view=projectReverseBridgeArrival(action,claim,observation);
  assert.deepEqual(view.in,{mint:null,amountRaw:"1000000",decimals:6,symbol:"USDC"});
  assert.equal(view.signature,signature);assert.equal(view.destination,"SOLANA");
  assert.equal(action.in,null,"read projection must not mutate the durable row");
});

test("reverse amount projection fails closed across every claim, transaction and account binding",()=>{
  const cases=[
    [action,{...claim,destinationWallet:"other"},observation],
    [action,{...claim,state:"MINT_OBSERVED"},observation],
    [action,claim,{...observation,transactionSucceeded:false}],
    [action,claim,{...observation,observation:{...observation.observation,network:"devnet"}}],
    [action,claim,{...observation,observation:{...observation.observation,signature:"different"}}],
    [action,claim,{...observation,invokedPrograms:programs.slice(0,1)}],
    [action,claim,{...observation,postTokenAccounts:[{...observation.postTokenAccounts[0],owner:"other"}]}],
    [action,claim,{...observation,observation:{...observation.observation,balanceDeltas:[...observation.observation.balanceDeltas,{account:"second",mint:usdc,rawDelta:"1"}]},postTokenAccounts:[...observation.postTokenAccounts,{...observation.postTokenAccounts[0],account:"second"}]}],
  ];
  for(const [candidate,candidateClaim,candidateObservation] of cases) {
    assert.strictEqual(projectReverseBridgeArrival(candidate,candidateClaim,candidateObservation),candidate);
  }
  assert.strictEqual(projectReverseBridgeArrival(action,claim,null),action);
});
