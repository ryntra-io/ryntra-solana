"use client";

import { Block, Button, HeroNumber, Table, type TableColumn } from "@ryntra/core/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { explorerAddressUrl } from "@/lib/solana/explorer";
import type { TreasuryBuildRequest, TreasuryLimit, TreasuryMember, TreasuryProposal, TreasuryState } from "@/lib/solana/treasury/contract";
import { proposalActions } from "@/lib/solana/treasury/model";

import { DepositForm, LimitForm, PayoutsForm, RulesForm, SpendForm } from "./treasury-forms";
import { changeWhat, lang, rulesText, money, networkOf, short, treasuryApi, type Chain, type TreasuryAction } from "./treasury-flow";
import { treasuryWords } from "./treasury-words";
import styles from "./treasury.module.css";

export type ViewRead = Readonly<{ address: string; state: TreasuryState | null; failed: string | null }>;

export function useTreasuryState(address: string): Readonly<{ read: ViewRead | null; reload: () => Promise<void> }> {
  const [read, setRead] = useState<ViewRead | null>(null);
  /* Each read numbered: only the latest asked may land — a late answer, for this treasury or one no longer open,
     never replaces a newer one. */
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    if (!address) return;
    const asked = ++sequence.current;
    const answer = await treasuryApi<TreasuryState>(`/api/solana/treasury/state/${address}`);
    if (asked !== sequence.current) return;
    setRead({ address, state: answer.ok ? answer.data : null, failed: answer.ok ? null : answer.code });
  }, [address]);
  useEffect(() => {
    setRead(null);
    void reload();
    /* A treasury closed: whatever it still had in flight is no longer the latest. */
    return () => {
      sequence.current += 1;
    };
  }, [reload]);
  return { read: read?.address === address ? read : null, reload };
}

function Roles({ member, locale }: { member: TreasuryMember; locale: WorkspaceLocale }) {
  const word = treasuryWords(locale);
  const roles = [member.initiate ? word("roleInitiate") : null, member.vote ? word("roleVote") : null, member.execute ? word("roleExecute") : null].filter(Boolean);
  return (
    <span className={styles.chips}>
      {roles.map((role) => (
        <span key={role} className={styles.chip}>
          {role}
        </span>
      ))}
    </span>
  );
}

function proposalWhat(proposal: TreasuryProposal, locale: WorkspaceLocale): string {
  const word = treasuryWords(locale);
  if (proposal.type === "payouts" && proposal.payouts) {
    const sum = proposal.payouts.sums.map((row) => money(row.raw, row.asset, locale)).join(" · ") || "—";
    const head = proposal.payouts.count > 0 ? word("payoutsWhat", { n: proposal.payouts.count, sum }) : word("payoutsUnread", { n: proposal.payouts.items });
    /* Part run: said in the batch's own parts (its transactions), never against the count of payouts. */
    const { done, items } = proposal.payouts;
    return done > 0 && done < items && proposal.state !== "executed" ? `${head} · ${word("payoutsDone", { done, n: items })}` : head;
  }
  if (proposal.type === "claims" && proposal.claims) {
    const { count, launches, done, items } = proposal.claims;
    const head = word("claimsWhat", { n: count, launches });
    return done > 0 && done < items && proposal.state !== "executed" ? `${head} · ${word("claimsDone", { done, n: items })}` : head;
  }
  if (proposal.type === "config" && proposal.changes) return proposal.changes.map((change) => changeWhat(change, locale)).join(" · ");
  if (proposal.type === "vault") return word("vaultWhat");
  return word("unknownWhat");
}

/**
 * One treasury: the vault's money first, then its rules and members, its proposals with the votes this wallet may
 * cast, the batch payouts and the spending limits. Every action goes through the Review above the page.
 */
