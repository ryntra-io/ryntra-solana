"use client";

import { ArrowSquareOut, CaretDown, CheckCircle, CircleNotch, ImageSquare, Lock, LockOpen, Trash, Users, Warning } from "@phosphor-icons/react";
import { Block, Button, Page, Review } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import { useOptionalWalletData } from "@/app/app/wallet-data";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletFact, useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type {
  LaunchAdvancedConfigBuildResponse,
  LaunchAdvancedConfigSubmitResponse,
  LaunchBoostBuildResponse,
  LaunchBoostSubmitResponse,
  LaunchBuildResponse,
  LaunchEarlyAccessBuildResponse,
  LaunchEarlyAccessSubmitResponse,
  LaunchMetadataResponse,
  LaunchPresetsResponse,
  LaunchPresetView,
  LaunchQuoteResponse,
  LaunchSubmitResponse,
  LaunchTokenResponse,
} from "@/lib/api/v1/contract";
import { advancedPreset } from "@/lib/core/launch/advanced";
import { earlyAccessRuleLines } from "@/lib/core/launch/early-access";
import { FEE_SHARE_MAX_RECIPIENTS, FEE_SHARE_MIN_BPS, FEE_SHARE_TOTAL_BPS, withCreatorShare } from "@/lib/core/launch/fee-shares";
import { presetTerms, termsOf, type PresetTerms } from "@/lib/core/launch/preset-terms";
import { TRANSFER_FEE_NEW_RATE_EPOCHS, transferFeeOn } from "@/lib/core/launch/transfer-fee";
import type { PartnerView } from "@/lib/growth/partner";
import { checkLaunchForm, type FieldProblem, type LaunchFormFields } from "@/lib/launch/form";
import { clearHomeDraft, readHomeDraft } from "@/lib/launch/home-draft";
import { shrinkPicture, type Picture } from "@/lib/launch/picture.client";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransactions, walletSignsV1 } from "@/lib/solana/wallet.client";

import { coreLang, LinkButton } from "../launch-blocks";
import { formatBps, formatDate, formatDuration, formatNumber, formatPercent, formatRaw, fromRaw, shortAddress, toRaw } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";
import { PausedChip, PausedNote } from "../paused-note";
import { EARLY_DRAFT, EarlyAccessFields, earlyProblems, earlyRulesOfDraft, type EarlyDraft } from "./early-access-fields";
import { ADVANCED_DRAFT, BOOST_DRAFT, FormatsSection, advancedPresetView, boostRulesOfDraft, choiceOfDraft, formatsHold, type AdvancedDraft, type BoostDraft } from "./formats-section";
import { ShareLink } from "../share-link";
import { MissionStart, startState, useSecond, windowWords, type CrewView } from "./mission-start";
import { crewOpenOn, isCrewPreset, partWords } from "@/lib/core/launch/crew";
import { tMinus, windowClock } from "@/lib/core/launch/windows";
import { ADVANCED_CONFIG_ESTIMATE_SOL, ceilToDigits, firstBuyFeeRaw, fundsOf, maxFirstBuyRaw, networkEstimateSol, reviewLamports, shortfallOf, type Balance } from "./launch-costs";

/**
 * «Запустити токен». Drawn for 390 px first: one column of four short
 * sections — the token, its links, the preset, the creator's first buy — and
 * one orange action. On a desk the token's card, as others will see it, stays
 * beside the form with what the signature will do.
 *
 * The page never decides for the creator: it checks the form by the same
 * rules the server applies, quotes the first buy on the fresh curve, and asks
 * the wallet to sign what the server built. A refusal says what to change.
 */

