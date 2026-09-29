import type { ReactNode } from "react";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import "@/app/site/frozen/bridge.css";

import "./agent-control.css";

export default function AgentControlDevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="rx acd">
      {/*
        THESIS: one inspectable developer contract, never an integration showroom.
        OWN-WORLD: Ryntra Navy, mineral-paper evidence, flat instrument panels.
        STORY: understand the source kit, run it locally, inspect every boundary.
        FIRST VIEWPORT: product promise left, exact source manifest right, quickstart in view.
        FORM: established Ryntra developer desk · seed b7a0c13e.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.
      */}
      <span
        hidden
        aria-hidden="true"
        data-design-comment="b7a0c13e"
        dangerouslySetInnerHTML={{ __html: "<!-- design-seed:b7a0c13e -->" }}
      />
            <MarkDefs />
      <PublicHeader />
      {children}
      <FrozenFooter />
    </div>
  );
}
