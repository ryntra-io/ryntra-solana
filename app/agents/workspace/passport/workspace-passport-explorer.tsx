"use client";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AgentPassport } from "@/lib/agent-control/agent-passport";
import { AgentPassportExplorer } from "@/app/agents/passport/passport-explorer";

import { useAgentI18n } from "../i18n/provider";
import { usePassportDirectory } from "../passport-directory-store";

const COPY = {
  en: {
    rejected:
      "Not added to Agent Radar because this browser could not recompute the canonical Passport integrity envelope.",
    session: "Added to Agent Radar in this tab. No server record was created.",
    memory: "Added to the open Radar only. Browser storage was unavailable, so reload will clear it.",
  },
  uk: {
    rejected:
      "Не додано до Agent Radar, бо цей браузер не зміг переобчислити канонічний конверт цілісності Passport.",
    session: "Додано до Agent Radar у цій вкладці. Серверний запис не створювався.",
    memory: "Додано лише до відкритого Radar. Сховище браузера було недоступне, тож перезавантаження очистить запис.",
  },
} as const satisfies Record<WorkspaceLocale, { rejected: string; session: string; memory: string }>;

export function WorkspacePassportExplorer() {
  const { locale } = useAgentI18n();
  const { remember } = usePassportDirectory();
  const copy = COPY[locale];

  async function retain(passport: AgentPassport): Promise<string> {
    const retention = await remember(passport);
    if (retention === "REJECTED") {
      return copy.rejected;
    }
    return retention === "SESSION" ? copy.session : copy.memory;
  }

  return <AgentPassportExplorer onPassportLoaded={retain} />;
}
