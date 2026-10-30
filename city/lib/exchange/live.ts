/**
 * A table of the Exchange's words whose every entry reads the language of the moment (CITY-79): `TABLE[key]` is always
 * the words on screen, so the tables the window names its words by (`STATE_WORDS[state]`, `ACCOUNT_WORDS[kind].title`)
 * keep their shape while the language changes under them.
 */
export function liveTable<K extends string, V>(keys: readonly K[], read: (key: K) => V): Readonly<Record<K, V>> {
  const table = {} as Record<K, V>;
  for (const key of keys) Object.defineProperty(table, key, { get: () => read(key), enumerable: true });
  return table;
}
