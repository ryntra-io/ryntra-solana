import { resolveUserAccess, type UserAccessState } from "./access.ts";
import { LOGIN_KINDS, type LoginKind, type UsersPageRow } from "./activity.ts";

/**
 * Users & Access projection.
 *
 * Registration (`created_at`) and the first confirmed login are different
 * facts and different columns. When the activity store is not applied the
 * login and activity fields are `null` with `activity: "not_collected"`, and
 * the surface says so instead of drawing the registration date twice.
 */

export const USER_FILTERS = [
  "all",
  "active",
  "requested",
  "paused",
  "revoked",
  "expired",
  "signed_in_30d",
  "never_signed_in",
  "operators",
  "wallet_linked",
  "errors_7d",
] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

export const USER_SORTS = ["created_at", "last_login_at", "last_activity_at", "paper_trades", "display"] as const;
export type UserSort = (typeof USER_SORTS)[number];

export const USER_FILTER_LABEL: Record<UserFilter, string> = {
  all: "Усі",
  active: "Активний доступ",
  requested: "Запит",
  paused: "Пауза",
  revoked: "Відкликано",
  expired: "Закінчився",
  signed_in_30d: "Входили за 30 днів",
  never_signed_in: "Без записаного входу",
  operators: "Оператори",
  wallet_linked: "Гаманець прив'язано",
  errors_7d: "З помилками за 7 днів",
};

export const USER_SORT_LABEL: Record<UserSort, string> = {
  created_at: "Реєстрація",
  last_login_at: "Останній вхід",
  last_activity_at: "Остання дія",
  paper_trades: "Paper-плани",
  display: "Ім'я",
};

export const USER_PAGE_SIZES = [25, 50, 100] as const;

export type RawAdminUser = {
  telegram_id: number;
  telegram_username: string | null;
  first_name: string | null;
  language: string;
  wallet_address?: string | null;
  proof_code?: string;
  referral_code?: string;
  created_at: string;
  status: string | null;
  tasks: Record<string, string> | null;
  invites: number;
  paper_trades: number;
  access_control?: { state: string; expires_at: string | null } | null;
};

export type AdminUserRow = {
  /** Stable row key: the account uuid once the store projects it, else the Telegram id as text. */
  key: string;
  accountId: string | null;
  /** `null` for an account that never used the bot (email, Google or Telegram OpenID). */
  telegramId: number | null;
  displayName: string;
  username: string | null;
  access: UserAccessState;
  accessSource: "control" | "legacy";
  /** Account created (`created_at`). Never shown as a login. */
  registeredAt: string;
  /** From the activity store; `null` when unknown. */
  firstLoginAt: string | null;
  lastLoginAt: string | null;
  lastLoginKind: LoginKind | null;
  loginCount: number | null;
  lastActivityAt: string | null;
  events30d: number | null;
  errors7d: number | null;
  /** Whether the login/activity columns are backed by the applied store. */
  activity: "measured" | "not_collected";
  locale: string;
  /** A wallet proven by signature (SIWE). `null` when the legacy read cannot tell. */
  walletLinked: boolean | null;
  /** The legacy watch address exists (not a proof of ownership). */
  hasWatchAddress: boolean;
  paperActions: number;
  invites: number;
  isOperator: boolean;
};

function displayNameOf(username: string | null, firstName: string | null, telegramId: number | null, accountId: string | null = null): string {
  return username ? `@${username}` : firstName?.trim() || (telegramId === null ? `акаунт ${(accountId ?? "").slice(0, 8)}` : String(telegramId));
}

/** Legacy path: `admin_users_list` plus the access-control map. */
export function projectAdminUser(row: RawAdminUser, now?: Date): AdminUserRow {
  const control = row.access_control && typeof row.access_control.state === "string"
    ? {
        state: row.access_control.state as AdminUserRow["access"],
        expiresAt: row.access_control.expires_at,
      }
    : null;
  const access = resolveUserAccess({
    control: control && ["REQUESTED", "ACTIVE", "PAUSED", "REVOKED", "EXPIRED"].includes(control.state)
      ? { state: control.state, expiresAt: control.expiresAt }
      : null,
    legacyJoin: row.tasks?.telegram_join ?? null,
    now,
  });
  return {
    key: String(row.telegram_id),
    accountId: null,
    telegramId: row.telegram_id,
    displayName: displayNameOf(row.telegram_username, row.first_name, row.telegram_id),
    username: row.telegram_username,
    access,
    accessSource: control ? "control" : "legacy",
    registeredAt: row.created_at,
    firstLoginAt: null,
    lastLoginAt: null,
    lastLoginKind: null,
    loginCount: null,
    lastActivityAt: null,
    events30d: null,
    errors7d: null,
    activity: "not_collected",
    locale: row.language,
    walletLinked: null,
    hasWatchAddress: Boolean(row.wallet_address),
    paperActions: typeof row.paper_trades === "number" ? row.paper_trades : 0,
    invites: typeof row.invites === "number" ? row.invites : 0,
    isOperator: false,
  };
}

function accessStateOf(value: string): UserAccessState {
  return ["REQUESTED", "ACTIVE", "PAUSED", "REVOKED", "EXPIRED"].includes(value) ? (value as UserAccessState) : "REQUESTED";
}

