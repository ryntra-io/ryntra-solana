import type { Metadata } from "next";

import { agentWorkspaceLocale } from "@/app/agents/workspace/i18n/server";
import type { WorkspaceLocale } from "@/app/shell/locale";

import { ActionsView } from "./actions-view";

export const metadata: Metadata = {
  title: "Actions · Agent Control · Ryntra",
  description:
    "Every tab-local economic action with its policy verdict, owner authorization mode, required evidence and pessimistic budget impact.",
};

const COPY = {
  en: {
    eyebrow: "Agent Control / Actions",
    title: "Actions",
    lead: "One economic action at a time, from intent to outcome. The list and the inspector read the same case, so selecting a row moves both.",
    environment: "TAB LOCAL · NO SERVER RECORD · SAMPLE OWNER POLICY",
  },
  uk: {
    eyebrow: "Agent Control / Дії",
    title: "Дії",
    lead: "Одна економічна дія за раз — від наміру до результату. Список та інспектор читають той самий кейс, тож вибір рядка рухає обидва.",
    environment: "ЛОКАЛЬНО У ВКЛАДЦІ · БЕЗ СЕРВЕРНОГО ЗАПИСУ · ЗРАЗКОВА ПОЛІТИКА ВЛАСНИКА",
  },
} as const satisfies Record<
  WorkspaceLocale,
  { eyebrow: string; title: string; lead: string; environment: string }
>;

/*
 * Actions became a real screen in Phase 2B, so it no longer renders the shared
 * "no backend yet" surface. What it still says plainly is the part that has not
 * changed: the list is tab-local, and Phase 2C's durable authorization replay
 * does not turn this browser projection into a server record.
 */
export default async function AgentWorkspaceActionsPage() {
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
      <ActionsView />
    </div>
  );
}
