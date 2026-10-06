"use client";

import { ArrowSquareOut, CaretDown, CheckCircle, CircleNotch, ImageSquare, Lock, LockOpen, PaperPlaneTilt, Plus, Trash, Users, Warning, Wallet } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { LaunchBuildResponse, LaunchMetadataResponse, LaunchPresetsResponse, LaunchPresetView, LaunchQuoteResponse, LaunchSubmitResponse, LaunchTokenResponse } from "@/lib/api/v1/contract";
import { FEE_SHARE_MAX_RECIPIENTS, FEE_SHARE_MIN_BPS, FEE_SHARE_TOTAL_BPS, withCreatorShare } from "@/lib/core/launch/fee-shares";
import { checkLaunchForm, imageTypeOf, IMAGE_MAX_BYTES, type FieldProblem, type LaunchFormFields } from "@/lib/launch/form";
import { signTransactions } from "@/lib/solana/wallet.client";

import { formatBps, formatDate, formatDuration, formatNumber, formatPercent, formatRaw, fromRaw, toRaw } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";
import { ShareLink } from "../share-link";

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
type Picture = Readonly<{ url: string; base64: string; bytes: number }>;
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
const API_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
const SUPPLY_RAW = 1_000_000_000n * 1_000_000n;
/* Before the build, the network cost as measured on devnet (05.10–06.10): the creation's rent and fee, with the lock its rent too, with the sharing of the creator's fees the vault's two accounts; the build replaces it with the simulated figure. */
const COST_ESTIMATE_SOL = { plain: "0.010", locked: "0.014", shared: "0.018", sharedLocked: "0.022" } as const;

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

/** The picture shrunk to a 512 px square (centre crop), as WebP — or PNG where the browser cannot write WebP — under the size the server takes. */
async function shrinkPicture(file: File): Promise<Picture | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!imageTypeOf(head)) return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  for (const [type, quality] of [["image/webp", 0.9], ["image/webp", 0.75], ["image/png", undefined], ["image/jpeg", 0.85]] as const) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob || blob.size > IMAGE_MAX_BYTES) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!imageTypeOf(bytes)) continue;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary);
    /* A data: address, not a blob: one — the product's content policy shows images from itself and data: only. */
    return { url: `data:${imageTypeOf(bytes)};base64,${base64}`, base64, bytes: bytes.length };
  }
  return null;
}

