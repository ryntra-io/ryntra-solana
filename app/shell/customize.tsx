"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CaretDown, SlidersHorizontal } from "@phosphor-icons/react";

import { useShell } from "./shell-state";
import { fill, useShellCopy, type ShellChromeCopy } from "./shell-copy";
import { orderedWidgets, useWidgetRegistry, widgetVisible } from "./widget";
import { DENSITIES, resolveDepth, type Density, type WorkspaceMode } from "./layout-store";

/**
 * The layout control.
 *
 * Everything here operates on state that already existed and had no way to be
 * reached — the mode, the hidden set, the order and the reset. A preference
 * layer with no controls is not a feature, it is dead code with a storage key.
 *
 * Reordering is two buttons, not a drag handle. No drag library is installed,
 * the brief says not to add a heavy one in a bounded run, and a faked drag that
 * only works with a mouse would be worse than a pair of buttons that work with
 * a keyboard, a screen reader and a touchscreen alike. Docking stays a named
 * follow-up rather than a half-built gesture.
 *
 * Nothing moves while the panel is closed. Layout changes are something the
 * operator asks for, never something that happens under their hands mid-task.
 */

/**
 * The two depths, in the product's own words.
 *
 * This menu offered three — `Guided | Standard | Pro` — while every visible
 * switch in the product offered two, `Simple | Pro`, and the product fixes the
 * user-facing vocabulary at the second pair. That was survivable while the menu
 * was the secondary control. It stopped being survivable on 2026-08-24, when
 * the depth switch left the top bar and this became the only place a person can
 * change depth: a lone control has to speak the product's language, and it has
 * to not offer a middle value that no other surface can render.
 *
 * `standard` is still a legal stored value and still resolves — through
 * `resolveDepth`, to Pro. It is simply no longer something a person can choose,
 * which is what it already was everywhere else.
 */
const DEPTH_CHOICES = ["guided", "pro"] as const satisfies readonly WorkspaceMode[];

/**
 * The two depth choices, in whatever language the workspace speaks.
 *
 * This was a module-level literal, which is what made the whole menu English on
 * a Ukrainian workspace: `Depth`, `Simple`, `Density`, `Comfortable`, `Panels`,
 * `Reset layout` — one popover, one click from all twenty-eight surfaces of one hub,
 * not one word of it translated. `standard` is gone from the map because it is
 * gone from `DEPTH_CHOICES`; it is still a legal stored value and still
 * resolves through `resolveDepth`, which is the only place that needs to know.
 */
const modeCopy = (copy: ShellChromeCopy["layout"]) =>
  ({
    guided: { name: copy.simple, body: copy.simpleBody },
    pro: { name: copy.pro, body: copy.proBody },
  }) satisfies Record<(typeof DEPTH_CHOICES)[number], { name: string; body: string }>;

/**
 * This menu answers *how does this workspace lay out* — mode, density, panels.
 * It no longer answers *how does the product look*.
 *
 * Appearance lived here for one day and the reason was sound: a person
 * opened the workspace, could not find the light theme, and concluded it did
 * not exist. A preference is absent if a person cannot reach it. But the cause
 * was never the destination — it was that **Settings was missing from three
 * rails of six**, so "in Settings" meant "nowhere" on the workspace they were
 * standing in. Pinning Settings bottom-left everywhere fixes the finding at its
 * root; putting appearance in four places fixed the symptom and created three
 * more controls writing one preference.
 *
 * Density and panels stay because they are per workspace. Appearance follows
 * the person across all of them, so it has exactly one home.
 */
const densityCopy = (copy: ShellChromeCopy["layout"]) =>
  ({
    comfortable: { name: copy.comfortable, body: copy.comfortableBody },
    compact: { name: copy.compact, body: copy.compactBody },
  }) satisfies Record<Density, { name: string; body: string }>;

/**
 * `showMode` exists because a workspace may put the depth control in the top bar
 * where it can be seen, and two controls writing one preference is worse than
 * either alone: the Stellar Hub shipped a visible `Guided | Pro` switch beside
 * this menu's three-value `Guided | Standard | Pro`, both calling `setMode`, and
 * choosing Standard here left the visible switch reading Guided. A person cannot
 * be expected to know which of two controls is telling the truth.
 */
