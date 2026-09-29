import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { EmptyState, Panel, PanelGrid } from "@/app/shell/panel";
import { WorkspacePageHeader } from "@/app/shell/page-header";
import { publicCapabilityRow } from "@/app/site/truth-core";

import { agentMessage } from "./i18n/catalog";
import { agentWorkspaceLocale } from "./i18n/server";
import { workspaceSurface, type SurfaceState } from "./surfaces";

/*
 * One renderer for the seven surfaces that exist as routes before they exist as
 * products.
 *
 * The alternative was seven hand-written pages, which is how a route that reads
 * "coming soon" gets written seven slightly different ways and one of them
 * eventually implies a capability. Here the honest part is structural: a page
 * cannot render without stating its state, and it cannot claim work it has no
 * `works` entry for.
 *
 * Every capability line comes from the registry rather than from this file.
 */

const TONE: Readonly<Record<SurfaceState, "evidence" | "caution" | "muted">> = {
  WORKING: "evidence",
  "READ ONLY": "evidence",
  BUILDING: "caution",
  PLANNED: "muted",
};

export async function WorkspaceSurfacePage({ id }: { id: string }) {
  /* The frame speaks the workspace language. The registry sentences fall back
     to English until their overlay lands — a fallback, never a blank. */
  const locale = await agentWorkspaceLocale();
  const t = (key: Parameters<typeof agentMessage>[1]) => agentMessage(locale, key);
  const surface = workspaceSurface(id, locale);
  const rows = (surface.capabilities ?? []).map((capabilityId) => ({
    id: capabilityId,
    row: publicCapabilityRow(capabilityId),
  }));

  return (
    <div className="acw-page">
      <WorkspacePageHeader
        title={surface.heading}
        aboutLabel={t("chrome.about")}
        lead={
          <>
            <p>{surface.lede}</p>
            {surface.blocker ? <p>{surface.blocker}</p> : null}
          </>
        }
        badge={<span className="acw-environment">{surface.state}</span>}
      />

      <PanelGrid label={`Agent Control ${surface.heading}`}>
        <Panel
          id={`agent-control-${surface.id}-state`}
          title={surface.works.length ? t("empty.works") : t("surface.noBackend")}
          w={surface.capabilities?.length ? 6 : 12}
          /* `.rw-empty` is `flex: 1; min-height: 0`, built to centre inside a
             panel that already has a height. Without one it collapsed and the
             sentence was clipped mid-word — visible only by opening the page. */
          h={4}
          essential
          badge={surface.state}
          tone={TONE[surface.state]}
        >
          {surface.works.length ? (
            <div className="acw-fact-list">
              {surface.works.map((line) => (
                <p key={line}>
                  <span>{line}</span>
                </p>
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("empty.none")}
              action={
                surface.insteadHref ? (
                  <Link className="rw-btn" href={surface.insteadHref}>
                    {surface.insteadLabel} <ArrowRight size={14} weight="bold" aria-hidden />
                  </Link>
                ) : null
              }
            >
              {surface.blocker ?? t("surface.deadDoor")}
            </EmptyState>
          )}
        </Panel>

        {surface.capabilities?.length ? (
          <Panel
            id={`agent-control-${surface.id}-registry`}
            title={t("surface.registry")}
            w={6}
            h={4}
            essential
            badge={t("surface.fromRegistry")}
            tone="evidence"
          >
            <div className="acw-fact-list">
              {rows.map(({ id: capabilityId, row }) => (
                <p key={capabilityId}>
                  <b>{row.label}</b>
                  <span>
                    {row.stateLabel} · {t("surface.lastVerified")} {row.lastVerifiedAt} — {row.limitation}
                  </span>
                </p>
              ))}
            </div>
          </Panel>
        ) : null}

        {surface.blocker ? (
          <Panel
            id={`agent-control-${surface.id}-blocker`}
            title={t("surface.blocker")}
            w={12}
            badge={t("surface.notAvailable")}
            tone="muted"
          >
            <p className="rw-note">{surface.blocker}</p>
            {surface.works.length && surface.insteadHref ? (
              <div className="acw-action-stack">
                <Link className="rw-btn" href={surface.insteadHref}>
                  {surface.insteadLabel} <ArrowRight size={14} weight="bold" aria-hidden />
                </Link>
              </div>
            ) : null}
          </Panel>
        ) : null}
      </PanelGrid>
    </div>
  );
}
