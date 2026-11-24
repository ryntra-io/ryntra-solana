import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import sharp from 'sharp';

import {
  CARD_FRAME,
  FRAME_SHA,
  SHARE_CARDS,
  SHARE_CARD_SIZE,
  SHARE_WINDOW,
  cardOfPath,
  coinCardPath,
  framePath,
  poolCardPath,
  shareCardAlt,
  shareCardPath,
  shareCardVersion,
  topChip,
} from './cards.ts';
import { SHARE_WORDS } from './words.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const publicFile = (path) => new URL(`public${path}`, ROOT);

/** The two products that are not this one, spelled so this file never names them itself. */
const SEPARATE_PRODUCTS = new RegExp(`\\b(${['Ar', 'c'].join('')}|${['Stark', 'net'].join('')})\\b`);

test('every card stands on a real frame of the terminal, cut at the window the card draws', async () => {
  for (const id of SHARE_CARDS) {
    const file = publicFile(framePath(CARD_FRAME[id]));
    assert.ok(existsSync(file), `${id}: its frame is published`);
    const { width, height } = await sharp(readFileSync(file)).metadata();
    assert.deepEqual({ width, height }, { width: SHARE_WINDOW.width, height: SHARE_WINDOW.height }, `${id}: drawn one to one`);
  }
  /* Flush with the card's right and bottom edges. */
  assert.equal(SHARE_WINDOW.left + SHARE_WINDOW.width, SHARE_CARD_SIZE.width);
  assert.equal(SHARE_WINDOW.top + SHARE_WINDOW.height, SHARE_CARD_SIZE.height);
});

test("the frames' fingerprints are the files' own, so a new frame gives its card a new address", () => {
  for (const [frame, sha] of Object.entries(FRAME_SHA)) {
    const bytes = readFileSync(publicFile(framePath(frame)));
    assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 8), sha, `${frame}: run node scripts/terminal/share-frames.mjs`);
  }
  const files = readdirSync(publicFile('/terminal/share')).filter((name) => name.endsWith('.jpg')).map((name) => name.slice(0, -4));
  assert.deepEqual(files.sort(), Object.keys(FRAME_SHA).sort(), 'no frame is published that no card stands on');
});

test("a card's address carries its fingerprint; home's is the root's own, in both languages", () => {
  for (const id of SHARE_CARDS) {
    assert.match(shareCardVersion(id), /^[0-9a-f]{8}$/);
    assert.match(shareCardPath(id), id === 'home' ? /^\/opengraph-image\?v=[0-9a-f]{8}$/ : new RegExp(`^/og/terminal/${id}\\?v=[0-9a-f]{8}$`));
  }
  assert.match(shareCardPath('home', 'uk'), /^\/uk\/opengraph-image\?v=[0-9a-f]{8}$/);
  assert.equal(new Set(SHARE_CARDS.map(shareCardVersion)).size, SHARE_CARDS.length, 'each card its own fingerprint');
  assert.match(coinCardPath('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'), /^\/c\/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN\/opengraph-image\?v=\d{4}-\d{2}-\d{2}$/);
  assert.match(poolCardPath('5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6'), /^\/og\/pool\/5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6\?v=/);
});

test('each page shows its section\'s card, home\'s where it has none', () => {
  const cases = {
    '/': 'home',
    '/market': 'home',
    '/uk': 'home',
    '/city': 'home',
    '/about': 'home',
    '/legal/terms': 'home',
    '/swap': 'swap',
    '/bridge': 'swap',
    '/coin': 'swap',
    '/launch': 'launch',
    '/launches': 'launch',
    '/uk/launches': 'launch',
    '/earn': 'earn',
    '/pro': 'earn',
    '/pool': 'pool',
    '/bots': 'bots',
    '/bots/grid': 'bots',
    '/agent': 'agents',
    '/agent/pulse': 'agents',
    '/x/abc': 'agents',
    '/portfolio': 'portfolio',
    '/wallet': 'portfolio',
    '/money': 'portfolio',
    '/rewards': 'portfolio',
    '/private/pay': 'portfolio',
    '/docs': 'docs',
    '/docs/start': 'docs',
    '/developers': 'docs',
    '/connector': 'docs',
    '/support': 'help',
    '/feedback': 'help',
  };
  for (const [path, id] of Object.entries(cases)) assert.equal(cardOfPath(path), id, path);
});

