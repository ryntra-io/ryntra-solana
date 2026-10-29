"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Icon, PRESETS, applyLookTheme, lookFromCookie, words, writeLookCookie, DEFAULT_LOOK, type ThemePreference, type WorkspaceHandle } from "@ryntra/core/ui";

import { FUTURES_TIMEFRAMES, type FuturesTimeframe } from "@/lib/phoenix/market-data";

import type { PerpsWidth } from "./perps-layout";
import { PERPS_GUARDS, PERPS_MODES, PERPS_ORDER_TYPES, PERPS_SCALES, type PerpsSettings } from "./perps-settings";
import { perpsWord, type PerpsWordKey } from "./perps-words";

import styles from "./perps.module.css";

type Lang = "en" | "uk";

/**
 * «Скинути макет» with what it does and what it leaves alone (spec §4): the panels go back to this width's «Стандарт»;
 * orders, positions and collateral are not touched. One press asks, the second resets.
 */
export function ResetLayout({ handle, lang, onDone }: { handle: WorkspaceHandle | null; lang: Lang; onDone?: () => void }) {
  const w = (key: PerpsWordKey) => perpsWord(lang, key);
  const [asking, setAsking] = useState(false);
  const note = useId();
  if (!asking) {
    return (
      <button type="button" className={styles.moreItem} disabled={!handle || handle.standard === true} onClick={() => setAsking(true)} data-perps-reset>
        {w("reset.title")}
      </button>
    );
  }
  return (
    <div className={styles.resetAsk} role="group" aria-describedby={note} data-perps-reset-ask>
      <p id={note}>{w("reset.note")}</p>
      <div className={styles.resetActions}>
        <button
          type="button"
          className={styles.primaryChip}
          autoFocus
          onClick={() => {
            handle?.reset();
            setAsking(false);
            onDone?.();
          }}
          data-perps-reset-do
        >
          {w("reset.do")}
        </button>
        <button type="button" className={styles.quietChip} onClick={() => setAsking(false)}>
          {w("reset.cancel")}
        </button>
      </div>
    </div>
  );
}

