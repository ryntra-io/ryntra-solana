/*
 * The queue's migration, read as text: nothing a visitor may read or write, every server function asks for the
 * secret, the switch starts off and its lists match the code. With MOMENTS_TEST_DATABASE_URL naming a local server,
 * the same queue tests run against a throwaway database through the real store (never point it at a real project).
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { POST_KINDS } from './events.ts';
import { DRAFT_STATUSES, MEDIA_MAX_BYTES, MEDIA_TYPES } from './store.ts';

const migrations = new URL('../../../../supabase/migrations/', import.meta.url);
const files = readdirSync(migrations).filter((f) => f.includes('moments'));
const sql = readFileSync(new URL('20261027150000_city_moments_drafts_v1.sql', migrations), 'utf8');
const code = sql.replace(/^\s*--.*$/gm, '');
// CITY-38: the fifth kind, `studio`, in a file of its own, so the CITY-3 file stays as merged.
const studioSql = readFileSync(new URL('20261027160000_city_moments_drafts_studio_v1.sql', migrations), 'utf8');
const studioCode = studioSql.replace(/^\s*--.*$/gm, '');

const TABLES = ['private.moments_drafts', 'private.moments_media', 'private.moments_switch'];
const FUNCTIONS = [
  'moments_draft_put', 'moments_drafts_list', 'moments_draft_get', 'moments_draft_decide', 'moments_drafts_approve_all',
  'moments_draft_media_put', 'moments_draft_media_get', 'moments_draft_claim', 'moments_draft_delivered', 'moments_switch_get', 'moments_switch_set',
];

test('the queue’s migration files, each one transaction, not applied anywhere by this repository', () => {
  assert.deepEqual(files, ['20261027150000_city_moments_drafts_v1.sql', '20261027160000_city_moments_drafts_studio_v1.sql']);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  assert.doesNotMatch(code, /^\s*(drop|truncate|alter table public\.)/im);
  assert.doesNotMatch(code, /world_/, 'the world’s tables are the world line’s');
});

test('the studio file (CITY-38) only widens the kind check: no table, grant, policy or function', () => {
  assert.match(studioSql, /^begin;$/m);
  assert.match(studioSql, /^commit;$/m);
  assert.match(studioSql, /Not applied to any Supabase project/);
  const statements = studioCode.split(';').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
  assert.deepEqual(statements, [
    'begin',
    'alter table private.moments_drafts drop constraint moments_drafts_kind_check',
    `alter table private.moments_drafts add constraint moments_drafts_kind_check check (kind in (${POST_KINDS.map((k) => `'${k}'`).join(', ')}))`,
    'commit',
  ]);
  const before = [...code.match(/kind text not null check \(kind in \(([^)]+)\)\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...before, 'studio'], [...POST_KINDS], 'the CITY-3 file keeps its four kinds; the studio file adds the fifth');
});

test('every table is private, with row level security forced, no policy and no grant', () => {
  const created = [...code.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), [...TABLES].sort());
  for (const table of created) {
    assert.match(code, new RegExp(`alter table ${table.replace('.', '\\.')} enable row level security;`));
    assert.match(code, new RegExp(`alter table ${table.replace('.', '\\.')} force row level security;`));
  }
  assert.doesNotMatch(code, /create policy/);
  const grants = [...code.matchAll(/^grant ([^\n]+);$/gm)].map((m) => m[1]);
  assert.ok(grants.every((g) => g.startsWith('execute on function public.moments_')), grants.join('\n'));
  assert.match(code, /revoke all privileges on table private\.moments_drafts, private\.moments_media, private\.moments_switch\s+from public, anon, authenticated, service_role;/);
});

test('every server function is secret-gated, runs with an empty search path and is granted to anon alone', () => {
  const publicFns = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(publicFns.sort(), [...FUNCTIONS].sort());
  for (const fn of publicFns) {
    const body = code.slice(code.indexOf(`create function public.${fn}(`)).split(/\n\$\$;/)[0];
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/, fn);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  for (const fn of [...code.matchAll(/create function private\.(\w+)\(/g)].map((m) => m[1])) {
    assert.match(code, new RegExp(`revoke all on function private\\.${fn}\\(`), fn);
  }
});

test('the lists in the database are the code’s, the media cap is the same and the switch starts off', () => {
  const list = (re) => [...code.match(re)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(list(/status text not null default 'filming' check \(status in \(([^)]+)\)\)/), [...DRAFT_STATUSES]);
  assert.deepEqual(list(/type text not null check \(type in \(([^)]+)\)\)/), [...MEDIA_TYPES]);
  assert.ok(code.includes(`octet_length(bytes) between 1 and ${MEDIA_MAX_BYTES}`));
  assert.match(code, /insert into private\.moments_switch \(id, autopost_on\) values \(true, false\);/);
  assert.match(code, /autopost_on boolean not null default false/);
  assert.doesNotMatch(code, /(api[_-]?key|bearer|consumer_secret|access_token|oauth)/i, 'no X credential has a column');
});

/* ------------------------------------------------------------------------------------------------ */
/* The real store on a throwaway database                                                           */
/* ------------------------------------------------------------------------------------------------ */

