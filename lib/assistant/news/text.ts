/**
 * A feed's text made safe to keep and to show (AI-09).
 *
 * A headline is someone else's words: it is decoded, stripped of markup,
 * of invisible and direction-changing characters and of links, folded to
 * one line and cut — and then screened. A headline that addresses an
 * assistant, asks for a key or tells a reader to move funds is no headline
 * a publisher writes; it is an attempt to steer whatever reads it, and the
 * item is not kept at all (`screenText`). What is kept is data: it reaches a
 * model only inside a block marked as third-party text, and a model's words
 * about it are held to the reads like any other (`lib/agent/answer.ts`).
 *
 * Pure: a string in, a string out.
 */

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
};

function decodeOnce(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Entities decoded — twice, since some feeds encode an entity again (`&amp;#039;`). */
export function decodeEntities(text: string): string {
  return decodeOnce(decodeOnce(text));
}

/** The content of a CDATA section, or the text as it is. */
export function unwrapCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/* Control characters, soft hyphens, zero-width and direction marks, invisible operators, the BOM. */
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜ᅟᅠ᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ\u{E0000}-\u{E007F}]/gu;
const LINKS = /\b(?:https?:\/\/|www\.)\S+/gi;

/** One line of plain text, at most `max` characters, cut at a word with «…». */
export function cleanText(raw: string, max: number): string {
  const decoded = decodeEntities(unwrapCdata(raw))
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]{0,2000}>/g, " ");
  const text = decodeEntities(decoded).normalize("NFKC").replace(INVISIBLE, "").replace(LINKS, " ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/u, "")}…`;
}

/*
 * The shapes of an attempt to steer a reader that is a program: an order
 * to drop its rules, a role given to it or a system turn, an address to an
 * assistant, a request for a key or for someone's data, an order to move
 * someone's funds, a tool call written as data, the assistant's own name.
 * They are the forms of an order, not topics: a headline about a hack that
 * stole private keys, an iPhone jailbreak or an «AI agent» phone is news, and
 * stays (checked on the live feeds, 18.10).
 */
