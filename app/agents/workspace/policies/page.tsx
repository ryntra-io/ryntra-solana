import type { Metadata } from "next";
import { createGoldenRwaDemo } from "@/lib/agent-control/golden-rwa-demo";

import { agentWorkspaceLocale } from "@/app/agents/workspace/i18n/server";
import type { WorkspaceLocale } from "@/app/shell/locale";

import { OwnerControlView } from "./owner-control-view";

const COPY = {
  en: {
    metaTitle: "Mandates and policies · Agent Control · Ryntra",
    metaDescription:
      "Inspect one sample owner policy, immutable mandate, action-class evidence profile and budget ledger without creating wallet or provider authority.",
    title: "Mandates and policies",
    eyebrow: "Agent Control / Policy & Mandate Studio",
    lead:
      "One owner policy, one immutable mandate and one budget ledger. The action class decides what evidence is required; the technical path decides whether authority exists.",
    environment: "SAMPLE · READ ONLY",
  },
  uk: {
    metaTitle: "Мандати та політики · Agent Control · Ryntra",
    metaDescription:
      "Перегляньте одну зразкову політику власника, незмінний мандат, профіль доказів за класом дії та бюджетний реєстр — без створення повноважень гаманця чи провайдера.",
    title: "Мандати та політики",
    eyebrow: "Agent Control / Студія політик і мандатів",
    lead:
      "Одна політика власника, один незмінний мандат і один бюджетний реєстр. Клас дії визначає, які докази потрібні; технічний шлях визначає, чи існують повноваження.",
    environment: "ЗРАЗОК · ЛИШЕ ЧИТАННЯ",
  },
} as const satisfies Record<
  WorkspaceLocale,
  {
    metaTitle: string;
    metaDescription: string;
    title: string;
    eyebrow: string;
    lead: string;
    environment: string;
  }
>;

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.metaTitle, description: copy.metaDescription };
}

/* The sample carries bounded freshness windows, so it must be produced for the
   request rather than frozen into the build output. */
export const dynamic = "force-dynamic";

export default async function AgentWorkspacePoliciesPage() {
  const copy = COPY[await agentWorkspaceLocale()];
  const demo = createGoldenRwaDemo();

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <h1>{copy.title}</h1>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.environment}</span>
      </header>
      <OwnerControlView sample={demo.fresh} />
    </div>
  );
}
