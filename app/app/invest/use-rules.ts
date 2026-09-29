"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AutoinvestRule, RuleBudget, RuleBudgetRequest, RuleBudgetResponse, RuleCreateRequest, RuleListResponse, RuleResponse, RuleStatus } from "@/lib/api/v1/contract";

/**
 * The proven wallet's «Автоінвест» rules and the month's budget, read on a
 * company page and on Home (`RYN-INVEST-SIMPLE-001`, sessions 3–4). The rules
 * are the wallet's, so they are read only behind its proof — the `rw` cookie
 * the wallet signed — and a page without one says so rather than guessing.
 * Every write answers the rule or the budget as the server now holds it, and
 * the list is read again after it.
 */

const API_HEADERS = { accept: "application/json", "X-Ryntra-API": "1" } as const;

export type RulesState = Readonly<{ status: "idle" | "loading" | "ready" | "unproven" | "failed"; rules: readonly AutoinvestRule[]; budget: RuleBudget | null }>;
export type RuleWrite = Readonly<{ ok: true; rule: AutoinvestRule | null }> | Readonly<{ ok: false; code: string | null }>;
export type BudgetWrite = Readonly<{ ok: true; budget: RuleBudget | null }> | Readonly<{ ok: false; code: string | null }>;

async function readError(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code ?? null;
}

export function useAutoinvestRules(enabled: boolean) {
  const [state, setState] = useState<RulesState>({ status: "idle", rules: [], budget: null });
  const ticket = useRef(0);

  const reload = useCallback(async () => {
    const my = ++ticket.current;
    setState((current) => ({ status: current.status === "ready" ? "ready" : "loading", rules: current.rules, budget: current.budget }));
    try {
      const response = await fetch("/api/v1/rules", { headers: API_HEADERS, cache: "no-store" });
      if (ticket.current !== my) return;
      if (response.status === 401) {
        setState({ status: "unproven", rules: [], budget: null });
        return;
      }
      const body = (await response.json().catch(() => null)) as RuleListResponse | null;
      setState(response.ok && body ? { status: "ready", rules: body.rules, budget: body.budget ?? null } : { status: "failed", rules: [], budget: null });
    } catch {
      if (ticket.current === my) setState({ status: "failed", rules: [], budget: null });
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      ticket.current += 1;
      setState({ status: "idle", rules: [], budget: null });
      return;
    }
    void reload();
  }, [enabled, reload]);

  const send = useCallback(async (url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<Readonly<{ ok: true; answer: unknown }> | Readonly<{ ok: false; code: string | null }>> => {
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? API_HEADERS : { ...API_HEADERS, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) return { ok: false, code: await readError(response) };
      const answer = await response.json().catch(() => null);
      void reload();
      return { ok: true, answer };
    } catch {
      return { ok: false, code: null };
    }
  }, [reload]);

  const write = useCallback(
    async (url: string, method: "POST" | "DELETE", body?: unknown): Promise<RuleWrite> => {
      const sent = await send(url, method, body);
      return sent.ok ? { ok: true, rule: (sent.answer as Partial<RuleResponse> | null)?.rule ?? null } : sent;
    },
    [send],
  );

  const writeBudget = useCallback(
    async (method: "PUT" | "DELETE", body?: RuleBudgetRequest): Promise<BudgetWrite> => {
      const sent = await send("/api/v1/rules/budget", method, body);
      return sent.ok ? { ok: true, budget: (sent.answer as Partial<RuleBudgetResponse> | null)?.budget ?? null } : sent;
    },
    [send],
  );

  const create = useCallback((request: RuleCreateRequest) => write("/api/v1/rules", "POST", request), [write]);
  const setStatus = useCallback((ruleId: string, status: RuleStatus) => write(`/api/v1/rules/${encodeURIComponent(ruleId)}/status`, "POST", { status }), [write]);
  const remove = useCallback((ruleId: string) => write(`/api/v1/rules/${encodeURIComponent(ruleId)}`, "DELETE"), [write]);
  const setBudget = useCallback((request: RuleBudgetRequest) => writeBudget("PUT", request), [writeBudget]);
  const clearBudget = useCallback(() => writeBudget("DELETE"), [writeBudget]);
  /* 1.19.0: «Мій рахунок» — the other side of one counted payment is the person's own account; the rules come back as they stand after it. */
  const markOwn = useCallback(
    async (signature: string): Promise<RuleWrite> => {
      const sent = await send("/api/v1/rules/payments/own", "POST", { signature });
      return sent.ok ? { ok: true, rule: null } : sent;
    },
    [send],
  );

  return { state, reload, create, setStatus, remove, setBudget, clearBudget, markOwn };
}
