"use client";

import { Block, Button, EmptyState, Page, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { TeamMemberChangeResponse, TeamResponse, TeamsResponse } from "@/lib/api/v1/contract";
import type { TeamGrant, TeamKind, TeamPermission, TeamRole } from "@/lib/core/team/roles";

import { lang, short } from "../treasury-flow";
import styles from "../treasury.module.css";
import { GRANT_WORDS, JOURNAL_WORDS, KIND_WORDS, PERMISSION_WORDS, ROLE_WORDS, teamWords } from "./team-words";

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Team = TeamResponse["team"];
type Summary = TeamsResponse["teams"][number];
type Member = NonNullable<Team["members"]>[number];
type Answer<T> = Readonly<{ ok: true; body: T }> | Readonly<{ ok: false; status: number; why: string }>;

async function call<T>(path: string, init: RequestInit = {}): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { ...init, headers: HEADERS, cache: "no-store" });
    const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!response.ok || !body) return { ok: false, status: response.status, why: body?.error?.message ?? String(response.status) };
    return { ok: true, body };
  } catch {
    return { ok: false, status: 0, why: "network" };
  }
}

/**
 * «Команда» (TEAM-1): the wallet's teams, one team's members with their roles, the wallet's own rights and the
 * treasury. Every button here is a request the server checks again; the page offers only what the stored role allows
 * (`gives`, the same rule the server keeps), so a refusal is the server's, said in one line.
 */
