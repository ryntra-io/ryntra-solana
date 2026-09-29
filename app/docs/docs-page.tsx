import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { normalizePublicLocale, PUBLIC_LOCALE_COOKIE } from "@/lib/site/locale";

import { DocsExperience } from "./docs-experience";
import type { DocPage } from "./content/model";

export type DocsView =
  | Readonly<{ kind: "page"; page: DocPage }>
  | Readonly<{ kind: "developers" }>
  | Readonly<{ kind: "reference" }>
  | Readonly<{ kind: "agent-control" }>;

export async function DocsPage({ view, children }: { view: DocsView; children?: ReactNode }) {
  const locale = normalizePublicLocale((await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value);
  return (
    <div className="rx" data-ry-ground="midnight">
      <MarkDefs />
      <PublicHeader locale={locale} mainId="main" ctaTone="quiet" />
      <main id="main" tabIndex={-1}><DocsExperience view={view} initialLocale={locale}>{children}</DocsExperience></main>
      <FrozenFooter locale={locale} />
    </div>
  );
}
