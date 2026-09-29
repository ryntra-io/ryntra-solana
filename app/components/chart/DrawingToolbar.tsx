"use client";

/* Vertical drawing toolbar for the pro chart. Presentational only —
   tool/side/magnet/visibility state lives in the parent ProChart. */

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CaretDown,
  CaretUp,
  ChartLineDown,
  ChartLineUp,
  Cursor,
  Eye,
  EyeSlash,
  LineVertical,
  Magnet,
  Minus,
  Rectangle,
  Ruler,
  Steps,
  TextT,
  Trash,
  TrendUp,
  type Icon,
} from "@phosphor-icons/react";
import type { ActiveTool } from "@/lib/chart/drawings/types";

const ICON = 16;

/* Lite mode shows the essentials; "More tools" expands the pro set. */
const LITE_TOOLS: { tool: ActiveTool; title: string; Ic: Icon }[] = [
  { tool: "select", title: "Select", Ic: Cursor },
  { tool: "trend", title: "Trend line", Ic: TrendUp },
  { tool: "hline", title: "Horizontal line", Ic: Minus },
  { tool: "text", title: "Text", Ic: TextT },
];

const PRO_TOOLS: { tool: ActiveTool; title: string; Ic: Icon }[] = [
  { tool: "ray", title: "Ray", Ic: ArrowUpRight },
  { tool: "vline", title: "Vertical line", Ic: LineVertical },
  { tool: "rect", title: "Rectangle", Ic: Rectangle },
  { tool: "fib", title: "Fib retracement", Ic: Steps },
  { tool: "ruler", title: "Ruler", Ic: Ruler },
];

const EXPANDED_KEY = "ryntra-tools-expanded";
/* Tools that live in the expanded section (pro tools + position drawings). */
const EXPANDED_ONLY: ReadonlySet<ActiveTool> = new Set<ActiveTool>([
  ...PRO_TOOLS.map((t) => t.tool),
  "position",
]);

export function DrawingToolbar(props: {
  activeTool: ActiveTool;
  onTool(t: ActiveTool): void;
  positionSide: "long" | "short";
  onPositionSide(s: "long" | "short"): void;
  magnet: boolean;
  onMagnet(b: boolean): void;
  visible: boolean;
  onVisible(b: boolean): void;
  onClearAll(): void;
}) {
  const [armed, setArmed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const disarmTimer = useRef<number | null>(null);

  /* seed from localStorage after mount (SSR-safe) */
  useEffect(() => {
    try {
      if (window.localStorage.getItem(EXPANDED_KEY) === "1") setExpanded(true);
    } catch { /* storage unavailable */ }
  }, []);

  const toggleExpanded = () => {
    const next = !expanded;
    /* Collapse guard: never hide the active tool's button — reset to select
       when collapsing while an expanded-section tool (or position) is active. */
    if (!next && EXPANDED_ONLY.has(props.activeTool)) props.onTool("select");
    setExpanded(next);
    try {
      window.localStorage.setItem(EXPANDED_KEY, next ? "1" : "0");
    } catch { /* storage unavailable */ }
  };

  const clearTimer = () => {
    if (disarmTimer.current !== null) {
      window.clearTimeout(disarmTimer.current);
      disarmTimer.current = null;
    }
  };
  const disarm = () => {
    clearTimer();
    setArmed(false);
  };
  useEffect(() => clearTimer, []);

  const handleTrash = () => {
    if (armed) {
      disarm();
      props.onClearAll();
      return;
    }
    clearTimer();
    setArmed(true);
    disarmTimer.current = window.setTimeout(() => {
      disarmTimer.current = null;
      setArmed(false);
    }, 2500);
  };

  const pickPosition = (side: "long" | "short") => {
    props.onPositionSide(side);
    props.onTool("position");
  };

  return (
    <div className="dt-toolbar" role="toolbar" aria-label="Drawing tools">
      {LITE_TOOLS.map(({ tool, title, Ic }) => (
        <button
          key={tool}
          type="button"
          title={title}
          aria-label={title}
          className={props.activeTool === tool ? "on" : undefined}
          onClick={() => props.onTool(tool)}
        >
          <Ic size={ICON} />
        </button>
      ))}
      <button
        type="button"
        title={expanded ? "Fewer tools" : "More tools"}
        aria-label={expanded ? "Fewer tools" : "More tools"}
        aria-expanded={expanded}
        className={expanded ? "on" : undefined}
        onClick={toggleExpanded}
      >
        {expanded ? <CaretUp size={ICON} /> : <CaretDown size={ICON} />}
      </button>
      {expanded ? (
        <>
          {PRO_TOOLS.map(({ tool, title, Ic }) => (
            <button
              key={tool}
              type="button"
              title={title}
              aria-label={title}
              className={props.activeTool === tool ? "on" : undefined}
              onClick={() => props.onTool(tool)}
            >
              <Ic size={ICON} />
            </button>
          ))}
          <button
            type="button"
            title="Long position"
            aria-label="Long position"
            className={
              "dt-long" +
              (props.activeTool === "position" && props.positionSide === "long" ? " on" : "")
            }
            onClick={() => pickPosition("long")}
          >
            <ChartLineUp size={ICON} />
          </button>
          <button
            type="button"
            title="Short position"
            aria-label="Short position"
            className={
              "dt-short" +
              (props.activeTool === "position" && props.positionSide === "short" ? " on" : "")
            }
            onClick={() => pickPosition("short")}
          >
            <ChartLineDown size={ICON} />
          </button>
        </>
      ) : null}
      <div className="dt-div" />
      <button
        type="button"
        title={props.magnet ? "Magnet: on" : "Magnet: off"}
        aria-label="Toggle magnet"
        className={props.magnet ? "on" : undefined}
        onClick={() => props.onMagnet(!props.magnet)}
      >
        <Magnet size={ICON} />
      </button>
      <button
        type="button"
        title={props.visible ? "Hide drawings" : "Show drawings"}
        aria-label="Toggle drawings visibility"
        className={props.visible ? undefined : "on"}
        onClick={() => props.onVisible(!props.visible)}
      >
        {props.visible ? <Eye size={ICON} /> : <EyeSlash size={ICON} />}
      </button>
      <button
        type="button"
        title={armed ? "Click again to delete all" : "Delete all drawings"}
        aria-label="Delete all drawings"
        className={armed ? "dt-danger" : undefined}
        onClick={handleTrash}
        onPointerLeave={() => {
          if (armed) disarm();
        }}
      >
        <Trash size={ICON} />
      </button>
    </div>
  );
}
