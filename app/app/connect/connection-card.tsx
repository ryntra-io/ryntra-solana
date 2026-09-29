import { Eye, ProhibitInset } from "@phosphor-icons/react";

import { StatusChip } from "@/app/shell/status-chip";
import type { HomeConnectionRecord } from "@/lib/home/connections";

import type { ConnectionCenterCopy } from "./copy";
import styles from "./connection-center.module.css";

function shortAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function ConnectionCard({
  record,
  copy,
  onRevoke,
}: {
  record: HomeConnectionRecord;
  copy: ConnectionCenterCopy["watch"];
  onRevoke?: (id: string) => void;
}) {
  const active = record.state === "ACTIVE";
  return (
    <article className={styles.connectionRecord} data-state={record.state}>
      <div className={styles.recordHeader}>
        <div>
          <p className={styles.recordLabel}>{record.label}</p>
          <p className={styles.address} title={record.address}>{shortAddress(record.address)}</p>
        </div>
        <StatusChip family="descriptor">{active ? copy.active : copy.revoked}</StatusChip>
      </div>

      <dl className={styles.recordFacts}>
        <div>
          <dt>{copy.network}</dt>
          <dd>{copy.networkLabels[record.network]}</dd>
        </div>
        <div>
          <dt>{copy.ownership}</dt>
          <dd>{record.ownership}</dd>
        </div>
        <div>
          <dt>{copy.authority}</dt>
          <dd>{record.authority}</dd>
        </div>
        <div>
          <dt>{copy.storage}</dt>
          <dd>{record.storage}</dd>
        </div>
      </dl>

      <ul className={styles.scopeList} aria-label={copy.scopes}>
        {record.scopes.map((scope) => (
          <li key={scope}>
            <Eye size={15} weight="bold" aria-hidden />
            {copy.scopeLabels[scope]}
          </li>
        ))}
      </ul>

      {active && onRevoke ? (
        <button
          type="button"
          className={`${styles.recordAction} btn btn-ghost btn-sm`}
          onClick={() => onRevoke(record.id)}
        >
          <ProhibitInset size={16} weight="bold" aria-hidden />
          {copy.remove}
        </button>
      ) : null}
    </article>
  );
}
