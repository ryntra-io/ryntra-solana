"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import company from "@/app/app/stocks/[ticker]/company.module.css";
import type { SlimStockRow } from "@/app/app/stocks/stock-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import type { SpotMarketListRow } from "@/lib/spot/markets";
import { isRetiredMint } from "@/lib/stocks/retired";
import type { ShelfCard } from "@/lib/stocks/shelf";

import block from "./autoinvest.module.css";
import styles from "./invest.module.css";
import { investWords } from "./invest-words";

/** A token a rule may be written for: a company, or (1.31.0) a coin, a meme or a new token of the venue's list. */
export type RulePick = Readonly<{ mint: string; name: string; icon: string | null; ticker: string; price: number | null; token: boolean }>;

type Found = Readonly<{ status: "idle" | "searching" | "ready" | "failed"; companies: readonly RulePick[]; tokens: readonly RulePick[] }>;

const IDLE: Found = { status: "idle", companies: [], tokens: [] };

/**
 * «Для якого токена?» — the one way to a recurring-buy rule (SOL-C15, UX-701): what the wallet holds, the popular
 * companies this browser drew, and a search over the rest — the confirmed companies and the venue's verified coins and
 * memes (the same two reads the plan builder searches; a pre-IPO instrument stays on its own page, where its notice is). A press opens the rule's own sheet on that token; no step leads
 * through Markets any more. Only what a rule can name is offered — a company the issuer still sells, a token never
 * flagged as a copy; the server judges the floor ($25,000 of liquidity and a day on the market for a meme) as before.
 */
export function RuleTokenPicker({ open, locale, owned, popular, onClose, onPick }: { open: boolean; locale: WorkspaceLocale; owned: readonly RulePick[]; popular: readonly ShelfCard[]; onClose: () => void; onPick: (pick: RulePick) => void }) {
  const word = investWords(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found>(IDLE);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) {
      setQuery("");
      setFound(IDLE);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setFound(IDLE);
      return undefined;
    }
    let live = true;
    setFound((current) => ({ ...current, status: "searching" }));
    const timer = window.setTimeout(() => {
      const term = encodeURIComponent(q.slice(0, 64));
      const companies = fetch(`/api/stocks/universe?shape=slim&q=${term}&limit=8`, { headers: { accept: "application/json" } })
        .then(async (response) => (response.ok ? ((await response.json()) as { rows: SlimStockRow[] }).rows : null))
        .catch(() => null);
      const tokens = fetch(`/api/spot/markets?q=${term}&limit=16`, { headers: { accept: "application/json" } })
        .then(async (response) => (response.ok ? ((await response.json()) as { rows: SpotMarketListRow[] }).rows : null))
        .catch(() => null);
      void Promise.all([companies, tokens]).then(([companyRows, tokenRows]) => {
        if (!live) return;
        if (companyRows === null && tokenRows === null) {
          setFound({ status: "failed", companies: [], tokens: [] });
          return;
        }
        setFound({
          status: "ready",
          companies: (companyRows ?? [])
            /* A pre-IPO instrument's rule is written on its own page, under the notice of what it is; a halted one buys nothing. */
            .filter((row) => row.tradable && !row.halted && row.kind !== "pre-ipo" && !isRetiredMint(row.mint))
            .map((row) => ({ mint: row.mint, name: row.name, icon: row.icon, ticker: row.symbol, price: row.price, token: false })),
          tokens: (tokenRows ?? [])
            .filter((row) => row.verified && !row.suspicious && (row.category === "crypto" || row.category === "meme") && !isRetiredMint(row.mint))
            .slice(0, 8)
            .map((row) => ({ mint: row.mint, name: row.symbol, icon: row.icon, ticker: row.symbol, price: row.price, token: true })),
        });
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  /* At rest: what the wallet holds, then the popular companies; a search replaces both with what it found. */
  const rested = useMemo(() => {
    const seen = new Set<string>();
    const rows: { pick: RulePick; group: string }[] = [];
    for (const row of owned) {
      if (seen.has(row.mint)) continue;
      seen.add(row.mint);
      rows.push({ pick: row, group: word("yourCompanies") });
    }
    for (const card of popular) {
      if (seen.has(card.mint)) continue;
      seen.add(card.mint);
      rows.push({ pick: { mint: card.mint, name: card.name, icon: card.icon, ticker: card.ticker, price: card.price, token: false }, group: word("popularCompanies") });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a pure function of the locale
  }, [owned, popular, locale]);
  const searched = query.trim().length > 0;
  const rows = searched ? [...found.companies.map((pick) => ({ pick, group: word("foundCompanies") })), ...found.tokens.map((pick) => ({ pick, group: word("foundTokens") }))] : rested;

  return (
    <dialog
      ref={dialog}
      className={company.sheet}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className={company.sheetBody} data-sheet="pick-token">
          <div className={`${company.sheetHead} ${company.sheetHeadPlain}`}>
            <span className={company.grab} aria-hidden="true" />
            <h2 id={titleId} className={company.sheetTitle}>
              {word("pickToken")}
            </h2>
            <button type="button" className={company.sheetClose} onClick={onClose} aria-label={word("close")}>
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <input
            type="search"
            className={block.pickSearch}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={word("findToken")}
            aria-label={word("findToken")}
            autoComplete="off"
            spellCheck={false}
            lang={locale === "uk" ? "uk" : "en"}
          />
          {searched && found.status === "failed" ? (
            <p className={company.sheetNote} role="status">
              {word("searchDown")}
            </p>
          ) : searched && rows.length === 0 ? (
            <p className={company.sheetNote} role="status" aria-busy={found.status === "searching"}>
              {found.status === "ready" ? word("nothingMatches") : word("searchingTokens")}
            </p>
          ) : rows.length > 0 ? (
            <ul className={block.picks} data-stale={searched && found.status === "searching" ? "true" : undefined}>
              {rows.map(({ pick, group }, index) => (
                <li key={`${group}:${pick.mint}`}>
                  {index === 0 || rows[index - 1].group !== group ? <p className={block.pickGroup}>{group}</p> : null}
                  <button type="button" className={block.pick} onClick={() => onPick(pick)}>
                    <MarketIcon mint={pick.mint} icon={pick.icon} symbol={pick.name} size={32} className={styles.rowLogo} />
                    <span className={block.pickName}>{pick.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={company.sheetNote}>{word("findHint")}</p>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
