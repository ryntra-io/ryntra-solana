/**
 * One subject through the pre-sign check (CITY-152's engine, `lib/ward/check.ts`) and back as what the bot says
 * (CITY-166). The engine is called in-process with the same reads `POST /api/v1/ward/check` uses; nothing here judges on
 * its own — the verdict and every reason are the engine's, the bot only chooses which reason leads its one line.
 *
 * Pure apart from the injected reads.
 */

import { checkWard, checkWardAddress, WardInputError, type WardReads, type WardReason } from "../ward/check.ts";
import { WARD_CORE_UNKNOWNS, WARD_LEVEL_RANK, type WardVerdict } from "../ward/codes.ts";
import { KNOWN_MINTS } from "../ward/known.ts";
import { WARD_BOT_WORDS, type WardBotLang } from "./words.ts";
import type { WardBotSubject } from "./extract.ts";

/** What was checked, as the end of the line names it. */
export type WardBotTopic =
  | Readonly<{ kind: "token"; mint: string; symbol: string | null }>
  | Readonly<{ kind: "address"; address: string }>
  | Readonly<{ kind: "transaction" }>
  | Readonly<{ kind: "link" }>;

export type WardBotOutcome =
  | Readonly<{ kind: "verdict"; verdict: WardVerdict; reasons: readonly WardReason[]; notRead: number; topic: WardBotTopic }>
  /** The chain did not answer: nothing judged. */
  | Readonly<{ kind: "unread" }>
  /** Something the engine cannot read: a signature, or input it refused. */
  | Readonly<{ kind: "not-checkable" }>;

/**
 * `known` — addresses seen in the same chat — is handed only with a bare address, where the engine compares it with
 * them for a look-alike. The engine also takes a known address as one with history, which a chat's mention is not, so a
 * transaction or a link is checked without them.
 */
export async function checkSubject(subject: WardBotSubject, reads: WardReads, options: Readonly<{ known?: readonly string[] }> = {}): Promise<WardBotOutcome> {
  const known = options.known ?? [];
  try {
    switch (subject.kind) {
      case "signature":
        return { kind: "not-checkable" };
      case "transaction": {
        const result = await checkWard({ transaction: subject.value, network: "mainnet" }, reads);
        return { kind: "verdict", verdict: result.verdict, reasons: result.reasons, notRead: result.notRead, topic: { kind: "transaction" } };
      }
      case "link": {
        const result = await checkWard({ link: subject.value, network: "mainnet" }, reads);
        return { kind: "verdict", verdict: result.verdict, reasons: result.reasons, notRead: result.notRead, topic: { kind: "link" } };
      }
      case "address": {
        const answer = await checkWardAddress({ address: subject.value, network: "mainnet", known }, reads);
        if (answer.subject === "unread") return { kind: "unread" };
        if (answer.subject === "token") {
          const { result } = answer;
          return { kind: "verdict", verdict: result.verdict, reasons: result.reasons, notRead: result.notRead, topic: { kind: "token", mint: result.mint, symbol: result.symbol } };
        }
        const { result } = answer;
        return { kind: "verdict", verdict: result.verdict, reasons: result.reasons, notRead: result.notRead, topic: { kind: "address", address: subject.value } };
      }
    }
  } catch (failure) {
    if (failure instanceof WardInputError) return { kind: "not-checkable" };
    throw failure;
  }
}

/* ---------------------------------------------------------------- the one line */

/** The marks the line starts with. «Nothing known» is not green: it is the absence of a finding, not a promise. */
export const WARD_BOT_MARKS: Readonly<Record<WardVerdict, string>> = { allow: "⚪", warn: "🟡", block: "🔴" };

/** The longest line the bot sends. */
export const WARD_BOT_LINE_MAX = 280;

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** The reason that leads: the heaviest, by the engine's own order — a core reading that did not happen leads a `warn` that has nothing heavier. */
export function leadReason(verdict: WardVerdict, reasons: readonly WardReason[]): WardReason | null {
  if (verdict === "allow") return null;
  const ranked = [...reasons].sort((a, b) => WARD_LEVEL_RANK[a.level] - WARD_LEVEL_RANK[b.level]);
  return ranked.find((reason) => reason.level === verdict) ?? ranked.find((reason) => reason.level === "unknown" && WARD_CORE_UNKNOWNS.has(reason.code)) ?? ranked.find((reason) => reason.level === "unknown") ?? null;
}

function reasonText(reason: WardReason, lang: WardBotLang): string {
  const words = WARD_BOT_WORDS[lang];
  if (reason.code === "TOKEN_TRANSFER_FEE") return words.fee(/(\d+(?:\.\d+)?)%/.exec(reason.line)?.[1] ?? null);
  if (reason.code === "RECIPIENT_LINK" || (reason.code === "RECIPIENT_REFUSED" && reason.detail?.includes("LINK_MISMATCH"))) {
    const problem = /\b(LINK_[A-Z_]+)\b/.exec(reason.detail ?? "")?.[1];
    if (problem && words.links[problem]) return words.links[problem];
  }
  return words.reasons[reason.code];
}

function topicText(topic: WardBotTopic, lang: WardBotLang): string {
  const words = WARD_BOT_WORDS[lang];
  switch (topic.kind) {
    case "token":
      return words.token(topic.symbol ?? KNOWN_MINTS[topic.mint]?.symbol ?? short(topic.mint));
    case "address":
      return short(topic.address);
    case "transaction":
      return words.transaction;
    case "link":
      return words.link;
  }
}

/**
 * The verdict in one line: the mark, the word, the leading reason (and how many more stand against it), what was
 * checked. «No known blockers» carries how many readings did not happen, so a partial read never looks whole.
 */
export function verdictLine(outcome: Extract<WardBotOutcome, { kind: "verdict" }>, lang: WardBotLang): string {
  const words = WARD_BOT_WORDS[lang];
  const parts: string[] = [];
  if (outcome.verdict === "allow") {
    parts.push(`${WARD_BOT_MARKS.allow} ${words.allow}`);
    if (outcome.notRead > 0) parts.push(words.notRead(outcome.notRead));
  } else {
    const lead = leadReason(outcome.verdict, outcome.reasons);
    const more = outcome.reasons.filter((reason) => reason !== lead && (reason.level === "block" || reason.level === "warn")).length;
    const head = `${WARD_BOT_MARKS[outcome.verdict]} ${outcome.verdict === "block" ? words.block : words.warn}`;
    parts.push(lead ? `${head} — ${reasonText(lead, lang)}${more > 0 ? ` (+${more})` : ""}` : head);
  }
  parts.push(topicText(outcome.topic, lang));
  const line = parts.join(" · ");
  return line.length > WARD_BOT_LINE_MAX ? `${line.slice(0, WARD_BOT_LINE_MAX - 1)}…` : line;
}
