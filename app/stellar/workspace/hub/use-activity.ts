"use client";

import { useCallback, useEffect, useState } from "react";

import { activityIsRetained, clearActivity, readActivity } from "@/lib/stellar/activity/store";
import type { StellarActivityRecord } from "@/lib/stellar/activity/record";

/**
 * The stored activity, read on the client only.
 *
 * `localStorage` does not exist on the server, so the first render is always the
 * empty list and the real one arrives in an effect. That is deliberate rather
 * than unfortunate: rendering a guessed history and replacing it on hydration is
 * the shape that makes a list flicker between two different truths.
 *
 * `ready` exists so a surface can tell "nothing has been read yet" apart from
 * "nothing is here", which are different screens — one is a moment, the other is
 * an empty state that has to sell the next step.
 *
 * The `storage` event keeps two tabs of the same workspace in agreement. Without
 * it, a payment made in one tab leaves the other tab's Attention panel confidently
 * showing a state the product has moved past — the same two-lists-that-must-agree
 * failure, one browser apart.
 */
export function useStellarActivity() {
  const [records, setRecords] = useState<readonly StellarActivityRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [retained, setRetained] = useState(true);

  const refresh = useCallback(() => {
    setRecords(readActivity());
    setRetained(activityIsRetained());
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("ryntra.stellar-activity")) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const clear = useCallback(() => {
    clearActivity();
    refresh();
  }, [refresh]);

  return { records, ready, retained, refresh, clear };
}
