"use client";

import { createContext, useContext } from "react";

/* What the Owner has picked, shared by the three tabs: an event opened on
   the aggregator's Home, a market and an outcome chosen in the console or
   the Ryntra walk. Ids only — every tab reads the live data for itself. */
export type LabSelection = {
  eventId: string | null;
  marketId: string | null;
  outcomeId: string | null;
};

export type LabContextValue = {
  selection: LabSelection;
  setSelection: (next: LabSelection | ((current: LabSelection) => LabSelection)) => void;
  appId: string;
  theme: "light" | "dark";
};

export const LabContext = createContext<LabContextValue | null>(null);

export function useLab(): LabContextValue {
  const value = useContext(LabContext);
  if (!value) throw new Error("useLab outside of the AGG lab");
  return value;
}
