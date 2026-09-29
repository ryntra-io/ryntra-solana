import { InfoControl } from "@/app/shell/info-control";
import { KeyValue, Panel, PanelGrid } from "@/app/shell/panel";
import {
  SOLANA_TOKEN_2022_ADAPTER_REF,
  SPL_TRANSFER_ACTION_REF,
} from "@/lib/agent-control/adapters/solana-token-2022";
import { SOLANA_EVIDENCE_REPOSITORY_URL } from "@/lib/site/contacts";
import {
  JUPITER_ENV_OVERRIDES,
  JUPITER_SWAP_V2_BASE_URL,
  resolveJupiterSwapEndpoint,
} from "@/lib/solana/quotes";
import { ENV_OVERRIDES, resolveEndpoint, resolveEndpoints } from "@/lib/solana/rpc";
import { PageHead } from "../hub/parts.tsx";
import { solanaServerText } from "../i18n/server.ts";

export const metadata = { title: "Developers" };

/**
 * The read adapter, its sources, its published contracts and its refusals.
 *
 * Every identifier on this page is imported from the module that owns it —
 * the adapter refs from the registry adapter, the endpoints from the RPC
 * module — because a hand-typed copy of an identifier is a second list, and
 * second lists disagree silently. The schema file names are asserted against
 * the repository by the surface test for the same reason.
 */

const SCHEMA_FILES = [
  "solana-asset-passport.schema.json",
  "spl-transfer-preflight.schema.json",
  "solana-owner-policy.schema.json",
  "solana-policy-verdict.schema.json",
] as const;

