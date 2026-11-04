import assert from "node:assert/strict";
import test from "node:test";

/* CITY-100: Earn's notes in the city — what the city reads of the wallet, told through the notification centre while
   Ryntra is open; each told once per device. Earn is switched open for this file's process. */

process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN = "open";
const { startEarnNotes, setEarnNotesEnv, stockCandidates, TOLD_KEY } = await import("./notes-source.ts");
const { useEarnData, setEarnEngine } = await import("./store.ts");
const { useWallet } = await import("../trade/wallet.ts");
const { useLangStore } = await import("../i18n/lang.ts");
const { KINDS, kindsShown } = await import("../notify/kinds.ts");

const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const SOL = "So11111111111111111111111111111111111111112";
const TSLA = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const DAY = 24 * 3_600_000;
/** Friday 6 November 2026, 13:00 in New York. */
const FRIDAY = Date.UTC(2026, 10, 6, 18, 0);

const side = (mint, symbol, amount = 1) => ({ mint, symbol, amount, unclaimed: 0, priceUsd: null });
const view = (address, rangeState, x = side(JITO, "JitoSOL"), y = side(SOL, "SOL")) => ({ kind: "dlmm", address, pool: `pool-${address}`, name: "", x, y, rangeState, lower: null, upper: null, price: null, valueUsd: null, unclaimedUsd: null, lockedBps: 0, feesElsewhere: false, hasRewards: false, slot: null, at: 0, pricesAt: null });
const ready = (value, at = 0) => ({ owner: OWNER, value: { status: "ready", value, at } });

function stand(clock = FRIDAY - 2 * DAY) {
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
  const said = [];
  const registered = [];
  setEarnNotesEnv({ say: (note) => said.push(note), now: () => clock, storage: () => storage, visible: () => false, register: async (owner, locale) => (registered.push([owner, locale]), "ok") });
  // No read leaves the test: the engine answers nothing new.
  setEarnEngine({ feed: async () => ({ ok: false, code: "T" }), piers: async () => ({ ok: false, code: "T" }), stocks: async () => ({ ok: false, code: "T" }), lend: async () => ({ ok: false, code: "T" }), positions: async () => ({ ok: false, code: "T" }) });
  useLangStore.setState({ lang: "en" });
  useEarnData.setState({ positions: null, stocks: null });
  useWallet.setState({ connection: { wallet: "Test", address: OWNER, chains: ["solana:mainnet"] }, holdings: null, holdingsRead: "none" });
  return { said, registered, storage, data };
}

test("the window lists Earn's three where Earn is open; loan health waits for the first loan read, locked like the liquidation risk", () => {
  assert.deepEqual(kindsShown("earn").map((k) => k.id), ["range", "weekend", "dividend"]);
  assert.ok(kindsShown("earn").every((k) => k.telegram), "Ryntra's server tells Telegram about them: the window marks them");
  const loan = KINDS.find((k) => k.id === "loan");
  assert.equal(loan.locked, true);
  assert.ok(!loan.places.includes("off"));
  assert.equal(loan.door, false, "no loan is read yet (E10)");
});

test("out of range: told once — a reload does not tell it again; back in range, its next exit is told again", async () => {
  const { said, registered } = stand();
  let stop = startEarnNotes();
  useEarnData.setState({ positions: ready([view("P1", "above"), view("P2", "in_range")]) });
  stop();
  assert.deepEqual(said, [{ kind: "range", title: "Out of range · JitoSOL–SOL", line: "No fees until the price comes back." }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(registered, [[OWNER, "en"]], "something in Earn: the server is asked to watch it for the phone and Telegram");

  stop = startEarnNotes();
  useEarnData.setState({ positions: ready([view("P1", "above"), view("P2", "in_range")]) });
  assert.equal(said.length, 1, "a reload does not tell it twice");
  useEarnData.setState({ positions: ready([view("P1", "in_range"), view("P2", "in_range")]) });
  useLangStore.setState({ lang: "uk" });
  useEarnData.setState({ positions: ready([view("P1", "below"), view("P2", "in_range")]) });
  stop();
  assert.equal(said.length, 2);
  assert.equal(said[1].title, "Поза діапазоном · JitoSOL–SOL", "in the language on screen");
});

test("stocks: a dividend date and the exchange's weekend, each once; the coins asked about are past SOL, LSTs and dollars", () => {
  const { said } = stand(FRIDAY);
  const holdings = { owner: OWNER, sol: null, tokens: new Map([[TSLA, { spendableRaw: "1000000000", decimals: 9 }], [JITO, { spendableRaw: "5", decimals: 9 }]]), names: new Map([[TSLA, { symbol: "TSLAx", name: null, verified: true, icon: null }]]), complete: true, at: FRIDAY };
  assert.deepEqual(stockCandidates(holdings, [view("P1", "in_range")]), [TSLA]);
  useWallet.setState({ holdings });
  const stop = startEarnNotes();
  const configs = [{ mint: TSLA, multiplier: 1, newMultiplier: 1.004, newMultiplierEffectiveAt: new Date(FRIDAY + 3 * DAY).toISOString() }];
  useEarnData.setState({ stocks: ready(configs, FRIDAY) });
  useEarnData.setState({ stocks: ready(configs, FRIDAY + 1) });
  stop();
  assert.deepEqual(
    said.map((n) => [n.kind, n.title, n.line]),
    [
      ["dividend", "Dividend date · TSLAx", "In 3 days"],
      ["weekend", "Stock exchange weekend", "TSLAx can jump when it opens on Monday."],
    ],
  );
});

test("what was told is kept per wallet on the device; a value it cannot read is nothing told", () => {
  const { data } = stand();
  const stop = startEarnNotes();
  useEarnData.setState({ positions: ready([view("P1", "above")]) });
  stop();
  const kept = JSON.parse(data.get(TOLD_KEY + OWNER));
  assert.deepEqual(kept.out, ["P1"]);
  const second = stand();
  second.data.set(TOLD_KEY + OWNER, "{broken");
  const { said } = second;
  const again = startEarnNotes();
  useEarnData.setState({ positions: ready([view("P1", "above")]) });
  again();
  assert.equal(said.length, 1);
});