export function LaunchFlow({ locale, presets }: { locale: WorkspaceLocale; presets: LaunchPresetsResponse }) {
  const word = launchWords(locale);
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  const [fields, setFields] = useState<LaunchFormFields>(EMPTY);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [pictureBad, setPictureBad] = useState(false);
  /* «Захищений» first where the network has it: the plan's default against snipers. */
  const [presetId, setPresetId] = useState(presets.presets.find((entry) => entry.id === "protected")?.id ?? presets.presets[0]?.id ?? "classic");
  const [buyText, setBuyText] = useState("");
  const [lockId, setLockId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [many, setMany] = useState(false);
  const [manyWithSplit, setManyWithSplit] = useState(false);
  const [covered, setCovered] = useState<string | null>(null);
  const [result, setResult] = useState<{ submit: LaunchSubmitResponse; token: LaunchTokenResponse | null; symbol: string; image: string | null } | null>(null);
  const [quote, setQuote] = useState<Quote>({ amountRaw: "0", data: null, loading: false });
  const [shares, setShares] = useState<readonly ShareRow[]>([]);
  const [nextShareKey, setNextShareKey] = useState(1);
  const firstError = useRef<HTMLElement | null>(null);

  const preset = presets.presets.find((entry) => entry.id === presetId) ?? presets.presets[0];
  const check = useMemo(() => checkLaunchForm(fields), [fields]);
  const buyRaw = preset ? toRaw(buyText, preset.pair.decimals) : null;
  const buying = buyRaw !== null && buyRaw > 0n;

  /* The first buy quoted on the fresh curve: the tokens it gets and the most it may spend. */
  useEffect(() => {
    if (!preset || buyRaw === null) return;
    const amountRaw = buyRaw.toString();
    setQuote((current) => ({ amountRaw, data: current.data?.preset === preset.id ? current.data : null, loading: true }));
    const timer = window.setTimeout(async () => {
      const read = await api<LaunchQuoteResponse>("/api/v1/launch/quote", { method: "POST", body: JSON.stringify({ preset: preset.id, amountRaw }) });
      setQuote((current) => (current.amountRaw === amountRaw ? { amountRaw, data: read.ok ? read.data : null, loading: false } : current));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [preset, buyRaw]);

  useEffect(() => {
    if (!buying) setLockId(null);
  }, [buying]);

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
  const shown = (key: keyof LaunchFormFields) => {
    const problem = problemOf(key);
    if (!problem) return undefined;
    /* A borrowed name is said at once; an empty field only after the first press. */
    if (problem === "BORROWED" || problem === "TOO_LONG" || problem === "SYMBOL_CHARS") return problem;
    if (problem === "LINK" && fields[key].trim()) return problem;
    return attempted ? problem : undefined;
  };
  const problemText = (key: keyof LaunchFormFields, problem: FieldProblem) => {
    if (problem === "BORROWED") return word("errBorrowed", { label: check.hits.find((hit) => hit.field === key)?.label ?? "" });
    if (problem === "REQUIRED") return word("errRequired");
    if (problem === "TOO_LONG") return word("errTooLong");
    if (problem === "SYMBOL_CHARS") return word("errSymbolChars");
    return word(key === "x" ? "errLinkX" : key === "telegram" ? "errLinkTelegram" : "errLink");
  };
  /* «Спільнота» alone shares the creator's fees; another preset sends none. */
  const sharing = preset?.id === "community" && shares.length > 0;
  const shareCheck = useMemo(() => checkShares(shares, connection?.address ?? null), [shares, connection?.address]);
  const sharesValid = !sharing || (shareCheck.problems.size === 0 && shareCheck.creatorBps >= FEE_SHARE_MIN_BPS);
  const valid = Object.keys(check.problems).length === 0 && picture !== null && buyRaw !== null && !aboveCap && sharesValid;

  const launch = useCallback(async () => {
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
    setPhase("prepare");
    const failed = (step: "before" | "send", answer: Readonly<{ code: string; message: string }>) => {
      setFailure({ step, code: answer.code, detail: answer.message || null, token: null });
      setPhase("error");
    };
    const metadata = await api<LaunchMetadataResponse>("/api/v1/launch/metadata", { method: "POST", body: JSON.stringify({ ...fields, imageBase64: picture?.base64 ?? "" }) });
    if (!metadata.ok) return failed("before", metadata);
    const built = await api<LaunchBuildResponse>("/api/v1/launch/build", {
      method: "POST",
      body: JSON.stringify({
        creator: connection.address,
        preset: preset.id,
        metadataUri: metadata.data.metadataUri,
        firstBuyRaw: (buyRaw ?? 0n).toString(),
        lock: buying ? lockId : null,
        ...(sharing ? { feeShares: withCreatorShare(connection.address, shares.map((row) => ({ address: row.address.trim(), bps: pctToBps(row.pct) ?? 0 }))) } : {}),
      }),
    });
    if (!built.ok) return failed("before", built);
    const lockWire = built.data.lockUnsignedWireBase64 ?? null;
    const splitWire = built.data.splitUnsignedWireBase64 ?? null;
    const wires = [built.data.unsignedWireBase64, ...(lockWire ? [lockWire] : []), ...(splitWire ? [splitWire] : [])];
    setMany(wires.length > 1);
    setManyWithSplit(Boolean(splitWire));
    setCovered(built.data.creatorCostLamports);
    setPhase("sign");
    const signed = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wires, chain: built.data.network });
    if (!signed.ok) return failed("before", { code: "WALLET_REFUSED", message: signed.reason });
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
    setPhase("done");
  }, [valid, preset, connection, reach, fields, picture, buyRaw, buying, lockId, sharing, shares]);

  const reset = () => {
    setFields(EMPTY);
    setPicture(null);
    setBuyText("");
    setLockId(null);
    setShares([]);
    setAttempted(false);
    setResult(null);
    setCovered(null);
    setPhase("form");
  };

  if (!preset) return null;
  firstError.current = null;
  const errorRef = (problem: unknown) => (element: HTMLElement | null) => {
    if (problem && element && !firstError.current) firstError.current = element;
  };

  if (phase === "done" && result) {
    return (
      <div className={styles.page}>
        <Success locale={locale} result={result} onAnother={reset} />
      </div>
    );
  }

  const busy = phase === "prepare" || phase === "sign" || phase === "send";
  const lock = presets.locks.find((entry) => entry.id === lockId) ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headRow}>
          <h1 className={styles.title}>{word("title")}</h1>
          {presets.network === "solana:devnet" ? (
            <span className={styles.netChip} title={word("devnetHint")}>
              {word("devnet")}
            </span>
          ) : null}
        </div>
        <p className={styles.lede}>{word("lede")}</p>
      </header>

      <div className={styles.layout}>
        <form className={styles.form} onSubmit={(event) => event.preventDefault()} noValidate aria-busy={busy}>
          <fieldset className={styles.section} disabled={busy}>
            <legend className={styles.sectionTitle}>{word("sectionToken")}</legend>
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

          <fieldset className={styles.section} disabled={busy}>
            <legend className={styles.sectionTitle}>
              {word("sectionLinks")} <span className={styles.optional}>{word("optional")}</span>
            </legend>
            <div className={styles.links}>
              {(["website", "x", "telegram"] as const).map((key) => (
                <Field key={key} label={word(key)} problem={shown(key) ? problemText(key, shown(key)!) : null} refFor={errorRef(shown(key))}>
                  {(id, described) => <input id={id} aria-describedby={described} className={styles.input} value={fields[key]} onChange={set(key)} placeholder={key === "website" ? "example.com" : key === "x" ? "x.com/…" : "t.me/…"} inputMode="url" autoComplete="off" />}
                </Field>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.section} disabled={busy}>
            <legend className={styles.sectionTitle}>{word("sectionPreset")}</legend>
            <div className={styles.presets} role="radiogroup" aria-label={word("sectionPreset")}>
              {presets.presets.map((entry) => (
                <PresetCard key={entry.id} preset={entry} locale={locale} selected={entry.id === preset.id} onSelect={() => setPresetId(entry.id)} />
              ))}
            </div>
            <PresetDetails preset={preset} locale={locale} />
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
          </fieldset>

          <fieldset className={styles.section} disabled={busy}>
            <legend className={styles.sectionTitle}>
              {word("sectionBuy")} <span className={styles.optional}>{word("optional")}</span>
            </legend>
            <p className={styles.hint}>{word("buyHint")}</p>
            <BuyField locale={locale} preset={preset} text={buyText} onText={setBuyText} quote={quoteData} loading={quote.loading} aboveCap={aboveCap} invalid={buyRaw === null} refFor={errorRef(aboveCap || buyRaw === null)} />
            {buying ? (
              <div className={styles.lockBox} data-on={lockId ? "" : undefined}>
                <label className={styles.lockToggle}>
                  <input type="checkbox" checked={lockId !== null} onChange={(event) => setLockId(event.target.checked ? presets.locks[0]?.id ?? null : null)} />
                  <span className={styles.lockIcon} aria-hidden>
                    {lockId ? <Lock size={18} weight="fill" /> : <LockOpen size={18} />}
                  </span>
                  <span className={styles.lockText}>
                    <span className={styles.lockTitle}>{word("lockTitle")}</span>
                    <span className={styles.hint}>{word("lockHint")}</span>
                  </span>
                </label>
                {lockId ? (
                  <>
                    <div className={styles.segments} role="radiogroup" aria-label={word("lockTitle")}>
                      {presets.locks.map((entry) => (
                        <button key={entry.id} type="button" role="radio" aria-checked={entry.id === lockId} className={styles.segment} onClick={() => setLockId(entry.id)}>
                          {word("lockSchedule", { cliff: periodWord(entry.cliffDays, locale), vest: periodWord(entry.vestDays, locale) })}
                        </button>
                      ))}
                    </div>
                    {lock ? <p className={styles.hint}>{word("lockUntil", { date: formatDate(Date.now() + lock.cliffDays * 86_400_000, locale), end: formatDate(Date.now() + (lock.cliffDays + lock.vestDays) * 86_400_000, locale) })}</p> : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        </form>

        <aside className={styles.aside}>
          <div className={styles.asideSticky}>
            {picture || check.clean.name ? <PreviewCard locale={locale} picture={picture?.url ?? null} name={check.clean.name} symbol={check.clean.symbol} preset={preset} /> : null}
            <section className={styles.review} aria-label={word("review")}>
              <h2 className={styles.reviewTitle}>{word("review")}</h2>
              <dl className={styles.rows}>
                <Row label={word("reviewNetwork")} value={presets.network === "solana:devnet" ? "Solana Devnet" : "Solana"} />
                <Row label={word("reviewPreset")} value={preset.name[locale]} />
                <Row label={word("reviewBuy")} value={buying && buyRaw !== null ? `${fromRaw(buyRaw, preset.pair.decimals)} ${preset.pair.symbol}` : word("buyNone")} />
                {buying ? <Row label={word("reviewLock")} value={lock ? word("lockSchedule", { cliff: periodWord(lock.cliffDays, locale), vest: periodWord(lock.vestDays, locale) }) : word("reviewNoLock")} /> : null}
                {preset.id === "community" ? (
                  <Row label={word("reviewShare")} value={sharing ? word("reviewShareValue", { you: formatBps(Math.max(shareCheck.creatorBps, 0), locale), n: shares.length }) : word("reviewShareNone")} />
                ) : null}
                <Row label={word("reviewRent")} value={covered ? word("reviewRentExact", { sol: fromRaw(covered, 9, 6) }) : word("reviewRentValue", { sol: sharing ? (lockId && buying ? COST_ESTIMATE_SOL.sharedLocked : COST_ESTIMATE_SOL.shared) : lockId && buying ? COST_ESTIMATE_SOL.locked : COST_ESTIMATE_SOL.plain })} />
              </dl>
              <p className={styles.fixed}>
                <Warning size={16} aria-hidden /> {word("reviewFixed")}
              </p>
              {busy ? (
                <Progress locale={locale} phase={phase} many={many} split={manyWithSplit} />
              ) : (
                <button type="button" className={`rw-btn rw-btn--primary ${styles.cta}`} onClick={launch}>
                  {connection ? <PaperPlaneTilt size={18} weight="fill" aria-hidden /> : <Wallet size={18} aria-hidden />}
                  {connection ? word("launch") : word("connect")}
                </button>
              )}
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
            </section>
          </div>
        </aside>
      </div>
    </div>
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
    case "LAUNCH_LIMIT":
      return word("errLimit");
    case "LAUNCH_PAUSED":
    case "RATE_LIMITED":
      return word("errPaused");
    case "LAUNCH_FIRST_BUY_ABOVE_CAP":
      return word("errAboveCap");
    case "LAUNCH_BUILD_EXPIRED":
      return word("errExpired");
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

function PresetCard({ preset, locale, selected, onSelect }: { preset: LaunchPresetView; locale: WorkspaceLocale; selected: boolean; onSelect: () => void }) {
  const word = launchWords(locale);
  return (
    <button type="button" role="radio" aria-checked={selected} className={styles.preset} onClick={onSelect}>
      <span className={styles.presetHead}>
        <span className={styles.presetName}>{preset.name[locale]}</span>
        <span className={styles.radio} aria-hidden />
      </span>
      <span className={styles.presetFacts}>
        <span>{word("presetSniper", { start: formatBps(preset.sniperFee.startBps, locale), end: formatBps(preset.sniperFee.endBps, locale), time: formatDuration(preset.sniperFee.seconds, locale) })}</span>
        <span>{word("presetCreator", { pct: formatPercent(preset.creatorTradingFeePct, locale, 0) })}</span>
        <span>{word("presetCap", { pct: formatBps(preset.firstBuyCapBps, locale) })}</span>
        {preset.pair.symbol !== "USDC" ? <span className={styles.presetPair}>{word("presetPair", { symbol: preset.pair.symbol })}</span> : null}
      </span>
    </button>
  );
}

function PresetDetails({ preset, locale }: { preset: LaunchPresetView; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        {word("presetDetails")} <CaretDown size={14} aria-hidden className={styles.caret} />
      </summary>
      <dl className={styles.rows}>
        <Row label={word("presetCurve")} value={`$${formatNumber(preset.startMarketCapUsd, locale)} → $${formatNumber(preset.graduationMarketCapUsd, locale)}`} />
        <Row label={word("presetGraduation")} value={word("presetGraduationValue", { pct: formatPercent(preset.graduationFee.pct, locale, 0), creator: formatPercent(preset.graduationFee.creatorPct, locale, 0) })} />
        <Row label={word("presetLp")} value={word("presetLpValue")} />
        <Row label={word("presetToken")} value={word("presetTokenValue")} />
      </dl>
    </details>
  );
}

function BuyField({
  locale,
  preset,
  text,
  onText,
  quote,
  loading,
  aboveCap,
  invalid,
  refFor,
}: {
  locale: WorkspaceLocale;
  preset: LaunchPresetView;
  text: string;
  onText: (value: string) => void;
  quote: LaunchQuoteResponse | null;
  loading: boolean;
  aboveCap: boolean;
  invalid: boolean;
  refFor: (element: HTMLElement | null) => void;
}) {
  const word = launchWords(locale);
  const id = useId();
  const decimals = preset.pair.decimals;
  const capPct = formatBps(preset.firstBuyCapBps, locale);
  const maxIn = quote ? fromRaw(quote.maxAmountInRaw, decimals, 2) : null;
  const tokens = quote && BigInt(quote.tokensOutRaw) > 0n ? quote.tokensOutRaw : null;
  return (
    <div className={styles.field} data-invalid={aboveCap || invalid ? "" : undefined} ref={refFor}>
      <span className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {word("buyAmount")}
        </label>
        {maxIn ? (
          <span className={styles.count}>
            {word("buyCap", { amount: formatNumber(Number(maxIn), locale, 2), symbol: preset.pair.symbol, pct: capPct })}
          </span>
        ) : null}
      </span>
      <div className={styles.affixed}>
        <input id={id} className={`${styles.input} ${styles.mono}`} value={text} onChange={(event) => onText(event.target.value)} inputMode="decimal" placeholder="0" autoComplete="off" />
        <span className={styles.suffix}>{preset.pair.symbol}</span>
        {maxIn ? (
          <button type="button" className={styles.maxChip} onClick={() => onText(maxIn)}>
            {word("buyMax")}
          </button>
        ) : null}
      </div>
      <span className={aboveCap || invalid ? styles.problem : styles.hint} aria-live="polite">
        {invalid
          ? word("errAmount")
          : aboveCap && maxIn
            ? word("buyAboveCap", { amount: formatNumber(Number(maxIn), locale, 2), symbol: preset.pair.symbol })
            : loading && text.trim()
              ? word("buyQuoting")
              : tokens
                ? word("buyGets", { tokens: formatRaw(tokens, 6, locale, 0), pct: formatPercent(Number((BigInt(tokens) * 1_000_000n) / SUPPLY_RAW) / 10_000, locale, 2) })
                : " "}
      </span>
    </div>
  );
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

function Progress({ locale, phase, many, split }: { locale: WorkspaceLocale; phase: Phase; many: boolean; split: boolean }) {
  const word = launchWords(locale);
  const steps: readonly { id: Phase; label: LaunchWordKey }[] = [
    { id: "prepare", label: "stepPrepare" },
    { id: "sign", label: split ? "stepSignAll" : many ? "stepSignMany" : "stepSign" },
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

function Success({ locale, result, onAnother }: { locale: WorkspaceLocale; result: { submit: LaunchSubmitResponse; token: LaunchTokenResponse | null; symbol: string; image: string | null }; onAnother: () => void }) {
  const word = launchWords(locale);
  const pending = result.submit.state === "PENDING";
  const lockFailed = result.submit.lock?.state === "FAILED" && result.token?.lock?.state !== "LOCKED" && !pending;
  /* The token's read, made after the send, outranks the send's own word: an escrow already seen is locked. */
  const lockPending = result.submit.lock?.state === "PENDING" && result.token?.lock?.state !== "LOCKED";
  /* The same for the sharing of the creator's fees: the token's read settles it from the curve's own creator. */
  const sharingState = result.token?.feeSharing?.state ?? result.submit.feeSharing?.state ?? null;
  return (
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
      <h1 className={styles.successTitle}>{word(pending ? "pendingTitle" : "successTitle", { symbol: result.symbol })}</h1>
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
      {result.token ? <ShareLink link={result.token.shareLink} symbol={result.symbol} locale={locale} /> : null}
      <div className={styles.successActions}>
        <Link className="rw-btn rw-btn--primary" href={result.submit.tokenPath}>
          {word("openToken")} <ArrowSquareOut size={16} aria-hidden />
        </Link>
        <Link className="rw-btn" href="/app/launch/mine">
          {word("mineTitle")}
        </Link>
        <button type="button" className="rw-btn" onClick={onAnother}>
          {word("launchAnother")}
        </button>
      </div>
    </section>
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
        <button type="button" className={`rw-btn ${styles.feeShareAdd}`} onClick={onAdd}>
          <Plus size={16} aria-hidden /> {word("shareAdd")}
        </button>
      ) : null}
    </div>
  );
}
