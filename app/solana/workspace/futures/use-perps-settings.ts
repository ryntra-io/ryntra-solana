"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

import { PERPS_WIDTH_MAX, perpsWidthOf, type PerpsWidth } from "./perps-layout";
import { DEFAULT_PERPS_SETTINGS, PERPS_SETTINGS_KEY, parsePerpsSettings, type PerpsSettings } from "./perps-settings";

/** The terminal's settings, kept in this browser (`PERPS_SETTINGS_KEY`); until read — the defaults. */
export function usePerpsSettings(): [PerpsSettings, (next: PerpsSettings) => void] {
  const [settings, setSettings] = useState<PerpsSettings>(DEFAULT_PERPS_SETTINGS);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PERPS_SETTINGS_KEY);
      if (stored) setSettings(parsePerpsSettings(JSON.parse(stored)));
    } catch {
      /* A denied store or a broken record keeps the defaults. */
    }
  }, []);
  const set = useCallback((next: PerpsSettings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(PERPS_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* Nothing to keep. */
    }
  }, []);
  return [settings, set];
}

/** The window's class of width (`perpsWidthOf`), decided before the first paint and followed as the window changes. */
export function usePerpsWidth(): PerpsWidth {
  const [width, setWidth] = useState<PerpsWidth>("desk");
  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const queries = Object.values(PERPS_WIDTH_MAX).map((max) => window.matchMedia(`(max-width: ${max}px)`));
    const set = () => setWidth(perpsWidthOf(window.innerWidth));
    set();
    for (const query of queries) query.addEventListener("change", set);
    return () => {
      for (const query of queries) query.removeEventListener("change", set);
    };
  }, []);
  return width;
}

/** An element's own width, followed as it changes (a panel dragged wider, a window turned); null until measured. */
export function useOwnWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setWidth(box.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
