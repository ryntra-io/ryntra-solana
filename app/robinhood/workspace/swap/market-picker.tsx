"use client";

// Arcus-grade spot market picker: search + category tabs (All / Favorites / Stocks / Commodities /
// Crypto / Indices) + an info table (price, 24h change, market cap, volume) over ALL spot markets,
// with a persisted watchlist (star). Data comes straight from the Arcus overview the swap already
// fetches. Design per ryntra-design-bar: CSS vars, mono numbers, semantic change colors, no emoji.

import { useEffect, useMemo, useRef, useState } from "react";
import { Star, CaretDown, MagnifyingGlass } from "@phosphor-icons/react";

export type MarketItem = {
  ticker: string;
  name: string;
  logoUrl?: string | null;
  category?: string;
  quote?: { price?: number; changePercent24h?: number; volume24h?: number } | null;
  financials?: { marketCap?: number } | null;
};

const CATS = [
  { key: "all", label: "All" },
  { key: "favorites", label: "Favorites" },
  { key: "stocks", label: "Stocks" },
  { key: "commodities", label: "Commodities" },
  { key: "crypto", label: "Crypto" },
  { key: "indices", label: "Indices" },
] as const;
type CatKey = (typeof CATS)[number]["key"];

/** Arcus tags equities/commodities/indices; everything else (uncategorised memes/tokens) = crypto. */
function catOf(it: MarketItem): "stocks" | "commodities" | "indices" | "crypto" {
  const c = (it.category ?? "").toUpperCase();
  if (c === "EQUITIES") return "stocks";
  if (c === "COMMODITIES") return "commodities";
  if (c === "INDICES") return "indices";
  return "crypto";
}

const fmtCompact = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
};

const fmtPrice = (n: number): string => {
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n <= 0) return "0.00";
  const d = Math.min(8, Math.max(4, 2 - Math.floor(Math.log10(n))));
  return n.toFixed(d);
};

export function MarketPicker({
  items,
  value,
  onSelect,
  favorites,
  onToggleFav,
}: {
  items: MarketItem[];
  value: string;
  onSelect: (ticker: string) => void;
  favorites: Set<string>;
  onToggleFav: (ticker: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<CatKey>("all");
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = items.find((i) => i.ticker === value);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = items.filter((it) => {
      if (cat === "favorites") return favorites.has(it.ticker);
      if (cat !== "all") return catOf(it) === cat;
      return true;
    });
    if (needle) list = list.filter((it) => it.ticker.toLowerCase().includes(needle) || it.name.toLowerCase().includes(needle));
    return list.slice().sort((a, b) => {
      const fa = favorites.has(a.ticker) ? 1 : 0;
      const fb = favorites.has(b.ticker) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (b.quote?.volume24h ?? 0) - (a.quote?.volume24h ?? 0);
    });
  }, [items, cat, q, favorites]);

  return (
    <div className="mp" ref={rootRef}>
      <button className="mp-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Select market" translate="no">
        {current?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="mp-logo" src={current.logoUrl} alt="" width={24} height={24} loading="lazy" />
        ) : (
          <span className="mp-logo mp-logo-ph">{value.slice(0, 2)}</span>
        )}
        <span className="mp-trigger-main">
          <b>{value}</b>
          <span className="mp-trigger-name">{current?.name ?? "Spot"}</span>
        </span>
        <CaretDown size={14} weight="bold" className={`mp-caret${open ? " on" : ""}`} />
      </button>

      {open ? (
        <div className="mp-panel" role="dialog" aria-label="Markets">
          <div className="mp-search">
            <MagnifyingGlass size={15} weight="bold" />
            <input autoFocus placeholder="Search name, ticker…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mp-cats" role="tablist">
            {CATS.map((c) => (
              <button key={c.key} role="tab" aria-selected={cat === c.key} className={cat === c.key ? "on" : ""} onClick={() => setCat(c.key)}>
                {c.key === "favorites" ? <Star size={12} weight={cat === "favorites" ? "fill" : "regular"} /> : null}
                {c.label}
              </button>
            ))}
          </div>
          <div className="mp-head">
            <span className="mp-head-name">Name</span>
            <span className="mp-num">Price</span>
            <span className="mp-num mp-hide-sm">24h</span>
            <span className="mp-num mp-hide-sm">Mkt cap</span>
            <span className="mp-num">Volume</span>
          </div>
          <div className="mp-list" translate="no">
            {rows.length === 0 ? (
              <p className="mp-empty">No markets{q ? " match your search" : cat === "favorites" ? " — star a market to add it" : ""}.</p>
            ) : (
              rows.map((it) => {
                const chg = it.quote?.changePercent24h;
                const fav = favorites.has(it.ticker);
                return (
                  <button key={it.ticker} className={`mp-row${it.ticker === value ? " on" : ""}`} onClick={() => { onSelect(it.ticker); setOpen(false); }}>
                    <span
                      className="mp-star"
                      role="button"
                      tabIndex={-1}
                      aria-label={fav ? "Remove from watchlist" : "Add to watchlist"}
                      onClick={(e) => { e.stopPropagation(); onToggleFav(it.ticker); }}
                    >
                      <Star size={14} weight={fav ? "fill" : "regular"} className={fav ? "on" : ""} />
                    </span>
                    {it.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="mp-logo" src={it.logoUrl} alt="" width={22} height={22} loading="lazy" />
                    ) : (
                      <span className="mp-logo mp-logo-ph">{it.ticker.slice(0, 2)}</span>
                    )}
                    <span className="mp-name">
                      <b>{it.ticker}</b>
                      <i>{it.name}</i>
                    </span>
                    <span className="mp-num mp-price">{it.quote?.price != null ? `$${fmtPrice(it.quote.price)}` : "—"}</span>
                    <span className={`mp-num mp-hide-sm mp-chg ${chg == null ? "" : chg >= 0 ? "up" : "down"}`}>
                      {chg == null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}
                    </span>
                    <span className="mp-num mp-hide-sm">{it.financials?.marketCap ? `$${fmtCompact(it.financials.marketCap)}` : "—"}</span>
                    <span className="mp-num">{it.quote?.volume24h ? `$${fmtCompact(it.quote.volume24h)}` : "—"}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
