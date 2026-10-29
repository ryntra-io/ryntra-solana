"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { LayoutStore } from "@ryntra/core/ui";

import { DEFAULT_PREFS, type PredictPrefs } from "@/lib/predictions/preferences";

/**
 * The person's settings as the prediction pages read them. The product's own
 * shell provides them (kept in a cookie and in the account); a shell that
 * provides nothing gets the defaults and nothing to change — the pages draw
 * the same either way.
 */
export type PredictPrefsControl = Readonly<{
  prefs: PredictPrefs;
  /** A change of the person's, kept at once in the browser and, signed in, in the account. */
  change: ((patch: Partial<Omit<PredictPrefs, "v" | "updatedAt" | "at">>) => void) | null;
  /** Where the market page's layouts are kept beside the browser's own copy; undefined — the browser alone. */
  layoutStore: LayoutStore | undefined;
  /** Whose layouts those are: the wallet's address, so another wallet reads its own. */
  layoutKey: string | undefined;
  /** Signed in with a wallet: the settings go to the account too. */
  signedIn: boolean;
  /** The account holds what this browser holds (false after a write that did not land). */
  synced: boolean;
  /** The settings sheet, when the shell has one. */
  openSettings: (() => void) | null;
}>;

const NONE: PredictPrefsControl = { prefs: DEFAULT_PREFS, change: null, layoutStore: undefined, layoutKey: undefined, signedIn: false, synced: true, openSettings: null };

const PrefsContext = createContext<PredictPrefsControl>(NONE);

export function PredictPrefsContext({ value, children }: { value: PredictPrefsControl; children: ReactNode }) {
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePredictPrefs(): PredictPrefsControl {
  return useContext(PrefsContext);
}