const url = process.env.MOMENTS_TEST_DATABASE_URL;
const SECRET = 'moments-test-secret';
const BOOTSTRAP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create function private.beta_check_secret(p_secret text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is distinct from '${SECRET}' then raise exception 'forbidden'; end if;
end; $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema private grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema private grant execute on functions to anon, authenticated, service_role;
`;

test('the real store against a throwaway database', { skip: url ? false : 'MOMENTS_TEST_DATABASE_URL is not set' }, async (t) => {
  const { default: pg } = await import('pg');
  const { SupabaseDraftStore } = await import('./supabase-store.ts');
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `moments_test_${randomBytes(6).toString('hex')}`;
  await admin.query(`create database ${name}`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  t.after(async () => {
    await db.end();
    await admin.query(`drop database ${name}`);
    await admin.end();
  });
  await db.query(BOOTSTRAP);
  await db.query(sql);
  await db.query(studioSql);

  // PostgREST calls a function by name with named, typed arguments, as `anon`.
  const types = async (fn) =>
    new Map((await db.query(
      `select unnest(proargnames) as name, format_type(unnest(proargtypes::oid[]), null) as type
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn],
    )).rows.map((r) => [r.name, r.type]));
  const rpc = (secret) => async (fn, args) => {
    const all = { p_secret: secret, ...args };
    const map = await types(fn);
    const names = Object.keys(all);
    const call = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}::${map.get(n)}`).join(', ')}) as r`;
    try {
      await db.query('set role anon');
      const { rows } = await db.query(call, names.map((n) => (all[n] !== null && typeof all[n] === 'object' ? JSON.stringify(all[n]) : all[n])));
      return { ok: true, data: rows[0].r };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      await db.query('reset role');
    }
  };
  const store = new SupabaseDraftStore(rpc(SECRET));
  const now = new Date('2026-10-27T12:05:00.000Z');

  await t.test('nothing is readable or callable without the secret', async () => {
    await db.query('set role anon');
    await assert.rejects(db.query('select * from private.moments_drafts'));
    await assert.rejects(db.query('select * from private.moments_switch'));
    await db.query('reset role');
    const wrong = new SupabaseDraftStore(rpc('wrong'));
    await assert.rejects(wrong.list({ status: null, limit: 10 }), /forbidden/);
    await assert.rejects(wrong.setSwitch({ on: true, by: 'x', now }), /forbidden/);
  });

  await t.test('the switch starts off and keeps who turned it', async () => {
    assert.deepEqual(await store.switch(), { on: false, changedBy: null, changedAt: null });
    assert.deepEqual(await store.setSwitch({ on: true, by: 'operator:1', now }), { on: true, changedBy: 'operator:1', changedAt: now.toISOString() });
    assert.equal((await store.setSwitch({ on: false, by: 'key', now })).on, false);
  });

  await t.test('the queue runs the same way as in memory', async () => {
    const { createMomentsApi } = await import('./api.ts');
    const { NO_SENDER } = await import('./sender.ts');
    const api = createMomentsApi({ store, sender: NO_SENDER, now: () => now, authorize: async () => ({ ok: true, by: 'operator:1', actor: 1 }) });
    const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const ev = (kind, id, extra = {}) => new Request('https://ryntra.io/api/moments/events', {
      method: 'POST', body: JSON.stringify({ kind, id, mint: BONK, symbol: 'BONK', named: true, district: 'docks', sourceAt: '2026-10-27T12:00:00Z', ...extra }),
    });
    const a = await (await api.events(ev('launch', 'L1'))).json();
    assert.equal(a.created, true);
    assert.equal(a.draft.status, 'filming');
    assert.equal((await (await api.events(ev('launch', 'L1'))).json()).draft.id, a.draft.id, 'one draft per happening');
    const b = await (await api.events(ev('graduate', 'G1'))).json();
    const c = await (await api.events(ev('bigx', 'X1', { multiple: 9, tx: '3'.repeat(88) }))).json();

    const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 9, 8, 7]);
    const clip = (id) => api.putClip(new Request(`https://ryntra.io/api/moments/drafts/${id}/clip`, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: MP4 }), id);
    assert.equal((await api.approve(new Request('https://ryntra.io/x', { method: 'POST' }), a.draft.id)).status, 409);
    for (const d of [a, b, c]) assert.equal((await clip(d.draft.id)).status, 200);
    const back = await api.getClip(new Request('https://ryntra.io/x'), a.draft.id);
    assert.deepEqual(new Uint8Array(await back.arrayBuffer()), MP4);

    const rej = await (await api.reject(new Request('https://ryntra.io/x', { method: 'POST' }), c.draft.id)).json();
    assert.equal(rej.draft.status, 'rejected');
    const all = await (await api.approveAll(new Request('https://ryntra.io/x', { method: 'POST' }))).json();
    assert.equal(all.approved, 2);
    assert.ok(all.drafts.every((d) => d.status === 'approved' && d.decidedBy === 'operator:1' && d.decidedAt === now.toISOString()));
    assert.equal((await clip(a.draft.id)).status, 409, 'a decided clip stays');

    const list = await (await api.list(new Request('https://ryntra.io/api/moments/drafts'))).json();
    assert.equal(list.drafts.length, 3);
    assert.equal(list.drafts[0].moment.towerId, BONK);
    assert.equal((await (await api.list(new Request('https://ryntra.io/api/moments/drafts?status=rejected'))).json()).drafts.length, 1);

    assert.equal((await store.delivered({ id: a.draft.id, delivery: { status: 'sent', note: 'x' }, now })).status, 'approved', 'not claimed, not marked');
    assert.equal(await store.claim({ id: a.draft.id, now }), null, 'the switch is off: no claim');
    await store.setSwitch({ on: true, by: 'operator:1', now });
    const claims = await Promise.all([store.claim({ id: a.draft.id, now }), store.claim({ id: a.draft.id, now })]);
    assert.equal(claims.filter(Boolean).length, 1, 'one claim wins');
    assert.equal(claims.find(Boolean).status, 'sending');
    const sent = await store.delivered({ id: a.draft.id, delivery: { status: 'sent', note: 'posted 1' }, now });
    assert.equal(sent.status, 'sent');
    assert.equal(await store.claim({ id: a.draft.id, now }), null, 'sent is never claimed again');
    await store.setSwitch({ on: false, by: 'operator:1', now });
    assert.equal((await store.delivered({ id: c.draft.id, delivery: { status: 'sent', note: 'x' }, now })).status, 'rejected', 'only a claimed draft moves');
  });

  await t.test('a studio post (CITY-38) goes in, its largest facts within the table’s 4 KB', async () => {
    const { createMomentsApi } = await import('./api.ts');
    const { NO_SENDER } = await import('./sender.ts');
    const api = createMomentsApi({ store, sender: NO_SENDER, now: () => now, authorize: async () => ({ ok: true, by: 'key', actor: null }) });
    const rows = ['$AAAAAAAAAAAA', '$BBBBBBBBBBBB', '$CCCCCCCCCCCC', '$DDDDDDDDDDDD', '$EEEEEEEEEEEE'].map((symbol, i) => ({ mint: `${'9'.repeat(43)}${i + 1}`, symbol, value: 1234.5678 + i }));
    const facts = { template: 'billboard', ranking: 'week', from: '2026-10-20T12:00:00.000Z', readAt: '2026-10-27T12:00:00.000Z', live: true, rows };
    const res = await api.events(new Request('https://ryntra.io/api/moments/events', { method: 'POST', body: JSON.stringify({ kind: 'studio', id: 'billboard-week-x', facts }) }));
    assert.equal(res.status, 201);
    const { draft } = await res.json();
    assert.equal(draft.kind, 'studio');
    assert.equal(draft.moment.studio.rows.length, 5);
    assert.ok(Buffer.byteLength(JSON.stringify(draft.moment)) < 4096);
  });

  await t.test('the table refuses what the code would never write', async () => {
    const put = (o) => store.put({ eventId: 'e', kind: 'launch', moment: {}, text: 't', link: 'https://ryntra.io/', now, ...o });
    await assert.rejects(put({ eventId: 'k', kind: 'pump' }));
    await assert.rejects(put({ eventId: 'l', link: 'javascript:alert(1)' }));
    await assert.rejects(put({ eventId: 'm', text: '' }));
  });
});
