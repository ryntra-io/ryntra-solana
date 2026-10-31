// Run from repo root: node --test "city/lib/moments/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { layoutCity } from '../city/layout.ts';
import { buildCourse } from '../run/course.ts';
import { flightPilot, roofsPilot } from '../run/autopilot.ts';
import { GHOST_STRIDE, GhostRecorder, TICK, newRun, step } from '../run/sim.ts';
import { ByteReader, ByteWriter, deflate, fromBase64Url, inflate, toBase64Url } from './bytes.ts';
import { challengePayload, challengeUrl, encodeChallenge, openChallenge, readChallengeHead, worldFromVersion } from './challenge.ts';
import { decodeGhost, encodeGhost } from './ghost-code.ts';
import { SOL_MINT, layoutPrint, readWorld, resolveWorld, writeWorld } from './world-code.ts';

const city = JSON.parse(readFileSync(new URL('../market/snapshot.json', import.meta.url), 'utf8'));
const DAY = '2026-10-26';
const TODAY = new Date('2026-10-26T15:00:00Z');

/** A real run through the bundled city, flown by the autopilot the run's own tests use. */
function realRun(form) {
  const course = buildCourse(layoutCity(city.towers), form, DAY);
  const st = newRun();
  const rec = new GhostRecorder();
  const pilot = form === 'flight' ? flightPilot() : roofsPilot();
  while (st.status === 'running' && st.tick < 7200) {
    const input = { tx: 0, ty: 0, actions: 0 };
    if (form === 'flight') Object.assign(input, pilot(course, st));
    else input.actions = pilot(course, st);
    step(course, st, input);
    rec.record(st);
  }
  return { course, st, ghost: rec.take(), time: Math.round(st.t * 100) / 100 };
}

const runs = { flight: realRun('flight'), roofs: realRun('roofs') };

test('bytes: varints of both signs, fixed numbers and text read back as written', () => {
  const w = new ByteWriter();
  const values = [0, 1, 127, 128, 300, 65535, 2 ** 31, 2 ** 40];
  for (const v of values) w.varint(v);
  for (const v of [-1, 1, -64, 64, -100000, 100000]) w.svarint(v);
  w.u8(255).u16(65535).u32(4294967295).i16(-32767).f32(0.5).f64(Math.PI).text('$BONK ✓');
  const r = new ByteReader(w.done());
  for (const v of values) assert.equal(r.varint(), v);
  for (const v of [-1, 1, -64, 64, -100000, 100000]) assert.equal(r.svarint(), v);
  assert.deepEqual([r.u8(), r.u16(), r.u32(), r.i16(), r.f32(), r.f64(), r.text(20)], [255, 65535, 4294967295, -32767, 0.5, Math.PI, '$BONK ✓']);
  assert.equal(r.left, 0);
  assert.throws(() => r.u8(), RangeError, 'a read past the end throws');
});

test('bytes: base64url has only address-safe letters and round-trips; junk is refused', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256);
  const text = toBase64Url(bytes);
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(fromBase64Url(text), bytes);
  assert.equal(fromBase64Url('abc$%'), null);
});

test('bytes: inflate stops at its cap, so a crafted link cannot swallow memory', async () => {
  const big = await deflate(new Uint8Array(500_000));
  assert.ok(big.length < 2_000, 'zeros deflate to almost nothing');
  await assert.rejects(inflate(big, 64 * 1024), RangeError);
  assert.equal((await inflate(big, 1 << 20)).length, 500_000);
});

for (const form of ['flight', 'roofs']) {
  test(`ghost (${form}): a real run replays tick for tick within 1.6 cm, dash to the tick`, () => {
    const { ghost, st } = runs[form];
    assert.equal(st.status, 'finished', 'the autopilot finishes the bundled course');
    const back = decodeGhost(encodeGhost(ghost));
    assert.equal(back.length, ghost.length, 'one row per tick');
    for (let i = 0; i < ghost.length; i += GHOST_STRIDE) {
      assert.ok(Math.abs(back[i] - ghost[i]) <= 1 / 64 + 1e-4, `distance at row ${i / GHOST_STRIDE}`);
      assert.ok(Math.abs(back[i + 1] - ghost[i + 1]) <= 1 / 128 + 1e-4, `across at row ${i / GHOST_STRIDE}`);
      assert.ok(Math.abs(back[i + 2] - ghost[i + 2]) <= 1 / 128 + 1e-4, `up at row ${i / GHOST_STRIDE}`);
      assert.equal(back[i + 3] > 0.5, ghost[i + 3] > 0.5, `dash at row ${i / GHOST_STRIDE}`);
    }
  });
}

