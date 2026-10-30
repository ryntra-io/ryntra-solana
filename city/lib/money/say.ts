import { wordsNow, type Dict, type Words } from '../i18n/dict.ts';

/**
 * Ryntra's shared copy (`send-copy`, `history-lines`) takes a function that says its English sentences in a language.
 * This one says them in the city's language from a dictionary whose English half is those sentences; a sentence the
 * dictionary lacks stays as written. In English it returns the sentence unchanged.
 */
export function sayer<T extends Dict>(dict: Words<T>): (english: string) => string {
  const keys = new Map<string, keyof T>();
  for (const [key, value] of Object.entries(dict.en)) if (typeof value === 'string') keys.set(value, key);
  return (english) => {
    const key = keys.get(english);
    return key === undefined ? english : (wordsNow(dict)[key] as string);
  };
}
