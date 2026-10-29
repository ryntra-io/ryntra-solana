"use client";

import { Button } from "@ryntra/core/ui";
import { Bell, CaretDown, CaretRight, CheckCircle, Eye, Pause, Warning, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { numberLocale } from "@/app/app/invest/invest-words";
import { SheetHead } from "@/app/app/stocks/[ticker]/sell-sheet";
import company from "@/app/app/stocks/[ticker]/company.module.css";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatUsdPrice } from "@/app/solana/workspace/spot/spot-format";
import type { PositionWatchResponse, PositionWatchView } from "@/lib/api/v1/contract";
import { POSITION_WATCH_PRESETS, POSITION_WATCH_PRESET_IDS, watchFigures, type PositionWatchPreset } from "@/lib/monitoring/watch-figures";
import { ISSUER_PAUSED_DETAILS, WARN_HONEST_LIMIT, watchActionWord, watchLine, watchStateWord, watchTone, watchWord, type WatchFormat, type WatchLang } from "@/lib/monitoring/watch-words";
import { isWatched, shortEventLine } from "@/lib/stocks/conversion-watch";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";

import { acceptPosition } from "./use-positions";
import styles from "./watch.module.css";
import { ensureWalletActs } from "@/lib/account/wallet-proof-store.client";

/**
 * Нагляд over one position, drawn: the state the server judged — «Все за
 * планом», «Увага», «Дія», «Пауза емітента», or «Увага: куплено — вихід не
 * налаштований» in amber — the figures it stands on, and its one action;
 * nothing here decides a state.
 *
 * One language in every place a position is drawn. In a Portfolio row the
 * state is a line of the position itself — its word, its figures, its action
 * a word or two — never a panel of its own beside the row. On the company's
 * page and in Нагляд it has room: the state over the range the exit makes —
 * the loss limit, the price now, the target — and its action as a button.
 */

export function langOf(locale: WorkspaceLocale): WatchLang {
  return locale === "uk" ? "uk" : "en";
}

