import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {resolve as pathResolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
registerHooks({resolve(specifier,context,nextResolve){
 if(specifier.startsWith('@/')) {const p=pathResolve(specifier.slice(2)); for(const ext of ['', '.ts','.tsx','.js','/index.ts'])if(existsSync(p+ext))return nextResolve(pathToFileURL(p+ext).href,context);}
 try{return nextResolve(specifier,context);}catch(error){if(specifier.startsWith('.')&&context.parentURL){const p=fileURLToPath(new URL(specifier,context.parentURL));for(const ext of ['.ts','.tsx','.js','/index.ts'])if(existsSync(p+ext))return nextResolve(pathToFileURL(p+ext).href,context);}throw error;}
}});

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../../../../lib/solana/send-kinds.ts';
import { associatedTokenAccount } from '../../../../lib/solana/token-account.ts';
const { POST } = await import('./route.ts');
const OWNER='4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n';
const MINT='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MINT2='So11111111111111111111111111111111111111112';
const ATA=await associatedTokenAccount({owner:OWNER,mint:MINT,tokenProgram:TOKEN_PROGRAM_ID});
let requestId=0;
const request=(options={})=>new Request('http://localhost/api/solana/holdings',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'192.0.2.'+(++requestId)},body:JSON.stringify({owner:OWNER,network:'mainnet'}),...options});
const account=(pubkey,mint,amount,state='initialized')=>({pubkey,account:{data:{parsed:{info:{mint,state,tokenAmount:{amount,decimals:6}}}}}});
const fixture={
 [TOKEN_PROGRAM_ID]:[account(ATA,MINT,'9007199254740993'),account(OWNER,MINT,'7'),account(MINT2,MINT,'11','frozen'),account(MINT,MINT,'13','unknown')],
 [TOKEN_2022_PROGRAM_ID]:[account(OWNER,MINT2,'19')],
};
function reply(payload,value){return new Response('{"jsonrpc":"2.0","id":"'+payload.id+'","result":'+value+'}',{headers:{'content-type':'application/json'}});}
function stub(t,options={}) {
 const calls=[];const start=performance.now();
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(!init?.body)return Response.json(String(url).includes('/tokens/')?[]:{});
  const payload=JSON.parse(init.body);const call={method:payload.method,params:payload.params,host:new URL(url).host,ms:performance.now()-start};calls.push(call);
  if(options.fetch){const result=await options.fetch(payload,init,call);if(result)return result;}
  if(options.delayCore&&['getBalance','getTokenAccountsByOwner'].includes(payload.method))await delay(options.delayCore,undefined,{signal:init.signal});
  if(payload.method==='getBalance')return reply(payload,'{"context":{"slot":100},"value":9007199254740993}');
  if(payload.method==='getTokenAccountsByOwner')return reply(payload,JSON.stringify({context:{slot:100},value:options.accounts?.[payload.params[1].programId]??fixture[payload.params[1].programId]}));
  if(payload.method==='getAccountInfo')return reply(payload,'{"context":{"slot":100},"value":null}');
  if(payload.method==='getMultipleAccounts')return reply(payload,JSON.stringify({context:{slot:100},value:payload.params[0].map(()=>null)}));
  throw new Error('Unexpected method '+payload.method);
 });
 return calls;
}
test('balance and both token programs read in parallel before any core answer',async t=>{
 const calls=stub(t,{delayCore:120});await POST(request());
 const core=calls.filter(c=>['getBalance','getTokenAccountsByOwner'].includes(c.method));
 assert.equal(core.length,3);assert.ok(Math.max(...core.map(c=>c.ms))-Math.min(...core.map(c=>c.ms))<100,'the core reads still serialize');
});
test('mint details are batched without changing bigint balances, spendability or accounts',async t=>{
 const calls=stub(t);const result=await POST(request());const {data}=await result.json();
 assert.equal(result.status,200);assert.equal(data.tokenRead,'COMPLETE');assert.equal(data.held,5);assert.equal(data.returned,3);
 assert.equal(data.lamports,'9007199254740993');assert.equal(data.holdings[0].spendableRaw,'9007199254240993');
 const token=data.holdings.find(row=>row.mint===MINT);assert.equal(token.amountRaw,'9007199254741024');assert.equal(token.spendableRaw,'9007199254741000');assert.equal(token.sourceAccounts.length,4);assert.equal(token.canonicalAta,ATA);
 assert.equal(calls.filter(c=>c.method==='getAccountInfo').length,0,'per-mint request burst remains');
 assert.equal(calls.filter(c=>c.method==='getMultipleAccounts').length,1);
 assert.match(result.headers.get('cache-control'),/no-store/);assert.match(result.headers.get('server-timing'),/total;dur=/);
});
test('a canceled caller cannot start RPC reads or return a fresh balance',async t=>{
 const calls=stub(t);const controller=new AbortController();controller.abort();const response=await POST(request({signal:controller.signal}));
 assert.ok(response.status>=400);assert.equal(calls.length,0);
});
test('one failed program is partial and neither failed program becomes an empty wallet',async t=>{
 stub(t,{fetch:(p)=>p.method==='getTokenAccountsByOwner'&&p.params[1].programId===TOKEN_2022_PROGRAM_ID?new Response('unavailable',{status:503}):null});
 const {data}=await(await POST(request())).json();assert.equal(data.tokenRead,'PARTIAL');assert.equal(data.holdings.length,2);assert.equal(data.holdings[1].spendableRaw,'9007199254741000');
});
test('all token reads failing are unavailable, and native read failing has no balance payload',async t=>{
 stub(t,{fetch:p=>p.method==='getTokenAccountsByOwner'?new Response('blocked',{status:403}):null});
 const {data}=await(await POST(request())).json();assert.equal(data.tokenRead,'UNAVAILABLE');assert.equal(data.holdings.length,1);
 t.mock.restoreAll();stub(t,{fetch:p=>p.method==='getBalance'?new Response('blocked',{status:403}):null});
 const response=await POST(request());const body=await response.json();assert.equal(response.status,502);assert.equal(body.data,undefined);assert.equal(body.error.code,'RPC_FAILED');
});
test('a token program silent on both hosts gets one bounded second attempt, and a wallet that answers then is COMPLETE, not PARTIAL (request 19)',async t=>{
 let refusals=0;
 const calls=stub(t,{fetch:(p)=>{if(p.method==='getTokenAccountsByOwner'&&p.params[1].programId===TOKEN_2022_PROGRAM_ID&&refusals<2){refusals+=1;return new Response('unavailable',{status:503});}return null;}});
 const response=await POST(request());const {data}=await response.json();
 assert.equal(data.tokenRead,'COMPLETE','the second attempt answered, so the wallet is whole');
 assert.equal(data.holdings.length,3);
 const reads=calls.filter(c=>c.method==='getTokenAccountsByOwner'&&c.params[1].programId===TOKEN_2022_PROGRAM_ID);
 assert.equal(reads.length,3,'both hosts on the first pass, one more call on the second');
 assert.match(response.headers.get('server-timing'),/rpc;desc="[0-9]+ attempts"/);
});
test('a malformed answer is a fact, not a transport failure: it is not re-asked',async t=>{
 const calls=stub(t,{accounts:{[TOKEN_PROGRAM_ID]:fixture[TOKEN_PROGRAM_ID],[TOKEN_2022_PROGRAM_ID]:[account(MINT,MINT,'NaN')]}});
 const {data}=await(await POST(request())).json();assert.equal(data.tokenRead,'PARTIAL');
 assert.equal(calls.filter(c=>c.method==='getTokenAccountsByOwner'&&c.params[1].programId===TOKEN_2022_PROGRAM_ID).length,1,'no second attempt on an answer');
});
test('malformed token program response is unavailable, never coerced or partly accepted',async t=>{
 stub(t,{accounts:{[TOKEN_PROGRAM_ID]:[...fixture[TOKEN_PROGRAM_ID],account(MINT,MINT,'NaN')],[TOKEN_2022_PROGRAM_ID]:[]}});
 const response=await POST(request());const {data}=await response.json();assert.equal(response.status,200);assert.equal(data.tokenRead,'PARTIAL');assert.equal(data.holdings.length,1);
});
test('a slow primary yields to the fallback within the balance budget',async t=>{
 const calls=stub(t,{fetch:async(p,init,call)=>{if(call.host==='solana-rpc.publicnode.com')await delay(10000,undefined,{signal:init.signal});}});
 const start=performance.now();const response=await POST(request());const {data}=await response.json();assert.equal(data.tokenRead,'COMPLETE');assert.ok(performance.now()-start<4500);
 assert.ok(calls.some(c=>c.host==='public.rpc.solanavibestation.com'));assert.ok(calls.length<=8,'unexpected retries amplify RPC reads');
});
test('a stalled request body reaches a terminal deadline and cancels the reader',async t=>{
 const calls=stub(t);let canceled=false;
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){canceled=true;}});
 const start=performance.now();const response=await POST(request({body,duplex:'half'}));
 assert.equal(response.status,504);assert.equal((await response.json()).error.code,'READ_DEADLINE');assert.ok(performance.now()-start<5000);assert.equal(calls.length,0);assert.equal(canceled,true);
});

