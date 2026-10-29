/** https, a dotted public-looking hostname, no credentials, no IP literals, no local names. */
export function publicHttps(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
  return url;
}
