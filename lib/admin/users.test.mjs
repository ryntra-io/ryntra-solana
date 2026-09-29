import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { stripForbiddenAdminProperties } from "./privacy.ts";
import {
  ADMIN_USER_CSV_HEADER,
  adminUserCsvRow,
  pageLegacyUsers,
  parseUsersQuery,
  projectAdminUser,
  projectAdminUserFromPage,
  usersQueryToSearchParams,
} from "./users.ts";

const src = readFileSync(new URL("./users.ts", import.meta.url), "utf8");
const now = new Date("2026-09-05T12:00:00.000Z");

test("the projected user row never carries a wallet address, P&L or trade size", () => {
  assert.match(src, /hasWatchAddress: Boolean\(row\.wallet_address\)/);
  assert.doesNotMatch(src, /walletAddress:/);
  assert.doesNotMatch(src, /pnl/i);
  assert.match(src, /paperActions:/);
  assert.match(src, /accessSource:/);
});

test("registration is not a login: the legacy read leaves login columns not collected", () => {
  const row = projectAdminUser({
    telegram_id: 1001,
    telegram_username: "alice",
    first_name: "Alice",
    language: "uk",
    wallet_address: "0xabc",
    created_at: "2026-08-01T10:00:00.000Z",
    status: "telegram_verified",
    tasks: { telegram_join: "verified" },
    invites: 0,
    paper_trades: 2,
  }, now);
  assert.equal(row.registeredAt, "2026-08-01T10:00:00.000Z");
  assert.equal(row.firstLoginAt, null);
  assert.equal(row.lastLoginAt, null);
  assert.equal(row.lastActivityAt, null);
  assert.equal(row.activity, "not_collected");
  assert.equal(row.walletLinked, null, "the legacy list cannot tell a proven wallet from a watch address");
  assert.equal(row.hasWatchAddress, true);
  assert.equal(row.access, "ACTIVE");
  assert.equal("firstSeen" in row, false);
});

test("the store read carries first and last login separately from registration", () => {
  const row = projectAdminUserFromPage({
    telegram_id: 1001,
    telegram_username: null,
    first_name: "Alice",
    language: "uk",
    created_at: "2026-08-01T10:00:00.000Z",
    status: null,
    tasks: null,
    invites: 1,
    paper_trades: 2,
    has_watch_address: false,
    wallet_linked: true,
    is_operator: false,
    effective_access: "PAUSED",
    access_source: "control",
    access_expires_at: null,
    first_login_at: "2026-08-03T09:00:00.000Z",
    last_login_at: "2026-09-04T09:00:00.000Z",
    last_login_kind: "wallet_siwe",
    login_count: 3,
    last_activity_at: "2026-09-04T10:00:00.000Z",
    events_30d: 2,
    errors_7d: 0,
  });
  assert.equal(row.displayName, "Alice");
  assert.equal(row.registeredAt, "2026-08-01T10:00:00.000Z");
  assert.equal(row.firstLoginAt, "2026-08-03T09:00:00.000Z");
  assert.notEqual(row.firstLoginAt, row.registeredAt);
  assert.equal(row.lastLoginKind, "wallet_siwe");
  assert.equal(row.activity, "measured");
  assert.equal(row.access, "PAUSED");
  assert.equal(row.accessSource, "control");
  assert.equal(row.walletLinked, true);
});

test("the users query is bounded and defaulted, and round-trips through the URL", () => {
  const parsed = parseUsersQuery(new URLSearchParams("q=%20alice%20&filter=errors_7d&sort=last_login_at&dir=asc&page=3&size=50"));
  assert.deepEqual(parsed, { query: "alice", filter: "errors_7d", sort: "last_login_at", dir: "asc", page: 3, size: 50 });
  const junk = parseUsersQuery(new URLSearchParams("filter=drop&sort=x&dir=sideways&page=-1&size=7"));
  assert.deepEqual(junk, { query: null, filter: "all", sort: "created_at", dir: "desc", page: 1, size: 25 });
  assert.equal(usersQueryToSearchParams(parsed).toString(), "q=alice&filter=errors_7d&sort=last_login_at&dir=asc&page=3&size=50");
  assert.equal(usersQueryToSearchParams(junk).toString(), "", "defaults leave the URL clean");
});

