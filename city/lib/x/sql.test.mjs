/*
 * The publisher's ledger migration, read as text: nothing a visitor may read or write, every server function asks for
 * the secret, its lists match the code, no credential has a column. With MOMENTS_TEST_DATABASE_URL naming a local
 * server, the ledger and a whole pass run against a throwaway database through the real stores, two connections at
 * once (never point it at a real project).
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { X_POST_STATUSES, LIVE, NEAR_HOURS } from './ledger.ts';

const migrations = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(migrations).filter((f) => /_city_x_/.test(f));
const sql = readFileSync(new URL('20261027180000_city_x_posts_v1.sql', migrations), 'utf8');
const drafts = readFileSync(new URL('20261027150000_city_moments_drafts_v1.sql', migrations), 'utf8');
const code = sql.replace(/^\s*--.*$/gm, '');
const FUNCTIONS = ['x_post_reserve', 'x_post_finish', 'x_posts_day'];

test('one migration file, one transaction, after the drafts queue, not applied anywhere by this repository', () => {
  assert.deepEqual(files, ['20261027180000_city_x_posts_v1.sql']);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  assert.match(code, /references private\.moments_drafts\(id\)/);
  assert.doesNotMatch(code, /^\s*(drop|truncate|alter table public\.)/im);
});

test('the table is private, row level security forced, no policy, no grant; no X credential has a column', () => {
  assert.deepEqual([...code.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]), ['private.x_posts']);
  assert.match(code, /alter table private\.x_posts enable row level security;/);
  assert.match(code, /alter table private\.x_posts force row level security;/);
  assert.doesNotMatch(code, /create policy/);
  assert.match(code, /revoke all privileges on table private\.x_posts from public, anon, authenticated, service_role;/);
  const grants = [...code.matchAll(/^grant ([^\n]+);$/gm)].map((m) => m[1]);
  assert.ok(grants.every((g) => g.startsWith('execute on function public.x_post')), grants.join('\n'));
  assert.doesNotMatch(code, /(api[_-]?key|bearer|consumer|access_token|access_secret|oauth)/i);
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
  assert.match(code, /revoke all on function private\.x_post_json\(/);
});

test('the lists in the database are the code’s', () => {
  const list = (re) => [...code.match(re)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(list(/status text not null default 'sending' check \(status in \(([^)]+)\)\)/), [...X_POST_STATUSES]);
  assert.deepEqual(list(/x_posts_live_text_idx on private\.x_posts \(text_hash\)\s+where status in \(([^)]+)\)/), [...LIVE]);
  assert.deepEqual(list(/x_posts_live_media_idx on private\.x_posts \(media_hash\)\s+where media_hash is not null and status in \(([^)]+)\)/), [...LIVE]);
  assert.deepEqual(list(/x_posts_live_shape_idx on private\.x_posts \(shape_hash, started_at desc\)\s+where status in \(([^)]+)\)/), [...LIVE]);
  assert.ok(code.includes(`started_at > p_now - interval '${NEAR_HOURS} hours'`), 'the near-duplicate window is the code’s');
});

/* ------------------------------------------------------------------------------------------------ */
/* The real ledger on a throwaway database                                                          */
/* ------------------------------------------------------------------------------------------------ */

const url = process.env.MOMENTS_TEST_DATABASE_URL;
const SECRET = 'x-test-secret';
const BOOTSTRAP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create extension if not exists pgcrypto;
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

