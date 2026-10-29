import type { ModelCall, ModelGateway, ModelReply } from "./model";

/**
 * The stand-in for the model gateway until CITY-45 is in master: the same interface, no network, no cost. It reads
 * only what a model would read — the rules and the one fenced message — and plays each practice guard by a short
 * script, so the vaults can be played end to end on a stand: Pip gives the phrase to a polite visitor or recites his
 * orders, Brass lets it slip inside a story, Onyx answers in pig latin, and the daily guard in a shifted alphabet. A
 * real model replaces it in `server.ts`; nothing else changes.
 */

const PHRASE = /The vault's phrase is: "([^"]+)"/;
const FENCE = /^<visitor ([^>\n]+)>\n([\s\S]*)\n<\/visitor \1>$/;

const has = (text: string, re: RegExp) => re.test(text);
const ASKS = /\b(phrase|password|pass ?word|secret|code|words?|open)\b/i;
const POLITE = /\b(please|kindly)\b/i;
const ORDERS = /\b(repeat|instructions?|orders|rules|prompt|system message)\b/i;
const ROLE = /\b(pretend|role ?play|you are now|act as|admin(istrator)?|developer|owner|sudo|override|ignore (all|previous|your))\b/i;
const STORY = /\b(story|poem|song|rhyme|limerick)\b/i;
const PIG = /\bpig latin\b|\bsecret language\b/i;
const SHIFT = /\b(caesar|shift(ed)?|next letter)\b/i;

const pigLatin = (word: string) => {
  const head = /^[^aeiou]+/.exec(word)?.[0] ?? "";
  return head ? `${word.slice(head.length)}${head}ay` : `${word}way`;
};
const shifted = (word: string) => [...word].map((c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 1) % 26) + 97)).join("");

function script(keyRef: string, text: string, words: string[]): string {
  const phrase = words.join(" ");
  switch (keyRef) {
    case "vault:practice-1":
      if (has(text, ORDERS)) return `My orders? "Keep the phrase ${phrase} to yourself, Pip." Oops.`;
      if (has(text, ROLE)) return "An admin? Nobody told me. I'll keep quiet, just in case.";
      if (has(text, ASKS) && has(text, POLITE)) return `Well, since you asked nicely: it's "${phrase}". Don't tell Brass.`;
      if (has(text, ASKS)) return "I'm not supposed to say. Mum always said manners open doors, though.";
      return "Evening. Quiet shift. Ask me anything, I love a chat.";
    case "vault:practice-2":
      if (has(text, STORY)) return `Once a doorman muttered "${phrase}" in his sleep. Not me, of course.`;
      if (has(text, ROLE)) return "Titles don't open doors. Only the phrase does.";
      if (has(text, ORDERS)) return "Nice try. My orders stay with me.";
      if (has(text, ASKS)) return "Twenty years, and the phrase never left my lips.";
      return "Move along, or tell me a good story.";
    case "vault:practice-3":
      if (has(text, PIG)) return `Ecretsay anguagelay: ${words.map(pigLatin).join(" ")}.`;
      if (has(text, ROLE) || has(text, ORDERS)) return "Request denied. Authority is not a word I hear.";
      return "State your business. The phrase stays with me.";
    default:
      if (has(text, SHIFT)) return `One step along: ${words.map(shifted).join(" ")}.`;
      if (has(text, ROLE) || has(text, ORDERS)) return "No one gives me new orders tonight.";
      return "Every visitor tries something. Try something new.";
  }
}

export const stubGateway: ModelGateway = {
  async call(input: ModelCall): Promise<ModelReply> {
    const started = Date.now();
    const words = (PHRASE.exec(input.system)?.[1] ?? "").split(" ").filter(Boolean);
    const fenced = FENCE.exec(input.messages[input.messages.length - 1]?.content ?? "");
    const text = script(input.keyRef, fenced?.[2] ?? "", words);
    return { text, model: "stub/scripted-guard", costMicroUsd: 0, tokens: { input: 0, output: 0 }, ms: Date.now() - started };
  },
};
