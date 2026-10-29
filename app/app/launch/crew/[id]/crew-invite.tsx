"use client";

import { Users } from "@phosphor-icons/react";
import { Block, Button, Page } from "@ryntra/core/ui";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { LaunchCrewResponse } from "@/lib/api/v1/contract";
import { partWords, sameHandle } from "@/lib/core/launch/crew";
import { windowById } from "@/lib/core/launch/windows";

import { coreLang } from "../../launch-blocks";
import { shortAddress } from "../../launch-format";
import { launchWords } from "../../launch-words";
import crewStyles from "../../crew.module.css";
import styles from "../../launch.module.css";
import { windowWords } from "../../new/mission-start";

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

/**
 * The invitee's side of a crew (MC-2): the crew as anyone reads it, the words to say yes to, and the answer with the
 * person's own proven wallet — a mutation, so the wallet's own signature stands behind it.
 */
export function CrewInvite({ locale, id, initialHandle }: { locale: WorkspaceLocale; id: string; initialHandle: string | null }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const [read, setRead] = useState<LaunchCrewResponse | "missing" | "unread" | null>(null);
  const [handle, setHandle] = useState<string | null>(initialHandle);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/launch/crews/${id}`, { headers: HEADERS, cache: "no-store" });
      if (response.status === 404) return setRead("missing");
      if (!response.ok) return setRead("unread");
      setRead((await response.json()) as LaunchCrewResponse);
    } catch {
      setRead("unread");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (choice: "accept" | "decline") => {
    if (!handle || !connection) return;
    setBusy(true);
    setFailure(null);
    const proven = await proof.act().catch(() => false);
    if (!proven) {
      setBusy(false);
      setFailure(word("crewProveFirst"));
      return;
    }
    try {
      const response = await fetch(`/api/v1/launch/crews/${id}/answer`, { method: "POST", headers: HEADERS, body: JSON.stringify({ handle, answer: choice }) });
      const body = (await response.json().catch(() => null)) as (LaunchCrewResponse & { error?: { message: string } }) | null;
      if (!response.ok || !body?.crew) setFailure(word("inviteFailed", { why: body?.error?.message ?? String(response.status) }));
      else setRead(body);
    } catch {
      setFailure(word("inviteFailed", { why: "network" }));
    }
    setBusy(false);
  };

  if (read === null) return <Page kind="action" className={styles.corePage} title={word("crewTitle")} lang={lang}>{null}</Page>;
  if (read === "missing" || read === "unread") {
    return (
      <Page kind="action" className={styles.corePage} title={word("crewTitle")} lang={lang}>
        <p className={styles.hint}>{read === "missing" ? word("inviteNotFound") : word("inviteFailed", { why: "—" })}</p>
      </Page>
    );
  }
  const crew = read.crew;
  const member = handle ? crew.members.find((item) => sameHandle(item.handle, handle)) ?? null : null;
  const window = crew.window ? windowById(crew.window) : null;
  const creator = crew.creatorHandle ? `@${crew.creatorHandle}` : shortAddress(crew.creator);
  const mineYes = member?.state === "ACCEPTED" && connection !== null && member.wallet === connection.address;

  return (
    <Page kind="action" className={styles.corePage} title={word("inviteTitle", { symbol: crew.symbol })} lang={lang}>
      <p className={styles.lede}>{word("inviteLede", { creator, symbol: crew.symbol, name: crew.name })}</p>
      <Block title={word("crewTitle")} titleAs="h2" lang={lang}>
        <ul className={crewStyles.rows}>
          <li className={crewStyles.row} data-you="">
            <span className={crewStyles.handle}>{creator}</span>
            <span className={crewStyles.part}>{partWords(crew.creatorBps)}</span>
            <span className={crewStyles.state} />
          </li>
          {crew.members.map((item) => (
            <li key={item.handle} className={crewStyles.row}>
              <span className={crewStyles.handle}>@{item.handle}</span>
              <span className={crewStyles.part}>{partWords(item.bps)}</span>
              <span className={crewStyles.state} data-state={item.state}>
                {word(`crewState_${item.state}`)}
              </span>
            </li>
          ))}
        </ul>
        {window ? <p className={crewStyles.note}>{word("inviteWindow", { window: windowWords(window, locale) })}</p> : null}
        <p className={crewStyles.note}>{word("inviteWaitingStays")}</p>
      </Block>
      {crew.token ? (
        <p className={styles.hint}>{word("inviteLaunched")}</p>
      ) : crew.expired ? (
        <p className={styles.hint}>{word("inviteExpired")}</p>
      ) : !read.open ? (
        <p className={styles.hint}>{word("inviteClosed")}</p>
      ) : (
        <Block title={word("inviteWho")} titleAs="h2" lang={lang}>
          <div className={styles.segments} role="radiogroup" aria-label={word("inviteWho")}>
            {crew.members.map((item) => (
              <button key={item.handle} type="button" role="radio" aria-checked={member?.handle === item.handle} className={styles.segment} onClick={() => setHandle(item.handle)}>
                @{item.handle}
              </button>
            ))}
          </div>
          {member ? (
            <>
              <ol className={crewStyles.consent}>
                {member.consent.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              <p className={crewStyles.note}>
                <Users size={14} aria-hidden /> {word("inviteHandleNote")}
              </p>
              {member.state === "ACCEPTED" && member.wallet ? <p className={crewStyles.note}>{word("inviteSaidYes", { wallet: shortAddress(member.wallet) })}</p> : null}
              {member.state === "DECLINED" ? <p className={crewStyles.note}>{word("inviteSaidNo")}</p> : null}
              {!connection ? (
                <ConnectWalletButton block />
              ) : (
                <div className={crewStyles.actions}>
                  {member.state === "ACCEPTED" ? (
                    mineYes ? (
                      <Button variant="secondary" onClick={() => void answer("decline")} disabled={busy} lang={lang}>
                        {word("inviteTakeBack")}
                      </Button>
                    ) : null
                  ) : (
                    /* A no is a yes taken back by its own wallet: a handle not answered needs none. */
                    <Button variant="primary" onClick={() => void answer("accept")} disabled={busy} lang={lang}>
                      {word("inviteYes")}
                    </Button>
                  )}
                </div>
              )}
              {failure ? (
                <p className={styles.problem} role="alert">
                  {failure}
                </p>
              ) : null}
            </>
          ) : null}
        </Block>
      )}
    </Page>
  );
}
