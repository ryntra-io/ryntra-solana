import type { Metadata } from "next";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { agentWorkspaceLocale } from "../i18n/server";
import { WorkspaceWorkbench } from "../workbench";

const COPY = {
  en: {
    title: "Action Passport Lab",
    description:
      "Change one bounded sample intent, run deterministic policy preflight and export an Action Passport Preview. No wallet, provider action or blockchain transaction.",
  },
  uk: {
    title: "Лабораторія Action Passport",
    description:
      "Змініть один обмежений зразковий намір, запустіть детермінований префлайт політики та експортуйте Action Passport Preview. Без гаманця, дій провайдера чи транзакцій у блокчейні.",
  },
} as const satisfies Record<WorkspaceLocale, { title: string; description: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.title, description: copy.description };
}

export default function ActionPassportLabPage() {
  return (
    <div className="ag ag-workspace ag-workspace--lab">
      <WorkspaceWorkbench />
    </div>
  );
}