test("legacy paging filters, sorts and pages in memory and reports a capped total as a floor", () => {
  const base = {
    username: null, accessSource: "legacy", firstLoginAt: null, lastLoginAt: null, lastLoginKind: null, loginCount: null,
    lastActivityAt: null, events30d: null, errors7d: null, activity: "not_collected", locale: "uk", walletLinked: null,
    hasWatchAddress: false, invites: 0, isOperator: false,
  };
  const rows = [
    { ...base, telegramId: 1, displayName: "@carol", access: "ACTIVE", registeredAt: "2026-08-20T00:00:00Z", paperActions: 0 },
    { ...base, telegramId: 2, displayName: "@alice", access: "ACTIVE", registeredAt: "2026-08-01T00:00:00Z", paperActions: 5 },
    { ...base, telegramId: 3, displayName: "@bob", access: "PAUSED", registeredAt: "2026-08-10T00:00:00Z", paperActions: 2 },
  ];
  const q = parseUsersQuery(new URLSearchParams(""));
  const page = pageLegacyUsers(rows, { ...q, size: 25 }, { capped: false, now });
  assert.deepEqual(page.rows.map((r) => r.displayName), ["@carol", "@bob", "@alice"], "newest registration first by default");
  assert.equal(page.total, 3);
  const active = pageLegacyUsers(rows, { ...q, filter: "active", sort: "display", dir: "asc" }, { capped: false, now });
  assert.deepEqual(active.rows.map((r) => r.displayName), ["@alice", "@carol"]);
  const paged = pageLegacyUsers(rows, { ...q, sort: "paper_trades", dir: "desc", size: 25, page: 1 }, { capped: true, now });
  assert.deepEqual(paged.rows.map((r) => r.paperActions), [5, 2, 0]);
  assert.equal(paged.capped, true);
  const second = pageLegacyUsers(rows, { ...q, page: 2, size: 25 }, { capped: false, now });
  assert.deepEqual(second.rows, []);
  assert.equal(second.total, 3, "the total comes from the whole list, never from one page");
  const never = pageLegacyUsers(rows, { ...q, filter: "never_signed_in" }, { capped: false, now });
  assert.equal(never.total, 0, "without the store nobody is known to have never signed in");
});

test("CSV exports linked yes/no rather than the address and says when logins are not collected", () => {
  assert.match(ADMIN_USER_CSV_HEADER, /гаманець_привʼязано/);
  assert.match(ADMIN_USER_CSV_HEADER, /зареєстровано,перший_вхід,останній_вхід,остання_дія/);
  const csvFn = src.slice(src.indexOf("export function adminUserCsvRow"));
  assert.doesNotMatch(csvFn, /wallet_address/);
  const row = adminUserCsvRow({
    telegramId: 1, displayName: "@a", username: "a", access: "ACTIVE", accessSource: "legacy", registeredAt: "2026-08-01T00:00:00Z",
    firstLoginAt: null, lastLoginAt: null, lastLoginKind: null, loginCount: null, lastActivityAt: null, events30d: null, errors7d: null,
    activity: "not_collected", locale: "uk", walletLinked: null, hasWatchAddress: true, paperActions: 1, invites: 0, isOperator: false,
  });
  assert.deepEqual(row, ["1", "a", "ACTIVE", "1", "невідомо", "uk", "2026-08-01T00:00:00Z", "не збирається", "не збирається", "не збирається"]);
});

test("generic analytics payloads drop forbidden financial properties", () => {
  const stripped = stripForbiddenAdminProperties({
    workspace: "solana",
    wallet_address: "0xabc",
    pnl: 12.5,
    paperActions: 3,
  });
  assert.deepEqual(stripped, { workspace: "solana", paperActions: 3 });
});
