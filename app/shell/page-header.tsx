"use client";

import type { ReactNode } from "react";

import { InfoControl } from "./info-control";

/**
 * One page header for Home and Agent Control.
 *
 * The lead sits behind the info control rather than printed under the title.
 * One hub already proved this: a permanent paragraph on every visit is documentation
 * with controls attached. The title and one optional status stay standing.
 */
export function WorkspacePageHeader({
  title,
  aboutLabel,
  lead,
  badge,
  actions,
}: {
  title: string;
  aboutLabel: string;
  lead?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rs-page">
      <div className="rs-page-title-row">
        <div className="rs-page-title">
          <h1>{title}</h1>
          {lead ? <InfoControl label={aboutLabel}>{lead}</InfoControl> : null}
        </div>
        <div className="rs-page-controls">
          {badge}
          {actions}
        </div>
      </div>
    </header>
  );
}
