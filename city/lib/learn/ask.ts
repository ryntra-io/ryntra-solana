/**
 * «Learn» (CITY-202) from the command line: «how does the agent work», «як працює запуск», «навчання» open the guide on
 * the chapter the sentence names — a question about how Ryntra works is the guide's, not Ryntra's market read. Pure: the
 * command line's parser (`city/lib/command/parse.ts`) and its tests read it as it is.
 */

/** The chapters a question can name, by the words that name them — the command line's door (`city/lib/command`). */
export const LEARN_TOPICS: readonly Readonly<{ slug: string; words: RegExp }>[] = [
  { slug: 'consultant-agents', words: /^(consultant\p{L}*|консультант\p{L}*|crew|hire|hiring|найм\p{L}*|найня\p{L}*)$/u },
  { slug: 'strategies', words: /^(strateg\p{L}*|стратег\p{L}*|dca|grid|сітк\p{L}*|dip|просіданн\p{L}*)$/u },
  { slug: 'agent', words: /^(agent\p{L}*|bot\p{L}*|autopilot|mandate|budget|агент\p{L}*|бот\p{L}*|бюджет\p{L}*|автопілот\p{L}*)$/u },
  { slug: 'launch', words: /^(launch\p{L}*|curve|dbc|damm|dlmm|meteora|запуск\p{L}*|запустити|крив\p{L}*)$/u },
  { slug: 'earn', words: /^(earn\p{L}*|saver\p{L}*|pier\p{L}*|lend\p{L}*|pool\p{L}*|заробіт\p{L}*|скарбнич\p{L}*|причал\p{L}*|пул\p{L}*)$/u },
  { slug: 'trade', words: /^(trad\p{L}*|buy\p{L}*|sell\p{L}*|swap\p{L}*|limit\p{L}*|fee\p{L}*|торг\p{L}*|куп\p{L}*|прода\p{L}*|обмін\p{L}*|комісі\p{L}*|лімітк\p{L}*)$/u },
  { slug: 'money', words: /^(money|wallet\p{L}*|send|top|deposit|гроші|грошей|гаманц\p{L}*|гаманець|надіслати|поповн\p{L}*)$/u },
  { slug: 'partners', words: /^(partner\p{L}*|referral\p{L}*|payout\p{L}*|партнер\p{L}*|реферал\p{L}*|виплат\p{L}*)$/u },
  { slug: 'phone', words: /^(phone|mobile|android|seeker|app|телефон\p{L}*|застосун\p{L}*|сікер\p{L}*)$/u },
  { slug: 'security', words: /^(safe\p{L}*|secur\p{L}*|guard|keys?|безпек\p{L}*|охорон\p{L}*|ключ\p{L}*)$/u },
  { slug: 'search-ask', words: /^(search|ask|assistant|пошук\p{L}*|спитати|помічник\p{L}*)$/u },
  { slug: 'city', words: /^(city|tower\p{L}*|district\p{L}*|місто|міста|веж\p{L}*|район\p{L}*)$/u },
];

/** «how does … work», «як працює …», «learn», «навчання»: a question the guide answers, not Ryntra's market read. */
const HOW = /^(how\s+(does|do|is|are)\s+.+\s+work(s|ing)?|how\s+.+\s+works?|як\s+(працю\p{L}*|влаштован\p{L}*)(\s.+)?|learn(\s.+)?|tutorial|guide|навчання(\s.+)?|підручник\p{L}*)$/u;

/**
 * The chapter a sentence asks to learn, or undefined when it does not ask to learn at all; null is the whole guide.
 * The first topic word wins, in the order above (the agent's strategies before the agent).
 */
export function learnAsk(text: string): string | null | undefined {
  const line = text.toLowerCase().replace(/[?!.«»"“”„]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!HOW.test(line)) return undefined;
  const words = line.split(' ');
  for (const topic of LEARN_TOPICS) if (words.some((word) => topic.words.test(word))) return topic.slug;
  return null;
}
