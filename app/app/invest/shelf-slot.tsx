"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { readShelfCopy, type ShelfCopyKind } from "./shelf-copy";

/**
 * Where a shelf streams in, and what stands there until it does.
 *
 * The live list is read on the server inside a Suspense boundary. On a first
 * load React leaves a pending boundary's fallback as plain server HTML — it
 * is never hydrated, so a fallback cannot read the browser's copy. The slot
 * therefore sits *around* the boundary: it hydrates at once, reads the copy
 * this browser kept of the last list it drew, shows it above the boundary
 * and hides the boundary's skeleton (`data-copy`, see `.slot` in the shared
 * sheet), until the live list mounts and says so. A read that failed says so
 * too, and the copy then stays without «Оновлюємо ціни…».
 */

type Slot = Readonly<{ markLive: () => void; markFailed: () => void }>;

const SlotContext = createContext<Slot>({ markLive: () => undefined, markFailed: () => undefined });

export function useShelfSlot<T>(kind: ShelfCopyKind, accept: (value: unknown) => value is T) {
  const [copy, setCopy] = useState<T | null>(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setCopy(readShelfCopy(kind, accept));
    // The copy is read once, on arrival; the guard is a stable module function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const markLive = useCallback(() => setLive(true), []);
  const markFailed = useCallback(() => setFailed(true), []);
  const slot = useMemo(() => ({ markLive, markFailed }), [markFailed, markLive]);
  return { copy: live ? null : copy, failed, slot };
}

export function ShelfSlotProvider({ slot, children }: { slot: Slot; children: React.ReactNode }) {
  return <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>;
}

/** The live list announces itself, and the copy steps aside. */
export function useLiveShelf(): void {
  const { markLive } = useContext(SlotContext);
  useEffect(() => {
    markLive();
  }, [markLive]);
}

/** A read that failed announces itself: a copy, if any, stays — without the promise of an update. */
export function useFailedShelf(): void {
  const { markFailed } = useContext(SlotContext);
  useEffect(() => {
    markFailed();
  }, [markFailed]);
}