export function TreasuryView({ wallet, network, locale, action, read, reload }: { wallet: string; network: Chain; locale: WorkspaceLocale; action: TreasuryAction; read: ViewRead | null; reload: () => Promise<void> }) {
  const word = treasuryWords(locale);
  const [open, setOpen] = useState<null | "rules" | "limit" | "deposit" | { spend: string }>(null);
  const [copied, setCopied] = useState(false);
  /* The page is drawn again the moment each delay ends, so «Виконати» appears without a reload. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const nowMs = Date.now();
    const next = (read?.state?.proposals ?? []).map((row) => (row.executableAt ?? 0) * 1000).filter((at) => at > nowMs).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), Math.min(next - nowMs + 1_000, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [read, tick]);
  const net = networkOf(network);
  const busy = action.phase === "prepare";
  const submit = (request: TreasuryBuildRequest) => {
    void action.prepare(request);
  };

  if (!read) return <Block title={word("reading")} loading lang={lang(locale)} />;
  if (!read.state) {
    return (
      <Block
        title={word("unread")}
        lang={lang(locale)}
        action={
          <Button variant="secondary" onClick={() => void reload()} lang={lang(locale)}>
            {word("readAgain")}
          </Button>
        }
      >
        <p className={styles.hint}>{read.failed === "TREASURY_NOT_FOUND" || read.failed === "TREASURY_NOT_SQUADS" ? word("notFound") : word("unread")}</p>
      </Block>
    );
  }
  const state = read.state;
  const me = state.members.find((member) => member.address === wallet) ?? null;
  const voters = state.members.filter((member) => member.vote).length;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const proposalRow = (row: TreasuryProposal) => {
    const voted = row.cancelled.includes(wallet) ? "cancelled" : row.approved.includes(wallet) ? "approved" : row.rejected.includes(wallet) ? "rejected" : null;
    const can = proposalActions({ state: row.state, roles: me, voted, executableAtSeconds: row.executableAt, nowSeconds, readable: row.readable });
    return (
      <li key={row.index} className={styles.item}>
        <div className={styles.itemHead}>
          <span className={styles.itemIndex}>№ {row.index}</span>
          <span className={styles.itemWhat}>{proposalWhat(row, locale)}</span>
        </div>
        <div className={styles.itemMeta}>
          <span className={styles.state} data-state={row.state}>
            {word(`state_${row.state}`)}
          </span>
          {row.executableAt !== null && row.executableAt > nowSeconds ? <span className={styles.hint}>{word("runsAt", { time: new Date(row.executableAt * 1000).toLocaleString(locale === "uk" ? "uk-UA" : "en-GB") })}</span> : null}
          <span className={styles.hint}>
            {word("votes")}: {row.approved.length}/{state.threshold}
          </span>
        </div>
        {can.length > 0 ? (
          <div className={styles.rowActions}>
            {can.map((verb) => (
              <Button
                key={verb}
                variant={verb === "execute" ? "secondary" : "ghost"}
                disabled={busy}
                onClick={() => submit(verb === "execute" ? { kind: "execute", wallet, multisig: state.multisig, index: row.index } : { kind: "vote", wallet, multisig: state.multisig, index: row.index, vote: verb })}
                lang={lang(locale)}
              >
                {verb === "approve" ? word("approve") : verb === "reject" ? word("reject") : verb === "cancel" ? word("cancelProposal") : word("execute")}
              </Button>
            ))}
          </div>
        ) : null}
      </li>
    );
  };

  const memberColumns: TableColumn<TreasuryMember>[] = [
    {
      key: "address",
      label: word("member"),
      render: (row) => (
        <span className={styles.mono}>
          {short(row.address)}
          {row.address === wallet ? <span className={styles.you}> · {word("you")}</span> : null}
        </span>
      ),
    },
    { key: "roles", label: word("roles"), render: (row) => <Roles member={row} locale={locale} /> },
  ];

  const limitRow = (row: TreasuryLimit) => (
    <li key={row.address} className={styles.item}>
      <div className={styles.itemHead}>
        <span className={styles.itemWhat}>
          {row.asset === "OTHER" ? `${row.amountRaw} · ${short(row.mint)}${row.vaultIndex !== 0 ? ` · ${word("otherVault")}` : ""}` : money(row.amountRaw, row.asset, locale)} / {row.period ? word(`period_${row.period}`) : "—"}
        </span>
        <span className={styles.hint}>
          {word("remaining")}: {money(row.remainingRaw, row.asset, locale)}
        </span>
      </div>
      <dl className={styles.itemFacts}>
        <div>
          <dt>{word("spenders")}</dt>
          <dd className={styles.mono}>{row.spenders.map(short).join(", ")}</dd>
        </div>
        <div>
          <dt>{word("destinations")}</dt>
          <dd>{row.destinations.length === 0 ? <span className={styles.warn}>{word("anywhere")}</span> : <span className={styles.mono}>{row.destinations.map(short).join(", ")}</span>}</dd>
        </div>
      </dl>
      {(row.spenders.includes(wallet) && row.asset !== "OTHER") || me?.initiate ? (
        <div className={styles.rowActions}>
          {row.spenders.includes(wallet) && row.asset !== "OTHER" ? (
            <Button variant="ghost" disabled={busy} onClick={() => setOpen({ spend: row.address })} lang={lang(locale)}>
              {word("spend")}
            </Button>
          ) : null}
          {me?.initiate && state.autonomous ? (
            <Button variant="ghost" disabled={busy} onClick={() => submit({ kind: "config", wallet, multisig: state.multisig, change: { type: "removeLimit", limit: row.address } })} lang={lang(locale)}>
              {word("revoke")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );

  const spending = typeof open === "object" && open !== null ? state.limits.find((limit) => limit.address === open.spend) ?? null : null;

  return (
    <div className={styles.view}>
      <HeroNumber
        label={word("vault")}
        value={
          <span className={styles.figures}>
            <span>{money(state.balances.solRaw, "SOL", locale)}</span>
            {state.balances.usdcRaw !== null ? <span>{money(state.balances.usdcRaw, "USDC", locale)}</span> : null}
          </span>
        }
        note={
          <span className={styles.vaultNote}>
            {word("vaultNote")}:{" "}
            <a className={styles.mono} href={explorerAddressUrl(net, state.vault)} target="_blank" rel="noreferrer">
              {short(state.vault)}
            </a>{" "}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                void navigator.clipboard?.writeText(state.vault).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? word("copied") : word("copy")}
            </button>
          </span>
        }
        lang={lang(locale)}
      />
      {!me ? <p className={styles.hint}>{word("notMember")}</p> : null}
      {me && open !== "deposit" ? (
        <div className={styles.rowActions}>
          <Button variant="secondary" icon="plus" disabled={busy} onClick={() => setOpen("deposit")} lang={lang(locale)}>
            {word("deposit")}
          </Button>
        </div>
      ) : null}
      {me && open === "deposit" ? (
        <Block title={word("depositTitle")} icon="wallet" lang={lang(locale)}>
          <DepositForm wallet={wallet} multisig={state.multisig} locale={locale} busy={busy} onSubmit={submit} onCancel={() => setOpen(null)} />
        </Block>
      ) : null}

      <Block
        title={word("rules")}
        icon="landmark"
        lang={lang(locale)}
        action={
          me?.initiate && state.autonomous && open !== "rules" ? (
            <Button variant="secondary" onClick={() => setOpen("rules")} lang={lang(locale)}>
              {word("changeRules")}
            </Button>
          ) : undefined
        }
      >
        <p className={styles.rulesLine}>
          <strong>{rulesText(state.threshold, voters, state.timeLockSeconds, locale)}</strong>
          <span className={styles.hint}>{state.autonomous ? word("autonomous") : word("authority", { address: short(state.configAuthority ?? "") })}</span>
        </p>
        <Table columns={memberColumns} rows={state.members} rowKey={(row) => row.address} caption={word("members")} />
        {open === "rules" ? (
          <RulesForm wallet={wallet} multisig={state.multisig} members={state.members} threshold={state.threshold} timeLock={state.timeLockSeconds} locale={locale} busy={busy} onSubmit={submit} onCancel={() => setOpen(null)} />
        ) : null}
      </Block>

      <Block title={word("proposals")} icon="receipt" lang={lang(locale)}>
        {state.proposals.length === 0 ? <p className={styles.hint}>{word("proposalsEmpty")}</p> : <ul className={styles.list} aria-label={word("proposals")}>{state.proposals.map(proposalRow)}</ul>}
      </Block>

      {/* SOL-L1d: Ryntra's launch fees, where this vault is their claimer — one proposal claims all that waits. */}
      {state.launchFeeClaimer ? (
        <Block
          title={word("launchClaimsTitle")}
          icon="landmark"
          lang={lang(locale)}
          action={
            me?.initiate ? (
              <Button variant="secondary" disabled={busy} onClick={() => submit({ kind: "launchClaims", wallet, multisig: state.multisig })} lang={lang(locale)}>
                {word("launchClaimsPropose")}
              </Button>
            ) : undefined
          }
        >
          <p className={styles.hint}>{word("launchClaimsLine")}</p>
        </Block>
      ) : null}

      {me?.initiate ? (
        <Block title={word("payouts")} icon="banknote" lang={lang(locale)}>
          <PayoutsForm wallet={wallet} multisig={state.multisig} vault={state.vault} locale={locale} busy={busy} onSubmit={submit} />
        </Block>
      ) : null}

      <Block
        title={word("limits")}
        icon="sliders-horizontal"
        lang={lang(locale)}
        action={
          me?.initiate && state.autonomous && open !== "limit" ? (
            <Button variant="secondary" onClick={() => setOpen("limit")} lang={lang(locale)}>
              {word("addLimit")}
            </Button>
          ) : undefined
        }
      >
        {state.limits.length > 0 ? <ul className={styles.list} aria-label={word("limits")}>{state.limits.map(limitRow)}</ul> : state.limitsUnread || state.limitsPartial ? null : <p className={styles.hint}>{word("limitsEmpty")}</p>}
        {state.limitsUnread ? <p className={styles.hint}>{word("limitsUnread")}</p> : state.limitsPartial ? <p className={styles.hint}>{word("limitsPartial")}</p> : null}
        {open === "limit" ? <LimitForm wallet={wallet} multisig={state.multisig} locale={locale} busy={busy} onSubmit={submit} onCancel={() => setOpen(null)} /> : null}
        {spending ? <SpendForm key={spending.address} wallet={wallet} multisig={state.multisig} limit={spending} locale={locale} busy={busy} onSubmit={submit} onCancel={() => setOpen(null)} /> : null}
      </Block>
    </div>
  );
}