export function CustomizeMenu({ showMode = true }: { showMode?: boolean } = {}) {
  const { prefs, setMode, setDensity, toggleWidget, moveWidget, reset } = useShell();
  const { layout: copy } = useShellCopy();
  const MODE_COPY = modeCopy(copy);
  const DENSITY_COPY = densityCopy(copy);
  const { widgets } = useWidgetRegistry();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
        setConfirmReset(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      setConfirmReset(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const ordered = orderedWidgets(widgets, prefs.order);
  const ids = ordered.map((widget) => widget.id);
  const guided = resolveDepth(prefs.mode) === "guided";
  const pro = !guided;

  return (
    /* `rs-menu` is the positioning context every other menu in this shell uses.
       Without it the panel below had nothing to anchor to. */
    <div className="rs-switch rs-menu" data-align="start" ref={boxRef}>
      <button
        type="button"
        className="rs-view-theme"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        title={copy.triggerTitle}
      >
        <SlidersHorizontal size={17} weight="bold" aria-hidden />
        <span className="rs-view-theme-label">{copy.trigger}</span>
        <CaretDown className="rs-view-caret" size={11} weight="bold" aria-hidden />
      </button>

      {open ? (
        /* `rs-menu-panel`, not `rs-switch-panel`.
         *
         * `.rs-switch-panel` is styled **nowhere in this repository** — no
         * background, no border, no shadow, no position. This menu has been
         * rendering as bare text lying over the page since the shell was built,
         * and it read as a broken component rather than as a missing rule. It
         * survived because nothing measures a popover: it typechecks, it has no
         * failing test, and the only way to see it is to open the menu and look.
         * A check of the Appearance control opened it, and it
         * was the first thing on the screen. */
        <div className="rs-menu-panel rs-customize" role="menu" aria-label={copy.triggerTitle}>
          {showMode ? (
            <>
              <p className="rs-menu-heading">{copy.depth}</p>
              <div className="rs-modes" role="radiogroup" aria-label={copy.depthGroup}>
                {DEPTH_CHOICES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={resolveDepth(prefs.mode) === mode}
                    className="rs-mode"
                    onClick={() => setMode(mode)}
                  >
                    <b>{MODE_COPY[mode].name}</b>
                    <small>{MODE_COPY[mode].body}</small>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <p className="rs-menu-heading">{copy.density}</p>
          <div className="rs-modes" role="radiogroup" aria-label={copy.densityGroup}>
            {DENSITIES.map((density) => (
              <button
                key={density}
                type="button"
                role="radio"
                aria-checked={prefs.density === density}
                className="rs-mode"
                onClick={() => setDensity(density)}
              >
                <b>{DENSITY_COPY[density].name}</b>
                <small>{DENSITY_COPY[density].body}</small>
              </button>
            ))}
          </div>

          <p className="rs-menu-heading">{guided ? copy.panelsFixed : copy.panelsEditable}</p>

          {ordered.length === 0 ? (
            <p className="rs-customize-empty">{copy.empty}</p>
          ) : (
            <ul className="rs-panels">
              {ordered.map((widget, index) => {
                const visible = widgetVisible(widget, prefs.mode, prefs.hidden);
                return (
                  <li className="rs-panel-row" key={widget.id}>
                    <label className="rs-panel-toggle">
                      <input
                        type="checkbox"
                        checked={visible}
                        disabled={Boolean(widget.essential) || guided}
                        onChange={() => toggleWidget(widget.id)}
                      />
                      <span>{widget.title}</span>
                    </label>

                    {widget.essential ? (
                      <span className="rs-tag">{copy.alwaysOn}</span>
                    ) : guided && widget.advanced ? (
                      <span className="rs-tag">{copy.advanced}</span>
                    ) : null}

                    {pro ? (
                      <span className="rs-panel-move">
                        <button
                          type="button"
                          onClick={() => moveWidget(widget.id, -1, ids)}
                          disabled={index === 0}
                          aria-label={fill(copy.moveUp, { panel: widget.title })}
                        >
                          <ArrowUp size={13} weight="bold" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveWidget(widget.id, 1, ids)}
                          disabled={index === ordered.length - 1}
                          aria-label={fill(copy.moveDown, { panel: widget.title })}
                        >
                          <ArrowDown size={13} weight="bold" aria-hidden />
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="rs-customize-foot">
            {confirmReset ? (
              <>
                <span>{copy.resetAsk}</span>
                <button
                  type="button"
                  className="rs-reset rs-reset--go"
                  onClick={() => {
                    reset();
                    setConfirmReset(false);
                  }}
                >
                  {copy.resetGo}
                </button>
                <button type="button" className="rs-reset" onClick={() => setConfirmReset(false)}>
                  {copy.resetCancel}
                </button>
              </>
            ) : (
              <>
                <span>{copy.savedLocally}</span>
                <button type="button" className="rs-reset" onClick={() => setConfirmReset(true)}>
                  {copy.resetLayout}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