const STEERING: readonly RegExp[] = [
  /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+|your\s+|my\s+|these\s+|those\s+|of\s+)?(previous|prior|above|earlier|system|original|safety)?\s*(instructions|prompts?|guidelines|rules)\b/i,
  /\b(system|developer)\s+(prompt|instructions?)\b|(^|[\s"'«])system\s*:\s/i,
  /\b(you are now|you're now|from now on,? you|act as|pretend (to be|you are))\b[^.]{0,40}\b(ai|assistant|chat ?bot|model|gpt|agent|ryntra|ryn|advisor|bot)\b/i,
  /\b(as an? (ai|assistant|language model)|dear (ai|assistant|model|agent)s?|attention,? (ai|assistant|model|llm|agent)s?|note to (ai|llm|assistants?|agents?|models?))\b|(^|[.!?]\s+|[«"“'(]\s*)(ai|llm|gpt|assistant|bot|agent|model)s?\s*[,:]\s|\b(ryntra|ryn)\s+(assistant|ai|bot|agent)\s*[,:]/i,
  /<\s*\/?\s*(system|assistant|user|instructions?|tool|prompt)\b[^>]*>|\[\/?\s*(INST|SYS|SYSTEM)\s*\]|#{2,}\s*(system|instructions?)\b/i,
  /\bnew (instructions|rules|task)\s*:|\b(reveal|print|show|repeat|output|list) (your|the) (system )?(instructions|prompt|rules|api keys?|keys?|environment)\b|\b(reveal|show|list|print)\b[^.]{0,20}\b(user'?s|other users'?|another (user|wallet)'?s?)\b/i,
  /\b(send|share|paste|enter|give|reveal|post|type)\b[^.]{0,20}\b(your|the user'?s)\s+(api[ _-]?keys?|private keys?|seed (phrase|words)|mnemonic|secret keys?|password)\b/i,
  /\b(send|transfer|move|withdraw|bridge)\s+(all\s+|every\s+)?(of\s+)?(your|the user'?s|user|their)\s+(funds|tokens|sol|usdc|crypto|balance|wallet|assets)\b|\b(should|must)\s+(move|send|transfer)\s+(their\s+|your\s+)?funds\b/i,
  /\b(sign|approve)\s+(this|the following|the attached|the pending)\s+(transaction|tx|message|request)\b/i,
  /\{\s*"?(tool|function|name|arguments|role|action)"?\s*:/i,
  /\b(claim|airdrop|connect (your )?wallet|verify (your )?wallet|free tokens)\b[^.]{0,60}\b[a-z0-9-]{2,}\.(xyz|io|com|app|net|org|finance|fi|gg|me|site|online|top|claims?)\b|\b(visit|go to|click)\b[^.]{0,30}\b(to (get|claim|receive)|[a-z0-9-]{2,}\.[a-z]{2,10}\b)/i,
  /(?<![\p{L}\p{N}])(ryntra|ryn)(?![\p{L}\p{N}])/iu,
  /(ігноруй|забудь|не зважай на)[^.]{0,40}(інструкці|правил|промпт)|системн\p{L}* (промпт|інструкці)|ти (тепер|зараз) ?(—|-)? ?(асистент|помічник|модель|бот)|(надішли|введи|покажи|дай) [^.]{0,20}(сво\p{L}* )?(приватн\p{L}* ключ|сід[ -]?фраз)|переказ\p{L}* (усі|всі) (свої |твої )?(кошти|токени)/iu,
];

/* The assistant's name is the one steering shape a model's own sentence may carry — «a plan in Ryntra» is the product's word. */
const NAME_RULE = STEERING.length - 2;

/*
 * A headline that orders a trade or promises a gain: not news, a sales line —
 * kept out of every answer like a command (`answer.ts` holds a model to the
 * same). A question that weighs («Should you buy SOL?») is a headline.
 */
const TRADE_ORDERS: readonly RegExp[] = [
  /(^|[.:;!—–]\s+)(buy|sell|short|dump)\s+(\$[a-z][a-z0-9]{1,9}|now|immediately|the dip|before)\b(?![^.?!]*\?)|(^|[.:;!—–]\s+)(ape into|load up on|take profits?|get out of)\b(?![^.?!]*\?)/i,
  /\b(you should|you must|it'?s time to|now is the time to|time to)\s+(buy|sell|short|exit|take profits?|load up)\b(?!\s*\?)(?![^.?!]*\?)/i,
  /\b(buy|sell)\s+(it\s+|them\s+|now\s+)?(now|immediately|asap|right now|today)\b(?![^.?!]*\?)/i,
  /\b(strong (buy|sell)(?!\s+(pressure|volume|orders?|walls?|side|flows?|interest))|must[- ]buy|buy signal|sell signal)\b/i,
  /\b(guaranteed (profits?|returns?|gains?|\d)|(analysts?|insiders?|experts?) guarantee|risk[- ]free (profits?|returns?|gains?)|100\s?% (profit|returns?|gains?)|can'?t lose|will (triple|double|10x|moon))\b/i,
  /(^|[.:;!—–]\s+)(купи|купуй|купуйте|продай|продавай|продайте|фіксуй|заходь|докупи)(?![\p{L}])/iu,
  /(?<!чи\s)(варто|треба|час|слід)\s+(купити|продати|купувати|продавати|заходити)(?![\p{L}])/iu,
];

/* The trade orders a model's sentence is held to as well: an order that leads a clause («— sell $JUP immediately»), a sales label, a promise — never a weighing («which holding you should sell first»), which is the verifier's advice rule to judge. */
const PROMISES = TRADE_ORDERS.filter((rule) => /strong|guarantee|ape into/.test(rule.source));

export type Screened = Readonly<{ ok: true }> | Readonly<{ ok: false; kind: "steering" | "trade"; rule: number }>;

/**
 * Whether a headline or a summary is text a publisher would write — or an
 * attempt to steer a reader, or an order to trade. `name: false` lets the
 * assistant's own name pass, for a model's sentence about the product.
 */
export function screenText(text: string, options: Readonly<{ name?: boolean }> = {}): Screened {
  for (let index = 0; index < STEERING.length; index += 1) {
    if (index === NAME_RULE && options.name === false) continue;
    if (STEERING[index].test(text)) return { ok: false, kind: "steering", rule: index };
  }
  for (let index = 0; index < TRADE_ORDERS.length; index += 1) if (TRADE_ORDERS[index].test(text)) return { ok: false, kind: "trade", rule: index };
  return { ok: true };
}

/* The shapes no sentence of Ryntra's own ever has, whatever it cites: an order to drop the rules, a role tag, a tool call as data. */
const HARD = [/\b(ignore|disregard|forget)\s+(all\s+)?(of\s+)?(your|the|my|any|these)?\s*(previous|prior|above|earlier|system|original)\s+(instructions|prompts?|rules|guidelines)\b/i, STEERING[4], STEERING[9]];

/** A sentence shaped like an order to a program in any answer — the narrow, always-on part of the screen. */
export function ordersAProgram(text: string): boolean {
  return HARD.some((rule) => rule.test(text));
}

/**
 * A model's sentence held to the same screen: an order to a program, or a
 * sales line («strong buy», «guaranteed returns») — the product's own name
 * allowed. Personal advice is the verifier's own rule (`answer.ts`), which
 * knows a weighing from an order.
 */
export function steersOrSells(text: string): boolean {
  const screened = screenText(text, { name: false });
  if (!screened.ok && screened.kind === "steering") return true;
  return PROMISES.some((rule) => rule.test(text));
}
