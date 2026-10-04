import { InfoControl } from "@/app/shell/info-control";
import { KeyValue, Panel, PanelGrid } from "@/app/shell/panel";
import { StatusChip } from "@/app/shell/status-chip";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { getAdminSession } from "@/lib/session";
import {
  readSolanaCanaryBudget,
  readSolanaCanarySpendEvidence,
  type SolanaCanarySpendEntry,
} from "@/lib/solana/canary-ledger";
import { describeCanaryRuntime, resolveCanaryRuntime } from "@/lib/solana/canary-runtime";
import {
  SOLANA_CANARY_ENV,
  SOLANA_CANARY_FAMILIES,
  resolveSolanaCanaryPolicy,
  type SolanaCanaryBudgetSnapshot,
} from "@/lib/solana/canary-policy";
import { ENV_OVERRIDES, resolveEndpoints } from "@/lib/solana/rpc";
import { PageHead } from "../hub/parts.tsx";
import { SettingsReceipts, SettingsWallet } from "./settings-client.tsx";
import { solanaServerText } from "../i18n/server.ts";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function usd(micros: string): string {
  const value = BigInt(micros);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USD` : `${whole} USD`;
}

/**
 * What is left after both kinds of exposure.
 *
 * Reserved money is not spent, but it is not available either — it is promised
 * to an action that has not finished. A remaining figure that ignored it would
 * be the number a second canary is measured against, and it would be wrong in
 * the direction that permits an overspend. Clamped at zero rather than shown
 * negative: a negative remaining is a ledger defect, and the ledger's own
 * invariants refuse to create one.
 */
function remaining(limit: string, reserved: string, spent: string): string {
  const left = BigInt(limit) - BigInt(reserved) - BigInt(spent);
  return (left > 0n ? left : 0n).toString();
}

/** The first and last of a base58 signature, enough to recognise on chain. */
function shortSignature(signature: string): string {
  return signature.length <= 20 ? signature : `${signature.slice(0, 10)}…${signature.slice(-6)}`;
}

/**
 * Settings — the facts a person controls or must know, nothing else.
 *
 * Appearance, density and layout live in the shell's own Customize control in
 * the top bar; duplicating them here would be two controls writing one
 * preference, which is the recorded way they end up disagreeing on screen.
 * What belongs to this page is what the workspace reads and what it
 * structurally cannot do — both rendered from the modules that own them.
 */
export default async function SolanaSettingsPage() {
  const { text } = await solanaServerText();
  /* Rendered from the module that honours them rather than retyped: a second
     list of endpoints is a second answer waiting to disagree with the first. */
  const mainnet = resolveEndpoints("mainnet");
  const operator = (await getAdminSession()) !== null;
  const canary = resolveSolanaCanaryPolicy();
  /* The same read the customer routes make, described for the one person who
     can act on it. Strict resolution stays above so the rest of this page keeps
     showing the real policy when there is one. */
  const canaryRuntime = describeCanaryRuntime(resolveCanaryRuntime());
  let budget: SolanaCanaryBudgetSnapshot | null = null;
  let spendEvidence: readonly SolanaCanarySpendEntry[] = [];
  if (canary.ok) {
    try {
      const store = getGuardRuntime().store;
      budget = await readSolanaCanaryBudget({ store, policy: canary.policy });
      spendEvidence = await readSolanaCanarySpendEvidence({ store, policyId: canary.policy.policyId });
    } catch {
      budget = null;
    }
  }
  const canaryState = canary.ok ? canary.policy.state : "UNKNOWN";
  const boundary = budget?.storeBoundary ?? "UNAVAILABLE";

  return (
    <>
      <PageHead title="Settings" />

      <PanelGrid label={text("Settings")}>
        {/* Four short panels, not one wall.

            This page opened with a single panel called "What this workspace
            cannot do" whose five values were paragraphs — a key policy, a CCTP
            signing exception, a retention policy and a records policy, printed
            in full at rest. DESIGN.md's rule: a resting surface shows a value
            and a state, and the prose lives one disclosure deep. Not a sentence
            of it was deleted; every one moved into the hint beside the row it
            explains. */}
        <Panel id="settings-network" title={text("Network")} w={6} h={5} badge={text("Solana mainnet")} tone="evidence">
          <KeyValue
            label={text("Reads")}
            hint={
              <InfoControl label={text("Why there is no network switch")}>
                <p>
                  {text("Every read here is Solana mainnet, because that is where the real mints are and mainnet is the only network this product treats as a release target. A devnet endpoint stays configured as an internal regression fixture; a switch between the two would offer a choice that means nothing.")}
                </p>
              </InfoControl>
            }
          >
            {text("Solana mainnet")}
          </KeyValue>
          <KeyValue label={text("What is read")}>{text("Balances, prices, mints and your own operations")}</KeyValue>
          <KeyValue
            label={text("If a read fails")}
            hint={
              <InfoControl label={text("How a read is bounded")}>
                <p>
                  {text("Ten seconds per endpoint, the primary asked first and an independent operator answering when it does not, one bounded retry, and the answering host stamped on every read. A read that could not complete says so rather than showing you a zero.")}
                </p>
              </InfoControl>
            }
          >
            {text("It says so, and never shows a zero")}
          </KeyValue>
          <KeyValue label={text("Appearance and layout")}>{text("In the top bar")}</KeyValue>
        </Panel>

        <Panel id="settings-wallet" title={text("Your wallet")} w={6} h={5} tone="evidence">
          <SettingsWallet />
        </Panel>

        <Panel id="settings-safety" title={text("What Ryntra never does")} w={6} h={5} badge={text("Structural")} tone="caution">
          <KeyValue label={text("Keys")}>{text("Holds none, requests none")}</KeyValue>
          <KeyValue label={text("Seed phrase")}>{text("Never sees one, never asks")}</KeyValue>
          <KeyValue
            label={text("Signing")}
            hint={
              <InfoControl label={text("The one named exception")}>
                <p>
                  {text("Your own wallet signs every transfer, and no Ryntra server holds a key. A CCTP bridge needs a second signature no wallet can give — Circle's message account has to sign for its own creation — so the page makes a key for that one transaction, in this browser only. It can move no money, it is sent nowhere, and it is discarded once the burn is submitted. A boundary with an unnamed exception is not a boundary.")}
                </p>
              </InfoControl>
            }
          >
            {text("Your wallet, one transaction at a time")}
          </KeyValue>
          <KeyValue
            label={text("Records")}
            hint={
              <InfoControl label={text("What is kept about an action")}>
                <p>
                  {text("What it did and what it cost, recorded against your wallet address — never a key, a seed phrase or signed bytes. That much is already public on the chain.")}
                </p>
              </InfoControl>
            }
          >
            {text("What an action did and cost")}
          </KeyValue>
          <KeyValue label={text("Accounts")}>{text("Nothing to sign up for")}</KeyValue>
        </Panel>

        <Panel id="settings-data" title={text("Your data")} w={6} h={5} tone="muted">
          <SettingsReceipts />
        </Panel>

        {/* Operator controls. A customer settings page is for a person's own
            preferences; endpoint hostnames, environment variable names, the
            canary experiment budget and a durable-store boundary are none of
            their business and were never useful to them. They are still here,
            behind the session that means an operator is looking. */}
        {operator ? (
          <>
          {/* Loudest first, and only for the person who can fix it. A fallback
              that stood in silently for a healthy policy would be worse than the
              refusal it replaced, so the degraded state is the first thing an
              operator sees and it says in one line that customers are fine. */}
          <Panel
            id="solana-set-canary-runtime"
            title={text("Owner Canary Policy")}
            w={6}
            h={5}
            scroll
            badge={canaryRuntime.label}
            tone={canaryRuntime.state === "DEGRADED" ? "caution" : "evidence"}
          >
            <KeyValue label={text("Customer money flows")}>{text("Unaffected")}</KeyValue>
            <KeyValue label={text("Owner canaries")}>
              {canaryRuntime.ownerCanaries === "ENABLED" ? text("Enabled") : text("Disabled")}
            </KeyValue>
            <KeyValue label={text("Canary budget writes")}>
              {canaryRuntime.budgetWrites === "ENABLED" ? text("Enabled") : text("Disabled")}
            </KeyValue>
            {canaryRuntime.reason ? (
              <KeyValue label={text("Reason")}>{canaryRuntime.reason}</KeyValue>
            ) : null}
            <KeyValue label={text("Last checked")}>
              <span translate="no">{canaryRuntime.checkedAt}</span>
            </KeyValue>
          </Panel>
          <Panel
            id="solana-set-network"
            title={text("Network")}
            w={6}
            /* Five, not four: the pair added a row and the read discipline grew
               one. At four the fallback endpoint sat behind a scrollbar, which
               is the one row on this panel a reader most needs to see. */
            h={7}
            scroll
            badge={text("Config fact")}
            tone="evidence"
            headerExtra={
              <InfoControl label={text("Why there is no network switch")}>
                <p>
                  {text("Every read here is Solana mainnet, because that is where the real mints are, and mainnet is the only network this product treats as a release target. A devnet endpoint stays configured only as an internal regression fixture; Send has moved to mainnet semantics — a fixture is not a step, and a switch between the two would offer a choice that means nothing to a reader. There are two mainnet endpoints rather than one because a single public endpoint is not production infrastructure: the primary is asked first and an independent operator answers when it does not, and the workspace says which one answered instead of substituting quietly.")}
                </p>
              </InfoControl>
            }
          >
            <KeyValue label={text("Reads")}>{text("Solana mainnet, read-only")}</KeyValue>
            <KeyValue label={text("Venue quotes")}>
              {text("Jupiter Swap API V2 `/order`, keyed production and read-only — keyless access exists only when explicitly selected and is labelled degraded")}
            </KeyValue>
            {mainnet.map((endpoint) => (
              <KeyValue key={endpoint.role} label={text(endpoint.role === "primary" ? "Mainnet endpoint" : "Independent fallback")}>
                <span className="so-mint" translate="no">
                  {endpoint.host}
                </span>{" "}
                — {text(endpoint.fromEnv ? "supplied through the environment" : "public default, not production infrastructure")}
              </KeyValue>
            ))}
            <KeyValue label={text("Override")}>
              <span className="so-mint" translate="no">
                {ENV_OVERRIDES.mainnet.primary} · {ENV_OVERRIDES.mainnet.fallback}
              </span>{" "}
              — {text("a provider URL enters through the environment, never through code")}
            </KeyValue>
            <KeyValue label={text("Read discipline")}>
              {text("10s per endpoint, primary then fallback, one bounded retry, an 8 MiB response ceiling, freshness and the answering host stamped on every read")}
            </KeyValue>
          </Panel>

          <Panel
            id="solana-set-canary-policy"
            title={text("Owner canary control")}
            w={6}
            h={7}
            scroll
            badge={canaryState}
            tone={canaryState === "OPEN" ? "evidence" : "caution"}
            headerExtra={
              <InfoControl label={text("What this control can and cannot do")}>
                <p>
                  {text("This is the enforced pre-sign policy for the first owner-controlled mainnet canaries. It does not create a wallet, move funds or authorize a transaction. The operator switch is deployment configuration, not a public browser control; missing or invalid configuration fails closed.")}
                </p>
              </InfoControl>
            }
          >
            <KeyValue label={text("Emergency stop")}>
              <StatusChip family="risk" tone={canaryState === "OPEN" ? "verified" : "caution"}>
                {canaryState}
              </StatusChip>{" "}
              — {text("new value-moving reservations only; reads and recovery remain available")}
            </KeyValue>
            <KeyValue label={text("Operator switch")}>
              <span className="so-mint" translate="no">{SOLANA_CANARY_ENV.state}</span> — {text("defaults to PAUSED")}
            </KeyValue>
            <KeyValue label={text("Package ceiling")}>20 USD · {text("20 USD equivalent · upper bound, not a spending target").replace(/^.*? · /, "")}</KeyValue>
            <KeyValue label={text("Reserved / spent")}>
              {budget?.readState === "AVAILABLE"
                ? `${usd(budget.reservedUsdMicros)} / ${usd(budget.spentUsdMicros)}`
                : text("UNKNOWN — durable ledger could not be read")}
            </KeyValue>
            <KeyValue label={text("Remaining")}>
              {budget?.readState === "AVAILABLE"
                ? `${usd(remaining(budget.totalLimitUsdMicros, budget.reservedUsdMicros, budget.spentUsdMicros))} ${text("of")} ${usd(budget.totalLimitUsdMicros)}`
                : text("UNKNOWN — durable ledger could not be read")}
            </KeyValue>
            <KeyValue label={text("Fee reserve")}>
              {budget?.readState === "AVAILABLE"
                ? `${usd(budget.feeReservedUsdMicros)} ${text("reserved")} / ${usd(budget.feeSpentUsdMicros)} ${text("spent")}`
                : text("UNKNOWN — SOL fee/rent exposure is not available")}
            </KeyValue>
            <KeyValue label={text("Durability")}>
              <span className="so-mint" translate="no">{boundary}</span> — {text("production requires DURABLE_MULTI_WRITER")}
            </KeyValue>
            <KeyValue label={text("Decision vocabulary")}>
              <span className="so-mint" translate="no">ALLOW · REVIEW · BLOCK · PAUSE · UNKNOWN</span>
            </KeyValue>
            <KeyValue label={text("Meaning")}>{text("ALLOW means only that this exact intent fits this exact policy and evidence.")}</KeyValue>
          </Panel>

          {/* Full width and directly under the totals it explains. A list of
              transactions is wide and short, and putting it in a half-width
              column left a tall empty box beside a five-line panel — the ragged
              row the grid is meant to prevent. */}
          <Panel
            id="solana-set-canary-evidence"
            title={text("What the canary budget was spent on")}
            w={12}
            h={4}
            scroll
            badge={text("On chain")}
            tone="muted"
            headerExtra={
              <InfoControl label={text("Why a signature is beside every figure")}>
                <p>
                  {text("A budget that prints only a total asks to be believed. Each row below names the transaction the exposure was settled against, and that transaction is a public fact: read it back on the chain and the ledger is either telling the truth or it is not. A HELD row is money promised to an action whose outcome is not yet known; it is counted against the ceiling and never counted as a spend.")}
                </p>
              </InfoControl>
            }
          >
            {spendEvidence.length === 0 ? (
              <KeyValue label={text("Entries")}>
                {budget?.readState === "AVAILABLE"
                  ? text("None. No canary action has committed or held budget under this policy.")
                  : text("UNKNOWN — durable ledger could not be read")}
              </KeyValue>
            ) : (
              spendEvidence.map((entry) => (
                <KeyValue key={entry.intentDigest} label={entry.family.replaceAll("_", " ")}>
                  {usd(entry.usdMicros)} · {entry.state === "COMMITTED" ? text("spent") : text("held, outcome unknown")}
                  {" · "}
                  {entry.signature ? (
                    <span className="so-mint" translate="no">{shortSignature(entry.signature)}</span>
                  ) : (
                    text("no signature recorded")
                  )}
                </KeyValue>
              ))
            )}
          </Panel>

          <Panel
            id="solana-set-canary-limits"
            title={text("Canary family limits")}
            w={6}
            h={7}
            scroll
            badge={text("Policy v1")}
            tone="muted"
            headerExtra={
              <InfoControl label={text("Why each family is separate")}>
                <p>
                  {text("Send, ATA creation, Swap, CCTP and Token-2022 prove different effects. One successful action never spends or proves another family's budget. Destination, mint and program allowlists are checked per family; an empty allowlist blocks rather than reviews.")}
                </p>
              </InfoControl>
            }
          >
            {canary.ok ? (
              SOLANA_CANARY_FAMILIES.map((family) => {
                const rule = canary.policy.families[family];
                const used = budget?.families[family];
                return (
                  <KeyValue key={family} label={family.replaceAll("_", " ")}>
                    {usd(rule.minimumUsdMicros)}–{usd(rule.maximumUsdMicros)} · {text("destinations")} {rule.allowedDestinations.length}
                    {" · "}{text("mints")} {rule.allowedMints.length} · {text("programs")} {rule.allowedPrograms.length}
                    {used
                      ? ` · ${text("reserved")} ${usd(used.reservedUsdMicros)} · ${text("spent")} ${usd(used.spentUsdMicros)} · ${text("remaining")} ${usd(remaining(rule.maximumUsdMicros, used.reservedUsdMicros, used.spentUsdMicros))}`
                      : ""}
                  </KeyValue>
                );
              })
            ) : (
              <KeyValue label={text("Policy")}>{text("UNKNOWN")} — <span translate="no">{canary.reason}</span></KeyValue>
            )}
          </Panel>

          </>
        ) : null}
      </PanelGrid>
    </>
  );
}
