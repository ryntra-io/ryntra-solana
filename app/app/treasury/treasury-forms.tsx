"use client";

import { Button } from "@ryntra/core/ui";
import { useMemo, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { ConfigChange, TreasuryBuildRequest, TreasuryLimit, TreasuryMember } from "@/lib/solana/treasury/contract";
import {
  AGENT_LIMIT_CAP_RAW,
  AGENT_TIME_LOCK_S,
  MAX_MEMBERS,
  PERIODS,
  TIME_LOCK_CHOICES_S,
  TREASURY_ASSETS,
  TREASURY_ASSET_IDS,
  agentIssues,
  formatRaw,
  isAddress,
  limitIssues,
  parseAmount,
  parsePayouts,
  payoutsTotal,
  treasuryIssues,
  type LimitPeriod,
  type MemberDraft,
  type TreasuryAssetId,
  type TreasuryIssue,
} from "@/lib/solana/treasury/model";

import { delayText, lang, money, short } from "./treasury-flow";
import { issueWord, treasuryWords } from "./treasury-words";
import styles from "./treasury.module.css";

const AGENT_DELAYS_S = [5 * 60, AGENT_TIME_LOCK_S.default, 30 * 60, AGENT_TIME_LOCK_S.max] as const;

const lines = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((line) => line.trim())
    .filter(Boolean);

function Issues({ issues, locale }: { issues: readonly TreasuryIssue[]; locale: WorkspaceLocale }) {
  if (issues.length === 0) return null;
  const unique = [...new Map(issues.map((issue) => [`${issue.code}:${issue.line ?? ""}`, issue])).values()];
  return (
    <ul className={styles.issues} aria-live="polite">
      {unique.slice(0, 6).map((issue) => (
        <li key={`${issue.code}:${issue.line ?? ""}:${issue.at ?? ""}`}>{issueWord(locale, issue)}</li>
      ))}
    </ul>
  );
}

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

function FormActions({ locale, onCancel, submit, busy, disabled }: { locale: WorkspaceLocale; onCancel: () => void; submit: string; busy: boolean; disabled?: boolean }) {
  const word = treasuryWords(locale);
  return (
    <div className={styles.formActions}>
      <Button variant="ghost" type="button" onClick={onCancel} lang={lang(locale)}>
        {word("cancel")}
      </Button>
      <Button variant="primary" type="submit" loading={busy} disabled={disabled} lang={lang(locale)}>
        {submit}
      </Button>
    </div>
  );
}

function DelaySelect({ id, value, onChange, choices, locale }: { id: string; value: number; onChange: (value: number) => void; choices: readonly number[]; locale: WorkspaceLocale }) {
  return (
    <select id={id} className={styles.input} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {choices.map((seconds) => (
        <option key={seconds} value={seconds}>
          {delayText(seconds, locale)}
        </option>
      ))}
    </select>
  );
}

function AssetSelect({ id, value, onChange }: { id: string; value: TreasuryAssetId; onChange: (value: TreasuryAssetId) => void }) {
  return (
    <select id={id} className={styles.input} value={value} onChange={(event) => onChange(event.target.value as TreasuryAssetId)}>
      {TREASURY_ASSET_IDS.map((asset) => (
        <option key={asset} value={asset}>
          {asset}
        </option>
      ))}
    </select>
  );
}

function PeriodSelect({ id, value, onChange, locale }: { id: string; value: LimitPeriod; onChange: (value: LimitPeriod) => void; locale: WorkspaceLocale }) {
  const word = treasuryWords(locale);
  return (
    <select id={id} className={styles.input} value={value} onChange={(event) => onChange(event.target.value as LimitPeriod)}>
      {PERIODS.map((period) => (
        <option key={period} value={period}>
          {word(`period_${period}`)}
        </option>
      ))}
    </select>
  );
}

function RoleBoxes({ member, onChange, locale, name }: { member: Pick<MemberDraft, "initiate" | "vote" | "execute">; onChange: (next: Pick<MemberDraft, "initiate" | "vote" | "execute">) => void; locale: WorkspaceLocale; name: string }) {
  const word = treasuryWords(locale);
  const roles = [
    ["initiate", word("roleInitiate")],
    ["vote", word("roleVote")],
    ["execute", word("roleExecute")],
  ] as const;
  return (
    <div className={styles.roles} role="group" aria-label={name}>
      {roles.map(([role, label]) => (
        <label key={role} className={styles.role}>
          <input type="checkbox" checked={member[role]} onChange={(event) => onChange({ ...member, [role]: event.target.checked })} />
          {label}
        </label>
      ))}
    </div>
  );
}

/** «Нова казна»: members and their roles, the votes needed, the delay. The wallet is the first member with every role. */
export function CreateForm({ wallet, locale, busy, onSubmit, onCancel }: { wallet: string; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: TreasuryBuildRequest) => void; onCancel: () => void }) {
  const word = treasuryWords(locale);
  const [members, setMembers] = useState<MemberDraft[]>([
    { address: wallet, initiate: true, vote: true, execute: true },
    { address: "", initiate: false, vote: true, execute: false },
  ]);
  const [threshold, setThreshold] = useState(2);
  const [timeLock, setTimeLock] = useState<number>(TIME_LOCK_CHOICES_S[2]);
  const [tried, setTried] = useState(false);
  const filled = members.filter((member) => member.address.trim() !== "").map((member) => ({ ...member, address: member.address.trim() }));
  const voters = filled.filter((member) => member.vote).length;
  const issues = treasuryIssues({ creator: wallet, members: filled, threshold, timeLockSeconds: timeLock });
  const set = (index: number, next: Partial<MemberDraft>) => setMembers((current) => current.map((member, at) => (at === index ? { ...member, ...next } : member)));
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (issues.length === 0) onSubmit({ kind: "create", wallet, members: filled, threshold, timeLockSeconds: timeLock });
      }}
    >
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>{word("members")}</legend>
        {members.map((member, index) => (
          <div key={index} className={styles.memberRow}>
            <input
              className={`${styles.input} ${styles.mono}`}
              aria-label={`${word("member")} ${index + 1}`}
              value={member.address}
              readOnly={index === 0}
              placeholder={word("address")}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => set(index, { address: event.target.value })}
            />
            <RoleBoxes member={member} onChange={(next) => set(index, next)} locale={locale} name={`${word("member")} ${index + 1}`} />
            {index > 0 ? (
              <button type="button" className={styles.linkButton} onClick={() => setMembers((current) => current.filter((_, at) => at !== index))}>
                {word("removeMemberRow")}
              </button>
            ) : (
              <span className={styles.hint}>{word("you")}</span>
            )}
          </div>
        ))}
        {members.length < MAX_MEMBERS ? (
          <button type="button" className={styles.linkButton} onClick={() => setMembers((current) => [...current, { address: "", initiate: false, vote: true, execute: false }])}>
            + {word("addMember")}
          </button>
        ) : null}
      </fieldset>
      <div className={styles.grid2}>
        <Field label={word("threshold")} htmlFor="treasury-threshold" hint={word("thresholdOf", { n: threshold, m: voters })}>
          <input id="treasury-threshold" className={styles.input} type="number" inputMode="numeric" min={1} max={Math.max(1, voters)} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
        </Field>
        <Field label={word("delay")} htmlFor="treasury-delay">
          <DelaySelect id="treasury-delay" value={timeLock} onChange={setTimeLock} choices={TIME_LOCK_CHOICES_S} locale={locale} />
        </Field>
      </div>
      {tried ? <Issues issues={issues} locale={locale} /> : null}
      <FormActions locale={locale} onCancel={onCancel} submit={word("review")} busy={busy} />
    </form>
  );
}

