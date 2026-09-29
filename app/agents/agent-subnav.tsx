"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const AGENT_NAV = [
  { href: "/agents", label: "Overview" },
  { href: "/agents/workspace", label: "Mission Control" },
  { href: "/agents/passport", label: "Agent Passport" },
  { href: "/agents/verify", label: "Preview verifier" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/agents" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AgentSubnav() {
  const pathname = usePathname();
  const publicRead = isCurrent(pathname, "/agents/passport");
  const previewVerifier = isCurrent(pathname, "/agents/verify");

  return (
    <div className="ag-subnav">
      <div className="rx-shell ag-subnav-inner">
        <Link className="ag-subnav-name" href="/agents" aria-label="Agent Control overview">
          Agent Control
        </Link>
        <nav className="ag-subnav-links" aria-label="Agent Control">
          {AGENT_NAV.map((item) => {
            const current = isCurrent(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-current={current || undefined}
                aria-current={current ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <span className="ag-subnav-state">
          {publicRead ? "PUBLIC READ · AGENTVERSE" : previewVerifier ? "ACTION PASSPORT · PREVIEW" : "PRODUCT OVERVIEW"}
        </span>
      </div>
    </div>
  );
}
