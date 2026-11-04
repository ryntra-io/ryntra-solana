import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { DocsDocument } from "@/city/components/docs/DocsDocument";
import { DOC_IDS, docPath, isDocId } from "@/city/lib/docs/model";
import { readDocsFrame, readSection } from "@/city/lib/docs/read.server";
import { DOC_NAMES } from "@/city/lib/docs/sections";
import { PALETTE } from "@/city/lib/palette";
import { SITE, SITE_NAME, TWITTER } from "@/app/seo";

/* A section of the documentation at its own address (CITY-180): `/docs/start`, `/docs/fees`. Every section is built with the
   site, so a release that opens a door opens its section. The old handbook's
   addresses never reach this file: they lead to a section first (`city/lib/docs/old-chapters.ts`, `next.config.ts`). */

export const dynamic = "force-static";
export const dynamicParams = false;

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export function generateStaticParams() {
  return DOC_IDS.map((id) => ({ slug: [id] }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const id = slug.length === 1 ? slug[0] : null;
  if (!isDocId(id)) return {};
  const { title: name, line: description } = DOC_NAMES.en[id];
  const title = `${name} — Ryntra Docs`;
  const url = `${SITE}${docPath(id)}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", siteName: SITE_NAME, title, description, url },
    twitter: { card: "summary_large_image", site: TWITTER, creator: TWITTER, title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const id = slug.length === 1 ? slug[0] : null;
  if (!isDocId(id)) notFound();
  return <DocsDocument frame={readDocsFrame()} section={readSection(id)} />;
}