test("the cards' words: both languages, short, no hype, no safety talk, no city", () => {
  const HYPE = /\b(moon|100x|1000x|guarantee|risk-free|get rich|lambo|passive income|can't lose)\b|гарант|без ризику|!/i;
  const SAFETY = /receipt|proof|passport|verdict|approval|квитанц|доказ|паспорт|вердикт/i;
  const CITY = /\bcity\b|\btower|місто|міст[аі]\b|веж/i;
  for (const id of SHARE_CARDS) {
    for (const lang of ['en', 'uk']) {
      const line = SHARE_WORDS[id][lang];
      for (const key of ['kick', 'lead', 'accent', 'alt']) assert.ok(line[key]?.trim(), `${id}.${lang}.${key}`);
      const said = Object.values(line).join(' ');
      assert.doesNotMatch(said, HYPE, `${id}.${lang}`);
      assert.doesNotMatch(said, SAFETY, `${id}.${lang}`);
      assert.doesNotMatch(said, CITY, `${id}.${lang}`);
      assert.doesNotMatch(said, SEPARATE_PRODUCTS, `${id}.${lang}`);
      assert.ok(line.lead.length + line.accent.length <= 40, `${id}.${lang}: the line keeps to the left column`);
    }
    assert.equal(shareCardAlt(id), SHARE_WORDS[id].en.alt);
  }
  assert.equal(shareCardAlt('home', 'uk'), SHARE_WORDS.home.uk.alt);
});

test("«top» only from the day's most traded list, by the bucket the place falls in", () => {
  assert.equal(topChip(1), 'Top 10 by volume · 24h');
  assert.equal(topChip(10), 'Top 10 by volume · 24h');
  assert.equal(topChip(11), 'Top 25 by volume · 24h');
  assert.equal(topChip(100), 'Top 100 by volume · 24h');
  for (const rank of [null, 0, -1, 101, 1.5]) assert.equal(topChip(rank), null, String(rank));
  /* The coin's card says «top» from this alone: the city's skyline is no measure of the market. */
  const coin = read('terminal/share/coin.server.tsx');
  assert.match(coin, /topChip\(rank\)/);
  assert.doesNotMatch(coin, /Top of the Solana market|inCity/);
});

test("a coin's logo is the terminal's: its chain of addresses, fetched from the site, the letter only when none answers", () => {
  const logo = read('terminal/share/logo.server.ts');
  assert.match(logo, /logoChain\(mint, icon, first\)/);
  assert.match(logo, /\$\{SITE_ORIGIN\}\$\{address\}/, 'from the site itself, where the routes keep their guards');
  assert.doesNotMatch(logo, /readFile/);
  const coin = read('terminal/share/coin.server.tsx');
  assert.match(coin, /coinLogoUri\(coin\.mint, coin\.remoteIcon, get\)/);
  assert.match(coin, /if \(!coin\) return sectionCard\(\{ id: 'home' \}\)/, 'an unknown coin draws home, never empty figures');
});

test('no card, route or page names the city\'s frame any more', () => {
  assert.equal(existsSync(publicFile('/city/share-scene.jpg')), false);
  assert.equal(existsSync(publicFile('/terminal/share-scene.jpg')), false);
  for (const file of ['terminal/share/card.server.tsx', 'terminal/share/coin.server.tsx', 'terminal/share/pool.server.tsx', 'app/seo.ts', 'app/opengraph-image.tsx', 'app/uk/opengraph-image.tsx', 'app/launches/opengraph-image.tsx', 'app/og/[locale]/[...key]/route.tsx', 'app/api/launch/mission-card/route.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /share-scene|SHARE_SCENE|cityCard|city\/lib\/share\/card/, file);
  }
  /* The frames are read from the file at the build and fetched from the site after it: Vercel's functions carry no `public/`. */
  const card = read('terminal/share/card.server.tsx');
  assert.match(card, /fetch\(`\$\{SITE_ORIGIN\}\$\{path\}\?v=/);
});

test('the docs, Help and About name a card — a page that named none showed no picture', () => {
  for (const [file, path] of [['app/docs/page.tsx', '/docs'], ['app/support/page.tsx', '/support'], ['app/about/page.tsx', '/about']]) {
    const source = read(file);
    assert.match(source, new RegExp(`cardImageFor\\("${path}"\\)`), file);
    assert.match(source, /images: \[CARD\]/, file);
    assert.match(source, /images: \[CARD\.url\]/, file);
  }
  assert.match(read('app/docs/[...slug]/page.tsx'), /images: \[card\]/);
});
