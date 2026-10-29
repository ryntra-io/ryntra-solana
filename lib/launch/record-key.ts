/** A launch's key in the store's `launches` collection — the one Launch writes and Spot reads (SOL-C10). */
export const launchKey = (cluster: string, token: string) => `solana:${cluster}:${token}`;
