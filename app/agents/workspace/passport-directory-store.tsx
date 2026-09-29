"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AgentPassport } from "@/lib/agent-control/agent-passport";
import { verifyBrowserAgentPassport } from "@/lib/agent-control/agent-passport-browser";
import {
  parseAgentPassportDirectory,
  rememberAgentPassport,
} from "@/lib/agent-control/passport-directory";

export const AGENT_PASSPORT_DIRECTORY_STORAGE_KEY = "ryntra:agent-passports:tab:v1";

type DirectoryRetention = "SESSION" | "MEMORY_ONLY";
type RememberResult = DirectoryRetention | "REJECTED";

type PassportDirectoryValue = Readonly<{
  ready: boolean;
  records: readonly AgentPassport[];
  retention: DirectoryRetention;
  remember: (passport: AgentPassport) => Promise<RememberResult>;
  remove: (address: string) => void;
  clear: () => void;
}>;

const PassportDirectoryContext = createContext<PassportDirectoryValue | null>(null);

export function PassportDirectoryProvider({ children }: { children: ReactNode }) {
  const recordsRef = useRef<readonly AgentPassport[]>([]);
  const [records, setRecords] = useState<readonly AgentPassport[]>([]);
  const [retention, setRetention] = useState<DirectoryRetention>("SESSION");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const restored = await parseAgentPassportDirectory(
          window.sessionStorage.getItem(AGENT_PASSPORT_DIRECTORY_STORAGE_KEY),
        );
        if (!active) return;
        recordsRef.current = restored;
        setRecords(restored);
      } catch {
        if (active) setRetention("MEMORY_ONLY");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: readonly AgentPassport[]): DirectoryRetention => {
    try {
      window.sessionStorage.setItem(AGENT_PASSPORT_DIRECTORY_STORAGE_KEY, JSON.stringify(next));
      setRetention("SESSION");
      return "SESSION";
    } catch {
      setRetention("MEMORY_ONLY");
      return "MEMORY_ONLY";
    }
  }, []);

  const remember = useCallback(async (passport: AgentPassport): Promise<RememberResult> => {
    try {
      if (!(await verifyBrowserAgentPassport(passport))) return "REJECTED";
    } catch {
      return "REJECTED";
    }
    const next = rememberAgentPassport(recordsRef.current, passport);
    recordsRef.current = next;
    setRecords(next);
    return persist(next);
  }, [persist]);

  const remove = useCallback((address: string) => {
    const next = recordsRef.current.filter((entry) => entry.request.address !== address);
    recordsRef.current = next;
    setRecords(next);
    persist(next);
  }, [persist]);

  const clear = useCallback(() => {
    recordsRef.current = [];
    setRecords([]);
    try {
      window.sessionStorage.removeItem(AGENT_PASSPORT_DIRECTORY_STORAGE_KEY);
      setRetention("SESSION");
    } catch {
      setRetention("MEMORY_ONLY");
    }
  }, []);

  const value = useMemo<PassportDirectoryValue>(() => ({
    ready,
    records,
    retention,
    remember,
    remove,
    clear,
  }), [clear, ready, records, remember, remove, retention]);

  return (
    <PassportDirectoryContext.Provider value={value}>
      {children}
    </PassportDirectoryContext.Provider>
  );
}

export function usePassportDirectory(): PassportDirectoryValue {
  const value = useContext(PassportDirectoryContext);
  if (!value) throw new Error("usePassportDirectory must run inside PassportDirectoryProvider.");
  return value;
}
