"use client";

import { Block, Button, EmptyState, Page, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import type { TreasuryBuildResponse, TreasurySubmitResponse } from "@/lib/solana/treasury/contract";
import { isAddress } from "@/lib/solana/treasury/model";

import { AgentForm, CreateForm } from "./treasury-forms";
import { FailureLine, TreasuryReceiptCard, TreasuryReviewCard, lang, short, useTreasuryAction, type Chain } from "./treasury-flow";
import { TreasuryView, useTreasuryState } from "./treasury-view";
import { treasuryWords } from "./treasury-words";
import styles from "./treasury.module.css";

type Saved = Readonly<{ address: string; kind: "treasury" | "agent" }>;

/**
 * The treasuries this browser opened for this wallet on this network — a convenience, not a record: the chain is the
 * record, and any multisig opens by its address. Storage may be refused (a private window); the page works without it.
 */
const savedKey = (network: Chain, wallet: string) => `ryntra.treasury.v1.${network}.${wallet}`;
function readSaved(network: Chain, wallet: string): Saved[] {
  try {
    const raw = window.localStorage.getItem(savedKey(network, wallet));
    const rows = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(rows) ? rows.filter((row): row is Saved => typeof row?.address === "string" && isAddress(row.address) && (row.kind === "treasury" || row.kind === "agent")).slice(0, 50) : [];
  } catch {
    return [];
  }
}
function writeSaved(network: Chain, wallet: string, rows: readonly Saved[]): void {
  try {
    window.localStorage.setItem(savedKey(network, wallet), JSON.stringify(rows.slice(0, 50)));
  } catch {
    /* Not kept: the list is a convenience. */
  }
}

type Mode = "home" | "create" | "agent";

/**
 * «Казна» (SOL-4): the person's own Squads v4 multisig — created by their wallet, with the roles, threshold and delay
 * they choose; payouts in one proposal; spending limits as a mandate with their recipients; an agent's own small
 * multisig. Devnet first; mainnet is the operator's canary.
 */

/**
 * «Agent wallet» — an agent's own small multisig — is drawn only where the deployment says Solana agents are reachable
 * (`NEXT_PUBLIC_RYNTRA_TREASURY_AGENT=on`), as Earn's row and the limits' row are.
 *
 * The audit found it beside «Create a treasury» with no agent to put in it: Solana agents are a plan, their rows are
 * written and not started, and a second orange-adjacent action offering a spending limit for a product that does not
 * exist teaches a person that half the page is broken (audit UX-703, «Реєстр зайвого» M10-automation). The form keeps
 * working behind the flag, and a treasury already created as an agent's still opens from the list.
 */
const AGENT_WALLET_IN_TREASURY = process.env.NEXT_PUBLIC_RYNTRA_TREASURY_AGENT === "on";
export function TreasurySurface({ locale, network, teams = false }: { locale: WorkspaceLocale; network: Chain; teams?: boolean }) {
  const word = treasuryWords(locale);
  const { connection } = useSolanaConnection();
  const wallet = connection?.address ?? null;
  const [saved, setSaved] = useState<Saved[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("home");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    setSaved(wallet ? readSaved(network, wallet) : []);
  }, [network, wallet]);

  /* `?multisig=` opens one directly: a link a member shares with another. */
  useEffect(() => {
    const named = new URLSearchParams(window.location.search).get("multisig");
    if (named && isAddress(named)) setSelected(named);
  }, []);

  const remember = useCallback(
    (address: string, kind: Saved["kind"]) => {
      if (!wallet) return;
      setSaved((current) => {
        const next = [{ address, kind }, ...current.filter((row) => row.address !== address)];
        writeSaved(network, wallet, next);
        return next;
      });
    },
    [network, wallet],
  );

  const select = useCallback((address: string | null) => {
    setSelected(address);
    setMode("home");
    try {
      const url = new URL(window.location.href);
      if (address) url.searchParams.set("multisig", address);
      else url.searchParams.delete("multisig");
      window.history.replaceState(null, "", url);
    } catch {
      /* The address bar is a convenience too. */
    }
  }, []);

  const view = useTreasuryState(selected ?? "");
  /* A sent action starts the forms over; a failure or a cancelled Review keeps what was typed. */
  const [round, setRound] = useState(0);
  const [settle, setSettle] = useState<{ address: string; until: number; kind?: Saved["kind"] } | null>(null);
  const { reload } = view;
  const onDone = useCallback(
    (result: TreasurySubmitResponse) => {
      setRound((current) => current + 1);
      if (result.kind === "create" || result.kind === "createAgent") {
        /* A create the chain has confirmed is kept; one still settling (or landed in part) is opened and read until the
           chain says, and joins the list only once it shows this wallet as a member. */
        if (result.state === "CONFIRMED") {
          remember(result.multisig, result.kind === "createAgent" ? "agent" : "treasury");
          /* «Готово» after a create goes back to the list, not to an empty form. */
          setMode("home");
        } else {
          select(result.multisig);
          setSettle({ address: result.multisig, until: Date.now() + 60_000, kind: result.kind === "createAgent" ? "agent" : "treasury" });
          return;
        }
      } else void reload();
      /* A send not yet confirmed, or a part of it: the chain is read again while it settles. */
      if (result.state !== "CONFIRMED" && selected) setSettle({ address: selected, until: Date.now() + 45_000 });
    },
    [remember, reload, select, selected],
  );
  /* An answer that did not come back may hide a send that landed: the forms start over and the chain is read again,
     so nothing is sent twice from what was typed. A create's new multisig is opened and read until it shows: its
     address is known only from the build, and it joins «My treasuries» once the chain has it. */
  const onUnknown = useCallback(
    (built: TreasuryBuildResponse) => {
      setRound((current) => current + 1);
      const { kind, multisig } = built.review;
      if (kind === "create" || kind === "createAgent") {
        select(multisig);
        setSettle({ address: multisig, until: Date.now() + 60_000, kind: kind === "createAgent" ? "agent" : "treasury" });
        return;
      }
      void reload();
      if (selected) setSettle({ address: selected, until: Date.now() + 15_000 });
    },
    [reload, select, selected],
  );
  const action = useTreasuryAction(onDone, onUnknown);

  /* Reads while a send settles — always the open treasury's own, and none once another is opened. */
  useEffect(() => {
    if (!settle || settle.address !== selected) return;
    const timers = [5_000, 15_000, 30_000, 45_000, 60_000].filter((ms) => Date.now() + ms <= settle.until + 1_000).map((ms) => window.setTimeout(() => void reload(), ms));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [settle, selected, reload]);

  /* An opened treasury this wallet is a member of is remembered for next time; a link to someone else's is only read. */
  useEffect(() => {
    const state = view.read?.state;
    if (state && wallet && selected && state.members.some((member) => member.address === wallet) && !saved.some((row) => row.address === selected)) remember(selected, settle?.address === selected && settle.kind ? settle.kind : "treasury");
  }, [view.read, selected, saved, remember, wallet, settle]);

  const title = (
    <span className={styles.titleRow}>
      {word("title")}
      {network === "solana:devnet" ? (
        <span className={styles.netChip} title={word("devnetHint")}>
          {word("devnet")}
        </span>
      ) : (
        <span className={`${styles.netChip} ${styles.netChipLive}`} title={word("mainnetHint")} data-treasury-network="mainnet">
          {word("mainnet")}
        </span>
      )}
    </span>
  );

  const reviewing = action.phase === "review" || action.phase === "sign" || action.phase === "send" || (action.phase === "prepare" && action.held !== null);
  const flow = reviewing ? (
    <TreasuryReviewCard action={action} locale={locale} network={network} />
  ) : action.phase === "done" ? (
    <TreasuryReceiptCard
      action={action}
      locale={locale}
      network={network}
      onOpen={(address) => {
        action.reset();
        select(address);
      }}
    />
  ) : null;

  const columns: TableColumn<Saved>[] = [
    { key: "address", label: word("address"), render: (row) => <span className={styles.mono}>{short(row.address)}</span> },
    { key: "kind", label: word("what"), render: (row) => (row.kind === "agent" ? word("kindAgent") : word("kindTreasury")) },
    {
      key: "actions",
      label: word("actions"),
      render: (row) => (
        <span className={styles.rowActions}>
          <Button variant="ghost" onClick={() => select(row.address)} lang={lang(locale)}>
            {word("open")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (!wallet) return;
              const next = saved.filter((entry) => entry.address !== row.address);
              setSaved(next);
              writeSaved(network, wallet, next);
            }}
            lang={lang(locale)}
          >
            {word("forget")}
          </Button>
        </span>
      ),
    },
  ];

  return (
    /* One column of the core's own action width, in the middle: a treasury is a few figures, a form and a Review — not a
       dashboard to stretch across a wide screen. */
    <Page kind="action" className={styles.page} title={title} help={word("help")} lang={lang(locale)}>
      {!wallet ? (
        <EmptyState
          icon="wallet"
          text={word("connectLine")}
          action={
            <ConnectWalletButton />
          }
        />
      ) : (
        <>
          {flow}
          <FailureLine action={action} locale={locale} />
          {/* Hidden, not unmounted, under a Review and a receipt: what the person typed is still there after a cancel or
              a refusal. */}
          <div key={round} className={styles.surface} hidden={reviewing || action.phase === "done"}>
            {selected ? (
              <>
                <div className={styles.backRow}>
                  <button type="button" className={styles.linkButton} onClick={() => select(null)}>
                    ← {word("back")}
                  </button>
                  <span className={styles.mono}>{short(selected)}</span>
                </div>
                <TreasuryView wallet={wallet} network={network} locale={locale} action={action} read={view.read} reload={view.reload} />
              </>
            ) : mode === "create" ? (
              <Block title={word("createTitle")} icon="landmark" lang={lang(locale)}>
                <CreateForm wallet={wallet} locale={locale} busy={action.phase === "prepare"} onSubmit={(request) => void action.prepare(request)} onCancel={() => setMode("home")} />
              </Block>
            ) : mode === "agent" ? (
              <Block title={word("agentTitle")} icon="bot" lang={lang(locale)}>
                <AgentForm wallet={wallet} locale={locale} busy={action.phase === "prepare"} onSubmit={(request) => void action.prepare(request)} onCancel={() => setMode("home")} />
              </Block>
            ) : (
              <>
                <div className={styles.startRow}>
                  <Button variant="primary" icon="plus" onClick={() => setMode("create")} lang={lang(locale)}>
                    {word("create")}
                  </Button>
                  {AGENT_WALLET_IN_TREASURY ? (
                    <Button variant="secondary" icon="bot" onClick={() => setMode("agent")} lang={lang(locale)}>
                      {word("createAgent")}
                    </Button>
                  ) : null}
                  {teams ? (
                    <Link className={styles.linkButton} href="/app/treasury/team">
                      {word("team")} →
                    </Link>
                  ) : null}
                </div>
                <Block title={word("mine")} icon="landmark" lang={lang(locale)}>
                  {/* Nothing saved yet: one sentence, not five column headings over no rows («Реєстр зайвого»
                      M10-automation, 16 порожні блоки). The table comes back with the first treasury. */}
                  {saved.length > 0 ? (
                    <Table columns={columns} rows={saved} rowKey={(row) => row.address} caption={word("mine")} empty={word("mineEmpty")} />
                  ) : (
                    <p className={styles.hint}>{word("mineEmpty")}</p>
                  )}
                  <form
                    className={styles.openRow}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (isAddress(typed.trim())) select(typed.trim());
                    }}
                  >
                    <input className={`${styles.input} ${styles.mono}`} aria-label={word("openTitle")} placeholder={word("openPlaceholder")} value={typed} onChange={(event) => setTyped(event.target.value)} spellCheck={false} autoComplete="off" />
                    <Button variant="secondary" type="submit" disabled={!isAddress(typed.trim())} lang={lang(locale)}>
                      {word("open")}
                    </Button>
                  </form>
                </Block>
              </>
            )}
          </div>
        </>
      )}
    </Page>
  );
}
