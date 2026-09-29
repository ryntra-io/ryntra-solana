import type { ModuleDefinition, WorkspaceManifest } from "@/app/shell/modules";
import type { HomeMessageKey } from "./i18n/catalog";

/**
 * Ryntra Home, projected onto the Shell v2 skeleton.
 *
 * Simple is the five questions a person asks first: what needs me, what
 * changed, what I hold, what I planned, what happened. Pro unfolds the rest
 * of the built routes as children. Settings is pinned, not a sixth rail word.
 *
 * Home is not an execution desk. There is no treasury module and no Send.
 */

type HomeModuleSpec = Readonly<{
  id: ModuleDefinition["id"];
  labelKey: HomeMessageKey;
  icon?: string;
  href: string;
  entries?: ReadonlyArray<{ id: string; labelKey: HomeMessageKey; href: string; icon: string }>;
}>;

export const HOME_MODULES: readonly HomeModuleSpec[] = [
  {
    id: "overview",
    labelKey: "nav.overview",
    href: "/app",
    entries: [
      { id: "brief", labelKey: "nav.brief", href: "/app/brief", icon: "brief" },
      { id: "adviser", labelKey: "nav.adviser", href: "/app/adviser", icon: "adviser" },
      { id: "control", labelKey: "nav.control", href: "/app/control", icon: "control" },
      { id: "connect", labelKey: "nav.connect", href: "/app/connect", icon: "connect" },
    ],
  },
  {
    id: "radar",
    labelKey: "nav.radar",
    icon: "research",
    href: "/app/research",
    entries: [
      { id: "alerts", labelKey: "nav.alerts", href: "/app/alerts", icon: "alerts" },
      { id: "operations", labelKey: "nav.operations", href: "/app/operations", icon: "operations" },
    ],
  },
  {
    id: "portfolio",
    labelKey: "nav.portfolio",
    href: "/app/portfolio",
    entries: [{ id: "coverage", labelKey: "nav.coverage", href: "/app/coverage", icon: "coverage" }],
  },
  {
    id: "strategy",
    labelKey: "nav.strategy",
    icon: "strategies",
    href: "/app/strategies",
    entries: [{ id: "lab", labelKey: "nav.lab", href: "/app/strategy-lab", icon: "strategy" }],
  },
  {
    id: "journal",
    labelKey: "nav.journal",
    href: "/app/journal",
    entries: [{ id: "decisions", labelKey: "nav.decisions", href: "/app/action-cases", icon: "decisions" }],
  },
  {
    id: "settings",
    labelKey: "nav.settings",
    href: "/app/settings",
  },
];

/*
 * `deepLinks` means an action route that stays reachable while it is NOT a
 * place in the navigation (modules.ts states the contract). Nine routes were
 * listed here that are Pro rail entries above — data that contradicted its own
 * field the moment a consumer appeared. Only the access gate genuinely lives
 * off the rail.
 */
export const HOME_DEEP_LINKS: readonly string[] = ["/app/beta"];

export function homeManifest(label: (key: HomeMessageKey) => string): WorkspaceManifest {
  return {
    workspaceId: "home",
    defaultLanding: "/app",
    deepLinks: HOME_DEEP_LINKS,
    modules: HOME_MODULES.map((module) => ({
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
