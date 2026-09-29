/**
 * Account logins and permitted product events — the admin's activity truth.
 *
 * A login row is written only by the server exchange that minted a session
 * (`/api/session` for bot links, `/api/auth/wallet` for SIWE), once per nonce.
 * A cookie check, a page open or a wallet connect is never a login. A product
 * event is a permitted meaningful action an account completed on the server;
 * it carries no amounts, addresses, hashes, prompts or personal identifiers.
 *
 * Every writer is quiet and bounded: an unapplied store or a slow database
 * changes what the admin can show, never whether a user's action succeeds.
 * Reads tell "not collected yet" (store missing) apart from "unavailable"
 * (store failing) so the surface never draws a zero for either.
 */

import { rpcProbe } from "../supabase-probe.ts";
import { carriesForbiddenAdminProperty, stripForbiddenAdminProperties } from "./privacy.ts";

export const PRODUCT_EVENT_NAMES = [
  "paper_plan_opened",
  "paper_plan_closed",
  "paper_journal_saved",
  "journal_note_saved",
  "strategy_formalized",
  "strategy_approved",
  "feedback_sent",
] as const;
export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

/** What each permitted action means, in the operator's language. */
export const PRODUCT_EVENT_LABEL: Record<ProductEventName, string> = {
  paper_plan_opened: "Paper-план відкрито",
  paper_plan_closed: "Paper-план закрито",
  paper_journal_saved: "Журнал paper-плану збережено",
  journal_note_saved: "Нотатку журналу збережено",
  strategy_formalized: "Стратегію формалізовано",
  strategy_approved: "Версію стратегії затверджено",
  feedback_sent: "Звернення надіслано",
};

