"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Trash } from "@phosphor-icons/react";
import { usePassportDirectory } from "@/app/agents/workspace/passport-directory-store";
import { agentPassportDisplayName, agentPassportSearchText } from "@/lib/agent-control/agent-capability";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import styles from "./agents.module.css";

export function AgentDirectory() {
  const {records,ready,remove,retention}=usePassportDirectory();
  const {locale}=useSolanaI18n();const uk=locale==="uk";
  const [query,setQuery]=useState("");
  const visible=records.filter(r=>agentPassportSearchText(r).toLowerCase().includes(query.trim().toLowerCase()));
  return <div className={styles.page}>
    <header className={styles.header}><h1>{uk?"Агенти":"Agents"}</h1><Link className="rw-btn rw-btn--primary" href="/app/agents/inspect">{uk?"Переглянути агента":"Inspect an agent"}</Link></header>
    <input className={styles.search} type="search" aria-label={uk?"Пошук агентів":"Search agents"} placeholder={uk?"Знайти агента":"Search agents"} value={query} onChange={e=>setQuery(e.target.value)}/>
    {!ready?<p className={styles.empty} role="status">{uk?"Завантаження…":"Loading…"}</p>:visible.length===0?<p className={styles.empty}>{query?(uk?"Нічого не знайдено":"No agents found"):(uk?"Збережених переглядів ще немає":"No saved inspections yet")}</p>:
    <ul className={styles.directory}>{visible.map(record=><li key={record.request.address}>
      <Link href={`/app/agents/inspect?address=${record.request.address}`}><strong>{agentPassportDisplayName(record)}</strong><span>{record.request.address.slice(0,12)}…{record.request.address.slice(-6)}</span></Link>
      <time dateTime={record.createdAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium"}).format(new Date(record.createdAt))}</time>
      {record.conflicts.length>0?<span className={styles.notice}>{uk?"Є розбіжності":"Conflicting information"}</span>:null}
      <button className={styles.iconButton} onClick={()=>remove(record.request.address)} aria-label={`${uk?"Прибрати зі списку":"Remove from list"}: ${agentPassportDisplayName(record)}`}><Trash size={18} aria-hidden /></button>
    </li>)}</ul>}
    {records.length>0?<p className={styles.meta}>{retention==="SESSION"?(uk?"Збережено в цій вкладці":"Saved in this tab"):(uk?"Збережено до перезавантаження":"Saved until reload")}</p>:null}
    <Link className={styles.toolLink} href="/app/agents/verify">{uk?"Перевірити файл":"Verify a file"}<ArrowUpRight size={18} aria-hidden /></Link>
  </div>;
}
