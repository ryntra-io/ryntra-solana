"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { SolanaConnectionControl, useSolanaConnection } from "@/app/solana/workspace/connection";
import { applyThemePref, getThemePref, type ThemePref } from "../theme";
import { AccountSettings } from "./account-settings";

export function ProductSettings({signedIn,name}:{signedIn:boolean;name:string|null}) {
  const {locale,setLocale}=useSolanaI18n(); const uk=locale==="uk";
  const {connection}=useSolanaConnection();
  const [theme,setTheme]=useState<ThemePref|null>(null);
  useEffect(()=>{setTheme(getThemePref());const observer=new MutationObserver(()=>setTheme(getThemePref()));observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});return()=>observer.disconnect();},[]);
  return <div className="ry-account-settings ry-settings-board">
    <h1>{uk?"Налаштування":"Settings"}</h1>
    <section className="ry-settings-section" data-area="appearance" aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="ry-section-title">{uk?"Вигляд":"Appearance"}</h2>
      <div className="ry-settings-row"><span>{uk?"Тема":"Theme"}</span><div className="ry-settings-options" role="group" aria-label={uk?"Тема":"Theme"}>
        {(["dark","light"] as const).map(value=><button key={value} className="ry-settings-option" disabled={theme===null} aria-pressed={theme===value} onClick={()=>{applyThemePref(value);setTheme(value);}}>{value==="dark"?(uk?"Темна":"Dark"):(uk?"Світла":"Light")}</button>)}
      </div></div>
      <div className="ry-settings-row"><span>{uk?"Мова":"Language"}</span><div className="ry-settings-options" role="group" aria-label={uk?"Мова":"Language"}>
        <button className="ry-settings-option" disabled={theme===null} aria-pressed={locale==="uk"} onClick={()=>setLocale("uk")}>Українська</button>
        <button className="ry-settings-option" disabled={theme===null} aria-pressed={locale==="en"} onClick={()=>setLocale("en")}>English</button>
      </div></div>
    </section>
    <section className="ry-settings-section" data-area="wallet" aria-labelledby="wallet-title">
      <h2 id="wallet-title" className="ry-section-title">{uk?"Гаманець":"Wallet"}</h2>
      <div className="ry-settings-row"><span className="ry-muted">{connection?connection.wallet:(uk?"Не підключено":"Not connected")}</span><SolanaConnectionControl /></div>
      <div className="ry-settings-row"><span>{uk?"Мережа":"Network"}</span><span>Solana Mainnet</span></div>
    </section>
    <section id="account" className="ry-settings-section" data-area="account" aria-labelledby="account-title">
      <h2 id="account-title" className="ry-section-title">{uk?"Гаманці й сповіщення":"Wallets & notifications"}</h2>
      {/* The account is the wallet that signed. Its wallets, the Telegram
          channel and the session controls are owned by AccountSettings below. */}
      {signedIn?<div className="ry-settings-row"><span className="ry-muted">{uk?"Стан":"Status"}</span><span>{uk?"Вхід виконано":"Signed in"}{name?` · ${name}`:""}</span></div>:null}
      <div className="ry-settings-row">
        <span>{uk ? "Нагляд" : "Monitoring"}</span>
        <Link className="ry-action-link" href="/app/alerts">{uk ? "Де нотатки й тихі години" : "Notes and quiet hours"}</Link>
      </div>
      <AccountSettings />
    </section>
    <div className="ry-inline-actions"><Link className="ry-action-link" href="/legal/privacy">{uk?"Приватність":"Privacy"}</Link><Link className="ry-action-link" href="/legal/terms">{uk?"Умови":"Terms"}</Link><Link className="ry-action-link" href="/docs">{uk?"Допомога":"Help"}</Link></div>
  </div>;
}