export const ERROR_CLASSES = [
  "store_unavailable",
  "validation",
  "rate_limited",
  "not_found",
  "provider_unavailable",
  "integrity",
  "unknown",
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export const LOGIN_KINDS = [
  "telegram_link",
  "wallet_siwe",
  "email_password",
  "email_recovery",
  "google_oidc",
  "telegram_oidc",
  "solana_siws",
] as const;
export type LoginKind = (typeof LOGIN_KINDS)[number];

export const LOGIN_TARGETS = ["admin", "app", "beta", "demo"] as const;
export type LoginTarget = (typeof LOGIN_TARGETS)[number];

export const LOGIN_KIND_LABEL: Record<LoginKind, string> = {
  telegram_link: "посилання бота",
  wallet_siwe: "підпис гаманця",
  email_password: "email і пароль",
  email_recovery: "відновлення пароля",
  google_oidc: "Google",
  telegram_oidc: "Telegram (OpenID)",
  solana_siws: "підпис Solana-гаманця",
};

export type EventOutcome = "ok" | "error" | "refused";
export type EventSurface = "app" | "bot" | "site" | "api";

/** The `next` a bot link lands on says where the person was going. */
export function loginTargetOf(next: string | null | undefined): LoginTarget | null {
  if (!next) return null;
  const match = /^\/(admin|app|beta|demo)(?:[/?#]|$)/.exec(next);
  return match ? (match[1] as LoginTarget) : null;
}

export function isProductEventName(value: unknown): value is ProductEventName {
  return typeof value === "string" && (PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}

export function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === "string" && (ERROR_CLASSES as readonly string[]).includes(value);
}

export type RecordOutcome = "recorded" | "duplicate" | "not_collected" | "unavailable" | "refused";

/**
 * How a failed store call is recorded: an infrastructure failure is an
 * `error` the operator must see; a rule the database enforced is a `refused`
 * action that is neither an error nor an activity.
 */
export function classifyRpcFailure(error: string | null | undefined): { outcome: "error" | "refused"; errorClass: ErrorClass } {
  const text = (error ?? "").toLowerCase();
  if (text.includes("temporarily unavailable") || text.includes("not configured") || text.includes("unavailable")) {
    return { outcome: "error", errorClass: "store_unavailable" };
  }
  if (text.includes("not found")) return { outcome: "refused", errorClass: "not_found" };
  if (text.includes("rate")) return { outcome: "refused", errorClass: "rate_limited" };
  return { outcome: "refused", errorClass: "validation" };
}

async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Record a confirmed login. Called only after the exchange has verified the
 * credential, spent its nonce and minted the session. Never throws, never
 * blocks the redirect for longer than `timeoutMs`.
 */
export async function recordAccountLogin(
  input: {
    accountId?: string | null;
    telegramId?: number | null;
    wallet?: string | null;
    kind: LoginKind;
    admin: boolean;
    target: LoginTarget | null;
    nonce: string | null;
  },
  options: { timeoutMs?: number } = {},
): Promise<RecordOutcome> {
  if (!input.accountId && !input.telegramId && !input.wallet) return "refused";
  const work = (async (): Promise<RecordOutcome> => {
    const probe = await rpcProbe<{ ok?: boolean; recorded?: boolean; error?: string }>("account_login_record", {
      p_account_id: input.accountId ?? null,
      p_telegram_id: input.telegramId ?? null,
      p_wallet: input.wallet ?? null,
      p_kind: input.kind,
      p_admin: input.admin,
      p_target: input.target,
      p_nonce: input.nonce,
    });
    if (probe.kind === "missing") return "not_collected";
    if (probe.kind === "unavailable") return "unavailable";
    if (!probe.data?.ok) return "refused";
    return probe.data.recorded ? "recorded" : "duplicate";
  })();
  try {
    return await withDeadline(work, options.timeoutMs ?? 2_500, "unavailable");
  } catch {
    return "unavailable";
  }
}

export type ProductEventActor =
  | { kind: "account"; accountId?: string | null; telegramId?: number | null; wallet?: string | null }
  | { kind: "anonymous" };

/**
 * Record a permitted product action. Props are stripped of every forbidden
 * key at every depth before they leave the process; a payload that still
 * carries one is refused here, before the database refuses it again.
 */
export async function recordProductEvent(
  input: {
    actor: ProductEventActor;
    name: ProductEventName;
    outcome: EventOutcome;
    errorClass?: ErrorClass | null;
    surface?: EventSurface | null;
    props?: Record<string, unknown>;
  },
  options: { timeoutMs?: number } = {},
): Promise<RecordOutcome> {
  if (!isProductEventName(input.name)) return "refused";
  if (input.actor.kind === "account" && !input.actor.accountId && !input.actor.telegramId && !input.actor.wallet) return "refused";
  const props = stripForbiddenAdminProperties(input.props ?? {});
  if (carriesForbiddenAdminProperty(props)) return "refused";
  const work = (async (): Promise<RecordOutcome> => {
    const probe = await rpcProbe<{ ok?: boolean; error?: string }>("product_event_append", {
      p_account_id: input.actor.kind === "account" ? (input.actor.accountId ?? null) : null,
      p_telegram_id: input.actor.kind === "account" ? (input.actor.telegramId ?? null) : null,
      p_wallet: input.actor.kind === "account" ? (input.actor.wallet ?? null) : null,
      p_actor_kind: input.actor.kind,
      p_actor_key: null,
      p_name: input.name,
      p_outcome: input.outcome,
      p_error_class: input.errorClass ?? null,
      p_surface: input.surface ?? null,
      p_props: props,
    });
    if (probe.kind === "missing") return "not_collected";
    if (probe.kind === "unavailable") return "unavailable";
    return probe.data?.ok ? "recorded" : "refused";
  })();
  try {
    return await withDeadline(work, options.timeoutMs ?? 2_500, "unavailable");
  } catch {
    return "unavailable";
  }
}

/* ------------------------------------------------------------- reads --- */

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function counts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(record(value))) {
    if (typeof count === "number" && Number.isFinite(count)) out[key] = count;
  }
  return out;
}

export type ActivitySummary = {
  now: string;
  coverage: { loginsSince: string | null; eventsSince: string | null; loginRows: number; eventRows: number };
  operators: { accounts: number; logins30d: number };
  accounts: {
    total: number;
    new7d: number;
    new30d: number;
    everSignedIn: number;
    signedIn7d: number;
    signedIn30d: number;
    acted7d: number;
    acted30d: number;
    activated: number;
    withErrors7d: number;
  };
  logins: { count7d: number; count30d: number; byKind30d: Record<string, number> };
  events: {
    ok7d: number;
    error7d: number;
    refused7d: number;
    ok30d: number;
    error30d: number;
    anonymousOk30d: number;
    byName30d: Record<string, number>;
    errorClasses7d: Record<string, number>;
  };
  daily30d: { day: string; signedIn: number; acted: number; errors: number }[];
  activation14d: { n: number; activated: number };
  cohorts: { week: string; n: number; returnedW1: number; complete: boolean }[];
};

export function parseActivitySummary(raw: unknown): ActivitySummary | null {
  const root = record(raw);
  if (root.ok !== true) return null;
  const coverage = record(root.coverage);
  const operators = record(root.operators);
  const accounts = record(root.accounts);
  const logins = record(root.logins);
  const events = record(root.events);
  const activation = record(root.activation_14d);
  const daily = Array.isArray(root.daily_30d) ? root.daily_30d : [];
  const cohorts = Array.isArray(root.cohorts) ? root.cohorts : [];
  return {
    now: str(root.now) ?? new Date().toISOString(),
    coverage: {
      loginsSince: str(coverage.logins_since),
      eventsSince: str(coverage.events_since),
      loginRows: num(coverage.login_rows),
      eventRows: num(coverage.event_rows),
    },
    operators: { accounts: num(operators.accounts), logins30d: num(operators.logins_30d) },
    accounts: {
      total: num(accounts.total),
      new7d: num(accounts.new_7d),
      new30d: num(accounts.new_30d),
      everSignedIn: num(accounts.ever_signed_in),
      signedIn7d: num(accounts.signed_in_7d),
      signedIn30d: num(accounts.signed_in_30d),
      acted7d: num(accounts.acted_7d),
      acted30d: num(accounts.acted_30d),
      activated: num(accounts.activated),
      withErrors7d: num(accounts.with_errors_7d),
    },
    logins: { count7d: num(logins.count_7d), count30d: num(logins.count_30d), byKind30d: counts(logins.by_kind_30d) },
    events: {
      ok7d: num(events.ok_7d),
      error7d: num(events.error_7d),
      refused7d: num(events.refused_7d),
      ok30d: num(events.ok_30d),
      error30d: num(events.error_30d),
      anonymousOk30d: num(events.anonymous_ok_30d),
      byName30d: counts(events.by_name_30d),
      errorClasses7d: counts(events.error_classes_7d),
    },
    daily30d: daily
      .map((row) => record(row))
      .filter((row) => typeof row.day === "string")
      .map((row) => ({ day: row.day as string, signedIn: num(row.signed_in), acted: num(row.acted), errors: num(row.errors) })),
    activation14d: { n: num(activation.n), activated: num(activation.activated) },
    cohorts: cohorts
      .map((row) => record(row))
      .filter((row) => typeof row.week === "string")
      .map((row) => ({ week: row.week as string, n: num(row.n), returnedW1: num(row.returned_w1), complete: row.complete === true })),
  };
}

export type ActivityRead =
  | { status: "measured"; summary: ActivitySummary }
  | { status: "not_collected" }
  | { status: "unavailable" };

export async function readActivitySummary(): Promise<ActivityRead> {
  const probe = await rpcProbe<unknown>("admin_activity_summary", { p_now: null });
  if (probe.kind === "missing") return { status: "not_collected" };
  if (probe.kind === "unavailable") return { status: "unavailable" };
  const summary = parseActivitySummary(probe.data);
  return summary ? { status: "measured", summary } : { status: "unavailable" };
}

export type TimelineEntry = {
  at: string;
  type: "login" | "event";
  name: string;
  outcome: EventOutcome;
  errorClass: string | null;
  surface: string | null;
  admin: boolean;
  target: string | null;
};

export type UserActivity = {
  isOperator: boolean;
  firstLoginAt: string | null;
  lastLoginAt: string | null;
  lastLoginKind: LoginKind | null;
  loginCount: number;
  adminLoginCount: number;
  lastActivityAt: string | null;
  events30d: number;
  errors30d: number;
  timeline: TimelineEntry[];
};

export function parseUserActivity(raw: unknown): UserActivity | null {
  const root = record(raw);
  if (root.ok !== true) return null;
  const timeline = Array.isArray(root.timeline) ? root.timeline : [];
  return {
    isOperator: root.is_operator === true,
    firstLoginAt: str(root.first_login_at),
    lastLoginAt: str(root.last_login_at),
    lastLoginKind: root.last_login_kind === "wallet_siwe" ? "wallet_siwe" : root.last_login_kind === "telegram_link" ? "telegram_link" : null,
    loginCount: num(root.login_count),
    adminLoginCount: num(root.admin_login_count),
    lastActivityAt: str(root.last_activity_at),
    events30d: num(root.events_30d),
    errors30d: num(root.errors_30d),
    timeline: timeline
      .map((row) => record(row))
      .filter((row) => typeof row.at === "string" && (row.type === "login" || row.type === "event"))
      .map((row) => ({
        at: row.at as string,
        type: row.type as "login" | "event",
        name: str(row.name) ?? "",
        outcome: row.outcome === "error" ? "error" : row.outcome === "refused" ? "refused" : "ok",
        errorClass: str(row.error_class),
        surface: str(row.surface),
        admin: row.admin === true,
        target: str(row.target),
      })),
  };
}

export type UserActivityRead =
  | { status: "measured"; activity: UserActivity }
  | { status: "not_collected" }
  | { status: "unavailable" }
  | { status: "not_found" };

export type UserActivityKey = Readonly<{ accountId: string } | { telegramId: number }>;

export async function readUserActivity(key: UserActivityKey): Promise<UserActivityRead> {
  const probe = await rpcProbe<{ ok?: boolean; error?: string }>("admin_user_activity", {
    p_telegram_id: "telegramId" in key ? key.telegramId : null,
    p_account_id: "accountId" in key ? key.accountId : null,
  });
  if (probe.kind === "missing") return { status: "not_collected" };
  if (probe.kind === "unavailable") return { status: "unavailable" };
  if (probe.data?.ok === false && probe.data.error === "not_found") return { status: "not_found" };
  const activity = parseUserActivity(probe.data);
  return activity ? { status: "measured", activity } : { status: "unavailable" };
}

export type UsersPageRow = {
  telegram_id: number | null;
  /** Present once the RYN-ACCESS-002 migration is applied; the stable key of a row. */
  account_id?: string;
  auth_linked?: boolean;
  telegram_username: string | null;
  first_name: string | null;
  language: string | null;
  created_at: string;
  status: string | null;
  tasks: Record<string, string> | null;
  invites: number;
  paper_trades: number;
  has_watch_address: boolean;
  wallet_linked: boolean;
  is_operator: boolean;
  effective_access: string;
  access_source: "control" | "legacy";
  access_expires_at: string | null;
  first_login_at: string | null;
  last_login_at: string | null;
  last_login_kind: string | null;
  login_count: number;
  last_activity_at: string | null;
  events_30d: number;
  errors_7d: number;
};

export type UsersPageRead =
  | { status: "measured"; total: number; rows: UsersPageRow[] }
  | { status: "not_collected" }
  | { status: "unavailable" };

export async function readUsersPage(params: {
  query: string | null;
  filter: string;
  sort: string;
  dir: "asc" | "desc";
  offset: number;
  limit: number;
}): Promise<UsersPageRead> {
  const probe = await rpcProbe<{ ok?: boolean; total?: number; rows?: unknown[] }>("admin_users_page", {
    p_query: params.query,
    p_filter: params.filter,
    p_sort: params.sort,
    p_dir: params.dir,
    p_offset: params.offset,
    p_limit: params.limit,
  });
  if (probe.kind === "missing") return { status: "not_collected" };
  if (probe.kind === "unavailable" || !probe.data?.ok) return { status: "unavailable" };
  const rows = Array.isArray(probe.data.rows) ? (probe.data.rows as UsersPageRow[]) : [];
  return { status: "measured", total: optionalNum(probe.data.total) ?? rows.length, rows };
}

/** Kept for callers that only need to know whether the store answers at all. */
export async function activityStoreApplied(): Promise<"applied" | "missing" | "unavailable"> {
  const probe = await rpcProbe<unknown>("admin_activity_summary", { p_now: null });
  if (probe.kind === "missing") return "missing";
  if (probe.kind === "unavailable") return "unavailable";
  return "applied";
}
