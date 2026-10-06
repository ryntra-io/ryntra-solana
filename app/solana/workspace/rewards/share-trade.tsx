"use client";

import { ArrowClockwise, CaretLeft, Check, Copy, ShareNetwork, TelegramLogo, X, XLogo } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cardDate, cardPercent, cardPrice, cardWords, type CardLocale } from "@/lib/growth/card-copy";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import styles from "./share.module.css";

/**
 * «Поділитися» — a card of the person's own trade for X, with their
 * invitation link.
 *
 * One component for every place a trade lives: on a token's page it offers
 * the trades of that token (`mint`), in Portfolio all of them. Its words say
 * what is shared — a trade, never the token. It draws
 * nothing until it has something to offer — no wallet, no proof, or no
 * measured trade is no button rather than a button that leads to «nothing
 * here». Quiet by design: the page's one orange action stays the page's;
 * inside the sheet the one orange action is «Post on X».
 *
 * The sheet lists the trades newest first — losses with gains, there is no
 * filter for wins — and a chosen trade becomes a card on the server from the
 * receipts; the dollar amounts are off until the person turns them on.
 */

type Trade = Readonly<{
  key: string;
  kind: "SELL" | "BUY";
  mint: string;
  symbol: string;
  at: string;
  resultBps: number | null;
  costMicros: string;
  proceedsMicros: string | null;
  quantityRaw: string;
  decimals: number | null;
}>;

type Made = Readonly<{ id: string; url: string; image: string; text: string; alt: string }>;

type ListState = { status: "idle" | "none" } | { status: "ready"; trades: readonly Trade[]; complete: boolean };
type CardState = { status: "drawing" } | { status: "ready"; card: Made } | { status: "failed" };

