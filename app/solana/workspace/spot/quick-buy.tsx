"use client";

import { Check, PencilSimple } from "@phosphor-icons/react";
import { useCallback, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { QUICK_BUY_COUNT, QUICK_BUY_DEFAULT_USD, QUICK_BUY_STORAGE_KEY, quickSum, quickSumLabel, readQuickSums, writeQuickSums } from "@/lib/spot/quick-trade";

import styles from "./quick-buy.module.css";

/**
 * «Швидка купівля» — the person's four dollar sums, one tap each, the same on
 * a token's page, a company's page and a launch's page (`lib/spot/quick-trade.ts`).
 *
 * A chip hands its sum to the page's own order; the page opens the Review it
 * always opens, and the wallet signs. The pencil turns the chips into four
 * fields — Enter or the tick saves, Escape leaves them as they were — and the
 * sums the person saves are remembered on this device for every page. A
 * device that keeps nothing keeps them for as long as the page is open.
 */

type Lang = "en" | "uk";
type Size = "dense" | "regular" | "comfort";

const WORDS = {
  en: { group: "Quick buy", edit: "Change quick sums", save: "Save quick sums", field: "Quick sum", range: "From $1 to $1,000,000 each", buyFor: "Buy for" },
  uk: { group: "Швидка купівля", edit: "Змінити швидкі суми", save: "Зберегти швидкі суми", field: "Швидка сума", range: "Кожна — від $1 до $1 000 000", buyFor: "Купити на" },
} as const;

/* ------------------------------------------------------------ the remembered sums */

const CHANGED = "ryntra:quick-buy";
let cachedText: string | null | undefined;
let cachedSums: readonly number[] = QUICK_BUY_DEFAULT_USD;
/* What a device that refuses storage was told to keep: it wins over the store's silence until the page is left. */
let memoryText: string | null = null;

function readStored(): string | null {
  if (memoryText !== null) return memoryText;
  try {
    return window.localStorage.getItem(QUICK_BUY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function snapshot(): readonly number[] {
  const text = readStored();
  if (text !== cachedText) {
    cachedText = text;
    cachedSums = readQuickSums(text);
  }
  return cachedSums;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === QUICK_BUY_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** The four quick sums, remembered on this device; the same everywhere they are offered. */
export function useQuickBuySums(): readonly [readonly number[], (sums: readonly number[]) => void] {
  const sums = useSyncExternalStore(subscribe, snapshot, () => QUICK_BUY_DEFAULT_USD);
  const save = useCallback((next: readonly number[]) => {
    const text = writeQuickSums(next);
    try {
      window.localStorage.setItem(QUICK_BUY_STORAGE_KEY, text);
      memoryText = null;
    } catch {
      /* Private mode or blocked storage: the sums last as long as the page. */
      memoryText = text;
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [sums, save] as const;
}

/* ------------------------------------------------------------ the chips */

export function QuickBuy({
  locale,
  onPick,
  disabled = false,
  size = "dense",
  pressed = null,
  label = false,
  note = null,
}: Readonly<{
  locale: Lang;
  onPick: (usd: number) => void;
  /** The sums cannot be pressed now (an order on its way, nothing to price them in); the pencil still changes them unless `note` says the page is busy. */
  disabled?: boolean;
  /** «dense» beside a terminal's ticket; «regular» in a launch's panel; «comfort» on a company's page, 44 px everywhere. */
  size?: Size;
  /** The sum the page's order holds now, drawn pressed. */
  pressed?: number | null;
  /** «Швидка купівля» said above the chips, where the page says nothing else of them. */
  label?: boolean;
  /** Why the sums are not pressable, said under them. */
  note?: string | null;
}>) {
  const word = WORDS[locale];
  const [sums, save] = useQuickBuySums();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [invalid, setInvalid] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const errorId = useId();
  const noteId = useId();

  /* Back from the fields, the keyboard lands where it left: on the pencil. */
  const leaveEdit = () => {
    setEditing(false);
    setInvalid(false);
    window.requestAnimationFrame(() => pencil.current?.focus());
  };
  const startEdit = () => {
    setDrafts(sums.map((sum) => (locale === "uk" ? String(sum).replace(".", ",") : String(sum))));
    setInvalid(false);
    setEditing(true);
  };
  const finish = (event: FormEvent) => {
    event.preventDefault();
    const parsed = drafts.map((draft) => quickSum(draft, locale));
    if (parsed.length !== QUICK_BUY_COUNT || parsed.some((sum) => sum === null)) {
      setInvalid(true);
      return;
    }
    save(parsed as number[]);
    leaveEdit();
  };

  return (
    <div className={styles.quick} data-quick-buy data-size={size} data-dense={size === "comfort" ? undefined : ""}>
      {label ? (
        <span id={labelId} className={styles.label}>
          {word.group}
        </span>
      ) : null}
      {editing ? (
        <form
          className={styles.row}
          onSubmit={finish}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            /* Escape leaves the sums as they were — and stops here, so a sheet around the fields stays open. */
            event.preventDefault();
            event.stopPropagation();
            leaveEdit();
          }}
          aria-label={word.edit}
          noValidate
        >
          {drafts.map((draft, index) => (
            <label key={index} className={styles.field} data-invalid={invalid && quickSum(draft, locale) === null ? "true" : undefined}>
              <span aria-hidden="true">$</span>
              <input
                className={styles.input}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                aria-label={`${word.field} ${index + 1}`}
                aria-invalid={invalid && quickSum(draft, locale) === null ? true : undefined}
                aria-describedby={invalid ? errorId : undefined}
                autoFocus={index === 0}
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) => current.map((entry, at) => (at === index ? value : entry)));
                }}
              />
            </label>
          ))}
          <button type="submit" className={styles.tool} aria-label={word.save} title={word.save}>
            <Check size={16} weight="bold" aria-hidden="true" />
          </button>
        </form>
      ) : (
        <div className={styles.row} role="group" aria-label={label ? undefined : word.group} aria-labelledby={label ? labelId : undefined} aria-describedby={note ? noteId : undefined}>
          {sums.map((usd, index) => (
            <button
              key={`${index}:${usd}`}
              type="button"
              className={styles.chip}
              disabled={disabled}
              aria-pressed={pressed !== null ? Math.abs(pressed - usd) < 0.005 : undefined}
              aria-label={`${word.buyFor} ${quickSumLabel(usd, locale, true)}`}
              onClick={() => onPick(usd)}
              data-quick-sum={usd}
              translate="no"
            >
              {quickSumLabel(usd, locale)}
            </button>
          ))}
          <button ref={pencil} type="button" className={styles.tool} onClick={startEdit} aria-label={word.edit} title={word.edit}>
            <PencilSimple size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
      )}
      {editing && invalid ? (
        <p id={errorId} className={styles.error} role="alert">
          {word.range}
        </p>
      ) : null}
      {!editing && note ? (
        <p id={noteId} className={styles.note}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

const SHARE_WORDS = {
  en: { group: "Quick sell", sell: "Sell", all: "All" },
  uk: { group: "Швидкий продаж", sell: "Продати", all: "Усе" },
} as const;

/**
 * «Швидкий продаж» — a share of the position in one tap: 25 · 50 · 75 % and
 * «Усе», exactly what the wallet holds. Like a quick buy, the share goes into
 * the page's own sale and its Review; the wallet signs.
 */
export function QuickSell({
  locale,
  shares,
  onPick,
  disabled = false,
  size = "dense",
  pressed = null,
  label = false,
  unavailable,
}: Readonly<{
  locale: Lang;
  shares: readonly number[];
  onPick: (pct: number) => void;
  disabled?: boolean;
  size?: Size;
  pressed?: number | null;
  label?: boolean;
  /** A share the page cannot sell (under its minimum): drawn, not pressable. */
  unavailable?: (pct: number) => boolean;
}>) {
  const word = SHARE_WORDS[locale];
  const labelId = useId();
  const percent = new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { style: "percent", maximumFractionDigits: 0 });
  return (
    <div className={styles.quick} data-quick-sell data-size={size} data-dense={size === "comfort" ? undefined : ""}>
      {label ? (
        <span id={labelId} className={styles.label}>
          {word.group}
        </span>
      ) : null}
      <div className={styles.row} data-shares role="group" aria-label={label ? undefined : word.group} aria-labelledby={label ? labelId : undefined}>
        {shares.map((pct) => {
          const shown = pct >= 100 ? word.all : percent.format(pct / 100);
          return (
            <button
              key={pct}
              type="button"
              className={styles.chip}
              disabled={disabled || unavailable?.(pct) === true}
              aria-pressed={pressed !== null ? pressed === pct : undefined}
              aria-label={`${word.sell} ${pct >= 100 ? word.all.toLowerCase() : shown}`}
              onClick={() => onPick(pct)}
              data-quick-share={pct}
            >
              {shown}
            </button>
          );
        })}
      </div>
    </div>
  );
}
