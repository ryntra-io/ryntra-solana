import type { MetadataRoute } from "next";
import { SITE } from "./seo.ts";

/*
 * robots.txt is a declaration, never authentication or access control.
 * Authorization, route-level noindex and no-store remain the security
 * boundaries. These paths preserve the site's existing generic policy on
 * every answer-time group so a more specific User-Agent rule cannot bypass
 * the wildcard group under the Robots Exclusion Protocol.
 */
const PROTECTED_PATHS = ["/api/", "/admin"];

/*
 * Where crawlers may go: the city at `/`, the public pages and the
 * documentation. The old interface (`/app/…`, `/uk/app/…`, `/solana/…`,
 * Mission Control) answers nothing but a 308 into the city since CITY-13,
 * with `X-Robots-Tag: noindex` on the way: it is left crawlable on purpose, so
 * a crawler that still holds one of its addresses sees where it went and drops
 * it — a disallowed address keeps its place in an index with no page under it.
 *
 * Only what is live is named: the QA route this file used to list
 * (`/strategy-lab-qa`) no longer exists.
 */
const OPEN_PATHS = ["/"];

const USER_TRIGGERED_AGENTS = ["ChatGPT-User", "Claude-User", "Perplexity-User"];
const ANSWER_AND_SEARCH_AGENTS = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"];
const BULK_TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "Amazonbot",
  "Bytespider",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: OPEN_PATHS,
        disallow: PROTECTED_PATHS,
      },
      {
        userAgent: USER_TRIGGERED_AGENTS,
        allow: OPEN_PATHS,
        disallow: PROTECTED_PATHS,
      },
      {
        userAgent: ANSWER_AND_SEARCH_AGENTS,
        allow: OPEN_PATHS,
        disallow: PROTECTED_PATHS,
      },
      {
        userAgent: BULK_TRAINING_CRAWLERS,
        disallow: "/",
      },
    ],
    sitemap: SITE + "/sitemap.xml",
    host: SITE,
  };
}
