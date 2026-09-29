"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { verifyArtifact } from "@/app/agents/agent-control-client";
import { readSolanaReceipts } from "@/lib/solana/send-receipt-vault.client";
import { findReceiptForAction, projectVerifiedReceiptOutcome, type StoredReceiptView } from "@/lib/solana/receipt-view";
import { enrichActivityMetadata } from "@/lib/solana/activity-projection";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import { readWalletHoldingsUntilComplete } from "@/lib/solana/holdings.client";
import { decodeWalletCollection, type WalletHolding } from "./wallet-view-model";

export type WalletRead<T> = Readonly<{ status: "idle" | "loading" | "ready" | "error"; data: readonly T[]; complete: boolean }>;
/** One earned or claimed reward, exactly as `lib/rewards/view.ts` projects it. */
export type WalletRewardRow = Readonly<{ kind: string; display: string; amount: string; valued: boolean; detail: string | null; at: string }>;
/* `rewards` is null rather than empty when this browser has not proved the
   address. The two are different sentences — "not yours to see" and "nothing
   yet" — and a surface that renders an empty list for the first one tells
   somebody they have earned nothing when it simply has not been allowed to
   look. */
type Data = { owner: string | null; holdings: WalletRead<WalletHolding>; activity: WalletRead<SolanaWalletAction>; rewards: readonly WalletRewardRow[] | null; receiptRows: readonly StoredReceiptView[]; refresh(): void };
const empty = <T,>(status: WalletRead<T>["status"]): WalletRead<T> => ({ status, data: [], complete: false });
const Context = createContext<Data | null>(null);

export function WalletDataProvider({children}:{children:ReactNode}) {
  const {connection}=useSolanaConnection();
  const owner=connection?.address??null;
  const pathname=usePathname();
  const previousPath=useRef(pathname);
  const [version,setVersion]=useState(0);
  const [state,setState]=useState<Omit<Data,"refresh"|"receiptRows">>({owner:null,holdings:empty("idle"),activity:empty("idle"),rewards:null});
  const [receipts,setReceipts]=useState<{owner:string|null;rows:readonly StoredReceiptView[];verified:ReadonlySet<string>}>({owner:null,rows:[],verified:new Set()});
  const sequence=useRef(0);
  const refresh=useCallback(()=>setVersion(v=>v+1),[]);
  useEffect(()=>{
    if(previousPath.current!==pathname&&["/app/send","/app/swap"].includes(previousPath.current)) refresh();
    previousPath.current=pathname;
  },[pathname,refresh]);
  useEffect(()=>{
    const request=++sequence.current;
    if(!owner) { setState({owner:null,holdings:empty("idle"),activity:empty("idle"),rewards:null}); return; }
    let live=true;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),60_000);
    setState({owner,holdings:empty("loading"),activity:empty("loading"),rewards:null});
    const address=owner;
    async function read(kind:"holdings"|"activity") {
      try {
        if(kind==="holdings") {
          /* Balances through the one reader every MAX-offering card uses: a
             partial answer — one token program read, the other not — is read
             again on its own, and every answer reaches the screen on the way.
             Until 2026-09-12 the first partial answer was kept as the wallet. */
          const last=await readWalletHoldingsUntilComplete<unknown>({owner:address,signal:controller.signal,onRead:(read)=>{
            if(!live||sequence.current!==request||!read.ok) return;
            const parsed=decodeWalletCollection(true,{data:{holdings:read.rows,tokenRead:read.tokenRead}},"holdings");
            setState(current=>({...current,holdings:{status:"ready",data:parsed.data as readonly WalletHolding[],complete:parsed.complete}}));
          }});
          if(!last.ok) throw new Error(last.reason);
          return;
        }
        const response=await fetch(`/api/solana/${kind}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({owner,network:"mainnet"}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60_000)])});
        const payload=await response.json();
        const parsed=decodeWalletCollection(response.ok,payload,kind);
        if(!live||sequence.current!==request) return;
        setState(current=>({...current,activity:{status:"ready",data:parsed.data as readonly SolanaWalletAction[],complete:parsed.complete}}));
        /* Rewards ride along on the activity read rather than costing a
           second round trip, and the route only puts them there for a
           proven wallet. A shape this build does not recognise is dropped
           silently: a reward row is an addition to history, never a reason
           for history to fail. */
        if(kind==="activity") {
          const rows=(payload as {data?:{rewards?:unknown}})?.data?.rewards;
          setState(current=>({...current,rewards:Array.isArray(rows)?rows as readonly WalletRewardRow[]:null}));
        }
      } catch {
        if(!live||sequence.current!==request) return;
        setState(current=>({...current,[kind]:empty("error")}));
      }
    }
    void Promise.all([read("holdings"),read("activity")]).finally(()=>clearTimeout(timer));
    return ()=>{live=false;controller.abort();clearTimeout(timer);};
  },[owner,version]);
  useEffect(()=>{
    if(!owner) {setReceipts({owner:null,rows:[],verified:new Set()});return;}
    let live=true;
    let rows:readonly StoredReceiptView[]=[];
    try { rows=readSolanaReceipts(window.localStorage,owner); } catch { /* Blocked browser storage has no cached receipt to project. */ }
    setReceipts({owner,rows,verified:new Set()});
    const candidates=state.owner===owner&&state.activity.status==="ready"?rows.filter(row=>state.activity.data.some(action=>(action.outcome==="IN_FLIGHT"||action.outcome==="NEEDS_YOU")&&findReceiptForAction([row],action)!==null)):[];
    void Promise.all(candidates.map(async row=>{
      try { const result=await verifyArtifact(row.receipt);return result.integrity.valid&&result.issuer.verdict==="SIGNATURE_VALID"?String(row.receipt.contentHash):null; } catch { return null; }
    })).then(hashes=>{if(live)setReceipts({owner,rows,verified:new Set(hashes.filter((hash):hash is string=>hash!==null))});});
    return ()=>{live=false;};
  },[owner,pathname,version,state.owner,state.activity]);
  // Never paint the previous wallet while the effect for a new one is pending.
  const current=state.owner===owner?state:{owner,holdings:empty<WalletHolding>(owner?"loading":"idle"),activity:empty<SolanaWalletAction>(owner?"loading":"idle"),rewards:null};
  const receiptRows=useMemo(()=>receipts.owner===owner?receipts.rows:[],[receipts,owner]);
  const activity=useMemo(()=>({...current.activity,data:current.activity.data.map(raw=>{
    const action=enrichActivityMetadata(raw,current.holdings.status==="ready"?current.holdings.data:[]);
    const receipt=findReceiptForAction(receiptRows,action);
    return projectVerifiedReceiptOutcome(action,receipt,receipt!==null&&receipts.owner===owner&&receipts.verified.has(String(receipt.receipt.contentHash)));
  })}),[current.activity,current.holdings,receiptRows,receipts,owner]);
  return <Context.Provider value={{...current,activity,receiptRows,refresh}}>{children}</Context.Provider>;
}

export function useWalletData() {
  const value=useContext(Context);
  if(!value) throw new Error("WalletDataProvider is missing");
  return value;
}
