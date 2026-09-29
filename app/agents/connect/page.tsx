import type { Metadata } from "next";
import Link from "next/link";
import {
  Eye,
  Info,
  PencilSimpleLine,
  Prohibit,
  WarningOctagon,
} from "@phosphor-icons/react/dist/ssr";

import { createAgentOAuthServer } from "../../../lib/agent-control/oauth/server.ts";
import { getAgentControlRuntime } from "../../../lib/agent-control/runtime.ts";
import { AGENT_CONTROL_SCOPES, type AgentControlScope } from "../../../lib/agent-control/tenancy.ts";

import styles from "./connect.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect an agent · Ryntra",
  description:
    "Approve a bounded connection between an external agent and Ryntra Agent Control. Nothing here can authorize, sign or move value.",
  robots: { index: false, follow: false },
};

/**
 * The approval screen — the one place a human decides what an outside agent may
 * reach.
 *
 * This is the OAuth authorization endpoint, and it is a page rather than an API
 * route because a browser opens it and a person reads it. Everything shown is
 * derived from the registered client and the closed scope vocabulary; nothing
 * is echoed from the query string except after it has been checked against a
 * registration this server issued.
 *
 * **The screen answers three questions and stops.** Who is asking. What exactly
 * they would be able to do. What they still could not do afterwards. The third
 * is not reassurance copy — it is the list of things the scope vocabulary has
 * no member for, which is why it can be stated flatly.
 *
 * **An unregistered client never gets a form.** A consent screen that renders
 * before checking the client is a phishing surface: the attacker supplies the
 * name, the redirect and the scope text, and Ryntra's chrome makes it look
 * official. So the client is resolved first, and a request that does not
 * resolve is refused on this page rather than bounced anywhere.
 */

const SCOPE_COPY: Readonly<Record<AgentControlScope, { what: string; write: boolean }>> = {
  "evidence:read": {
    what: "Build intent drafts, run preflight previews and check an artifact's integrity. Reads nothing that belongs to you.",
    write: false,
  },
  "proposal:write": {
    what: "Record a proposal that waits for a person. It stops at PROPOSE, and no tool exists that could advance it.",
    write: true,
  },
  "metrics:read": {
    what: "Read request counters for this deployment. Grants no tool at all.",
    write: false,
  },
};

const CANNOT = [
  "sign anything, or reach a wallet, key or seed phrase",
  "authorize, approve or grant a mandate",
  "move funds, pay, settle or submit a transaction",
  "call another agent, provider or chain on your behalf",
];

function Explain({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className={styles.explain}>
      <summary>
        <Info size={15} weight="bold" aria-hidden />
        <span>{label}</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.problem} role="alert">
        <WarningOctagon size={18} weight="bold" aria-hidden />
        <div>{children}</div>
      </div>
    </div>
  );
}

type Search = Record<string, string | string[] | undefined>;

function one(search: Search, name: string): string {
  const value = search[name];
  return typeof value === "string" ? value : "";
}

export default async function AgentConnectPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const search = await searchParams;
  const clientId = one(search, "client_id");
  const redirectUri = one(search, "redirect_uri");
  const state = one(search, "state");
  const codeChallenge = one(search, "code_challenge");
  const codeChallengeMethod = one(search, "code_challenge_method") || "S256";
  const resource = one(search, "resource");
  const requested = one(search, "scope")
    .split(/[\s+]+/)
    .filter((value): value is AgentControlScope =>
      (AGENT_CONTROL_SCOPES as readonly string[]).includes(value),
    );

  if (!clientId) {
    return (
      <Problem>
        <strong>This page was opened without a connection request.</strong> An agent sends you here
        with the client it registered; there is nothing to approve on its own.
      </Problem>
    );
  }

  const client = await createAgentOAuthServer(getAgentControlRuntime().guardStore).readClient(
    clientId,
  );

  if (!client) {
    return (
      <Problem>
        <strong>That client is not registered with Ryntra.</strong> Nothing was approved. If an
        agent sent you this link, it has to register first — a name in a link is not a registration.
      </Problem>
    );
  }

  if (!client.redirectUris.includes(redirectUri)) {
    return (
      <Problem>
        <strong>That return address is not the one this client registered.</strong> Nothing was
        approved, and you were not redirected: sending a browser to an address Ryntra has not
        vouched for is exactly the failure this check exists to prevent.
      </Problem>
    );
  }

  if (codeChallengeMethod !== "S256" || codeChallenge.length < 43) {
    return (
      <Problem>
        <strong>This request does not carry a valid proof-of-possession challenge.</strong> Ryntra
        accepts <code>S256</code> only, so a connection cannot be approved without one.
      </Problem>
    );
  }

  const grantable = requested.length > 0 ? requested : ([...AGENT_CONTROL_SCOPES] as AgentControlScope[]);

  return (
    <div className={styles.page}>
      <form className={styles.card} method="post" action="/api/agents/oauth/authorize">
        <div className={styles.head}>
          <h1 className={styles.title}>Connect {client.clientName} to Agent Control</h1>
          <p className={styles.who}>
            <strong>{client.clientName}</strong> is asking for a bounded connection. Approving it
            issues a token that expires in an hour and that you can revoke at any time.
          </p>
        </div>

        <ul className={styles.scopes}>
          {grantable.map((scope) => {
            const copy = SCOPE_COPY[scope];
            return (
              <li
                key={scope}
                className={copy.write ? `${styles.scope} ${styles.scopeWrite}` : styles.scope}
              >
                {copy.write ? (
                  <PencilSimpleLine size={17} weight="bold" aria-hidden />
                ) : (
                  <Eye size={17} weight="bold" aria-hidden />
                )}
                <span>
                  <span className={styles.scopeName}>{scope}</span>
                  <span className={styles.scopeWhat}>{copy.what}</span>
                </span>
              </li>
            );
          })}
        </ul>

        <div className={styles.cannot}>
          <Prohibit size={17} weight="bold" aria-hidden />
          <div>
            <strong>Whatever you approve, it still cannot</strong> {CANNOT.join("; ")}.
          </div>
        </div>

        <Explain label="Why that list is a fact rather than a promise">
          Agent Control&rsquo;s scope vocabulary has exactly three members, and none of them names
          an authority. There is no scope value meaning <em>sign</em>, <em>authorize</em> or{" "}
          <em>execute</em>, so a token cannot be minted carrying one — not because a rule forbids it
          but because the type has nothing to put there. The same shape holds one layer down: the
          write tools share a single effect value, <code>PROPOSAL_ONLY</code>, so a signing tool
          would have no effect to declare.
        </Explain>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="api_key">
            Your Ryntra key
          </label>
          <input
            className={styles.input}
            id="api_key"
            name="api_key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            placeholder="ryn_ac_…"
          />
          <span className={styles.hint}>
            The key decides the ceiling: this connection can never hold a scope your key does not.
            Ryntra stores a hash of it and never the key itself.
          </span>
        </div>

        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="scope" value={grantable.join(" ")} />
        <input type="hidden" name="code_challenge" value={codeChallenge} />
        <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
        <input type="hidden" name="resource" value={resource} />

        <div className={styles.actions}>
          <button className={styles.approve} type="submit">
            Approve this connection
          </button>
          <Link className={styles.cancel} href="/agents/workspace/adoption">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
