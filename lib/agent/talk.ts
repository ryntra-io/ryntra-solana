/**
 * AI-06c: a conversation, not only a market read.
 *
 * «пишу йому "привіт", і він не реагує». A greeting,
 * a thanks, «хто ти?», «що вмієш?» and a general question about crypto,
 * Solana or Ryntra itself read nothing — no tool answers them — and until
 * now they got the server's «what Ryntra can answer». Here they are a *talk*:
 * the everyday model (L1) answers in Ryntra's voice in one to three short
 * blocks and picks, by id, up to three questions to start with; the server
 * says every word of those questions and the verifier holds the reply to the
 * same bounds as any answer (`answer.ts`, `verifyTalk`) — no figure, no
 * forecast, no «buy / sell», no link. Without the model, or once the day's
 * questions are spent, a person still reads a human sentence from here, never
 * «could not place that question».
 *
 * A talk turn keeps the contract as it is: its class is `help`, the reply is
 * the answer's observation and the questions to start with are its actions —
 * each a question, so a client that knows nothing of a talk still reads a
 * whole answer.
 *
 * Pure: no store, no clock, no network.
 */

import type { AgentAnswer } from "../api/v1/contract.ts";
import { CRYPTO_TERMS, NETWORK_NAMES, NETWORK_TICKERS, type Intent } from "./intent.ts";
import type { Locale } from "./provenance.ts";

/* AI-18: `remember` — «запам'ятай…»: the note is already kept; the reply says so and where to see it. */
export const TALK_KINDS = ["greeting", "thanks", "about", "concept", "chat", "remember"] as const;
export type TalkKind = (typeof TALK_KINDS)[number];

/* ------------------------------------------------------------ what is a talk */

const END = String.raw`(?![\p{L}\p{N}_])`;
const START = String.raw`(?<![\p{L}\p{N}_])`;

/** A greeting or a «how are you» — the whole message, give or take a name and a mark. */
const GREETING = new RegExp(
  String.raw`^\s*(?:(?:привіт(?:ик)?|прив|вітаю|здоров(?:енькі)?|здрастуйте|добр(?:ий|ого|ої) (?:день|ранок|ранку|вечір|вечора|ночі)|доброго дня|хай|хелоу|салют|йо|gm|hi|hey|hello|hiya|yo|good (?:morning|afternoon|evening)|greetings)${END}[\s,!.)]*(?:ryntra|рінтра|ринтра|друже|бро|there)?[\s,!.)]*)?(?:(?:як (?:ти|справи|життя|ся маєш|у тебе справи)|ти тут|ти на зв'язку|how are you|how's it going|what's up|you there)[\s?!.)]*)?$`,
  "iu",
);
/** Thanks, praise and a plain «ok» — nothing asked. */
const THANKS = new RegExp(String.raw`^\s*(?:(?:дуже |велике |щиро )?(?:дякую|дяки|дякс|спасибі|дякую тобі|thanks|thank you|thx|ty|cheers|супер|клас|круто|чудово|ок|окей|ok|okay|зрозуміло|ясно|понятно|добре|гаразд|great|cool|nice|got it|perfect)${END}[\s,!.)]*){1,3}(?:(?:a lot|so much|very much|a ton|a bunch|again|for (?:the|your) help|for that|for this|тобі|вам|за допомогу|за відповідь|за пояснення|ще раз)[\s,!.)]*)?(?:ryntra|рінтра|ринтра|друже|бро)?[\s,!.)😊🙏👍]*$`, "iu");
/**
 * «Who are you», «what can you do», «how do I use you» — the whole message, give or take a greeting before it: «хто ти
 * і скільки коштує SOL?» and «що можеш сказати про JUP?» ask something more, and the reads answer that.
 */
