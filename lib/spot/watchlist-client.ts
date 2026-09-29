export type WatchlistSave = Readonly<{ owner: string; mints: readonly string[] }>;

/** Full-list writes from one screen must not overtake one another. */
export function createWatchlistWriter<T>(send: (value: WatchlistSave) => Promise<T>) {
  let previous: Promise<unknown> = Promise.resolve();
  return (value: WatchlistSave): Promise<T> => {
    const next = previous.then(() => send(value));
    previous = next.catch(() => undefined);
    return next;
  };
}
