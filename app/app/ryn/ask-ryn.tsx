import { Sparkle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { rynHref } from "@/lib/agent/context";
import type { AgentContext } from "@/lib/api/v1/contract";

/**
 * The one way into Ryn from a page (`RYN-AGENT-TEXT-001`): a link that
 * carries the page's context — the asset, the plan, the portfolio, the
 * note — so the conversation opens on what the person is looking at. Not a
 * menu entry; a control beside the page's own actions. Server-safe.
 */
export function AskRyn({ context, locale, question, primary = false, className }: { context: AgentContext | null; locale: WorkspaceLocale; question?: string; primary?: boolean; className?: string }) {
  return (
    <Link className={className ?? (primary ? "rw-btn rw-btn--primary" : "rw-btn")} href={rynHref(context, question)} prefetch={false} data-ask-ryn={context?.kind ?? "none"}>
      <Sparkle size={16} weight="bold" aria-hidden="true" />
      <span>{locale === "uk" ? "Спитати Ryntra" : "Ask Ryntra"}</span>
    </Link>
  );
}
