import { localizedUrl } from "@/app/seo";
import { breadcrumbList, jsonLdScript, webPage, type JsonLd, type PageType } from "@/lib/site/structured-data";

/**
 * A public page's structured data, in its language (the plan of
 * `RYN-SITE-V5-001` §5): what the page is — a page, an about page, a contact
 * page — at the address of the language it is drawn in, and where it sits
 * under the site. `Organization` and `WebSite` are the root layout's.
 */
export function SitePageGraph({
  type = "WebPage",
  path,
  locale,
  name,
  description,
  extra,
}: {
  type?: PageType;
  path: string;
  locale: "en" | "uk";
  name: string;
  description: string;
  extra?: JsonLd;
}) {
  const url = localizedUrl(path, locale);
  const graph = [
    webPage({ type, url, name, description, locale, crumbs: [], extra }),
    breadcrumbList(url, [
      { name: "Ryntra", url: localizedUrl("/", locale) },
      { name, url },
    ]),
  ];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />;
}
