"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";

/**
 * The shell's popover.
 *
 * One dismiss behaviour for every menu in the chrome: outside pointer, Escape,
 * and route-independent — a panel closes because the person closed it, not
 * because something else re-rendered.
 *
 * It exists because the shell had two of these and one hub had a third. The
 * workspace switcher wrote its own listeners, that hub's `HubMenu` wrote a different
 * set with its own focus handling, and the two disagreed about Escape while a
 * request was open. The standard is explicit that the hub's menu is a behavioural
 * seed and not the universal component, so this is the seed replanted rather
 * than the hub's file promoted: no locale catalog, no Hub styling, no product
 * vocabulary. A trigger, a panel, and the three ways out of it.
 *
 * `children` is a render function receiving `close`, so a panel action can
 * dismiss the panel it lives in without every panel wiring its own state up to
 * this component.
 */
export function ShellMenu({
  boxClass,
  label,
  ariaLabel,
  panelTitle,
  triggerId,
  triggerClass,
  triggerState,
  icon,
  caret = true,
  align = "end",
  children,
}: {
  /** Class on the positioned wrapper. The responsive sheet rules key off it. */
  boxClass?: string;
  /** What the trigger shows. */
  label: ReactNode;
  /** The accessible name, when the visible label is not a sentence. */
  ariaLabel?: string;
  /** The panel's accessible name. */
  panelTitle: string;
  /** Optional stable handoff target for an in-page action that opens this menu. */
  triggerId?: string;
  triggerClass?: string;
  /** Rendered as `data-state`, so one class can carry every visual state. */
  triggerState?: string;
  icon?: ReactNode;
  caret?: boolean;
  /** Which edge the panel hangs from. Far-right controls need `end`. */
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    /* Bound only while open. The previous switcher kept two document listeners
       alive for the entire session on every workspace route, which is cheap
       once and not cheap when every control in the bar owns a pair. */
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={boxClass ? `rs-menu ${boxClass}` : "rs-menu"} ref={boxRef} data-align={align}>
      <button
        id={triggerId}
        type="button"
        className={triggerClass ? `rs-menu-trigger ${triggerClass}` : "rs-menu-trigger"}
        data-state={triggerState}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {icon ? (
          <span className="rs-menu-ic" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="rs-menu-label">{label}</span>
        {caret ? <CaretDown size={12} weight="bold" aria-hidden /> : null}
      </button>

      {open ? (
        <div className="rs-menu-panel" id={panelId} role="menu" aria-label={panelTitle}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** A label/value line inside a panel. Values are mono; labels are not. */
export function MenuRow({
  label,
  value,
  prose,
}: {
  label: string;
  value: ReactNode;
  /** Prose values are set in the UI face rather than mono — network names, states. */
  prose?: boolean;
}) {
  return (
    <div className="rs-menu-row">
      <dt className="rs-menu-row-label">{label}</dt>
      <dd className="rs-menu-row-value" data-prose={prose ? "true" : undefined}>
        {value}
      </dd>
    </div>
  );
}