test('ghost: a coarser step keeps the pace and the length; malformed ghosts are refused', () => {
  const { ghost } = runs.flight;
  const back = decodeGhost(encodeGhost(ghost, 3));
  assert.equal(back.length, ghost.length);
  const last = ghost.length - GHOST_STRIDE;
  assert.ok(Math.abs(back[last] - ghost[last]) < 0.05, 'the last row is kept exactly');
  assert.throws(() => encodeGhost(new Float32Array(4)), RangeError, 'one row is not a run');
  const w = new ByteWriter().varint(7201).u8(1);
  assert.throws(() => decodeGhost(w.done()), RangeError, 'over two minutes');
  const huge = new Float32Array(400);
  for (let i = 0; i < 100; i += 1) huge[i * 4 + 1] = 200;
  assert.throws(() => decodeGhost(encodeGhost(huge)), RangeError, 'no corridor is 200 m wide');
});

function sameTowers(a, b) {
  assert.equal(a.towers.length, b.towers.length);
  for (let i = 0; i < a.towers.length; i += 1) {
    const p = a.towers[i];
    const q = b.towers[i];
    assert.equal(p.x, q.x, `tower ${i} x`);
    assert.equal(p.z, q.z, `tower ${i} z`);
    assert.ok(Math.abs(p.height - q.height) < 1e-3, `tower ${i} height`);
    assert.ok(Math.abs(p.width - q.width) < 1e-3, `tower ${i} width`);
  }
  assert.equal(a.fillers.length, b.fillers.length, 'the same low buildings');
  assert.equal(a.rails.length, b.rails.length, 'the same rails');
}

test('world: the bundled city travels and lays out to the very same plan, exact', () => {
  const w = new ByteWriter();
  writeWorld(w, city);
  const bytes = w.done();
  // Every tower carries the three bytes of its seat (CITY-148).
  assert.ok(bytes.length < 1800, `a city of ${city.towers.length} towers in ${bytes.length} bytes`);
  const { world, exact } = readWorld(new ByteReader(bytes), city.towers);
  assert.equal(exact, true);
  sameTowers(layoutCity(city.towers), layoutCity(world.towers));
  assert.equal(world.source, city.source);
  assert.equal(Math.floor(Date.parse(world.fetchedAt) / 1000), Math.floor(Date.parse(city.fetchedAt) / 1000));
});

test('world: a device that knows none of the coins still runs the same city, naming none but SOL', () => {
  const w = new ByteWriter();
  writeWorld(w, city);
  const { world, exact } = readWorld(new ByteReader(w.done()), []);
  assert.equal(exact, true, 'the plan does not depend on names');
  sameTowers(layoutCity(city.towers), layoutCity(world.towers));
  const named = world.towers.filter((t) => t.verified);
  assert.deepEqual(
    named.map((t) => t.id),
    [SOL_MINT],
  );
  assert.ok(world.towers.every((t) => t.verified || t.symbol === ''), 'an unknown coin stays anonymous');
  assert.equal(new Set(world.towers.map((t) => t.id)).size, world.towers.length, 'every tower keeps its own id');
});

test('world: names come only from a coin this device itself has verified', () => {
  const w = new ByteWriter();
  writeWorld(w, city);
  const bytes = w.done();
  const bonk = city.towers.find((t) => t.symbol === 'Bonk');
  assert.ok(bonk?.verified);
  const { world } = readWorld(new ByteReader(bytes), [{ ...bonk }]);
  assert.equal(world.towers.find((t) => t.id === bonk.id)?.symbol, 'Bonk');
  // The same mint known only as unverified: the tower stays anonymous.
  const { world: blind } = readWorld(new ByteReader(bytes), [{ ...bonk, verified: false }]);
  assert.equal(blind.towers.some((t) => t.id === bonk.id), false);
  // A later read can still name it.
  const later = resolveWorld(blind, [bonk]);
  assert.equal(later.towers.find((t) => t.id === bonk.id)?.verified, true);
});

