/**
 * The public contact identities, in one place.
 *
 * They were in six: the Company founder card, the site footer, the Organization
 * JSON-LD in the root layout, the beta link table, and two retired chromes. Six
 * copies of an address is six chances for one of them to be the old one — and
 * that is exactly what happened. The Telegram channel the founder retired from
 * public copy stayed in `sameAs`, which is the machine-readable claim about who
 * Ryntra *is*: search engines were still being told an abandoned channel was an
 * official Ryntra identity long after the page stopped saying so.
 *
 * So the rule is not "keep them in sync". It is that a surface may not know an
 * address at all — it asks this module. `contacts.test.mjs` fails any public
 * file that writes one as a literal.
 *
 * One thing deliberately does not live here: `LINKS.channelHandle` in
 * `lib/beta/types.ts`. That handle is not a contact — it is the bootstrap
 * fallback while `admin_operators` is empty or unmigrated. Deleting it would
 * lock the founder out before the operator table exists. It stays where the
 * authorization code can see it.
 */

export const CONTACTS = {
  email: "hello@ryntra.io",
  betaBot: "https://t.me/RyntraBeta_bot",
  companyX: "https://x.com/Ryntra_io",
  founder: {
    name: "Dmytro Plavutskyi",
    role: "Founder",
    x: "https://x.com/plavutsky",
    linkedin: "https://www.linkedin.com/in/plavutsky/",
  },
} as const;

/**
 * The bounded public source extraction.
 *
 * Not a contact and not a route, but the same class of fact: one public
 * destination that four surfaces link to and none of them should spell. It
 * lives here rather than in `app/site/nav.ts` because the footer needs it and
 * `nav.ts` evaluates the 36 kB capability registry at module scope — importing
 * it into the chrome would ship that registry to every browser that loads any
 * page. `nav.ts` re-exports this constant so there is still exactly one literal.
 */
export const PUBLIC_REPOSITORIES = {
  /** The Agent Control contracts, SDK and MCP server. Apache-2.0, not on npm. */
  agentControl: "https://github.com/ryntra-io/ryntra-agent-control",
  /** The read-only Solana evidence kit: SDK, local stdio MCP server, CLI. */
  solanaEvidence: "https://github.com/ryntra-io/ryntra-solana-evidence",
} as const;

/**
 * The company GitHub organization. The global footer "GitHub" goes here.
 * Product evidence surfaces use `PUBLIC_REPOSITORIES`, never this URL.
 */
export const GITHUB_ORGANIZATION_URL = "https://github.com/ryntra-io";

/**
 * @deprecated Use `GITHUB_ORGANIZATION_URL` for the company footer and
 * `PUBLIC_REPOSITORIES.*` for a specific public tree. Kept as an alias of
 * the organization so a leftover "GitHub" import cannot silently point at
 * one product's repository.
 */
export const REPOSITORY_URL = GITHUB_ORGANIZATION_URL;

export const SOLANA_EVIDENCE_REPOSITORY_URL = PUBLIC_REPOSITORIES.solanaEvidence;
export const AGENT_CONTROL_REPOSITORY_URL = PUBLIC_REPOSITORIES.agentControl;

/**
 * The identities Ryntra claims publicly, for `schema.org` `sameAs`.
 *
 * A profile belongs here only if Ryntra actually posts from it. The founder's
 * personal accounts are reachable from `/contact` and are not the company, so
 * they are not asserted as the organization.
 */
export const ORGANIZATION_PROFILES: readonly string[] = [CONTACTS.companyX];

/**
 * A `mailto:` with a subject that survives being read by a person.
 *
 * The subject is what makes one inbox behave like five routes, so it is built
 * here rather than typed per link: a route whose subject drifts is a route that
 * silently stops sorting.
 */
export function contactMailto(subject?: string): string {
  return subject
    ? `mailto:${CONTACTS.email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${CONTACTS.email}`;
}

export type ContactAction = Readonly<{
  /** The visible control text. Never the href — canon: no raw URL as copy. */
  label: string;
  href: string;
  external?: boolean;
}>;

/** The two the contact hero offers before a visitor has read a single route. */
export const PRIMARY_CONTACT_ACTIONS: readonly ContactAction[] = [
  { label: "Email Ryntra", href: contactMailto() },
  { label: "Ryntra on X", href: CONTACTS.companyX, external: true },
];

export const FOUNDER_ACTIONS: readonly ContactAction[] = [
  { label: "Founder on X", href: CONTACTS.founder.x, external: true },
  { label: "LinkedIn", href: CONTACTS.founder.linkedin, external: true },
];

export type ContactRoute = Readonly<{
  id: string;
  name: string;
  /** Who the route is for, in one line. Not a pitch. */
  note: string;
  actions: readonly ContactAction[];
}>;

/**
 * The five routes, and the subject line each one sorts by.
 *
 * There is one inbox behind all of them. Saying so is better than implying five
 * departments that do not exist, and it is why no route promises a response
 * time: an invented SLA is a claim like any other.
 */
export const CONTACT_ROUTES: readonly ContactRoute[] = [
  {
    id: "product",
    name: "Product & access",
    note: "Questions about Ryntra or your workspace.",
    actions: [
      { label: "Email Ryntra", href: contactMailto("Product") },
    ],
  },
  {
    id: "partnerships",
    name: "Partnerships & integrations",
    note: "Networks, venues, protocols, wallets, data providers, agent and payment infrastructure, ecosystem teams.",
    actions: [{ label: "Discuss an integration", href: contactMailto("Partnership / Integration") }],
  },
  {
    id: "developers",
    name: "Developers",
    note: "API, SDK, MCP, adapters or developer product questions.",
    actions: [{ label: "Developer question", href: contactMailto("Developer") }],
  },
  {
    id: "security",
    name: "Security",
    note: "Report a security issue or a suspicious Ryntra impersonation.",
    actions: [{ label: "Security report", href: contactMailto("Security Report") }],
  },
  {
    id: "company",
    name: "Company / press / investor",
    note: "Company, press, strategic or investor conversation.",
    actions: [{ label: "Contact company", href: contactMailto("Company") }],
  },
];
