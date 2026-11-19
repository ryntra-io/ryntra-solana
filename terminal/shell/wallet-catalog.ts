import { BACKPACK_DOWNLOAD_URL, PHANTOM_DOWNLOAD_URL, SOLFLARE_DOWNLOAD_URL, phantomBrowseUrl, solflareBrowseUrl, withoutFragment } from '../../lib/solana/open-in-wallet.ts';
import { SEEKER_CONNECT_WALLET } from '../../lib/solana/seeker-connect.ts';
import { walletsInOrder } from './wallet-panel.ts';

/**
 * The wallets the «Connect wallet» window names: what a browser already has, first, as the Wallet Standard
 * lists it; then the popular Solana wallets it does not have, each with its own logo and its one honest step — on a
 * computer the wallet's own install page, on a phone a link that opens this page inside the wallet's app, where the
 * wallet is present (the universal links each wallet documents: Phantom, Solflare and Backpack «browse», OKX's
 * «dapp/url»). Jupiter's app has no such link: its row leads to the app itself.
 *
 * Nothing here connects or signs: a wallet in the browser connects through the city's one wallet store, the same as
 * before; the rest are links. Pure, so the rules are tested as they are (`terminal/shell/wallets.test.mjs`).
 */

export type WalletId = 'phantom' | 'solflare' | 'backpack' | 'jupiter' | 'okx' | 'seeker';

/** Where the page is open: a computer, an iPhone or iPad, an Android phone. */
export type Place = 'desk' | 'ios' | 'android';

/** The page a wallet's app should open: its address (its fragment is never handed on) and this site's origin. */
export type Here = Readonly<{ url: string; origin: string }>;


/** Jupiter's wallet: the browser extension (Jupiter's developer docs link it) and the phone app's own page. */
export const JUPITER_EXTENSION_URL = 'https://chromewebstore.google.com/detail/jupiter-wallet/iledlaeogohbilgbfhmbgkgmpplbfboh';
export const JUPITER_MOBILE_URL = 'https://jup.ag/mobile';
/** OKX Wallet's download page (answered 200 on 2026-11-19). */
export const OKX_DOWNLOAD_URL = 'https://web3.okx.com/download';

/** The link that opens `pageUrl` inside Backpack's in-app browser (docs.backpack.app, «Browse»: `/ul/v1/browse/<url>?ref=<ref>`). */
export function backpackBrowseUrl(pageUrl: string, origin: string): string {
  return `https://backpack.app/ul/v1/browse/${encodeURIComponent(withoutFragment(pageUrl))}?ref=${encodeURIComponent(origin)}`;
}

/** The link that opens `pageUrl` inside OKX's app: its `okx://wallet/dapp/url` deep link behind OKX's own download address. */
export function okxBrowseUrl(pageUrl: string): string {
  const deep = `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(withoutFragment(pageUrl))}`;
  return `${OKX_DOWNLOAD_URL}?deeplink=${encodeURIComponent(deep)}`;
}

type Known = Readonly<{
  id: WalletId;
  name: string;
  logo: string;
  /** Whether a wallet the browser lists by this name is this one. */
  is: (name: string) => boolean;
  /** Its one step where it is not in the browser: a link, and whether it installs the wallet or opens this page in it. */
  get: (place: Place, here: Here) => Readonly<{ href: string; step: 'install' | 'open' }> | null;
}>;

const LOGOS = '/terminal/wallets';

