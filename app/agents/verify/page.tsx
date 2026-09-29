import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";

import { PublicSurfaceRole } from "../public-role";

import { ActionPassportVerifier } from "./verifier";

export const metadata: Metadata = {
  ...sitePageMetadata({
    path: "/agents/verify",
    title: "Action Passport Preview verifier — Ryntra",
    description:
      "Recompute the integrity of a complete Action Passport Preview. Integrity does not prove execution, outcome or finalization.",
    audience: "guard",
  }),
  robots: { index: false, follow: false },
};

export default function AgentVerifyPage() {
  return (
    <main id="main" className="ag-verify" tabIndex={-1}>
      <PublicSurfaceRole
        what="An independent recomputation of an Action Passport Preview's canonical hashes."
        workspaceHref="/agents/workspace/verify"
      />
      <ActionPassportVerifier />
    </main>
  );
}
