// Run from repo root: node --test "city/lib/x/*.test.mjs"
// The real HTTP client of X against a fake X on 127.0.0.1 (`fake-x.mjs`): never the real one.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CHUNK_BYTES, XApiError, createXClient } from './client.ts';
import { authorization, signature } from './oauth.ts';
import { KEYS, fakeX } from './fake-x.mjs';

let x;
afterEach(async () => {
  await x?.close();
  x = undefined;
});

/** Sleeps that do not wait, and say how long they were asked to. */
function clock() {
  const slept = [];
  return { slept, sleep: async (ms) => void slept.push(ms) };
}

const client = (over = {}) => {
  const c = clock();
  return { ...c, x: createXClient({ keys: KEYS, base: x.base, sleep: c.sleep, ...over }) };
};

const bytes = (n, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

test('OAuth 1.0a: the same signatures as an independent implementation (Python oauthlib 3.2)', () => {
  // The keys, nonce and timestamp of X's "Creating a signature" guide; the expected values come from
  // oauthlib.oauth1.rfc5849.signature (normalize_parameters → signature_base_string → sign_hmac_sha1).
  const sign = (method, url, form) => signature({
    method, url, form,
    keys: {
      apiKey: 'xvz1evFS4wEEPTGEFPHBog',
      apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS6weJAEb',
      accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    },
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    timestamp: 1318622958,
  }).signature;
  assert.equal(sign('POST', 'https://api.x.com/1.1/statuses/update.json?include_entities=true', { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' }), 'f0K+hf6Z1H7HfLI8O1ZTYB2gFMw=');
  assert.equal(sign('GET', 'https://api.x.com/2/media/upload?command=STATUS&media_id=1900000000000000001'), 'uvFvxkx6hNjD7l+p8SiV+v6o0AQ=', 'the query is signed');
});

test('OAuth: a fresh nonce on every request, and the header names every field once', () => {
  const a = authorization({ method: 'POST', url: 'https://api.x.com/2/tweets', keys: KEYS });
  const b = authorization({ method: 'POST', url: 'https://api.x.com/2/tweets', keys: KEYS });
  assert.notEqual(a, b);
  for (const f of ['oauth_consumer_key', 'oauth_nonce', 'oauth_signature', 'oauth_signature_method', 'oauth_timestamp', 'oauth_token', 'oauth_version']) {
    assert.equal(a.split(`${f}="`).length, 2, f);
  }
  assert.doesNotMatch(a, /test-api-secret|test-access-secret/, 'the secrets never travel');
});

test('a video goes up in chunks: INIT, APPEND × n, FINALIZE, STATUS until processed, then the post', async () => {
  x = await fakeX();
  const { x: c, slept } = client();
  const clip = bytes(CHUNK_BYTES * 2 + 12345);
  const id = await c.uploadMedia('video/mp4', clip);
  const routes = x.calls.map((k) => k.route);
  assert.deepEqual(routes, ['init', 'append', 'append', 'append', 'finalize', 'status', 'status']);
  const m = x.media.get(id);
  assert.equal(m.category, 'tweet_video');
  assert.equal(m.type, 'video/mp4');
  assert.deepEqual(m.chunks.map((k) => k.byteLength), [CHUNK_BYTES, CHUNK_BYTES, 12345]);
  assert.deepEqual(new Uint8Array(m.bytes), clip, 'the bytes X got are the clip');
  assert.ok(x.calls.filter((k) => k.route === 'append').every((k) => k.contentType.startsWith('multipart/form-data')));
  assert.deepEqual(x.calls.find((k) => k.route === 'status').query, { command: 'STATUS', media_id: id });
  assert.deepEqual(slept, [1000, 2000], 'waits as long as X’s check_after_secs');

  const post = await c.createPost('BONK rose as a new tower. https://ryntra.io/?coin=BONK', [id]);
  assert.deepEqual(x.posts, [{ id: post.id, text: 'BONK rose as a new tower. https://ryntra.io/?coin=BONK', mediaIds: [id] }]);
});

test('a card (an image) needs no STATUS: FINALIZE is the end of it', async () => {
  x = await fakeX();
  const { x: c } = client();
  const id = await c.uploadMedia('image/jpeg', bytes(5000));
  assert.deepEqual(x.calls.map((k) => k.route), ['init', 'append', 'finalize']);
  assert.equal(x.media.get(id).category, 'tweet_image');
  await c.createPost('a card', [id]);
  assert.equal(x.posts.length, 1);
});

test('a post without media sends only the words', async () => {
  x = await fakeX();
  const { x: c } = client();
  await c.createPost('only words', []);
  assert.deepEqual(x.posts[0].mediaIds, []);
});

test('processing that fails is a failure with X’s reason; processing that takes too long gives up', async () => {
  x = await fakeX({ processing: ['in_progress', 'failed'] });
  const { x: c } = client();
  await assert.rejects(c.uploadMedia('video/mp4', bytes(100)), (e) => e instanceof XApiError && /could not process the media: Unsupported video/.test(e.message));
  await x.close();
  x = await fakeX({ processing: ['in_progress'] });
  const { x: slow } = client({ processingMs: 7000 });
  await assert.rejects(slow.uploadMedia('video/mp4', bytes(100)), /still processing/);
});

test('429: waits until X’s reset when it is near, then goes on', async () => {
  const nowMs = 1_800_000_000_000;
  x = await fakeX({ script: { tweet: [{ status: 429, headers: { 'x-rate-limit-reset': String(nowMs / 1000 + 5) }, body: { title: 'Too Many Requests' } }] } });
  const { x: c, slept } = client({ now: () => nowMs });
  const post = await c.createPost('after the limit', []);
  assert.ok(post.id);
  assert.deepEqual(slept, [5000]);
  assert.equal(x.calls.filter((k) => k.route === 'tweet').length, 2);
});

test('429 with a reset far off fails at once, and is not unsure: nothing was posted', async () => {
  const nowMs = 1_800_000_000_000;
  x = await fakeX({ script: { tweet: [{ status: 429, headers: { 'x-rate-limit-reset': String(nowMs / 1000 + 900) }, body: { title: 'Too Many Requests' } }] } });
  const { x: c, slept } = client({ now: () => nowMs });
  await assert.rejects(c.createPost('later', []), (e) => e.status === 429 && e.unsure === false && /Too Many Requests.*rate limited, 900 s/.test(e.message));
  assert.deepEqual(slept, []);
});

test('5xx: retried with backoff (1 s, 2 s, 4 s), then the answer', async () => {
  x = await fakeX({ script: { init: [{ status: 503 }, { status: 500 }, { status: 502 }] } });
  const { x: c, slept } = client();
  const id = await c.uploadMedia('image/png', bytes(10));
  assert.ok(id);
  assert.deepEqual(slept, [1000, 2000, 4000]);
});

test('5xx every time: the error after the last retry, unsure for a post', async () => {
  x = await fakeX({ script: { tweet: [{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }] } });
  const { x: c, slept } = client();
  await assert.rejects(c.createPost('never', []), (e) => e instanceof XApiError && e.status === 503 && e.unsure === true);
  assert.equal(x.calls.length, 4, 'one try and three retries');
  assert.deepEqual(slept, [1000, 2000, 4000]);
  assert.equal(x.posts.length, 0);
});

test('a lost answer after the post was made: the retry meets “duplicate”, and the error says it most likely went out', async () => {
  x = await fakeX({ script: { tweet: [{ posted: true, status: 503 }] } });
  const { x: c } = client();
  await assert.rejects(c.createPost('made once', []), (e) => e.unsure === true && e.status === 403 && /most likely went out/.test(e.message));
  assert.equal(x.posts.length, 1, 'X has it once');
});

test('a dropped connection is retried like a 5xx', async () => {
  x = await fakeX({ script: { tweet: [{ drop: true }] } });
  const { x: c, slept } = client();
  const post = await c.createPost('after the drop', []);
  assert.ok(post.id);
  assert.deepEqual(slept, [1000]);
});

test('4xx is final: no retry, X’s reason in the error, and not unsure', async () => {
  x = await fakeX({ script: { tweet: [{ status: 400, body: { title: 'Invalid Request', detail: 'One or more parameters to your request was invalid.' } }] } });
  const { x: c, slept } = client();
  await assert.rejects(c.createPost('bad', []), (e) => e.status === 400 && e.unsure === false && e.message === 'X 400: One or more parameters to your request was invalid.');
  assert.deepEqual(slept, []);
  assert.equal(x.calls.length, 1);
});

test('a wrong key is refused by X’s signature check, never retried', async () => {
  x = await fakeX();
  const c = createXClient({ keys: { ...KEYS, apiSecret: 'wrong' }, base: x.base, sleep: async () => {} });
  await assert.rejects(c.createPost('nope', []), (e) => e.status === 401 && /bad OAuth signature/.test(e.message));
  assert.equal(x.calls.length, 1);
});

test('a call never runs past its time: retries stop at `until`, a post cut short is unsure', async () => {
  x = await fakeX({ script: { tweet: [{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }] } });
  let t = 1_800_000_000_000;
  const c = createXClient({ keys: KEYS, base: x.base, now: () => t, sleep: async (ms) => void (t += ms) });
  await assert.rejects(c.createPost('in time?', [], { until: t + 2500 }), (e) => e.status === 0 && e.unsure === true && /out of time/.test(e.message));
  assert.equal(x.calls.length, 2, 'the 1 s backoff fits, the 2 s one does not');
  await assert.rejects(c.uploadMedia('image/png', bytes(10), { until: t }), /out of time/, 'no time left: no request');
  assert.equal(x.calls.length, 2);
});
