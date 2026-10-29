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
import { CLIENT, CONSOLE, CONTRACT, IDEMPOTENCY, PAGING, REFUSALS, readsByTag } from "./api-surface.ts";

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
            — {text("a regression fixture for the Send path awaiting its mainnet rewrite, never a release gate")}
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
            <span className="so-mint" translate="no">{JUPITER_SWAP_V2_BASE_URL}/build</span> — {text("typed for the future allowlist path; no network caller yet")}
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

      <PanelGrid label={text("Ryntra API v1")}>
        <Panel
          id="solana-dev-api-contract"
          title={text("The contract, and the document")}
          w={6}
          h={5}
          scroll
          badge={text("Shipped")}
          tone="evidence"
          headerExtra={
            <InfoControl label={text("Why the document is generated")}>
              <p>
                {text("The zod schemas the routes validate with are the only description of this API. The OpenAPI document is generated from them and a test regenerates it and compares, so the document cannot describe a field the routes do not produce — and the worked answers beside it are built the same way and parsed back with the same schemas. A hand-written OpenAPI file is a second description, and second descriptions disagree silently.")}
              </p>
            </InfoControl>
          }
        >
          <KeyValue label={text("Contract version")}>
            <span className="so-mint" translate="no">
              {CONTRACT.version}
            </span>{" "}
            — {text("major")} {CONTRACT.major}, {text("which every client names in")}{" "}
            <span className="so-mint" translate="no">
              {CONTRACT.majorHeader}
            </span>
          </KeyValue>
          <KeyValue label={text("Every answer carries")}>
            <span className="so-mint" translate="no">
              {CONTRACT.versionHeader}
            </span>{" "}
            — {text("the exact version the route implements")}
          </KeyValue>
          <KeyValue label={text("Source of truth")}>
            <span className="so-mint" translate="no">
              {CONTRACT.source}
            </span>
          </KeyValue>
          <KeyValue label={text("The document")}>
            <span className="so-mint" translate="no">
              OpenAPI {CONTRACT.openapi} · {CONTRACT.document}
            </span>{" "}
            — {text("generated by")}{" "}
            <span className="so-mint" translate="no">
              {CONTRACT.generator}
            </span>
          </KeyValue>
          <KeyValue label={text("Worked answers")}>
            <span className="so-mint" translate="no">
              {CONTRACT.examples}
            </span>{" "}
            — {text("real bodies, generated from the same schemas")}
          </KeyValue>
          <KeyValue label={text("Written reference")}>
            <span className="so-mint" translate="no">
              {CONTRACT.reference}
            </span>
          </KeyValue>
        </Panel>

        <Panel
          id="solana-dev-api-client"
          title={text("The client")}
          w={6}
          h={5}
          scroll
          badge={text("Reads only")}
          tone="evidence"
          headerExtra={
            <InfoControl label={text("Where its surface comes from")}>
              <p>
                {text("The client is generated from the document, and the document derives its read surface itself: every GET it serves without a bearer. Nothing is picked by hand, so a new public read joins the package the moment it joins the contract, and a read the document does not describe cannot be called from the package at all. The request discipline, the validator, the cursor walk and the error classes are written by hand beside it, because those are decisions rather than transcriptions.")}
              </p>
            </InfoControl>
          }
        >
          <KeyValue label={text("Package")}>
            <span className="so-mint" translate="no">
              {CLIENT.name} · {CLIENT.source}
            </span>{" "}
            — {text("no dependency beyond fetch, and no build step")}
          </KeyValue>
          <KeyValue label={text("Reads it serves")}>
            {CLIENT.reads} —{" "}
            <span className="so-mint" translate="no">
              {readsByTag()
                .slice(0, 6)
                .map((row) => `${row.tag} ${row.count}`)
                .join(" · ")}
            </span>
          </KeyValue>
          <KeyValue label={text("Methods")}>
            <span className="so-mint" translate="no">
              {CLIENT.methods.join(" · ")}
            </span>{" "}
            — {text("one answer, a page at a time, the cursor flattened")}
          </KeyValue>
          <KeyValue label={text("Answers are checked")}>
            {text("Every answer is validated against the contract's own schema before the client returns it. A field the contract does not know about is not a failure: the point of an additive contract is that adding one is safe, so a client already in use must survive it.")}
          </KeyValue>
          <KeyValue label={text("Boundary")}>
            {text("Reads only, and structurally rather than by policy: every read is a GET the contract serves without a bearer, so there is nothing to sign in with and nothing to authorise. The package holds no key, builds no transaction and signs nothing, because none of that code is in it.")}
          </KeyValue>
          <KeyValue label={text("Runnable example")}>
            <span className="so-mint" translate="no">
              {CLIENT.example}
            </span>{" "}
            — {text("a clean npm install, then one command; its own test runs offline")}
          </KeyValue>
        </Panel>

        <Panel
          id="solana-dev-api-refusals"
          title={text("Refusals, and whether to ask again")}
          w={6}
          h={6}
          scroll
          badge={text("From the contract")}
          tone="caution"
          headerExtra={
            <InfoControl label={text("Why retryability is a table rather than a judgement")}>
              <p>
                {text("A 409 is a decision and a 429 is a queue. The client reads which is which from the contract's own error table instead of guessing from the status, so «can I ask again?» has one answer in one place — and a code newer than the client is still an error with a code, never a crash. Branch on the class and the code; the message is for a person and may change.")}
              </p>
            </InfoControl>
          }
        >
          <KeyValue label={text("Codes")}>
            {REFUSALS.codes} — {REFUSALS.retryable} {text("of them worth asking again")}
          </KeyValue>
          <KeyValue label={text("Statuses used")}>
            <span className="so-mint" translate="no">
              {REFUSALS.statuses.join(" · ")}
            </span>
          </KeyValue>
          <KeyValue label={<span className="so-mint" translate="no">RyntraTransportError</span>}>
            {text("The request never got an answer. Always worth asking again, because nothing was decided.")}
          </KeyValue>
          <KeyValue label={<span className="so-mint" translate="no">RyntraApiError</span>}>
            {text("A /api/v1 refusal with a stable code; its retryability comes from the contract's own table.")}
          </KeyValue>
          <KeyValue label={<span className="so-mint" translate="no">RyntraRouteError</span>}>
            {text("A route outside /api/v1 refused, with its own code rather than a borrowed one.")}
          </KeyValue>
          <KeyValue label={<span className="so-mint" translate="no">RyntraProtocolError</span>}>
            {text("Something answered, but not with an answer.")}
          </KeyValue>
          <KeyValue label={<span className="so-mint" translate="no">RyntraSchemaError</span>}>
            {text("A 200 that is not the shape the contract states. Never retryable: the server meant it, and it disagrees with the document.")}
          </KeyValue>
        </Panel>

        <Panel
          id="solana-dev-api-paging"
          title={text("Cursors, and the idempotency key")}
          w={6}
          h={6}
          scroll
          badge={text("Stated as it is")}
          tone="muted"
          headerExtra={
            <InfoControl label={text("What the key does today")}>
              <p>
                {text("The client sends the header on everything that is not a GET, and the caller may fix it so a retry repeats the same key — the point of a key is that one intent keeps one key. No route reads it yet: the store that would remember a key belongs with the API keys of the developer console. The consequence is drawn rather than hidden — a write is never retried automatically, because until the server remembers the key, retrying a write is writing twice.")}
              </p>
            </InfoControl>
          }
        >
          <KeyValue label={text("Paging")}>
            <span className="so-mint" translate="no">
              {PAGING.parameter}
            </span>{" "}
            {text("in,")}{" "}
            <span className="so-mint" translate="no">
              {PAGING.nextField}
            </span>{" "}
            {text("out; null means there is no next page. No total and no page number.")}
          </KeyValue>
          <KeyValue label={text("Reads that page today")}>
            <span className="so-mint" translate="no">
              {PAGING.reads.join(" · ")}
            </span>
          </KeyValue>
          <KeyValue label={text("Idempotency header")}>
            <span className="so-mint" translate="no">
              {IDEMPOTENCY.header}
            </span>{" "}
            — {text("sent by the client on every request that is not a GET")}
          </KeyValue>
          <KeyValue label={text("Honoured by a route")}>
            {IDEMPOTENCY.honoured
              ? text("yes")
              : text("Not yet — no route reads the header, so the client never retries a write on its own.")}
          </KeyValue>
        </Panel>

        <Panel
          id="solana-dev-console"
          title={text("The developer console")}
          w={12}
          h={5}
          scroll
          badge={text("Shipped, behind its switch")}
          tone="evidence"
          headerExtra={
            <InfoControl label={text("Why a secret key is refused in a browser rather than allowed carefully")}>
              <p>
                {text("An allowlist of origins is a rule about where a credential is used, and a secret key's problem is where it is kept. Once it is in a page it is in the reader's hands, and no list of origins changes that. So the console issues two different things: a secret key a server holds, which the server refuses outright on any request carrying an Origin, and a public key that has no secret at all — its id is the whole credential, and what bounds it is the origins it names.")}
              </p>
            </InfoControl>
          }
        >
          <KeyValue label={text("Projects and environments")}>
            <span className="so-mint" translate="no">
              {CONSOLE.path}
            </span>{" "}
            — {text("a project belongs to a team, and both environments exist from its first day; nothing is promoted between them")}
          </KeyValue>
          <KeyValue label={text("Credentials")}>
            <span className="so-mint" translate="no">
              {CONSOLE.keyKinds.join(" · ")}
            </span>{" "}
            — {text("a secret key's token is returned in the answer that makes it and in no other, ever: the store keeps a SHA-256 of it and a key's read view has no field one could be in. Rotation leaves the predecessor answering for the hours you give it; revocation ends it from the next request on.")}
          </KeyValue>
          <KeyValue label={text("Scopes and origins")}>
            <span className="so-mint" translate="no">
              {CONSOLE.scopes.join(" · ")}
            </span>{" "}
            — {text("each one gating a route that asks for it, so holding one changes an answer")}
          </KeyValue>
          <KeyValue label={text("Signed webhooks")}>
            <span className="so-mint" translate="no">
              {CONSOLE.signedPayload}
            </span>{" "}
            — {text("HMAC-SHA256 over the delivery's id, its second and the body. A receiver that checks only the signature is not protected from a replay: the same bytes verify for ever. The server refuses on a bad signature, a timestamp outside the window, or a delivery id this endpoint has already had verified.")}
          </KeyValue>
          <KeyValue label={text("Quotas")}>
            <span className="so-mint" translate="no">
              {CONSOLE.windows.join(" · ")}
            </span>{" "}
            — {text("counted per project and environment, with what is left on the answer's headers. A window this deployment states no number for is counted and never refused.")}
          </KeyValue>
          <KeyValue label={text("Rights")}>
            {text("Every action is one of the team's own rights, checked on the server on every request: reading is view, making a project is draft, issuing and revoking a credential is submit, the delivery log is receipts. The console invents no right and asks for no high-risk one.")}
          </KeyValue>
          <KeyValue label={text("Tariffs")}>
            {text("The fields a tariff has are named and none of them is filled: a price, an included call count and a ceiling are set outside this build.")}
          </KeyValue>
        </Panel>

        <Panel
          id="solana-dev-api-absent"
          title={text("What is not here")}
          w={12}
          h={4}
          scroll
          badge={text("Absences, not plans")}
          tone="caution"
          headerExtra={
            <InfoControl label={text("Why absences are listed")}>
              <p>
                {text("A developer surface that lists what it will have is a surface somebody tries to use. Each line below is an absence with the exact thing that would end it, and no date — because a date is a promise and a gate is a fact.")}
              </p>
            </InfoControl>
          }
        >
          <KeyValue label={text("No route reads the idempotency header.")}>
            {text("What would end it: a store that remembers a key for the window a retry lives in. The console's keys gave it somewhere to belong; nothing reads the header yet, so the client still never retries a write on its own.")}
          </KeyValue>
          <KeyValue label={text("The client has no writes.")}>
            {text("What would end it: an authority a key-free package has no way to carry.")}
          </KeyValue>
          <KeyValue label={text("A key reaches three reads, not the whole surface.")}>
            {text("The console's scopes are enforced where a route asks for one, and three routes do. The other public reads take no key because they need none; the keyed surface grows as routes adopt the check, not as names are added to the scope list.")}
          </KeyValue>
          <KeyValue label={text("There is one webhook event, and it is the test one.")}>
            {text("Deliveries are signed, retried and logged for real, and a replay is refused on the server. What is missing is producers: a product event joins the catalogue with the task that emits it.")}
          </KeyValue>
          <KeyValue label={text("No tariff is stated.")}>
            {text("The console names the fields a tariff has and fills none of them, and a quota window with no number is counted rather than refused. What would end it: the figures being set.")}
          </KeyValue>
          <KeyValue label={text("The package is not published.")}>
            {text("What would end it: a publication, which is the owner's own act.")}
          </KeyValue>
        </Panel>
      </PanelGrid>
    </>
  );
}
