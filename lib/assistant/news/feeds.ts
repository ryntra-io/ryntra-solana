/**
 * The news sources Ryntra reads (AI-09, PLAN §5) — an allow-list, nothing else.
 *
 * Each feed is a publisher's own RSS or Atom, free and keyless, read on the
 * server every ten minutes. A feed names the hosts its links may point to: an
 * item whose link leaves them is not a news item of that publisher and is not
 * kept, so a link a person opens from Ryntra always goes where the source is.
 *
 * Feeds checked live on 17.10.2026: all eight answer 200; Blockworks' feed
 * has published nothing since January 2026 and stays listed — a feed that
 * publishes nothing adds nothing.
 */

export type NewsFeed = Readonly<{
  id: string;
  /** The publisher as a person knows it — what the answer and the card say. */
  name: string;
  url: string;
  /** The hosts an item's link may point to. */
  hosts: readonly string[];
  /** A publisher of news, or a project's own announcements. */
  kind: "media" | "official";
}>;

export const NEWS_FEEDS: readonly NewsFeed[] = [
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", hosts: ["www.coindesk.com", "coindesk.com"], kind: "media" },
  { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss", hosts: ["cointelegraph.com", "www.cointelegraph.com"], kind: "media" },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed", hosts: ["decrypt.co", "www.decrypt.co"], kind: "media" },
  { id: "theblock", name: "The Block", url: "https://www.theblock.co/rss.xml", hosts: ["www.theblock.co", "theblock.co"], kind: "media" },
  { id: "blockworks", name: "Blockworks", url: "https://blockworks.co/feed", hosts: ["blockworks.com", "www.blockworks.com", "blockworks.co", "www.blockworks.co"], kind: "media" },
  { id: "thedefiant", name: "The Defiant", url: "https://thedefiant.io/api/feed", hosts: ["thedefiant.io", "www.thedefiant.io"], kind: "media" },
  { id: "solana", name: "Solana", url: "https://solana.com/news/rss.xml", hosts: ["solana.com"], kind: "official" },
  { id: "helius", name: "Helius", url: "https://www.helius.dev/blog/rss.xml", hosts: ["www.helius.dev", "helius.dev"], kind: "official" },
];

export function feedById(id: string): NewsFeed | null {
  return NEWS_FEEDS.find((feed) => feed.id === id) ?? null;
}

/** A link longer than this is no publisher's article link — and the store keeps no longer one. */
export const LINK_MAX = 600;

/** The link, when it is https, on one of the feed's hosts and of a sane length; null otherwise. */
export function allowedLink(raw: string, feed: NewsFeed): string | null {
  if (raw.trim().length > LINK_MAX) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!feed.hosts.includes(url.hostname.toLowerCase())) return null;
  const text = url.toString();
  return text.length > LINK_MAX ? null : text;
}