type Phase = "form" | "prepare" | "sign" | "send" | "done" | "error";
type Quote = Readonly<{ amountRaw: string; data: LaunchQuoteResponse | null; loading: boolean }>;
/** Another wallet sharing the creator's fees, as typed: its address and its share in per cent. */
type ShareRow = Readonly<{ key: number; address: string; pct: string }>;
type ShareProblem = "ADDRESS" | "REPEATED" | "SELF" | "PCT";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A share typed in per cent, as whole basis points; null when it is not one. */
function pctToBps(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Each row's problem, and what the creator keeps — the rule the server checks again. */
function checkShares(rows: readonly ShareRow[], creator: string | null): Readonly<{ problems: ReadonlyMap<number, ShareProblem>; creatorBps: number }> {
  const problems = new Map<number, ShareProblem>();
  const seen = new Set<string>();
  let given = 0;
  for (const row of rows) {
    const address = row.address.trim();
    const bps = pctToBps(row.pct);
    if (!BASE58.test(address)) problems.set(row.key, "ADDRESS");
    else if (creator && address === creator) problems.set(row.key, "SELF");
    else if (seen.has(address)) problems.set(row.key, "REPEATED");
    else if (bps === null || bps < FEE_SHARE_MIN_BPS || bps > FEE_SHARE_TOTAL_BPS - FEE_SHARE_MIN_BPS) problems.set(row.key, "PCT");
    seen.add(address);
    given += bps ?? 0;
  }
  return { problems, creatorBps: FEE_SHARE_TOTAL_BPS - given };
}

const EMPTY: LaunchFormFields = { name: "", symbol: "", description: "", website: "", x: "", telegram: "" };
/* The contract this page reads: since 1.50.0 a busy hour is `LAUNCH_BUSY`, not a pause; since 1.73.0 a changed pair
   currency is `LAUNCH_QUOTE_PAUSED` (`launchFailureCode`). */
const API_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1", "X-Ryntra-API-Version": "1.73.0" } as const;
/** A build whose partner is not the one the review showed: nothing is signed, the line says so. */
const PARTNER_CHANGED = "PARTNER_CHANGED";
const SUPPLY_RAW = 1_000_000_000n * 1_000_000n;

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  try {
    const response = await fetch(path, { ...init, headers: { ...API_HEADERS, ...(init?.headers ?? {}) } });
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!response.ok) return { ok: false, code: body?.error?.code ?? "UNAVAILABLE", message: body?.error?.message ?? "" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

export function LaunchFlow({
  locale,
  presets,
  paused = null,
  initialPreset = null,
  peopleServed = false,
}: {
  locale: WorkspaceLocale;
  presets: LaunchPresetsResponse;
  paused?: "all" | "launching" | null;
  /** The preset the page opens on — the demo market's own address names it. */
  initialPreset?: string | null;
  /** Ryntra's executor claims the budget and keeps the ladder on people's Micro markets here now (SOL-L6). */
  peopleServed?: boolean;
}) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  /* The wallet's SOL and pair, read once for the header and Home — mainnet's, so a devnet stand says nothing of them. */
  const walletData = useOptionalWalletData();
  /* The balance is read again when the review opens and whenever the person comes back to this tab — from «Top up»,
     Phantom or an exchange — so a wallet funded meanwhile is not held back by the read made before (UX-402). */
  const refreshWallet = useRef<(() => void) | null>(null);
  useEffect(() => {
    refreshWallet.current = walletData?.refresh ?? null;
  });
  const [step, setStep] = useState<Step>("token");
  const [fields, setFields] = useState<LaunchFormFields>(EMPTY);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [pictureBad, setPictureBad] = useState(false);
  /* «Захищений» first where the network has it: the plan's default against snipers. */
  const [presetId, setPresetId] = useState(presets.presets.find((entry) => entry.id === initialPreset)?.id ?? presets.presets.find((entry) => entry.id === "protected")?.id ?? presets.presets[0]?.id ?? "classic");
  const [buyText, setBuyText] = useState("");
  const [lockId, setLockId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [many, setMany] = useState(false);
  const [manyWithSplit, setManyWithSplit] = useState(false);
  /* The launch was built a second time: the first signature came back after the bytes had aged (AG-1). */
  const [again, setAgain] = useState(false);
  const [covered, setCovered] = useState<string | null>(null);
  /* «Розширений»'s config build's own cost, for the choice it was built for — never the launch's (SOL-C10). */
  const [configCovered, setConfigCovered] = useState<Readonly<{ key: string; lamports: string }> | null>(null);
  const [result, setResult] = useState<{ submit: LaunchSubmitResponse; token: LaunchTokenResponse | null; symbol: string; image: string | null } | null>(null);
  const [quote, setQuote] = useState<Quote>({ amountRaw: "0", data: null, loading: false });
  const [shares, setShares] = useState<readonly ShareRow[]>([]);
  /* MC-2: the start — now or a launch window — and the crew, made here with each member's own yes. */
  const [windowId, setWindowId] = useState<string | null>(null);
  const [crewOn, setCrewOn] = useState(false);
  const [crew, setCrew] = useState<CrewView | null>(null);
  /* «Розширені параметри» (SOL-L5): the community token, «Розширений»'s own numbers and the config made for them, Launch Boost. */
  const [communityMint, setCommunityMint] = useState<string | null>(presets.communities?.[0]?.mint ?? null);
  const [advancedOn, setAdvancedOn] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedDraft>(ADVANCED_DRAFT);
  const [madeConfig, setMadeConfig] = useState<Readonly<{ config: string; key: string }> | null>(null);
  const [boostOn, setBoostOn] = useState(false);
  const [boostDraft, setBoostDraft] = useState<BoostDraft>(BOOST_DRAFT);
  /* «Ранній доступ»: a launch of its own kind — no curve; its pool and vault are made instead (SOL-L5). */
  const [earlyOn, setEarlyOn] = useState(false);
  const [earlyDraft, setEarlyDraft] = useState<EarlyDraft>(EARLY_DRAFT);
  const [earlyResult, setEarlyResult] = useState<LaunchEarlyAccessSubmitResponse | null>(null);
  const [nextShareKey, setNextShareKey] = useState(1);
  /* The creator's partner: what the review offers, or the code put in its place, or none. */
  const [partnerChoice, setPartnerChoice] = useState<"offered" | "none" | Readonly<{ code: string }>>("offered");
  const [partner, setPartner] = useState<PartnerView>(null);
  const [partnerProblem, setPartnerProblem] = useState<"UNKNOWN" | "SELF" | "CHANGED" | "UNCHECKED" | null>(null);
  const [partnerEditing, setPartnerEditing] = useState(false);
  const [partnerText, setPartnerText] = useState("");
  /* The launch dock on the home page hands the token over in this tab (`lib/launch/home-draft.ts`): read on arrival from
     it, and kept for Back and Forward until the launch is sent or started over. */
  const [fromHome, setFromHome] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("from") !== "home") return;
    const draft = readHomeDraft();
    if (!draft) return;
    setFields((current) => ({ ...current, name: draft.name, symbol: draft.symbol }));
    if (draft.picture) setPicture(draft.picture);
    setFromHome(true);
  }, []);
  /* Who invited this wallet and its earlier launches are read only for its proven owner; without the proof the line
     shows what the browser carries from a link, and offers to confirm the wallet. */
  const proof = useWalletProof();
  const walletFact = useWalletFact();
  const proven = proof.state.status === "proven";
  /* Once a launch is being built, a late answer of the review's read must not change what is about to be signed. */
  const building = useRef(false);
  /* What the line shows right now — the build is compared with this, never with a value an older render captured. */
  const shownPartner = useRef<PartnerView>(null);
  const firstError = useRef<HTMLElement | null>(null);

  const picked = presets.presets.find((entry) => entry.id === presetId) ?? presets.presets[0];
  /* «Розширений»: the creator's own numbers in the shape of a preset — Захищений's pair, the choice's numbers. */
  const advancedBounds = presets.formats?.advanced?.bounds ?? null;
  const advancedChoice = useMemo(() => choiceOfDraft(advancedDraft), [advancedDraft]);
  const advancedBase = presets.presets.find((entry) => entry.id === "protected") ?? picked;
  const advancing = advancedOn && advancedBounds !== null && advancedBase !== undefined;
  const preset = advancing ? advancedPresetView(advancedChoice, advancedBounds, advancedBase) : picked;
  /* SOL-L10: a token with a fee on transfers — the creator's lock is not offered on it until Met Lock is proven with the fee. */
  const feeOnTransfers = advancing && advancedChoice.transferFeeBps !== undefined;
  const terms = !preset ? null : advancing ? termsOf(advancedPreset(advancedChoice, advancedBounds)) : presetTerms(preset.id, { peopleServed });
  /* «Спільнота»'s community token, when the network offers more than one; its pair is the preset's otherwise. */
  const community = preset?.id === "community" ? (presets.communities ?? []).find((entry) => entry.mint === communityMint) ?? null : null;
  const pair = community ? { mint: community.mint, symbol: community.symbol, decimals: community.decimals } : (preset?.pair ?? { mint: "", symbol: "USDC", decimals: 6 });
  const supplyRaw = advancing ? BigInt(advancedChoice.supply) * 1_000_000n : SUPPLY_RAW;
  const check = useMemo(() => checkLaunchForm(fields), [fields]);
  const buyRaw = preset ? toRaw(buyText, pair.decimals) : null;
  const buying = buyRaw !== null && buyRaw > 0n;

  /* The first buy quoted on the fresh curve: the tokens it gets and the most it may spend. */
  const quotedId = preset?.id ?? null;
  useEffect(() => {
    /* Paused: nothing can be built, so nothing is quoted either. */
    if (!quotedId || buyRaw === null || paused) return;
    /* «Розширений» is quoted on its own config, which exists only after its first signature; until then the build checks the cap. */
    if (quotedId === "advanced" && !madeConfig) {
      setQuote({ amountRaw: buyRaw.toString(), data: null, loading: false });
      return;
    }
    const amountRaw = buyRaw.toString();
    const named = quotedId === "community" && communityMint ? { pairMint: communityMint } : quotedId === "advanced" && madeConfig ? { advancedConfig: madeConfig.config } : {};
    setQuote((current) => ({ amountRaw, data: current.data?.preset === quotedId ? current.data : null, loading: true }));
    const timer = window.setTimeout(async () => {
      const read = await api<LaunchQuoteResponse>("/api/v1/launch/quote", { method: "POST", body: JSON.stringify({ preset: quotedId, amountRaw, ...named }) });
      setQuote((current) => (current.amountRaw === amountRaw ? { amountRaw, data: read.ok ? read.data : null, loading: false } : current));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [quotedId, buyRaw, paused, communityMint, madeConfig]);

  /* «Invited by»: read again when the wallet or the creator's choice changes; nothing is written before the signature. */
  const creatorAddress = connection?.address ?? null;
  useEffect(() => {
    /* While a launch is built and signed the line shows what the build will bind; no read touches it. */
    if (building.current) return;
    if (!creatorAddress || paused || partnerChoice === "none") {
      setPartner(null);
      return;
    }
    let live = true;
    const code = typeof partnerChoice === "object" ? `&code=${encodeURIComponent(partnerChoice.code)}` : "";
    void fetch(`/api/growth/partner?network=solana&creator=${encodeURIComponent(creatorAddress)}${code}`, { headers: API_HEADERS })
      .then((response) => response.json())
      .then((body: { ok?: boolean; partner?: PartnerView; code?: string }) => {
        if (!live || building.current) return;
        /* The reason a code was refused stays until the creator's next choice, not until the next read. */
        if (body.ok) {
          setPartner(body.partner ?? null);
          return;
        }
        /* A code that cannot be checked now is not a verdict on it: the choice stays, and the line says so. */
        if (body.code === "UNAVAILABLE") {
          setPartnerProblem("UNCHECKED");
          return;
        }
        if (body.code !== "UNKNOWN_CODE" && body.code !== "SELF_REFERRAL") return;
        /* A code that cannot be used goes back to what was offered, and says why. */
        setPartnerProblem(body.code === "SELF_REFERRAL" ? "SELF" : "UNKNOWN");
        setPartnerChoice("offered");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [creatorAddress, partnerChoice, paused, proven]);
  useEffect(() => {
    if (phase === "form" || phase === "error" || phase === "done") building.current = false;
  }, [phase]);
  useEffect(() => {
    shownPartner.current = partner;
  }, [partner]);

  useEffect(() => {
    if (step !== "review") return;
    /* At most once in 15 s: the wallet's own window closing and every return to the tab are focus too. */
    let last = Date.now();
    refreshWallet.current?.();
    const again = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 15_000) return;
      last = Date.now();
      refreshWallet.current?.();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [step]);

  /* The launch build's simulated cost holds for the inputs it was built from: any change and the review says the estimate again. */
  const coveredFor = JSON.stringify([presetId, advancedOn, advancedDraft, lockId, buyText, shares, communityMint, earlyOn, earlyDraft]);
  useEffect(() => {
    setCovered(null);
  }, [coveredFor]);

  /* A preset whose first purchase is always locked offers only the schedules long enough, and the lock is on. */
  const lockMinDays = preset?.creatorLockMinDays ?? null;
  const lockChoices = lockMinDays === null ? presets.locks : presets.locks.filter((entry) => entry.cliffDays >= lockMinDays);
  /* MC-1: on Micro and the demo market the purchase and its lock are one v1 transaction — said here, before anything is uploaded, when the wallet does not sign v1. */
  const v1Blocked = buying && lockMinDays !== null && connection !== null && !walletSignsV1(connection.wallet);
  useEffect(() => {
    if (!buying || feeOnTransfers) setLockId(null);
    else if (lockMinDays !== null && !lockChoices.some((entry) => entry.id === lockId)) setLockId(lockChoices[0]?.id ?? null);
  }, [buying, lockMinDays, lockChoices, lockId, feeOnTransfers]);

  const set = (key: keyof LaunchFormFields) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((current) => ({ ...current, [key]: event.target.value }));

  const choosePicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const shrunk = await shrinkPicture(file);
    setPictureBad(!shrunk);
    if (shrunk) setPicture(shrunk);
  };

  const quoteData = quote.data && quote.data.amountInRaw === (buyRaw ?? 0n).toString() ? quote.data : null;
  const aboveCap = Boolean(buying && quoteData && !quoteData.withinCap);
  const problemOf = (key: keyof LaunchFormFields): FieldProblem | undefined => check.problems[key];
  /* A token handed over whole opens on the market's rules — its first step was the dock; one still missing something
     stays on the token, with what to fix marked. */
  useEffect(() => {
    if (!fromHome) return;
    setFromHome(false);
    if (TOKEN_FIELDS.every((key) => !check.problems[key]) && picture !== null) setStep("rules");
    else setAttempted(true);
  }, [fromHome, check, picture]);
  const shown = (key: keyof LaunchFormFields) => {
    const problem = problemOf(key);
    if (!problem) return undefined;
    /* A borrowed name is said at once; an empty field only after the first press. */
    if (problem === "BORROWED" || problem === "OFFENSIVE" || problem === "TOO_LONG" || problem === "SYMBOL_CHARS") return problem;
    if (problem === "LINK" && fields[key].trim()) return problem;
    return attempted ? problem : undefined;
  };
  const problemText = (key: keyof LaunchFormFields, problem: FieldProblem) => {
    if (problem === "BORROWED") return word("errBorrowed", { label: check.hits.find((hit) => hit.field === key)?.label ?? "" });
    if (problem === "OFFENSIVE") return word("errOffensive");
    if (problem === "REQUIRED") return word("errRequired");
    if (problem === "TOO_LONG") return word("errTooLong");
    if (problem === "SYMBOL_CHARS") return word("errSymbolChars");
    return word(key === "x" ? "errLinkX" : key === "telegram" ? "errLinkTelegram" : "errLink");
  };
  /* MC-2: a crew flies where crews are open, on Classic and Protected. */
  const crewAllowed = crewOpenOn(presets.network === "solana:devnet" ? "devnet" : "mainnet");
  const crewWanted = crewAllowed && crewOn && isCrewPreset(preset?.id ?? "") && !earlyOn && !advancedOn;
  const crewAboard = crew ? crew.members.filter((member) => member.state === "ACCEPTED") : [];
  const crewMatches = crew !== null && crew.token === null && !crew.expired && crew.symbol === check.clean.symbol && crew.preset === preset?.id;
  const crewUsed = crewWanted && crewMatches && crewAboard.length > 0 ? crew : null;
  const crewBlocked = crewWanted && crewUsed === null;
  const startNow = useSecond(windowId !== null);
  const start = startState(windowId, startNow);
  const startBlocked = windowId !== null && start?.state !== "open";
  /* «Спільнота» alone shares the creator's fees; another preset sends none. */
  const sharing = preset?.id === "community" && shares.length > 0;
  const shareCheck = useMemo(() => checkShares(shares, connection?.address ?? null), [shares, connection?.address]);
  const sharesValid = !sharing || (shareCheck.problems.size === 0 && shareCheck.creatorBps >= FEE_SHARE_MIN_BPS);
  const earlyValid = !earlyOn || (earlyProblems(presets, earlyDraft)?.length ?? 1) === 0;
  const formatsValid = earlyOn ? earlyValid : formatsHold(presets, advancedOn, advancedDraft, boostOn, boostDraft, pair.decimals);
  const valid = Object.keys(check.problems).length === 0 && picture !== null && (earlyOn || (buyRaw !== null && !aboveCap && sharesValid && !v1Blocked)) && formatsValid;

  const launch = useCallback(async () => {
    /* One launch at a time: a second press while the wallet asks for the sign-in must not build a second launch. A code
       typed but not applied is not the partner the review shows: nothing is built until it is applied or closed. */
    if (building.current || partnerEditing) return;
    setAttempted(true);
    if (!valid || !preset) {
      window.requestAnimationFrame(() => firstError.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    if (!connection) {
      reach();
      return;
    }
    setFailure(null);
    /* The offered partner is read from the creator's own history, which only their proven wallet may see: one free
       sign-in signature first, so the launch binds the partner that is really theirs. Declined or impossible, the launch
       still goes — with the link's code alone, shown before anything is signed. */
    building.current = true;
    /* Busy from here: nothing on the form changes while the wallet asks for the sign-in. */
    setPartnerEditing(false);
    setPhase("prepare");
    /* Asked on its own only when the answer is known and it changes nobody's account: no sign-in at all, or one by
       another door. Someone signed in with another wallet keeps their account — they can still press «Confirm wallet». */
    const otherWallet = walletFact.signedIn && walletFact.walletAddress !== null && walletFact.walletAddress !== connection.address;
    if (presets.network === "solana:mainnet" && partnerChoice === "offered" && !proof.canAct && walletFact.status === "known" && !otherWallet) await proof.act().catch(() => false);
    const failed = (step: "before" | "send", answer: Readonly<{ code: string; message: string }>) => {
      setFailure({ step, code: answer.code, detail: answer.message || null, token: null });
      setPhase("error");
    };
    const metadata = await api<LaunchMetadataResponse>("/api/v1/launch/metadata", { method: "POST", body: JSON.stringify({ ...fields, imageBase64: picture?.base64 ?? "" }) });
    if (!metadata.ok) return failed("before", metadata);
    /* «Ранній доступ»: three transactions — the mint, the locked pool, the vault — signed in one window, sent in order. */
    if (earlyOn) {
      const rules = earlyRulesOfDraft(earlyDraft, Math.floor(Date.now() / 1000));
      if (!rules) return failed("before", { code: "VALIDATION_ERROR", message: "" });
      const early = await signFreshBytes({
        build: () => api<LaunchEarlyAccessBuildResponse>("/api/v1/launch/early-access/build", { method: "POST", body: JSON.stringify({ creator: connection.address, metadataUri: metadata.data.metadataUri, rules }) }),
        signableMsOf: (data) => data.signableMs,
        sign: async (data) => {
          setMany(true);
          setPhase("sign");
          const answer = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: data.unsignedWireBase64, chain: data.network });
          return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
        },
      });
      if (!early.ok) return failed("before", early.stage === "build" ? early.failure : early.stage === "sign" ? { code: "WALLET_REFUSED", message: early.reason } : { code: "LAUNCH_BUILD_EXPIRED", message: "" });
      setPhase("send");
      const sentEarly = await api<LaunchEarlyAccessSubmitResponse>("/api/v1/launch/early-access/submit", {
        method: "POST",
        body: JSON.stringify({ buildId: early.built.buildId, creator: connection.address, signedWireBase64: early.signed }),
      });
      if (!sentEarly.ok) {
        setFailure({ step: "send", code: sentEarly.code, detail: sentEarly.message || null, token: early.built.mint });
        setPhase("error");
        return;
      }
      setEarlyResult(sentEarly.data);
      clearHomeDraft();
      setPhase("done");
      return;
    }
    /* «Розширений»: the launch's own config first, its own signature — once per choice; the launch goes on it after. */
    let advancedConfig: string | null = null;
    if (preset.id === "advanced") {
      const key = JSON.stringify(advancedChoice);
      if (madeConfig && madeConfig.key === key) advancedConfig = madeConfig.config;
      else {
        setPhase("prepare");
        /* Signed while its bytes live, built again when they aged in the wallet. */
        const config = await signFreshBytes({
          build: () => api<LaunchAdvancedConfigBuildResponse>("/api/v1/launch/advanced/config/build", { method: "POST", body: JSON.stringify({ creator: connection.address, choice: advancedChoice }) }),
          signableMsOf: (data) => data.signableMs,
          sign: async (data) => {
            setPhase("sign");
            setMany(false);
            if (data.creatorCostLamports) setConfigCovered({ key, lamports: data.creatorCostLamports });
            const answer = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [data.unsignedWireBase64], chain: data.network });
            return answer.ok ? { ok: true, value: answer.signedWireBase64[0]! } : answer;
          },
        });
        if (!config.ok) return failed("before", config.stage === "build" ? config.failure : config.stage === "sign" ? { code: "WALLET_REFUSED", message: config.reason } : { code: "LAUNCH_BUILD_EXPIRED", message: "" });
        setPhase("send");
        const made = await api<LaunchAdvancedConfigSubmitResponse>("/api/v1/launch/advanced/config/submit", {
          method: "POST",
          body: JSON.stringify({ buildId: config.built.buildId, creator: connection.address, signedWireBase64: config.signed }),
        });
        if (!made.ok) return failed("before", made);
        advancedConfig = made.data.config;
        setMadeConfig({ config: made.data.config, key });
      }
    }
    const wiresOf = (data: LaunchBuildResponse) => [data.unsignedWireBase64, ...(data.lockUnsignedWireBase64 ? [data.lockUnsignedWireBase64] : []), ...(data.splitUnsignedWireBase64 ? [data.splitUnsignedWireBase64] : [])];
    setAgain(false);
    /*
     * The launch's bytes live ~30 s, less a margin for each transaction after the creation (`lib/solana/blockhash-life.ts`).
     * A signature that comes back later is not sent: the launch is built again and the wallet asked once more — only
     * when the first purchase still gets at least what it did.
     */
    let first: LaunchBuildResponse | null = null;
    const fresh = await signFreshBytes({
      build: async () => {
        setPhase("prepare");
        const answer = await api<LaunchBuildResponse>("/api/v1/launch/build", {
          method: "POST",
          body: JSON.stringify({
            creator: connection.address,
            preset: preset.id,
            metadataUri: metadata.data.metadataUri,
            firstBuyRaw: (buyRaw ?? 0n).toString(),
            lock: buying && !feeOnTransfers ? lockId : null,
            ...(sharing ? { feeShares: withCreatorShare(connection.address, shares.map((row) => ({ address: row.address.trim(), bps: pctToBps(row.pct) ?? 0 }))) } : {}),
            ...(preset.id === "community" && community ? { pairMint: community.mint } : {}),
            ...(advancedConfig ? { advancedConfig } : {}),
            /* MC-2: the crew's rows are read on the server from its record — only its id goes. */
            ...(crewUsed ? { crew: crewUsed.id } : {}),
            /* MC-1: on Micro and the demo market the purchase and its lock are one v1 transaction — asked for where the wallet signs v1. */
            ...(buying && preset.creatorLockMinDays !== null && walletSignsV1(connection.wallet) ? { format: "v1" as const } : {}),
            partner: partnerChoice,
          }),
        });
        if (!answer.ok) return answer;
        /* The build is what the signature binds, and it is what the line shows while the wallet asks. A partner other than
           the one the line showed — the proof or the link changed since it was read — is shown first, and nothing is
           signed until the creator presses again. */
        const builtPartner = answer.data.partner ?? null;
        const changed = answer.data.partner !== undefined && (builtPartner?.partnerMasked ?? null) !== (shownPartner.current?.partnerMasked ?? null);
        if (answer.data.partner !== undefined) {
          shownPartner.current = builtPartner;
          setPartner(builtPartner);
        }
        if (changed) return { ok: false as const, code: PARTNER_CHANGED, message: "" };
        if (first && BigInt(answer.data.firstBuyOutRaw) < BigInt(first.firstBuyOutRaw)) return { ok: false as const, code: "LAUNCH_QUOTE_MOVED", message: "" };
        first ??= answer.data;
        return answer;
      },
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        const wires = wiresOf(data);
        setMany(wires.length > 1);
        setManyWithSplit(Boolean(data.splitUnsignedWireBase64));
        setCovered(data.creatorCostLamports);
        setPhase("sign");
        const answer = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wires, chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
      },
      onRebuild: (why) => setAgain(why === "late"),
    });
    if (!fresh.ok) {
      if (fresh.stage === "build" && fresh.failure.code === PARTNER_CHANGED) {
        setPartnerProblem("CHANGED");
        setPhase("form");
        return;
      }
      if (fresh.stage === "build") return failed("before", fresh.failure);
      if (fresh.stage === "sign") return failed("before", { code: "WALLET_REFUSED", message: fresh.reason });
      return failed("before", { code: "LAUNCH_BUILD_EXPIRED", message: "" });
    }
    const built = { data: fresh.built };
    if (partnerProblem === "CHANGED") setPartnerProblem(null);
    const lockWire = built.data.lockUnsignedWireBase64 ?? null;
    const splitWire = built.data.splitUnsignedWireBase64 ?? null;
    const signed = { signedWireBase64: fresh.signed };
    setPhase("send");
    const submitted = await api<LaunchSubmitResponse>("/api/v1/launch/submit", {
      method: "POST",
      body: JSON.stringify({
        buildId: built.data.buildId,
        creator: connection.address,
        signedWireBase64: signed.signedWireBase64[0],
        signedLockWireBase64: lockWire ? (signed.signedWireBase64[1] ?? null) : null,
        signedSplitWireBase64: splitWire ? (signed.signedWireBase64[lockWire ? 2 : 1] ?? null) : null,
      }),
    });
    if (!submitted.ok) {
      setFailure({ step: "send", code: submitted.code, detail: submitted.message || null, token: built.data.token });
      setPhase("error");
      return;
    }
    const token = await api<LaunchTokenResponse>(`/api/v1/launch/${submitted.data.token}`);
    setResult({ submit: submitted.data, token: token.ok ? token.data : null, symbol: metadata.data.symbol, image: picture?.url ?? metadata.data.imageUrl });
    clearHomeDraft();
    /* One config, one launch: the next launch with the same numbers makes its own. */
    if (preset.id === "advanced") setMadeConfig(null);
    setPhase("done");
  }, [valid, preset, connection, reach, fields, picture, buyRaw, buying, lockId, feeOnTransfers, sharing, shares, partnerChoice, partnerEditing, partnerProblem, presets.network, proof, walletFact, advancedChoice, madeConfig, community, earlyOn, earlyDraft, crewUsed]);

  const reset = () => {
    clearHomeDraft();
    setFields(EMPTY);
    setPicture(null);
    setBuyText("");
    setLockId(null);
    setShares([]);
    setAttempted(false);
    setResult(null);
    setCovered(null);
    setConfigCovered(null);
    setPhase("form");
    setStep("token");
  };

  if (!preset) return null;
  firstError.current = null;
  const errorRef = (problem: unknown) => (element: HTMLElement | null) => {
    if (problem && element && !firstError.current) firstError.current = element;
  };

  if (phase === "done" && earlyResult) return <EarlySuccess locale={locale} result={earlyResult} symbol={check.clean.symbol} onAnother={() => { setEarlyResult(null); reset(); }} />;
  if (phase === "done" && result) return <Success locale={locale} result={result} onAnother={reset} boost={boostOn && connection ? { draft: boostDraft, pair, connection } : null} />;

  const busy = phase === "prepare" || phase === "sign" || phase === "send";
  const lock = presets.locks.find((entry) => entry.id === lockId) ?? null;
  const locked = busy || paused !== null;
  /* A step is done when everything in it is right; the review can be opened only through them. */
  const tokenDone = TOKEN_FIELDS.every((key) => !problemOf(key)) && picture !== null;
  const rulesDone = (earlyOn || (buyRaw !== null && !aboveCap && sharesValid)) && formatsValid;
  /* The first field to fix, scrolled to and focused — its own field, or the step itself when it has none. */
  const showFirstError = () => {
    const target = firstError.current;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    const field = target?.querySelector<HTMLElement>("input, textarea, button") ?? null;
    (field ?? document.getElementById("launch-step-body"))?.focus({ preventScroll: true });
  };
  const go = (next: Step) => {
    if (next === "rules" && !tokenDone) {
      setAttempted(true);
      window.requestAnimationFrame(() => showFirstError());
      return;
    }
    if (next === "review" && (!tokenDone || !rulesDone)) {
      setAttempted(true);
      if (!tokenDone) setStep("token");
      window.requestAnimationFrame(() => showFirstError());
      return;
    }
    setStep(next);
    /* The pressed button leaves with its step: the keyboard and a screen reader land on the new step, which names itself. */
    window.requestAnimationFrame(() => {
      document.getElementById("launch-steps")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("launch-step-body")?.focus({ preventScroll: true });
    });
  };
  /* Every cost as a number and their sum (UX-400): the network's in SOL — «Розширений»'s config until it is made —,
     the first buy's trading fee in the pair, out of the first buy's amount. */
  const estimateSol = networkEstimateSol({ sharing, locked: Boolean(lockId && buying) });
  /* The config for this very choice is still to be signed: a made one for other numbers is made again by the launch. */
  const choiceKey = JSON.stringify(advancedChoice);
  const configPending = preset.id === "advanced" && !earlyOn && !(madeConfig && madeConfig.key === choiceKey);
  const sol = reviewLamports({ estimateSol, launchLamports: covered, configPending, configLamports: configCovered?.key === choiceKey ? configCovered.lamports : null });
  const rent = covered ? word("reviewRentExact", { sol: fromRaw(covered, 9, 6) }) : word("reviewRentValue", { sol: estimateSol });
  const configText = configPending ? (configCovered?.key === choiceKey ? word("reviewRentExact", { sol: fromRaw(sol.config, 9, 6) }) : word("reviewRentValue", { sol: ADVANCED_CONFIG_ESTIMATE_SOL })) : null;
  const feeRaw = buying && buyRaw !== null && !earlyOn ? firstBuyFeeRaw(buyRaw, terms?.curve.baseFeeBps ?? 0) : 0n;
  const feeText = `${pairAmount(feeRaw, pair.decimals, locale)} ${pair.symbol}`;
  const costsTotal = feeRaw > 0n
    ? word(sol.exact ? "reviewTotalExactWithFee" : "reviewTotalWithFee", { sol: solFigure(sol.total), fee: feeText })
    : word(sol.exact ? "reviewTotalExact" : "reviewTotal", { sol: solFigure(sol.total) });
  /* What the wallet holds, and what it lacks for the launch (UX-402): a balance not read is «—» and blocks nothing. */
  const funds = fundsOf(connection && presets.network === "solana:mainnet" && walletData?.owner === connection.address ? walletData.holdings : null, pair.mint);
  const fundsShown = Boolean(connection) && presets.network === "solana:mainnet" && !earlyOn;
  const short = fundsShown ? shortfallOf(funds, { solLamports: sol.total, pairRaw: buying && buyRaw !== null ? buyRaw : 0n }) : null;
  const balanceText = (balance: Balance, decimals: number, symbol: string, digits: number) => (balance.read ? `${formatRaw(balance.raw, decimals, locale, digits)} ${symbol}` : `— ${symbol}`);
  const quoted = buying && quoteData && BigInt(quoteData.tokensOutRaw) > 0n ? quoteData.tokensOutRaw : null;
  /* «Комісія за переказ» (SOL-L10): «Розширений» with a rate — the curve's quote is what leaves it, the wallet gets it less the fee. */
  const transferFeeBps = preset?.id === "advanced" && advancedChoice.transferFeeBps !== undefined && Number.isInteger(advancedChoice.transferFeeBps) ? advancedChoice.transferFeeBps : null;
  const quotedNet = quoted && transferFeeBps ? transferFeeOn(BigInt(quoted), transferFeeBps).netRaw.toString() : quoted;

  return (
    <Page
      kind="action"
      className={styles.corePage}
      title={word("title")}
      lead={
        <>
          {word("lede")}
          {presets.network === "solana:devnet" ? (
            <span className={styles.netChip} title={word("devnetHint")}>
              {word("devnet")}
            </span>
          ) : null}
          {paused ? <PausedChip locale={locale} /> : null}
        </>
      }
    >
      {paused ? <PausedNote locale={locale} scope={paused} /> : null}
      <StepBar locale={locale} step={step} done={{ token: tokenDone, rules: tokenDone && rulesDone }} onStep={go} disabled={busy} />

      <form id="launch-step-body" tabIndex={-1} aria-label={`${word("stepOf", { n: STEPS.indexOf(step) + 1 })} ${word(STEP_WORD[step])}`} className={styles.form} onSubmit={(event) => event.preventDefault()} noValidate aria-busy={busy}>
        {step === "token" ? (
          <>
            <Block title={word("sectionToken")} titleAs="h2" lang={lang}>
              <fieldset className={styles.section} disabled={locked} data-paused={paused ? "" : undefined}>
                <legend className={styles.visuallyHidden}>{word("sectionToken")}</legend>
                <div className={styles.tokenRow}>
                  <label className={styles.picture} data-empty={picture ? undefined : ""} data-invalid={(attempted && !picture) || pictureBad ? "" : undefined} ref={errorRef(attempted && !picture)}>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className={styles.visuallyHidden} onChange={choosePicture} />
                    {picture ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the creator's own file, shrunk in this page
                      <img src={picture.url} alt="" className={styles.pictureImage} />
                    ) : (
                      <span className={styles.pictureEmpty}>
                        <ImageSquare size={28} aria-hidden />
                        <span>{word("pictureAdd")}</span>
                      </span>
                    )}
                    {picture ? <span className={styles.pictureChange}>{word("pictureChange")}</span> : null}
                  </label>
                  <div className={styles.tokenFields}>
                    <Field label={word("name")} problem={shown("name") ? problemText("name", shown("name")!) : null} refFor={errorRef(shown("name"))} count={`${new TextEncoder().encode(check.clean.name).length}/${presets.limits.nameMax}`}>
                      {(id, described) => <input id={id} aria-describedby={described} className={styles.input} value={fields.name} onChange={set("name")} placeholder={word("namePlaceholder")} autoComplete="off" maxLength={64} />}
                    </Field>
                    <Field label={word("ticker")} problem={shown("symbol") ? problemText("symbol", shown("symbol")!) : null} refFor={errorRef(shown("symbol"))}>
                      {(id, described) => (
                        <div className={styles.affixed}>
                          <span className={styles.affix} aria-hidden>
                            $
                          </span>
                          <input id={id} aria-describedby={described} className={`${styles.input} ${styles.mono}`} value={fields.symbol} onChange={(event) => setFields((current) => ({ ...current, symbol: event.target.value.toUpperCase().replace(/^\$/, "") }))} placeholder={word("tickerPlaceholder")} autoComplete="off" maxLength={presets.limits.symbolMax} />
                        </div>
                      )}
                    </Field>
                  </div>
                </div>
                {(attempted && !picture) || pictureBad ? <p className={styles.problem}>{pictureBad ? word("pictureBad") : word("pictureMissing")}</p> : <p className={styles.hint}>{word("pictureHint")}</p>}
                <Field label={word("description")} optional={word("optional")} problem={shown("description") ? problemText("description", shown("description")!) : null} refFor={errorRef(shown("description"))} count={`${[...fields.description].length}/${presets.limits.descriptionMax}`}>
                  {(id, described) => <textarea id={id} aria-describedby={described} className={`${styles.input} ${styles.textarea}`} value={fields.description} onChange={set("description")} placeholder={word("descriptionPlaceholder")} rows={3} />}
                </Field>
              </fieldset>
            </Block>

            <Block
              title={
                <>
                  {word("sectionLinks")} <span className={styles.optional}>{word("optional")}</span>
                </>
              }
              titleAs="h2"
              lang={lang}
            >
              <fieldset className={styles.section} disabled={locked} data-paused={paused ? "" : undefined}>
                <legend className={styles.visuallyHidden}>{word("sectionLinks")}</legend>
                <div className={styles.links}>
                  {(["website", "x", "telegram"] as const).map((key) => (
                    <Field key={key} label={word(key)} problem={shown(key) ? problemText(key, shown(key)!) : null} refFor={errorRef(shown(key))}>
                      {(id, described) => <input id={id} aria-describedby={described} className={styles.input} value={fields[key]} onChange={set(key)} placeholder={key === "website" ? "example.com" : key === "x" ? "x.com/…" : "t.me/…"} inputMode="url" autoComplete="off" />}
                    </Field>
                  ))}
                </div>
              </fieldset>
            </Block>

            <div className={styles.stepActions} hidden={paused !== null}>
              <Button variant="primary" icon="chevron-right" onClick={() => go("rules")} disabled={busy} lang={lang}>
                {word("stepNext")}
              </Button>
            </div>
          </>
        ) : step === "rules" ? (
          <>
            <Block title={word("sectionPreset")} titleAs="h2" lang={lang}>
              <fieldset className={styles.section} disabled={locked} data-paused={paused ? "" : undefined}>
                <legend className={styles.visuallyHidden}>{word("sectionPreset")}</legend>
                <div className={styles.presets} role="radiogroup" aria-label={word("sectionPreset")}>
                  {presets.presets.map((entry) => (
                    <PresetCard
                      key={entry.id}
                      preset={entry}
                      locale={locale}
                      selected={entry.id === preset.id}
                      onSelect={() => {
                        setPresetId(entry.id);
                        setAdvancedOn(false);
                      }}
                    />
                  ))}
                </div>
                {advancing ? null : <PresetsCommon presets={presets.presets} locale={locale} peopleServed={peopleServed} />}
                {/* «Розширений»'s own numbers are its choice's, not a column of the presets' table. */}
                {advancing ? <PresetDetails preset={preset} locale={locale} peopleServed={peopleServed} terms={terms} /> : <PresetsCompare presets={presets.presets} locale={locale} peopleServed={peopleServed} />}
                {preset.id === "community" ? (
                  <FeeShares
                    locale={locale}
                    rows={shares}
                    problems={attempted || shares.some((row) => row.address && row.pct) ? shareCheck.problems : new Map()}
                    creatorBps={shareCheck.creatorBps}
                    refFor={errorRef(sharing && !sharesValid)}
                    onChange={setShares}
                    onAdd={() => {
                      setShares((current) => (current.length >= FEE_SHARE_MAX_RECIPIENTS - 1 ? current : [...current, { key: nextShareKey, address: "", pct: "" }]));
                      setNextShareKey((key) => key + 1);
                    }}
                  />
                ) : null}
                <FormatsSection
                  locale={locale}
                  presets={presets}
                  preset={preset}
                  symbol={check.clean.symbol}
                  community={communityMint}
                  onCommunity={setCommunityMint}
                  advancedOn={advancedOn}
                  onAdvancedOn={setAdvancedOn}
                  advanced={advancedDraft}
                  onAdvanced={setAdvancedDraft}
                  boostOn={boostOn}
                  onBoostOn={setBoostOn}
                  boost={boostDraft}
                  onBoost={setBoostDraft}
                  pair={pair}
                  refFor={errorRef(attempted && !formatsValid)}
                  earlyOn={earlyOn}
                  early={
                    <EarlyAccessFields
                      locale={locale}
                      presets={presets}
                      on={earlyOn}
                      onOn={(on) => {
                        setEarlyOn(on);
                        if (on) {
                          setAdvancedOn(false);
                          setBoostOn(false);
                        }
                      }}
                      draft={earlyDraft}
                      onDraft={setEarlyDraft}
                    />
                  }
                />
              </fieldset>
            </Block>

            {/* «Ранній доступ» has no curve and no first purchase of the creator's: its vault buys first. */}
            {earlyOn ? null : (
            <Block
              title={
                <>
                  {word("sectionBuy")} <span className={styles.optional}>{word("optional")}</span>
                </>
              }
              titleAs="h2"
              lang={lang}
            >
              <fieldset className={styles.section} disabled={locked} data-paused={paused ? "" : undefined}>
                <legend className={styles.visuallyHidden}>{word("sectionBuy")}</legend>
                <p className={styles.hint}>{word("buyHint")}</p>
                <BuyField locale={locale} preset={preset} pair={pair} supplyRaw={supplyRaw} text={buyText} onText={setBuyText} quote={quoteData} loading={quote.loading} aboveCap={aboveCap} invalid={buyRaw === null} refFor={errorRef(aboveCap || buyRaw === null)} balance={connection && presets.network === "solana:mainnet" ? fundsOf(walletData?.owner === connection.address ? walletData.holdings : null, pair.mint).pair : null} />
                {buying ? (
                  <div className={styles.lockBox} data-on={lockId ? "" : undefined}>
                    <label className={styles.lockToggle}>
                      <input type="checkbox" checked={lockId !== null} disabled={lockMinDays !== null || feeOnTransfers} onChange={(event) => setLockId(event.target.checked ? (lockChoices[0]?.id ?? null) : null)} />
                      <span className={styles.lockIcon} aria-hidden>
                        {lockId ? <Lock size={18} weight="fill" /> : <LockOpen size={18} />}
                      </span>
                      <span className={styles.lockText}>
                        <span className={styles.lockTitle}>{word(lockMinDays === null ? "lockTitle" : "lockRequiredTitle")}</span>
                        <span className={styles.hint}>{feeOnTransfers ? word("lockNoTransferFee") : lockMinDays === null ? word("lockHint") : word("lockRequiredHint", { preset: preset.name[locale], period: periodWord(lockMinDays, locale) })}</span>
                      </span>
                    </label>
                    {lockId ? (
                      <>
                        <div className={styles.segments} role="radiogroup" aria-label={word("lockTitle")}>
                          {lockChoices.map((entry) => (
                            <button key={entry.id} type="button" role="radio" aria-checked={entry.id === lockId} className={styles.segment} onClick={() => setLockId(entry.id)}>
                              {word("lockSchedule", { cliff: periodWord(entry.cliffDays, locale), vest: periodWord(entry.vestDays, locale) })}
                            </button>
                          ))}
                        </div>
                        {lock ? <p className={styles.hint}>{word("lockUntil", { date: formatDate(Date.now() + lock.cliffDays * 86_400_000, locale), end: formatDate(Date.now() + (lock.cliffDays + lock.vestDays) * 86_400_000, locale) })}</p> : null}
                      </>
                    ) : null}
                    {v1Blocked ? (
                      <p className={styles.problem} role="alert">
                        {word("errWalletV1")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>
            </Block>
            )}

            {earlyOn ? null : (
              <MissionStart
                locale={locale}
                presetId={preset.id}
                symbol={check.clean.symbol}
                name={check.clean.name}
                creator={connection?.address ?? null}
                disabled={locked}
                windowId={windowId}
                onWindow={setWindowId}
                crewOn={crewAllowed ? crewOn : null}
                onCrewOn={setCrewOn}
                crew={crew}
                onCrew={setCrew}
                proveWallet={() => proof.act()}
              />
            )}

            <div className={styles.stepActions} hidden={paused !== null}>
              <Button variant="secondary" onClick={() => go("token")} disabled={busy} lang={lang}>
                {word("stepBack")}
              </Button>
              <Button variant="primary" icon="chevron-right" onClick={() => go("review")} disabled={busy} lang={lang}>
                {word("stepToReview")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <PreviewCard locale={locale} picture={picture?.url ?? null} name={check.clean.name} symbol={check.clean.symbol} preset={preset} />
            {/* Every number of the preset, one tap away and read before the signature; the review below says the main ones. */}
            {earlyOn ? null : <PresetDetails preset={preset} locale={locale} peopleServed={peopleServed} terms={terms} />}
            {/* The one standard before a signature: what is paid, what comes, every cost, what it is — then the wallet. */}
            <Review
              lang={lang}
              title={word("reviewTitle", { symbol: check.clean.symbol || word("tickerPlaceholder") })}
              pay={buying && buyRaw !== null ? `${fromRaw(buyRaw, pair.decimals)} ${pair.symbol}` : word("buyNone")}
              get={quotedNet ? `≈ ${formatRaw(quotedNet, 6, locale, 0)} $${check.clean.symbol}` : buying ? word("reviewGetMarket", { symbol: check.clean.symbol }) : word("reviewGetNoBuy", { symbol: check.clean.symbol })}
              costs={[
                { label: word("reviewRent"), value: rent },
                ...(configText ? [{ label: word("reviewConfigRent"), value: configText }] : []),
                ...(feeRaw > 0n ? [{ label: word("reviewBuyFee"), value: word("reviewBuyFeeValue", { fee: feeText, pct: formatBps(terms?.curve.baseFeeBps ?? 0, locale) }) }] : []),
              ]}
              costsTotal={costsTotal}
              rows={earlyOn ? [
                { label: word("reviewNetwork"), value: presets.network === "solana:devnet" ? "Solana Devnet" : "Solana" },
                { label: word("reviewPreset"), value: word("earlyTitle") },
                ...earlyReviewLines(earlyDraft, locale).map((line, index) => ({ label: index === 0 ? word("earlyPreview") : "", value: line })),
              ] : [
                { label: word("reviewNetwork"), value: presets.network === "solana:devnet" ? "Solana Devnet" : "Solana" },
                ...(fundsShown ? [{ label: word("reviewWallet"), value: `${balanceText(funds.sol, 9, "SOL", 4)} · ${balanceText(funds.pair, pair.decimals, pair.symbol, 2)}` }] : []),
                { label: word("reviewPreset"), value: preset.name[locale] },
                /* The preset's terms for ever, as numbers: who gets each fee, the move to the DEX, the locked liquidity. */
                ...(terms ? termRows(terms, locale) : []),
                ...(buying ? [{ label: word("reviewLock"), value: lock ? word("lockSchedule", { cliff: periodWord(lock.cliffDays, locale), vest: periodWord(lock.vestDays, locale) }) : word("reviewNoLock") }] : []),
                ...(preset.id === "community" ? [{ label: word("reviewShare"), value: sharing ? word("reviewShareValue", { you: formatBps(Math.max(shareCheck.creatorBps, 0), locale), n: shares.length }) : word("reviewShareNone") }] : []),
                ...(community ? [{ label: word("communityPick"), value: community.symbol }] : []),
                ...(preset.id === "advanced" ? [{ label: word("advancedBlock"), value: madeConfig ? word("advancedConfigSigned") : word("advancedConfigFirst") }] : []),
                ...(transferFeeBps ? transferFeeRows(transferFeeBps, quoted, check.clean.symbol, locale) : []),
                ...(boostOn ? [{ label: word("boostTitle"), value: word("boostAfterLaunch") }] : []),
                ...(start ? [{ label: word("reviewStart"), value: word("reviewStartWindow", { window: windowWords(start.window, locale) }) }] : [{ label: word("reviewStart"), value: word("startNow") }]),
                ...(crewUsed
                  ? [
                      {
                        label: word("reviewCrew"),
                        value: word("reviewCrewValue", {
                          you: partWords(crewUsed.creatorBps),
                          /* Each yes by its wallet: a handle is nobody's proof, the wallet is what the vault pays. */
                          aboard: crewUsed.members.map((member) => `@${member.handle}${member.wallet ? ` (${shortAddress(member.wallet)})` : ""} ${partWords(member.bps)} · ${word(`crewState_${member.state}`)}`).join(" · "),
                        }),
                      },
                    ]
                  : []),
                ...(connection && presets.network === "solana:mainnet"
                  ? [
                      {
                        label: word("reviewPartner"),
                        value: (
                          <PartnerLine
                            locale={locale}
                            partner={partner}
                            choice={partnerChoice}
                            problem={partnerProblem}
                            editing={partnerEditing && !busy && !paused}
                            busy={busy || paused !== null}
                            text={partnerText}
                            onText={setPartnerText}
                            onEdit={() => setPartnerEditing(true)}
                            onApply={() => {
                              const code = partnerText.trim();
                              setPartnerProblem(null);
                              if (code) setPartnerChoice({ code });
                              setPartnerEditing(false);
                            }}
                            onRemove={() => {
                              setPartnerProblem(null);
                              setPartnerChoice("none");
                            }}
                            onUndo={() => setPartnerChoice("offered")}
                            onClose={() => setPartnerEditing(false)}
                            confirm={
                              !busy && !paused && !proven && proof.state.status !== "checking" && !(walletFact.signedIn && walletFact.walletAddress !== null && walletFact.walletAddress !== connection.address)
                                ? { signing: proof.state.status === "signing", reason: "reason" in proof.state ? (proof.state.reason ?? "") : "", onConfirm: () => void proof.prove() }
                                : null
                            }
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
              whatItIs={earlyOn ? word("earlyReviewFixed") : word("reviewFixed")}
              signer={connection ? shortAddress(connection.address) : word("signerConnect")}
              ready={!paused && !busy && tokenDone && rulesDone && Boolean(connection) && !partnerEditing && !startBlocked && !crewBlocked && !short}
              blockedReason={
                paused ? word("pausedAction") : !tokenDone || !rulesDone ? word("reviewFixFirst") : startBlocked ? (start?.state === "closed" ? word("startClosedReason", { clock: windowClock(start.window) }) : start ? word("startWaitReason", { clock: windowClock(start.window), t: tMinus(start.ms).replace("T-", "") }) : word("reviewFixFirst")) : crewBlocked ? (crew && !crewMatches ? word("crewTickerChanged", { symbol: crew.symbol, preset: crew.preset === "classic" ? "Classic" : "Protected" }) : word("crewNobody")) : partnerEditing ? word("partnerApplyFirst") : !connection ? word("connectFirst") : short ? (
                  <>
                    {word("reviewShort", {
                      what: [
                        ...(short.solLamports > 0n ? [`${pairAmount(short.solLamports, 9, locale, 3)} SOL`] : []),
                        ...(short.pairRaw > 0n ? [`${pairAmount(short.pairRaw, pair.decimals, locale)} ${pair.symbol}`] : []),
                      ].join(word("reviewShortAnd")),
                    })}{" "}
                    {/* A new tab: the draft — the picture, the preset, the made config — stays here; the balance is read again on return. */}
                    <a className={styles.textButton} href="/app/top-up" target="_blank" rel="noopener">
                      {word("topUp")} <ArrowSquareOut size={12} aria-hidden />
                    </a>{" "}
                    <button type="button" className={styles.markLink} onClick={() => walletData?.refresh()}>
                      {word("readAgain")}
                    </button>
                  </>
                ) : word("connectFirst")
              }
              signing={busy}
              onConfirm={() => void launch()}
            />
            {/* Without a wallet the review cannot be signed: the one orange action opens a wallet, and says so. */}
            {!connection && !paused ? (
              <ConnectWalletButton block />
            ) : null}
            {busy ? <Progress locale={locale} phase={phase} many={many} split={manyWithSplit} again={again} /> : null}
            {phase === "error" && failure ? (
              <div className={styles.failure} role="alert">
                <p className={styles.failureTitle}>
                  <Warning size={18} weight="fill" aria-hidden /> {word("errTitle")}
                </p>
                <p className={styles.failureText}>{failureText(failure, word)}</p>
                {lostAfterSend(failure) && failure.token ? (
                  <Link className={styles.markLink} href={`/app/launch/${failure.token}`}>
                    {word("openToken")} <ArrowSquareOut size={14} aria-hidden />
                  </Link>
                ) : null}
                {failure.detail ? (
                  <details className={styles.details}>
                    <summary className={styles.summary}>
                      {word("errDetails")} <CaretDown size={14} aria-hidden className={styles.caret} />
                    </summary>
                    <p className={styles.failureDetail}>{failure.detail}</p>
                  </details>
                ) : null}
              </div>
            ) : null}
            <div className={styles.stepActions}>
              <Button variant="ghost" onClick={() => go("rules")} disabled={busy} lang={lang}>
                {word("stepBack")}
              </Button>
            </div>
          </>
        )}
      </form>
    </Page>
  );
}

type Step = "token" | "rules" | "review";
const STEPS: readonly Step[] = ["token", "rules", "review"];
const STEP_WORD: Readonly<Record<Step, LaunchWordKey>> = { token: "sectionToken", rules: "stepRules", review: "stepReview" };
/** The fields of the first step: the token as others will see it, and its links. */
const TOKEN_FIELDS: readonly (keyof LaunchFormFields)[] = ["name", "symbol", "description", "website", "x", "telegram"];

/**
 * The three steps — the token, the market's rules, the review — in a row: a step already passed opens again with a
 * press; a step ahead opens only through the one before it, so nothing is signed unseen.
 */
function StepBar({ locale, step, done, onStep, disabled }: { locale: WorkspaceLocale; step: Step; done: Readonly<{ token: boolean; rules: boolean }>; onStep: (step: Step) => void; disabled: boolean }) {
  const word = launchWords(locale);
  const at = STEPS.indexOf(step);
  return (
    <ol id="launch-steps" className={styles.wizardSteps} aria-label={word("stepsLabel")}>
      {STEPS.map((entry, index) => {
        const state = index < at ? "done" : index === at ? "active" : "next";
        const reachable = index < at || (index === at + 1 && (entry === "rules" ? done.token : done.rules));
        return (
          <li key={entry} className={styles.wizardStep} data-state={state}>
            <button type="button" className={styles.wizardButton} aria-current={index === at ? "step" : undefined} disabled={disabled || index === at || !reachable} onClick={() => onStep(entry)}>
              <span className={styles.wizardIndex} aria-hidden>
                {state === "done" ? <CheckCircle size={18} weight="fill" /> : index + 1}
              </span>
              <span className={styles.wizardLabel}>
                <span className={styles.visuallyHidden}>{word("stepOf", { n: index + 1 })} </span>
                {word(STEP_WORD[entry])}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
type Failure = Readonly<{ step: "before" | "send"; code: string; detail: string | null; token: string | null }>;

/** The answer to the send was lost: the launch may have landed. Every coded refusal of the send was made before the pool payer signed. */
const lostAfterSend = (failure: Failure) => failure.step === "send" && failure.code === "UNAVAILABLE";

/** What a refusal means for the person, in their language — the server's own words stay one tap deeper. */
function failureText(failure: Failure, word: ReturnType<typeof launchWords>): string {
  switch (failure.code) {
    case "WALLET_REFUSED":
      return word("errWalletRefused");
    case "LAUNCH_NAME_BORROWED":
      return word("errBorrowedServer");
    case "LAUNCH_IMAGE_INVALID":
      return word("pictureBad");
    case "LAUNCH_IMAGE_REFUSED":
      return word("pictureRefused");
    case "LAUNCH_WALLET_V1_REQUIRED":
      return word("errWalletV1");
    case "LAUNCH_IMAGE_CHECK_UNAVAILABLE":
      return word("pictureCheckLater");
    case "LAUNCH_LIMIT":
      return word("errLimit");
    /* From the form it means new launches wait — the whole of Launch, or only them; either way it is true. */
    case "LAUNCH_PAUSED":
      return word("errLaunchingPaused");
    case "RATE_LIMITED":
      return word("errRateLimited");
    case "LAUNCH_BUSY":
      return word("errBusy");
    case "LAUNCH_QUOTE_PAUSED":
      return word("errQuotePaused");
    case "LAUNCH_FIRST_BUY_ABOVE_CAP":
      return word("errAboveCap");
    case "LAUNCH_BUILD_EXPIRED":
      return word("errExpired");
    case "LAUNCH_QUOTE_MOVED":
      return word("errQuoteMoved");
    case "LAUNCH_BUILD_USED":
      return word("errUsed");
    case "LAUNCH_SIGNED_OTHER_BYTES":
      return word("errSignedOther");
    case "LAUNCH_SUBMIT_FAILED":
      return word("errSubmit");
    default:
      return lostAfterSend(failure) ? word("errUnknownAfterSend") : word("errGeneric");
  }
}

/**
 * An amount of a cost or a shortfall read at a glance: `digits` decimals (two by default), up to six when it is under a
 * hundredth — and rounded up, so what the page asks for is never less than what is needed.
 */
function pairAmount(raw: bigint, decimals: number, locale: WorkspaceLocale, digits = 2): string {
  const small = decimals > digits && raw < 10n ** BigInt(decimals - digits);
  const places = Math.min(decimals, small ? 6 : digits);
  return new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: small ? 0 : places, maximumFractionDigits: places }).format(Number(fromRaw(ceilToDigits(raw, decimals, places), decimals, places)));
}

/** SOL as the network-cost row writes it — «0.010», never «0.01» beside it. */
function solFigure(lamports: bigint): string {
  const [whole, fraction = ""] = fromRaw(lamports, 9, 6).split(".");
  return `${whole}.${fraction.padEnd(3, "0")}`;
}

function periodWord(days: number, locale: WorkspaceLocale): string {
  const word = launchWords(locale);
  return days >= 365 ? word("year") : word("months", { n: Math.round(days / 30) });
}

function Field({
  label,
  optional,
  problem,
  count,
  refFor,
  children,
}: {
  label: string;
  optional?: string;
  problem: string | null;
  count?: string;
  refFor: (element: HTMLElement | null) => void;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const problemId = `${id}-problem`;
  return (
    <div className={styles.field} data-invalid={problem ? "" : undefined} ref={refFor}>
      <span className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label} {optional ? <span className={styles.optional}>{optional}</span> : null}
        </label>
        {count ? <span className={styles.count}>{count}</span> : null}
      </span>
      {children(id, problem ? problemId : undefined)}
      {problem ? (
        <span id={problemId} className={styles.problem}>
          {problem}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A preset's card (UX-406): its name and one line of what it is for, with the numbers that set it apart; «Захищений»
 * says it is the default. What every preset shares is one line under the cards, and every number of every preset sits in
 * «All numbers» — nothing of the terms is hidden before the review, it is only not repeated four times.
 */
function PresetCard({ preset, locale, selected, onSelect }: { preset: LaunchPresetView; locale: WorkspaceLocale; selected: boolean; onSelect: () => void }) {
  const word = launchWords(locale);
  return (
    <button type="button" role="radio" aria-checked={selected} className={styles.preset} onClick={onSelect}>
      <span className={styles.presetHead}>
        <span className={styles.presetName}>
          {preset.name[locale]}
          {preset.id === "protected" ? <span className={styles.presetDefault}>{word("presetDefault")}</span> : null}
        </span>
        <span className={styles.radio} aria-hidden />
      </span>
      {preset.technicalValidation ? <span className={styles.techChip} style={{ justifySelf: "start" }}>{word("presetTechnical")}</span> : null}
      <span className={styles.presetFacts}>{presetPurpose(preset, locale)}</span>
    </button>
  );
}

/** What a preset is for, in one line with the numbers that set it apart — from the preset the server offers. */
function presetPurpose(preset: LaunchPresetView, locale: WorkspaceLocale): string {
  const word = launchWords(locale);
  const sniper = { start: formatBps(preset.sniperFee.startBps, locale), end: formatBps(preset.sniperFee.endBps, locale), time: formatDuration(preset.sniperFee.seconds, locale) };
  const cap = formatBps(preset.firstBuyCapBps, locale);
  if (preset.id === "protected") return word("presetFor_protected", { ...sniper, cap });
  if (preset.id === "community") return word("presetFor_community", { symbol: preset.pair.symbol, n: FEE_SHARE_MAX_RECIPIENTS - 1 });
  if (preset.creatorLockMinDays !== null && preset.graduationQuote !== null)
    return word("presetFor_micro", { amount: formatNumber(preset.graduationQuote, locale), symbol: preset.pair.symbol, period: periodWord(preset.creatorLockMinDays, locale), creator: formatBps(presetTerms(preset.id)?.graduation.creatorBps ?? 0, locale) });
  return word("presetFor_classic", { ...sniper, cap });
}

/** The line under the cards: the terms every offered preset shares — said once; null when they differ. */
function PresetsCommon({ presets, locale, peopleServed }: { presets: readonly LaunchPresetView[]; locale: WorkspaceLocale; peopleServed: boolean }) {
  const word = launchWords(locale);
  const all = presets.map((entry) => presetTerms(entry.id, { peopleServed })).filter((entry): entry is PresetTerms => entry !== null);
  const first = all[0];
  if (!first || all.length !== presets.length) return null;
  const same = all.every((entry) => entry.curve.split.creatorBps === first.curve.split.creatorBps && entry.curve.split.ryntraBps === first.curve.split.ryntraBps && entry.token.supply === first.token.supply);
  if (!same) return null;
  const split = first.curve.split;
  return (
    <p className={styles.hint}>
      {word("presetsCommon", { creator: formatBps(split.creatorBps, locale), ryntra: formatBps(split.ryntraBps, locale), meteora: formatBps(split.meteoraBps, locale), supply: formatNumber(first.token.supply, locale) })}
    </p>
  );
}

/** «All numbers»: every offered preset side by side, one row per term, so the difference is read in one place (UX-406). */
function PresetsCompare({ presets, locale, peopleServed }: { presets: readonly LaunchPresetView[]; locale: WorkspaceLocale; peopleServed: boolean }) {
  const word = launchWords(locale);
  const columns = presets.map((preset) => ({ preset, terms: presetTerms(preset.id, { peopleServed }) }));
  const bps = (value: number) => formatBps(value, locale);
  const rows: readonly { label: string; value: (entry: (typeof columns)[number]) => string }[] = [
    {
      label: word("compareDex"),
      value: ({ preset }) => (preset.graduationQuote !== null ? `${formatNumber(preset.graduationQuote, locale)} ${preset.pair.symbol}` : `$${formatNumber(Math.round(preset.graduationMarketCapUsd), locale)}`),
    },
    { label: word("comparePair"), value: ({ preset }) => preset.pair.symbol },
    { label: word("compareSniper"), value: ({ preset }) => `${bps(preset.sniperFee.startBps)} → ${bps(preset.sniperFee.endBps)} · ${formatDuration(preset.sniperFee.seconds, locale)}` },
    { label: word("compareYourFee"), value: ({ terms }) => (terms ? bps(terms.curve.split.creatorBps) : "—") },
    { label: word("compareCap"), value: ({ preset }) => bps(preset.firstBuyCapBps) },
    { label: word("compareLock"), value: ({ preset }) => (preset.creatorLockMinDays !== null ? periodWord(preset.creatorLockMinDays, locale) : word("compareLockYours")) },
    {
      label: word("compareExit"),
      value: ({ terms }) => (terms ? (terms.graduation.toBudget ? word("compareExitBudget", { pct: bps(terms.graduation.feeBps), creator: bps(terms.graduation.creatorBps) }) : word("compareExitValue", { pct: bps(terms.graduation.feeBps), creator: bps(terms.graduation.creatorBps) })) : "—"),
    },
    { label: word("compareBudget"), value: ({ terms }) => (terms?.budget ? word(terms.budget.waitsInPool ? "compareBudgetWaits" : "compareBudgetClaimed") : "—") },
    { label: word("comparePool"), value: ({ terms }) => (terms ? `${bps(terms.pool.startFeeBps)} → ${bps(terms.pool.endFeeBps)}` : "—") },
    { label: word("compareShares"), value: ({ preset }) => (preset.id === "community" ? word("compareSharesUpTo", { n: FEE_SHARE_MAX_RECIPIENTS - 1 }) : "—") },
  ];
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        {word("presetsCompare")} <CaretDown size={14} aria-hidden className={styles.caret} />
      </summary>
      <p className={styles.hint}>{word("presetFixedNote")}</p>
      <div className={styles.compareWrap} tabIndex={0} role="region" aria-label={word("presetsCompare")}>
        <table className={styles.compare}>
          <thead>
            <tr>
              <th scope="col">
                <span className={styles.visuallyHidden}>{word("sectionPreset")}</span>
              </th>
              {columns.map(({ preset }) => (
                <th key={preset.id} scope="col">
                  {preset.name[locale]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* A row no offered preset has — sharing the fees where «Спільнота» is not offered — is left out. */}
            {rows.filter((row) => columns.some((entry) => row.value(entry) !== "—")).map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {columns.map((entry) => (
                  <td key={entry.preset.id}>{row.value(entry)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function PresetDetails({ preset, locale, peopleServed, terms }: { preset: LaunchPresetView; locale: WorkspaceLocale; peopleServed: boolean; terms?: PresetTerms | null }) {
  const word = launchWords(locale);
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        {word("presetDetails")} <CaretDown size={14} aria-hidden className={styles.caret} />
      </summary>
      <PresetNumbers preset={preset} locale={locale} peopleServed={peopleServed} terms={terms} />
    </details>
  );
}

/**
 * The preset's terms in the review: who gets each fee on the curve, the move to the DEX and the liquidity it locks — and,
 * on Micro, what its budget does now. Every number from `presetTerms`, the one source the cabinet reads too.
 */
function termRows(terms: PresetTerms, locale: WorkspaceLocale): { label: string; value: string }[] {
  const word = launchWords(locale);
  const split = terms.curve.split;
  return [
    { label: word("reviewCurveSplit"), value: word("presetSplitValue", { creator: formatBps(split.creatorBps, locale), ryntra: formatBps(split.ryntraBps, locale), meteora: formatBps(split.meteoraBps, locale) }) },
    {
      label: word("reviewGraduation"),
      value: terms.graduation.toBudget
        ? word("reviewGraduationBudget", { pct: formatBps(terms.graduation.feeBps, locale), creator: formatBps(terms.graduation.creatorBps, locale) })
        : word("reviewGraduationValue", { pct: formatBps(terms.graduation.feeBps, locale), creator: formatBps(terms.graduation.creatorBps, locale) }),
    },
    ...(terms.budget ? [{ label: word("reviewBudget"), value: word(terms.budget.waitsInPool ? "reviewBudgetWaits" : "reviewBudgetClaimed") }] : []),
    { label: word("reviewLp"), value: word("reviewLpValue") },
  ];
}

/** Every number of the preset — fixed in its Meteora config for every token launched on it — from `presetTerms`. */
function PresetNumbers({ preset, locale, peopleServed, terms: given }: { preset: LaunchPresetView; locale: WorkspaceLocale; peopleServed: boolean; terms?: PresetTerms | null }) {
  const word = launchWords(locale);
  /* «Розширений»'s terms are the choice's (`given`); a preset's are its own. */
  const terms = given ?? presetTerms(preset.id, { peopleServed });
  if (!terms) return null;
  const bps = (value: number) => formatBps(value, locale);
  const { curve, graduation, pool } = terms;
  return (
    <>
      <p className={styles.hint}>{word("presetFixedNote")}</p>
      <dl className={styles.rows}>
        <Row label={word("presetCurve")} value={`$${formatNumber(curve.startMarketCapUsd, locale)} → $${formatNumber(curve.graduationMarketCapUsd, locale)}`} />
        <Row label={word("presetCurveFee")} value={word("presetCurveFeeValue", { base: bps(curve.baseFeeBps), start: bps(curve.sniperFee.startBps), time: formatDuration(curve.sniperFee.seconds, locale) })} />
        <Row
          label={word("presetCurveSplit")}
          value={
            <>
              {word("presetSplitValue", { creator: bps(curve.split.creatorBps), ryntra: bps(curve.split.ryntraBps), meteora: bps(curve.split.meteoraBps) })}
              <span className={styles.rowNote}>{word("presetCurveSplitVia", { ryntra: bps(curve.splitThroughRyntra.ryntraBps), meteora: bps(curve.splitThroughRyntra.meteoraBps) })}</span>
            </>
          }
        />
        <Row
          label={word("presetGraduation")}
          value={
            <>
              {graduation.toBudget
                ? word("presetGraduationBudget", { pct: bps(graduation.feeBps), creator: bps(graduation.creatorBps) })
                : word("presetGraduationValue", { pct: bps(graduation.feeBps), creator: bps(graduation.creatorBps), ryntra: bps(graduation.ryntraBps) })}
              <span className={styles.rowNote}>{word("presetGraduationMeteora", { pct: bps(graduation.meteoraLiquidityBps) })}</span>
            </>
          }
        />
        {terms.budget ? (
          <Row
            label={word("presetBudget")}
            value={
              <>
                {word("presetBudgetValue", { share: bps(terms.budget.feeShareBps) })}
                <span className={styles.rowNote}>{word(terms.budget.waitsInPool ? "presetBudgetWaits" : preset.technicalValidation ? "presetBudgetClaimed" : "presetBudgetPeople")}</span>
              </>
            }
          />
        ) : null}
        <Row label={word("presetPoolFee")} value={word("presetPoolFeeValue", { start: bps(pool.startFeeBps), end: bps(pool.endFeeBps), days: formatNumber(pool.expiresAfterSeconds / 86_400, locale) })} />
        <Row
          label={word("presetPoolSplit")}
          value={
            <>
              {word("presetPoolSplitValue", { creator: bps(pool.creatorPositionBps), ryntra: bps(pool.ryntraPositionBps), compounding: bps(pool.compoundingBps), meteora: bps(pool.meteoraBps) })}
              <span className={styles.rowNote}>{word("presetPoolSplitHint", { positions: bps(pool.positionsBps) })}</span>
            </>
          }
        />
        <Row label={word("presetLp")} value={word("presetLpValue")} />
        <Row
          label={word("presetFirstBuy")}
          value={
            terms.firstBuy.lockMinDays !== null
              ? word("presetFirstBuyLocked", { pct: bps(terms.firstBuy.capBps), period: periodWord(terms.firstBuy.lockMinDays, locale) })
              : word("presetFirstBuyValue", { pct: bps(terms.firstBuy.capBps) })
          }
        />
        <Row label={word("presetToken")} value={terms.token.supply === 1_000_000_000 ? word("presetTokenValue") : word("presetTokenValueOf", { supply: formatNumber(terms.token.supply, locale) })} />
        <Row label={word("presetCreation")} value={word("presetCreationValue")} />
      </dl>
    </>
  );
}

/**
 * «Запросив» — the creator's partner before the signature: who the launch will name (masked), «Змінити» to put a code
 * or a link in its place, «Прибрати» and «Повернути»; why a code could not be used; «Підтвердити гаманець» when the
 * offer can be read only for the proven wallet. A field inside the review, so Enter applies the code and never submits.
 */
function PartnerLine({
  locale,
  partner,
  choice,
  problem,
  editing,
  busy,
  text,
  onText,
  onEdit,
  onApply,
  onRemove,
  onUndo,
  onClose,
  confirm,
}: {
  locale: WorkspaceLocale;
  partner: PartnerView;
  choice: "offered" | "none" | Readonly<{ code: string }>;
  problem: "UNKNOWN" | "SELF" | "CHANGED" | "UNCHECKED" | null;
  editing: boolean;
  busy: boolean;
  text: string;
  onText: (value: string) => void;
  onEdit: () => void;
  onApply: () => void;
  onRemove: () => void;
  onUndo: () => void;
  onClose: () => void;
  confirm: Readonly<{ signing: boolean; reason: string; onConfirm: () => void }> | null;
}) {
  const word = launchWords(locale);
  if (editing) {
    return (
      <span className={styles.partnerEdit}>
        <input
          className={styles.input}
          aria-label={word("partnerCodeLabel")}
          placeholder={word("partnerCodeLabel")}
          value={text}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onApply();
          }}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <button type="button" className={styles.textButton} onClick={onApply}>
          {word("partnerApply")}
        </button>
        <button type="button" className={styles.textButton} onClick={onClose}>
          {word("partnerClose")}
        </button>
      </span>
    );
  }
  const note = problem ? word(problem === "SELF" ? "partnerSelf" : problem === "CHANGED" ? "partnerChanged" : problem === "UNCHECKED" ? "partnerUnchecked" : "partnerUnknown") : null;
  return (
    <>
      {partner ? partner.partnerMasked : word("reviewPartnerNone")}
      {busy ? null : (
        <span className={styles.partnerActions}>
          <button type="button" className={styles.textButton} onClick={onEdit}>
            {partner ? word("partnerChange") : word("partnerAdd")}
          </button>
          {choice === "none" ? (
            <button type="button" className={styles.textButton} onClick={onUndo}>
              {word("partnerUndo")}
            </button>
          ) : null}
          {partner ? (
            <button type="button" className={styles.textButton} onClick={onRemove}>
              {word("partnerRemove")}
            </button>
          ) : null}
        </span>
      )}
      {note ? (
        <span role="status" className={styles.partnerNote}>
          {note}
        </span>
      ) : confirm ? (
        <span className={styles.partnerNote}>
          <button type="button" className={styles.textButton} disabled={confirm.signing} onClick={confirm.onConfirm}>
            {word("partnerConfirm")}
          </button>
          {confirm.reason ? <span role="status"> {confirm.reason}</span> : null}
        </span>
      ) : null}
    </>
  );
}

function BuyField({
  locale,
  preset,
  pair,
  supplyRaw,
  text,
  onText,
  quote,
  loading,
  aboveCap,
  invalid,
  refFor,
  balance,
}: {
  locale: WorkspaceLocale;
  preset: LaunchPresetView;
  /** The pair the curve raises — «Спільнота»'s community token where one was picked (SOL-L5). */
  pair: Readonly<{ symbol: string; decimals: number }>;
  /** The launch's supply, raw: «Розширений»'s is the creator's choice. */
  supplyRaw: bigint;
  text: string;
  onText: (value: string) => void;
  quote: LaunchQuoteResponse | null;
  loading: boolean;
  aboveCap: boolean;
  invalid: boolean;
  refFor: (element: HTMLElement | null) => void;
  /** The wallet's pair, when a wallet is connected on mainnet; «—» until read (UX-402). */
  balance: Balance | null;
}) {
  const word = launchWords(locale);
  const id = useId();
  const decimals = pair.decimals;
  const capPct = formatBps(preset.firstBuyCapBps, locale);
  const maxIn = quote ? fromRaw(quote.maxAmountInRaw, decimals, 2) : null;
  /* «Max»: the cap's amount, no more than the wallet holds of the pair when that was read. */
  const maxTyped = quote ? fromRaw(maxFirstBuyRaw(BigInt(quote.maxAmountInRaw), balance ?? { read: false }), decimals, 2) : null;
  const typed = toRaw(text, decimals);
  const overBalance = Boolean(balance?.read && typed !== null && typed > balance.raw);
  const tokens = quote && BigInt(quote.tokensOutRaw) > 0n ? quote.tokensOutRaw : null;
  return (
    <div className={styles.field} data-invalid={aboveCap || invalid ? "" : undefined} ref={refFor}>
      <span className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {word("buyAmount")}
        </label>
        {maxIn ? (
          <span className={styles.count}>
            {word("buyCap", { amount: formatNumber(Number(maxIn), locale, 2), symbol: pair.symbol, pct: capPct })}
          </span>
        ) : null}
      </span>
      <div className={styles.affixed}>
        <input id={id} className={`${styles.input} ${styles.mono}`} value={text} onChange={(event) => onText(event.target.value)} inputMode="decimal" placeholder="0" autoComplete="off" />
        <span className={styles.suffix}>{pair.symbol}</span>
        {maxTyped ? (
          <button type="button" className={styles.maxChip} onClick={() => onText(maxTyped)}>
            {word("buyMax")}
          </button>
        ) : null}
      </div>
      {balance ? <span className={styles.hint}>{word("buyBalance", { amount: balance.read ? formatRaw(balance.raw, decimals, locale, 2) : "—", symbol: pair.symbol })}</span> : null}
      <span className={aboveCap || invalid || overBalance ? styles.problem : styles.hint} aria-live="polite">
        {invalid
          ? word("errAmount")
          : aboveCap && maxIn
            ? word("buyAboveCap", { amount: formatNumber(Number(maxIn), locale, 2), symbol: pair.symbol })
            : overBalance && balance?.read
              ? word("buyAboveBalance", { amount: formatRaw(balance.raw, decimals, locale, 2), symbol: pair.symbol })
            : loading && text.trim()
              ? word("buyQuoting")
              : tokens
                ? word("buyGets", { tokens: formatRaw(tokens, 6, locale, 0), pct: formatPercent(Number((BigInt(tokens) * 1_000_000n) / supplyRaw) / 10_000, locale, 2) })
                : " "}
      </span>
    </div>
  );
}

/**
 * «Комісія за переказ» in the review (SOL-L10): the rate and whose the withheld is; the first purchase gross, withheld
 * and net; the rate by epoch; who can do what after the DEX; and what the move to the DEX itself pays.
 */
function transferFeeRows(bps: number, quotedRaw: string | null, symbol: string, locale: WorkspaceLocale): { label: string; value: string }[] {
  const word = launchWords(locale);
  const pct = formatBps(bps, locale);
  const ticker = `$${symbol || "TOKEN"}`;
  const amount = (raw: bigint) => `${formatRaw(raw.toString(), 6, locale, 2)} ${ticker}`;
  const buy = quotedRaw ? transferFeeOn(BigInt(quotedRaw), bps) : null;
  return [
    { label: word("transferFeeTitle"), value: word("reviewTransferFee", { pct }) },
    ...(buy ? [{ label: word("reviewTransferFeeBuy"), value: word("reviewTransferFeeBuyValue", { gross: amount(buy.grossRaw), withheld: amount(buy.withheldRaw), net: amount(buy.netRaw) }) }] : []),
    { label: word("reviewTransferFeeEpoch"), value: word("reviewTransferFeeEpochValue", { pct, epochs: TRANSFER_FEE_NEW_RATE_EPOCHS }) },
    { label: word("reviewTransferFeeAfterDex"), value: word("reviewTransferFeeAfterDexValue") },
    { label: word("reviewTransferFeeExit"), value: word("transferFeeExitCost", { pct }) },
  ];
}

function PreviewCard({ locale, picture, name, symbol, preset }: { locale: WorkspaceLocale; picture: string | null; name: string; symbol: string; preset: LaunchPresetView }) {
  const word = launchWords(locale);
  return (
    <div className={styles.preview} aria-hidden>
      <span className={styles.previewPicture}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the creator's own picture, shrunk in this page */}
        {picture ? <img src={picture} alt="" /> : <ImageSquare size={28} />}
      </span>
      <span className={styles.previewText}>
        <span className={styles.previewName} data-empty={name ? undefined : ""}>{name || word("namePlaceholder")}</span>
        <span className={styles.previewSymbol} data-empty={symbol ? undefined : ""}>${symbol || word("tickerPlaceholder")}</span>
      </span>
      <span className={styles.previewChip}>{preset.name[locale]}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Progress({ locale, phase, many, split, again }: { locale: WorkspaceLocale; phase: Phase; many: boolean; split: boolean; again: boolean }) {
  const word = launchWords(locale);
  const steps: readonly { id: Phase; label: LaunchWordKey }[] = [
    { id: "prepare", label: "stepPrepare" },
    { id: "sign", label: again ? "stepSignAgain" : split ? "stepSignAll" : many ? "stepSignMany" : "stepSign" },
    { id: "send", label: "stepSend" },
  ];
  const at = steps.findIndex((step) => step.id === phase);
  return (
    <ol className={styles.steps} aria-live="polite">
      {steps.map((step, index) => (
        <li key={step.id} className={styles.step} data-state={index < at ? "done" : index === at ? "active" : "next"}>
          <span className={styles.stepIcon} aria-hidden>
            {index < at ? <CheckCircle size={18} weight="fill" /> : index === at ? <CircleNotch size={18} className={styles.spin} /> : <span className={styles.stepDot} />}
          </span>
          {word(step.label)}
        </li>
      ))}
    </ol>
  );
}

function Success({
  locale,
  result,
  onAnother,
  boost,
}: {
  locale: WorkspaceLocale;
  result: { submit: LaunchSubmitResponse; token: LaunchTokenResponse | null; symbol: string; image: string | null };
  onAnother: () => void;
  /** Launch Boost, when the creator set one up in «Розширені параметри»: its budget is locked now, with its own signature. */
  boost: Readonly<{ draft: BoostDraft; pair: Readonly<{ symbol: string; decimals: number }>; connection: NonNullable<ReturnType<typeof useSolanaConnection>["connection"]> }> | null;
}) {
  const word = launchWords(locale);
  const pending = result.submit.state === "PENDING";
  const lockFailed = result.submit.lock?.state === "FAILED" && result.token?.lock?.state !== "LOCKED" && !pending;
  /* The token's read, made after the send, outranks the send's own word: an escrow already seen is locked. */
  const lockPending = result.submit.lock?.state === "PENDING" && result.token?.lock?.state !== "LOCKED";
  /* The same for the sharing of the creator's fees: the token's read settles it from the curve's own creator. */
  const sharingState = result.token?.feeSharing?.state ?? result.submit.feeSharing?.state ?? null;
  return (
    <Page kind="action" className={styles.corePage} title={word(pending ? "pendingTitle" : "successTitle", { symbol: result.symbol })}>
    <section className={styles.success}>
      <span className={styles.successPicture}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the token's own stored picture */}
        {result.image ? <img src={result.image} alt="" /> : null}
        {pending ? null : (
          <span className={styles.successBadge} aria-hidden>
            <CheckCircle size={22} weight="fill" />
          </span>
        )}
      </span>
      {pending || !result.token ? null : <p className={styles.lede}>{word("successLine")}</p>}
      {pending ? <p className={styles.lede}>{word("pendingLine")}</p> : null}
      {result.token?.lock?.state === "LOCKED" && result.token.lock.cliffAt && result.token.lock.endsAt ? (
        <p className={styles.lockedLine}>
          <Lock size={16} weight="fill" aria-hidden /> {word("successLocked", { date: formatDate(result.token.lock.cliffAt, locale), end: formatDate(result.token.lock.endsAt, locale) })}
        </p>
      ) : null}
      {lockPending ? <p className={styles.lede}>{word("successLockPending")}</p> : null}
      {lockFailed ? (
        <p className={styles.problem} role="alert">
          <Warning size={16} aria-hidden /> {word("successLockFailed")}
        </p>
      ) : null}
      {sharingState === "SHARED" ? <p className={styles.lede}>{word("successShared")}</p> : null}
      {sharingState === "PENDING" ? <p className={styles.lede}>{word("successSharePending")}</p> : null}
      {sharingState === "FAILED" && !pending ? (
        <p className={styles.problem} role="alert">
          <Warning size={16} aria-hidden /> {word("successShareFailed")}
        </p>
      ) : null}
      {boost && !pending ? <BoostCommit locale={locale} token={result.submit.token} boost={boost} /> : null}
      {result.token ? <ShareLink link={result.token.shareLink} symbol={result.symbol} locale={locale} /> : null}
      <div className={styles.successActions}>
        <LinkButton href={result.submit.tokenPath} variant="primary">
          {word("openToken")}
        </LinkButton>
        <LinkButton href="/app/launch/mine">{word("mineTitle")}</LinkButton>
        <Button variant="ghost" onClick={onAnother} lang={coreLang(locale)}>
          {word("launchAnother")}
        </Button>
      </div>
    </section>
    </Page>
  );
}

/** The rules' lines for the review, from the draft as it would be built now. */
function earlyReviewLines(draft: EarlyDraft, locale: WorkspaceLocale): readonly string[] {
  const rules = earlyRulesOfDraft(draft, Math.floor(Date.now() / 1000));
  return rules ? earlyAccessRuleLines(rules, locale) : [];
}

/** «Ранній доступ» launched (SOL-L5): what was made, and the token's page, where deposits are taken. */
function EarlySuccess({ locale, result, symbol, onAnother }: { locale: WorkspaceLocale; result: LaunchEarlyAccessSubmitResponse; symbol: string; onAnother: () => void }) {
  const word = launchWords(locale);
  return (
    <Page kind="action" className={styles.corePage} title={word("earlySuccessTitle", { symbol })}>
      <section className={styles.success}>
        <p className={styles.lede}>{result.state === "OPEN" ? word("earlySuccessLine") : word("earlySuccessPartial")}</p>
        <div className={styles.successActions}>
          <LinkButton href={result.tokenPath} variant="primary">
            {word("openToken")}
          </LinkButton>
          <Button variant="ghost" onClick={onAnother} lang={coreLang(locale)}>
            {word("launchAnother")}
          </Button>
        </div>
      </section>
    </Page>
  );
}

/**
 * Launch Boost after the launch (SOL-L5): the rules the creator set, from now, and the budget locked in Met Lock from
 * the creator to the creator — one signature. The campaign is open, and its rules on the token's page, once it lands.
 */
function BoostCommit({ locale, token, boost }: { locale: WorkspaceLocale; token: string; boost: NonNullable<Parameters<typeof Success>[0]["boost"]> }) {
  const word = launchWords(locale);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const commit = async () => {
    setState("busy");
    setDetail(null);
    const rules = boostRulesOfDraft(boost.draft, boost.pair.decimals, Math.floor(Date.now() / 1000));
    if (!rules) {
      setState("error");
      return;
    }
    const fresh = await signFreshBytes({
      build: () => api<LaunchBoostBuildResponse>(`/api/v1/launch/${token}/boost/build`, { method: "POST", body: JSON.stringify({ creator: boost.connection.address, rules }) }),
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        const answer = await signTransactions({ wallet: boost.connection.wallet, address: boost.connection.address, unsignedWireBase64: [data.unsignedWireBase64], chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64[0]! } : answer;
      },
    });
    if (!fresh.ok) {
      setDetail(fresh.stage === "build" ? fresh.failure.message || fresh.failure.code : fresh.stage === "sign" ? fresh.reason : null);
      setState("error");
      return;
    }
    const sent = await api<LaunchBoostSubmitResponse>(`/api/v1/launch/${token}/boost/submit`, {
      method: "POST",
      body: JSON.stringify({ buildId: fresh.built.buildId, creator: boost.connection.address, signedWireBase64: fresh.signed }),
    });
    if (!sent.ok || sent.data.state === "FAILED") {
      setDetail(sent.ok ? sent.data.reason : sent.message || sent.code);
      setState("error");
      return;
    }
    setState("done");
  };
  return (
    <div className={styles.format} data-on="">
      <span className={styles.lockTitle}>{word("boostTitle")}</span>
      {state === "done" ? (
        <p className={styles.lede}>{word("boostSigned")}</p>
      ) : (
        <>
          <p className={styles.hint}>{word("boostToggleHint")}</p>
          <Button variant="primary" onClick={() => void commit()} disabled={state === "busy"} lang={coreLang(locale)}>
            {word("boostSign")}
          </Button>
          {state === "error" ? (
            <p className={styles.problem} role="alert">
              <Warning size={16} aria-hidden /> {word("boostNotSigned")}
              {detail ? ` ${detail}` : ""}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * «Поділити свої комісії» — «Спільнота» only: the creator's part of the trading fee, the graduation fee and the locked
 * liquidity's fees, shared with up to four more wallets by shares written for ever. The creator keeps what the others
 * do not take; nothing is shared until a wallet is added.
 */
function FeeShares({
  locale,
  rows,
  problems,
  creatorBps,
  refFor,
  onChange,
  onAdd,
}: {
  locale: WorkspaceLocale;
  rows: readonly ShareRow[];
  problems: ReadonlyMap<number, ShareProblem>;
  creatorBps: number;
  refFor: (element: HTMLElement | null) => void;
  onChange: (rows: readonly ShareRow[]) => void;
  onAdd: () => void;
}) {
  const word = launchWords(locale);
  const id = useId();
  const edit = (key: number, change: Partial<Pick<ShareRow, "address" | "pct">>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const problemWord = (problem: ShareProblem) => word(problem === "ADDRESS" ? "shareErrAddress" : problem === "REPEATED" ? "shareErrRepeated" : problem === "SELF" ? "shareErrSelf" : "shareErrPct");
  const tooMuch = rows.length > 0 && creatorBps < FEE_SHARE_MIN_BPS;
  return (
    <div className={styles.feeShareBox} ref={refFor}>
      <div className={styles.lockText}>
        <span className={styles.lockTitle}>
          <Users size={18} aria-hidden /> {word("shareTitle")}
        </span>
        <span className={styles.hint}>{word("shareHint")}</span>
      </div>
      {rows.length > 0 ? (
        <ul className={styles.feeShareRows}>
          <li className={styles.feeShareRow} data-you="">
            <span className={styles.feeShareYou}>{word("shareYou")}</span>
            <span className={styles.feeSharePctFixed}>{formatBps(Math.max(creatorBps, 0), locale)}</span>
          </li>
          {rows.map((row, index) => {
            const problem = problems.get(row.key) ?? null;
            const problemId = `${id}-${row.key}-problem`;
            return (
              <li key={row.key} className={styles.feeShareRow} data-invalid={problem ? "" : undefined} data-problem={problem === "PCT" ? "share" : problem ? "address" : undefined}>
                <label className={styles.visuallyHidden} htmlFor={`${id}-${row.key}-address`}>
                  {word("shareWallet")} {index + 1}
                </label>
                {/* A field that wraps: the whole address is read before it is written for ever, on a phone too. */}
                <textarea
                  id={`${id}-${row.key}-address`}
                  className={`${styles.input} ${styles.mono} ${styles.feeShareAddress}`}
                  value={row.address}
                  placeholder={word("shareWallet")}
                  rows={1}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={problem === "ADDRESS" || problem === "REPEATED" || problem === "SELF" ? true : undefined}
                  aria-describedby={problem ? problemId : undefined}
                  onChange={(event) => edit(row.key, { address: event.target.value.replace(/\s+/g, "") })}
                />
                <span className={styles.feeShareAffixed}>
                  <label className={styles.visuallyHidden} htmlFor={`${id}-${row.key}-pct`}>
                    {word("sharePct")} {index + 1}
                  </label>
                  <input
                    id={`${id}-${row.key}-pct`}
                    className={`${styles.input} ${styles.mono}`}
                    value={row.pct}
                    inputMode="decimal"
                    placeholder="10"
                    aria-invalid={problem === "PCT" ? true : undefined}
                    aria-describedby={problem ? problemId : undefined}
                    onChange={(event) => edit(row.key, { pct: event.target.value })}
                  />
                  <span className={styles.feeShareSuffix}>%</span>
                </span>
                <button type="button" className={styles.feeShareRemove} aria-label={`${word("shareRemove")} ${index + 1}`} onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}>
                  <Trash size={18} aria-hidden />
                </button>
                {problem ? (
                  <span id={problemId} className={styles.problem}>
                    {problemWord(problem)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {tooMuch ? <span className={styles.problem}>{word("shareErrTotal")}</span> : null}
      {rows.length < FEE_SHARE_MAX_RECIPIENTS - 1 ? (
        <Button variant="secondary" icon="plus" className={styles.feeShareAdd} onClick={onAdd} lang={coreLang(locale)}>
          {word("shareAdd")}
        </Button>
      ) : null}
    </div>
  );
}
