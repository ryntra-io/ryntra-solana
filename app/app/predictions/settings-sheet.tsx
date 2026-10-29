"use client";

import { Ticket, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { CHANCE_UNITS, DENSITIES, HUB_COLUMNS, MENU_STYLES, TICKET_SIDES, cleanAmount, type ChanceUnits } from "@/lib/predictions/preferences";
import { unitsExample } from "@/lib/predictions/units";

import { useSettingsSheet } from "./prefs";
import { usePredictPrefs } from "./prefs-context";
import styles from "./settings.module.css";
import { wordsFor, type PredictionWord } from "./words";

const UNIT_WORD: Readonly<Record<ChanceUnits, PredictionWord>> = { payout: "unitsPayout", percent: "unitsPercent", cents: "unitsCents", odds: "unitsOdds" };

/** One choice among a few, as a row of buttons; the chosen one pressed. */
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChoose,
  desk = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; text: string; hint?: string }[];
  onChoose: (value: T) => void;
  /** Meaningful on a wide screen only (a phone draws one column whatever is chosen). */
  desk?: boolean;
}) {
  return (
    <div className={styles.setting} role="group" aria-label={label} data-desk={desk || undefined}>
      <span className={styles.settingLabel}>{label}</span>
      <div className={styles.segments} data-count={options.length}>
        {options.map((option) => (
          <button key={String(option.value)} type="button" className={styles.segment} aria-pressed={option.value === value} onClick={() => onChoose(option.value)}>
            <span>{option.text}</span>
            {option.hint ? <small>{option.hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The section's own choices — how a chance is shown, the usual amount, the
 * ticket's side, the hub's columns — applied the moment they are chosen: no
 * save button, nothing hidden behind a mode. Inside the Solana app the look
 * (theme, density, the menu) stays with that shell's «Налаштувати»; the
 * product's own shell has no other place for it, so there the sheet carries
 * the density and the menu too (`look`). Where the choices are kept is said
 * once at the foot.
 */
export function SettingsSheet({ locale, onClose, look = false }: { locale: WorkspaceLocale; onClose: () => void; look?: boolean }) {
  const word = wordsFor(locale);
  const { prefs, change, signedIn, synced } = usePredictPrefs();
  const dialog = useRef<HTMLDivElement>(null);
  const [amount, setAmount] = useState(String(prefs.amountUsd));

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The sheet is the top layer: Escape closes it alone, not the shell's own panels behind it too.
        event.stopPropagation();
        onClose();
        return;
      }
      // Tab stays inside the sheet while it is open.
      if (event.key !== "Tab" || !dialog.current) return;
      const stops = [...dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")].filter((el) => el.offsetParent !== null);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [onClose]);

  if (!change) return null;
  const amountShown = cleanAmount(amount) ?? prefs.amountUsd;

  return (
    <div className={styles.scrim} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`${styles.sheet} ${styles.settingsSheet}`} role="dialog" aria-modal="true" aria-labelledby="predict-settings-title" tabIndex={-1} ref={dialog}>
        <div className={styles.sheetHead}>
          <h2 id="predict-settings-title">{word(look ? "settingsTitle" : "sectionSettings")}</h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={word("close")}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <Choice
          label={word("unitsTitle")}
          value={prefs.units}
          options={CHANCE_UNITS.map((units) => ({ value: units, text: word(UNIT_WORD[units]).replace("$X", `$${amountShown}`), hint: unitsExample(units, amountShown) }))}
          onChoose={(units) => change({ units })}
        />

        <div className={styles.setting}>
          <label className={styles.settingLabel} htmlFor="predict-amount">
            {word("amountTitle")}
          </label>
          <div className={styles.amountField}>
            <span aria-hidden="true">$</span>
            <input
              id="predict-amount"
              inputMode="numeric"
              value={amount}
              aria-describedby="predict-amount-help"
              aria-invalid={cleanAmount(amount) == null}
              onChange={(event) => {
                setAmount(event.target.value);
                const whole = cleanAmount(event.target.value);
                if (whole != null) change({ amountUsd: whole });
              }}
              onBlur={() => setAmount(String(prefs.amountUsd))}
            />
          </div>
          <small id="predict-amount-help" className={styles.settingHelp}>
            {word("amountHelp")}
          </small>
        </div>

        <Choice
          label={word("sideTitle")}
          value={prefs.side}
          options={TICKET_SIDES.map((side) => ({ value: side, text: word(side === "right" ? "sideRight" : "sideLeft") }))}
          onChoose={(side) => change({ side })}
          desk
        />
        {look ? (
          <>
            <Choice
              label={word("densityTitle")}
              value={prefs.density}
              options={DENSITIES.map((density) => ({ value: density, text: word(density === "regular" ? "densityRegular" : "densityCompact") }))}
              onChoose={(density) => change({ density })}
            />
            <Choice label={word("menuTitle")} value={prefs.menu} options={MENU_STYLES.map((menu) => ({ value: menu, text: word(menu === "full" ? "menuFull" : "menuIcons") }))} onChoose={(menu) => change({ menu })} />
          </>
        ) : null}
        <Choice
          label={`${word("hubTitle")} · ${word("hubColumns")}`}
          value={prefs.hub.columns}
          options={HUB_COLUMNS.map((columns) => ({ value: columns, text: String(columns) }))}
          onChoose={(columns) => change({ hub: { ...prefs.hub, columns } })}
          desk
        />

        <p className={styles.settingFoot} role="status">
          {!signedIn ? word("settingsSaved") : synced ? word("settingsSynced") : word("settingsNotSynced")}
        </p>
      </div>
    </div>
  );
}

/** The sheet's button in a page's head; drawn only where the choices can be changed. */
export function SettingsButton({ locale }: { locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const { change, openSettings } = usePredictPrefs();
  if (!change || !openSettings) return null;
  return (
    <button type="button" className="rw-btn" onClick={openSettings} aria-haspopup="dialog">
      <Ticket size={16} aria-hidden="true" /> {word("sectionSettings")}
    </button>
  );
}

/** The sheet itself, drawn once for the whole section while it is open. */
export function SettingsDock({ locale, look = false }: { locale: WorkspaceLocale; look?: boolean }) {
  const sheet = useSettingsSheet();
  return sheet.open ? <SettingsSheet locale={locale} onClose={sheet.close} look={look} /> : null;
}
