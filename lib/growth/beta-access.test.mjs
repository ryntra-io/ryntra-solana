// Run from repo root: node --test lib/growth/beta-access.test.mjs
//
// Contract tests for the repaired beta gate and the acquisition path.
//
// The parser's behaviour is proven directly in campaign.test.mjs. What cannot be executed
// here without a live Telegram update and a Postgres instance is pinned at the source and
// schema level instead, in the same style the repository already uses for its canon and
// design-debt guarantees. Each assertion below names the guarantee it protects, so a future
// refactor that removes the guarantee fails rather than passes quietly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/* Read as source rather than import: `attribution.ts` reaches `lib/monitor.ts`, which uses a
   bundler path alias that raw ESM cannot resolve. The guarantees here are source contracts
   anyway — `campaign.test.mjs` executes the behaviour that can be executed. */
/* Line endings are normalised because git renormalises these files to CRLF on checkout,
   and a source assertion that depends on which byte a line ends with is testing the wrong
   thing. */
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const handlers = read("lib/telegram/handlers.ts");
const session = read("lib/session.ts");
const paperRoute = read("app/api/paper/route.ts");
const attribution = read("lib/growth/attribution.ts");
const campaign = read("lib/growth/campaign.ts");
const sql = read("supabase/prepared/20260806_ryn_beta_001_acquisition_v1.sql");
const texts = read("lib/beta/texts.ts");
const publicBeta = read("app/beta/page.tsx");
const cabinetBeta = read("app/app/beta/page.tsx");
/* The cabinet's landing screen. It was `app/app/page.tsx` until Product Canon
   v1.0 §9.1 made Portfolio the overview and `/app` a doorway onto it, so the
   rule below now reads the surface a person actually lands on. */
const dashboard = read("app/solana/workspace/holdings/holdings-card.tsx");
const cabinetCopy = read("app/app/copy.ts");

/* ---------------------------------------------------------------- access */

test("channel membership is never consulted for access", function () {
  assert.doesNotMatch(handlers, /isChannelMember/);
  /* User access never reads the channel. Admin authority lives in
     `admin_operators`; channel membership is only a bootstrap/fallback inside
     that store, not in the bot handler. */
  assert.doesNotMatch(handlers, /isChannelAdmin/);
  assert.match(handlers, /isAdminOperator/);
  assert.doesNotMatch(handlers, /chk_tg/);
});

