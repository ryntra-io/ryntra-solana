"use client";

import { ArrowClockwise, CaretLeft, Check, Copy, DownloadSimple, FilmStrip, ShareNetwork, TelegramLogo, X, XLogo } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cardDate, cardPercent, cardPrice, cardWords, type CardLocale } from "@/lib/growth/card-copy";
import type { CardFace } from "@/lib/growth/card-face";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { cardFileName, filmSupported, makeCardFilm, saveBlob } from "./card-motion";
import { LiveCard, type LiveCardHandle } from "./live-card";
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
 * receipts; the dollar amounts are off until the person turns them on. The
 * card plays alive in the sheet (`live-card.tsx`); its picture is what X and
 * Telegram show under the link, and it can be saved as an image or, where the
 * browser can make one, as a film to post.
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

type Made = Readonly<{ id: string; url: string; image: string; text: string; alt: string; face: CardFace }>;

type FilmState = "idle" | "making" | "failed";

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
        {trades.map((trade, index) => {
          const tone = trade.kind === "SELL" && trade.resultBps !== null ? (trade.resultBps > 0 ? "up" : trade.resultBps < 0 ? "down" : undefined) : undefined;
          return (
            <li key={trade.key} style={{ "--i": Math.min(index, 8) } as React.CSSProperties}>
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
  const [copied, setCopied] = useState(false);
  const [film, setFilm] = useState<FilmState>("idle");
  const [canFilm, setCanFilm] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [liveReady, setLiveReady] = useState(false);
  /* On a phone the film made by the first tap, waiting for the second, which hands it to an app inside the tap. */
  const [madeFilm, setMadeFilm] = useState<File | null>(null);
  const live = useRef<LiveCardHandle | null>(null);
  const amountsId = useId();

  useEffect(() => {
    void filmSupported().then(setCanFilm);
    try {
      /* A phone hands the film to X's app; a desk saves it — a desk's share menu has no X to give it to. */
      const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
      const touch = window.matchMedia("(pointer: coarse)").matches;
      setCanShareFiles(touch && typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  const make = useCallback(async (withAmounts: boolean) => {
    setState({ status: "drawing" });
    setFilm("idle");
    setMadeFilm(null);
    setLiveReady(false);
    live.current = null;
    try {
      const response = await fetch("/api/growth/cards", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ address, trade: trade.key, locale, amounts: withAmounts }),
      });
      const body = (await response.json().catch(() => null)) as { card?: Made } | null;
      if (!response.ok || !body?.card?.face) {
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


  /* The picture X shows under the link, as a file — from this site, whatever host the link names. */
  const saveImage = async () => {
    if (!card) return;
    try {
      const own = new URL(card.image);
      const response = await fetch(`${own.pathname}${own.search}`);
      if (!response.ok) throw new Error(String(response.status));
      saveBlob(await response.blob(), cardFileName(card.face, card.id, "png"));
    } catch {
      window.open(card.image, "_blank", "noopener");
    }
  };

  /*
   * The film, made only when asked. On a desk it is saved as soon as it is
   * made. On a phone the share sheet must open inside a tap, and making takes
   * longer than a tap lasts: the first tap makes it, the button then says
   * «Share video», and that tap hands it to an app.
   */
  const shareFilm = async () => {
    if (!card || !live.current || film === "making") return;
    if (canShareFiles && madeFilm) {
      try {
        await navigator.share({ files: [madeFilm], text: `${card.text} ${card.url}` });
      } catch (error) {
        /* Closing the share sheet is not a failure; anything else falls back to saving. */
        if ((error as { name?: string })?.name !== "AbortError") saveBlob(madeFilm, madeFilm.name);
      }
      return;
    }
    setFilm("making");
    try {
      const blob = await makeCardFilm(card.face, live.current.assets, live.current.fonts);
      if (canShareFiles) setMadeFilm(new File([blob], cardFileName(card.face, card.id, "mp4"), { type: "video/mp4" }));
      else saveBlob(blob, cardFileName(card.face, card.id, "mp4"));
      setFilm("idle");
    } catch {
      setFilm("failed");
    }
  };
  const filmWaiting = film === "making";

  const xHref = card ? `https://x.com/intent/post?text=${encodeURIComponent(card.text)}&url=${encodeURIComponent(card.url)}` : undefined;
  const tgHref = card ? `https://t.me/share/url?url=${encodeURIComponent(card.url)}&text=${encodeURIComponent(card.text)}` : undefined;

  return (
    <div className={styles.step}>
      {card ? (
        <LiveCard
          key={card.id}
          className={styles.live}
          face={card.face}
          replayLabel={word.replay}
          onReady={(handle) => {
            live.current = handle;
            setLiveReady(true);
          }}
        />
      ) : (
        <div className={`${styles.preview} ${styles.live}`} data-state={state.status === "failed" ? "failed" : "drawing"} aria-busy={state.status !== "failed"}>
          {state.status === "failed" ? (
            <p className={styles.previewNote} role="alert">
              {word.failed}{" "}
              <button type="button" className={styles.retry} onClick={() => void make(amounts)} aria-label={word.retry} title={word.retry}>
                <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
              </button>
            </p>
          ) : (
            <p className={styles.previewNote} aria-live="polite">
              {word.drawing}
            </p>
          )}
        </div>
      )}

      <label className={styles.toggle} htmlFor={amountsId}>
        <span className={styles.toggleText}>
          <span>{word.amounts}</span>
          {/* Kept in place when on, so the sheet does not jump. */}
          <span className={styles.toggleNote} data-hidden={amounts || undefined} aria-hidden={amounts || undefined}>
            {word.amountsNote}
          </span>
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
          <button type="button" className="rw-btn" disabled={!card || !liveReady} onClick={() => void saveImage()}>
            <DownloadSimple size={16} weight="bold" aria-hidden="true" />
            {word.saveImage}
          </button>
          {canFilm ? (
            <button type="button" className="rw-btn" disabled={!card || !liveReady || filmWaiting} onClick={() => void shareFilm()} aria-busy={filmWaiting}>
              <FilmStrip size={16} weight="bold" aria-hidden="true" />
              {filmWaiting ? word.makingVideo : madeFilm ? word.shareVideo : word.saveVideo}
            </button>
          ) : null}
        </div>
        {film === "failed" ? (
          <p className={styles.lead} role="status">
            {word.videoFailed}
          </p>
        ) : null}
      </div>
    </div>
  );
}