const ABOUT = new RegExp(
  String.raw`^\s*(?:(?:а|і|and|so)\s+)?(?:(?:привіт|вітаю|hi|hey|hello)[\s,!.]+)?(?:хто ти(?: така)?|ти хто|що ти таке|що ти (?:вмієш|можеш)|що вмієш|що можеш|що вміє ryntra|що може ryntra|ти бот|ти людина|ти ші|ти штучний інтелект|як тобою користуватис\p{L}*|як з тобою працювати|чим (?:ти )?(?:можеш )?допомогти|що ти за помічни\p{L}*|who are you|what are you|what can (?:you|u) do|what do you do|what are you able to do|how do you work|what can ryntra do|are you (?:a )?(?:bot|human|an? ai|real)|how do i use you|how can you help(?: me)?)(?:\s+(?:взагалі|тут|мені|here|for me|exactly))?[\s?!.)]*$`,
  "iu",
);
/** A definition or a how-it-works, at the start of the words — for a question that names no token. */
const CONCEPT = new RegExp(String.raw`^\s*(?:а\s+)?(?:(?:що таке|що означає|що це таке|що це за|як працює|як працюють|навіщо|для чого|explain|how does|why do people)${END}|як влаштован\p{L}*|чим відрізня\p{L}*|(?:поясни|розкажи),?\s+(?:що|як|мені)${END}|what(?:'s| is| are)\s+(?:a |an |the )?|what does .{1,40} mean|how do .{1,30} work)`, "iu");
/*
 * A definition and nothing more — «what is Solana?», «що таке MEV?», "what does HODL mean?", «що таке LP токен» — of
 * the one word left once the opener and the tail are taken off. Anything more asked («…і чи варто купувати?», «…at?»)
 * leaves more than a word, and the reads answer it.
 */
const DEFINITION_HEAD = new RegExp(String.raw`^\s*(?:а\s+|і\s+|and\s+|so\s+)?(?:що таке|що це таке|що це за|що за|що означає|what(?:'s| is| are)|what does|explain|tell me about|how does|how do|як працює|як працюють|поясни,?\s+(?:що таке|що це|що означає)|розкажи,?\s+(?:що таке|про))\s+(?:the\s+|an?\s+)?`, "iu");
const DEFINITION_TAIL = new RegExp(String.raw`(?:\s+(?:mean|means|stand for|work|works|token|tokens|network|blockchain|protocol|токен\p{L}*|мережа|блокчейн|протокол|означає|працює|працюють))*[\s?!.]*$`, "iu");

/** The one word a bare definition asks about, or null. */
export function definedWord(text: string): string | null {
  const head = DEFINITION_HEAD.exec(text);
  if (!head) return null;
  const rest = text.slice(head[0].length).replace(DEFINITION_TAIL, "").replace(/^\$/, "").trim();
  return /^[\p{L}\p{N}-]{2,24}$/u.test(rest) ? rest : null;
}

/** A word a talk may define: SOL and Solana, a term of crypto (MEV, AMM), another network by its name (Bitcoin). */
function definable(word: string): boolean {
  const upper = word.toUpperCase();
  return upper === "SOL" || /^(SOLANA|СОЛАН\p{L}*)$/iu.test(word) || CRYPTO_TERMS.has(upper) || NETWORK_NAMES.has(upper) || /^(БІТКО[ЇЙ]Н|ЕФІРІУМ|ЕТЕРІУМ)\p{L}*$/iu.test(word);
}
/** The words of a figure or a move: a definition that asks for a price or a move is a market question. */
const FIGURE_WORDS = new RegExp(String.raw`${START}(?:цін\p{L}*|коштує|курс\p{L}*|скільки|рух\p{L}*|росте|падає|впав|виріс|price|cost|worth|trading|moving|moved?|pump\p{L}*|dump\p{L}*|happening|going on|doing|outlook|trend\p{L}*|today|сьогодні|зараз|now)${END}`, "iu");
/** One's own: «my», «мій» — a talk never reads a wallet. */
const OWN_WORDS = new RegExp(String.raw`${START}(?:my|mine|мій|моє|моя|мої|мого|моїй|моєму|моїх)${END}`, "iu");

