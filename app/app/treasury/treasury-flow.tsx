"use client";

import { Receipt as CoreReceipt, Review } from "@ryntra/core/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/solana/explorer";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import type { ConfigChangeView, TreasuryBuildRequest, TreasuryBuildResponse, TreasuryReview, TreasurySubmitResponse } from "@/lib/solana/treasury/contract";
import { CHAIN_REFUSAL_CODES, SQUADS_PROGRAM, TREASURY_ASSETS, delayParts, formatRaw, type TreasuryIssue } from "@/lib/solana/treasury/model";
import { createTreasuryKey, signAfterWallet, type TreasuryCreateKey } from "@/lib/solana/treasury/create-key.client";
import { signTransactions, walletSignsV1 } from "@/lib/solana/wallet.client";

import { FAILURE_WORDS, issueWord, treasuryWords } from "./treasury-words";
import styles from "./treasury.module.css";

export type Chain = "solana:devnet" | "solana:mainnet";
export type Answer<T> = { ok: true; data: T } | { ok: false; code: string; message: string; issues?: readonly TreasuryIssue[] };

const API_HEADERS = { "content-type": "application/json" } as const;

export async function treasuryApi<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { ...init, headers: { ...API_HEADERS, ...(init?.headers ?? {}) }, cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string; issues?: TreasuryIssue[] } } | null;
    if (!response.ok) return { ok: false, code: body?.error?.code ?? "UNAVAILABLE", message: body?.error?.message ?? "", ...(body?.error?.issues ? { issues: body.error.issues } : {}) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

export const lang = (locale: WorkspaceLocale) => (locale === "uk" ? "uk" : "en");
export const short = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);
export const networkOf = (chain: Chain) => (chain === "solana:devnet" ? "devnet" : "mainnet");

/** Base units → «12 500,5 USDC» / «12,500.5 USDC»: every digit the asset holds, grouped as the page's language groups them. */
export function money(raw: string | bigint, asset: "SOL" | "USDC" | "OTHER", locale: WorkspaceLocale): string {
  if (asset === "OTHER") return String(raw);
  const [whole = "0", fraction] = formatRaw(BigInt(raw), TREASURY_ASSETS[asset].decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, locale === "uk" ? "\u00a0" : ",");
  return `${grouped}${fraction ? `${locale === "uk" ? "," : "."}${fraction}` : ""} ${asset}`;
}

/** Base units of any token, grouped as `money` groups them: «1 234,56». */
export function formatUnits(raw: string | bigint, decimals: number, locale: WorkspaceLocale): string {
  const [whole = "0", fraction] = formatRaw(BigInt(raw), decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, locale === "uk" ? "\u00a0" : ",");
  return `${grouped}${fraction ? `${locale === "uk" ? "," : "."}${fraction}` : ""}`;
}

export function delayText(seconds: number, locale: WorkspaceLocale): string {
  const word = treasuryWords(locale);
  if (seconds === 0) return word("delayNone");
  const { value, unit } = delayParts(seconds);
  return word(`unit_${unit}`, { n: value });
}

/** «2 з 2 голосів · затримка 1 д» — and «· без затримки» when there is none, not «затримка Без затримки». */
export function rulesText(threshold: number, voters: number, seconds: number, locale: WorkspaceLocale): string {
  const word = treasuryWords(locale);
  return seconds === 0 ? word("rulesLineNoDelay", { n: threshold, m: voters }) : word("rulesLine", { n: threshold, m: voters, delay: delayText(seconds, locale) });
}

/**
 * A change of the rules in the page's words — whole: a limit names who spends and where it pays (an empty list is said
 * as «anywhere»), a rent collector its address. The list of proposals and every Review of a change say the same.
 */