/** One choice of a few, as a row of pressed buttons: every option says its own name, the chosen one is pressed. */
function Choice<T extends string | number>({ label, value, options, onChange, note }: { label: string; value: T; options: readonly { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (next: T) => void; note?: string }) {
  const id = useId();
  return (
    <div className={styles.setRow}>
      <span className={styles.setLabel} id={id}>{label}</span>
      <div className={styles.segment} role="group" aria-labelledby={id}>
        {options.map((option) => (
          <button key={String(option.value)} type="button" aria-pressed={option.value === value} disabled={option.disabled} title={option.title} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      {note ? <p className={styles.setNote}>{note}</p> : null}
    </div>
  );
}

function Switch({ label, checked, onChange, disabled, note }: { label: string; checked: boolean; onChange?: (next: boolean) => void; disabled?: boolean; note?: string }) {
  return (
    <label className={styles.setSwitch}>
      <span>
        {label}
        {note ? <small>{note}</small> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-disabled={disabled || undefined} onChange={(event) => onChange?.(event.currentTarget.checked)} />
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={styles.setGroup}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** The theme kept for the whole of Ryntra (the core's look cookie), the density beside it untouched. */
function readTheme(): ThemePreference {
  return (typeof document === "undefined" ? null : lookFromCookie(document.cookie))?.theme ?? DEFAULT_LOOK.theme;
}

function writeTheme(theme: ThemePreference) {
  const look = lookFromCookie(document.cookie) ?? DEFAULT_LOOK;
  writeLookCookie({ ...look, theme });
  applyLookTheme(theme);
}

/**
 * «Налаштування термінала» ⚙ (spec §14): a side sheet, not a page — view, layout, chart, orders, protection, numbers and
 * accessibility. A change is seen at once; «Скасувати» brings back the settings as they were when the sheet opened
 * (a layout's reset or preset is done at once and stays). The protection group only shows: no warning that keeps money
 * from harm is a setting.
 */
export function PerpsSettingsSheet({
  open,
  onClose,
  lang,
  onLang,
  settings,
  onSettings,
  width,
  handle,
  timeframe,
  onTimeframe,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  onLang: (next: Lang) => void;
  settings: PerpsSettings;
  onSettings: (next: PerpsSettings) => void;
  width: PerpsWidth;
  handle: WorkspaceHandle | null;
  timeframe: FuturesTimeframe;
  onTimeframe: (next: FuturesTimeframe) => void;
}) {
  const w = (key: PerpsWordKey, fill?: Readonly<Record<string, string>>) => perpsWord(lang, key, fill);
  const ws = words(lang).workspace;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  /* What «Скасувати» brings back: the settings, the theme and the timeframe as the sheet found them. */
  const before = useRef<{ settings: PerpsSettings; theme: ThemePreference; timeframe: FuturesTimeframe; lang: Lang } | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_LOOK.theme);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      const current = readTheme();
      setTheme(current);
      before.current = { settings, theme: current, timeframe, lang };
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    } else if (!open && node.open) {
      node.close();
    }
    // The snapshot is taken as the sheet opens, not on every change made in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cancel = () => {
    const was = before.current;
    if (was) {
      onSettings(was.settings);
      if (was.theme !== theme) writeTheme(was.theme);
      if (was.timeframe !== timeframe) onTimeframe(was.timeframe);
      if (was.lang !== lang) onLang(was.lang);
    }
    onClose();
  };
  const set = (patch: Partial<PerpsSettings>) => onSettings({ ...settings, ...patch });
  /* The device's time zone, read in the browser: the server's would be another, and the page would not hydrate as drawn. */
  const [zone, setZone] = useState("");
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      data-perps-settings
    >
      <header className={styles.sheetHead}>
        <h2 id={title}>{w("set.title")}</h2>
        <button type="button" className={styles.iconButton} aria-label={w("set.cancel")} onClick={cancel}>
          <Icon name="x" size={18} />
        </button>
      </header>
      <div className={styles.sheetBody}>
        <Group title={w("set.view")}>
          <Choice
            label={w("set.theme")}
            value={theme}
            options={(["graphite", "porcelain", "system"] as const).map((value) => ({ value, label: w(`theme.${value}`) }))}
            onChange={(next) => {
              setTheme(next);
              writeTheme(next);
            }}
          />
          <Choice label={w("set.mode")} value={settings.mode} options={PERPS_MODES.map((value) => ({ value, label: w(`mode.${value}`) }))} onChange={(mode) => set({ mode, explained: true })} note={w("set.modeNote")} />
        </Group>

        <Group title={w("set.layout")}>
          {width === "phone" ? null : (
            <Choice
              label={w("set.preset")}
              value={handle?.preset ?? "clean"}
              options={PRESETS.map((id) => ({ value: id, label: ws.presets[id], disabled: !handle || !handle.available[id], title: id === "scalp" && handle && !handle.available.scalp ? w("layout.scalpOff") : undefined }))}
              onChange={(id) => handle?.choose(id)}
            />
          )}
          <div className={styles.setRow}>
            <span className={styles.setLabel}>{w("set.panels")}</span>
            {(handle?.blocks ?? []).map((block) => (
              <Switch key={block.id} label={typeof block.title === "string" ? block.title : block.id} checked={!block.hidden} onChange={() => handle?.toggle(block.id)} />
            ))}
          </div>
          <p className={styles.setNote}>{w("layout.kept", { width: w(`width.${width}`) })}</p>
          <ResetLayout handle={handle} lang={lang} />
        </Group>

        <Group title={w("set.chart")}>
          <Choice label={w("set.timeframe")} value={timeframe} options={FUTURES_TIMEFRAMES.map((value) => ({ value, label: value }))} onChange={onTimeframe} />
          <div className={styles.setRow}>
            <span className={styles.setLabel}>{w("set.lines")}</span>
            {(["positions", "orders", "draft"] as const).map((key) => (
              <Switch key={key} label={w(`lines.${key}`)} checked={settings.lines[key]} onChange={(next) => set({ lines: { ...settings.lines, [key]: next } })} />
            ))}
          </div>
        </Group>

        <Group title={w("set.orders")}>
          <Choice label={w("set.orderType")} value={settings.orderType} options={PERPS_ORDER_TYPES.map((value) => ({ value, label: w(value) }))} onChange={(orderType) => set({ orderType })} note={w("set.orderTypeNote")} />
        </Group>

        <Group title={w("set.protection")}>
          <p className={styles.setNote}>{w("set.protectionNote")}</p>
          {PERPS_GUARDS.map((guard) => (
            <Switch key={guard} label={w(`guard.${guard}`)} note={w("guard.on")} checked disabled />
          ))}
        </Group>

        <Group title={w("set.numbers")}>
          <Choice label={w("set.lang")} value={lang} options={(["uk", "en"] as const).map((value) => ({ value, label: w(`lang.${value}`) }))} onChange={onLang} />
          <p className={styles.setNote}>{w("set.time", { zone })}</p>
          <p className={styles.setNote}>{w("set.precision")}</p>
        </Group>

        <Group title={w("set.access")}>
          <Choice label={w("set.scale")} value={settings.scale} options={PERPS_SCALES.map((value) => ({ value, label: `${value} %` }))} onChange={(scale) => set({ scale })} />
          <Choice label={w("set.motion")} value={settings.motion} options={(["system", "reduce"] as const).map((value) => ({ value, label: w(`motion.${value}`) }))} onChange={(motion) => set({ motion })} />
          <Choice label={w("set.contrast")} value={settings.contrast} options={(["standard", "more"] as const).map((value) => ({ value, label: w(`contrast.${value}`) }))} onChange={(contrast) => set({ contrast })} />
          <Switch label={w("set.targets")} note={w("set.targetsNote")} checked={settings.targets === "large" || settings.mode === "simple" || width === "phone"} disabled={settings.mode === "simple" || width === "phone"} onChange={(next) => set({ targets: next ? "large" : "auto" })} />
        </Group>
      </div>
      <footer className={styles.sheetFoot}>
        <p className={styles.setNote}>{w("set.cancelNote")}</p>
        <div className={styles.resetActions}>
          <button type="button" className={styles.primaryChip} onClick={onClose} data-perps-settings-done>
            {w("set.done")}
          </button>
          <button type="button" className={styles.quietChip} onClick={cancel}>
            {w("set.cancel")}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