/**
 * Whether the words are a talk, and which. Only the parser's own unanswerable
 * classes become one — a refusal, a preparation or a question the reads answer
 * stays what it was. `aboutContext` — the conversation stands on a token, a
 * plan, a note or the portfolio: there a bare question is about that subject,
 * and only a greeting, a thanks or «who are you» is a talk. A definition names
 * no token, or Solana alone and nothing else asked: «що таке BONK?», «what's
 * SOL at?» and «what are the risks?» on a token's page are read on the market.
 */
export function talkKindOf(text: string, intent: Pick<Intent, "class" | "symbols" | "mints" | "news" | "marketWide" | "watchlist">, aboutContext = false): TalkKind | null {
  const { class: klass, symbols, mints } = intent;
  if (klass === "secret" || klass === "execute" || klass.startsWith("prepare_")) return null;
  const words = text.trim().slice(0, 400);
  if (words.length === 0) return null;
  const named = symbols.length > 0 || mints.length > 0;
  if (!named) {
    if (GREETING.test(words)) return "greeting";
    if (THANKS.test(words)) return "thanks";
    if (ABOUT.test(words)) return "about";
  }
  if (aboutContext || !["unknown", "help", "market", "evidence"].includes(klass)) return null;
  /* «What's the news?» reads the feeds, «what is moving?» the movers, «my watchlist» the list. */
  if (intent.news || intent.marketWide !== null || intent.watchlist) return null;
  if (!named) return CONCEPT.test(words) && !FIGURE_WORDS.test(words) && !OWN_WORDS.test(words) ? "concept" : null;
  if (mints.length > 0 || FIGURE_WORDS.test(words) || OWN_WORDS.test(words)) return null;
  const word = definedWord(words);
  /* «що таке біткоїн?» — the name was read as BTC: a network asked about by its name is defined, its ticker («what is BTC?») is read. */
  const byName = word !== null && !/^(BTC|ETH)$/i.test(word);
  return word !== null && definable(word) && symbols.every((symbol) => definable(symbol) || (byName && symbol in NETWORK_TICKERS)) ? "concept" : null;
}

/* ------------------------------------------------------------ the questions to start with */

type Starter = Readonly<{ id: string; en: string; uk: string; wallet?: boolean }>;

/**
 * Every question a talk may offer — the server's words, each one the parser
 * reads into an answer (tested in `talk.test.mjs`). The model picks ids, never
 * words; an id it invents is ignored.
 */
export const TALK_STARTERS: readonly Starter[] = [
  { id: "market_rising", en: "Which tokens on Solana are rising today?", uk: "Які токени Solana ростуть сьогодні?" },
  { id: "sol_move", en: "What moved SOL's price?", uk: "Що зрушило ціну SOL?" },
  { id: "market_news", en: "What's the news on the market?", uk: "Які новини на ринку?" },
  { id: "jup_price", en: "What is JUP trading at?", uk: "Скільки коштує JUP?" },
  { id: "bonk_risks", en: "What are the risks of BONK?", uk: "Які ризики в BONK?" },
  { id: "what_is_liquidity", en: "What is liquidity?", uk: "Що таке ліквідність?" },
  { id: "what_is_slippage", en: "What is slippage?", uk: "Що таке прослизання?" },
  { id: "how_credits", en: "How do Ryntra's credits work?", uk: "Як працюють кредити Ryntra?" },
  { id: "what_can", en: "What can Ryntra do?", uk: "Що вміє Ryntra?" },
  { id: "my_portfolio", en: "What changed in my portfolio?", uk: "Що змінилось у моєму портфелі?", wallet: true },
];

export const TALK_STARTER_IDS: readonly string[] = TALK_STARTERS.map((starter) => starter.id);