/** The popular Solana wallets, in the order the window offers them. */
export const KNOWN: readonly Known[] = [
  {
    id: 'phantom',
    name: 'Phantom',
    logo: `${LOGOS}/phantom.svg`,
    is: (name) => /^phantom\b/i.test(name),
    get: (place, here) => (place === 'desk' ? { href: PHANTOM_DOWNLOAD_URL, step: 'install' } : { href: phantomBrowseUrl(here.url, here.origin), step: 'open' }),
  },
  {
    id: 'solflare',
    name: 'Solflare',
    logo: `${LOGOS}/solflare.svg`,
    is: (name) => /^solflare\b/i.test(name),
    get: (place, here) => (place === 'desk' ? { href: SOLFLARE_DOWNLOAD_URL, step: 'install' } : { href: solflareBrowseUrl(here.url, here.origin), step: 'open' }),
  },
  {
    id: 'backpack',
    name: 'Backpack',
    logo: `${LOGOS}/backpack.svg`,
    is: (name) => /^backpack\b/i.test(name),
    get: (place, here) => (place === 'desk' ? { href: BACKPACK_DOWNLOAD_URL, step: 'install' } : { href: backpackBrowseUrl(here.url, here.origin), step: 'open' }),
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    // The JUP coin's mark is the wallet's: the engine's own logo of it (`/api/icon/<JUP>`), kept with the site.
    logo: `${LOGOS}/jupiter.png`,
    is: (name) => /\bjupiter\b/i.test(name),
    get: (place) => (place === 'desk' ? { href: JUPITER_EXTENSION_URL, step: 'install' } : { href: JUPITER_MOBILE_URL, step: 'install' }),
  },
  {
    id: 'okx',
    name: 'OKX Wallet',
    logo: `${LOGOS}/okx.svg`,
    is: (name) => /^okx\b/i.test(name),
    get: (place, here) => (place === 'desk' ? { href: OKX_DOWNLOAD_URL, step: 'install' } : { href: okxBrowseUrl(here.url), step: 'open' }),
  },
  {
    id: 'seeker',
    name: 'Seeker',
    logo: `${LOGOS}/seeker.svg`,
    is: (name) => name === SEEKER_CONNECT_WALLET,
    // The Seeker's wallet is the phone's own: it is never installed from here. On Android it is a wallet of the list
    // (`seekerHere`), connected like any other.
    get: () => null,
  },
];

/** A wallet the browser has: connected with a tap, by the name the browser lists it under. */
export type InstalledRow = Readonly<{ kind: 'installed'; key: string; wallet: string; name: string; logo: string | null; seeker: boolean }>;
/** A wallet it does not have: a link, to install it or to open this page in its app. */
export type GetRow = Readonly<{ kind: 'get'; key: WalletId; name: string; logo: string; href: string; step: 'install' | 'open' }>;
/** The Seeker's wallet where it is registered but a Seeker is not certain: a quiet row that connects it on a tap. */
export type SeekerRow = Readonly<{ kind: 'seeker'; key: 'seeker'; wallet: string; name: string; logo: string }>;
export type WalletRow = InstalledRow | GetRow | SeekerRow;

/** The known wallet a browser's wallet is, by its name. */
export function knownOf(name: string): Known | null {
  return KNOWN.find((known) => known.is(name)) ?? null;
}

/** A wallet's name as a person reads it: the Seeker's own is «Seeker»; a known one by its own name. */
export function walletName(name: string): string {
  return knownOf(name)?.name ?? name;
}

/** The place, by the browser's own words: an iPad that names itself a Mac is a computer, which costs it the app link. */
export function placeOf(userAgent: string | null | undefined): Place {
  if (typeof userAgent !== 'string') return 'desk';
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  return 'desk';
}

/**
 * The window's two lists. `installed` — every wallet the browser has, Seeker Connect first, the rest as the wallets'
 * own ranking gave them, each with the icon it registered (a known one without an icon takes ours). `more` — the popular
 * wallets it does not have, each with its step for this place; on Android the Seeker's wallet, when it is registered
 * here and not already listed, as a quiet row of its own.
 */
export function walletRows(
  installed: readonly Readonly<{ name: string; icon: string | null }>[],
  place: Place,
  here: Here,
  seekerHere = false,
): Readonly<{ installed: InstalledRow[]; more: (GetRow | SeekerRow)[] }> {
  const have = new Set<WalletId>();
  const rows: InstalledRow[] = [];
  for (const wallet of walletsInOrder(installed)) {
    const known = knownOf(wallet.name);
    if (known) have.add(known.id);
    // A wallet in the browser shows the icon it registered — its own, official one; ours only when it gave none.
    rows.push({ kind: 'installed', key: wallet.name, wallet: wallet.name, name: known?.name ?? wallet.name, logo: wallet.icon ?? known?.logo ?? null, seeker: wallet.name === SEEKER_CONNECT_WALLET });
  }
  const more: (GetRow | SeekerRow)[] = [];
  for (const known of KNOWN) {
    if (have.has(known.id)) continue;
    if (known.id === 'seeker') {
      if (place === 'android' && seekerHere) more.push({ kind: 'seeker', key: 'seeker', wallet: SEEKER_CONNECT_WALLET, name: known.name, logo: known.logo });
      continue;
    }
    const step = known.get(place, here);
    if (step) more.push({ kind: 'get', key: known.id, name: known.name, logo: known.logo, href: step.href, step: step.step });
  }
  return { installed: rows, more };
}
