"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { InfoControl } from "@/app/shell/info-control";
import { EmptyState, KeyValue, Panel, PanelGrid } from "@/app/shell/panel";
import { STELLAR_TESTNET, transactionExplorerUrl } from "@/lib/stellar/network";
import {
  ACTIVITY_COPY,
  STELLAR_ACTIVITY_STATES,
  sortActivity,
  type StellarActivityState,
} from "@/lib/stellar/activity/record";
import { ACTIVITY_LIMIT } from "@/lib/stellar/activity/store";
import { useStellarActivity } from "../hub/use-activity.ts";

/**
 * Activity.
 *
 * A table and one detail panel, rather than a drawer. A drawer over a table is a
 * second scroll container inside a fixed-height panel, which is the shape that
 * put 219px of reconciliation result inside a 36px scrollport on this very
 * workspace — and the detail here is the important half, so it gets its own
 * standing room instead of a sliding one.
 *
 * **The filters are the founder's contract, in its order**, and they are derived
 * from the state vocabulary rather than typed beside it, so a new state cannot
 * exist without a filter that finds it.
 *
 * Nothing here is fetched. Every row is read from this browser's local storage,
 * which is the storage decision made visible: a surface with no server call is a
 * surface with no server record.
 */

const FILTERS: readonly { id: "ALL" | StellarActivityState; label: string }[] = [
  { id: "ALL", label: "All" },
  ...STELLAR_ACTIVITY_STATES.map((state) => ({ id: state, label: ACTIVITY_COPY[state].label })),
];

function stateTone(state: StellarActivityState): "verified" | "evidence" | "caution" | "danger" | "muted" {
  if (state === "RECONCILED") return "verified";
  if (state === "FAILED" || state === "RECONCILIATION_REQUIRED") return "danger";
  if (state === "BLOCKED") return "caution";
  if (state === "CONFIRMED" || state === "SUBMITTED" || state === "SIGNED") return "evidence";
  return "muted";
}

