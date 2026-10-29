/**
 * «Доручення»'s runtime on the server (AI-19): the asker the pass uses — the
 * assistant's own session and message path for one wallet, with the
 * dependencies a request of that wallet would get.
 */

import { agentDepsFor } from "@/app/api/v1/agent/runtime";
import { reserveTaskRun, resolveAgentBudgetConfig } from "@/lib/agent/budget";
import { handleAgentMessage, openAgentSession } from "@/lib/agent/service";
import type { GuardStore } from "@/lib/guard/store";
import { onlyRows } from "@/lib/assistant/watch/runtime.server";
import { deliverOutbox } from "@/lib/monitoring/service.server";

import { runTaskPass, type TaskAsker, type TaskPassReport } from "./run";

const TASKS_CONTEXT = { kind: "page", page: "tasks" } as const;

/** The cron's own request carries the deployment's origin: the holdings read goes to the same deployment, in-process. */
export function askerFor(request: Request): (owner: string) => Promise<TaskAsker> {
  return async (owner) => {
    const deps = await agentDepsFor(request, owner);
    return {
      async openSession(who, input) {
        /* The runs go into a conversation of their own (`page: tasks`): never the person's own, which the page opens. */
        const context = TASKS_CONTEXT;
        if (input.sessionId) {
          const opened = await openAgentSession(deps, { owner: who, locale: input.locale, context, sessionId: input.sessionId });
          if (opened.ok && opened.response.session.context?.kind === "page" && opened.response.session.context.page === "tasks") return opened.response.session.id;
        }
        /* The task's conversation expired (90 days), was never there, or is not a task's: a fresh one. */
        const fresh = await openAgentSession(deps, { owner: who, locale: input.locale, context, fresh: true });
        return fresh.ok ? fresh.response.session.id : null;
      },
      async ask(who, input) {
        const result = await handleAgentMessage(deps, { owner: who, sessionId: input.sessionId, text: input.text, locale: input.locale, acceptCredits: input.acceptCredits });
        return result.ok ? { ok: true, response: result.response } : { ok: false, code: result.code };
      },
    };
  };
}

export async function runTasks(store: GuardStore, request: Request): Promise<TaskPassReport> {
  const config = resolveAgentBudgetConfig();
  return runTaskPass({ store, nowMs: Date.now(), asker: askerFor(request), pool: () => reserveTaskRun(store, config, Date.now()), deliver: (rows, atMs) => deliverOutbox(onlyRows(store, rows), atMs) });
}
