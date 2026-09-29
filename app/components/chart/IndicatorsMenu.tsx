"use client";

/* Indicators popover: manage active indicator instances + add new ones.
   Presentational — the instance list lives in the parent ProChart. */

import { useEffect, useRef } from "react";
import { Eye, EyeSlash, Trash } from "@phosphor-icons/react";
import {
  INDICATOR_COLORS,
  INDICATOR_DEFS,
  instanceLabel,
  makeInstance,
  type IndicatorInstance,
  type ParamDef,
} from "@/lib/chart/indicators/defs";

/** Shared popover behavior: close on outside mousedown or Escape while open.
    Returns the ref to attach to the popover root. Also used by ChartSettingsPopover. */
export function useOutsideClose<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (!el || !(e.target instanceof Node) || el.contains(e.target)) return;
      // toggle buttons close their own popover via onClick — closing here too would re-open it
      if (e.target instanceof Element && e.target.closest("[data-pc-trigger]")) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return ref;
}

function clampParam(p: ParamDef, raw: number): number {
  const v = Math.min(p.max, Math.max(p.min, raw));
  const snapped = Math.round((v - p.min) / p.step) * p.step + p.min;
  return Number(Math.min(p.max, Math.max(p.min, snapped)).toFixed(4));
}

const LINE_WIDTHS = [1, 2, 3] as const;

export function IndicatorsMenu(props: {
  open: boolean;
  onClose(): void;
  instances: IndicatorInstance[];
  onChange(next: IndicatorInstance[]): void;
  hasVolume: boolean;
}) {
  const ref = useOutsideClose<HTMLDivElement>(props.open, props.onClose);
  if (!props.open) return null;

  const patch = (id: string, part: Partial<IndicatorInstance>) => {
    props.onChange(props.instances.map((i) => (i.id === id ? { ...i, ...part } : i)));
  };

  const cycleColor = (inst: IndicatorInstance) => {
    const idx = INDICATOR_COLORS.indexOf(inst.color);
    const next = INDICATOR_COLORS[(idx + 1) % INDICATOR_COLORS.length];
    patch(inst.id, { color: next });
  };

  return (
    <div className="pc-pop pc-indicators" ref={ref}>
      <div className="pc-pop-title">Active</div>
      {props.instances.length === 0 && <div className="pc-empty">No indicators yet.</div>}
      {props.instances.map((inst) => {
        const def = INDICATOR_DEFS[inst.type];
        return (
          <div key={inst.id} className="pc-ind-row">
            <button
              type="button"
              className="pc-dot"
              title="Change color"
              aria-label="Change color"
              style={{ background: inst.color }}
              onClick={() => cycleColor(inst)}
            />
            <span className="pc-ind-name">{instanceLabel(inst)}</span>
            {def.params.map((p) => (
              <input
                key={p.key}
                type="number"
                className="pc-num"
                title={p.label}
                aria-label={p.label}
                min={p.min}
                max={p.max}
                step={p.step}
                value={inst.params[p.key] ?? p.default}
                onChange={(e) => {
                  const n = e.currentTarget.valueAsNumber;
                  if (Number.isFinite(n)) patch(inst.id, { params: { ...inst.params, [p.key]: n } });
                }}
                onBlur={() => {
                  const cur = inst.params[p.key] ?? p.default;
                  const fixed = clampParam(p, cur);
                  if (fixed !== cur) patch(inst.id, { params: { ...inst.params, [p.key]: fixed } });
                }}
              />
            ))}
            <span className="pc-seg" role="group" aria-label="Line width">
              {LINE_WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={inst.lineWidth === w ? "on" : undefined}
                  title={`Line width ${w}`}
                  onClick={() => patch(inst.id, { lineWidth: w })}
                >
                  {w}
                </button>
              ))}
            </span>
            <button
              type="button"
              className="pc-mini"
              title={inst.visible ? "Hide" : "Show"}
              aria-label={inst.visible ? "Hide indicator" : "Show indicator"}
              onClick={() => patch(inst.id, { visible: !inst.visible })}
            >
              {inst.visible ? <Eye size={13} /> : <EyeSlash size={13} />}
            </button>
            <button
              type="button"
              className="pc-mini pc-mini-danger"
              title="Remove"
              aria-label="Remove indicator"
              onClick={() => props.onChange(props.instances.filter((i) => i.id !== inst.id))}
            >
              <Trash size={13} />
            </button>
          </div>
        );
      })}

      <div className="pc-pop-title pc-pop-title-gap">Add</div>
      {Object.values(INDICATOR_DEFS).map((def) => {
        const blocked = Boolean(def.requiresVolume) && !props.hasVolume;
        return (
          <button
            key={def.type}
            type="button"
            className="pc-add-row"
            disabled={blocked}
            title={blocked ? "Requires volume data" : `Add ${def.label}`}
            onClick={() => props.onChange([...props.instances, makeInstance(def.type, props.instances)])}
          >
            <span className="pc-dot" style={{ background: def.defaultColor }} />
            {def.label}
            <span className="pc-badge">{def.placement}</span>
          </button>
        );
      })}
    </div>
  );
}
