import { type Evidence, isResolved } from "@/lib/stellar/evidence";
import type { IssuerControlEvidence, LedgerParameters, NetworkPulse } from "@/lib/stellar/reads";
import { ACTIVITY_COPY, needsAttention, type StellarActivityRecord } from "@/lib/stellar/activity/record";
import { WALLET_COPY, type StellarWalletState } from "@/lib/stellar/wallets/states";
import type { FeaturedAsset } from "../assets/featured.ts";

/**
 * Everything that needs a person, computed from facts that already exist.
 *
 * One function, two surfaces. The Overview shows it in a panel and the Attention
 * & Recovery page shows all of it grouped — and they must never disagree, which
 * is the failure mode this repository has hit every single time two lists were
 * supposed to say the same thing. So there is one list.
 *
 * **Nothing here is authored.** Each item comes from the wallet state machine,
 * the evidence state of a read, a source that did not answer, or a stored
 * lifecycle record. A hand-maintained status list is wrong within a week and
 * nobody notices, because the thing that went stale is the thing that was
 * supposed to tell you.
 *
 * The three severities are the founder's contract, in its order:
 *
 * ```text
 * action    something is blocked and you can unblock it
 * caution   something is degraded, or finished in a way worth reading
 * context   true, worth knowing, and not a task
 * ```
 */

export type AttentionSeverity = "action" | "caution" | "context";

export type AttentionItem = Readonly<{
  id: string;
  severity: AttentionSeverity;
  /** What happened. */
  title: string;
  /** Why it matters. */
  detail: string;
  /** What it affects — an asset, a transaction, a source. */
  subject: string | null;
  /** When it was observed, ISO, or null for a condition that is true right now. */
  observedAt: string | null;
  /** The exact next step. Never "try again". */
  recovery: string;
  /** Where that step happens, when it is somewhere in this workspace. */
  href: string | null;
}>;

export type AttentionInput = Readonly<{
  wallet: StellarWalletState;
  expectedNetwork: string;
  pulse: Evidence<NetworkPulse>;
  parameters: Evidence<LedgerParameters>;
  issuers: readonly Readonly<{ asset: FeaturedAsset; controls: Evidence<IssuerControlEvidence> }>[];
  activity: readonly StellarActivityRecord[];
  /** False when this browser will not keep a record of anything. */
  retained: boolean;
}>;

const SEVERITY_RANK: Readonly<Record<AttentionSeverity, number>> = { action: 0, caution: 1, context: 2 };

/** A truncated address or hash, for a subject line. */
function short(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function fromWallet(input: AttentionInput): readonly AttentionItem[] {
  const { wallet, expectedNetwork } = input;

  if (wallet === "WRONG_NETWORK") {
    return [
      {
        id: "wallet-wrong-network",
        severity: "action",
        title: WALLET_COPY.WRONG_NETWORK.title,
        detail:
          "A wallet on the wrong network signs happily, and the signature is valid — over the wrong network. Ryntra refuses to request one until it matches.",
        subject: expectedNetwork,
        observedAt: null,
        recovery: `Switch Freighter to ${expectedNetwork}. Ryntra cannot switch it for you.`,
        href: null,
      },
    ];
  }

  if (wallet === "LOCKED" || wallet === "ACCESS_DENIED" || wallet === "UNAVAILABLE") {
    return [
      {
        id: `wallet-${wallet}`,
        severity: wallet === "UNAVAILABLE" ? "caution" : "action",
        title: WALLET_COPY[wallet].title,
        detail: WALLET_COPY[wallet].body,
        subject: "Freighter",
        observedAt: null,
        recovery: WALLET_COPY[wallet].action ?? "Reconnect the wallet.",
        href: "/stellar/workspace/settings",
      },
    ];
  }

  if (wallet === "CONNECTED" || wallet === "SIGNING" || wallet === "SIGNED") return [];

  return [
    {
      id: "wallet-absent",
      severity: "context",
      title: wallet === "NOT_INSTALLED" ? "Freighter is not installed" : "No wallet is connected",
      detail:
        "Every mainnet read on this workspace is open without one. A wallet is needed only to send on testnet, and Ryntra never receives a key.",
      subject: null,
      observedAt: null,
      recovery:
        wallet === "NOT_INSTALLED"
          ? "Install the Freighter extension, then connect."
          : "Connect a Stellar Testnet wallet.",
      href: "/stellar/workspace/settings",
    },
  ];
}

function fromReads(input: AttentionInput): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  const { pulse, parameters, issuers } = input;

  if (!isResolved(pulse)) {
    items.push({
      id: "pulse-unavailable",
      severity: "action",
      title: "Stellar is not answering",
      detail: pulse.reason,
      subject: "Stellar RPC",
      observedAt: null,
      recovery: "Reload once. If it persists, the endpoint is down and every figure on this workspace is stale.",
      href: "/stellar/workspace/network",
    });
  } else if (pulse.state !== "FRESH") {
    items.push({
      id: "pulse-stale",
      severity: "caution",
      title: `Network read is ${pulse.state.toLowerCase()}`,
      detail: `The ledger figure was observed ${pulse.ageSeconds}s ago and has not been refreshed since.`,
      subject: "Stellar RPC",
      observedAt: pulse.observedAt,
      recovery: "Reload the page to read the ledger again.",
      href: "/stellar/workspace/network",
    });
  }

  if (!isResolved(parameters)) {
    items.push({
      id: "parameters-unavailable",
      severity: "caution",
      title: "Fees and the reserve are unavailable",
      detail: parameters.reason,
      subject: "Horizon",
      observedAt: null,
      recovery: "Reload. A payment can still be built; its fee ceiling uses the protocol default rather than a read.",
      href: "/stellar/workspace/network",
    });
  }

  const silent = issuers.filter((row) => !isResolved(row.controls));
  if (silent.length > 0) {
    items.push({
      id: "issuers-unavailable",
      severity: "caution",
      title: `${silent.length} issuer ${silent.length === 1 ? "read" : "reads"} did not answer`,
      detail: `Issuer powers are unknown for ${silent
        .map((row) => row.asset.code)
        .join(", ")}. Unknown is never rendered as "no power held".`,
      subject: silent.map((row) => row.asset.code).join(", "),
      observedAt: null,
      recovery: "Open the asset directly; a passport reads each issuer account on its own.",
      href: "/stellar/workspace/assets",
    });
  }

  return items;
}

