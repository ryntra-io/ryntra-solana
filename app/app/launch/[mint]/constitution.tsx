"use client";

import { ArrowSquareOut, CaretDown, Copy } from "@phosphor-icons/react";
import { Block, Button } from "@ryntra/core/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import {
  CONSTITUTION_ENFORCEMENT,
  CONSTITUTION_SECTIONS,
  constitutionFields,
  type ConstitutionEnforcement,
  type ConstitutionField,
  type ConstitutionSection,
  type ConstitutionValue,
  type MarketConstitution,
} from "@/lib/core/launch/constitution";

import { coreLang } from "../launch-blocks";
import { explorerUrl, formatBps, formatDate, formatRaw, shortAddress } from "../launch-format";
import styles from "../launch.module.css";
import { constitutionWords, hasConstitutionWord } from "./constitution-words";

type Word = ReturnType<typeof constitutionWords>;
type Network = "solana:mainnet" | "solana:devnet";

/** What `GET /api/launch/{mint}/constitution` answers. */
type Answer = Readonly<{ state: "READ"; schema: string; sha256: string; document: MarketConstitution; observedAt: string }> | Readonly<{ state: "UNREAD" | "REFUSED"; reason: string }>;
type Read = Answer | "reading" | "failed";

/** The sections open at first: who issued it, the token, its supply, and where every fee goes — read before a purchase. */
const OPEN: ReadonlySet<ConstitutionSection> = new Set(["issuer", "token", "distribution", "fees"]);
/** Each mark drawn as «Правила програм» draws its rules: a program's filled, Ryntra's outlined, the rest quiet. */
const CHIP: Readonly<Record<ConstitutionEnforcement, string>> = { ONCHAIN_RULE: "rule", SERVER_POLICY: "policy", INFORMATIONAL: "info", NOT_IMPLEMENTED: "none" };

export type ConstitutionUnits = Readonly<{ symbol: string; decimals: number; pairSymbol: string; pairDecimals: number }>;

/**
 * «Конституція ринку» (MOS-1): the market's `ryntra.market-constitution/1`, read from the chain by the server — every
 * field with who keeps it and where to check it, the document's SHA-256 and its canonical JSON one press away. A field
 * not known is said as not known, never as zero; nothing here promises a price.
 */
export function MarketConstitutionBlock({ mint, network, locale, units }: { mint: string; network: Network; locale: WorkspaceLocale; units: ConstitutionUnits }) {
  const word = constitutionWords(locale);
  const [read, setRead] = useState<Read>("reading");
  /* The sections a person opened stay open whatever re-renders the block. */
  const [opened, setOpened] = useState<ReadonlySet<ConstitutionSection>>(OPEN);
  const load = useCallback(async () => {
    setRead("reading");
    try {
      const answer = await fetch(`/api/launch/${mint}/constitution`, { cache: "no-store" });
      const body = (await answer.json()) as Answer;
      setRead(body && (body.state === "READ" || body.state === "UNREAD" || body.state === "REFUSED") ? body : "failed");
    } catch {
      setRead("failed");
    }
  }, [mint]);
  useEffect(() => {
    void load();
  }, [load]);

  const lang = coreLang(locale);
  if (read === "reading" || read === "failed" || read.state !== "READ") {
    return (
      <Block title={word("title")} titleAs="h2" lang={lang} id="launch-constitution" aria-busy={read === "reading"}>
        <p className={styles.unread}>{read === "reading" ? word("reading") : typeof read === "object" && read.state === "REFUSED" ? word("refused") : word("unread")}</p>
        {read === "reading" ? null : (
          <div>
            <Button variant="ghost" onClick={() => void load()}>
              {word("readAgain")}
            </Button>
          </div>
        )}
      </Block>
    );
  }

  const { document, sha256 } = read;
  const fields = constitutionFields(document);
  const count = (enforcement: ConstitutionEnforcement) => fields.filter((entry) => entry.field.enforcement === enforcement).length;
  return (
    <Block title={word("title")} titleAs="h2" lang={lang} id="launch-constitution">
      <p className={styles.cellSub}>{word("lede")}</p>
      <div className={styles.constitutionMeta}>
        <span className={styles.addr} translate="no">
          {document.schema}
        </span>
        <span>
          {word("version", { n: document.version })} · {word("revision", { n: document.policyRevision })}
        </span>
        <Sha sha256={sha256} word={word} />
        <a className={styles.markLink} href={`/api/launch/${mint}/constitution?format=canonical`} target="_blank" rel="noreferrer noopener">
          {word("canonical")} <ArrowSquareOut size={12} aria-hidden />
        </a>
      </div>
      <p className={styles.cellSub}>{word("counts", { rule: count("ONCHAIN_RULE"), policy: count("SERVER_POLICY"), info: count("INFORMATIONAL"), none: count("NOT_IMPLEMENTED") })}</p>
      <p className={styles.constitutionNoPrice}>{word("noPrice")}</p>

      {CONSTITUTION_SECTIONS.map((section) => (
        <details
          key={section}
          className={styles.details}
          open={opened.has(section)}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setOpened((now) => (open === now.has(section) ? now : open ? new Set([...now, section]) : new Set([...now].filter((entry) => entry !== section))));
          }}
          id={`launch-constitution-${section}`}
        >
          <summary className={styles.summary}>
            {word(`s_${section}`)} <CaretDown size={14} aria-hidden className={styles.caret} />
          </summary>
          <ul className={styles.ruleList}>
            {Object.entries(document[section]).map(([key, field]) => (
              <FieldRow key={key} section={section} name={key} field={field} network={network} locale={locale} units={units} word={word} />
            ))}
          </ul>
        </details>
      ))}

      <details className={styles.details}>
        <summary className={styles.summary}>
          {word("legendOpen")} <CaretDown size={14} aria-hidden className={styles.caret} />
        </summary>
        <ul className={styles.defList}>
          {CONSTITUTION_ENFORCEMENT.map((enforcement) => (
            <li key={enforcement}>
              <strong>{word(`e_${enforcement}`)}</strong> — {word(`eh_${enforcement}`)}
            </li>
          ))}
          <li>{word("hashHint")}</li>
        </ul>
      </details>
    </Block>
  );
}

