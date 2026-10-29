"use client";

import { createContext, useContext } from "react";

import type { LaunchMarketHealthResponse, LaunchMarketResponse } from "@/lib/api/v1/contract";

/**
 * The token's market and its health as the page read them, for the parts of the page the server draws — «Доказ запуску»
 * (SOL-L3) states what they hold with its links. Null while not read: nothing is stated from a read that is not there.
 */
export const LaunchReadContext = createContext<Readonly<{ market: LaunchMarketResponse | null; health: LaunchMarketHealthResponse | null }>>({ market: null, health: null });

export function useLaunchRead() {
  return useContext(LaunchReadContext);
}