test('world: two towers a hair apart in cap stand on the same plots from float32 amounts', () => {
  const base = city.towers.find((t) => t.district === 'heights');
  // Two heights towers whose caps differ by less than float32 can tell apart.
  const twins = [
    { ...base, id: 'Twin1111111111111111111111111111111111111111', mcap: 123456789.0001, liquidity: 9_000_000 },
    { ...base, id: 'Twin2222222222222222222222222222222222222222', mcap: 123456789.0002, liquidity: 2_000_000 },
  ];
  const snapshot = { ...city, towers: [...city.towers, ...twins] };
  const w = new ByteWriter();
  writeWorld(w, snapshot);
  const bytes = w.done();
  // A plot comes from the seat, never from the order of heights (CITY-148): float32 is enough.
  assert.equal(bytes[0] & 1, 0, 'float32');
  const { world, exact } = readWorld(new ByteReader(bytes), snapshot.towers);
  assert.equal(exact, true);
  sameTowers(layoutCity(snapshot.towers), layoutCity(world.towers));
});

test('world: the fingerprint tells a device when its city code lays the world out differently', () => {
  const w = new ByteWriter();
  writeWorld(w, city);
  const bytes = w.done();
  // Flip the stored fingerprint, as a device whose layout changed would compute a different one.
  bytes[bytes.length - 1] ^= 0xff;
  assert.equal(readWorld(new ByteReader(bytes), city.towers).exact, false);
  assert.equal(typeof layoutPrint(layoutCity(city.towers)), 'number');
});

test('world: malformed cities are refused, never half-read', () => {
  assert.throws(() => readWorld(new ByteReader(new Uint8Array([9, 1])), []), RangeError, 'unknown precision');
  assert.throws(() => readWorld(new ByteReader(new ByteWriter().u8(0).varint(5000).done()), []), RangeError, 'too many towers');
  const w = new ByteWriter();
  writeWorld(w, city);
  assert.throws(() => readWorld(new ByteReader(w.done().subarray(0, 300)), []), RangeError, 'cut short');
});

test('challenge: one link carries the time, form, day, city and run, after #c= only', async () => {
  const { ghost, time } = runs.flight;
  const url = await challengeUrl('https://ryntra.io/', { beat: time, form: 'flight', day: DAY, world: { kind: 'embedded', world: city }, ghost });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://ryntra.io/');
  assert.equal(parsed.search, '', 'nothing a server would see');
  assert.ok(url.length < 3200, `${url.length} characters`);
  const payload = challengePayload(parsed.hash);
  assert.deepEqual(readChallengeHead(payload, TODAY), { beat: time, form: 'flight', day: DAY });
  const opened = await openChallenge(payload, { known: city.towers, today: TODAY });
  assert.equal(opened.exact, true);
  assert.equal(opened.world.towers.length, city.towers.length);
  assert.equal(opened.ghost.length, ghost.length);
  assert.ok(Math.abs((opened.ghost.length / GHOST_STRIDE) * TICK - time) < 0.02, 'the ghost is the run of that time');
});

test('challenge: the same course and the same ghost come out on the friend side', async () => {
  const { ghost, time, course } = runs.roofs;
  const payload = await encodeChallenge({ beat: time, form: 'roofs', day: DAY, world: { kind: 'embedded', world: city }, ghost });
  const opened = await openChallenge(payload, { known: [], today: TODAY });
  const friend = buildCourse(layoutCity(opened.world.towers), 'roofs', opened.day);
  assert.equal(friend.count, course.count, 'same samples');
  let worst = 0;
  for (let i = 0; i < course.pos.length; i += 1) worst = Math.max(worst, Math.abs(friend.pos[i] - course.pos[i]));
  assert.ok(worst < 0.01, `the course lies within ${worst.toFixed(4)} m of the challenger's`);
  assert.deepEqual(
    friend.obstacles.map((o) => [o.kind, Math.round(o.s0)]),
    course.obstacles.map((o) => [o.kind, Math.round(o.s0)]),
    'the same obstacles in the same places',
  );
});