export function TeamSurface({
  locale,
  network,
  kinds,
  gives,
}: {
  locale: WorkspaceLocale;
  network: "solana:mainnet" | "solana:devnet";
  kinds: readonly TeamKind[];
  gives: Readonly<Record<string, readonly TeamRole[]>>;
}) {
  const word = teamWords(locale);
  const say = (pair: Readonly<{ en: string; uk: string }>) => pair[locale];
  const { connection } = useSolanaConnection();
  const wallet = connection?.address ?? null;
  const proof = useWalletProof();
  const [list, setList] = useState<readonly Summary[] | "unproven" | "unread" | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [mode, setMode] = useState<"home" | "create">("home");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const read = await call<TeamsResponse>("/api/v1/teams");
    if (read.ok) setList(read.body.teams);
    else setList(read.status === 401 ? "unproven" : "unread");
  }, []);

  useEffect(() => {
    setTeam(null);
    setList(null);
    if (wallet) void loadList();
  }, [wallet, loadList]);

  const openTeam = useCallback(async (id: string) => {
    setFailure(null);
    const read = await call<TeamResponse>(`/api/v1/teams/${id}`);
    if (read.ok) setTeam(read.body.team);
    else setFailure(word("failed", { why: read.why }));
  }, [word]);

  /** A change: the wallet's own signature first (a mutation never rides a link), then the request the server checks. */
  const act = async <T,>(path: string, body: unknown, done: (value: T) => void) => {
    setBusy(true);
    setFailure(null);
    const proven = await proof.act().catch(() => false);
    if (!proven) {
      setBusy(false);
      setFailure(word("proveLine"));
      return;
    }
    const answer = await call<T>(path, { method: "POST", body: JSON.stringify(body) });
    if (answer.ok) done(answer.body);
    else setFailure(word("failed", { why: answer.why }));
    setBusy(false);
  };

  const changed = (body: TeamMemberChangeResponse) => {
    setTeam(body.team);
    void loadList();
  };

  if (!wallet) {
    return (
      <Page kind="action" className={styles.page} title={word("title")} help={word("help")} lang={lang(locale)}>
        <EmptyState icon="wallet" text={word("connectLine")} action={<ConnectWalletButton />} />
      </Page>
    );
  }

  return (
    <Page kind="action" className={styles.page} title={word("title")} help={word("help")} lang={lang(locale)}>
      {failure ? (
        <p className={styles.hint} role="alert">
          {failure}
        </p>
      ) : null}
      {list === "unproven" ? (
        <EmptyState
          icon="wallet"
          text={word("proveLine")}
          action={
            <Button variant="primary" onClick={() =>
                void proof.act().then((ok) => {
                  if (ok) void loadList();
                })
              } lang={lang(locale)}>
              {word("prove")}
            </Button>
          }
        />
      ) : list === "unread" ? (
        <p className={styles.hint}>{word("unavailable")}</p>
      ) : team ? (
        <TeamView
          team={team}
          wallet={wallet}
          locale={locale}
          network={network}
          gives={gives[team.you.role] ?? []}
          busy={busy}
          onBack={() => setTeam(null)}
          onInvite={(body) => void act<TeamResponse>(`/api/v1/teams/${team.id}/members`, body, (value) => setTeam(value.team))}
          onChange={(member, body) => void act<TeamMemberChangeResponse>(`/api/v1/teams/${team.id}/members/${member}`, body, changed)}
          onTreasury={(multisig) => void act<TeamResponse>(`/api/v1/teams/${team.id}/treasury`, { multisig }, (value) => setTeam(value.team))}
        />
      ) : mode === "create" ? (
        <Block title={word("createTitle")} icon="landmark" lang={lang(locale)}>
          <CreateForm
            locale={locale}
            kinds={kinds}
            busy={busy}
            onCancel={() => setMode("home")}
            onSubmit={(body) =>
              void act<TeamResponse>("/api/v1/teams", body, (value) => {
                setMode("home");
                setTeam(value.team);
                void loadList();
              })
            }
          />
        </Block>
      ) : (
        <>
          <div className={styles.startRow}>
            <Button variant="primary" icon="plus" onClick={() => setMode("create")} lang={lang(locale)}>
              {word("create")}
            </Button>
          </div>
          <Block title={word("mine")} icon="landmark" lang={lang(locale)}>
            <Table<Summary>
              columns={[
                { key: "name", label: word("name"), render: (row) => row.name },
                { key: "role", label: word("role"), render: (row) => say(ROLE_WORDS[row.role]) },
                { key: "status", label: word("status"), render: (row) => (row.status === "ACTIVE" ? word("active") : word("invited")) },
                {
                  key: "actions",
                  label: word("actions"),
                  render: (row) =>
                    row.status === "ACTIVE" ? (
                      <Button variant="ghost" onClick={() => void openTeam(row.id)} lang={lang(locale)}>
                        {word("open")}
                      </Button>
                    ) : (
                      <span className={styles.rowActions}>
                        <Button variant="ghost" disabled={busy} onClick={() => void act<TeamMemberChangeResponse>(`/api/v1/teams/${row.id}/members/${wallet}`, { action: "accept" }, changed)} lang={lang(locale)}>
                          {word("accept")}
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => void act<TeamMemberChangeResponse>(`/api/v1/teams/${row.id}/members/${wallet}`, { action: "remove" }, changed)} lang={lang(locale)}>
                          {word("decline")}
                        </Button>
                      </span>
                    ),
                },
              ]}
              rows={Array.isArray(list) ? [...list] : []}
              rowKey={(row) => row.id}
              caption={word("mine")}
              empty={list === null ? "…" : word("mineEmpty")}
            />
          </Block>
        </>
      )}
    </Page>
  );
}

