"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  Database,
  Fingerprint,
  Key,
  Plus,
  ShieldCheck,
  Wallet,
} from "@phosphor-icons/react";

import { StatusChip } from "@/app/shell/status-chip";
import type { CbCopy } from "../copy";
import {
  HOME_CONNECTION_NETWORKS,
  HOME_READ_SCOPES,
  addWatchConnection,
  revokeConnection,
  type HomeConnectionNetwork,
  type HomeReadScope,
} from "@/lib/home/connections";
import {
  HOME_LOCAL_EVENT,
  emptyHomeLocalEnvelope,
  encodeHomeLocalEnvelope,
  parseHomeLocalEnvelope,
  projectFinancialTwin,
  type HomeLocalEnvelope,
} from "@/lib/home/financial-twin";

import { ConnectFlow } from "./connect-flow";
import { ConnectionCard } from "./connection-card";
import type { ConnectionCenterCopy } from "./copy";
import { InvestorContextForm } from "./investor-context-form";
import styles from "./connection-center.module.css";

type StorageState = "LOADING" | "READY" | "DEGRADED" | "UNAVAILABLE";
type VenueState = "ACTIVE" | "NONE";

type WatchDraftState = Readonly<{
  network: HomeConnectionNetwork;
  address: string;
  label: string;
  scopes: readonly HomeReadScope[];
}>;

const EMPTY_DRAFT: WatchDraftState = {
  network: "EVM",
  address: "",
  label: "",
  scopes: ["BALANCES"],
};