export function changeWhat(change: ConfigChangeView, locale: WorkspaceLocale): string {
  const word = treasuryWords(locale);
  switch (change.type) {
    case "addMember":
      return word("what_addMember", { address: short(change.member.address) });
    case "removeMember":
      return word("what_removeMember", { address: short(change.address) });
    case "threshold":
      return word("what_threshold", { n: change.threshold });
    case "timeLock":
      return word("what_timeLock", { delay: delayText(change.seconds, locale) });
    case "addLimit":
      return word("what_addLimitFull", {
        /* A token this page does not name, or another vault: the raw figure with its mint, said as such. */
        amount: change.asset === "OTHER" ? `${change.amountRaw} · ${short(change.mint ?? "")}${change.vaultIndex ? ` · ${word("otherVault")}` : ""}` : money(change.amountRaw, change.asset, locale),
        period: word(`period_${change.period as "once" | "day" | "week" | "month"}`),
        spenders: change.spenders.map(short).join(", "),
        destinations: change.destinations.length === 0 ? word("anywhere") : change.destinations.map(short).join(", "),
      });
    case "removeLimit":
      return word("what_removeLimitOf", { address: short(change.limit) });
    case "rentCollector":
      return word("what_rentCollectorTo", { address: change.address ? short(change.address) : word("rentCollectorNone") });
  }
}

type Phase = "idle" | "prepare" | "review" | "sign" | "send" | "done" | "error";
type Held = { build: TreasuryBuildResponse; receivedAt: number };

export type TreasuryAction = Readonly<{
  phase: Phase;
  request: TreasuryBuildRequest | null;
  held: Held | null;
  result: TreasurySubmitResponse | null;
  failure: Readonly<{ code: string; message: string; issues?: readonly TreasuryIssue[] }> | null;
  prepare: (request: TreasuryBuildRequest) => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => void;
}>;

/**
 * What the person weighed in a Review. Bytes built again whose figures differ are shown again, never signed unseen — a
 * new multisig's address too: its seed key is the same for every build of one request.
 */
function reviewedFigures(build: TreasuryBuildResponse): string {
  const { review } = build;
  return JSON.stringify({
    multisig: review.multisig,
    vault: review.vault,
    index: review.index,
    outflow: review.outflow,
    rules: review.rules,
    fee: review.creationFeeLamports,
    rent: review.rentLamports,
    network: build.networkCostLamports,
    accounts: review.newTokenAccounts,
    approves: review.alsoApproves,
    shortfall: review.shortfall,
    wallet: review.walletShortfall,
    blocked: review.blockedBy,
    authority: review.configAuthority,
    rentTo: review.rentTo,
    to: review.to,
    changes: review.changes,
    vaultRent: review.vaultRentLamports,
    control: review.control,
  });
}

/**
 * Submit answers that say the network was never reached, or refused the first part: nothing moved. Any other failure —
 * a lost answer, the route's own failure, a build already sent — may have landed.
 */
/** The browser's own refusal after the wallet signed — said apart from the person cancelling in the wallet. */
const AFTER_WALLET = "The new treasury's key did not sign:";

const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "WALLET_MISMATCH",
  "TREASURY_UNAVAILABLE",
  "TREASURY_BUILD_NOT_FOUND",
  "TREASURY_BUILD_EXPIRED",
  "TREASURY_SIGNED_OTHER_BYTES",
  ...CHAIN_REFUSAL_CODES,
]);

/**
 * One treasury action from request to receipt: the server builds and answers a Review; on «Підписати» the wallet signs
 * the very bytes reviewed — built again first if they aged on the Review, and again if they aged in the wallet; bytes
 * built again whose figures moved go back to the Review — and the server sends them. Nothing is sent without the
 * wallet's signature. `onUnknown` — a send whose outcome did not come back: the page reads the chain again.
 */
