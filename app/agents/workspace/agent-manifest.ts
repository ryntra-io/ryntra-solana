import type { ModuleDefinition, WorkspaceManifest } from "@/app/shell/modules";
import type { AgentMessageKey } from "./i18n/catalog";

/**
 * Agent Control, projected onto the Shell v2 skeleton.
 *
 * Radar is the fleet. Portfolio is the live action cases. Strategy is mandates
 * and policies. Journal is evidence and receipts. Overview is Mission Control.
 * Settings is pinned. Developer and public doors live in the Pro footer, not
 * in the Simple rail.
 */

type AgentModuleSpec = Readonly<{
  id: ModuleDefinition["id"];
  labelKey: AgentMessageKey;
  icon?: string;
  href: string;
  entries?: ReadonlyArray<{ id: string; labelKey: AgentMessageKey; href: string; icon: string }>;
}>;

export const AGENT_MODULES: readonly AgentModuleSpec[] = [
  {
    id: "overview",
    labelKey: "nav.overview",
    href: "/agents/workspace",
    entries: [
      { id: "attention", labelKey: "nav.attention", href: "/agents/workspace/attention", icon: "attention" },
      { id: "lab", labelKey: "nav.lab", href: "/agents/workspace/lab", icon: "terminal" },
      { id: "operations", labelKey: "nav.operations", href: "/agents/workspace/operations", icon: "operations" },
      { id: "team", labelKey: "nav.team", href: "/agents/workspace/team", icon: "team" },
    ],
  },
  {
    id: "radar",
    labelKey: "nav.radar",
    icon: "agents",
    href: "/agents/workspace/agents",
    entries: [
      { id: "passport", labelKey: "nav.passport", href: "/agents/workspace/passport", icon: "agents" },
    ],
  },
  {
    id: "portfolio",
    labelKey: "nav.portfolio",
    icon: "terminal",
    href: "/agents/workspace/actions",
    entries: [
      { id: "reviews", labelKey: "nav.reviews", href: "/agents/workspace/reviews", icon: "decisions" },
      { id: "authorize", labelKey: "nav.authorize", href: "/agents/workspace/authorize", icon: "policies" },
    ],
  },
  {
    id: "strategy",
    labelKey: "nav.strategy",
    icon: "policies",
    href: "/agents/workspace/policies",
    entries: [
      { id: "integrations", labelKey: "nav.integrations", href: "/agents/workspace/integrations", icon: "providers" },
      { id: "commerce", labelKey: "nav.commerce", href: "/agents/workspace/commerce", icon: "treasury" },
      { id: "tools", labelKey: "nav.tools", href: "/agents/workspace/tools", icon: "terminal" },
      { id: "adoption", labelKey: "nav.adoption", href: "/agents/workspace/adoption", icon: "developers" },
    ],
  },
  {
    id: "journal",
    labelKey: "nav.journal",
    icon: "receipts",
    href: "/agents/workspace/evidence",
    entries: [
      { id: "verify", labelKey: "nav.verify", href: "/agents/workspace/verify", icon: "receipts" },
    ],
  },
  {
    id: "settings",
    labelKey: "nav.settings",
    href: "/agents/workspace/settings",
  },
];

export function agentManifest(label: (key: AgentMessageKey) => string): WorkspaceManifest {
  return {
    workspaceId: "agent-control",
    defaultLanding: "/agents/workspace",
    /* No deep links: every route this manifest keeps alive is a rail entry,
       and the `deepLinks` contract (modules.ts) is for routes that are NOT. */
    modules: AGENT_MODULES.map((module) => ({
      id: module.id,
      label: label(module.labelKey),
      href: module.href,
      icon: module.icon,
      entries: module.entries?.map((entry) => ({
        id: entry.id,
        label: label(entry.labelKey),
        href: entry.href,
        icon: entry.icon,
      })),
    })),
  };
}
