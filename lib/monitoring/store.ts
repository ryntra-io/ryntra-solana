/**
 * Durable monitoring records in the Guard store.
 *
 * Keys are prefixed by the proven wallet so a scan cannot read another
 * person's monitors, inbox or devices. Trigger identities are claimed with
 * insertIfAbsent — a retry of the same crossing is not a second alert.
 */

import { randomBytes } from "node:crypto";

import type { GuardStore } from "../guard/store.ts";
import type { Finding, FindingFacts, ConditionKind, FindingOutcome, MonitorStatus, Observation } from "./engine.ts";
import type { QuietHours } from "./quiet-hours.ts";

/** 1.21.0: `position` — «Ryntra попередить» on a company the wallet holds (`position-watch.ts`), `id` the token's mint. */
export type MonitorSubjectKind = "trading-plan" | "prediction-plan" | "position";

export type MonitorRecord = Readonly<{
  version: number;
  id: string;
  owner: string;
  subjectKind: MonitorSubjectKind;
  subjectId: string;
  label: string;
  href: string;
  paper: boolean;
  status: MonitorStatus;
  paused: boolean;
  observations: readonly Observation[];
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

/** The record a card stands for (the mobile line's request 22): the kind and the exact id, never a symbol to match on. */
export type MonitorSubject = Readonly<{ kind: MonitorSubjectKind; id: string }>;

/** A note's subject: a monitor's record, or (1.12.0) the autoinvest rule whose reminder the note is — a rule is not a monitor — or (1.13.0) the month's autoinvest budget, spent — or (1.15.0) an issuer's event about a token the wallet holds, `id` its mint: a window to swap it before the issuer's cut-off. */
export type InboxSubjectKind = MonitorSubjectKind | "autoinvest-rule" | "autoinvest-budget" | "issuer-event";
export type InboxSubject = Readonly<{ kind: InboxSubjectKind; id: string }>;

/** 1.13.0: what became of a rule's reminder, read when the surface is read — never stored on the note; 1.18.0: `deferred`, the price condition holds it back. */
export type InboxRuleState = "due" | "pending" | "bought" | "missed" | "held" | "deferred";

/** The finding as figures (request 23): the kind, its outcome and the facts behind the sentence, for a reader in any language. */
export type InboxFinding = Readonly<{ kind: ConditionKind; outcome: FindingOutcome; facts: FindingFacts }>;

export type InboxRecord = Readonly<{
  id: string;
  owner: string;
  monitorId: string;
  triggerId: string;
  /** The words in the tick's locale (`locale`); a reader picks its own language from `text` where it is present. */
  title: string;
  reason: string;
  context: string;
  href: string;
  cta: string;
  paper: boolean;
  unread: boolean;
  createdAt: string;
  locale: "en" | "uk";
  /** Additive (2026-09-22): absent on a note written before them. */
  subject?: InboxSubject;
  text?: Readonly<{ en: Readonly<{ title: string; reason: string }>; uk: Readonly<{ title: string; reason: string }> }>;
  finding?: InboxFinding;
  /** 1.13.0: on a rule's reminder as the surface reads it; never written by the tick. */
  ruleState?: InboxRuleState;
}>;

export type OutboxRecord = Readonly<{
  id: string;
  owner: string;
  triggerId: string;
  inboxId: string;
  channel: "telegram" | "push";
  state: "pending" | "sent" | "failed" | "skipped_quiet" | "skipped_no_destination" | "skipped_no_provider";
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type DeviceRecord = Readonly<{
  version: number;
  deviceId: string;
  owner: string;
  platform: "android";
  token: string;
  appVersion: string;
  locale: "en" | "uk";
  categories: readonly ("plan" | "operation" | "market" | "system")[];
  quietHours: QuietHours | null;
  registeredAt: string;
  updatedAt: string;
  revokedAt: string | null;
}>;

export type PreferencesRecord = Readonly<{
  version: number;
  owner: string;
  inbox: true;
  telegram: boolean;
  push: boolean;
  quietHours: QuietHours | null;
  updatedAt: string;
}>;

const PREFIX = "solana:mainnet:";

export function monitorKey(owner: string, id: string): string {
  return `${PREFIX}${owner}:${id}`;
}
export function monitorPrefix(owner: string): string {
  return `${PREFIX}${owner}:`;
}
export function inboxKey(owner: string, id: string): string {
  return `${PREFIX}${owner}:${id}`;
}
export function inboxPrefix(owner: string): string {
  return `${PREFIX}${owner}:`;
}
export function deviceKey(owner: string, deviceId: string): string {
  return `${PREFIX}${owner}:${deviceId}`;
}
export function devicePrefix(owner: string): string {
  return `${PREFIX}${owner}:`;
}
export function outboxKey(owner: string, triggerId: string, channel: "telegram" | "push"): string {
  return `${PREFIX}${owner}:${triggerId}:${channel}`;
}

export function newMonitorId(): string {
  return `mon_${randomBytes(12).toString("hex")}`;
}
export function newInboxId(): string {
  return `inb_${randomBytes(12).toString("hex")}`;
}
export function newOutboxId(): string {
  return `obx_${randomBytes(12).toString("hex")}`;
}
export function newDeviceId(): string {
  return `dev_${randomBytes(12).toString("hex")}`;
}

export function monitorsOf(store: GuardStore) {
  return store.versioned<MonitorRecord>("monitoringMonitors");
}
export function inboxOf(store: GuardStore) {
  return store.collection<InboxRecord>("monitoringInbox");
}
export function triggersOf(store: GuardStore) {
  return store.collection<{ identity: string; at: string }>("monitoringTriggers");
}
export function outboxOf(store: GuardStore) {
  return store.collection<OutboxRecord>("monitoringOutbox");
}
export function devicesOf(store: GuardStore) {
  return store.versioned<DeviceRecord>("monitoringDevices");
}
export function preferencesOf(store: GuardStore) {
  return store.versioned<PreferencesRecord>("monitoringPreferences");
}

export async function listMonitors(store: GuardStore, owner?: string): Promise<readonly MonitorRecord[]> {
  const prefix = owner ? monitorPrefix(owner) : PREFIX;
  return monitorsOf(store).valuesWithPrefix(prefix);
}

export async function listInbox(store: GuardStore, owner: string): Promise<readonly InboxRecord[]> {
  const rows = await inboxOf(store).valuesWithPrefix(inboxPrefix(owner));
  return [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listDevices(store: GuardStore, owner: string): Promise<readonly DeviceRecord[]> {
  const rows = await devicesOf(store).valuesWithPrefix(devicePrefix(owner));
  return rows.filter((row) => row.revokedAt === null);
}

export async function readPreferences(store: GuardStore, owner: string): Promise<PreferencesRecord> {
  const found = await preferencesOf(store).get(`${PREFIX}${owner}`);
  if (found) return found;
  return {
    version: 0,
    owner,
    inbox: true,
    telegram: true,
    push: true,
    quietHours: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

/** A note about a plan's monitor — every note but an autoinvest reminder (1.12.0), the budget's (1.13.0), an issuer's event (1.15.0) and a position's warning (1.21.0). */
export type MonitorNote = InboxRecord & Readonly<{ subject?: Readonly<{ kind: "trading-plan" | "prediction-plan"; id: string }> }>;

/** Whether a note is autoinvest's own — a rule's reminder or the month's budget — rather than a monitor's. */
export function isAutoinvestNote(row: InboxRecord): boolean {
  return row.subject?.kind === "autoinvest-rule" || row.subject?.kind === "autoinvest-budget";
}

/** Whether a note is the IPO and conversion watch's (1.15.0): an issuer's event about a token the wallet holds. */
export function isIssuerEventNote(row: InboxRecord): boolean {
  return row.subject?.kind === "issuer-event";
}

/** Whether a note is «Ryntra попередить» on a position (1.21.0): its limit or its target reached. */
export function isPositionNote(row: InboxRecord): boolean {
  return row.subject?.kind === "position";
}

/** The notes about plans' monitors: what plan memory and the agent's note reads are about; autoinvest's notes, the issuer's events and a position's warnings are none of them. */
export function monitorNotes(notes: readonly InboxRecord[]): readonly MonitorNote[] {
  return notes.filter((row): row is MonitorNote => !isAutoinvestNote(row) && !isIssuerEventNote(row) && !isPositionNote(row));
}

/**
 * The IPO and conversion watch's own record of one wallet and one watched
 * token (1.15.0): when the wallet's balance of the token was last read and
 * what it was, the language the person's own app last read in, and which of
 * the event's reminders were sent — each stage once. Keyed
 * `solana:mainnet:<wallet>:<mint>`, so a wallet's records are one prefix.
 */
export type IssuerWatchRecord = Readonly<{
  owner: string;
  mint: string;
  checkedAt: string;
  /** Raw units the wallet held at the last read; null when the read failed. */
  heldRaw: string | null;
  locale: "en" | "uk";
  sent: readonly Readonly<{ stage: "event" | "d90" | "d30" | "d7" | "d1"; at: string }>[];
}>;

export function issuerWatchKey(owner: string, mint: string): string {
  return `${PREFIX}${owner}:${mint}`;
}
export function issuerWatchPrefix(owner?: string): string {
  return owner ? `${PREFIX}${owner}:` : PREFIX;
}
export function issuerWatchOf(store: GuardStore) {
  return store.collection<IssuerWatchRecord>("monitoringIssuerWatch");
}

/** The daily read of the issuers' product pages against the registry (1.15.0), one record per UTC day. */
export type IssuerNoticeCheckRecord = Readonly<{
  day: string;
  checkedAt: string;
  pages: readonly Readonly<{ symbol: string; mint: string; url: string; finding: string; notice: string | null; deadline: string | null }>[];
}>;
export function issuerNoticeChecksOf(store: GuardStore) {
  return store.collection<IssuerNoticeCheckRecord>("issuerNoticeChecks");
}

export async function claimTrigger(store: GuardStore, identity: string, at: string): Promise<boolean> {
  return triggersOf(store).insertIfAbsent(identity, { identity, at });
}

export function latestFindingLine(findings: readonly Finding[], locale: "en" | "uk"): { title: string; reason: string } | null {
  const material = findings.find((row) => row.material);
  if (!material) return null;
  return { title: material.title[locale], reason: material.reason[locale] };
}