export function useTreasuryAction(onDone?: (result: TreasurySubmitResponse) => void, onUnknown?: (built: TreasuryBuildResponse) => void): TreasuryAction {
  const { connection } = useSolanaConnection();
  const [phase, setPhase] = useState<Phase>("idle");
  const [request, setRequest] = useState<TreasuryBuildRequest | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [result, setResult] = useState<TreasurySubmitResponse | null>(null);
  const [failure, setFailure] = useState<TreasuryAction["failure"]>(null);
  const heldRef = useRef<Held | null>(null);
  /* One signature at a time: a second press while the wallet or the send is busy does nothing. */
  const busyRef = useRef(false);
  /* A new treasury's one-time seed key, made in this tab: the server gets its public half, the wallet signs first. */
  const keyRef = useRef<TreasuryCreateKey | null>(null);
  const dropKey = useCallback(() => {
    keyRef.current?.discard();
    keyRef.current = null;
  }, []);
  /* Only the latest request's answer lands: an older build still on its way is dropped. */
  const prepareRef = useRef(0);
  /* Leaving the page forgets the key. */
  useEffect(() => () => dropKey(), [dropKey]);

  /* v1 bytes for a wallet that signs them — the format Phantom asks for, the limits in the message — legacy otherwise. */
  const build = useCallback(
    async (next: TreasuryBuildRequest): Promise<Answer<TreasuryBuildResponse>> =>
      treasuryApi<TreasuryBuildResponse>("/api/solana/treasury/build", { method: "POST", body: JSON.stringify({ ...next, ...(connection && walletSignsV1(connection.wallet) ? { format: "v1" } : {}) }) }),
    [connection],
  );

  const prepare = useCallback(
    async (draft: TreasuryBuildRequest) => {
      const asked = ++prepareRef.current;
      /* Busy at once — the forms' own guard — and the last Review is not shown under the new request. */
      setFailure(null);
      setResult(null);
      heldRef.current = null;
      setHeld(null);
      setPhase("prepare");
      dropKey();
      let next = draft;
      if (draft.kind === "create" || draft.kind === "createAgent") {
        let key: TreasuryCreateKey;
        try {
          key = await createTreasuryKey();
        } catch {
          if (asked !== prepareRef.current) return;
          setFailure({ code: "TREASURY_KEY_UNAVAILABLE", message: "" });
          setPhase("error");
          return;
        }
        if (asked !== prepareRef.current) {
          key.discard();
          return;
        }
        keyRef.current = key;
        next = { ...draft, createKey: key.address };
      }
      setRequest(next);
      const answer = await build(next);
      if (asked !== prepareRef.current) return;
      if (!answer.ok) {
        dropKey();
        setFailure(answer);
        setPhase("error");
        return;
      }
      const fresh = { build: answer.data, receivedAt: Date.now() };
      heldRef.current = fresh;
      setHeld(fresh);
      setPhase("review");
    },
    [build, dropKey],
  );

  const signThenSubmit = useCallback(async () => {
    const current = heldRef.current;
    if (!current || !request || !connection || connection.address !== request.wallet) {
      setFailure({ code: "WALLET_CHANGED", message: "" });
      setPhase("error");
      return;
    }
    setFailure(null);
    let first = true;
    const signed = await signFreshBytes({
      /* The reviewed bytes first; built again only once they can no longer be signed in time. */
      build: async () => {
        if (first) {
          first = false;
          return { ok: true as const, data: current.build };
        }
        setPhase("prepare");
        const again = await build(request);
        if (!again.ok) return again;
        const fresh = { build: again.data, receivedAt: Date.now() };
        heldRef.current = fresh;
        setHeld(fresh);
        /* What was reviewed is what is signed: moved figures, or a build that may no longer be signed, are shown first. */
        if (again.data.review.blockedBy || reviewedFigures(again.data) !== reviewedFigures(current.build)) return { ok: false as const, code: "REVIEW_CHANGED", message: "" };
        return again;
      },
      signableMsOf: (data) => (data === current.build ? data.signableMs - (Date.now() - current.receivedAt) : data.signableMs),
      sign: async (data) => {
        setPhase("sign");
        const answer = await signTransactions({ wallet: connection.wallet, address: request.wallet, unsignedWireBase64: [...data.unsignedWireBase64], chain: data.network });
        if (!answer.ok) return answer;
        /* The wallet first; then the new treasury's own key, over exactly what the wallet signed. */
        if (request.kind !== "create" && request.kind !== "createAgent") return { ok: true, value: answer.signedWireBase64 };
        const key = keyRef.current;
        if (!key || key.address !== request.createKey) return { ok: false, reason: AFTER_WALLET };
        const completed: string[] = [];
        for (const [index, wire] of answer.signedWireBase64.entries()) {
          let after;
          try {
            after = await signAfterWallet({ expectedWireBase64: data.unsignedWireBase64[index] ?? "", signedWireBase64: wire, wallet: request.wallet, key });
          } catch {
            return { ok: false, reason: AFTER_WALLET };
          }
          if (!after.ok) return { ok: false, reason: `${AFTER_WALLET} ${after.reason}` };
          completed.push(after.signedWireBase64);
        }
        /* A create's bytes always name its key: bytes that never do are not this create's, and are not sent. */
        if (completed.every((wire, index) => wire === answer.signedWireBase64[index])) return { ok: false, reason: AFTER_WALLET };
        return { ok: true, value: completed };
      },
    });
    if (!signed.ok) {
      if (signed.stage === "sign" || (signed.stage === "build" && signed.failure.code === "REVIEW_CHANGED")) {
        /* The browser's own refusal after the wallet signed is not the person cancelling. */
        const ownRefusal = signed.stage === "sign" && signed.reason.startsWith(AFTER_WALLET);
        setFailure(signed.stage === "sign" ? { code: ownRefusal ? "TREASURY_SIGNED_OTHER_BYTES" : "WALLET_REFUSED", message: signed.reason } : { code: "REVIEW_CHANGED", message: "" });
        setPhase("review");
        return;
      }
      setFailure(signed.stage === "build" ? signed.failure : { code: "TREASURY_BUILD_EXPIRED", message: "" });
      setPhase("error");
      return;
    }
    setPhase("send");
    const sent = await treasuryApi<TreasurySubmitResponse>("/api/solana/treasury/submit", {
      method: "POST",
      body: JSON.stringify({ buildId: signed.built.buildId, wallet: request.wallet, signedWireBase64: signed.signed }),
    });
    if (!sent.ok) {
      /* Not told «nothing was sent» unless it is so: an answer that did not come back may hide a send that landed. */
      const unknown = !NOT_SENT_CODES.has(sent.code);
      setFailure(unknown ? { code: "TREASURY_SUBMIT_UNKNOWN", message: sent.message } : sent);
      setPhase("error");
      dropKey();
      if (unknown) onUnknown?.(signed.built);
      return;
    }
    dropKey();
    setResult(sent.data);
    setPhase("done");
    onDone?.(sent.data);
  }, [build, connection, dropKey, onDone, onUnknown, request]);

  const confirm = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await signThenSubmit();
    } finally {
      busyRef.current = false;
    }
  }, [signThenSubmit]);

  const reset = useCallback(() => {
    dropKey();
    heldRef.current = null;
    setHeld(null);
    setRequest(null);
    setResult(null);
    setFailure(null);
    setPhase("idle");
  }, [dropKey]);

  return { phase, request, held, result, failure, prepare, confirm, reset };
}


