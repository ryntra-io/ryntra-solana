"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ActionPassportPreview } from "@/lib/agent-control/contracts";
import { buildActionCase, type ActionCase } from "@/lib/agent-control/action-case";

/*
 * The one selected Action Case, shared by every surface in the workspace.
 *
 * The audit's finding was that Simple, Pro, the Lab and the verifier were four
 * independent readings of the same artifact, so switching depth or route lost
 * whatever you were looking at. The provider is mounted in the workspace
 * layout, which does not remount when a child route changes — that is what
 * makes the selection survive navigation and the depth switch.
 *
 * **This is not persistence, and it must never be described as any.** Cases
 * live in this browser tab and nowhere else: `sessionStorage`, so a reload
 * keeps your place, and a new tab starts empty. Nothing reaches a server,
 * nothing survives the tab closing, and no other person can see it. Real
 * Phase 2C made authorization nonce/idempotency replay durable on the server;
 * it did not turn this UI convenience into an Action Case ledger. "Your place
 * is kept" and "the action is recorded" remain different promises.
 */

const KEY = "ryntra.agent-control.cases.v2";
/* Small on purpose. A tab-local list is a convenience, not a ledger, and a
   convenience that grows without bound is a memory leak wearing a feature's
   clothes. */
const LIMIT = 12;

type Store = {
  readonly cases: readonly ActionCase[];
  readonly selected: ActionCase | null;
  /** Project an artifact into a case and make it the selected one. */
  remember: (preview: ActionPassportPreview) => ActionCase;
  select: (id: string) => void;
  clear: () => void;
  /** True once the tab-local list has been read, so a screen can avoid flashing empty. */
  readonly ready: boolean;
};

const ActionCaseContext = createContext<Store | null>(null);

function readStored(): readonly ActionCase[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    /* Shape-checked rather than trusted: this string is user-writable through
       devtools, and a malformed case would crash a screen that reads it. Only
       the fields every surface depends on are required here; the projection
       itself is regenerated from the artifact whenever the Lab runs. */
    return parsed.filter(
      (item): item is ActionCase =>
        !!item &&
        typeof item === "object" &&
        typeof (item as ActionCase).id === "string" &&
        Array.isArray((item as ActionCase).stages) &&
        Array.isArray((item as ActionCase).evidenceItems) &&
        typeof (item as ActionCase).sample === "boolean" &&
        typeof (item as ActionCase).decision === "string",
    );
  } catch {
    /* A corrupt entry loses the tab's history and nothing else. */
    return [];
  }
}

export function ActionCaseProvider({ children }: { children: ReactNode }) {
  const [cases, setCases] = useState<readonly ActionCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStored();
    setCases(stored);
    setSelectedId(stored[0]?.id ?? null);
    setReady(true);
  }, []);

  const persist = useCallback((next: readonly ActionCase[]) => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* Private mode, a full quota, or a browser that refuses. The workspace
         keeps working from memory; only the reload-survival is lost. */
    }
  }, []);

  const remember = useCallback(
    (preview: ActionPassportPreview) => {
      const built = buildActionCase(preview);
      setCases((current) => {
        const next = [built, ...current.filter((item) => item.id !== built.id)].slice(0, LIMIT);
        persist(next);
        return next;
      });
      setSelectedId(built.id);
      return built;
    },
    [persist],
  );

  const select = useCallback((id: string) => setSelectedId(id), []);

  const clear = useCallback(() => {
    setCases([]);
    setSelectedId(null);
    persist([]);
  }, [persist]);

  const value = useMemo<Store>(
    () => ({
      cases,
      selected: cases.find((item) => item.id === selectedId) ?? cases[0] ?? null,
      remember,
      select,
      clear,
      ready,
    }),
    [cases, selectedId, remember, select, clear, ready],
  );

  return <ActionCaseContext.Provider value={value}>{children}</ActionCaseContext.Provider>;
}

/**
 * The store, or a working no-op outside the provider.
 *
 * Returning a null-object rather than throwing is deliberate: the public
 * `/agents/passport` and `/agents/verify` render the same components as their
 * workspace twins and are mounted outside this provider. A hook that threw
 * there would make the shared component un-shareable, which is the duplication
 * this phase exists to avoid.
 */
export function useActionCases(): Store {
  const store = useContext(ActionCaseContext);
  return (
    store ?? {
      cases: [],
      selected: null,
      remember: (preview) => buildActionCase(preview),
      select: () => {},
      clear: () => {},
      ready: true,
    }
  );
}
