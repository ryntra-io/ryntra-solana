"use client";

import { useEffect, useState } from "react";

import type { RuleAssetRead } from "@/lib/api/v1/contract";

/**
 * What a rule on this mint would stand on (`GET /api/v1/rules/asset`, 1.31.0)
 * — read once the sheet opens on a token, and again every two minutes while
 * it stays open, so the floor and the facts of risk said before the button
 * are the server's own and never older than the page. Public data: no wallet
 * is read.
 */

export type RuleAssetState = Readonly<{
  status: "idle" | "loading" | "ready" | "refused" | "failed";
  read: RuleAssetRead | null;
  /** On `refused`: why no rule can name the mint, when nothing about it can be said. */
  message: string | null;
}>;

const IDLE: RuleAssetState = { status: "idle", read: null, message: null };
const REFRESH_MS = 120_000;

export function useRuleAsset(mint: string | null, enabled: boolean): RuleAssetState {
  const [state, setState] = useState<RuleAssetState>(IDLE);
  useEffect(() => {
    if (!enabled || !mint) {
      setState(IDLE);
      return undefined;
    }
    let live = true;
    const read = async (first: boolean) => {
      if (first) setState({ status: "loading", read: null, message: null });
      try {
        const response = await fetch(`/api/v1/rules/asset?mint=${encodeURIComponent(mint)}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" }, cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { read?: RuleAssetRead; error?: { code?: string; message?: string } } | null;
        if (!live) return;
        if (response.ok && body?.read) setState({ status: "ready", read: body.read, message: null });
        else if (body?.error?.code === "ASSET_UNCONFIRMED") setState({ status: "refused", read: null, message: body.error.message ?? null });
        /* A later read that fails keeps what the last one said: the facts stay dated by their own read. */
        else setState((current) => (current.status === "ready" ? current : { status: "failed", read: null, message: null }));
      } catch {
        if (live) setState((current) => (current.status === "ready" ? current : { status: "failed", read: null, message: null }));
      }
    };
    void read(true);
    const timer = window.setInterval(() => void read(false), REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [mint, enabled]);
  return state;
}