export function ShareTrade({ mint = null, align }: Readonly<{ mint?: string | null; align?: "end" }>) {
  const { connection } = useSolanaConnection();
  const { locale: uiLocale } = useSolanaI18n();
  const locale: CardLocale = uiLocale === "uk" ? "uk" : "en";
  const word = cardWords(locale);
  const address = connection?.address ?? null;
  const [list, setList] = useState<ListState>({ status: "idle" });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setList({ status: "idle" });
    if (!address) return;
    let live = true;
    void (async () => {
      try {
        const query = new URLSearchParams({ address });
        if (mint) query.set("mint", mint);
        const response = await fetch(`/api/growth/cards?${query}`, { headers: { accept: "application/json" } });
        /* 401 is a wallet that has not proved itself: no button, not an error. */
        if (!response.ok) {
          if (live) setList({ status: "none" });
          return;
        }
        const body = (await response.json()) as { trades?: Trade[]; complete?: boolean };
        if (!live) return;
        const trades = Array.isArray(body.trades) ? body.trades : [];
        setList(trades.length > 0 ? { status: "ready", trades, complete: body.complete !== false } : { status: "none" });
      } catch {
        if (live) setList({ status: "none" });
      }
    })();
    return () => {
      live = false;
    };
  }, [address, mint]);

  if (!address || list.status !== "ready") return null;

  return (
    <>
      <button
        type="button"
        className={`rw-btn ${styles.button}${align === "end" ? ` ${styles.end}` : ""}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-share-trade
      >
        <ShareNetwork size={16} weight="bold" aria-hidden="true" />
        {word.shareTrade}
      </button>
      <ShareSheet open={open} onClose={() => setOpen(false)} address={address} trades={list.trades} complete={list.complete} locale={locale} />
    </>
  );
}

function ShareSheet({
  open,
  onClose,
  address,
  trades,
  complete,
  locale,
}: Readonly<{ open: boolean; onClose: () => void; address: string; trades: readonly Trade[]; complete: boolean; locale: CardLocale }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const word = cardWords(locale);
  /* One trade needs no list: the sheet opens on its card. */
  const [chosen, setChosen] = useState<Trade | null>(trades.length === 1 ? trades[0] : null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) setChosen(trades.length === 1 ? trades[0] : null);
  }, [open, trades]);

  useEffect(() => {
    if (!open) return undefined;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby={titleId}
      data-share-sheet
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
        <div className={styles.body}>
          <div className={styles.head}>
            {chosen && trades.length > 1 ? (
              <button type="button" className={styles.headButton} onClick={() => setChosen(null)} aria-label={word.back} title={word.back}>
                <CaretLeft size={18} weight="bold" aria-hidden="true" />
              </button>
            ) : null}
            <h2 id={titleId} className={styles.title}>
              {word.shareTrade}
            </h2>
            <button type="button" className={styles.headButton} onClick={onClose} aria-label={word.close} title={word.close}>
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <p className={styles.lead}>{word.sheetLead}</p>
          {/* A history that could not be read whole would put a wrong average cost on a card: none is offered until it reads whole. */}
          {!complete ? (
            <p className={styles.lead} role="status">
              {word.unreadable}
            </p>
          ) : chosen ? (
            <CardStep key={chosen.key} address={address} trade={chosen} locale={locale} />
          ) : (
            <TradeList trades={trades} locale={locale} onChoose={setChosen} />
          )}
        </div>
      ) : null}
    </dialog>
  );
}

/** A sale's result; a buy's price per token — never an amount, as the card shows none until asked. */
function tradeFigure(trade: Trade, locale: CardLocale): string {
  if (trade.kind === "SELL" && trade.resultBps !== null) return cardPercent(trade.resultBps, locale);
  const quantity = BigInt(trade.quantityRaw);
  if (trade.decimals === null || quantity <= 0n) return "";
  const price = Number(BigInt(trade.costMicros)) / 1_000_000 / (Number(quantity) / 10 ** trade.decimals);
  return price > 0 ? cardPrice(price, locale) : "";
}

function TradeList({ trades, locale, onChoose }: Readonly<{ trades: readonly Trade[]; locale: CardLocale; onChoose: (trade: Trade) => void }>) {
  const word = cardWords(locale);
  return (
    <section aria-label={word.listLabel}>
      <h3 className={styles.listLabel}>{word.listLabel}</h3>
      <ul className={styles.list}>
        {trades.map((trade) => {
          const tone = trade.kind === "SELL" && trade.resultBps !== null ? (trade.resultBps > 0 ? "up" : trade.resultBps < 0 ? "down" : undefined) : undefined;
          return (
            <li key={trade.key}>
              <button type="button" className={styles.trade} onClick={() => onChoose(trade)}>
                <span className={styles.tradeName}>
                  <span className={styles.tradeSymbol} translate="no">
                    {trade.symbol}
                  </span>
                  <span className={styles.tradeMeta}>
                    {word.kind[trade.kind]} · {cardDate(trade.at, locale)}
                  </span>
                </span>
                <span className={styles.tradeFigure} data-tone={tone} translate="no">
                  {tradeFigure(trade, locale)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CardStep({ address, trade, locale }: Readonly<{ address: string; trade: Trade; locale: CardLocale }>) {
  const word = cardWords(locale);
  const [amounts, setAmounts] = useState(false);
  const [state, setState] = useState<CardState>({ status: "drawing" });
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const amountsId = useId();

  const make = useCallback(async (withAmounts: boolean) => {
    setState({ status: "drawing" });
    setLoaded(false);
    try {
      const response = await fetch("/api/growth/cards", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ address, trade: trade.key, locale, amounts: withAmounts }),
      });
      const body = (await response.json().catch(() => null)) as { card?: Made } | null;
      if (!response.ok || !body?.card) {
        setState({ status: "failed" });
        return;
      }
      setState({ status: "ready", card: body.card });
    } catch {
      setState({ status: "failed" });
    }
  }, [address, trade.key, locale]);

  useEffect(() => {
    void make(amounts);
  }, [make, amounts]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const card = state.status === "ready" ? state.card : null;
  const xHref = card ? `https://x.com/intent/post?text=${encodeURIComponent(card.text)}&url=${encodeURIComponent(card.url)}` : undefined;
  const tgHref = card ? `https://t.me/share/url?url=${encodeURIComponent(card.url)}&text=${encodeURIComponent(card.text)}` : undefined;

  return (
    <div className={styles.step}>
      <div className={styles.preview} data-state={state.status === "failed" ? "failed" : card && loaded ? "ready" : "drawing"} aria-busy={!(card && loaded)}>
        {card ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={card.image} src={card.image} alt={card.alt} width={1200} height={630} onLoad={() => setLoaded(true)} onError={() => setState({ status: "failed" })} />
        ) : null}
        {state.status === "failed" ? (
          <p className={styles.previewNote} role="alert">
            {word.failed}{" "}
            <button type="button" className={styles.retry} onClick={() => void make(amounts)} aria-label={word.retry} title={word.retry}>
              <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
            </button>
          </p>
        ) : !(card && loaded) ? (
          <p className={styles.previewNote} aria-live="polite">
            {word.drawing}
          </p>
        ) : null}
      </div>

      <label className={styles.toggle} htmlFor={amountsId}>
        <span className={styles.toggleText}>
          <span>{word.amounts}</span>
          {!amounts ? <span className={styles.toggleNote}>{word.amountsNote}</span> : null}
        </span>
        <input id={amountsId} type="checkbox" role="switch" className={styles.switch} checked={amounts} onChange={(event) => setAmounts(event.target.checked)} />
      </label>

      <div className={styles.actions}>
        <a className={`rw-btn ${styles.primary}`} data-variant="primary" href={xHref} target="_blank" rel="noreferrer noopener" aria-disabled={!card} data-disabled={!card || undefined}>
          <XLogo size={16} weight="bold" aria-hidden="true" />
          {word.postX}
        </a>
        <div className={styles.secondary}>
          <a className="rw-btn" href={tgHref} target="_blank" rel="noreferrer noopener" aria-disabled={!card} data-disabled={!card || undefined}>
            <TelegramLogo size={16} weight="bold" aria-hidden="true" />
            {word.telegram}
          </a>
          <button type="button" className="rw-btn" disabled={!card} onClick={() => card && void copy(card.url)} aria-live="polite">
            {copied ? <Check size={16} weight="bold" aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied ? word.copied : word.copy}
          </button>
        </div>
      </div>
    </div>
  );
}