/** Store path: one `admin_users_page` row, already filtered and sorted by the database. */
export function projectAdminUserFromPage(row: UsersPageRow): AdminUserRow {
  const accountId = typeof row.account_id === "string" ? row.account_id : null;
  return {
    key: accountId ?? String(row.telegram_id),
    accountId,
    telegramId: row.telegram_id,
    displayName: displayNameOf(row.telegram_username, row.first_name, row.telegram_id, accountId),
    username: row.telegram_username,
    access: accessStateOf(row.effective_access),
    accessSource: row.access_source === "control" ? "control" : "legacy",
    registeredAt: row.created_at,
    firstLoginAt: row.first_login_at,
    lastLoginAt: row.last_login_at,
    lastLoginKind: (LOGIN_KINDS as readonly string[]).includes(row.last_login_kind ?? "") ? (row.last_login_kind as LoginKind) : null,
    loginCount: typeof row.login_count === "number" ? row.login_count : 0,
    lastActivityAt: row.last_activity_at,
    events30d: typeof row.events_30d === "number" ? row.events_30d : 0,
    errors7d: typeof row.errors_7d === "number" ? row.errors_7d : 0,
    activity: "measured",
    locale: row.language ?? "",
    walletLinked: row.wallet_linked === true,
    hasWatchAddress: row.has_watch_address === true,
    paperActions: typeof row.paper_trades === "number" ? row.paper_trades : 0,
    invites: typeof row.invites === "number" ? row.invites : 0,
    isOperator: row.is_operator === true,
  };
}

export type UsersQuery = {
  query: string | null;
  filter: UserFilter;
  sort: UserSort;
  dir: "asc" | "desc";
  page: number;
  size: number;
};

export function isUserFilter(value: unknown): value is UserFilter {
  return typeof value === "string" && (USER_FILTERS as readonly string[]).includes(value);
}

export function isUserSort(value: unknown): value is UserSort {
  return typeof value === "string" && (USER_SORTS as readonly string[]).includes(value);
}

/** Query-string → a bounded, defaulted query. Unknown values fall back, never throw. */
export function parseUsersQuery(params: URLSearchParams): UsersQuery {
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const filter = params.get("filter");
  const sort = params.get("sort");
  const dir = params.get("dir");
  const page = Number(params.get("page"));
  const size = Number(params.get("size"));
  return {
    query: q.length > 0 ? q : null,
    filter: isUserFilter(filter) ? filter : "all",
    sort: isUserSort(sort) ? sort : "created_at",
    dir: dir === "asc" ? "asc" : "desc",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    size: (USER_PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
  };
}

export function usersQueryToSearchParams(query: UsersQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.query) params.set("q", query.query);
  if (query.filter !== "all") params.set("filter", query.filter);
  if (query.sort !== "created_at") params.set("sort", query.sort);
  if (query.dir !== "desc") params.set("dir", query.dir);
  if (query.page !== 1) params.set("page", String(query.page));
  if (query.size !== 25) params.set("size", String(query.size));
  return params;
}

function time(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Legacy fallback: filter, sort and page in memory over the whole list the
 * old RPC returns (up to 500 rows). The total is the filtered length of that
 * list, and `capped` says when the list itself was cut by the RPC ceiling —
 * a total from a capped list is a floor, and the surface shows it as one.
 */
export function pageLegacyUsers(
  rows: AdminUserRow[],
  query: UsersQuery,
  options: { capped: boolean; now?: Date },
): { total: number; capped: boolean; rows: AdminUserRow[] } {
  const now = options.now ?? new Date();
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 3_600_000;
  const filtered = rows.filter((row) => {
    switch (query.filter) {
      case "active":
      case "requested":
      case "paused":
      case "revoked":
      case "expired":
        return row.access === query.filter.toUpperCase();
      case "signed_in_30d":
        return row.lastLoginAt !== null && time(row.lastLoginAt) > thirtyDaysAgo;
      case "never_signed_in":
        return row.activity === "measured" && row.firstLoginAt === null;
      case "operators":
        return row.isOperator;
      case "wallet_linked":
        return row.walletLinked === true;
      case "errors_7d":
        return (row.errors7d ?? 0) > 0;
      default:
        return true;
    }
  });
  const direction = query.dir === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    let delta = 0;
    switch (query.sort) {
      case "last_login_at":
        delta = time(a.lastLoginAt) - time(b.lastLoginAt);
        break;
      case "last_activity_at":
        delta = time(a.lastActivityAt) - time(b.lastActivityAt);
        break;
      case "paper_trades":
        delta = a.paperActions - b.paperActions;
        break;
      case "display":
        delta = a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase());
        break;
      default:
        delta = time(a.registeredAt) - time(b.registeredAt);
    }
    if (delta === 0) delta = time(b.registeredAt) - time(a.registeredAt) || a.key.localeCompare(b.key);
    return delta * direction;
  });
  const start = (query.page - 1) * query.size;
  return { total: sorted.length, capped: options.capped, rows: sorted.slice(start, start + query.size) };
}

export function adminUserCsvRow(row: AdminUserRow): string[] {
  return [
    row.telegramId === null ? "" : String(row.telegramId),
    row.username ?? "",
    row.access,
    String(row.paperActions),
    row.walletLinked === null ? "невідомо" : row.walletLinked ? "так" : "ні",
    row.locale,
    row.registeredAt,
    row.firstLoginAt ?? (row.activity === "measured" ? "" : "не збирається"),
    row.lastLoginAt ?? (row.activity === "measured" ? "" : "не збирається"),
    row.lastActivityAt ?? (row.activity === "measured" ? "" : "не збирається"),
  ];
}

export const ADMIN_USER_CSV_HEADER =
  "telegram_id,нік,доступ,paper_дій,гаманець_привʼязано,мова,зареєстровано,перший_вхід,останній_вхід,остання_дія";