function CreateForm({ locale, kinds, busy, onSubmit, onCancel }: { locale: WorkspaceLocale; kinds: readonly TeamKind[]; busy: boolean; onSubmit: (body: { name: string; kind: TeamKind }) => void; onCancel: () => void }) {
  const word = teamWords(locale);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TeamKind>("PROJECT_TEAM");
  const ok = name.trim().length > 0 && name.trim().length <= 64;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) onSubmit({ name: name.trim(), kind });
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>{word("name")}</span>
        <input className={styles.input} value={name} maxLength={64} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{word("kind")}</span>
        <select className={styles.input} value={kind} onChange={(event) => setKind(event.target.value as TeamKind)}>
          {kinds.map((entry) => (
            <option key={entry} value={entry}>
              {KIND_WORDS[entry][locale]}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.formActions}>
        <Button variant="ghost" type="button" onClick={onCancel} lang={lang(locale)}>
          {word("cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={!ok || busy} lang={lang(locale)}>
          {word("create")}
        </Button>
      </div>
    </form>
  );
}

function TeamView({
  team,
  wallet,
  locale,
  network,
  gives,
  busy,
  onBack,
  onInvite,
  onChange,
  onTreasury,
}: {
  team: Team;
  wallet: string;
  locale: WorkspaceLocale;
  network: "solana:mainnet" | "solana:devnet";
  gives: readonly TeamRole[];
  busy: boolean;
  onBack: () => void;
  onInvite: (body: { wallet: string; role: TeamRole; label: string | null }) => void;
  onChange: (member: string, body: { action: "role"; role: TeamRole } | { action: "remove" }) => void;
  onTreasury: (multisig: string) => void;
}) {
  const word = teamWords(locale);
  const say = (pair: Readonly<{ en: string; uk: string }>) => pair[locale];
  const canKeep = team.you.grants.members === "ALLOW";
  const owner = team.you.role === "OWNER";
  const lastOwner = owner && (team.members ?? []).filter((row) => row.role === "OWNER" && row.status === "ACTIVE").length <= 1;
  const [invitee, setInvitee] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>(gives.find((role) => role !== "OWNER") ?? "VIEWER");
  const [label, setLabel] = useState("");
  const [multisig, setMultisig] = useState("");

  const columns: TableColumn<Member>[] = [
    {
      key: "wallet",
      label: word("wallet"),
      render: (row) => (
        <span className={styles.mono}>
          {row.label ? `${row.label} · ` : ""}
          {short(row.wallet)}
          {row.wallet === wallet ? ` (${word("you")})` : ""}
        </span>
      ),
    },
    {
      key: "role",
      label: word("role"),
      render: (row) =>
        canKeep && row.wallet !== wallet && gives.includes(row.role) ? (
          <select className={styles.input} aria-label={word("role")} value={row.role} disabled={busy} onChange={(event) => onChange(row.wallet, { action: "role", role: event.target.value as TeamRole })}>
            {gives.map((role) => (
              <option key={role} value={role}>
                {say(ROLE_WORDS[role])}
              </option>
            ))}
          </select>
        ) : (
          say(ROLE_WORDS[row.role])
        ),
    },
    { key: "status", label: word("status"), render: (row) => (row.status === "ACTIVE" ? word("active") : word("invited")) },
    {
      key: "actions",
      label: word("actions"),
      render: (row) =>
        row.wallet === wallet ? (
          /* The last active Owner stays until ownership has passed: the server refuses, so nothing is offered. */
          lastOwner ? null : (
            <Button variant="ghost" disabled={busy} onClick={() => onChange(row.wallet, { action: "remove" })} lang={lang(locale)}>
              {word("leave")}
            </Button>
          )
        ) : canKeep && gives.includes(row.role) ? (
          <Button variant="ghost" disabled={busy} onClick={() => onChange(row.wallet, { action: "remove" })} lang={lang(locale)}>
            {word("remove")}
          </Button>
        ) : null,
    },
  ];

  const rights = (Object.keys(team.you.grants) as TeamPermission[]).map((permission) => ({ permission, grant: team.you.grants[permission] }));

  return (
    <div className={styles.surface}>
      <div className={styles.backRow}>
        <button type="button" className={styles.linkButton} onClick={onBack}>
          ← {word("back")}
        </button>
        <span>
          {team.name} · {say(KIND_WORDS[team.kind])} · {say(ROLE_WORDS[team.you.role])}
        </span>
      </div>

      <Block title={word("members")} icon="landmark" lang={lang(locale)}>
        <Table columns={columns} rows={[...(team.members ?? [])]} rowKey={(row) => row.wallet} caption={word("members")} empty="—" />
        {canKeep ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (BASE58.test(invitee.trim())) onInvite({ wallet: invitee.trim(), role: inviteRole, label: label.trim() || null });
            }}
          >
            <p className={styles.formTitle}>{word("inviteTitle")}</p>
            <label className={styles.field}>
              <span className={styles.label}>{word("wallet")}</span>
              <input className={`${styles.input} ${styles.mono}`} value={invitee} onChange={(event) => setInvitee(event.target.value)} spellCheck={false} autoComplete="off" />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{word("role")}</span>
              <select className={styles.input} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as TeamRole)}>
                {gives.map((role) => (
                  <option key={role} value={role}>
                    {say(ROLE_WORDS[role])}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{word("label")}</span>
              <input className={styles.input} value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} autoComplete="off" />
            </label>
            <p className={styles.hint}>{word("inviteHint")}</p>
            <div className={styles.formActions}>
              <Button variant="primary" type="submit" disabled={busy || !BASE58.test(invitee.trim())} lang={lang(locale)}>
                {word("invite")}
              </Button>
            </div>
          </form>
        ) : null}
      </Block>

      <Block title={word("yourRights")} icon="circle-check" lang={lang(locale)}>
        <Table<{ permission: TeamPermission; grant: TeamGrant }>
          columns={[
            { key: "permission", label: word("right"), render: (row) => say(PERMISSION_WORDS[row.permission]) },
            { key: "grant", label: say(ROLE_WORDS[team.you.role]), render: (row) => say(GRANT_WORDS[row.grant]) },
          ]}
          rows={rights}
          rowKey={(row) => row.permission}
          caption={word("yourRights")}
          empty="—"
        />
      </Block>

      <Block title={word("treasury")} icon="landmark" lang={lang(locale)}>
        {team.treasury ? (
          <div className={styles.rowActions}>
            <Link className={`${styles.linkButton} ${styles.mono}`} href={`/app/treasury?multisig=${team.treasury}`}>
              {word("treasuryOpen")} · {short(team.treasury)}
            </Link>
            <span className={styles.hint}>{word("treasuryFixed")}</span>
          </div>
        ) : (
          <p className={styles.hint}>{word("treasuryNone")}</p>
        )}
        {owner && !team.treasury ? (
          <form
            className={styles.openRow}
            onSubmit={(event) => {
              event.preventDefault();
              if (BASE58.test(multisig.trim())) onTreasury(multisig.trim());
            }}
          >
            <input className={`${styles.input} ${styles.mono}`} aria-label={word("treasuryPlaceholder")} placeholder={word("treasuryPlaceholder")} value={multisig} onChange={(event) => setMultisig(event.target.value)} spellCheck={false} autoComplete="off" />
            <Button variant="secondary" type="submit" disabled={busy || !BASE58.test(multisig.trim())} lang={lang(locale)}>
              {word("treasuryLink")}
            </Button>
          </form>
        ) : null}
        {team.signers?.read === "UNREAD" ? <p className={styles.hint}>{word("signersUnread")}</p> : null}
        {team.signers?.read === "OK" ? (
          <ul className={styles.hint} aria-label={word("signers")}>
            {team.signers.rows.map((row) => (
              <li key={row.address} className={styles.mono}>
                {short(row.address)} — {row.inTeam && row.role ? say(ROLE_WORDS[row.role]) : word("signerOutside")}
              </li>
            ))}
          </ul>
        ) : null}
        {network === "solana:devnet" ? <p className={styles.hint}>{word("devnet")}</p> : null}
      </Block>

      {team.journal ? (
        <Block title={word("journal")} icon="receipt" lang={lang(locale)}>
          {team.journal.length === 0 ? (
            <p className={styles.hint}>{word("journalEmpty")}</p>
          ) : (
            <ul className={styles.hint}>
              {team.journal.map((row, index) => (
                <li key={`${row.at}-${index}`}>
                  {new Date(row.at).toLocaleString(lang(locale))} · {say(JOURNAL_WORDS[row.action])}
                  {row.subject ? <span className={styles.mono}> · {short(row.subject)}</span> : null}
                  {row.role ? ` · ${say(ROLE_WORDS[row.role])}` : ""}
                  {" · "}
                  <span className={styles.mono}>{short(row.actor)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      ) : null}
    </div>
  );
}
