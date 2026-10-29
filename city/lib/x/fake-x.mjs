/*
 * A fake X API v2 for the publisher's tests: a real HTTP server on 127.0.0.1 that speaks the chunked media upload
 * (INIT, APPEND, FINALIZE, STATUS) and `POST /2/tweets`, checks every OAuth 1.0a signature against the test keys, and
 * can be told to answer a route with a 429, a 5xx, an error or a dropped connection. Nothing here reaches X.
 */
import { createServer } from 'node:http';
import { signature } from './oauth.ts';

export const KEYS = Object.freeze({ apiKey: 'test-api-key', apiSecret: 'test-api-secret', accessToken: '1-test-access-token', accessSecret: 'test-access-secret' });

const read = (req) => new Promise((resolve, reject) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', () => resolve(Buffer.concat(parts)));
  req.on('error', reject);
});

function signed(req, base) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('OAuth ')) return false;
  const fields = Object.fromEntries([...header.slice(6).matchAll(/([a-z_]+)="([^"]*)"/g)].map((m) => [m[1], decodeURIComponent(m[2])]));
  if (fields.oauth_consumer_key !== KEYS.apiKey || fields.oauth_token !== KEYS.accessToken) return false;
  const want = signature({ method: req.method, url: `${base}${req.url}`, keys: KEYS, nonce: fields.oauth_nonce, timestamp: Number(fields.oauth_timestamp) });
  return want.signature === fields.oauth_signature;
}

/**
 * `script[route]` is a list of answers to give before the normal one, route by route:
 * `init`, `append`, `finalize`, `status`, `tweet`. An answer is `{ status, headers?, body? }` or `{ drop: true }`; on
 * `tweet`, `posted: true` makes the post first and then gives that answer.
 * `options.processing` is the list of states STATUS walks through for a video (default in_progress, succeeded).
 */
export async function fakeX(options = {}) {
  const script = options.script ?? {};
  const processing = options.processing ?? ['in_progress', 'succeeded'];
  const calls = [];
  const media = new Map();
  const posts = [];
  let seq = 0;
  let base = '';

  const server = createServer(async (req, res) => {
    const raw = await read(req);
    const url = new URL(req.url, 'http://fake');
    const path = url.pathname;
    const route =
      path === '/2/media/upload/initialize' ? 'init'
      : /^\/2\/media\/upload\/[^/]+\/append$/.test(path) ? 'append'
      : /^\/2\/media\/upload\/[^/]+\/finalize$/.test(path) ? 'finalize'
      : path === '/2/media/upload' && url.searchParams.get('command') === 'STATUS' ? 'status'
      : path === '/2/tweets' ? 'tweet'
      : 'unknown';
    calls.push({ method: req.method, route, path, query: Object.fromEntries(url.searchParams), contentType: req.headers['content-type'] ?? null });
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    const forced = script[route]?.shift();
    if (forced && !forced.posted) {
      if (forced.drop) return req.socket.destroy();
      return send(forced.status, forced.body ?? { title: 'Scripted', detail: `scripted ${forced.status}` }, forced.headers);
    }
    if (!signed(req, base)) return send(401, { title: 'Unauthorized', detail: 'bad OAuth signature' });

    if (route === 'init' && req.method === 'POST') {
      const b = JSON.parse(raw.toString('utf8'));
      if (!['video/mp4', 'image/png', 'image/jpeg'].includes(b.media_type) || !(b.total_bytes > 0) || !['tweet_video', 'tweet_image'].includes(b.media_category)) {
        return send(400, { title: 'Invalid Request', detail: 'bad INIT' });
      }
      seq += 1;
      const id = String(1_900_000_000_000_000_000n + BigInt(seq));
      media.set(id, { type: b.media_type, category: b.media_category, total: b.total_bytes, chunks: [], finalized: false, states: [...processing], ready: false });
      return send(200, { data: { id, media_key: `7_${id}`, expires_after_secs: 86400 } });
    }
    if (route === 'append' && req.method === 'POST') {
      const m = media.get(path.split('/')[4]);
      if (!m || m.finalized) return send(400, { title: 'Invalid Request', detail: 'no such upload' });
      const form = await new Request('http://fake', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: raw }).formData();
      const index = Number(form.get('segment_index'));
      const file = form.get('media');
      if (!Number.isInteger(index) || index !== m.chunks.length || !file || typeof file === 'string') return send(400, { title: 'Invalid Request', detail: 'bad APPEND' });
      m.chunks.push(new Uint8Array(await file.arrayBuffer()));
      return send(200, { data: { expires_at: 1_800_000_000 } });
    }
    if (route === 'finalize' && req.method === 'POST') {
      const id = path.split('/')[4];
      const m = media.get(id);
      if (!m) return send(400, { title: 'Invalid Request', detail: 'no such upload' });
      const size = m.chunks.reduce((s, c) => s + c.byteLength, 0);
      if (size !== m.total) return send(400, { title: 'Invalid Request', detail: `size ${size} is not ${m.total}` });
      m.finalized = true;
      m.bytes = Buffer.concat(m.chunks);
      if (m.category === 'tweet_image') {
        m.ready = true;
        return send(200, { data: { id, media_key: `7_${id}`, size } });
      }
      return send(200, { data: { id, media_key: `7_${id}`, size, processing_info: { state: 'pending', check_after_secs: 1 } } });
    }
    if (route === 'status' && req.method === 'GET') {
      const m = media.get(url.searchParams.get('media_id'));
      if (!m || !m.finalized) return send(400, { title: 'Invalid Request', detail: 'no such media' });
      const state = m.states.length > 1 ? m.states.shift() : m.states[0];
      if (state === 'succeeded') m.ready = true;
      const info = state === 'failed' ? { state, error: { code: 1, name: 'InvalidMedia', message: 'Unsupported video' } } : state === 'succeeded' ? { state, progress_percent: 100 } : { state, check_after_secs: 2, progress_percent: 40 };
      return send(200, { data: { id: url.searchParams.get('media_id'), processing_info: info } });
    }
    if (route === 'tweet' && req.method === 'POST') {
      const b = JSON.parse(raw.toString('utf8'));
      if (typeof b.text !== 'string' || !b.text) return send(400, { title: 'Invalid Request', detail: 'no text' });
      for (const id of b.media?.media_ids ?? []) if (!media.get(id)?.ready) return send(400, { title: 'Invalid Request', detail: `media ${id} not ready` });
      if (posts.some((p) => p.text === b.text)) return send(403, { title: 'Forbidden', detail: 'You are not allowed to create a Tweet with duplicate content.' });
      const id = String(1_850_000_000_000_000_000n + BigInt(posts.length + 1));
      posts.push({ id, text: b.text, mediaIds: b.media?.media_ids ?? [] });
      // `posted`: the post is made, but the answer says otherwise (or never comes).
      if (forced?.posted) return forced.drop ? req.socket.destroy() : send(forced.status, forced.body ?? { title: 'Service Unavailable' });
      return send(201, { data: { id, text: b.text } });
    }
    send(404, { title: 'Not Found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    calls,
    media,
    posts,
    script,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
