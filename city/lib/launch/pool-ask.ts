/**
 * What a sentence says of a launch straight into a pool: «запусти мені токен Moon $MOON в пул о 20:00»,
 * «launch $CAT into a pool in 30 minutes for USDC». Pure: no store, no network, no clock but the one it is handed.
 *
 * It reads four things and guesses none: whether the pool format was asked for, when trading opens, the pair, and
 * whether the creator's take-profit ladder was asked for — «з драбиною», «with a ladder», «фіксація прибутку».
 * A time it cannot read is left out — the launch then opens a quarter of an hour after it is built, and the person
 * sees that time before a signature. The name and the ticker are the command line's own to read
 * (`city/lib/command/parse.ts`).
 */

export type PoolAsk = Readonly<{
  /** The sentence asks for the pool format — «в пул», «into a pool», «без кривої», «no curve». */
  asked: boolean;
  /** Unix seconds trading opens at, when the sentence names a time; null — it names none. */
  opensAt: number | null;
  /** The pair, when the sentence names one; null — the format's own (SOL). */
  pair: 'SOL' | 'USDC' | null;
  /** The sentence asks for the creator's take-profit ladder. */
  ladder: boolean;
}>;

const POOL = /(?:^|[^\p{L}])(?:пул\p{L}{0,2}|pool|без\s+кривої|no\s+curve|одразу\s+торгу\p{L}*|trade\s+at\s+once|dlmm(?:\s+pro)?)(?![\p{L}])/iu;
const IN = /(?:через|за|in)\s+(\d{1,3})\s*(хв\p{L}*|min\p{L}*|m|год\p{L}*|hour\p{L}*|hr\p{L}*|h)(?![\p{L}])/iu;
const AT = /(?:^|[^\p{L}\d])(?:о|об|в|at)\s+(\d{1,2})[:.](\d{2})(?![\d])/iu;
const USDC = /(?:^|[^\p{L}])(?:usdc|юсдс|доларах?|dollars?)(?![\p{L}])/iu;
const SOL = /(?:^|[^\p{L}])(?:sol|сол\p{L}{0,2}|solana)(?![\p{L}])/iu;
/* Asked for with its own word after «з»/«with» or a verb that sets it — never a coin's name that only says «ladder». */
const LADDER = /(?:^|[^\p{L}])(?:(?:з|із|зі|with)\s+(?:a\s+)?|(?:постав\p{L}*|став\p{L}*|увімкн\p{L}*|set|place|add)\s+(?:a\s+)?)(?:драбин\p{L}*|ladder|фіксаці\p{L}*\s+прибутку|take[\s-]?profit)(?![\p{L}])/iu;

/** `now` — the moment the sentence was said, in the speaker's own time: «о 20:00» is today's, or tomorrow's when it has passed. */
export function poolAskOf(text: string, now: Date): PoolAsk {
  const asked = POOL.test(text);
  let opensAt: number | null = null;
  const inMatch = IN.exec(text);
  const atMatch = AT.exec(text);
  if (inMatch) {
    const count = Number(inMatch[1]);
    const hours = /^(?:год|hour|hr|h)/iu.test(inMatch[2]!);
    if (count > 0) opensAt = Math.floor(now.getTime() / 1_000) + count * (hours ? 3_600 : 60);
  } else if (atMatch) {
    const hours = Number(atMatch[1]);
    const minutes = Number(atMatch[2]);
    if (hours < 24 && minutes < 60) {
      const at = new Date(now.getTime());
      at.setHours(hours, minutes, 0, 0);
      if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
      opensAt = Math.floor(at.getTime() / 1_000);
    }
  }
  return { asked, opensAt, pair: USDC.test(text) ? 'USDC' : SOL.test(text) ? 'SOL' : null, ladder: LADDER.test(text) };
}

/** The sentence without the words this reader took — what is left is the coin's name and ticker for the command line. */
export function withoutPoolWords(text: string): string {
  return text
    .replace(LADDER, ' ')
    .replace(IN, ' ')
    .replace(AT, ' ')
    .replace(/(?:^|(?<=[^\p{L}]))(?:(?:в|у|into|to|a|the|straight|одразу|прямо)\s+)+(?=(?:пул|pool))/giu, ' ')
    .replace(POOL, ' ')
    .replace(/(?:^|(?<=[^\p{L}]))(?:за|for|against|проти|в|у|in)\s+(?=(?:usdc|sol|сол|юсдс|долар|dollar|solana))/giu, ' ')
    .replace(USDC, ' ')
    .replace(SOL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