test("confirmation is the only thing that grants access", function () {
  /* Exactly one call site writes the access flag, and it lives in the confirm branch. */
  const writes = handlers.match(/setTask\(/g) ?? [];
  assert.equal(writes.length, 1, "the access flag must have exactly one writer");
  assert.match(handlers, /case "confirm": \{[\s\S]*?setTask\(user\.id, ACCESS_TASK, "verified"\)/);
  assert.match(handlers, /const ACCESS_TASK = "telegram_join"/);
});

test("no Arcus, X-follow or channel task can be set by any surface", function () {
  for (const source of [handlers, cabinetBeta, dashboard]) {
    assert.doesNotMatch(source, /arcus_referral/);
    assert.doesNotMatch(source, /x_follow/);
  }
});

test("an existing verified user keeps access without a migration", function () {
  /* The session still reads the same stored flag the old flow wrote, so rows verified
     before this change stay verified. */
  assert.match(session, /tasks\?\.telegram_join\?\.status === "verified"/);
  assert.match(handlers, /ACCESS_TASK = "telegram_join"/);
});

test("a repeated confirmation is idempotent", function () {
  /* Application short-circuit … */
  assert.match(handlers, /if \(hasAccess\(state\)\) \{[\s\S]*?confirmAlready/);
  /* … and the database refuses a second row even if the short-circuit is bypassed. */
  assert.match(sql, /constraint beta_funnel_event_unique unique \(user_id, event, dedupe_key\)/);
});

test("a null state fails closed instead of granting access", function () {
  assert.match(handlers, /if \(!state\) \{\s*await answerCallback\(cb\.id, c\.stateError\);/);
  assert.match(handlers, /const next = await setTask[\s\S]*?if \(!next\) \{[\s\S]*?stateError/);
});

test("referral identifiers no longer create a referral edge or any reward", function () {
  assert.match(handlers, /inviterRef: null/);
  assert.doesNotMatch(handlers, /referral_code/);
  assert.doesNotMatch(dashboard, /referral_code|priority_score|invites/);
  /* Scoped to real UI rather than prose: the comment explaining that the invite panel was
     removed is exactly the kind of note that should survive. */
  for (const source of [dashboard, cabinetBeta]) {
    assert.doesNotMatch(source, /bg-invite-link/);
    assert.doesNotMatch(source, /start=ref_/);
  }
});

/* ---------------------------------------------------------------- namespaces */

test("the two start-payload namespaces are structurally separate", function () {
  assert.match(campaign, /startsWith\("ref_"\)/);
  assert.match(campaign, /startsWith\("x_"\)/);
  /* A referral result carries no campaign fields, so it can never be read as one. */
  assert.match(campaign, /kind: "legacy_referral"; code: string/);
  assert.match(campaign, /kind: "campaign"; touch: CampaignTouch/);
});

test("a touch needs both a well-formed payload and an issued campaign", function () {
  assert.match(attribution, /if \(parsed\.kind !== "campaign"\) return "unavailable"/);
  assert.match(attribution, /if \(!isRegisteredCampaign\(parsed\.touch\)\) return "unavailable"/);
});

test("bot_start comes only from an explicit /start", function () {
  /* The fallback that greets an unknown sender must not count as a start. */
  assert.match(handlers, /if \(fromStartCommand\) void recordBotStart\(/);
  assert.match(handlers, /if \(cmd === "\/start"\) return handleStart\(msg, arg \|\| undefined, update\.update_id, true\);/);
  assert.match(handlers, /if \(!state\) return handleStart\(msg, undefined, update\.update_id, false\);/);
});

/* ---------------------------------------------------------------- first value */

test("the first value is paper_plan and the events are exactly the four named", function () {
  assert.match(attribution, /export const FIRST_VALUE_ID = "paper_plan";/);
  assert.match(
    attribution,
    /export const FUNNEL_EVENTS = \[\s*"bot_start",\s*"access_confirmed",\s*"first_value_started",\s*"first_value_completed",\s*\] as const;/,
  );
  /* A bot start, an access confirmation and a page view are events, never first value. */
  assert.match(attribution, /A bot start, an access confirmation and a page view are not it\./);
});

test("first_value_started happens after auth, access and validation", function () {
  /* lastIndexOf, because the import statement names the same symbol at the top of the file. */
  const startedAt = paperRoute.lastIndexOf("recordFirstValueStarted");
  const authAt = paperRoute.indexOf("if (!session.verified)");
  const validatedAt = paperRoute.indexOf('return NextResponse.json({ error: "bad params" }');
  const readinessAt = paperRoute.indexOf('readiness.level === "not-ready"');
  assert.ok(authAt > -1 && validatedAt > -1 && readinessAt > -1 && startedAt > -1);
  assert.ok(startedAt > authAt, "started must follow the auth and verification checks");
  assert.ok(startedAt > validatedAt, "started must follow structural validation");
  assert.ok(startedAt > readinessAt, "started must follow the readiness gate");
});

test("a failed paper mutation can never emit a completion", function () {
  const openAt = paperRoute.indexOf("const r = await paperOpen(");
  const guardAt = paperRoute.indexOf("if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });", openAt);
  const completedAt = paperRoute.lastIndexOf("recordFirstValueCompleted");
  assert.ok(openAt > -1 && guardAt > openAt && completedAt > guardAt,
    "completion must sit after the persistence guard, not before it");
});

test("first value means the user's first plan, not their next one", function () {
  /* A long-standing user opening another trade must not be relabelled as newly reaching
     first value, and a failed history read declines the claim instead of guessing. */
  assert.match(paperRoute, /const isFirstPlan = current\.ok && current\.data\.open\.length === 0 && current\.data\.closed\.length === 0;/);
  assert.match(paperRoute, /if \(isFirstPlan && telegramId !== null\) void recordFirstValueStarted\(/);
  assert.match(paperRoute, /if \(isFirstPlan && telegramId !== null\) void recordFirstValueCompleted\(/);
});

test("the reward ladder is retired at its source, not only on screen", function () {
  const retire = read("supabase/prepared/20260806_ryn_beta_001_retire_reward_ladder_v1.sql");
  /* Scoring no longer reads the retired tasks or referrals … */
  const recompute = retire.slice(retire.indexOf("function private.beta_recompute"), retire.indexOf("function public.beta_set_wallet"));
  assert.doesNotMatch(recompute, /arcus_referral|x_follow|beta_referrals/);
  assert.match(recompute, /priority_score = 0/);
  /* … saving a wallet no longer advances a rung … */
  const wallet = retire.slice(retire.indexOf("function public.beta_set_wallet"), retire.indexOf("function public.beta_set_task"));
  assert.doesNotMatch(wallet, /arcus_referral/);
  /* … and confirming access no longer pays an inviter. */
  const setTask = retire.slice(retire.indexOf("function public.beta_set_task"));
  assert.doesNotMatch(setTask, /beta_referrals/);
  assert.match(retire, /drop function if exists public\.beta_admin_verify/);
  assert.match(retire, /NOT APPLIED to production/);
  assert.match(retire, /ROLLBACK \/ RECOVERY/);
});

test("the admin surface carries no X verification, score or invite control", function () {
  const panel = read("app/admin/panel.tsx");
  const adminApi = read("app/api/admin/route.ts");
  const audit = read("lib/admin-audit.ts");
  const betaRpc = read("lib/beta/rpc.ts");
  for (const source of [panel, adminApi, audit, betaRpc]) {
    assert.doesNotMatch(source, /verify_x|adminVerify|beta_admin_verify/);
  }
  assert.doesNotMatch(panel, /priority_score|top_inviters|arcus_referral|x_follow/);
});

test("start and completion are once per user regardless of the caller", function () {
  assert.match(attribution, /ONCE_PER_USER[\s\S]*?"access_confirmed",\s*"first_value_started",\s*"first_value_completed",/);
  assert.match(attribution, /ONCE_PER_USER\.has\(event\) \? ONCE :/);
  /* The database does not trust the application with this either. */
  assert.match(sql, /if p_event in \('access_confirmed', 'first_value_started', 'first_value_completed'\) then\s*v_key := 'once';/);
});

test("the first-value identifier is derived server-side, never accepted", function () {
  assert.match(sql, /v_fv := 'paper_plan';/);
  assert.match(sql, /beta_funnel_event_first_value_chk/);
});

/* ---------------------------------------------------------------- fail-safe */

test("analytics can never block access or the paper workflow", function () {
  /* Fire-and-forget at every call site … */
  assert.match(handlers, /void recordBotStart\(/);
  assert.match(handlers, /void recordAccessConfirmed\(/);
  assert.match(paperRoute, /void recordFirstValueStarted\(/);
  assert.match(paperRoute, /void recordFirstValueCompleted\(/);
  /* … and the module swallows its own failures rather than propagating them. */
  assert.match(attribution, /} catch \{/);
  assert.match(attribution, /return "unavailable"/);
});

test("an unavailable attribution path is reported sampled, not on every call", function () {
  assert.match(attribution, /REPORT_WINDOW_MS/);
  assert.match(attribution, /if \(now - previous < REPORT_WINDOW_MS\) return;/);
  /* The sampler is useless if the shared transport logs first. Acquisition calls are quiet,
     so the deliberately unapplied schema does not emit a line per bot start. */
  const rpc = read("lib/supabase-rpc.ts");
  assert.match(rpc, /options\?: \{ quiet\?: boolean \}/);
  assert.match(rpc, /if \(!quiet\) console\.error/);
  assert.match(rpc, /if \(!quiet\) void reportError/);
  assert.equal((attribution.match(/\{ quiet: true \}/g) ?? []).length, 2,
    "both acquisition RPCs must be quiet");
});

test("an unavailable path is never reported as a zero", function () {
  /* `unavailable` is its own outcome, distinct from a recorded count of none. */
  assert.match(attribution, /RecordOutcome = "recorded" \| "duplicate" \| "unavailable"/);
  assert.doesNotMatch(attribution, /return 0;/);
});

/* ---------------------------------------------------------------- privacy and schema */

test("first touch is immutable at the schema level", function () {
  assert.match(sql, /user_id\s+uuid primary key references public\.beta_users\(id\) on delete cascade/);
  assert.match(sql, /on conflict \(user_id\) do nothing/);
  assert.doesNotMatch(sql, /update public\.beta_acquisition_touch/);
});

test("erasure cascades from the user to every acquisition record", function () {
  const cascades = sql.match(/references public\.beta_users\(id\) on delete cascade/g) ?? [];
  assert.equal(cascades.length, 2, "both acquisition tables must cascade from the user");
});

test("no raw identity or free text is stored", function () {
  const forbidden = [
    /\bip_address\b/i, /\bip\s+inet\b/i, /\bx_handle\b/i, /\busername\b/i,
    /\bwallet\b/i, /\breferrer\b/i, /\bmessage_text\b/i, /\buser_agent\b/i, /\btelegram_id\s+bigint\s+not null/i,
  ];
  const tables = sql.slice(sql.indexOf("create table"), sql.indexOf("-- ---------------------------------------------------------------- access control"));
  for (const pattern of forbidden) {
    assert.doesNotMatch(tables, pattern, `acquisition tables must not store ${pattern}`);
  }
});

test("the tables fail closed: RLS forced, no policies, no direct grants", function () {
  assert.match(sql, /alter table public\.beta_acquisition_touch enable row level security/);
  assert.match(sql, /alter table public\.beta_acquisition_touch force row level security/);
  assert.match(sql, /alter table public\.beta_funnel_event enable row level security/);
  assert.match(sql, /alter table public\.beta_funnel_event force row level security/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /revoke all on public\.beta_acquisition_touch from anon, authenticated/);
  assert.match(sql, /revoke all on public\.beta_funnel_event from anon, authenticated/);
});

test("every function is secret-gated, definer-scoped and search_path-pinned", function () {
  const definers = sql.match(/security definer/g) ?? [];
  const paths = sql.match(/set search_path = ''/g) ?? [];
  const gates = sql.match(/perform private\.beta_check_secret\(p_secret\);/g) ?? [];
  assert.equal(definers.length, 3);
  assert.equal(paths.length, 3, "every definer function needs an empty search_path");
  assert.equal(gates.length, 3, "every definer function needs the app-secret gate");
  assert.doesNotMatch(sql, /execute\s+format\(|execute\s+'/i, "no dynamic SQL");
});

test("aggregates expose counts, never a rate and never a user", function () {
  assert.match(sql, /count\(\*\) as events/);
  assert.doesNotMatch(sql, /::float|::numeric\s*\)?\s*\/|100\.0\s*\*/);
  /* The projected columns are what leaves the database. A join on user_id is fine; a
     user_id in the result is not. */
  const fn = sql.slice(sql.indexOf("beta_acquisition_counts"));
  const projection = fn.slice(fn.indexOf("select\n      t.campaign_id"), fn.indexOf("from public.beta_funnel_event"));
  assert.ok(projection.length > 0, "the aggregate projection must be findable");
  assert.doesNotMatch(projection, /telegram_id|user_id|username|wallet/);
});

test("the migration is prepared, not applied", function () {
  assert.match(sql, /NOT APPLIED to production/);
  assert.match(sql, /ROLLBACK \/ RECOVERY/);
  const applied = readdirSync(new URL("../../supabase/migrations", import.meta.url));
  assert.equal(
    applied.some((name) => name.includes("ryn_beta_001")),
    false,
    "the acquisition schema must not appear among applied migrations",
  );
});

/* ---------------------------------------------------------------- copy */

test("no locale claims a mandatory channel, an Arcus rung, or an X or referral reward", function () {
  const forbidden = [
    /Join the Telegram channel/i,
    /Register on Arcus/i,
    /Follow on X/i,
    /proof.?code/i,
    /pinned post/i,
    /priority score/i,
    /Пріоритетний бал/i,
    /Приоритетный балл/i,
    /invite link/i,
    /інвайт-лінк/i,
    /инвайт-ссылка/i,
    /raises your (beta )?priority/i,
    /підвищує (твій )?пріоритет/i,
    /повышает (твой )?приоритет/i,
  ];
  for (const source of [texts, cabinetCopy, publicBeta]) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `stale gate claim survived: ${pattern}`);
    }
  }
});

test("every locale states plainly that the optional things are optional", function () {
  /* Match the assignments, not the type declaration, so the count is locales and not four. */
  assert.equal((texts.match(/optionalNote: "/g) ?? []).length, 3, "EN, UK and RU each need the optional note");
  assert.equal((texts.match(/btnConfirm: "/g) ?? []).length, 3, "EN, UK and RU each need the confirm button");
});

test("public /beta stays English-only and truthful", function () {
  assert.doesNotMatch(publicBeta, /[Ѐ-ӿ]/, "public /beta must not carry Cyrillic literals");
  assert.doesNotMatch(publicBeta, /Beta Status affects priority/i);
  assert.match(publicBeta, /nothing else on this page or in the bot gates access/i);

  /* Scanning the file for Cyrillic is not enough: the page imports a localised dictionary,
     so a locale chosen from the query string would render Cyrillic that never appears in
     this source. The English entry must be pinned, not selected. */
  assert.match(publicBeta, /const bot = BETA_COPY\.en;/);
  assert.doesNotMatch(publicBeta, /BETA_COPY\[/);

  /* Follow the imported data the page actually renders. */
  const en = texts.slice(texts.indexOf("const en: BetaCopy"), texts.indexOf("const uk: BetaCopy"));
  for (const field of ["authRecovery", "pageTrust"]) {
    const at = en.indexOf(`${field}:`);
    assert.ok(at > -1, `${field} must exist in the English entry`);
    const value = en.slice(at, en.indexOf("\n  ", at + field.length + 40));
    assert.doesNotMatch(value, /[Ѐ-ӿ]/, `${field} rendered on public /beta must be English`);
  }
});

test("public /beta metadata describes the gate that exists", function () {
  const description = publicBeta.slice(publicBeta.indexOf("description:"), publicBeta.indexOf("robots:"));
  assert.doesNotMatch(description, /checklist/i, "the metadata must not still promise a checklist");
  assert.match(description, /One confirmation in the Telegram bot opens it/);
});

/* ---------------------------------------------------------------- no X API */

test("nothing in the acquisition path depends on an X API, credential or spend", function () {
  for (const source of [handlers, attribution, campaign, paperRoute]) {
    assert.doesNotMatch(source, /api\.(twitter|x)\.com/i);
    assert.doesNotMatch(source, /X_API|TWITTER_API|BEARER_TOKEN|oauth/i);
  }
});
