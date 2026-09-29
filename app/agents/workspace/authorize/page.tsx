import type { Metadata } from "next";

import { agentWorkspaceLocale } from "@/app/agents/workspace/i18n/server";
import type { WorkspaceLocale } from "@/app/shell/locale";

import { AgentAuthorizePanel } from "./authorize-panel";

const COPY = {
  en: {
    metaTitle: "Human authorization",
    metaDescription:
      "Sign one Agent Control artifact in your own wallet with EIP-712 typed data on BNB Testnet. Ryntra holds no key, produces no signature, and creates, funds, submits or executes nothing.",
    eyebrow: "Agent Control / Human authorization",
    title: "Wallet signature experiment",
    lead:
      "Sign one Agent Control artifact in your own wallet with EIP-712 typed data. Ryntra holds no key and produces no signature, and this signature is not a product authorization — there is no authenticated approval workflow behind it yet.",
    environment: "EXPERIMENTAL · NOT PRODUCT AUTHORIZATION",
  },
  uk: {
    metaTitle: "Авторизація людиною",
    metaDescription:
      "Підпишіть один артефакт Agent Control у власному гаманці типізованими даними EIP-712 у BNB Testnet. Ryntra не тримає ключа, не створює підпису і нічого не створює, не фінансує, не надсилає й не виконує.",
    eyebrow: "Agent Control / Авторизація людиною",
    title: "Експеримент із підписом гаманця",
    lead:
      "Підпишіть один артефакт Agent Control у власному гаманці типізованими даними EIP-712. Ryntra не тримає ключа і не створює підпису, а цей підпис не є продуктовою авторизацією — за ним поки немає автентифікованого процесу погодження.",
    environment: "ЕКСПЕРИМЕНТ · НЕ ПРОДУКТОВА АВТОРИЗАЦІЯ",
  },
} as const satisfies Record<
  WorkspaceLocale,
  {
    metaTitle: string;
    metaDescription: string;
    eyebrow: string;
    title: string;
    lead: string;
    environment: string;
  }
>;

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.metaTitle, description: copy.metaDescription };
}

/*
 * The page had no `<h1>` at all — the panel inside it opens at `<h2>`, so a
 * screen reader met a document whose outline started one level down and whose
 * title existed only in the tab. The heading also has to say what this is
 * before the panel says how it works: an experiment, not a product
 * authorization.
 */
export default async function AgentAuthorizePage() {
  const copy = COPY[await agentWorkspaceLocale()];

  return (
    <div className="ag ag-workspace ag-workspace--authorize">
      <header className="acw-head">
        <div>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.environment}</span>
      </header>
      <AgentAuthorizePanel />
    </div>
  );
}
