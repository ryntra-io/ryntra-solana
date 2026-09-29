import type { Metadata } from "next";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { agentWorkspaceLocale } from "../i18n/server";
import { WorkspacePassportExplorer } from "./workspace-passport-explorer";

const COPY = {
  en: {
    title: "Agent Passport",
    description:
      "Inspect source-labelled public Agentverse declarations, Ryntra read observations, conflicts and unknowns without leaving the workspace.",
  },
  uk: {
    title: "Agent Passport",
    description:
      "Оглядайте позначені за джерелами публічні декларації Agentverse, спостереження читань Ryntra, конфлікти та невідомі, не полишаючи робочого простору.",
  },
} as const satisfies Record<WorkspaceLocale, { title: string; description: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.title, description: copy.description };
}

export default function WorkspaceAgentPassportPage() {
  return (
    <div className="ag ag-workspace ag-workspace--passport">
      <WorkspacePassportExplorer />
    </div>
  );
}
