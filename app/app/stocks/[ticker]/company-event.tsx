"use client";

import { HourglassMedium } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { useWalletData } from "@/app/app/wallet-data";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { openSolanaConnection } from "@/app/solana/workspace/connection-trigger.client";

import company from "./company.module.css";
import { ConvertSheet, useConvertSheet, type ConvertMode, type ConvertTarget } from "./convert-sheet";

/** A token's issuer event as the page read it — the words already in the reader's language, the swap's facts for the sheet. */
export type CompanyEventFacts = Readonly<{
  /** The event line for a holder, and for everyone else. */
  lines: Readonly<{ holder: string; everyone: string }>;
  /** The swap window is open now. */
  open: boolean;
  /** «Обміняти на SpaceX (SPCXx)»; null when the issuer names no target Ryntra offers. */
  swapWord: string | null;
  /** «Продати за USDC». */
  sellWord: string;
  deadline: string;
  noticeUrl: string;
  mechanicsUrl: string | null;
  into: ConvertTarget | null;
}>;

export type CompanyToken = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number | null;
  multiplier: number | null;
  issuerFeeBps: number | null;
}>;

const RAW = /^\d+$/;

/** Whether the connected wallet holds some of a mint, as the wallet's own read says; false until it has been read. */
export function useHolds(mint: string): boolean {
  const { holdings } = useWalletData();
  if (holdings.status !== "ready") return false;
  const row = holdings.data.find((entry) => entry.mint === mint);
  return !!row && RAW.test(row.amountRaw) && BigInt(row.amountRaw) > 0n;
}

/**
 * A private company's truth before any figure, and — the IPO and conversion
 * watch — the issuer's event in the same box: everyone reads that the token
 * must be swapped by the issuer's deadline; a holder reads «Обміняй SPACEX до
 * 12 березня 2027 — після строку токен згорить.» and, right under it, the one
 * action «Обміняти на SpaceX (SPCXx)» and the quiet «Продати за USDC», each
 * opening the swap's sheet. A note's link (`?convert=1`, from the inbox, the
 * bell or Telegram) opens the swap on arrival. Where «Шлях компанії» stands
 * on the page, the event is the strip's own line (`PathEvent`) and the box
 * keeps the truth alone.
 */
export function CompanyWarning({ truth, notice, event, token, locale }: Readonly<{ truth: string; notice: string | null; event: CompanyEventFacts | null; token: CompanyToken; locale: WorkspaceLocale }>) {
  const holder = useHolds(token.mint);
  return (
    <>
      <div className={company.warning}>
        <p data-company-truth>{truth}</p>
        {notice ? (
          <p className={company.warningNote} data-company-notice>
            {notice}
          </p>
        ) : null}
        {event ? (
          <p className={company.warningEvent} data-company-event={holder ? "holder" : "everyone"}>
            <HourglassMedium size={16} weight="bold" aria-hidden="true" />
            <span>{holder ? event.lines.holder : event.lines.everyone}</span>
          </p>
        ) : null}
      </div>
      {event ? <EventSwap event={event} token={token} holder={holder} locale={locale} /> : null}
    </>
  );
}

/**
 * «Шлях компанії»'s line on the private token's own page: the swap's deadline
 * with the issuer's minute under the steps — «Власникам SPACEX: обміняти на
 * SPCXx до 12.03.2027, 23:59 UTC …» for everyone, «Обміняй SPACEX на SPCXx …»
 * for a holder — and, for a holder, the swap and the sale right under it.
 */
export function PathEvent({ event, token, locale }: Readonly<{ event: CompanyEventFacts; token: CompanyToken; locale: WorkspaceLocale }>) {
  const holder = useHolds(token.mint);
  return (
    <div className={company.pathEvent}>
      <p className={company.pathSwap} data-company-event={holder ? "holder" : "everyone"} data-path-swap={event.open ? "open" : "closed"}>
        <HourglassMedium size={16} weight="bold" aria-hidden="true" />
        <span>{holder ? event.lines.holder : event.lines.everyone}</span>
      </p>
      <EventSwap event={event} token={token} holder={holder} locale={locale} />
    </div>
  );
}

/** A holder's one action and the quiet second, and the swap's sheet they open — a note's `?convert=1` opens it on arrival. */
function EventSwap({ event, token, holder, locale }: Readonly<{ event: CompanyEventFacts; token: CompanyToken; holder: boolean; locale: WorkspaceLocale }>) {
  const { connection } = useSolanaConnection();
  const sheet = useConvertSheet();
  const { openSheet, close } = sheet;

  /* A wallet connected for the swap: the sheet comes back as it was — within a minute and a half, never later. */
  const [resume, setResume] = useState<ConvertMode | null>(null);
  const connectFirst = useCallback(() => {
    setResume(sheet.mode);
    close();
    window.requestAnimationFrame(() => openSolanaConnection());
  }, [sheet.mode, close]);
  useEffect(() => {
    if (!resume) return undefined;
    if (connection) {
      openSheet(resume);
      setResume(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setResume(null), 90_000);
    return () => window.clearTimeout(timer);
  }, [resume, connection, openSheet]);

  return (
    <>
      {holder ? (
        <div className={company.eventActions} data-company-event-actions>
          {event.open && event.swapWord && event.into ? (
            <button type="button" className="rw-btn rw-btn--primary" aria-haspopup="dialog" data-swap-open={sheet.mode === "swap" ? "true" : undefined} onClick={() => openSheet("swap")}>
              {event.swapWord}
            </button>
          ) : null}
          <button type="button" className={company.quietButton} aria-haspopup="dialog" onClick={() => openSheet("sell")}>
            {event.sellWord}
          </button>
        </div>
      ) : null}
      <ConvertSheet
        open={sheet.mode !== null}
        mode={sheet.mode === "swap" && event.open && event.into ? "swap" : "sell"}
        onClose={close}
        onConnect={connectFirst}
        {...token}
        into={event.into}
        deadline={event.deadline}
        noticeUrl={event.noticeUrl}
        mechanicsUrl={event.mechanicsUrl}
        locale={locale}
      />
    </>
  );
}