export function ConnectionCenter({
  ownerRef,
  subjectKind,
  initialIdentityWallet,
  telegramVerified,
  legacyWatchAddress,
  canManageVenue,
  copy,
  arcusCopy,
}: {
  ownerRef: string;
  subjectKind: "TELEGRAM" | "WALLET" | "ACCOUNT";
  initialIdentityWallet: string | null;
  telegramVerified: boolean;
  legacyWatchAddress: string | null;
  canManageVenue: boolean;
  copy: ConnectionCenterCopy;
  arcusCopy: CbCopy["connect"];
}) {
  const storageKey = useMemo(() => `ryntra.home.v1.${ownerRef}`, [ownerRef]);
  const [storageState, setStorageState] = useState<StorageState>("LOADING");
  const [envelope, setEnvelope] = useState<HomeLocalEnvelope | null>(null);
  const identityWallet = initialIdentityWallet;
  const [venueState, setVenueState] = useState<VenueState>("NONE");
  const [watchDraft, setWatchDraft] = useState<WatchDraftState>(EMPTY_DRAFT);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === null) {
        setEnvelope(emptyHomeLocalEnvelope(ownerRef, new Date().toISOString()));
        setStorageState("READY");
        return;
      }
      const parsed = parseHomeLocalEnvelope(stored, ownerRef);
      if (!parsed.ok) {
        setEnvelope(null);
        setStorageState("DEGRADED");
        return;
      }
      setEnvelope(parsed.envelope);
      setStorageState("READY");
    } catch {
      setEnvelope(null);
      setStorageState("UNAVAILABLE");
    }
  }, [ownerRef, storageKey]);

  const commitEnvelope = useCallback((next: HomeLocalEnvelope) => {
    try {
      localStorage.setItem(storageKey, encodeHomeLocalEnvelope(next));
      setEnvelope(next);
      setStorageState("READY");
      window.dispatchEvent(new CustomEvent(HOME_LOCAL_EVENT, { detail: { ownerRef } }));
      return true;
    } catch {
      setStorageState("UNAVAILABLE");
      return false;
    }
  }, [ownerRef, storageKey]);

  const onCredentialStateChange = useCallback((state: VenueState) => setVenueState(state), []);

  const twin = envelope
    ? projectFinancialTwin({
        identity: {
          authenticated: true,
          subjectKind,
          identityWallet,
          telegramVerified,
        },
        envelope,
        venueCredentials: venueState === "ACTIVE"
          ? [{ provider: "ARCUS", state: "ACTIVE", scopes: ["SPOT_REQUEST_SIGNING"] }]
          : [],
      })
    : null;

  const records = envelope
    ? [...envelope.connections.records].sort((a, b) => {
        if (a.state !== b.state) return a.state === "ACTIVE" ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      })
    : [];
  const activeRecords = records.filter((record) => record.state === "ACTIVE");
  const revokedRecords = records.filter((record) => record.state === "REVOKED");
  const legacyImported = Boolean(
    legacyWatchAddress &&
    activeRecords.some(
      (record) => record.network === "EVM" && record.address === legacyWatchAddress.toLowerCase(),
    ),
  );

  function updateEnvelope(next: Partial<Pick<HomeLocalEnvelope, "connections" | "investorContexts">>) {
    if (!envelope) return false;
    return commitEnvelope({ ...envelope, ...next, updatedAt: new Date().toISOString() });
  }

  function addConnection(draft = watchDraft) {
    if (!envelope) return false;
    const result = addWatchConnection(envelope.connections, draft, {
      id: `conn_${crypto.randomUUID()}`,
      now: new Date().toISOString(),
    });
    if (!result.ok) {
      setConnectionNotice(copy.watch.errors[result.error] ?? copy.watch.errors.INVALID_DRAFT);
      return false;
    }
    if (updateEnvelope({ connections: result.state })) {
      setConnectionNotice(null);
      setWatchDraft(EMPTY_DRAFT);
      return true;
    }
    return false;
  }

  function importLegacy() {
    if (!legacyWatchAddress) return;
    const imported = addConnection({
      network: "EVM",
      address: legacyWatchAddress,
      label: copy.wallets.legacyWatch,
      scopes: ["BALANCES", "POSITIONS", "ACTIVITY"],
    });
    if (imported) setConnectionNotice(copy.wallets.imported);
  }

  function revoke(id: string) {
    if (!envelope) return;
    const result = revokeConnection(envelope.connections, id, new Date().toISOString());
    if (!result.ok) {
      setConnectionNotice(copy.watch.errors[result.error] ?? copy.watch.errors.CONNECTION_NOT_FOUND);
      return;
    }
    if (updateEnvelope({ connections: result.state })) setConnectionNotice(copy.watch.removed);
  }

  function resetLocal() {
    try {
      localStorage.removeItem(storageKey);
      const next = emptyHomeLocalEnvelope(ownerRef, new Date().toISOString());
      setEnvelope(next);
      setStorageState("READY");
      setStorageNotice(copy.storage.resetDone);
      window.dispatchEvent(new CustomEvent(HOME_LOCAL_EVENT, { detail: { ownerRef } }));
    } catch {
      setStorageState("UNAVAILABLE");
    }
  }

  function toggleScope(scope: HomeReadScope) {
    const selected = watchDraft.scopes.includes(scope);
    setWatchDraft((previous) => ({
      ...previous,
      scopes: selected
        ? previous.scopes.filter((item) => item !== scope)
        : [...previous.scopes, scope],
    }));
  }

  return (
    <div className={styles.root}>
      <header className={styles.hero}>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
        <span>{copy.localOnly}</span>
      </header>

      <dl className={styles.trustMap} aria-label={copy.title}>
        <div data-plane="IDENTITY">
          <Fingerprint size={22} weight="duotone" aria-hidden />
          <dt>{copy.planes.identity.title}</dt>
          <dd>{copy.planes.identity.body}</dd>
        </div>
        <div data-plane="READ_ONLY_DATA">
          <Database size={22} weight="duotone" aria-hidden />
          <dt>{copy.planes.data.title}</dt>
          <dd>{copy.planes.data.body}</dd>
        </div>
        <div data-plane="EXACT_ACTION_AUTHORITY">
          <ShieldCheck size={22} weight="duotone" aria-hidden />
          <dt>{copy.planes.authority.title}</dt>
          <dd>{copy.planes.authority.body}</dd>
        </div>
      </dl>

      {storageState === "LOADING" ? <p className={styles.stateMessage} role="status">{copy.storage.loading}</p> : null}
      {storageState === "DEGRADED" ? (
        <section className={styles.recovery} role="alert">
          <div><strong>{copy.storage.degradedTitle}</strong><p>{copy.storage.degradedBody}</p></div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetLocal}>
            <ArrowCounterClockwise size={16} weight="bold" aria-hidden />{copy.storage.reset}
          </button>
        </section>
      ) : null}
      {storageState === "UNAVAILABLE" ? (
        <section className={styles.recovery} role="alert">
          <div><strong>{copy.storage.unavailableTitle}</strong><p>{copy.storage.unavailableBody}</p></div>
        </section>
      ) : null}
      {storageNotice ? <p className={styles.stateMessage} role="status">{storageNotice}</p> : null}

      <section className={styles.panel} id="wallets" aria-labelledby="wallets-title">
        <div className={styles.panelHeading}>
          <Wallet size={22} weight="duotone" aria-hidden />
          <div><h2 id="wallets-title">{copy.wallets.title}</h2><p>{copy.wallets.body}</p></div>
        </div>
        <dl className={styles.identityFacts}>
          <div><dt>{copy.wallets.session}</dt><dd>{subjectKind === "WALLET" ? copy.wallets.walletSession : copy.wallets.telegramSession}</dd></div>
          <div><dt>Telegram</dt><dd>{telegramVerified ? copy.wallets.telegramVerified : copy.wallets.telegramUnverified}</dd></div>
          <div><dt>{copy.wallets.identityWallet}</dt><dd className={identityWallet ? styles.mono : undefined}>{identityWallet ?? copy.wallets.noIdentityWallet}</dd></div>
        </dl>
        {!identityWallet && telegramVerified ? (
          <div className={styles.walletLink}>
            {/* The Solana wallet is linked in the account settings (SOL-W1: no Ethereum sign-in on Solana pages). */}
            <Link className="btn btn-primary btn-sm" href="/app/settings#account">{copy.wallets.linkWallet}</Link>
          </div>
        ) : null}
        {legacyWatchAddress ? (
          <div className={styles.legacyWatch}>
            <div>
              <strong>{copy.wallets.legacyWatch}</strong>
              <span className={styles.mono}>{legacyWatchAddress}</span>
              <p>{copy.wallets.legacyBody}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={legacyImported || storageState !== "READY"}
              onClick={importLegacy}
            >
              {legacyImported ? copy.wallets.imported : copy.wallets.importLegacy}
            </button>
          </div>
        ) : null}
      </section>

      <section className={styles.panel} id="venues" aria-labelledby="venues-title">
        <div className={styles.panelHeading}>
          <Key size={22} weight="duotone" aria-hidden />
          <div><h2 id="venues-title">{copy.venues.title}</h2><p>{copy.venues.body}</p></div>
        </div>
        <div className={styles.venueBoundary}>
          <div><strong>{copy.venues.provider}</strong><span>{copy.venues.credentialScope}</span></div>
          <StatusChip family="descriptor">{twin?.authority.state ?? "EXACT_ACTION_ONLY"}</StatusChip>
          <p>{copy.venues.authority}</p>
        </div>
        {canManageVenue ? (
          <div className={styles.venueFlow}>
            <ConnectFlow
              c={arcusCopy}
              initialAddress={identityWallet}
              onCredentialStateChange={onCredentialStateChange}
            />
          </div>
        ) : (
          <div className={styles.lockedState}>
            <strong>{copy.venues.lockedTitle}</strong>
            <p>{copy.venues.lockedBody}</p>
          </div>
        )}
      </section>

      <section className={styles.panel} id="watch-only" aria-labelledby="watch-title">
        <div className={styles.panelHeading}>
          <Database size={22} weight="duotone" aria-hidden />
          <div><h2 id="watch-title">{copy.watch.title}</h2><p>{copy.watch.body}</p></div>
        </div>
        <form
          className={styles.watchForm}
          onSubmit={(event) => {
            event.preventDefault();
            addConnection();
          }}
        >
          <h3>{copy.watch.addTitle}</h3>
          <label><span>{copy.watch.label}</span><input maxLength={64} value={watchDraft.label} placeholder={copy.watch.labelPlaceholder} onChange={(event) => setWatchDraft((previous) => ({ ...previous, label: event.target.value }))} /></label>
          <label><span>{copy.watch.network}</span><select value={watchDraft.network} onChange={(event) => setWatchDraft((previous) => ({ ...previous, network: event.target.value as HomeConnectionNetwork }))}>{HOME_CONNECTION_NETWORKS.map((network) => <option key={network} value={network}>{copy.watch.networkLabels[network]}</option>)}</select></label>
          <label className={styles.addressField}><span>{copy.watch.address}</span><input value={watchDraft.address} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setWatchDraft((previous) => ({ ...previous, address: event.target.value }))} /></label>
          <fieldset className={styles.scopeChooser}><legend>{copy.watch.scopes}</legend>{HOME_READ_SCOPES.map((scope) => <label key={scope}><input type="checkbox" checked={watchDraft.scopes.includes(scope)} onChange={() => toggleScope(scope)} /><span>{copy.watch.scopeLabels[scope]}</span></label>)}</fieldset>
          <button type="submit" className="btn btn-primary btn-sm" disabled={storageState !== "READY"}>
            <Plus size={16} weight="bold" aria-hidden />{copy.watch.add}
          </button>
        </form>
        {connectionNotice ? <p className={styles.formNotice} role="status">{connectionNotice}</p> : null}
        {activeRecords.length ? <div className={styles.connectionList}>{activeRecords.map((record) => <ConnectionCard key={record.id} record={record} copy={copy.watch} onRevoke={revoke} />)}</div> : <p className={styles.emptyState}>{copy.watch.empty}</p>}
        {revokedRecords.length ? <details className={styles.history}><summary>{copy.watch.history} · {revokedRecords.length}</summary><div className={styles.connectionList}>{revokedRecords.map((record) => <ConnectionCard key={record.id} record={record} copy={copy.watch} />)}</div></details> : null}
      </section>

      <section className={styles.panel} id="financial-twin" aria-labelledby="twin-title">
        <div className={styles.panelHeading}>
          <Fingerprint size={22} weight="duotone" aria-hidden />
          <div><h2 id="twin-title">{copy.twin.title}</h2><p>{copy.twin.body}</p></div>
        </div>
        {envelope && twin ? (
          <InvestorContextForm
            history={envelope.investorContexts}
            copy={copy.twin}
            onCommit={(investorContexts) => updateEnvelope({ investorContexts })}
          />
        ) : <p className={styles.emptyState}>{copy.storage.unavailableBody}</p>}
      </section>
    </div>
  );
}