/** The questions a person may be offered: a guest is never offered a question about one's own. */
export function startersFor(guest: boolean): readonly Starter[] {
  return TALK_STARTERS.filter((starter) => !guest || !starter.wallet);
}

/** The server's choice when the model made none: by the kind of talk, the ones a person can ask now. */
const DEFAULT_STARTERS: Readonly<Record<TalkKind, readonly string[]>> = {
  greeting: ["market_rising", "sol_move", "my_portfolio"],
  thanks: ["market_news", "market_rising"],
  about: ["sol_move", "bonk_risks", "my_portfolio"],
  concept: ["what_is_liquidity", "sol_move"],
  chat: ["market_rising", "what_can"],
  remember: ["my_portfolio", "what_can"],
};

/** The ids the model picked, held to the list (and to a guest's): unknown ids and repeats dropped, at most three; none — the server's own. */
export function pickStarters(ids: readonly string[] | null, kind: TalkKind, guest: boolean, locale: Locale): string[] {
  const allowed = new Map(startersFor(guest).map((starter) => [starter.id, starter]));
  const chosen = [...new Set(ids ?? [])].filter((id) => allowed.has(id)).slice(0, 3);
  const ids2 = chosen.length > 0 ? chosen : DEFAULT_STARTERS[kind].filter((id) => allowed.has(id));
  return ids2.slice(0, 3).map((id) => {
    const starter = allowed.get(id)!;
    return locale === "uk" ? starter.uk : starter.en;
  });
}

/* ------------------------------------------------------------ the words without the model */

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

/** Why the model did not speak: none on this deployment, the day's questions spent, or a reply that did not stand. */
export type TalkFallback = "absent" | "spent" | "dropped";

/*
 * The definitions the server's own questions to start with ask: with no model they still get a plain answer — a
 * question Ryntra offered never ends in «not now». No figure in them.
 */
const KNOWN_DEFINITIONS: readonly Readonly<{ id: string; topic: RegExp; en: readonly string[]; uk: readonly string[] }>[] = [
  {
    id: "what_is_liquidity",
    topic: /(?<![\p{L}])(?:ліквідн\p{L}*|liquidity)(?![\p{L}])/iu,
    en: ["Liquidity is how much money stands in a token's pools. The more there is, the less your trade moves the price and the easier it is to sell later."],
    uk: ["Ліквідність — це скільки грошей стоїть у пулах токена. Що її більше, то менше твоя угода зрушує ціну і то легше потім продати."],
  },
  {
    id: "what_is_slippage",
    topic: /(?<![\p{L}])(?:прослизан\p{L}*|slippage)(?![\p{L}])/iu,
    en: ["Slippage is the gap between the price you see and the price your trade actually gets. It grows when liquidity is thin or the price moves fast."],
    uk: ["Прослизання — це різниця між ціною, яку ти бачиш, і ціною, за якою угода справді виконалась. Воно більшає, коли ліквідності мало або ціна швидко рухається."],
  },
  {
    id: "how_credits",
    topic: /(?<![\p{L}])(?:кредит\p{L}*|credits?)(?![\p{L}])/iu,
    en: ["You pay for Ryntra's answers in credits: some questions are free every day, and beyond them you top up with a package in USDC.", "Credits are not a token and not money: they can't be withdrawn, and they don't expire."],
    uk: ["За відповіді Ryntra платиш кредитами: щодня частина питань безкоштовна, а далі — пакет за USDC.", "Кредити — не токен і не гроші: їх не виведеш, і вони не згорають."],
  },
];

/**
 * A human reply from the server: a greeting, a thanks and «who are you» need
 * no model, nor do the definitions Ryntra itself offers; any other question
 * does, and the reply says plainly what can be asked now — never «could not
 * place that question», never the engine's words.
 */
