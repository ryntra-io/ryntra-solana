import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { agentFeeFigures } from "../../city/lib/bots/agent-fee.ts";
import { FEE_POLICY_V2 } from "../../lib/core/fee-policy.ts";
import { AGENT_FEE_CEILING_BPS, AGENT_FEE_FLOOR_BPS } from "../../lib/mandate/fee-rates.ts";
import { COPY } from "../bots/copy-words.ts";
import { FEE } from "./words.ts";

/* Ryntra's fee in one phrasing on every screen before a signature, and every figure the engine's own. */

const TERMINAL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(TERMINAL, rel), "utf8");

function filesOf(dir, keep) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesOf(full, keep);
    return keep(name) ? [full] : [];
  });
}

test("one phrasing, both languages: «Ryntra fee 0.1%», «No Ryntra fee», «Ryntra fee 0.1–1% a trade»", () => {
  assert.equal(FEE.en.ryntra("0.1%"), "Ryntra fee 0.1%");
  assert.equal(FEE.uk.ryntra("0,1%"), "Комісія Ryntra 0,1%");
  assert.equal(FEE.en.none, "No Ryntra fee");
  assert.equal(FEE.uk.none, "Без комісії Ryntra");
  assert.equal(FEE.en.perTrade("0.1", "1"), "Ryntra fee 0.1–1% a trade");
  assert.equal(FEE.uk.perTrade("0,1", "1"), "Комісія Ryntra 0,1–1% з угоди");
});

test("every screen before a signature says the fee by the kit's words — the swap, a coin, the quick buy, a limit, the agent, the bots, the portfolio", () => {
  const uses = {
    "swap/SwapTicket.tsx": ["fw.ryntra(figures.fee) : fw.none"],
    "coin/Ticket.tsx": ["fw.ryntra(figures.fee) : fw.none", "fw.ryntra(formatBps(review.fee.ryntraBps))", ": fw.none) : null;"],
    "coin/LimitStop.tsx": ["fw.ryntra(formatBps(shown.fee.ryntraBps))", ": fw.none}"],
    "market/QuickBuy.tsx": ["fw.ryntra(figures.fee) : fw.none"],
    "agents/NewAgent.tsx": ["fw.perTrade(fee.low, fee.high)}", "`${fw.perTrade(fee.low, fee.high)} · ${w.pilotPayWhen}`"],
    "bots/Ladder.tsx": ["${fw.none}"],
    "bots/Grid.tsx": ["`${fw.none} · ${w.costLineDlmm(", "venue === 'dlmm' ? fw.none : w.costShort"],
    "portfolio/ExitPanel.tsx": ["fee ? fw.ryntra(digits(fee, lang)) : fw.none"],
    "portfolio/CleanBlock.tsx": ["w.lineFee(fw.ryntra(digits(fee, lang)))"],
  };
  for (const [file, parts] of Object.entries(uses)) {
    const source = read(file);
    assert.match(source, /import \{ FEE \} from '@\/terminal\/ui\/words';/u, file);
    for (const part of parts) assert.ok(source.includes(part), `${file}: ${part}`);
  }
});

test("no screen keeps a fee phrasing of its own: no «Ryntra fee 0», no bare «Fee 0.1%», no «1% on the rest»", () => {
  const words = filesOf(TERMINAL, (name) => /words\.ts$/u.test(name));
  for (const file of words) {
    const text = readFileSync(file, "utf8");
    const rel = path.relative(TERMINAL, file);
    assert.doesNotMatch(text, /Ryntra fee 0\b|Комісія Ryntra 0\b/u, `${rel}: «No Ryntra fee», as every screen says it`);
    assert.doesNotMatch(text, /1% on the rest|1% на решті/u, `${rel}: the engine's rates by kind of coin`);
  }
  for (const rel of ["swap/words.ts", "coin/words.ts", "agents/words.ts", "portfolio/all-words.ts"]) {
    assert.doesNotMatch(read(rel), /`Fee \$\{|`Комісія \$\{(?:fee|rate)\}`|noFeeLine|feeLine:/u, rel);
  }
});

test("the figures are the engine's: the agent's range is the policy's floor and ceiling, the copy bot's rates its table", () => {
  assert.equal(AGENT_FEE_FLOOR_BPS, FEE_POLICY_V2.MAJOR.bps);
  assert.equal(AGENT_FEE_CEILING_BPS, FEE_POLICY_V2.MEME.bps);
  const en = agentFeeFigures("en");
  assert.deepEqual([en.low, en.high], [String(FEE_POLICY_V2.MAJOR.bps / 100), String(FEE_POLICY_V2.MEME.bps / 100)]);
  assert.equal(FEE.en.perTrade(en.low, en.high), "Ryntra fee 0.1–1% a trade");
  const how = COPY.en.howFees(en.major, en.stock, en.trending, en.meme);
  for (const flow of ["MAJOR", "XSTOCK", "TRENDING", "MEME"]) assert.ok(how.includes(`${FEE_POLICY_V2[flow].bps / 100}%`), `${flow} in «${how}»`);
  assert.equal(FEE_POLICY_V2.STABLE.bps, 0, "dollars pay none, as the line says");
  assert.match(read("bots/Copy.tsx"), /c\.howFees\(fee\.major, fee\.stock, fee\.trending, fee\.meme\)/u);
});
