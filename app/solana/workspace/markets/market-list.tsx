"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { useSolanaI18n } from "../i18n/provider";
import styles from "./market-list.module.css";

export type MarketRow={mint:string;symbol:string;name:string|null;price:string|null;swapHref:string};
export function MarketList({rows,available}:{rows:readonly MarketRow[];available:boolean}) {
  const {locale}=useSolanaI18n(); const uk=locale==="uk";
  const [query,setQuery]=useState("");
  const needle=query.trim().toLowerCase();
  const filtered=rows.filter(r=>[r.symbol,r.name??"",r.mint].some(v=>v.toLowerCase().includes(needle)));
  return <section className={styles.markets} aria-label={uk?"Активи":"Assets"}>
    {/* Search, and nothing beside it. The primary button that stood here went to
        Swap — which is a row of the rail and the destination of every row in the
        table below it, so on Trends it was a third way to say the same thing and
        the only loud element on a page about looking rather than trading. Canon
        14.1: one main action per working screen. */}
    <div className={styles.tools}><label htmlFor="market-search" className="sr-only">{uk?"Пошук активів":"Search assets"}</label><input id="market-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={uk?"Знайти актив":"Search assets"} type="search" autoComplete="off"/></div>
    {!available?<p className={styles.note} role="status">{uk?"Ціни тимчасово недоступні":"Prices are temporarily unavailable"}</p>:null}
    <table className={styles.table}><thead><tr><th>{uk?"Актив":"Asset"}</th><th>{uk?"Ціна":"Price"}</th><th><span className="sr-only">{uk?"Дії":"Actions"}</span></th></tr></thead><tbody>{filtered.map(row=><tr key={row.mint}>
      <td><Link className={styles.name} href={`/app/assets?mint=${row.mint}`}><strong>{row.symbol}</strong><span>{row.name}</span></Link></td>
      <td className={styles.price}>{row.price??"—"}</td>
      <td><Link className={styles.trade} href={row.swapHref} aria-label={`${uk?"Обміняти":"Swap"} ${row.symbol}`}><span>{uk?"Обмін":"Swap"}</span><ArrowUpRight size={18} aria-hidden /></Link></td>
    </tr>)}</tbody></table>
    {filtered.length===0?<p className={styles.note}>{uk?"Нічого не знайдено":"No assets found"}</p>:null}
  </section>;
}
