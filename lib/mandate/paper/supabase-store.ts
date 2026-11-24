/**
 * The paper agents' store in the database (`./store.ts`): one call to one `public.agent_paper_*` function per
 * question, each gated by the app secret and each one transaction
 * (`supabase/migrations/20261120190100_agent_paper_week_v1.sql`). The transport is the server's usual one
 * (`../../supabase-rpc.ts` `rpcResult`, which adds the secret); a test passes its own.
 *
 * A transport failure, a refusal, a function that is not there (the migration not applied yet) or an answer that is not
 * the function's own shape is `PaperStoreUnavailable`: paper is not open, and nobody is told otherwise.
 */

import type { PaperAgent, PaperNetwork } from "./model.ts";
import { PaperStoreUnavailable, versionedOf, type AdmitAnswer, type PaperStore, type StartAnswer, type Versioned } from "./store.ts";

export type PaperStoreRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown>;
const isRecord = (value: unknown): value is Answer => !!value && typeof value === "object" && !Array.isArray(value);

export function createSupabasePaperStore(rpc: PaperStoreRpc): PaperStore {
  async function call(fn: string, args: Answer): Promise<Answer> {
    const answer = await rpc(fn, args);
    if (!answer.ok) throw new PaperStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new PaperStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new PaperStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }
  const docOf = (agent: PaperAgent) => ({ p_id: agent.id, p_network: agent.network, p_status: agent.status, p_doc: agent });
  return {
    async get(id) {
      const data = await call("agent_paper_get", { p_id: id });
      if (data.row === null || data.row === undefined) return null;
      const row = versionedOf(data.row);
      if (!row || row.agent.id !== id) throw new PaperStoreUnavailable("agent_paper_get: not a paper agent");
      return row;
    },
    async admit(who, network, limit) {
      const data = await call("agent_paper_admit", { p_network: network, p_who: who, p_limit: limit });
      const answer = data.answer;
      if (answer !== "ok" && answer !== "limited" && answer !== "busy" && answer !== "full") throw new PaperStoreUnavailable("agent_paper_admit: no answer");
      return answer as AdmitAnswer;
    },
    async start(agent, limit) {
      const data = await call("agent_paper_start", { ...docOf(agent), p_limit: limit });
      const answer = data.answer;
      if (answer !== "started" && answer !== "working" && answer !== "full") throw new PaperStoreUnavailable("agent_paper_start: no answer");
      return answer as StartAnswer;
    },
    async put(agent, version) {
      const data = await call("agent_paper_put", { ...docOf(agent), p_version: version });
      if (data.written !== true) return null;
      if (!Number.isInteger(data.version)) throw new PaperStoreUnavailable("agent_paper_put: no version");
      return data.version as number;
    },
    async due(network: PaperNetwork, limit) {
      const data = await call("agent_paper_due", { p_network: network, p_limit: limit });
      if (!Array.isArray(data.rows)) throw new PaperStoreUnavailable("agent_paper_due: no rows");
      /* A row that does not read is left out: nothing is traded for it. */
      return data.rows.map(versionedOf).filter((row): row is Versioned => row !== null);
    },
    async purge(days) {
      const data = await call("agent_paper_purge", { p_days: days });
      return Number.isInteger(data.gone) ? (data.gone as number) : 0;
    },
  };
}
