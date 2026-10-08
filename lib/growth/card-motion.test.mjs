import assert from "node:assert/strict";
import test from "node:test";

import { cardFace, cardTone } from "./card-face.ts";
import { MOOD_BOX, moodOf, moodScene, moodSvg } from "./card-mood.ts";
import { CARD, INTRO_MS, STILL, drawCardScene, headlineAt, headlineSize, ladderWidths, sceneAt } from "./card-scene.ts";
import { TradeCardSchema } from "./trade-cards.ts";

const WALLET = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5";

/** A stored card, as `growthCards` keeps it. */
function card({ kind = "SELL", resultBps = 4_280, cost = 100_000_000n, proceeds = 142_800_000n, amounts = false, locale = "en", rank = "SILVER" } = {}) {
  return TradeCardSchema.parse({
    schema: "ryntra.growth.trade-card",
    schemaVersion: 1,
    id: "a1b2c3d4e5f6a7b8c9d0",
    wallet: WALLET,
    code: "78KZV413GGPJ",
    locale,
    amounts,
    rank,
    token: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "Bonk", name: "Bonk", icon: null, stock: false },
    trade: {
      actionId: "sig-1",
      kind,
      at: "2026-10-04T12:00:00.000Z",
      openedAt: kind === "SELL" ? "2026-09-24T09:00:00.000Z" : null,
      costMicros: cost.toString(),
      proceedsMicros: kind === "SELL" ? proceeds.toString() : null,
      quantityRaw: "5000000000000",
      decimals: 5,
      resultBps: kind === "SELL" ? resultBps : null,
    },
    createdAt: "2026-10-04T12:01:00.000Z",
  });
}

const gain = () => card();
const loss = () => card({ resultBps: -2_500, proceeds: 75_000_000n });

test("the emotion follows the sign and how far — a doubling and a halving alike", () => {
  assert.equal(moodOf("SELL", 10_000), "moon");
  assert.equal(moodOf("SELL", 9_999), "rocket");
  assert.equal(moodOf("SELL", 1), "rocket");
  assert.equal(moodOf("SELL", 0), "flat");
  assert.equal(moodOf("SELL", -1), "tear");
  assert.equal(moodOf("SELL", -1_500), "cry");
  assert.equal(moodOf("SELL", -5_000), "storm");
  assert.equal(moodOf("BUY", null), "coin");
  assert.equal(moodOf("SELL", null), "coin");
});

test("every emotion draws in its box, moves while alive and holds still at rest", () => {
  for (const mood of ["moon", "rocket", "flat", "tear", "cry", "storm", "coin"]) {
    const still = moodSvg(moodScene(mood, STILL, "#19C77A"));
    assert.match(still, new RegExp(`viewBox="0 0 ${MOOD_BOX.width} ${MOOD_BOX.height}"`));
    assert.doesNotMatch(still, /NaN|Infinity|undefined/, `${mood}: every number is a number`);
    assert.equal(still, moodSvg(moodScene(mood, STILL, "#19C77A")), `${mood}: the still is the same every time`);
    if (mood !== "flat") {
      assert.notEqual(moodSvg(moodScene(mood, 4_000, "#19C77A")), moodSvg(moodScene(mood, 4_420, "#19C77A")), `${mood}: alive after the entrance`);
    }
  }
});

test("a gain's emotion and a loss's are drawn the same size, in the same place", () => {
  const box = (svg) => svg.match(/<svg[^>]+>/)[0];
  assert.equal(box(moodSvg(moodScene("rocket", STILL, "#19C77A"))), box(moodSvg(moodScene("cry", STILL, "#FF4D55"))));
  assert.equal(CARD.mood.width, MOOD_BOX.width);
  assert.equal(CARD.mood.height, MOOD_BOX.height);
});

test("the face is written from the stored card: the result, entry and exit, the period — and no wallet", () => {
  const face = cardFace(gain(), "https://ryntra.io", null);
  assert.equal(face.tone, "up");
  assert.equal(face.headline, "+42.8%");
  assert.equal(face.resultBps, 4_280);
  assert.equal(face.ladder.entry, "$0.00000200");
  assert.equal(face.ladder.exit, "$0.00000286");
  assert.ok(Math.abs(face.ladder.ratio - 1.428) < 1e-9);
  assert.equal(face.period, "24 Sept – 4 Oct 2026 · 10 days");
  assert.equal(face.link, "ryntra.io/r/78KZV413GGPJ");
  assert.equal(face.facts.length, 0, "no dollars unless chosen");
  assert.equal(face.rank.name, "Silver");
  assert.equal(face.qr.bits.length, face.qr.size * face.qr.size);
  assert.ok(!JSON.stringify(face).includes(WALLET), "the wallet is never on the card");

  const lost = cardFace(loss(), "https://ryntra.io", null);
  assert.equal(lost.tone, "down");
  assert.equal(lost.headline, "−25.0%");
  assert.equal(headlineSize(lost.headline), headlineSize(face.headline), "a loss is as large as a gain");

  const withDollars = cardFace(card({ amounts: true, resultBps: -2_500, proceeds: 75_000_000n, locale: "uk" }), "https://ryntra.io", null);
  assert.deepEqual(withDollars.facts, [{ label: "Прибуток / збиток", value: "−$25,00", tone: "down" }]);
  assert.equal(cardTone(card({ resultBps: 0, proceeds: 100_000_000n })), "flat");

  const bought = cardFace(card({ kind: "BUY", rank: null }), "https://ryntra.io", null);
  assert.equal(bought.tone, "buy");
  assert.equal(bought.headlineLabel, "Price");
  assert.equal(bought.ladder, null);
  assert.equal(bought.rank, null);
});