/** The document's hash: its first characters, the whole on a press to copy. */
function Sha({ sha256, word }: { sha256: string; word: Word }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <span className={styles.constitutionSha}>
      <span className={styles.addr} title={sha256} translate="no">
        {word("hash")} {sha256.slice(0, 12)}…
      </span>
      <button
        type="button"
        className={styles.markLink}
        aria-label={`${word("copy")} ${word("hash")}`}
        onClick={() => {
          void navigator.clipboard?.writeText(sha256).then(() => setCopied(true), () => undefined);
        }}
      >
        <Copy size={12} aria-hidden /> {copied ? word("copied") : word("copy")}
      </button>
    </span>
  );
}

function FieldRow({ section, name, field, network, locale, units, word }: { section: ConstitutionSection; name: string; field: ConstitutionField; network: Network; locale: WorkspaceLocale; units: ConstitutionUnits; word: Word }) {
  const labelKey = `f_${section}_${name}`;
  const label = hasConstitutionWord(labelKey) ? word(labelKey) : name;
  return (
    <li className={`${styles.ruleRow} ${styles.constitutionRow}`}>
      <span className={styles.enforceChip} data-enforcement={CHIP[field.enforcement]} title={word(`eh_${field.enforcement}`)}>
        {word(`e_${field.enforcement}`)}
      </span>
      <span className={styles.ruleText}>
        <span className={styles.cellSub}>{label}</span>
        <span className={styles.constitutionValue}>{valueOf(section, name, field, network, locale, units, word)}</span>
        {/* A policy names the code that runs it, said in text — not only on hover. */}
        {field.source.kind === "code" || field.source.kind === "program" ? (
          <span className={styles.constitutionCodeRef} translate="no">
            {field.source.kind === "code" ? field.source.id.split("/").pop() : shortAddress(field.source.id)} · {field.source.field}
          </span>
        ) : null}
      </span>
      <Source field={field} network={network} label={label} word={word} />
    </li>
  );
}

/** Where to check a field: its account or transaction on the explorer, a program's constant, or Ryntra's code by name. */
function Source({ field, network, label, word }: { field: ConstitutionField; network: Network; label: string; word: Word }) {
  const source = field.source;
  if (source.kind === "account" || source.kind === "tx") {
    return (
      <a className={styles.markLink} href={explorerUrl(network, source.kind, source.id)} target="_blank" rel="noreferrer noopener" title={source.field} aria-label={`${word("view")}: ${label} — ${source.field}`}>
        {word("view")} <ArrowSquareOut size={12} aria-hidden />
      </a>
    );
  }
  if (source.kind === "program") {
    return (
      <a className={styles.markLink} href={explorerUrl(network, "account", source.id)} target="_blank" rel="noreferrer noopener" title={`${word("sourceProgram")}: ${source.field}`} aria-label={`${word("view")}: ${label} — ${source.field}`}>
        {word("view")} <ArrowSquareOut size={12} aria-hidden />
      </a>
    );
  }
  if (source.kind === "code") {
    return (
      <span className={styles.constitutionCode} title={`${source.id} · ${source.field}`}>
        {word("sourceCode")}
      </span>
    );
  }
  return <span />;
}

/** A duration in the largest whole unit it fills. */
function duration(seconds: number, word: Word): string {
  if (seconds % 86_400 === 0 && seconds >= 86_400) return word("day", { n: seconds / 86_400 });
  if (seconds % 3_600 === 0 && seconds >= 3_600) return word("hour", { n: seconds / 3_600 });
  if (seconds % 60 === 0 && seconds >= 60) return word("minute", { n: seconds / 60 });
  return word("second", { n: seconds });
}

function codeWord(code: string, word: Word): string {
  const key = `v_${code}`;
  return hasConstitutionWord(key) ? word(key) : code;
}

