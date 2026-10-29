"use client";

import { Page } from "@ryntra/core/ui";
import Link from "next/link";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { SolanaConnectionControl, useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { openCustomize } from "../customize-open";
import { AccountSettings } from "./account-settings";

/**
 * «Акаунт» — one column in the middle of the canvas, the core's action page (SOL-C19; UX-015): the wallet, then the
 * account and its notifications, then the look. A guest meets one orange action — «Підключити гаманець», the same
 * words at every width — and the sign-in, secondary, under a line that says what it keeps.
 */
export function ProductSettings({signedIn,name}:{signedIn:boolean;name:string|null}) {
  const {locale}=useSolanaI18n(); const uk=locale==="uk";
  const {connection}=useSolanaConnection();
  return <Page kind="action" className="ry-settings-page" title={uk?"Акаунт":"Account"} lang={uk?"uk":"en"}>
    <section className="ry-settings-section" aria-labelledby="wallet-title">
      <h2 id="wallet-title" className="ry-section-title">{uk?"Гаманець":"Wallet"}</h2>
      <div className="ry-settings-row"><span className="ry-muted">{connection?connection.wallet:(uk?"Не підключено":"Not connected")}</span>{connection?<SolanaConnectionControl />:<ConnectWalletButton />}</div>
      <div className="ry-settings-row"><span>{uk?"Мережа":"Network"}</span><span>Solana</span></div>
    </section>
    <section id="account" className="ry-settings-section" aria-labelledby="account-title">
      <h2 id="account-title" className="ry-section-title">{uk?"Акаунт і сповіщення":"Account and notifications"}</h2>
      {/* The account is the wallet that signed. Its wallets, the Telegram
          channel and the session controls are owned by AccountSettings below. */}
      {signedIn?<div className="ry-settings-row"><span className="ry-muted">{uk?"Стан":"Status"}</span><span>{uk?"Вхід виконано":"Signed in"}{name?` · ${name}`:""}</span></div>:null}
      <AccountSettings />
      <div className="ry-settings-row">
        <span>{uk ? "Сповіщення" : "Notifications"}</span>
        <Link className="ry-action-link" href="/app/alerts">{uk ? "Де нотатки й тихі години" : "Notes and quiet hours"}</Link>
      </div>
    </section>
    {/* The theme and the language live in one place, the menu's «Налаштування» (UX-013): here, one row that opens it. */}
    <section className="ry-settings-section" aria-labelledby="appearance-title">
      <div className="ry-settings-row"><span id="appearance-title">{uk?"Тема й мова":"Theme and language"}</span>
        <button type="button" className="ry-settings-option" aria-haspopup="dialog" onClick={()=>openCustomize()}>{uk?"Налаштування":"Settings"}</button>
      </div>
    </section>
    <div className="ry-inline-actions"><Link className="ry-action-link" href="/legal/privacy">{uk?"Приватність":"Privacy"}</Link><Link className="ry-action-link" href="/legal/terms">{uk?"Умови":"Terms"}</Link><Link className="ry-action-link" href="/docs">{uk?"Допомога":"Help"}</Link></div>
  </Page>;
}