function stamp(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 19)}Z`;
}

export function ActivityConsole() {
  const { records, ready, retained, clear } = useStellarActivity();
  const [filter, setFilter] = useState<"ALL" | StellarActivityState>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(
    () => sortActivity(filter === "ALL" ? records : records.filter((record) => record.state === filter)),
    [records, filter],
  );

  const selected = records.find((record) => record.id === selectedId) ?? rows[0] ?? null;

  /* Counts come from the unfiltered set, so a filter that finds nothing still
     shows how many exist elsewhere rather than reading as an empty product. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of records) map.set(record.state, (map.get(record.state) ?? 0) + 1);
    return map;
  }, [records]);

  return (
    <PanelGrid label="Activity">
      <Panel
        id="stellar-activity-list"
        title="Prepared actions"
        w={12}
        h={6}
        essential
        scroll
        badge={ready ? `${records.length} kept` : "Reading"}
        tone={records.length > 0 ? "evidence" : "muted"}
        headerExtra={
          <InfoControl label="About this list">
            <p>
              Newest first. A record is created the moment an intent is checked and updated in place through the
              lifecycle, so one payment is one row rather than eight. A finished record is never rewritten into
              something in flight — once it has reconciled, failed or been blocked, a late update is dropped.
            </p>
            <p>
              The signed transaction is deliberately not kept. Storing an envelope that can still reach the network,
              in a browser, long after somebody stopped thinking about it, is a risk that buys nothing: the transaction
              hash is the durable handle and anyone can re-read the ledger from it.
            </p>
            <p>The newest {ACTIVITY_LIMIT} are kept. Older records leave oldest-first.</p>
          </InfoControl>
        }
        footer={
          <span>
            {retained
              ? `Kept in this browser only, newest ${ACTIVITY_LIMIT}.`
              : "This browser will not keep anything — storage is unavailable here."}
          </span>
        }
      >
        <div className="st-filters" role="group" aria-label="Filter by state">
          {FILTERS.map((entry) => {
            const count = entry.id === "ALL" ? records.length : (counts.get(entry.id) ?? 0);
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
                disabled={entry.id !== "ALL" && count === 0}
              >
                {entry.label}
                <span className="st-filter-n">{count}</span>
              </button>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={records.length === 0 ? "Nothing has been prepared yet" : "Nothing in this state"}
            action={
              <Link className="rw-btn" href="/stellar/workspace/send">
                Prepare a testnet payment
              </Link>
            }
          >
            {records.length === 0
              ? "A record appears the moment an intent is checked against the network — including one the preflight refuses, because a payment that was stopped before a signature is the most useful row on this page."
              : "Other records exist in other states. Clear the filter to see them."}
          </EmptyState>
        ) : (
          <div className="rw-tablewrap">
            <table className="rw-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Operation</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">State</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => (
                  <tr key={record.id} data-active={record.id === selected?.id ? "true" : "false"}>
                    <th scope="row">
                      <button className="st-row-open" type="button" onClick={() => setSelectedId(record.id)}>
                        <span translate="no">{stamp(record.updatedAt)}</span>
                      </button>
                    </th>
                    <td>Payment</td>
                    <td>
                      <span translate="no">
                        {record.amount} {record.assetCode}
                      </span>
                    </td>
                    <td>{record.memo ?? <span className="st-note">None</span>}</td>
                    <td>
                      <span className="sh-state" data-state={stateTone(record.state) === "verified" ? "FRESH" : ""}>
                        {ACTIVITY_COPY[record.state].label}
                      </span>
                    </td>
                    <td>
                      {record.transactionHash ? (
                        <a
                          className="st-domain"
                          href={transactionExplorerUrl(STELLAR_TESTNET, record.transactionHash)}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <span translate="no">{record.transactionHash.slice(0, 8)}</span>
                        </a>
                      ) : (
                        <span className="st-note">Not submitted</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        id="stellar-activity-detail"
        title={selected ? `${selected.amount} ${selected.assetCode}` : "Record"}
        w={12}
        h={6}
        scroll
        badge={selected ? ACTIVITY_COPY[selected.state].label : "None selected"}
        tone={selected ? stateTone(selected.state) : "muted"}
        footer={
          selected?.transactionHash ? (
            <Link className="rw-btn" href="/stellar/workspace/receipts">
              Verify this against the ledger
            </Link>
          ) : (
            <span>Everything a record holds is either something you typed, authorized, or the ledger published.</span>
          )
        }
      >
        {selected === null ? (
          <EmptyState title="No record selected">
            Prepare a payment, or pick a row above. The detail is the important half, so it has its own standing room
            rather than a drawer.
          </EmptyState>
        ) : (
          <>
            <KeyValue label="What it means">{ACTIVITY_COPY[selected.state].meaning}</KeyValue>
            <div className="rw-hair" />
            <KeyValue label="Intent">
              <span translate="no">
                {selected.amount} {selected.assetCode}
              </span>{" "}
              to{" "}
              <span translate="no">
                {selected.destination.slice(0, 8)}…{selected.destination.slice(-6)}
              </span>{" "}
              on {selected.network}
            </KeyValue>
            <KeyValue label="Purpose">{selected.memo ?? "None recorded."}</KeyValue>
            <KeyValue label="From">
              {selected.source ? (
                <span translate="no">
                  {selected.source.slice(0, 8)}…{selected.source.slice(-6)}
                </span>
              ) : (
                "No wallet was connected."
              )}
            </KeyValue>
            <KeyValue label="Authorization">
              {selected.authorizationHash ? (
                <>
                  <span translate="no">{selected.authorizationHash.slice(0, 16)}</span> at{" "}
                  <span translate="no">{selected.authorizedAt ? stamp(selected.authorizedAt) : "unknown"}</span>
                </>
              ) : (
                "Not authorized. Nothing was signed."
              )}
            </KeyValue>
            <KeyValue label="Signed transaction">
              Not kept, deliberately. The hash below is the durable handle; the envelope is not stored anywhere.
            </KeyValue>
            <KeyValue label="Transaction">
              {selected.transactionHash ? (
                <a
                  href={transactionExplorerUrl(STELLAR_TESTNET, selected.transactionHash)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span translate="no">{selected.transactionHash}</span>
                </a>
              ) : (
                "Never submitted."
              )}
            </KeyValue>
            <KeyValue label="Ledger">
              {selected.ledger === null ? (
                "Not observed in a closed ledger."
              ) : (
                <span translate="no">{selected.ledger.toLocaleString("en-US")}</span>
              )}
            </KeyValue>
            <KeyValue label="Network result">{selected.resultCode ?? "None recorded."}</KeyValue>
            <KeyValue label="Expected against actual">
              {selected.reconciliation ?? "Not compared. A transaction that succeeded is not evidence that what was authorized is what happened."}
            </KeyValue>
            <KeyValue label="Policy">
              None. Policy evaluation is registered and not built, so every receipt carries a null policy version with
              its reason rather than an implied pass.
            </KeyValue>
            <KeyValue label="Receipt">{selected.receiptHash ?? "No receipt was finalized for this record."}</KeyValue>
            {selected.reason ? <KeyValue label="Why it stopped">{selected.reason}</KeyValue> : null}
            {selected.recovery ? <KeyValue label="Recovery">{selected.recovery}</KeyValue> : null}
          </>
        )}
      </Panel>

      <Panel
        id="stellar-activity-retention"
        title="Retention"
        w={12}
        h={4}
        scroll
        badge={retained ? "This browser" : "Unavailable"}
        tone={retained ? "muted" : "caution"}
        footer={<span>No account, no session, no server-side record of your use of this workspace.</span>}
      >
        <KeyValue label="Where">
          This browser&rsquo;s local storage, under one key, scoped to this workspace. Not a Ryntra server, not an
          account, not a synced profile.
        </KeyValue>
        <KeyValue label="How much">
          The newest {ACTIVITY_LIMIT} actions. Older ones leave oldest-first rather than growing without a bound.
        </KeyValue>
        <KeyValue label="What is never stored">
          A key, a seed phrase, or a signed transaction envelope. Ryntra has never held the first two and deliberately
          does not keep the third.
        </KeyValue>
        <KeyValue label="What clearing costs">
          The list, and nothing else. A receipt you downloaded is a file you hold, and the ledger is public — both
          outlive this browser.
        </KeyValue>
        <div className="rw-hair" />
        <button className="rw-btn" type="button" onClick={clear} disabled={records.length === 0}>
          Delete every record in this browser
        </button>
      </Panel>
    </PanelGrid>
  );
}
