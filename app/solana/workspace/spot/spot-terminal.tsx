"use client";

import "dockview-react/dist/styles/dockview.css";
import "@ryntra/core/terminal.css";

import { SquaresFour } from "@phosphor-icons/react";
import { Terminal, type TerminalPanel } from "@ryntra/core/terminal";
import { PRESETS, ShellContext, words, type ShellBridge, type WorkspaceHandle } from "@ryntra/core/ui";
import { useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { useFitHeight } from "@/app/components/chart/use-fit-height";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { SPOT_LAYOUT_PAGE, SPOT_PANELS, spotDockUntouched, type SpotPanelId } from "./spot-layout.ts";

import styles from "./spot.module.css";

/**
 * Spot's workplace on a desk — the core's terminal (B16, decision 61): the chart, the ticket, the market's tabs, the
 * account's and «Про токен» as panels whose borders are dragged up, down and aside, and which in «Налаштувати» are moved,
 * split, put away and brought back; the arrangement kept in this browser and found again after a reload.
 *
 * The page opens in the core's «Стандарт» — the chart and the ticket (A15; SOL-C11, decision 63) — and the core's row
 * under the terminal brings the rest back («Додати панель») and «Повернути стандарт» in one act. The presets — «Стандарт ·
 * Спокійно · Щільно · Торгівля · Скальп» — stand under the strip's one «⋯» (and in the frame's «Налаштувати»).
 * «Торгівля» puts the menu away; Esc or the frame's button leaves it for the layout it was entered from. «Скальп» needs an
 * order book beside a reference book: a swap routed by Jupiter has no book, so it stays grey with its reason. A layout
 * kept when the desk opened on this page's «Щільно» and never arranged by hand moves to «Стандарт» once
 * ({@link spotDockUntouched}).
 *
 * An act here never rebuilds the panels: the terminal lays out a new arrangement itself, so what is typed in the ticket
 * stays.
 */
export function SpotTerminal({ panels, tools }: { panels: Readonly<Record<SpotPanelId, Readonly<{ title: string; children: ReactNode }>>>; tools: (bar: ReactNode) => ReactNode }) {
  const { text, locale } = useSolanaI18n();
  const outer = useContext(ShellContext);
  const host = useRef<HTMLDivElement>(null);
  /* The terminal takes what the first screen leaves under the strip. */
  useFitHeight(host, { target: "[data-spot-terminal]", variable: "--spot-terminal-h", min: 560, max: 2400, margin: 12 });

  /* The workspace tells the frame (the «Налаштувати» panel, the menu put away in «Торгівля») through this page, which
     keeps the handle for its own presets' button. */
  const [handle, setHandle] = useState<WorkspaceHandle | null>(null);
  const bridge = useMemo<ShellBridge>(
    () => ({
      attach: (inner) => {
        setHandle(inner);
        outer?.attach(inner);
      },
      focus: (exit, preset) => outer?.focus(exit, preset),
    }),
    [outer],
  );

  const terminalPanels: TerminalPanel[] = SPOT_PANELS.map((spec) => {
    const panel = panels[spec.id as SpotPanelId];
    return {
      ...spec,
      title: panel.title,
      children: (
        <div className={styles.dockBody} data-dock-panel={spec.id}>
          {panel.children}
        </div>
      ),
    };
  });

  const preset = handle?.preset ?? "clean";
  /* The presets in the core's own words, the same as the frame's «Налаштувати» names them. */
  const presetWord = words(locale === "uk" ? "uk" : "en").workspace.presets;
  /* The presets under the strip's one «⋯» (SOL-C12, UX-152) — the strip keeps its figures — and in the frame's
     «Налаштувати». «Повернути стандарт» is the core's row under the terminal. */
  const bar = (
    <div className={styles.layoutGroup} role="group" aria-label={text("Layout")} data-spot-layout data-layout-preset={preset}>
      <p>
        <SquaresFour size={14} aria-hidden="true" /> {text("Layout")}
      </p>
      {PRESETS.map((id) => {
        const available = handle ? handle.available[id] : id !== "scalp";
        return (
          <button
            key={id}
            type="button"
            className={styles.moreItem}
            data-preset={id}
            aria-pressed={preset === id}
            disabled={!handle || !available}
            onClick={() => handle?.choose(id)}
          >
            {presetWord[id]}
            {available ? null : <small>{text("needs an order book")}</small>}
          </button>
        );
      })}
    </div>
  );

  return (
    <ShellContext.Provider value={bridge}>
      {tools(bar)}
      <div ref={host} className={styles.terminalHost}>
        <div className={styles.terminal} data-spot-terminal>
          <Terminal page={SPOT_LAYOUT_PAGE} panels={terminalPanels} legacyPreset={null} dockUntouched={spotDockUntouched} lang={locale === "uk" ? "uk" : "en"} />
        </div>
      </div>
    </ShellContext.Provider>
  );
}