/** «Гаманець агента»: the agent's key, one limit with its recipients, a short delay — Ryntra's cap on the amount. */
export function AgentForm({ wallet, locale, busy, onSubmit, onCancel }: { wallet: string; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: TreasuryBuildRequest) => void; onCancel: () => void }) {
  const word = treasuryWords(locale);
  const [agent, setAgent] = useState("");
  const [asset, setAsset] = useState<TreasuryAssetId>("USDC");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<LimitPeriod>("day");
  const [destinations, setDestinations] = useState("");
  const [timeLock, setTimeLock] = useState<number>(AGENT_TIME_LOCK_S.default);
  const [tried, setTried] = useState(false);
  const amountRaw = parseAmount(amount, TREASURY_ASSETS[asset].decimals) ?? 0n;
  const list = lines(destinations);
  const issues = agentIssues({ creator: wallet, agent: agent.trim(), timeLockSeconds: timeLock, limit: { asset, amountRaw, period, destinations: list } });
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (issues.length === 0) onSubmit({ kind: "createAgent", wallet, agent: agent.trim(), timeLockSeconds: timeLock, asset, amountRaw: amountRaw.toString(), period, destinations: list });
      }}
    >
      <p className={styles.hint}>{word("agentLine")}</p>
      <Field label={word("agentAddress")} htmlFor="agent-key">
        <input id="agent-key" className={`${styles.input} ${styles.mono}`} value={agent} onChange={(event) => setAgent(event.target.value)} spellCheck={false} autoComplete="off" placeholder={word("address")} />
      </Field>
      <div className={styles.grid3}>
        <Field label={word("asset")} htmlFor="agent-asset">
          <AssetSelect id="agent-asset" value={asset} onChange={setAsset} />
        </Field>
        <Field label={word("amount")} htmlFor="agent-amount" hint={word("agentCap", { amount: money(AGENT_LIMIT_CAP_RAW[asset], asset, locale) })}>
          <input id="agent-amount" className={styles.input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </Field>
        <Field label={word("period")} htmlFor="agent-period">
          <PeriodSelect id="agent-period" value={period} onChange={setPeriod} locale={locale} />
        </Field>
      </div>
      <Field label={word("destinations")} htmlFor="agent-destinations" hint={word("linesHint")}>
        <textarea id="agent-destinations" className={`${styles.input} ${styles.textarea} ${styles.mono}`} value={destinations} onChange={(event) => setDestinations(event.target.value)} spellCheck={false} />
      </Field>
      <Field label={word("delay")} htmlFor="agent-delay">
        <DelaySelect id="agent-delay" value={timeLock} onChange={setTimeLock} choices={AGENT_DELAYS_S} locale={locale} />
      </Field>
      {tried ? <Issues issues={issues} locale={locale} /> : null}
      <FormActions locale={locale} onCancel={onCancel} submit={word("review")} busy={busy} />
    </form>
  );
}

