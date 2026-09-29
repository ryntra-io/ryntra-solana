/* localStorage persistence for indicator instances. SSR-safe, tolerant of
   corrupt/stale payloads: invalid instances are dropped, never crash the chart. */

import { INDICATOR_DEFS, defaultParams } from "./defs";
import type { IndicatorInstance, IndicatorType } from "./defs";

export type IndicatorNamespace = "demo" | "swap" | "spot";

const VERSION = 1;

const storageKey = (ns: IndicatorNamespace) => `ryntra-chart-indicators:${ns}`;

function sanitizeInstance(raw: unknown): IndicatorInstance | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.type !== "string" || !(r.type in INDICATOR_DEFS)) return null;
  const type = r.type as IndicatorType;
  if (typeof r.color !== "string" || r.color.length === 0) return null;
  if (typeof r.params !== "object" || r.params === null) return null;

  // Start from defaults so schema drift (added params) heals itself.
  const params = defaultParams(type);
  for (const p of INDICATOR_DEFS[type].params) {
    const v = (r.params as Record<string, unknown>)[p.key];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    params[p.key] = Math.min(p.max, Math.max(p.min, v));
  }

  const lineWidth = r.lineWidth === 1 || r.lineWidth === 2 || r.lineWidth === 3 ? r.lineWidth : 2;
  return {
    id: r.id,
    type,
    params,
    color: r.color,
    lineWidth,
    visible: typeof r.visible === "boolean" ? r.visible : true,
  };
}

export function loadIndicators(ns: IndicatorNamespace): IndicatorInstance[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(ns));
    if (!raw) return [];
    const envelope: unknown = JSON.parse(raw);
    if (typeof envelope !== "object" || envelope === null) return [];
    const e = envelope as { v?: unknown; instances?: unknown };
    if (e.v !== VERSION || !Array.isArray(e.instances)) return [];
    const out: IndicatorInstance[] = [];
    for (const item of e.instances) {
      const inst = sanitizeInstance(item);
      if (inst) out.push(inst);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveIndicators(ns: IndicatorNamespace, instances: IndicatorInstance[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(ns), JSON.stringify({ v: VERSION, instances }));
  } catch {
    // quota / privacy mode — persistence is best-effort
  }
}
