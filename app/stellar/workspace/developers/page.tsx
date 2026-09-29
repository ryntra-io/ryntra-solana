import { InfoControl } from "@/app/shell/info-control";
import { KeyValue, Panel, PanelGrid } from "@/app/shell/panel";
import { EVIDENCE_STATES } from "@/lib/stellar/evidence";
import { PageHead } from "../hub/parts.tsx";

export const metadata = { title: "Developers" };

/**
 * Developers.
 *
 * What the adapter reads, from which source, and what it refuses. Written for
 * someone deciding whether to trust a number this workspace shows them — which
 * means the refusals matter as much as the capabilities.
 *
 * The reads were six stacked prose cards and are a table now: six rows with four
 * attributes each is a table by nature, and a reader comparing sources should
 * not have to hold a column in their head. The evidence-state list is rendered
 * from `EVIDENCE_STATES` rather than retyped, so the page cannot claim a
 * vocabulary the code does not use — which is exactly the drift the canon
 * repaired in §12 and the one a hand-written list here would reintroduce.
 */

const READS = [
  ["Network pulse", "Stellar RPC", "getNetwork + getHealth", "Ledger, protocol, endpoint status and its retention horizon."],
  ["Ledger parameters", "Horizon", "/ledgers?order=desc&limit=1", "Base fee and base reserve, read rather than assumed."],
  ["Issuer controls", "Horizon", "/accounts/{issuer}", "auth_required, auth_revocable, auth_immutable, clawback, home domain."],
  ["Holding requirement", "Horizon", "/accounts/{account}", "Trustline existence, authorization, limit and reserve cost."],
  ["Asset statistics", "Horizon", "/assets?asset_code=&asset_issuer=", "Holder addresses, supply, contract holdings and the SAC id."],
  ["Issuer declaration", "The issuer's domain", "/.well-known/stellar.toml", "SEP-1: backing claim, reserve attestation, redemption. The issuer describing itself."],
  ["Transaction finality", "Stellar RPC", "getTransaction", "Whether a ledger holds a submitted transaction yet, and which one."],
  ["Actual effects", "Horizon", "/transactions/{hash} + /effects", "Credits, debits, the fee charged and the ledger's own envelope — what a receipt reconciles against."],
] as const;

const BOUNDS: readonly (readonly [string, string])[] = [
  ["Read allowlist", "Only getNetwork, getHealth and getVersionInfo. sendTransaction is refused by name, before any request is made."],
  [
    "One write path, declared separately",
    "lib/stellar/transactions/submit.ts is the only module that may reach a network with a transaction, and it takes the cleared verdict rather than an XDR — so bytes that never passed the comparison have no way in. It runs in the browser; nothing signed reaches a Ryntra server. A test asserts that sendTransaction appears in exactly two files: the one that refuses it and that one.",
  ],
  [
    "getLatestLedger is excluded",
    "Not for safety: its mainnet response measured 3.18 MB, almost all of it metadataXdr nothing here reads. getHealth carries the same ledger in 207 bytes.",
  ],
  ["Hard timeout and size cap", "8 seconds, 2 MB. A hanging or oversized source fails closed rather than hanging a page."],
  ["Redirects refused", "A source that wants to move us is a decision for a person, not something to follow at read time."],
  ["No XDR", "SAC and SEP-41 contract reads need XDR decoding, which would force the official SDK. They return UNKNOWN with that reason attached."],
  ["No dependency", "The adapter adds no package. Everything above is plain JSON or a small SEP-1 subset parser."],
];

export default function StellarDevelopersPage() {
  return (
    <>
      <PageHead
        title="Developers"
        module="developers"
        lead="Every read this workspace performs, the source that answers it, and the boundaries the adapter enforces in code."
      />

      <PanelGrid label="Developers">
        <Panel
          id="stellar-dev-reads"
          title="Reads"
          w={12}
          h={4}
          essential
          scroll
          badge={`${READS.length} reads`}
          tone="evidence"
          headerExtra={
            <InfoControl label="About the sources">
              <p>
                Stellar RPC answers live network state; Horizon answers the classic facts that are JSON there and XDR
                everywhere else; SEP-1 comes from the issuer&rsquo;s own domain and is the issuer describing itself.
                Horizon is nearing end-of-life, so every read records which source answered — replacing one later is a
                source change, not a rewrite.
              </p>
            </InfoControl>
          }
        >
          <div className="rw-tablewrap">
            <table className="rw-table">
              <thead>
                <tr>
                  <th scope="col">Read</th>
                  <th scope="col">Source</th>
                  <th scope="col">Path</th>
                  <th scope="col">What it returns</th>
                </tr>
              </thead>
              <tbody>
                {READS.map(([name, source, path, detail]) => (
                  <tr key={name}>
                    <th scope="row">
                      <span className="st-code">{name}</span>
                    </th>
                    <td>
                      <span className="st-tag" data-on="false">
                        {source}
                      </span>
                    </td>
                    <td>
                      <span className="st-domain" translate="no">
                        {path}
                      </span>
                    </td>
                    <td>
                      <span className="st-note">{detail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          id="stellar-dev-envelope"
          title="The evidence envelope"
          w={6}
          /* Matches the refusals panel beside it, which needs the height. */
          h={6}
          scroll
          badge="Type-enforced"
          tone="verified"
          headerExtra={
            <InfoControl label="Why a value cannot be sourceless">
              <p>
                The resolved branch of <code>Evidence&lt;T&gt;</code> requires at least one source, so{" "}
                <strong>a value with no source does not compile</strong>. Freshness is computed from the observation
                time against a per-fact budget and is never a parameter a caller can assert. There is no composite
                score, and there will not be one — five states across many fields is the honest shape, and one number
                is a lie with a progress bar.
              </p>
            </InfoControl>
          }
        >
          <KeyValue label="Every read returns">
            <span translate="no">data · sources · as_of · state</span>
          </KeyValue>
          <KeyValue label="States">
            <span translate="no">{EVIDENCE_STATES.join(" · ")}</span>
          </KeyValue>
          <KeyValue label="Composite score">None, by construction</KeyValue>
        </Panel>

        <Panel
          id="stellar-dev-bounds"
          title="Bounds and refusals"
          w={6}
          /* Six refusals with their reasons measured 123px past a four-row
             panel. A reference list a reader has to scroll to finish is a
             reference list they will stop halfway through. */
          h={6}
          scroll
          badge={`${BOUNDS.length}`}
          tone="caution"
          headerExtra={
            <InfoControl label="Why refusals are listed">
              <p>
                Written for someone deciding whether to trust a number this workspace shows them, which makes what the
                adapter refuses as load-bearing as what it reads.
              </p>
            </InfoControl>
          }
        >
          {BOUNDS.map(([title, detail]) => (
            <KeyValue key={title} label={title}>
              {detail}
            </KeyValue>
          ))}
        </Panel>
      </PanelGrid>
    </>
  );
}