/** «Пакетні виплати»: pasted lines become one proposal; the sum and the count are read back before the Review. */
export function PayoutsForm({ wallet, multisig, vault, locale, busy, onSubmit }: { wallet: string; multisig: string; vault: string; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: TreasuryBuildRequest) => void }) {
  const word = treasuryWords(locale);
  const [asset, setAsset] = useState<TreasuryAssetId>("USDC");
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const read = useMemo(() => parsePayouts(text, TREASURY_ASSETS[asset].decimals, vault, multisig), [text, asset, vault, multisig]);
  const total = payoutsTotal(read.payouts);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (read.issues.length === 0) onSubmit({ kind: "payouts", wallet, multisig, asset, payouts: read.payouts.map((payout) => ({ to: payout.to, amountRaw: payout.amountRaw.toString() })) });
      }}
    >
      <p className={styles.hint}>{word("payoutsLine")}</p>
      <div className={styles.grid2}>
        <Field label={word("asset")} htmlFor="payouts-asset">
          <AssetSelect id="payouts-asset" value={asset} onChange={setAsset} />
        </Field>
        <p className={styles.summary} aria-live="polite">
          {read.payouts.length > 0 ? word("payoutsSummary", { n: read.payouts.length, sum: money(total, asset, locale) }) : null}
        </p>
      </div>
      <textarea
        aria-label={word("payouts")}
        className={`${styles.input} ${styles.textarea} ${styles.mono}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={word("payoutsPlaceholder")}
        rows={5}
        spellCheck={false}
      />
      {tried || read.issues.some((issue) => issue.line !== undefined) ? <Issues issues={read.issues} locale={locale} /> : null}
      <div className={styles.formActions}>
        <Button variant="secondary" type="submit" loading={busy} lang={lang(locale)}>
          {word("propose")}
        </Button>
      </div>
    </form>
  );
}

/** A new spending limit, proposed: always with where it may pay. */
export function LimitForm({ wallet, multisig, locale, busy, onSubmit, onCancel }: { wallet: string; multisig: string; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: TreasuryBuildRequest) => void; onCancel: () => void }) {
  const word = treasuryWords(locale);
  const [asset, setAsset] = useState<TreasuryAssetId>("USDC");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<LimitPeriod>("month");
  const [spenders, setSpenders] = useState("");
  const [destinations, setDestinations] = useState("");
  const [tried, setTried] = useState(false);
  const amountRaw = parseAmount(amount, TREASURY_ASSETS[asset].decimals) ?? 0n;
  const draft = { asset, amountRaw, period, spenders: lines(spenders), destinations: lines(destinations) };
  const issues = limitIssues(draft);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (issues.length === 0) onSubmit({ kind: "config", wallet, multisig, change: { type: "addLimit", asset, amountRaw: amountRaw.toString(), period, spenders: draft.spenders, destinations: draft.destinations } });
      }}
    >
      <h3 className={styles.formTitle}>{word("limitTitle")}</h3>
      <div className={styles.grid3}>
        <Field label={word("asset")} htmlFor="limit-asset">
          <AssetSelect id="limit-asset" value={asset} onChange={setAsset} />
        </Field>
        <Field label={word("amount")} htmlFor="limit-amount">
          <input id="limit-amount" className={styles.input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </Field>
        <Field label={word("period")} htmlFor="limit-period">
          <PeriodSelect id="limit-period" value={period} onChange={setPeriod} locale={locale} />
        </Field>
      </div>
      <div className={styles.grid2}>
        <Field label={word("spenders")} htmlFor="limit-spenders" hint={word("linesHint")}>
          <textarea id="limit-spenders" className={`${styles.input} ${styles.textarea} ${styles.mono}`} value={spenders} onChange={(event) => setSpenders(event.target.value)} spellCheck={false} />
        </Field>
        <Field label={word("destinations")} htmlFor="limit-destinations" hint={word("linesHint")}>
          <textarea id="limit-destinations" className={`${styles.input} ${styles.textarea} ${styles.mono}`} value={destinations} onChange={(event) => setDestinations(event.target.value)} spellCheck={false} />
        </Field>
      </div>
      {tried ? <Issues issues={issues} locale={locale} /> : null}
      <FormActions locale={locale} onCancel={onCancel} submit={word("review")} busy={busy} />
    </form>
  );
}

type RulesChange = "addMember" | "removeMember" | "threshold" | "timeLock";

/** A change of the rules, proposed: a member added or removed, the votes needed, the delay. */
export function RulesForm({ wallet, multisig, members, threshold, timeLock, locale, busy, onSubmit, onCancel }: {
  wallet: string;
  multisig: string;
  members: readonly TreasuryMember[];
  threshold: number;
  timeLock: number;
  locale: WorkspaceLocale;
  busy: boolean;
  onSubmit: (request: TreasuryBuildRequest) => void;
  onCancel: () => void;
}) {
  const word = treasuryWords(locale);
  const [type, setType] = useState<RulesChange>("addMember");
  const [member, setMember] = useState<MemberDraft>({ address: "", initiate: false, vote: true, execute: false });
  const [removed, setRemoved] = useState(members.find((row) => row.address !== wallet)?.address ?? members[0]?.address ?? "");
  const [votes, setVotes] = useState(threshold);
  const [delay, setDelay] = useState(timeLock);
  const choices = TIME_LOCK_CHOICES_S.includes(timeLock as (typeof TIME_LOCK_CHOICES_S)[number]) ? TIME_LOCK_CHOICES_S : [...TIME_LOCK_CHOICES_S, timeLock].sort((a, b) => a - b);
  const change: ConfigChange =
    type === "addMember"
      ? { type, member: { ...member, address: member.address.trim() } }
      : type === "removeMember"
        ? { type, address: removed }
        : type === "threshold"
          ? { type, threshold: votes }
          : { type, seconds: delay };
  const invalid = (type === "addMember" && (!isAddress(member.address.trim()) || !(member.initiate || member.vote || member.execute))) || (type === "threshold" && votes === threshold) || (type === "timeLock" && delay === timeLock);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) onSubmit({ kind: "config", wallet, multisig, change });
      }}
    >
      <h3 className={styles.formTitle}>{word("changeRules")}</h3>
      <Field label={word("change")} htmlFor="rules-type">
        <select id="rules-type" className={styles.input} value={type} onChange={(event) => setType(event.target.value as RulesChange)}>
          {(["addMember", "removeMember", "threshold", "timeLock"] as const).map((option) => (
            <option key={option} value={option}>
              {word(`change_${option}`)}
            </option>
          ))}
        </select>
      </Field>
      {type === "addMember" ? (
        <div className={styles.memberRow}>
          <input className={`${styles.input} ${styles.mono}`} aria-label={word("member")} value={member.address} onChange={(event) => setMember({ ...member, address: event.target.value })} placeholder={word("address")} spellCheck={false} autoComplete="off" />
          <RoleBoxes member={member} onChange={(next) => setMember({ ...member, ...next })} locale={locale} name={word("member")} />
        </div>
      ) : type === "removeMember" ? (
        <select aria-label={word("member")} className={`${styles.input} ${styles.mono}`} value={removed} onChange={(event) => setRemoved(event.target.value)}>
          {members.map((row) => (
            <option key={row.address} value={row.address}>
              {short(row.address)}
              {row.address === wallet ? ` (${word("you")})` : ""}
            </option>
          ))}
        </select>
      ) : type === "threshold" ? (
        <input aria-label={word("threshold")} className={styles.input} type="number" min={1} max={members.filter((row) => row.vote).length} value={votes} onChange={(event) => setVotes(Number(event.target.value))} />
      ) : (
        <DelaySelect id="rules-delay" value={delay} onChange={setDelay} choices={choices} locale={locale} />
      )}
      <FormActions locale={locale} onCancel={onCancel} submit={word("review")} busy={busy} disabled={invalid} />
    </form>
  );
}

/** «Поповнити сховище»: the wallet sends SOL or USDC to the treasury's vault — the one action the wallet pays for itself. */
export function DepositForm({ wallet, multisig, locale, busy, onSubmit, onCancel }: { wallet: string; multisig: string; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: TreasuryBuildRequest) => void; onCancel: () => void }) {
  const word = treasuryWords(locale);
  const [asset, setAsset] = useState<TreasuryAssetId>("USDC");
  const [amount, setAmount] = useState("");
  const amountRaw = parseAmount(amount, TREASURY_ASSETS[asset].decimals);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (amountRaw !== null) onSubmit({ kind: "deposit", wallet, multisig, asset, amountRaw: amountRaw.toString() });
      }}
    >
      <div className={styles.grid2}>
        <Field label={word("asset")} htmlFor="deposit-asset">
          <AssetSelect id="deposit-asset" value={asset} onChange={setAsset} />
        </Field>
        <Field label={word("amount")} htmlFor="deposit-amount">
          <input id="deposit-amount" className={styles.input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </Field>
      </div>
      <FormActions locale={locale} onCancel={onCancel} submit={word("review")} busy={busy} disabled={amountRaw === null} />
    </form>
  );
}

/** Spending from a limit: an amount and one of its recipients. */
export function SpendForm({ wallet, multisig, limit, locale, busy, onSubmit, onCancel }: { wallet: string; multisig: string; limit: TreasuryLimit; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: TreasuryBuildRequest) => void; onCancel: () => void }) {
  const word = treasuryWords(locale);
  const asset = limit.asset === "OTHER" ? null : limit.asset;
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState(limit.destinations[0] ?? "");
  if (!asset) return null;
  const amountRaw = parseAmount(amount, TREASURY_ASSETS[asset].decimals);
  const valid = amountRaw !== null && isAddress(to.trim());
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && amountRaw !== null) onSubmit({ kind: "spend", wallet, multisig, limit: limit.address, amountRaw: amountRaw.toString(), to: to.trim() });
      }}
    >
      <div className={styles.grid2}>
        <Field label={`${word("amount")}, ${asset}`} htmlFor={`spend-${limit.address}`} hint={`${word("remaining")}: ${formatRaw(BigInt(limit.remainingRaw), TREASURY_ASSETS[asset].decimals)} ${asset}`}>
          <input id={`spend-${limit.address}`} className={styles.input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </Field>
        <Field label={word("to")} htmlFor={`spend-to-${limit.address}`}>
          {limit.destinations.length > 0 ? (
            <select id={`spend-to-${limit.address}`} className={`${styles.input} ${styles.mono}`} value={to} onChange={(event) => setTo(event.target.value)}>
              {limit.destinations.map((destination) => (
                <option key={destination} value={destination}>
                  {short(destination)}
                </option>
              ))}
            </select>
          ) : (
            <input id={`spend-to-${limit.address}`} className={`${styles.input} ${styles.mono}`} value={to} onChange={(event) => setTo(event.target.value)} spellCheck={false} />
          )}
        </Field>
      </div>
      <FormActions locale={locale} onCancel={onCancel} submit={word("review")} busy={busy} disabled={!valid} />
    </form>
  );
}