test("the entrance is the same for a gain and a loss, and ends on the receipts' figure", () => {
  const up = cardFace(gain(), "https://ryntra.io", null);
  const down = cardFace(loss(), "https://ryntra.io", null);
  let lastUp = 0;
  for (let t = 0; t <= INTRO_MS + 400; t += 50) {
    const phase = sceneAt(t);
    const a = Number(headlineAt(up, phase).replace(/[^\d.]/g, ""));
    const b = Number(headlineAt(down, phase).replace(/[^\d.]/g, ""));
    assert.ok(a <= 42.8 && b <= 25, "the count never passes the result");
    assert.ok(a >= lastUp, "the count only rises toward the result");
    lastUp = a;
  }
  const still = sceneAt(STILL);
  for (const [key, value] of Object.entries(still)) {
    if (key === "sheen") assert.equal(value, null, "no light passes on the still");
    else assert.equal(value, 1, `${key} is in place on the still`);
  }
  assert.equal(headlineAt(up, still), "+42.8%");
  assert.equal(headlineAt(down, still), "−25.0%");
  assert.ok(Math.abs(ladderWidths(1.428).exit - 285.6) < 1e-9 && !ladderWidths(1.428).cut);
  assert.deepEqual(ladderWidths(14), { entry: 200, exit: 300, cut: true });
});

/** A 2D context that only remembers the words it was asked to write. */
function recordingContext() {
  const written = [];
  const gradient = { addColorStop() {} };
  const target = {
    written,
    fillText: (text) => written.push(String(text)),
    measureText: (text) => ({ width: String(text).length * 9 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key] : () => {}),
    set: (object, key, value) => {
      object[key] = value;
      return true;
    },
  });
}

test("the still frame writes only the face's own words and figures", () => {
  globalThis.Path2D ??= class {};
  const image = {};
  for (const stored of [gain(), loss(), card({ kind: "BUY", amounts: true })]) {
    const face = cardFace(stored, "https://ryntra.io", null);
    const ctx = recordingContext();
    drawCardScene(ctx, face, { backdrop: image, wordmark: image, wordmarkRatio: 3.94, badge: image, icon: null }, { sans: "Geist", mono: "Geist Mono" }, STILL);
    const allowed = new Set([
      face.letter,
      face.kindLabel,
      face.symbol,
      face.headline,
      face.headlineLabel,
      face.period,
      face.join,
      face.link,
      face.offer,
      face.offerWhy,
      face.seal,
      face.risk,
      face.rank?.name,
      face.ladder?.entryLabel,
      face.ladder?.entry,
      face.ladder?.exitLabel,
      face.ladder?.exit,
      ...face.facts.flatMap((fact) => [fact.label, fact.value]),
    ]);
    for (const text of ctx.written) assert.ok(allowed.has(text), `«${text}» comes from the face`);
    assert.ok(ctx.written.includes(face.headline));
    assert.ok(ctx.written.includes(face.offer));
    assert.ok(ctx.written.includes(face.risk));
  }
});

test("a token's picture is what its bytes say, whatever the header claims", async () => {
  const { sniffImage } = await import("./card-icon.server.ts");
  assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns=")), null);
  assert.equal(sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38])), null, "a GIF is not drawn");
});

test("a small loss moves as much as a small gain: as many parts of the figure live", () => {
  const moving = (mood) => {
    const at = (t) => moodSvg(moodScene(mood, t, "#19C77A")).split("<");
    const a = at(5_000);
    const b = at(5_233);
    return a.filter((part, i) => part !== b[i]).length;
  };
  const rocket = moving("rocket");
  for (const mood of ["tear", "cry", "storm"]) {
    assert.ok(moving(mood) >= Math.min(8, rocket), `${mood}: ${moving(mood)} parts move, the rocket ${rocket}`);
  }
});