/**
 * What a stored lifecycle still owes.
 *
 * `RECONCILIATION_REQUIRED` is deliberately `action` rather than `caution`: the
 * ledger did something other than what was authorized, and that is the exact
 * case this entire product exists to surface. Filing it under history would turn
 * the central claim into a log line.
 */
function fromActivity(input: AttentionInput): readonly AttentionItem[] {
  return needsAttention(input.activity).map((record) => {
    const subject = record.transactionHash ? short(record.transactionHash) : short(record.destination);

    if (record.state === "RECONCILIATION_REQUIRED") {
      return {
        id: `activity-${record.id}`,
        severity: "action" as const,
        title: "The ledger did not do what was authorized",
        detail:
          record.reason ??
          "Expected and actual movements disagree. The transaction is on the ledger; the difference is what needs reading.",
        subject,
        observedAt: record.updatedAt,
        recovery: "Open the record and compare expected against actual, movement by movement.",
        href: "/stellar/workspace/activity",
      };
    }

    if (record.state === "FAILED") {
      return {
        id: `activity-${record.id}`,
        severity: "action" as const,
        title: "A payment failed",
        detail: record.reason ?? ACTIVITY_COPY.FAILED.meaning,
        subject,
        observedAt: record.updatedAt,
        recovery: record.recovery ?? "Open the record, correct what the ledger refused, and prepare it again.",
        href: "/stellar/workspace/activity",
      };
    }

    return {
      id: `activity-${record.id}`,
      severity: "caution" as const,
      title: `${ACTIVITY_COPY[record.state].label}: ${record.amount} ${record.assetCode}`,
      detail: ACTIVITY_COPY[record.state].meaning,
      subject,
      observedAt: record.updatedAt,
      recovery:
        record.state === "SUBMITTED"
          ? "Re-read the ledger by transaction hash. An uncertain submission is reconciled, never re-sent."
          : "Continue it on the Send surface, or leave it — nothing is spent until it is submitted.",
      href: record.state === "SUBMITTED" ? "/stellar/workspace/receipts" : "/stellar/workspace/send",
    };
  });
}

function fromRetention(input: AttentionInput): readonly AttentionItem[] {
  if (input.retained) return [];
  return [
    {
      id: "retention-unavailable",
      severity: "context",
      title: "This browser will not remember anything",
      detail:
        "Activity is kept in this browser's local storage and nowhere else. Storage is unavailable here — a private window, or site data blocked — so a payment can still be prepared, signed and verified, and no record of it will survive the page.",
      subject: "This browser",
      observedAt: null,
      recovery: "Nothing is required. Download the receipt if you want a durable record.",
      href: "/stellar/workspace/receipts",
    },
  ];
}

export function attentionItems(input: AttentionInput): readonly AttentionItem[] {
  const items = [...fromWallet(input), ...fromReads(input), ...fromActivity(input), ...fromRetention(input)];
  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function blockingCount(items: readonly AttentionItem[]): number {
  return items.filter((item) => item.severity === "action").length;
}