test('detail batches stay inside the measured provider limit and never truncate inventory',async t=>{
 const {getBase58Decoder}=await import('@solana/kit');
 const accounts=Array.from({length:15},(_,i)=>account(OWNER,getBase58Decoder().decode(new Uint8Array(32).fill(i+1)),String(i+1)));
 const calls=stub(t,{accounts:{[TOKEN_PROGRAM_ID]:accounts,[TOKEN_2022_PROGRAM_ID]:[]}});
 const {data}=await(await POST(request())).json();
 assert.equal(data.held,15);assert.equal(data.returned,16);assert.equal(data.detailed,12);
 const batches=calls.filter(c=>c.method==='getMultipleAccounts');
 assert.equal(batches.length,2);assert.ok(batches.every(c=>c.params[0].length<=6));
});

/* RYN-API-CONTRACT-002 — the route's own answer parses with the contract's v1 schema, whole and partial,
   and the native SOL row is what the contract says it is: NATIVE_SOL with no mint. */
test('the answer parses with HoldingsResponseSchema, and native SOL carries no mint',async t=>{
 const { HoldingsResponseSchema } = await import('../../../../lib/api/v1/contract.ts');
 stub(t);
 const whole=HoldingsResponseSchema.parse(await(await POST(request())).json());
 assert.equal(whole.data.tokenRead,'COMPLETE');
 assert.equal(whole.data.holdings[0].kind,'NATIVE_SOL');assert.equal(whole.data.holdings[0].mint,null);
 assert.ok(whole.data.holdings.slice(1).every(row=>row.kind==='TOKEN'&&typeof row.mint==='string'));
 t.mock.restoreAll();
 stub(t,{fetch:(p)=>p.method==='getTokenAccountsByOwner'&&p.params[1].programId===TOKEN_2022_PROGRAM_ID?new Response('unavailable',{status:503}):null});
 const partial=HoldingsResponseSchema.parse(await(await POST(request())).json());
 assert.equal(partial.data.tokenRead,'PARTIAL');
});
