import type { Metadata } from "next";

import { agentWorkspaceLocale } from "@/app/agents/workspace/i18n/server";
import type { WorkspaceLocale } from "@/app/shell/locale";

import { ActionInspector } from "./inspector";

export const metadata: Metadata = {
  title: "Action",
  description:
    "One economic action, from intent through evidence, policy, authorization and execution to the observed outcome.",
  robots: { index: false, follow: false },
};

const COPY = {
  en: {
    eyebrow: "Agent Control / Actions",
    title: "Action inspector",
    lead: "Intent, evidence, policy, risk, review, authorization, execution and outcome — eight views of one action rather than eight screens with their own data.",
    environment: "TAB LOCAL · NO SERVER RECORD",
  },
  uk: {
    eyebrow: "Agent Control / Дії",
    title: "Інспектор дії",
    lead: "Намір, докази, політика, ризик, перегляд, авторизація, виконання і результат — вісім поглядів на одну дію замість восьми екранів із власними даними.",
    environment: "ЛОКАЛЬНО У ВКЛАДЦІ · БЕЗ СЕРВЕРНОГО ЗАПИСУ",
  },
} as const satisfies Record<
  WorkspaceLocale,
  { eyebrow: string; title: string; lead: string; environment: string }
>;

/*
 * The Action Inspector's route.
 *
 * It answers rather than 404s for one reason: a link to an action must not be
 * the thing that breaks. Phase 2B gave it the Action Case to render. The id is
 * still resolvable only from this browser tab; durable authorization replay is
 * a different server-side security record, not a published case ledger.
 */
export default async function AgentActionPage({
  params,
}: {
  params: Promise<{ actionId: string }>;
}) {
  const { actionId } = await params;
  const locale = await agentWorkspaceLocale();
  const copy = COPY[locale];

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.environment}</span>
      </header>
      <ActionInspector actionId={actionId} />
    </div>
  );
}
