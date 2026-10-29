"use client";

import { useCallback, useEffect, useState } from "react";

import type { WatchRuleDraft, WatchRuleInput, WatchSubject } from "@/lib/predictions/watch/rules";
import type { WatchSweep } from "@/lib/predictions/watch/run";

type DraftAnswer = Readonly<{ wallet: string; draft: (WatchRuleDraft & Readonly<{ complete: boolean }>) | null }>;

/**
 * The wallet's watches as the browser holds them.
 *
 * Reading never starts anything: the pass that judges the rules runs on the
 * server's own schedule, so what this shows is the same whether or not
 * anybody has the page open. *Check now* is the one call that asks for a pass,
 * and it is the person's own press.
 */
export function useWatch(wallet: string | null, enabled: boolean) {
  const [watch, setWatch] = useState<WatchSweep | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  const read = useCallback(async () => {
    if (!wallet || !enabled) {
      setWatch(null);
      return;
    }
    try {
      const response = await fetch("/api/predictions/watch", { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as WatchSweep;
      if (body.wallet === wallet) setWatch(body);
    } catch {
      /* Nothing invented on a failed read. */
    }
  }, [wallet, enabled]);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      if (!wallet) return null;
      const check = body.check === true;
      if (check) setChecking(true);
      else setBusy(true);
      try {
        const response = await fetch("/api/predictions/watch", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) return null;
        const answer = (await response.json()) as WatchSweep | DraftAnswer;
        if ("draft" in answer) return answer;
        if (answer.wallet === wallet) setWatch(answer);
        return answer;
      } catch {
        return null;
      } finally {
        if (check) setChecking(false);
        else setBusy(false);
      }
    },
    [wallet],
  );

  useEffect(() => {
    void read();
  }, [read]);

  const setRule = useCallback(async (rule: WatchRuleInput) => send({ set: rule }), [send]);
  const readWords = useCallback(
    async (words: string, subject: WatchSubject) => {
      const answer = await send({ words, subject });
      return answer && "draft" in answer ? answer.draft : null;
    },
    [send],
  );

  return {
    watch,
    busy,
    checking,
    refresh: read,
    setRule,
    readWords,
    pause: useCallback((ruleId: string, on: boolean) => void send({ ruleId, on }), [send]),
    remove: useCallback((ruleId: string) => void send({ remove: ruleId }), [send]),
    stopAll: useCallback(() => void send({ stop: true }), [send]),
    markRead: useCallback((ids: readonly string[] | true) => void send({ read: ids === true ? true : [...ids] }), [send]),
    checkNow: useCallback(() => void send({ check: true }), [send]),
  };
}