test('the real ledger against a throwaway database', { skip: url ? false : 'MOMENTS_TEST_DATABASE_URL is not set' }, async (t) => {
  const { default: pg } = await import('pg');
  const { SupabaseDraftStore } = await import('../moments/drafts/supabase-store.ts');
  const { SupabaseXLedger } = await import('./supabase-ledger.ts');
  const { mediaHash, shapeHash, textHash } = await import('./ledger.ts');
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `x_test_${randomBytes(6).toString('hex')}`;
  await admin.query(`create database ${name}`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  const connect = async () => {
    const c = new pg.Client({ connectionString: target.toString() });
    await c.connect();
    return c;
  };
  const db = await connect();
  const db2 = await connect();
  t.after(async () => {
    await db.end();
    await db2.end();
    await admin.query(`drop database ${name}`);
    await admin.end();
  });
  await db.query(BOOTSTRAP);
  await db.query(drafts);
  await db.query(sql);

  // PostgREST calls a function by name with named, typed arguments, as `anon`.
  const rpc = (conn, secret = SECRET) => async (fn, args) => {
    const all = { p_secret: secret, ...args };
    const types = new Map((await conn.query(
      `select unnest(proargnames) as name, format_type(unnest(proargtypes::oid[]), null) as type
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn],
    )).rows.map((r) => [r.name, r.type]));
    const names = Object.keys(all);
    const call = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}::${types.get(n)}`).join(', ')}) as r`;
    try {
      await conn.query('set role anon');
      const { rows } = await conn.query(call, names.map((n) => (all[n] !== null && typeof all[n] === 'object' ? JSON.stringify(all[n]) : all[n])));
      return { ok: true, data: rows[0].r };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      await conn.query('reset role');
    }
  };
  const store = new SupabaseDraftStore(rpc(db));
  const store2 = new SupabaseDraftStore(rpc(db2));
  const ledger = new SupabaseXLedger(rpc(db));
  const ledger2 = new SupabaseXLedger(rpc(db2));
  const now = new Date('2026-10-27T09:05:00.000Z');
  const MP4 = (s) => new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, s, 9]);
  let n = 0;
  const approved = async (text = `Draft ${n + 1}. https://ryntra.io/`, clip = MP4(n + 1)) => {
    n += 1;
    // Each draft a second apart: the line is oldest first.
    const made = new Date(now.getTime() - 3_600_000 + n * 1000);
    const { draft } = await store.put({ eventId: `launch:S${n}`, kind: 'launch', moment: {}, text, link: 'https://ryntra.io/', now: made });
    await store.setMedia({ id: draft.id, type: 'video/mp4', bytes: clip, now });
    return (await store.decide({ id: draft.id, decision: 'approved', by: 'operator:1', now })).draft;
  };

  await t.test('nothing is readable without the secret', async () => {
    await db.query('set role anon');
    await assert.rejects(db.query('select * from private.x_posts'));
    await db.query('reset role');
    await assert.rejects(new SupabaseXLedger(rpc(db, 'wrong')).day('2026-10-27'), /forbidden/);
  });

  await t.test('reserve: one slot once, live words and clips once, two connections at once', async () => {
    const a = await approved();
    const b = await approved();
    const row = (slot, draftId, text, clip, at = now) => ({ slot, day: slot.slice(0, 10), draftId, textHash: textHash(text), shapeHash: shapeHash(text), mediaHash: mediaHash(clip), link: true, costUsd: 0.2, now: at });
    const both = await Promise.all([ledger.reserve(row('2026-10-27 11:00', a.id, 'one', MP4(1))), ledger2.reserve(row('2026-10-27 11:00', b.id, 'two', MP4(2)))]);
    assert.equal(both.filter((r) => r.ok).length, 1, 'one connection takes the slot');
    const lost = both.find((r) => !r.ok);
    assert.equal(lost.conflict, 'slot');
    const winner = both.find((r) => r.ok).post;
    assert.equal(winner.status, 'sending');
    assert.equal(winner.costUsd, 0.2);
    const other = winner.draftId === a.id ? b.id : a.id;
    const words = winner.draftId === a.id ? 'one' : 'two';
    const clip = winner.draftId === a.id ? MP4(1) : MP4(2);
    assert.deepEqual(await ledger.reserve(row('2026-10-27 15:00', other, ` ${words.toUpperCase()} `, MP4(7))), { ok: false, conflict: 'text', draftId: winner.draftId });
    assert.deepEqual(await ledger.reserve(row('2026-10-27 15:00', other, 'three', clip)), { ok: false, conflict: 'media', draftId: winner.draftId });
    const done = await ledger.finish({ slot: '2026-10-27 11:00', status: 'failed', postId: null, error: 'X 400: no', now });
    assert.equal(done.status, 'failed');
    assert.equal(done.doneAt, now.toISOString());
    assert.equal((await ledger.finish({ slot: '2026-10-27 11:00', status: 'sent', postId: '1', error: null, now })).status, 'failed', 'only sending moves');
    assert.equal((await ledger.reserve(row('2026-10-27 15:00', other, words, clip))).ok, true, 'a failed row frees its words and clip');
    assert.deepEqual((await ledger.day('2026-10-27')).map((r) => r.slot), ['2026-10-27 11:00', '2026-10-27 15:00']);
    assert.deepEqual(await ledger.day('2026-10-28'), []);
    // A near-duplicate: the same words but for a number, within 20 hours of a live post; a day on, it may go.
    const c = await approved();
    assert.equal((await ledger.reserve(row('2026-10-27 18:00', c.id, 'JUST IN: $3.07B traded in 24 hours.', MP4(60)))).ok, true);
    const d = await approved();
    const later = new Date(now.getTime() + 10 * 3_600_000);
    assert.deepEqual(await ledger.reserve(row('2026-10-27 21:00', d.id, 'JUST IN: $3.11B traded in 24 hours.', MP4(61), later)), { ok: false, conflict: 'shape', draftId: c.id });
    const dayOn = new Date(now.getTime() + 24 * 3_600_000);
    assert.equal((await ledger.reserve(row('2026-10-28 11:00', d.id, 'JUST IN: $3.11B traded in 24 hours.', MP4(61), dayOn))).ok, true);
  });

  await t.test('the table refuses what the code would never write', async () => {
    const d = await approved();
    const bad = (o) => ledger.reserve({ slot: '2026-10-27 21:00', day: '2026-10-27', draftId: d.id, textHash: textHash('z'), shapeHash: shapeHash('z'), mediaHash: null, link: false, costUsd: 0.015, now, ...o });
    await assert.rejects(bad({ slot: 'tomorrow' }));
    await assert.rejects(bad({ day: '2026-10-28' }), 'the day is the slot’s');
    await assert.rejects(bad({ textHash: 'nothex' }));
    await assert.rejects(bad({ shapeHash: 'nothex' }));
    await assert.rejects(bad({ draftId: '00000000-0000-4000-8000-000000000999' }), 'a real draft only');
  });

  await t.test('a whole pass on the real stores, two passes at once: one post', async () => {
    await db.query('set role postgres; delete from private.x_posts; update private.moments_drafts set status = \'rejected\' where status = \'approved\'; reset role');
    const { fakeX, KEYS } = await import('./fake-x.mjs');
    const { createXClient } = await import('./client.ts');
    const { createXSender } = await import('./sender.ts');
    const { runSlot } = await import('./run.ts');
    const { parseSlots } = await import('./schedule.ts');
    const x = await fakeX();
    t.after(() => x.close());
    const sender = createXSender({ connected: true, reason: null }, createXClient({ keys: KEYS, base: x.base, sleep: async () => {} }));
    const config = { slots: parseSlots('11:00,15:00,18:00,21:00', 'Europe/Kyiv').slots, dailyUsd: 1 };
    await store.setSwitch({ on: true, by: 'operator:1', now });
    const first = await approved('First. https://ryntra.io/', MP4(50));
    await approved('Second. https://ryntra.io/', MP4(51));
    const passes = await Promise.all([
      runSlot({ store, ledger, sender, config, now: () => now }),
      runSlot({ store: store2, ledger: ledger2, sender, config, now: () => now }),
    ]);
    assert.equal(passes.filter((p) => p.state === 'sent').length, 1, passes.map((p) => p.state).join(','));
    assert.equal(x.posts.length, 1);
    assert.equal(x.posts[0].text, 'First. https://ryntra.io/');
    const d = await store.get(first.id);
    assert.equal(d.status, 'sent');
    assert.match(d.note, /^posted \d+$/);
    const [row] = await ledger.day('2026-10-27');
    assert.equal(row.status, 'sent');
    assert.equal(row.postId, x.posts[0].id);
    assert.equal((await store.list({ status: 'approved', limit: 10 })).length, 1, 'the second draft waits for its slot');
  });
});