function reviewTitle(review: TreasuryReview, request: TreasuryBuildRequest, locale: WorkspaceLocale): string {
  const word = treasuryWords(locale);
  switch (request.kind) {
    case "create":
      return word("reviewCreate");
    case "createAgent":
      return word("reviewCreateAgent");
    case "payouts":
      return word("reviewPayouts", { n: request.payouts.length });
    case "config":
      return word("reviewConfig");
    case "vote":
      return word(`reviewVote_${request.vote}`, { index: request.index });
    case "execute":
      return word("reviewExecute", { index: request.index });
    case "spend":
      return word("reviewSpend");
    case "deposit":
      return word("reviewDeposit");
    case "launchClaims":
      return word("reviewLaunchClaims");
  }
  return review.kind;
}

/**
 * Rent said by where it stays (`costRent_*`): with the treasury; a proposal's — wherever the treasury's own rent
 * collector sends it once its accounts are closed; with the recipient.
 */
function rentWord(kind: TreasuryBuildRequest["kind"], rentTo: TreasuryReview["rentTo"]) {
  switch (kind) {
    case "create":
    case "createAgent":
      return "costRent_create" as const;
    case "payouts":
    case "config":
    case "launchClaims":
      return rentTo === "collector" ? ("costRent_proposal_collector" as const) : rentTo === "kept" ? ("costRent_proposal_kept" as const) : ("costRent_proposal_vault" as const);
    case "spend":
      return "costRent_spend" as const;
    case "deposit":
      return "costRent_deposit" as const;
    default:
      return "costRent_execute" as const;
  }
}

