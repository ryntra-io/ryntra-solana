"use client";

import { ArrowUpRight, SignOut, TelegramLogo } from "@phosphor-icons/react";
import type { CbCopy } from "./copy";

const BOT_URL = "https://t.me/RyntraBeta_bot";

/**
 * The cabinet's contribution to the shared shell.
 *
 * This file used to draw a whole second application chrome: its own sidebar,
 * its own logo, its own mobile top bar and its own navigation list. All of that
 * is now the shell's, identically for every workspace — see
 * `app/shell/app-shell.tsx` and the registry in `app/shell/workspaces.ts`.
 *
 * What is left is what genuinely belongs to a signed-in cabinet and to nothing
 * else: the account, the language the bot speaks, and the way out. Appearance left
 * with the 2026-08-19 decision: one global preference, one home in Settings.
 */
export function CabinetNavFooter({ c, name, statusName }: { c: CbCopy; name: string; statusName: string; lang?: string }) {
  return (
    <>
      <div className="cbs-user">
        <span className="cbs-ava" aria-hidden>{(name || "T").slice(0, 1).toUpperCase()}</span>
        <span className="cbs-user-meta">
          <b>{name}</b>
          <i>{statusName}</i>
        </span>
      </div>
      {/* Logout clears the cookie server-side and redirects, so it needs a full
          document navigation; next/link would be wrong here. */}
      <a className="cbs-logout" href="/api/session?logout=1">
        <SignOut size={15} weight="bold" /> {c.nav.logout}
      </a>
    </>
  );
}

/** The account control in the shell's top bar. */
/**
 * Who the Ryntra session belongs to, shown INSIDE the connection panel.
 *
 * It was `CabinetAccount` — the same two facts wrapped around an avatar circle,
 * rendered as the top bar's last item. That position belongs to the connection
 * control on every workspace, and an initial in a circle is an identity
 * standing where an authority should be. The facts are worth keeping; the
 * avatar is not, and neither is the position.
 */
export function CabinetIdentity({ name, statusName }: { name: string; statusName: string }) {
  return (
    <>
      <p className="rs-menu-body">{name}</p>
      <p className="rs-menu-hint">{statusName}</p>
    </>
  );
}

/** The Telegram bot, opened from the navigation footer. */
export function CabinetBotLink({ label }: { label: string }) {
  return (
    <a href={BOT_URL} target="_blank" rel="noreferrer" className="cbs-item">
      <span className="cbs-item-ic"><TelegramLogo size={17} weight="bold" /></span>
      <span>{label}</span>
      <span className="cbs-ext" aria-hidden><ArrowUpRight size={13} weight="bold" /></span>
    </a>
  );
}