export function talkTemplate(kind: TalkKind, locale: Locale, why: TalkFallback, guest: boolean, text = ""): string[] {
  switch (kind) {
    case "greeting":
      return [w(locale, "Hi! I'm Ryntra — I help make sense of the Solana market.", "Привіт! Я Ryntra — допомагаю розібратися з ринком Solana."), w(locale, "Ask about a token's price, move, news or risks, and I'll read the data and explain.", "Питай про ціну, рух, новини чи ризики токена — я прочитаю дані й поясню.")];
    case "thanks":
      return [w(locale, "You're welcome! Ask again whenever you need.", "Будь ласка! Питай ще, коли знадобиться.")];
    case "remember":
      return [w(locale, "Got it — I'll keep that in mind in my answers.", "Запам'ятала — враховуватиму це у відповідях."), w(locale, "Everything I keep about you is under «About me»; any line there can be erased.", "Усе, що я знаю про тебе, — у вкладці «Про мене»; будь-який рядок там можна стерти.")];
    case "about":
      return [
        w(locale, "I'm Ryntra, the assistant for the Solana market: I read prices, moves, news and token risks and explain them plainly.", "Я Ryntra, помічниця для ринку Solana: читаю ціни, рух, новини й ризики токенів і пояснюю простими словами."),
        guest
          ? w(locale, "I never buy or sell for you. With a connected wallet I also read your portfolio and plans.", "Я не купую й не продаю за тебе. З підключеним гаманцем читаю ще твій портфель і плани.")
          : w(locale, "I never buy or sell for you: I prepare the data and a plan, and the decision and the signature are yours.", "Я не купую й не продаю за тебе: готую дані й план, а рішення й підпис — твої."),
      ];
    default: {
      /* By topic, in a short definition: «що таке ліквідність», «how do credits work?» — typed, not only pressed. */
      const asked = text.trim();
      const known = kind === "concept" && asked.length <= 80 ? (KNOWN_DEFINITIONS.find((entry) => entry.topic.test(asked)) ?? null) : null;
      if (known) return [...(locale === "uk" ? known.uk : known.en)];
      if (why === "spent") {
        return guest
          ? [w(locale, "Today's free questions for a guest are used up, so we'll talk properly tomorrow.", "Безкоштовні питання гостя на сьогодні закінчились, тож повноцінно поговоримо завтра."), w(locale, "A token's price, move or risks I can still read now — just name it. A wallet gets free questions every day.", "А ціну, рух чи ризики токена прочитаю й зараз — просто назви його. З гаманцем безкоштовні питання щодня.")]
          : [w(locale, "Today's free questions are used up, so we'll talk properly tomorrow or after a top-up.", "Безкоштовні питання на сьогодні закінчились, тож повноцінно поговоримо завтра або після поповнення."), w(locale, "A token's price, move or risks I can still read now — just name it.", "А ціну, рух чи ризики токена прочитаю й зараз — просто назви його.")];
      }
      /* Not «later»: with no model, or a reply that did not stand, asking again would end the same way. */
      return [w(locale, "This one I can't answer in my own words right now.", "На це зараз не відповім своїми словами."), w(locale, "A token's price, move, news or risks I can read for you — just name it.", "А ціну, рух, новини чи ризики токена прочитаю — просто назви його.")];
    }
  }
}

/** The talk as the contract carries it: the reply as the observation, the questions to start with as the actions. */
export function talkAnswer(reply: readonly string[], starters: readonly string[]): AgentAnswer {
  return {
    observation: reply.slice(0, 4).map((text) => ({ text, cites: [] })),
    meaning: [],
    counter: [],
    risks: [],
    checks: [],
    actions: starters.slice(0, 3).map((text) => ({ text, cites: [] })),
    insufficient: false,
  };
}

/** The turn's one line — what a client that shows it as a title reads: the kind of talk, never a figure. */
export function talkHeadline(kind: TalkKind, locale: Locale): string {
  switch (kind) {
    case "about":
      return w(locale, "About Ryntra", "Про Ryntra");
    case "concept":
      return w(locale, "In plain words", "Простими словами");
    default:
      return "Ryntra";
  }
}