/** The core's Review for a built treasury action: what leaves the vault, what comes of it, every cost on its own line. */
export function TreasuryReviewCard({ action, locale, network }: { action: TreasuryAction; locale: WorkspaceLocale; network: Chain }) {
  const word = treasuryWords(locale);
  const held = action.held;
  const request = action.request;
  if (!held || !request) return null;
  const { review } = held.build;
  const lamports = (raw: string | bigint) => money(raw, "SOL", locale);
  const outflow = review.outflow.map((row) => money(row.raw, row.asset, locale)).join(" · ");
  const rules = review.rules ? rulesText(review.rules.threshold, review.rules.voters, review.rules.timeLockSeconds, locale) : null;
  /* SOL-L1d: claims of the launch fees — what each source holds now, how many of each, what the proposer opens. */
  const claims = review.claims;
  const claimSources = claims ? claims.bySource.map((row) => `${word(`claimSource_${row.source}`)} ${row.count}`).join(" · ") : "";
  const claimHolding = claims ? claims.holding.map((row) => `${formatUnits(row.raw, row.decimals, locale)} ${row.symbol}`).join(" · ") : "";
  const get =
    request.kind === "launchClaims" && claims
      ? word("getClaims", { index: review.index ?? "", n: claims.claims, launches: claims.launches })
      : claims
        ? word(request.kind === "execute" ? "getClaimsRun" : "getClaimsVote", { n: claims.claims, launches: claims.launches })
      : request.kind === "create" || request.kind === "createAgent"
      ? word("getMultisig", { rules: rules ?? "" })
      : request.kind === "payouts" || request.kind === "config"
        ? word("getProposal", { index: review.index ?? "" })
        : request.kind === "vote"
          ? word("getVote")
          : request.kind === "deposit"
            ? word("getDeposit")
            : review.outflow.length === 0
              ? word("getChange")
              : word("getRecipients", { n: review.outflow[0]?.recipients ?? 0 });
  const network$ = BigInt(held.build.networkCostLamports);
  const rent = BigInt(review.rentLamports);
  const fee = BigInt(review.creationFeeLamports ?? "0");
  const costs = [
    { label: word("costNetwork"), value: lamports(network$) },
    ...(rent > 0n ? [{ label: word(request.kind === "launchClaims" && claims && claims.opens > 0 ? "costRent_claims" : rentWord(request.kind, review.rentTo)), value: `≈ ${lamports(rent)}` }] : []),
    ...(review.creationFeeLamports !== null ? [{ label: word("costSquads"), value: lamports(fee) }] : []),
    { label: word("costRyntra"), value: lamports(0n) },
  ];
  const rows = [
    /* A change's rules after it; a top-up's — who can move the money once it is in. */
    ...(rules && (request.kind === "config" || request.kind === "deposit") ? [{ label: word("rules"), value: rules }] : []),
    ...(review.configAuthority ? [{ label: word("configAuthorityLabel"), value: word("rowAuthority", { address: short(review.configAuthority) }), tone: "down" as const }] : []),
    /* What a top-up's wallet can do with the money once it is in: said when it is less than everything. */
    ...(review.control && !review.control.youVote ? [{ label: word("rules"), value: word("rowNotVoter"), tone: "down" as const }] : []),
    ...(review.control?.othersAlone ? [{ label: word("rules"), value: word("rowOthersAlone"), tone: "down" as const }] : []),
    /* What a change does — its proposal, a vote on it, its execution. */
    ...(review.changes?.length ? [{ label: word("change"), value: review.changes.map((change) => changeWhat(change, locale)).join(" · ") }] : []),
    /* Whom the money goes to: a spend's one address in full; a batch's recipients in the details below. */
    ...(request.kind === "spend" && review.to[0] ? [{ label: word("to"), value: review.to[0] }] : []),
    ...(claims ? [{ label: word("rowClaims"), value: `${claims.claims} · ${claimSources}` }] : []),
    ...(claims && claimHolding ? [{ label: word("rowClaimsHolding"), value: word("rowClaimsHoldingValue", { sum: claimHolding }) }] : []),
    ...(claims && claims.opens > 0 ? [{ label: word("rowClaimsOpensLabel"), value: word("rowClaimsOpens", { n: claims.opens }) }] : []),
    ...(claims && claims.unread > 0 ? [{ label: word("rowClaimsNotRead"), value: word("rowClaimsUnread", { n: claims.unread }), tone: "down" as const }] : []),
    ...(claims && claims.later > 0 ? [{ label: word(request.kind === "execute" ? "rowClaimsNextPress" : "rowClaimsNext"), value: word(request.kind === "execute" ? "rowClaimsNextRun" : "rowClaimsLater", { n: claims.later }) }] : []),
    ...(review.alsoApproves && request.kind !== "createAgent" ? [{ label: word("approve"), value: word("rowAlsoApproves") }] : []),
    ...(review.newTokenAccounts > 0
      ? [{ label: "USDC", value: BigInt(review.vaultRentLamports) > 0n ? word("rowNewAccountsVault", { n: review.newTokenAccounts, sum: lamports(review.vaultRentLamports) }) : word("rowNewAccounts", { n: review.newTokenAccounts }) }]
      : []),
    ...review.walletShortfall.map((row) => ({ label: word("wallet"), value: word("rowWalletShort", { sum: money(row.raw, row.asset, locale) }), tone: "down" as const })),
    ...review.shortfall.map((row) => ({ label: word("vaultAddress"), value: word("rowShortfall", { sum: money(row.raw, row.asset, locale) }), tone: "down" as const })),
    ...(held.build.unsignedWireBase64.length > 1 ? [{ label: word("sign"), value: word("rowTransactions", { n: held.build.unsignedWireBase64.length }) }] : []),
  ];
  /* Money the network would refuse it for: the action stays grey, and the line says why. */
  const blocked = review.blockedBy === "wallet" ? word("blockedWallet") : review.blockedBy === "vault" ? word("blockedVault") : undefined;
  const what =
    request.kind === "create"
      ? word("whatCreate")
      : request.kind === "createAgent"
        ? word("whatCreateAgent")
        : request.kind === "payouts"
          ? word("whatPayouts")
          : request.kind === "config"
            ? word("whatConfig")
            : request.kind === "vote"
              ? word("whatVote")
              : request.kind === "launchClaims"
              ? word("whatLaunchClaims")
            : request.kind === "execute"
                ? word("whatExecute")
                : request.kind === "deposit"
                  ? word("whatDeposit")
                  : word("whatSpend");
  const net = networkOf(network);
  /* A top-up is paid by the wallet; everything else that moves money moves it out of the vault. A «for» on payouts
     authorises them: what leaves once they run is said, never «nothing»; a limit made by a change is a standing mandate
     spent without a vote, said as such. */
  const limits = (review.changes ?? []).flatMap((change) => (change.type === "addLimit" ? [change] : []));
  const mandate =
    limits.length > 0 && (request.kind === "config" || request.kind === "execute" || (request.kind === "vote" && request.vote === "approve"))
      ? limits.map((limit) => word("payMandate", { amount: money(limit.amountRaw, limit.asset, locale), period: word(`period_${limit.period as "once" | "day" | "week" | "month"}`) })).join(" · ")
      : null;
  const pay =
    claims
      ? word("payClaims")
      : request.kind === "deposit" || request.kind === "payouts"
      ? outflow
      : mandate
        ? mandate
        : request.kind === "vote" && outflow
          ? request.vote === "approve"
            ? word("payAfterVote", { sum: outflow })
            : word("payNothing")
          : outflow && request.kind !== "config"
            ? word("payFromVault", { sum: outflow })
            : word("payNothing");
  /* Every address a change names, in full: a look-alike passes a shortened one. */
  const changeAddresses = (review.changes ?? []).flatMap((change) =>
    change.type === "addLimit" ? [...change.spenders, ...change.destinations] : change.type === "addMember" ? [change.member.address] : change.type === "removeMember" ? [change.address] : change.type === "rentCollector" && change.address ? [change.address] : change.type === "removeLimit" ? [change.limit] : [],
  );
  return (
    <Review
      className={styles.review}
      title={reviewTitle(review, request, locale)}
      titleAs="h2"
      pay={pay}
      get={get}
      costs={costs}
      costsTotal={lamports(network$ + rent + fee)}
      rows={rows}
      whatItIs={what}
      details={
        <dl className={styles.details}>
          <div>
            <dt>{word("detailMultisig")}</dt>
            <dd>
              <a className={styles.mono} href={explorerAddressUrl(net, review.multisig)} target="_blank" rel="noreferrer">
                {review.multisig}
              </a>
            </dd>
          </div>
          <div>
            <dt>{word("vaultAddress")}</dt>
            <dd className={styles.mono}>{review.vault}</dd>
          </div>
          <div>
            <dt>{word("detailProgram")}</dt>
            <dd className={styles.mono}>Squads v4 · {SQUADS_PROGRAM}</dd>
          </div>
          <div>
            <dt>{word("detailNetwork")}</dt>
            <dd>{network === "solana:devnet" ? "Solana Devnet" : "Solana"}</dd>
          </div>
          {changeAddresses.length > 0 ? (
            <div>
              <dt>{word("change")}</dt>
              <dd className={styles.mono}>
                {changeAddresses.map((address, index) => (
                  <span key={`${address}:${index}`} className={styles.recipient}>
                    {address}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {review.to.length > 0 && request.kind !== "spend" ? (
            <div>
              <dt>{word("to")}</dt>
              <dd className={styles.mono}>
                {review.to.map((address, index) => (
                  <span key={`${address}:${index}`} className={styles.recipient}>
                    {address}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      }
      signWith="wallet"
      ready={action.phase === "review" && !blocked}
      signing={action.phase === "sign" || action.phase === "send" || action.phase === "prepare"}
      blockedReason={action.phase === "sign" ? word("signing") : action.phase === "send" ? word("sending") : action.phase === "prepare" ? word("preparing") : blocked}
      risk={request.kind === "create" || request.kind === "config" ? word("risk") : undefined}
      /* Once the wallet is asked, cancelling here would not stop the send: only a Review not yet signed is cancelled. */
      onCancel={action.phase === "review" ? action.reset : undefined}
      onConfirm={() => void action.confirm()}
      lang={lang(locale)}
    />
  );
}

/** The core's receipt after a send: what happened, its signatures on the explorer. */
export function TreasuryReceiptCard({ action, locale, network, onOpen }: { action: TreasuryAction; locale: WorkspaceLocale; network: Chain; onOpen?: (multisig: string) => void }) {
  const word = treasuryWords(locale);
  const result = action.result;
  const held = action.held;
  if (!result) return null;
  const net = networkOf(network);
  const signature = result.signatures.at(-1) ?? result.pending[0] ?? result.failed[0]?.signature ?? "";
  const status = result.state === "CONFIRMED" ? "completed" : result.state === "PENDING" ? "pending" : "failed";
  const outflow = held?.build.review.outflow.map((row) => money(row.raw, row.asset, locale)).join(" · ") ?? "";
  const first = result.failed[0];
  return (
    <div className={styles.receiptWrap}>
      <CoreReceipt
        variant="full"
        title={word(`receiptTitle_${result.kind}`)}
        status={status}
        amount={result.kind === "vote" ? short(result.multisig) : outflow || short(result.multisig)}
        time={new Date(result.at).toLocaleString(locale === "uk" ? "uk-UA" : "en-GB")}
        network={network === "solana:devnet" ? "Solana Devnet" : "Solana"}
        transaction={signature ? short(signature) : undefined}
        reason={result.state === "PARTIAL" && first ? word("receiptPartial", { reason: FAILURE_WORDS[first.code]?.[locale] ?? word("failedUnknown") }) : undefined}
        onVerify={signature ? () => window.open(explorerTxUrl(net, signature), "_blank", "noopener") : undefined}
        lang={lang(locale)}
      />
      {/* The core's receipt says a reason only for a failure; a send still unconfirmed is said here. */}
      {result.state === "PENDING" ? <p className={styles.hint}>{word("receiptPending")}</p> : null}
      {/* Parts held behind one not yet confirmed were never sent from this build: said, with their count. */}
      {result.state === "PENDING" && result.failed.length > 0 ? (
        <p className={styles.hint}>{word("receiptHeld", { n: result.failed.length, m: result.failed.length + result.pending.length + result.signatures.length })}</p>
      ) : null}
      {result.state === "PARTIAL" && first ? <RawText text={first.reason} locale={locale} /> : null}
      <div className={styles.actionsRow}>
        {onOpen && (result.kind === "create" || result.kind === "createAgent") && result.state !== "PARTIAL" ? (
          <button type="button" className={styles.linkButton} onClick={() => onOpen(result.multisig)}>
            {word("openTreasury")}
          </button>
        ) : null}
        <button type="button" className={styles.linkButton} onClick={action.reset}>
          {word("done")}
        </button>
      </div>
    </div>
  );
}

/** The network's or the wallet's own words, behind a disclosure: for whoever needs them, not in the person's way. */
function RawText({ text, locale }: { text: string; locale: WorkspaceLocale }) {
  if (!text.trim()) return null;
  return (
    <details className={styles.raw}>
      <summary>{treasuryWords(locale)("details")}</summary>
      <p className={styles.mono}>{text}</p>
    </details>
  );
}

/** A failure in one line: the wallet's refusal, a broken rule, or what the network's refusal means. */
export function FailureLine({ action, locale }: { action: TreasuryAction; locale: WorkspaceLocale }) {
  const word = treasuryWords(locale);
  const failure = action.failure;
  if (!failure) return null;
  const known = FAILURE_WORDS[failure.code]?.[locale];
  /* An outcome not known is not a failure: said as it is, without «not done», in the colour of something pending. */
  const unknownOutcome = failure.code === "TREASURY_SUBMIT_UNKNOWN" || failure.code === "REVIEW_CHANGED";
  const text = failure.code === "WALLET_REFUSED" ? word("refused") : unknownOutcome && known ? known : known ? word("failed", { reason: known }) : word("failedUnknown");
  return (
    <div className={unknownOutcome ? styles.pendingLine : styles.failure} role={unknownOutcome ? "status" : "alert"}>
      <p>{text}</p>
      <RawText text={failure.message} locale={locale} />
      {failure.issues?.length ? (
        <ul className={styles.issues}>
          {failure.issues.slice(0, 6).map((issue, index) => (
            <li key={`${issue.code}:${index}`}>{issueWord(locale, issue)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