test('challenge: a ghost that is not the run of the named time is dropped, the time stays', async () => {
  const { ghost } = runs.flight;
  const payload = await encodeChallenge({ beat: 12.3, form: 'flight', day: DAY, world: { kind: 'embedded', world: city }, ghost });
  const opened = await openChallenge(payload, { known: city.towers, today: TODAY });
  assert.equal(opened.beat, 12.3);
  assert.ok(opened.world);
  assert.equal(opened.ghost, null);
});

test('challenge: a damaged body leaves the time to beat; a damaged head opens nothing', async () => {
  const { ghost, time } = runs.flight;
  const payload = await encodeChallenge({ beat: time, form: 'flight', day: DAY, world: { kind: 'embedded', world: city }, ghost });
  const cut = payload.slice(0, 400);
  const opened = await openChallenge(cut, { known: [], today: TODAY });
  assert.deepEqual([opened.beat, opened.world, opened.ghost], [time, null, null]);
  assert.equal(readChallengeHead('Zm9vYmFy', TODAY), null, 'not our version');
  assert.equal(challengePayload('#c=short'), null);
  assert.equal(challengePayload('#x=1'), null);
});

test('challenge: days outside the life of the run and times outside a run are refused', async () => {
  const early = await encodeChallenge({ beat: 30, form: 'flight', day: '2026-09-01', world: null, ghost: null });
  assert.equal(readChallengeHead(early, TODAY), null);
  const future = await encodeChallenge({ beat: 30, form: 'flight', day: '2026-11-20', world: null, ghost: null });
  assert.equal(readChallengeHead(future, TODAY), null);
  await assert.rejects(encodeChallenge({ beat: 0, form: 'flight', day: DAY, world: null, ghost: null }), RangeError);
  await assert.rejects(encodeChallenge({ beat: 700, form: 'flight', day: DAY, world: null, ghost: null }), RangeError);
});

test('challenge: a link of the time alone is eight letters and still challenges', async () => {
  const payload = await encodeChallenge({ beat: 31.4, form: 'roofs', day: DAY, world: null, ghost: null });
  assert.equal(payload.length, 8);
  assert.deepEqual(await openChallenge(payload, { known: [], today: TODAY }), { beat: 31.4, form: 'roofs', day: DAY, world: null, exact: false, ghost: null, version: null });
});

test('challenge: later the link names the server world version; opening it asks the world client', async () => {
  const { ghost, time } = runs.flight;
  const id = '8f14e45f-ceea-467e-a0f1-1b6c4e3b2a90';
  const payload = await encodeChallenge({ beat: time, form: 'flight', day: DAY, world: { kind: 'version', id }, ghost });
  assert.ok(payload.length < 1100, `${payload.length} characters with a version instead of the city`);
  const asked = [];
  const opened = await openChallenge(payload, { known: [], today: TODAY, fetchVersion: async (v) => (asked.push(v), city) });
  assert.deepEqual(asked, [id]);
  assert.equal(opened.version, id);
  assert.equal(opened.world, city);
  assert.equal(opened.exact, true);
  assert.ok(opened.ghost);
  // Without a world client yet, the version is named and the run falls back to this device's own city.
  const alone = await openChallenge(payload, { known: [], today: TODAY });
  assert.deepEqual([alone.version, alone.world], [id, null]);
});

test('challenge: a server world version becomes the run\'s city only if every tower is a tower', () => {
  const version = { id: 'v1', day: DAY, seed: 's', towers: city.towers, createdAt: '2026-10-26T00:05:00Z' };
  const world = worldFromVersion(version);
  assert.equal(world.towers.length, city.towers.length);
  assert.equal(world.fetchedAt, '2026-10-26T00:05:00.000Z');
  sameTowers(layoutCity(city.towers), layoutCity(world.towers));
  assert.equal(worldFromVersion({ ...version, towers: [...city.towers, { id: 'x' }] }), null);
  assert.equal(worldFromVersion({ ...version, towers: [] }), null);
  assert.equal(worldFromVersion({ ...version, createdAt: 'soon' }), null);
  assert.equal(worldFromVersion(null), null);
});
