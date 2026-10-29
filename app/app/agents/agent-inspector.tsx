"use client";

import { Page } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AgentPassport } from "@/lib/agent-control/agent-passport";
import { agentPassportDisplayName } from "@/lib/agent-control/agent-capability";
import { loadAgentPassport, AgentApiError } from "@/app/agents/agent-control-client";
import { usePassportDirectory } from "@/app/agents/workspace/passport-directory-store";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import styles from "./agents.module.css";

const ADDRESS=/^agent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{59}$/;
export function AgentInspector() {
  const {locale}=useSolanaI18n();const uk=locale==="uk";
  const params=useSearchParams();const initial=params.get("address")??"";
  const {remember}=usePassportDirectory();
  const [address,setAddress]=useState(initial),[passport,setPassport]=useState<AgentPassport|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const request=useRef<AbortController|null>(null),initialRead=useRef<string|null>(null);
  const inspect=useCallback(async(value:string)=>{
    request.current?.abort();setPassport(null);setError(null);
    const exact=value.trim();
    if(!ADDRESS.test(exact)){setError(uk?"Вкажи адресу агента Agentverse":"Enter an Agentverse agent address");setBusy(false);return;}
    const controller=new AbortController();request.current=controller;setBusy(true);
    try {const result=await loadAgentPassport(exact,controller.signal);if(request.current!==controller)return;
      const saved=await remember(result);if(request.current!==controller)return;
      if(saved==="REJECTED")throw new Error("INVALID_RECORD");
      setPassport(result);window.history.replaceState(null,"",`/app/agents/inspect?address=${encodeURIComponent(exact)}`);
    } catch(problem) {if(request.current!==controller||controller.signal.aborted)return;setError(problem instanceof AgentApiError&&problem.status===429?(uk?"Забагато запитів. Спробуй трохи пізніше.":"Too many requests. Try again shortly."):(uk?"Не вдалося перевірити агента. Спробуй ще раз.":"Could not inspect this agent. Try again."));}
    finally{if(request.current===controller)setBusy(false);}
  },[remember,uk]);
  useEffect(()=>{if(initial&&initialRead.current!==initial){initialRead.current=initial;void inspect(initial);}},[initial,inspect]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const sourceLabel=(kind:string)=>({REGISTRY:uk?"Реєстрація":"Registration",SEARCH:uk?"Профіль":"Profile",MANIFESTS:uk?"Протоколи":"Protocols"})[kind]??kind;
  const availability=(state:string)=>state==="AVAILABLE"?(uk?"Дані отримано":"Available"):state==="PARTIAL"?(uk?"Частково":"Partial"):state==="NOT_FOUND"?(uk?"Не знайдено":"Not found"):(uk?"Недоступно":"Unavailable");
  const description=passport?.providerClaims.find(f=>f.field==="description");
  /* A form: the core's action column in the middle of the canvas, the way back above it (SOL-C19). */
  return <Page kind="action" className={styles.actionPage} title={uk?"Перегляд агента":"Inspect an agent"} lang={uk?"uk":"en"}>
    <Link className={styles.back} href="/app/agents">← {uk?"До агентів":"Back to agents"}</Link>
    <form className={styles.form} onSubmit={e=>{e.preventDefault();void inspect(address);}}><label htmlFor="agent-address">{uk?"Адреса в Agentverse":"Agentverse address"}</label><div><input id="agent-address" value={address} onChange={e=>{request.current?.abort();request.current=null;setAddress(e.target.value);setPassport(null);setError(null);setBusy(false);}} placeholder="agent1…" autoComplete="off" spellCheck={false}/><button className="rw-btn rw-btn--primary" disabled={busy} type="submit">{busy?(uk?"Перевірка…":"Reading…"):(uk?"Переглянути":"Inspect")}</button></div></form>
    {error?<p className={styles.notice} role="alert">{error}</p>:null}
    {passport?<article className={styles.record}><header><h2>{agentPassportDisplayName(passport)}</h2><span className={styles.meta}>Agentverse</span></header>
      {description?<p className={styles.description}>{String(description.value).slice(0,500)}</p>:null}
      <p className={styles.meta}>{uk?"Оновлено":"Updated"} {new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(passport.createdAt))}</p>
      <dl className={styles.facts}>{passport.sources.map(source=><div key={source.kind}><dt>{sourceLabel(source.kind)}</dt><dd>{availability(source.availability)}</dd></div>)}</dl>
      {passport.conflicts.length>0?<p className={styles.notice}>{uk?"Джерела містять суперечливі дані":"Sources contain conflicting information"}</p>:null}
      {passport.unknowns.length>0?<p className={styles.meta}>{uk?"Деякі відомості не підтверджено":"Some information could not be confirmed"}</p>:null}
      <p className={styles.meta}>{uk?"Перегляд публічних даних. Доступ до агента не надається.":"Public information only. This does not grant access to the agent."}</p>
    </article>:null}
  </Page>;
}