/** Money and per cent the way the reader's language writes them. */
export function watchFormat(locale: WorkspaceLocale) {
  const numbers = numberLocale(locale);
  const percent = new Intl.NumberFormat(numbers, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  return {
    money: (usd: number) => formatUsdPrice(usd, numbers),
    pct: (value: number) => `${percent.format(Math.abs(value))} %`,
  };
}

/** The issuer's event in one short line, for «Увага» that names it. */
function eventLineOf(mint: string, lang: WatchLang): string | null {
  const event = lifecycleEventFor(mint);
  return isWatched(event) ? shortEventLine(event, lang, Date.now()) : null;
}

const TONE_ICON = { calm: CheckCircle, caution: Warning, act: WarningCircle, quiet: Pause } as const;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Where the price stands against the exit, drawn: the loss limit, the target
 * and the price now on one line — past the limit in the risk's colour, past
 * the target in the verified one. A drawing of figures the server gave; it
 * judges nothing. `mini` sits in a row's line; `full` carries its figures.
 */
export function WatchRange({
  limit,
  target,
  price,
  size,
  lang,
  format,
  domain,
  limitNote,
  targetNote,
}: Readonly<{
  limit: number;
  target: number | null;
  price: number | null;
  size: "mini" | "full";
  lang: WatchLang;
  format: WatchFormat;
  /** The span drawn; else fitted around the limit, the target and the price. */
  domain?: readonly [number, number];
  /** Beside each end's figure in the sheet: the preset's per cent. */
  limitNote?: string;
  targetNote?: string;
}>) {
  const [low, high] = domain ?? fitRange(limit, target, price);
  const at = (value: number) => Math.min(97, Math.max(3, ((value - low) / (high - low)) * 100));
  const limitAt = at(limit);
  const targetAt = target !== null ? at(target) : null;
  const priceAt = price !== null ? at(price) : null;
  const where = price === null ? "unknown" : price <= limit ? "limit" : target !== null && price >= target ? "target" : "between";
  const said = [
    price !== null ? `${watchWord("priceNow", lang)} ${format.money(price)}` : null,
    `${watchWord("lossLimit", lang)} ${format.money(limit)}`,
    target !== null ? `${capital(watchWord("target", lang))} ${format.money(target)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={styles.range} data-size={size} data-where={where} role="img" aria-label={said}>
      <span className={styles.rangeTrack} aria-hidden="true">
        <span className={styles.rangeLoss} style={{ width: `${limitAt}%` }} />
        {targetAt !== null ? <span className={styles.rangeGain} style={{ left: `${targetAt}%` }} /> : null}
        <span className={styles.rangeTick} data-kind="limit" style={{ left: `${limitAt}%` }} />
        {targetAt !== null ? <span className={styles.rangeTick} data-kind="target" style={{ left: `${targetAt}%` }} /> : null}
        {priceAt !== null ? (
          <span className={styles.rangeDot} style={{ left: `${priceAt}%` }}>
            {size === "full" ? <span className={styles.rangeNow}>{watchWord("now", lang)}</span> : null}
          </span>
        ) : null}
      </span>
      {size === "full" ? (
        <span className={styles.rangeEnds} aria-hidden="true" translate="no">
          <span data-kind="limit">
            <small>{watchWord("lossLimit", lang)}</small>
            <b>{limitNote ? `${format.money(limit)} · ${limitNote}` : format.money(limit)}</b>
          </span>
          {target !== null ? (
            <span data-kind="target">
              <small>{capital(watchWord("target", lang))}</small>
              <b>{targetNote ? `${format.money(target)} · ${targetNote}` : format.money(target)}</b>
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** The span a position's range is drawn over: the limit, the target and the price with room on either side. */
function fitRange(limit: number, target: number | null, price: number | null): readonly [number, number] {
  const values = [limit, target ?? limit * 1.1, price].filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low || low * 0.1) * 0.16;
  return [low - pad, high + pad];
}

export type WatchLineProps = Readonly<{
  view: PositionWatchView;
  locale: WorkspaceLocale;
  /** Where the line stands: on the company's own page (no «Подивитись» — the reader is here), a Portfolio row, or a card in Нагляд. */
  place: "page" | "row" | "card";
  /** «Відкрити продаж» opens the sale right here; without it the line links to the company with the sale opening. */
  onSale?: () => void;
  /** «Увімкнути „Ryntra попередить“» opens its sheet. */
  onWarn?: () => void;
  /** The screen's one orange action. */
  primary?: boolean;
  /** A Portfolio row whose own «Продати» stands beside it: at «Дія» that button is the sale, and the line only says why. */
  saleBeside?: boolean;
}>;

export function WatchLine({ view, locale, place, onSale, onWarn, primary = false, saleBeside = false }: WatchLineProps) {
  const lang = langOf(locale);
  const format = useMemo(() => watchFormat(locale), [locale]);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const tone = watchTone(view.state);
  const row = place === "row";
  const Icon = view.state === "exit-not-set" ? Bell : view.state === "issuer-paused" ? Pause : view.state === "unknown" ? Eye : TONE_ICON[tone];
  const line = watchLine(
    { reason: view.reason, price: view.price, exit: view.exit, toLimitPct: view.toLimitPct, deviationPct: view.deviationPct, eventLine: view.reason === "issuer-event" ? eventLineOf(view.mint, lang) : null },
    lang,
    format,
  );
  /* The range, where there is an exit to draw and a price to hold against it. */
  const range = view.exit && view.state !== "issuer-paused" && view.state !== "unknown" ? { limit: view.exit.limit, target: view.exit.target, price: view.price } : null;
  const page = `/app/stocks/${encodeURIComponent(view.symbol)}`;
  /* In a row the action is a small capsule — a word or two and its arrow — whose press reaches the product's 44 px; in a panel, a button. */
  const actionClass = row ? styles.inlineAction : `${primary ? "rw-btn rw-btn--primary" : "rw-btn"} ${styles.watchAction}`;
  const word = (action: Parameters<typeof watchActionWord>[0]) =>
    row ? (
      <span className={styles.capsule}>
        {watchActionWord(action, lang, true)}
        <CaretRight size={12} weight="bold" aria-hidden="true" />
      </span>
    ) : (
      watchActionWord(action, lang)
    );
  const action = (() => {
    switch (view.action) {
      case "open-sale":
        if (row && saleBeside) return null;
        return onSale ? (
          <Button variant={row ? "ghost" : primary ? "primary" : "secondary"} className={row ? styles.inlineAction : styles.watchAction} onClick={onSale} data-watch-action="open-sale" lang={lang}>
            {word("open-sale")}
          </Button>
        ) : (
          <Link className={actionClass} href={`${page}?sell=1`} prefetch={false} data-watch-action="open-sale">
            {word("open-sale")}
          </Link>
        );
      case "look":
        return place === "page" ? null : (
          <Link className={row ? actionClass : `rw-btn ${styles.watchAction}`} href={page} prefetch={false} data-watch-action="look">
            {word("look")}
          </Link>
        );
      case "warn":
        return onWarn ? (
          <Button variant={row ? "ghost" : primary ? "primary" : "secondary"} className={row ? styles.inlineAction : styles.watchAction} onClick={onWarn} aria-haspopup="dialog" data-watch-action="warn" lang={lang}>
            {word("warn")}
          </Button>
        ) : (
          <Link className={actionClass} href={page} prefetch={false} data-watch-action="warn">
            {word("warn")}
          </Link>
        );
      case "connect-telegram":
        return (
          <Link className={actionClass} href="/app/settings#account" prefetch={false} data-watch-action="connect-telegram">
            {word("connect-telegram")}
          </Link>
        );
      case "details":
        return (
          <Button variant={row ? "ghost" : "secondary"} className={row ? styles.inlineAction : styles.watchAction} aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails((open) => !open)} data-watch-action="details" lang={lang}>
            {row ? (
              <span className={styles.capsule}>
                {watchActionWord("details", lang)}
                <CaretDown size={12} weight="bold" aria-hidden="true" className={styles.caret} />
              </span>
            ) : (
              <>
                {watchActionWord("details", lang)}
                <CaretDown size={14} weight="bold" aria-hidden="true" className={styles.caret} />
              </>
            )}
          </Button>
        );
      default:
        return null;
    }
  })();
  const said = details ? (
    <p id={detailsId} className={styles.detailsText}>
      {ISSUER_PAUSED_DETAILS[lang]}
    </p>
  ) : null;

  if (row) {
    /* A row carries the figures where they are the point — the exit and where the price stands; a pause or an unread price says it all in its name. */
    const figures = view.state === "on-plan" || view.state === "attention" || view.state === "action" ? line : null;
    return (
      <div className={styles.rowLine} data-watch={view.state} data-reason={view.reason} data-tone={tone} data-place={place}>
        <p className={styles.rowText}>
          <Icon size={14} weight="bold" aria-hidden="true" className={styles.watchIcon} />
          <b className={styles.watchState}>{watchStateWord(view.state, lang, true)}</b>
          {range ? <WatchRange {...range} size="mini" lang={lang} format={format} /> : null}
          {figures ? (
            <span className={styles.watchLine} translate="no">
              {figures}
            </span>
          ) : null}
          {action}
        </p>
        {said}
      </div>
    );
  }

  /* Between the limit and the target the range carries both figures; any other line says what the state stands on. */
  const lineShown = line !== null && !(range && view.reason === "between");
  return (
    <div className={styles.panel} data-watch={view.state} data-reason={view.reason} data-tone={tone} data-place={place}>
      <p className={styles.panelHead}>
        <Icon size={18} weight="bold" aria-hidden="true" className={styles.watchIcon} />
        <b className={styles.watchState}>{watchStateWord(view.state, lang)}</b>
      </p>
      {lineShown ? (
        <p className={styles.panelLine} translate="no">
          {line}
        </p>
      ) : null}
      {range ? <WatchRange {...range} size="full" lang={lang} format={format} /> : null}
      {action ? <div className={styles.panelAction}>{action}</div> : null}
      {said}
    </div>
  );
}

type Phase = Readonly<{ status: "idle" | "writing" | "failed"; message: string | null }>;

/**
 * «Ryntra попередить» for one position: the price now, the two published
 * presets drawn as the range each makes of it, where the warning comes, and
 * one «Увімкнути». The server counts the figures again from its
 * own price when it writes them; nothing is signed or moved. Turned on, the
 * sheet says so with the figures the server wrote — then «Готово».
 */
export function WarnSheet({ view, locale, onClose }: Readonly<{ view: PositionWatchView | null; locale: WorkspaceLocale; onClose: () => void }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = view !== null;
  /* The last position asked for, so the sheet keeps its words while it closes. */
  const [shown, setShown] = useState<PositionWatchView | null>(view);
  useEffect(() => {
    if (view) setShown(view);
  }, [view]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
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
      className={company.sheet}
      aria-labelledby={titleId}
      data-warn
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
      {open && shown ? <WarnBody key={shown.mint} view={shown} locale={locale} titleId={titleId} onClose={onClose} /> : null}
    </dialog>
  );
}

/** The span the sheet draws both presets over: a quarter either side of the price, so «Обережно» reads narrower than «Збалансовано». */
const SHEET_SPAN = 0.26;

function WarnBody({ view, locale, titleId, onClose }: Readonly<{ view: PositionWatchView; locale: WorkspaceLocale; titleId: string; onClose: () => void }>) {
  const lang = langOf(locale);
  const format = useMemo(() => watchFormat(locale), [locale]);
  const [preset, setPreset] = useState<PositionWatchPreset>("careful");
  const [phase, setPhase] = useState<Phase>({ status: "idle", message: null });
  const [written, setWritten] = useState<PositionWatchResponse | null>(null);
  const figures = view.price !== null ? watchFigures(preset, view.price) : null;

  const turnOn = async () => {
    setPhase({ status: "writing", message: null });
    try {
      /* A watch is a write: a wallet linked to an email account signs once for it (decision 62). */
      if (!(await ensureWalletActs())) { setPhase({ status: "idle", message: null }); return; }
      const response = await fetch("/api/v1/positions/watch", {
        method: "PUT",
        headers: { accept: "application/json", "content-type": "application/json", "X-Ryntra-API": "1" },
        body: JSON.stringify({ mint: view.mint, preset, locale: lang }),
      });
      const body = (await response.json().catch(() => null)) as (PositionWatchResponse & { error?: { code?: string } }) | null;
      if (response.ok && body?.watch) {
        if (body.position) acceptPosition(body.position);
        setWritten(body);
        return;
      }
      const code = body?.error?.code;
      setPhase({ status: "failed", message: code === "CHANNEL_REQUIRED" ? watchWord("failedChannel", lang) : code === "PRICE_UNAVAILABLE" ? watchWord("failedPrice", lang) : watchWord("failed", lang) });
    } catch {
      setPhase({ status: "failed", message: watchWord("failed", lang) });
    }
  };

  if (written) {
    const watch = written.watch;
    const price = written.position?.price ?? watch.basisPerUnit;
    return (
      <div className={company.sheetBody} data-sheet="warn" data-warn-done>
        <SheetHead mint={view.mint} name={view.name} icon={view.icon} title={`${watchWord("sheetTitle", lang)} · ${view.name}`} titleId={titleId} onClose={onClose} disabled={false} locale={locale} />
        <p className={styles.warnDone} role="status">
          <CheckCircle size={28} weight="fill" aria-hidden="true" />
          <b>{watchWord("turnedOn", lang)}</b>
        </p>
        <WatchRange limit={watch.limitPerUnit} target={watch.targetPerUnit} price={price} size="full" lang={lang} format={format} limitNote={`−${watch.stopPct} %`} targetNote={`+${watch.targetPct} %`} />
        <p className={styles.warnNote}>{`${watchWord("channel", lang)}. ${WARN_HONEST_LIMIT[lang]}`}</p>
        <div className={company.sheetActions}>
          <Button variant="primary" block onClick={onClose} lang={lang}>
            {watchWord("done", lang)}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={company.sheetBody} data-sheet="warn">
      <SheetHead mint={view.mint} name={view.name} icon={view.icon} title={`${watchWord("sheetTitle", lang)} · ${view.name}`} titleId={titleId} onClose={onClose} disabled={phase.status === "writing"} locale={locale} />
      <p className={styles.warnLead}>{watchWord("sheetLead", lang)}</p>
      <p className={styles.warnPrice} translate="no">
        <span>{watchWord("priceNow", lang)}</span>
        <b>{view.price !== null ? format.money(view.price) : "—"}</b>
      </p>
      <div className={styles.warnPresets} role="radiogroup" aria-label={watchWord("lossLimit", lang)}>
        {POSITION_WATCH_PRESET_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={preset === id} className={styles.warnPreset} disabled={phase.status === "writing"} onClick={() => setPreset(id)}>
            <b>{watchWord(id, lang)}</b>
            <span translate="no">{`−${POSITION_WATCH_PRESETS[id].stopPct} % · +${POSITION_WATCH_PRESETS[id].targetPct} %`}</span>
          </button>
        ))}
      </div>
      {figures && view.price !== null ? (
        <WatchRange
          limit={figures.limitPerUnit}
          target={figures.targetPerUnit}
          price={view.price}
          size="full"
          lang={lang}
          format={format}
          domain={[view.price * (1 - SHEET_SPAN), view.price * (1 + SHEET_SPAN)]}
          limitNote={`−${figures.stopPct} %`}
          targetNote={`+${figures.targetPct} %`}
        />
      ) : null}
      <p className={styles.warnNote}>{`${watchWord("channel", lang)}. ${WARN_HONEST_LIMIT[lang]}`}</p>
      {phase.status === "failed" && phase.message ? (
        <p className={company.sheetError} role="status">
          {phase.message}
        </p>
      ) : null}
      <div className={company.sheetActions}>
        <Button variant="primary" block disabled={phase.status === "writing" || view.price === null} onClick={() => void turnOn()} lang={lang}>
          {phase.status === "writing" ? watchWord("turning", lang) : watchWord("turnOn", lang)}
        </Button>
      </div>
    </div>
  );
}
