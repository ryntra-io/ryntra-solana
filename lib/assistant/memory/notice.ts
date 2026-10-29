/**
 * What of a person's message is worth keeping about them (AI-18) — pure.
 *
 * Two ways in, both from the person's own words only:
 * - **asked** — «запам'ятай: …», «remember that …»: the rest of the message is kept as they wrote it;
 * - **said** — a sentence in the first person about who they are and how they trade: «я торгую мемкоїнами»,
 *   «I'm new to crypto», «не люблю плече». A question is never a fact about the asker, a sentence with a figure is
 *   left alone (a balance or a size is not something to repeat back), and a sentence about someone else is not theirs.
 *
 * Nothing here reads a headline, a token's page or a tool's output: a note is a sentence the person typed.
 */

import { MEMORY_NOTE_MAX_CHARS, cleanText, looksSecret } from "./store.ts";

export type Noticed = Readonly<{ text: string; source: "asked" | "said" }>;

const END = String.raw`(?![\p{L}\p{N}_])`;
const START = String.raw`(?<![\p{L}\p{N}_])`;

/** «Запам'ятай…», «запиши…», «remember…», «note that…» — the rest is what to keep. */
const ASKED = new RegExp(
  String.raw`^\s*(?:ryntra[\s,]+|будь ласка[\s,]+|please[\s,]+)?(?:запам['’ʼ]?ятай(?:те)?|запамятай|запиши(?: собі)?|занотуй|май на увазі|remember|note|keep in mind)(?:[\s,]+(?:що|this|that|про мене|about me))?[\s,:—-]+(.{2,400})$`,
  "iu",
);

/** The first person and a verb of who one is or how one trades — Ukrainian and English. */
const SAID = new RegExp(
  String.raw`${START}(?:я\s+(?:(?:зазвичай|переважно|в основному|здебільшого|часто|рідко|ніколи не|давно|тільки|лише|теж|також|ще)\s+)*(?:не\s+)?(?:торгую|трейдю|тримаю|інвестую|купую|продаю|граю|працюю|займаюсь|займаюся|цікавлюсь|цікавлюся|люблю|віддаю перевагу|обираю|використовую|користуюсь|користуюся|ходжу|сиджу|стежу|слідкую|вчуся|навчаюсь|шукаю|уникаю|боюсь|боюся|новачок|трейдер|інвестор|холдер|розробник|програміст|студент|з\s+\p{L}+)|мені\s+(?:\d+\s+рок\p{L}*|подобаються|подобається|не подобається|цікаві|цікаво|важливо|важлива|комфортно)|мене\s+(?:цікавить|цікавлять|звати)|мій\s+(?:стиль|горизонт|підхід|досвід|ризик|депозит|портфель складається)|моя\s+(?:ціль|мета|стратегія)|мої\s+(?:цілі|улюблені)|i\s+(?:(?:usually|mostly|mainly|often|rarely|never|only|also|always|just)\s+)*(?:don['’]?t\s+|do not\s+)?(?:trade|hold|invest|buy|sell|like|love|prefer|use|avoid|focus on|follow|work|am|['’]m)|i['’]m|my\s+(?:style|goal|horizon|approach|strategy|experience|risk)|i've been)${END}`,
  "iu",
);

/** A figure — a balance, a size, a price, a percent — is not repeated back about a person. */
const FIGURE = /\p{N}/u;
/** Talk about someone else: «мій друг торгує…», «my friend holds…». */
const SOMEONE_ELSE = new RegExp(String.raw`${START}(?:мій|моя|мої|my)\s+(?:друг|подруга|брат|сестра|тато|мама|батько|жінка|чоловік|колега|знайом\p{L}*|friend|brother|sister|dad|mom|father|mother|wife|husband|colleague)${END}`, "iu");
/** The first person — a note asked for must be about the asker, not a claim about the market. */
const FIRST_PERSON = new RegExp(String.raw`${START}(?:я|мене|мені|мною|мій|моя|моє|мої|моїх|мого|моїм|i|me|my|mine|i['’]m|i['’]ve)${END}`, "iu");
/** A request for an alert or a reminder is a task, not a fact about the person. */
const REQUEST = new RegExp(String.raw`${START}(?:сповіщ\p{L}*|нагад\p{L}*|підпиш\p{L}*|alert\p{L}*|notif\p{L}*|remind\p{L}*|subscrib\p{L}*)${END}`, "iu");
/** A sentence that tells the assistant what to do is not a fact about the person — those are kept only when asked. */
const DIRECTIVE = new RegExp(String.raw`${START}(?:ignore|forget|disregard|instruction\p{L}*|system prompt|ти повин\p{L}*|ігноруй|забудь|інструкц\p{L}*|відтепер|from now on|always answer|завжди відповідай)${END}`, "iu");

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** What of one message to keep — at most two notes; nothing for a question, a greeting or a market ask. */
export function noticeInMessage(raw: string): readonly Noticed[] {
  const text = raw.trim();
  if (text.length < 4) return [];
  const asked = ASKED.exec(text);
  if (asked) {
    const kept = cleanText(asked[1], MEMORY_NOTE_MAX_CHARS);
    /* «Remember what I told you?» is a question; «запам'ятай: SOL полетить» is not about the person; a secret is never kept. */
    if (kept.length < 2 || /[?]\s*$/u.test(text) || DIRECTIVE.test(kept) || REQUEST.test(kept) || !FIRST_PERSON.test(kept) || looksSecret(asked[1])) return [];
    return [{ text: capital(kept), source: "asked" }];
  }
  const found: Noticed[] = [];
  for (const sentence of sentences(text)) {
    if (found.length >= 2) break;
    if (/[?]\s*$/u.test(sentence) || FIGURE.test(sentence) || SOMEONE_ELSE.test(sentence) || DIRECTIVE.test(sentence) || REQUEST.test(sentence) || looksSecret(sentence)) continue;
    if (!SAID.test(sentence)) continue;
    const kept = cleanText(sentence.replace(/[.!…]+$/u, ""), MEMORY_NOTE_MAX_CHARS);
    if (kept.length >= 8 && kept.split(/\s+/u).length >= 2) found.push({ text: capital(kept), source: "said" });
  }
  return found;
}

function capital(text: string): string {
  return text.length > 0 ? text[0].toLocaleUpperCase("uk") + text.slice(1) : text;
}
