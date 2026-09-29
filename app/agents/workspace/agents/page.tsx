import type { Metadata } from "next";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { agentWorkspaceLocale } from "../i18n/server";
import { AgentRadar } from "./agent-radar";

const COPY = {
  en: {
    title: "Agent Radar",
    description:
      "A tab-local evidence directory of exact-address Agent Passports, with claimed and observed capability states kept separate.",
  },
  uk: {
    title: "Agent Radar",
    description:
      "Локальний для вкладки каталог доказів Agent Passport за точними адресами, де заявлені та спостережені стани можливостей тримаються окремо.",
  },
} as const satisfies Record<WorkspaceLocale, { title: string; description: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.title, description: copy.description };
}

export default function AgentWorkspaceAgentsPage() {
  return <AgentRadar />;
}
