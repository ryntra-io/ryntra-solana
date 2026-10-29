/**
 * Fixtures for the external-agent paths.
 *
 * Every host below is under `.test`, which can never resolve, and every address
 * is a base-58 string that belongs to nobody this product knows. Nothing here
 * is a peer anybody has registered: the live list of registered peer origins is
 * empty, and the tests that prove an order refuses rely on that.
 *
 * They live in one module because the cases the task names — a key that is not
 * ours, a mandate with nothing left in it, an action attempted over MCP, a
 * «completed» with nothing delivered, the same order placed twice, a deadline
 * that passes — are variations on two objects: one quote and one order. A
 * battery that re-declares them proves different things by accident.
 */

import type { SideFacts } from "../../core/fee-policy.ts";
import {
  A2A_SERVED_BINDING,
  A2A_WIRE_VERSION,
} from "../a2a/card.ts";

/** The pair the trade fixtures use: dollars in, a token out. */
export const FIXTURE_MINTS = Object.freeze({
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  sol: "So11111111111111111111111111111111111111112",
  /** A token nobody verified: by the table's own rule, a meme. */
  freshToken: "DqUfWUmyxzF8pstpzm6biNfKG55VBnF1HUFxeQBzns2C",
  /** A token a catalogue verified long ago: trending. */
  oldToken: "GmFNVt4tXsYXn5RQZJLWNix8ksd8XE69JGzZcd5X1rng",
  /** A stock by its issuer's tag. */
  stock: "CwiqtA5LdGPRydNX48GkCjyrJw6udZpfgQoUCnQDCHs6",
});

const YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

/** What a catalogue would say of a token nobody verified. */
export function memeFacts(mint = FIXTURE_MINTS.freshToken): SideFacts {
  return Object.freeze({ mint, verified: false, tags: Object.freeze([]), firstPoolAt: null });
}

/** A verified token whose first pool is a year old. */
export function trendingFacts(nowMs: number, mint = FIXTURE_MINTS.oldToken): SideFacts {
  return Object.freeze({
    mint,
    verified: true,
    tags: Object.freeze([]),
    firstPoolAt: new Date(nowMs - YEAR_MS).toISOString(),
  });
}

/** A stock, named by its issuer's tag and never by a symbol. */
export function stockFacts(mint = FIXTURE_MINTS.stock): SideFacts {
  return Object.freeze({ mint, verified: true, tags: Object.freeze(["xstocks"]), firstPoolAt: null });
}

/* ── a peer's Agent Card ──────────────────────────────────────────────── */

export const PEER_ORIGIN = "https://peer.example.test";
export const UNREGISTERED_PEER_ORIGIN = "https://other.example.test";

/**
 * One peer card, in the 1.0 shape: no top-level url, no top-level protocol
 * version, one entry per interface.
 */
export function peerCard(overrides: Record<string, unknown> = {}) {
  return {
    name: "Research agent (fixture)",
    description: "A fixture. The host is under `.test` and cannot resolve.",
    version: "3.1.0",
    supportedInterfaces: [
      {
        url: `${PEER_ORIGIN}/a2a`,
        protocolBinding: A2A_SERVED_BINDING,
        protocolVersion: A2A_WIRE_VERSION,
      },
    ],
    skills: [{ id: "counterparty-research" }],
    ...overrides,
  };
}

/** The peer's answer about one task, in the shape the protocol publishes. */
export function peerTask(taskId: string, state: string, artifacts = 0) {
  return {
    id: taskId,
    contextId: taskId,
    status: { state, timestamp: "2026-10-26T12:00:00.000Z" },
    artifacts: Array.from({ length: artifacts }, (_, index) => ({
      artifactId: `artifact-${index + 1}`,
      name: "report",
      parts: [{ text: "a fixture artifact" }],
    })),
    history: [],
  };
}

/* ── one message a caller sends ───────────────────────────────────────── */

export function sendMessage(data: Record<string, unknown>, messageId = "msg-00000001") {
  return {
    message: {
      messageId,
      role: "ROLE_USER",
      parts: [{ data }],
    },
  };
}

export function sendText(text: string, messageId = "msg-text-0001") {
  return { message: { messageId, role: "ROLE_USER", parts: [{ text }] } };
}
