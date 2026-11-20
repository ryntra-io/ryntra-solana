import assert from "node:assert/strict";
import test from "node:test";

/* The terminal offers a position in a pool of a checked stock only where its own stocks' switch is open. */

const { EARN_PRO_STOCKS_OPEN, proKnown, proOffered, proStock } = await import("./pro.ts");

const SOL = "So11111111111111111111111111111111111111112";
const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const pier = (other, stock) => ({ address: "Cuwq452DQpCoti14YML8f8WMCeahTDt1T5hnC75Vcu8N", x: { mint: other, symbol: "ANT", decimals: 6 }, y: { mint: SOL, symbol: "SOL", decimals: 9 }, solIsX: false, price: 0.7, feeBps: 80, tickSpacing: 64, tickId: 0, depthLamports: null, rewards: [], takesDeposits: true, ...(stock === undefined ? {} : { stock }) });

test("a stock's pier is offered only where the terminal's stocks' switch is open — closed by default", () => {
  assert.equal(EARN_PRO_STOCKS_OPEN, false, "a build without the switch offers nothing new");
  const ant = pier(ANT, { issuer: "Backpack Securities" });
  assert.equal(proStock(ant), "Backpack Securities");
  assert.equal(proKnown(ant), false, "a stock is no coin Earn checked: no agent looks after it");
  assert.equal(proOffered(ant, "mainnet"), false);
  assert.equal(proOffered(ant, "mainnet", false, true), true);
  assert.equal(proOffered(ant, "mainnet", true, false), true, "every pool open covers it too");
  /* A coin the engine does not mark as a stock is not offered by the stocks' switch. */
  assert.equal(proOffered(pier(MET), "mainnet", false, true), false);
  assert.equal(proOffered(pier(MET, null), "mainnet", false, true), false);
  assert.equal(proStock(pier(MET)), null);
});
