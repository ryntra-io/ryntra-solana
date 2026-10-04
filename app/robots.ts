import type { MetadataRoute } from "next";
import { SITE } from "./seo.ts";

/*
 * robots.txt is a declaration, never authentication or access control.
 * Authorization, route-level noindex and no-store remain the security
 * boundaries. These paths preserve the site's existing generic policy on
 * every answer-time group so a more specific User-Agent rule cannot bypass
 * the wildcard group under the Robots Exclusion Protocol.
 */
const PROTECTED_PATHS = [
  "/api/",
  "/admin",
  /* The cabinet — all of it but the addresses below — at both languages' addresses. */
  "/app/",
  "/uk/app/",
];

/*
 * Where crawlers may go: the site — the landing at `/` and `/uk`, the public
 * pages and the documentation at both addresses among it — and, of the
 * cabinet, the pages offered to the index: Home and Markets, `$` keeping each
 * to that one page, and the companies' pages under `/app/stocks/`, in English
 * and at `/uk`. The longer rule wins under the Robots Exclusion Protocol.
 * `/app` itself stays open: it is the one hop to Home that every shared link
 * to the app takes.
 *
 * Only what is live is named: the QA route this file used to list
 * (`/strategy-lab-qa`) no longer exists.
 */
const OPEN_PATHS = ["/", "/app/home$", "/app/markets$", "/app/stocks/", "/uk/app/home$", "/uk/app/markets$", "/uk/app/stocks/"];

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
