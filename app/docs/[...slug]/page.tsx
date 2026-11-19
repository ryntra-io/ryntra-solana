import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { SITE, SITE_NAME, TWITTER } from "@/app/seo";

import { docHref, isSectionId, OLD_SECTIONS, SECTION_IDS, sectionOf } from "../_book/book";
import { DocsSection } from "../_book/DocsSection";

/* A section of the documentation at its own address: `/docs/start`, `/docs/meteora`. The city's sections
   that have a new home (`/docs/city`, `/docs/orders`, `/docs/fees` …) lead to it for good, so a kept link still lands
   on a page that answers; the old handbook's chapters reach those addresses first (`next.config.ts`). */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [...SECTION_IDS, ...Object.keys(OLD_SECTIONS)].map((id) => ({ slug: [id] }));
}

function idOf(slug: string[]): string | null {
  return slug.length === 1 ? slug[0]! : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const id = idOf((await params).slug);
  if (!isSectionId(id)) return {};
  const { title: name, line: description } = sectionOf(id).en;
  const title = `${name} — Ryntra Docs`;
  const url = `${SITE}${docHref(id)}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", siteName: SITE_NAME, title, description, url },
    twitter: { card: "summary_large_image", site: TWITTER, creator: TWITTER, title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const id = idOf((await params).slug);
  if (id && id in OLD_SECTIONS) permanentRedirect(docHref(OLD_SECTIONS[id]!));
  if (!isSectionId(id)) notFound();
  return <DocsSection id={id} />;
}
