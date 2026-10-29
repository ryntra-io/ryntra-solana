"use client";

import "dockview-react/dist/styles/dockview.css";
import "@ryntra/core/terminal.css";

import { DotsThree, GearSix, Question, SquaresFour } from "@phosphor-icons/react";
import { Terminal, type TerminalPanel } from "@ryntra/core/terminal";
import { PRESETS, ShellContext, indexedDbLayoutStore, words, type ShellBridge, type WorkspaceHandle } from "@ryntra/core/ui";
import { useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { useFitHeight } from "@/app/components/chart/use-fit-height";
import type { FuturesTimeframe } from "@/lib/phoenix/market-data";

import { futuresWord } from "./futures-words";
import { perpsWord } from "./perps-words";
import { PERPS_PANELS, PERPS_STANDARDS, perpsLayoutPage, perpsLayoutStore, type PerpsPanelId, type PerpsWidth } from "./perps-layout";
import { PERPS_MODES, type PerpsMode, type PerpsSettings } from "./perps-settings";
import { PerpsSettingsSheet, ResetLayout } from "./perps-settings-sheet";

import styles from "./perps.module.css";

type Lang = "en" | "uk";

/**
 * The Perps terminal — the core's terminal (PERP-2): the chart, the book, the ticket, the positions, the orders, the
 * account and the markets as panels whose borders are dragged up, down and aside, and which in «Налаштувати» are moved,
 * split, put away and brought back; the arrangement kept in this browser, one for each width (PERP-6): a desk, a
 * narrow desk with the book as the chart's tab, a tablet, a phone ({@link PERPS_STANDARDS}). The page's own «Стандарт» is
 * where each starts and where «Скинути макет» leads; the presets stand under the head's «⋯», Simple and Pro and «⚙»
 * beside it. An act here never rebuilds the panels: what is typed in the ticket stays.
 */
export function PerpsTerminal({
  panels,
  head,
  lang,
  width,
  settings,
  onSettings,
  timeframe,
  onTimeframe,
  onLang,
}: {
  panels: Readonly<Record<PerpsPanelId, Readonly<{ title: string; children: ReactNode }>>>;
  head: (tools: ReactNode) => ReactNode;
  lang: Lang;
  width: PerpsWidth;
  settings: PerpsSettings;
  onSettings: (next: PerpsSettings) => void;
  timeframe: FuturesTimeframe;
  onTimeframe: (next: FuturesTimeframe) => void;
  onLang: (next: Lang) => void;
}) {
  const outer = useContext(ShellContext);
  const host = useRef<HTMLDivElement>(null);
  /* The terminal takes what the first screen leaves under the head. */
  useFitHeight(host, { target: "[data-perps-terminal]", variable: "--perps-terminal-h", min: 600, max: 2400, margin: 12 });

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
  /* The browser's copy, with the move from `v2` on the desk's first read. */
  const store = useMemo(() => perpsLayoutStore(indexedDbLayoutStore()), []);
  const page = perpsLayoutPage(width);

  const terminalPanels: TerminalPanel[] = PERPS_PANELS.map((spec) => {
    const panel = panels[spec.id as PerpsPanelId];
    return {
      ...spec,
      title: panel.title,
      children: (
        <div className={styles.dockBody} data-perps-panel={spec.id}>
          {panel.children}
        </div>
      ),
    };
  });

  const [sheet, setSheet] = useState(false);
  /* The first switch between Simple and Pro says what changes and what does not (spec §5). */
  const [explain, setExplain] = useState<PerpsMode | null>(null);
  const chooseMode = (mode: PerpsMode) => {
    if (mode === settings.mode) return;
    if (!settings.explained) setExplain(mode);
    onSettings({ ...settings, mode, explained: true });
  };

  const preset = handle?.preset ?? "clean";
  const ws = words(lang).workspace;
  const presetWord = ws.presets;
  const layoutWord = perpsWord(lang, "head.layout");
  const modeWord = perpsWord(lang, "mode.label");
  const hidden = handle?.blocks.filter((block) => block.hidden) ?? [];
  const close = (event: { currentTarget: HTMLElement }) => event.currentTarget.closest("details")?.removeAttribute("open");
  /* The head's tools: Simple and Pro, what Perps are, the settings, and the layout's «⋯» — the presets, the panels put
     away, «Налаштувати», «Скинути макет» — not in a row under the terminal, where a laptop's screen cuts it off. While
     panels are being arranged, «Готово» stands beside them. */
  const tools = (
    <div className={styles.headLayout}>
      {handle?.arranging ? (
        <button type="button" className={styles.doneChip} onClick={() => handle.arrange?.(false)} data-perps-arrange-done>
          {ws.arrangeDone}
        </button>
      ) : null}
      <div className={styles.segment} role="group" aria-label={modeWord} data-perps-modes>
        {PERPS_MODES.map((mode) => (
          <button key={mode} type="button" aria-pressed={settings.mode === mode} onClick={() => chooseMode(mode)} data-perps-mode-button={mode}>
            {perpsWord(lang, `mode.${mode}`)}
          </button>
        ))}
      </div>
      <details className={styles.more} data-perps-help>
        <summary className={styles.moreButton} aria-label={perpsWord(lang, "head.help")} title={perpsWord(lang, "head.help")}>
          <Question size={18} weight="bold" aria-hidden="true" />
        </summary>
        <div className={`${styles.moreMenu} ${styles.helpCard}`} role="note">
          <p>{futuresWord(lang, "help")}</p>
        </div>
      </details>
      <button type="button" className={styles.moreButton} aria-label={perpsWord(lang, "head.settings")} title={perpsWord(lang, "head.settings")} aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)} data-perps-settings-open>
        <GearSix size={18} weight="bold" aria-hidden="true" />
      </button>
      <details className={styles.more} data-perps-layout data-layout-preset={preset}>
        <summary className={styles.moreButton} aria-label={layoutWord} title={layoutWord}>
          <DotsThree size={18} weight="bold" aria-hidden="true" />
        </summary>
        <div className={styles.moreMenu} role="group" aria-label={layoutWord}>
          <p>
            <SquaresFour size={14} aria-hidden="true" /> {layoutWord}
          </p>
          {width === "phone"
            ? null
            : PRESETS.map((id) => {
                const available = handle ? handle.available[id] : id !== "scalp";
                return (
                  <button
                    key={id}
                    type="button"
                    className={styles.moreItem}
                    data-preset={id}
                    aria-pressed={preset === id}
                    disabled={!handle || !available}
                    title={id === "scalp" && !available ? perpsWord(lang, "layout.scalpOff") : undefined}
                    onClick={(event) => {
                      handle?.choose(id);
                      close(event);
                    }}
                  >
                    {presetWord[id]}
                  </button>
                );
              })}
          <hr className={styles.moreRule} />
          {hidden.map((block) => (
            <button
              key={block.id}
              type="button"
              className={styles.moreItem}
              data-perps-show={block.id}
              onClick={(event) => {
                handle?.toggle(block.id);
                close(event);
              }}
            >
              {`+ ${typeof block.title === "string" ? block.title : block.id}`}
            </button>
          ))}
          {width === "phone" ? null : (
            <button
              type="button"
              className={styles.moreItem}
              aria-pressed={handle?.arranging ?? false}
              disabled={!handle?.arrange}
              onClick={(event) => {
                handle?.arrange?.(!handle.arranging);
                close(event);
              }}
              data-perps-arrange
            >
              {handle?.arranging ? ws.arrangeDone : ws.arrange}
            </button>
          )}
          <ResetLayout handle={handle} lang={lang} onDone={() => document.querySelector("[data-perps-layout]")?.removeAttribute("open")} />
        </div>
      </details>
    </div>
  );

  return (
    <ShellContext.Provider value={bridge}>
      {head(tools)}
      {explain ? (
        <div className={styles.modeNote} role="status" data-perps-mode-note={explain}>
          <p>{perpsWord(lang, explain === "pro" ? "mode.explainPro" : "mode.explainSimple")}</p>
          <button type="button" className={styles.quietChip} onClick={() => setExplain(null)}>
            {perpsWord(lang, "mode.gotIt")}
          </button>
        </div>
      ) : null}
      <div ref={host} className={styles.terminalHost}>
        <div className={styles.terminal} data-perps-terminal data-perps-width={width}>
          <Terminal key={page} page={page} panels={terminalPanels} legacyPreset={null} standard={PERPS_STANDARDS[width]} store={store} lang={lang} />
        </div>
      </div>
      <PerpsSettingsSheet open={sheet} onClose={() => setSheet(false)} lang={lang} onLang={onLang} settings={settings} onSettings={onSettings} width={width} handle={handle} timeframe={timeframe} onTimeframe={onTimeframe} />
    </ShellContext.Provider>
  );
}
