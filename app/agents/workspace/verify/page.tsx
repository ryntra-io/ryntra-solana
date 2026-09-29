import type { Metadata } from "next";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { agentWorkspaceLocale } from "../i18n/server";
import { ActionPassportVerifier } from "../../verify/verifier";

const COPY = {
  en: {
    title: "Preview verifier",
    description:
      "Recompute the integrity of a complete Action Passport Preview inside the workspace. Integrity does not prove execution, outcome or finalization.",
  },
  uk: {
    title: "Верифікатор превʼю",
    description:
      "Переобчисліть цілісність повного Action Passport Preview у робочому просторі. Цілісність не доводить виконання, результат чи фіналізацію.",
  },
} as const satisfies Record<WorkspaceLocale, { title: string; description: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.title, description: copy.description };
}

export default function WorkspaceVerifyPage() {
  return (
    <div className="ag ag-workspace ag-workspace--verify">
      <ActionPassportVerifier />
    </div>
  );
}
