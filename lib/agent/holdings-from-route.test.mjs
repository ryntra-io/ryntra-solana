// Run from repo root: node --test lib/agent/holdings-from-route.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AgentBriefResponseSchema, AgentCardSchema, AgentCriticResponseSchema, AgentMessageResponseSchema } from "../api/v1/contract.ts";
import { resolveAgentBudgetConfig } from "./budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER } from "./fixtures.ts";
import { holdingsReadFromAnswer } from "./holdings-from-route.ts";
import { handleAgentBrief, handleAgentCritic } from "./lens/service.ts";
import { handleAgentMessage, openAgentSession } from "./service.ts";
import { CitationBook } from "./provenance.ts";
import { runTool } from "./tools/registry.ts";

/**
 * `RYN-API-CONTRACT-002` — the defect this closes: the holdings route serves
 * native SOL as `kind: "NATIVE_SOL"` with `mint: null`, the agent cast that
 * answer to a row type that promised a mint, and the holdings card it built
 * failed the session's own schema — so on production a portfolio question,
 * the portfolio Brief and every asset Critic of a real wallet answered a
 * server error. The fixtures never showed it: they were written in the
 * agent's shape, not the route's. These tests start from the route's shape.
 */

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

/** An answer in the exact shape `POST /api/solana/holdings` serves (its own test parses the same schema). */
function routeAnswer(overrides = {}) {
  const account = (mint, amountRaw) => ({ address: OWNER, mint, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", amountRaw, decimals: 6, state: "INITIALIZED", canonical: true });
  return {
    data: {
      owner: OWNER,
      network: "mainnet",
      lamports: "3250000000",
      holdings: [
        { kind: "NATIVE_SOL", mint: null, amountRaw: "3250000000", spendableRaw: "3249000000", decimals: 9, tokenProgram: null, canonicalAta: null, sourceAccounts: [], programKind: null, extensions: [], name: "Solana", symbol: "SOL", nameAuthority: null, catalog: { mint: WSOL, symbol: "SOL", name: "Wrapped SOL", isVerified: true, isSuspicious: false, usdPrice: "212.5", source: { ref: "jupiter:tokens", label: "Jupiter Tokens API" }, category: "crypto" } },
        { kind: "TOKEN", mint: USDC, amountRaw: "150000000", spendableRaw: "150000000", decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", canonicalAta: OWNER, sourceAccounts: [account(USDC, "150000000")], programKind: "SPL_TOKEN", extensions: [], name: "USD Coin", symbol: "USDC", nameAuthority: null, catalog: { mint: USDC, symbol: "USDC", name: "USD Coin", isVerified: true, isSuspicious: false, usdPrice: "1", source: { ref: "jupiter:tokens", label: "Jupiter Tokens API" }, category: "crypto" } },
      ],
      held: 1,
      tokenRead: "COMPLETE",
      returned: 2,
      detailed: 1,
      observedAt: new Date(FIXTURE_NOW_MS - 30_000).toISOString(),
      source: { host: "rpc.example", hosts: ["rpc.example"], health: "HEALTHY", detail: "Both endpoints answered." },
      catalog: { status: "PRESENT", missing: [] },
      ...overrides,
    },
  };
}

test("the route's native SOL row is read as SOL under wrapped SOL's mint, never as a row without one", () => {
  const read = holdingsReadFromAnswer(200, routeAnswer());
  assert.ok(read.ok, "the answer parses");
  assert.equal(read.holdings[0].kind, "NATIVE");
  assert.equal(read.holdings[0].mint, WSOL, "native SOL is planned and priced under wrapped SOL");
  assert.ok(read.holdings.every((row) => typeof row.mint === "string" && row.mint.length >= 32), "every row has a mint");
  assert.equal(read.sourceHost, "rpc.example");
});

test("an answer that does not match the contract is an unavailable read with its reason, never a guessed row", () => {
  const broken = routeAnswer();
  broken.data.holdings[0].kind = "SOMETHING";
  const read = holdingsReadFromAnswer(200, broken);
  assert.equal(read.ok, false);
  assert.match(read.reason, /did not match its contract/);
  const refused = holdingsReadFromAnswer(504, { error: { code: "READ_DEADLINE", message: "Balances could not be read in time. Please refresh." } });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /in time/);
});

/** The fixture world, with its holdings replaced by the route's real shape through the adapter. */
async function realShapedWorld() {
  const fixture = await createFixtureWorld();
  const read = holdingsReadFromAnswer(200, routeAnswer());
  const readers = { ...fixture.readers, holdings: async () => read };
  return { fixture, deps: { store: fixture.store, readers, model: null, budget: resolveAgentBudgetConfig({}), now: () => FIXTURE_NOW_MS } };
}

test("the holdings card built from the route's real answer is one the contract accepts", async () => {
  const { deps } = await realShapedWorld();
  const run = await runTool("holdings_read", {}, { owner: OWNER, locale: "en", nowMs: FIXTURE_NOW_MS, readers: deps.readers, citations: new CitationBook(), newDraftId: () => "agd_000000000000000000000000" });
  assert.equal(run.outcome, "ok");
  for (const card of run.cards) AgentCardSchema.parse(card);
  const holdings = run.cards.find((card) => card.kind === "holdings");
  assert.equal(holdings.rows[0].symbol, "SOL");
  assert.equal(holdings.rows[0].mint, WSOL);
});

test("a portfolio question, the portfolio Brief and an asset Critic all answer for a real-shaped wallet", async () => {
  const { deps } = await realShapedWorld();
  const opened = await openAgentSession(deps, { owner: OWNER, locale: "en", context: { kind: "portfolio" } });
  assert.ok(opened.ok);
  const asked = await handleAgentMessage(deps, { owner: OWNER, sessionId: opened.response.session.id, text: "What changed in my portfolio?", locale: "en" });
  assert.ok(asked.ok, `the turn is written: ${asked.ok ? "" : asked.reason}`);
  AgentMessageResponseSchema.parse(asked.response);

  const brief = await handleAgentBrief(deps, { owner: OWNER, subject: { kind: "portfolio" }, locale: "uk", compose: "deterministic" });
  assert.ok(brief.ok);
  AgentBriefResponseSchema.parse(brief.response);

  const critic = await handleAgentCritic(deps, { owner: OWNER, subject: { kind: "asset", mint: WSOL, symbol: "SOL" }, locale: "en", compose: "deterministic" });
  assert.ok(critic.ok);
  AgentCriticResponseSchema.parse(critic.response);
});
