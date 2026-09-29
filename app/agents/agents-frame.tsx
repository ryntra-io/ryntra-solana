"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import "@/app/site/frozen/bridge.css";
import { AgentSubnav } from "./agent-subnav";

/** Public pages keep website chrome; workspace routes own RyntraAppShell. */
export function AgentsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/agents/workspace" || pathname.startsWith("/agents/workspace/")) {
    return <>{children}</>;
  }

  return (
    <div className="rx ag">
      <span
        hidden
        aria-hidden="true"
        data-design-comment="c4ecdba5"
        dangerouslySetInnerHTML={{ __html: "<!-- design-seed:c4ecdba5 -->" }}
      />
            <MarkDefs />
      <PublicHeader />
      <AgentSubnav />
      {children}
      <FrozenFooter />
    </div>
  );
}