function AddressLink({ address, network }: { address: string; network: Network }) {
  return (
    <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(network, "account", address)} target="_blank" rel="noreferrer noopener" title={address}>
      {shortAddress(address)}
    </a>
  );
}

/** A field's value in a person's words, by its unit; not known — said as not known; none — said as none. */
function valueOf(section: ConstitutionSection, name: string, field: ConstitutionField, network: Network, locale: WorkspaceLocale, units: ConstitutionUnits, word: Word): ReactNode {
  if (!field.known) {
    const why = `u_${field.unknown}`;
    return <span className={styles.cellUnread}>{hasConstitutionWord(why) ? word(why) : word("e_NOT_IMPLEMENTED")}</span>;
  }
  const value = field.value;
  if (value === null) {
    if (section === "budget" && name === "sources") return word("budgetNone");
    if (section === "distribution" && name === "creatorLock") return word("lockNone");
    if (section === "distribution" && name === "creatorLockRequired") return word("notRequired");
    if (section === "recipients" && name === "creatorFeeShares") return word("creatorRoleNow");
    return word("none");
  }
  const tokens = (raw: string) => `${formatRaw(raw, units.decimals, locale, BigInt(raw) >= 10n ** BigInt(units.decimals + 3) ? 0 : 2)} $${units.symbol}`;
  switch (field.unit) {
    case "address":
      return typeof value === "string" ? <AddressLink address={value} network={network} /> : String(value);
    case "token-raw":
      return tokens(String(value));
    case "quote-raw":
      return `${formatRaw(String(value), units.pairDecimals, locale, 2)} ${units.pairSymbol}`;
    case "lamports":
      return `${formatRaw(String(value), 9, locale, 2)} SOL`;
    case "bps":
      return formatBps(Number(value), locale);
    case "pct":
      return formatBps(Number(value) * 100, locale);
    case "seconds":
      return duration(Number(value), word);
    case "time":
      return formatDate(String(value), locale);
    case "count":
      return String(value);
    case "x100":
      return `×${(Number(value) / 100).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 2 })}`;
    case "flag":
      return value ? word("yes") : word("no");
    case "code":
      if (typeof value === "string" && value.startsWith("/")) {
        return (
          <a className={`${styles.markLink} ${styles.addr}`} href={value} translate="no">
            {value.length > 36 ? `${value.slice(0, 18)}…${value.slice(-14)}` : value}
          </a>
        );
      }
      return codeWord(String(value), word);
    case "list":
      return listOf(section, name, value, network, locale, word, tokens);
  }
}

function listOf(section: ConstitutionSection, name: string, value: ConstitutionValue, network: Network, locale: WorkspaceLocale, word: Word, tokens: (raw: string) => string): ReactNode {
  const record = (entry: ConstitutionValue) => (entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Readonly<Record<string, ConstitutionValue>>) : {});
  if (section === "distribution" && name === "creatorLock") {
    const lock = record(value);
    if (lock.rule === false) {
      return (
        <>
          {word("lockNotRule")} · <AddressLink address={String(lock.escrow)} network={network} />
        </>
      );
    }
    return (
      <>
        {word("lockValue", { amount: tokens(String(lock.lockedRaw)), date: formatDate(String(lock.endsAt), locale) })} · <AddressLink address={String(lock.escrow)} network={network} />
      </>
    );
  }
  if (!Array.isArray(value)) return JSON.stringify(value);
  if (section === "recipients" && name === "creatorFeeShares") {
    return (
      <span className={styles.constitutionList}>
        {value.map((entry) => {
          const share = record(entry);
          return (
            <span key={String(share.address)}>
              <AddressLink address={String(share.address)} network={network} /> — {formatBps(Number(share.bps), locale)}
            </span>
          );
        })}
      </span>
    );
  }
  if (section === "changelog") {
    return (
      <span className={styles.constitutionList}>
        {value.map((entry) => {
          const row = record(entry);
          return (
            <span key={String(row.version)}>
              v{String(row.version)} · {codeWord(String(row.event), word)}
              {row.at ? ` · ${formatDate(String(row.at), locale)}` : ""} ·{" "}
              <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(network, "tx", String(row.tx))} target="_blank" rel="noreferrer noopener" title={String(row.tx)}>
                {shortAddress(String(row.tx))}
              </a>
            </span>
          );
        })}
      </span>
    );
  }
  if (section === "lifecycle") {
    return (
      <span className={styles.constitutionList}>
        {value.map((entry) => {
          const row = record(entry);
          const product = `p_${String(row.product)}`;
          const reason = row.reason ? `r_${String(row.reason)}` : null;
          return (
            <span key={String(row.state)}>
              <span className={styles.addr} translate="no">
                {String(row.state)}
              </span>{" "}
              → {hasConstitutionWord(product) ? word(product) : String(row.product)}
              {reason && hasConstitutionWord(reason) ? ` (${word(reason)})` : ""}
            </span>
          );
        })}
      </span>
    );
  }
  return value.map((entry) => (typeof entry === "string" ? codeWord(entry, word) : JSON.stringify(entry))).join(" · ");
}