export default async function SolanaDevelopersPage() {
  const { text } = await solanaServerText();
  const jupiter = resolveJupiterSwapEndpoint();
  return (
    <>
      <PageHead
        title="Developers"
        module="developers"
        lead="What this workspace reads, from which source, under which contract — and exactly what the kit refuses to do. The SDK, the local MCP server and the CLI are published: ryntra-io/ryntra-solana-evidence, Apache-2.0, v1.0.0, cloned and verified from GitHub as a stranger would. It holds no key and has no signing path, which is a property of the kit rather than a gap in it."
      />

      <PanelGrid label={text("Developers")}>
        <Panel
          id="solana-dev-registry"
          title={text("Registry entry")}
          w={6}
          h={4}
          scroll
          badge={text("Shipped")}
          tone="evidence"
          headerExtra={
            <InfoControl label={text("Why an adapter registers")}>
              <p>
                {text("Agent Control artifacts name their adapter and action by versioned, hash-pinned reference, so a verifier that has never heard of Solana still reads that the action commits value. The adapter entered the shipped registry through a neutral manifest — the central sources never name a provider, and a test fails if one appears.")}
              </p>
            </InfoControl>
          }
        >
          <KeyValue label={text("Adapter")}>
            <span className="so-mint" translate="no">
              {SOLANA_TOKEN_2022_ADAPTER_REF}
            </span>
          </KeyValue>
          <KeyValue label={text("Action")}>
            <span className="so-mint" translate="no">
              {SPL_TRANSFER_ACTION_REF}
            </span>
          </KeyValue>
          <KeyValue label={text("Canonical class")}>
            <span translate="no">VALUE_TRANSFER</span> — {text("readable without knowing the chain")}
          </KeyValue>
          <KeyValue label={text("Amounts")}>{text("Raw base-unit strings end to end; a float cannot exist as a concept.")}</KeyValue>
        </Panel>

        <Panel
          id="solana-dev-schemas"
          title={text("Published contracts")}
          w={6}
          h={4}
          scroll
          badge={text("Public")}
          tone="evidence"
          headerExtra={
            <InfoControl label={text("Where these live")}>
              <p>
                {text("Four JSON Schemas generated from the zod sources into `docs/solana/schemas/`, with a parity test that regenerates and compares — drift fails the suite. They ship in the public evidence kit, so the contract a stranger reads and the contract this workspace enforces are the same four files.")}
              </p>
            </InfoControl>
          }
        >
          {SCHEMA_FILES.map((file) => (
            <KeyValue key={file} label={file.replace(".schema.json", "")}>
              <span className="so-mint" translate="no">
                {file}
              </span>
            </KeyValue>
          ))}
          <KeyValue label={text("Public kit")}>
            <a className="so-open" href={SOLANA_EVIDENCE_REPOSITORY_URL} rel="noreferrer noopener" target="_blank">
              ryntra-io/ryntra-solana-evidence
            </a>{" "}
            — {text("Apache-2.0, SDK, local MCP server and CLI, read-only")}
          </KeyValue>
        </Panel>

        <Panel
          id="solana-dev-sources"
          title={text("RPC sources")}
          w={6}
          h={4}
          scroll
          badge={text("Config fact")}
          tone="muted"
          headerExtra={
            <InfoControl label={text("How an endpoint is chosen")}>
              <p>
                {text("An explicit endpoint wins over the environment; the environment wins over the public default. Mainnet resolves to a pair rather than one host: the primary is asked first, and a transport failure — a timeout, a refusal, a response over the ceiling — moves the same call to an independent operator. A JSON-RPC answer is never retried, because “not found” is a fact and re-asking does not change facts. Every read carries a 10s per-endpoint timeout, an 8 MiB response ceiling and one bounded retry, and every fact it produces is stamped with the host that actually answered.")}
              </p>
            </InfoControl>
          }
        >
          {resolveEndpoints("mainnet").map((endpoint) => (
            <KeyValue
              key={endpoint.role}
              label={text(endpoint.role === "primary" ? "Mainnet primary" : "Mainnet fallback — independent operator")}
            >
              <span className="so-mint" translate="no">
                {endpoint.host}
              </span>{" "}
              — {text(endpoint.fromEnv ? "from the environment" : "public default, not production infrastructure")}
            </KeyValue>
          ))}
          <KeyValue label={text("Devnet — internal fixture only")}>
            <span className="so-mint" translate="no">
              {resolveEndpoint("devnet")}
            </span>{" "}
            — {text("a regression fixture for the Send path awaiting its mainnet rewrite (RYN-SOL-M0C), never a release gate")}
          </KeyValue>
          <KeyValue label={text("Environment overrides")}>
            <span className="so-mint" translate="no">
              {ENV_OVERRIDES.mainnet.primary} · {ENV_OVERRIDES.mainnet.fallback} · {ENV_OVERRIDES.devnet.primary} ·{" "}
              {ENV_OVERRIDES.devnet.fallback}
            </span>
          </KeyValue>
          <KeyValue label={text("Venue quotes")}>
            <span className="so-mint" translate="no">
              {JUPITER_SWAP_V2_BASE_URL}/order
            </span>{" "}
            — {text(jupiter.ok ? "keyed production configured" : "production key required")}; {text("the key enters only through")}{" "}
            <span className="so-mint" translate="no">
              {JUPITER_ENV_OVERRIDES.apiKey}
            </span>
          </KeyValue>
          <KeyValue label={text("Custom route contract")}>
            <span className="so-mint" translate="no">{JUPITER_SWAP_V2_BASE_URL}/build</span> — {text("typed for the future allowlist path; no network caller in M0D")}
          </KeyValue>
        </Panel>

        <Panel
          id="solana-dev-refusals"
          title={text("What this kit refuses")}
          w={6}
          h={4}
          scroll
          badge={text("By construction")}
          tone="caution"
          headerExtra={
            <InfoControl label={text("Why refusals are listed")}>
              <p>
                {text("A boundary that is not written down gets renegotiated by accident. These are structural: no code path here signs anything and no key reaches Ryntra. Send is the one surface that reaches the network at all, and it forwards bytes your own wallet signed, after comparing them to the ones that were built.")}
              </p>
            </InfoControl>
          }
        >
          <KeyValue label={text("Keys and signing")}>{text("Never. No key reaches Ryntra and no code path here signs.")}</KeyValue>
          <KeyValue label={text("Guessing")}>
            {text("An account that is not a mint is refused by name; an extension without written semantics is reported, not interpreted.")}
          </KeyValue>
          <KeyValue label={text("Unknown references")}>
            {text("The registry resolves fail-closed: an unknown adapter, version or kind is a refusal, not a fallback.")}
          </KeyValue>
          <KeyValue label={text("Verdict vocabulary")}>
            {text("The policy ladder bottoms out at NO_KNOWN_BLOCKER — the word “safe” is not in it, and a test holds that.")}
          </KeyValue>
        </Panel>
      </PanelGrid>
    </>
  );
}
