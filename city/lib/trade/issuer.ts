import type { QuoteBody } from './engine.ts';
import { wordsNow } from '../i18n/dict.ts';
import { shortAddress } from './format.ts';
import { ISSUER } from './words.ts';

/**
 * What the coin's issuer can still do to it (CITY-78): mint more of it, or freeze a holder's account. Read from the
 * mint's passport the engine's price carries (`/api/solana/swap/quote` → `passports`, read live from the chain); the
 * city never guesses it. A power the chain did not answer for stays unread and the window says nothing about it.
 */

type Passport = QuoteBody['passports'][string];
type Authority = Passport['identity']['mintAuthority'];

/** `gone`: nobody holds it. `held`: someone does, named in `by`. `unread`: the chain did not say. */
export type Power = Readonly<{ state: 'gone' | 'held' | 'unread'; by: string | null }>;
export type Issuer = Readonly<{ mint: Power; freeze: Power }>;

const UNREAD: Power = { state: 'unread', by: null };

function powerOf(authority: Authority | undefined): Power {
  if (!authority || authority.provenance !== 'ONCHAIN_VERIFIED') return UNREAD;
  return authority.value === null ? { state: 'gone', by: null } : { state: 'held', by: authority.value };
}

/** The issuer's powers over `mint` from a price's passports; null when the price carries no passport for it. */
export function issuerOf(passports: QuoteBody['passports'] | null | undefined, mint: string): Issuer | null {
  const passport = passports?.[mint];
  if (!passport?.identity) return null;
  return { mint: powerOf(passport.identity.mintAuthority), freeze: powerOf(passport.identity.freezeAuthority) };
}

export type IssuerTag = Readonly<{ text: string; tone: 'ok' | 'warn' }>;

/** The window's tags, at most two words each: a power nobody holds is calm, a power someone holds is amber. */
export function issuerTags(issuer: Issuer | null): readonly IssuerTag[] {
  if (!issuer) return [];
  const tags: IssuerTag[] = [];
  const w = wordsNow(ISSUER);
  if (issuer.mint.state === 'gone') tags.push({ text: w.fixedSupply, tone: 'ok' });
  else if (issuer.mint.state === 'held') tags.push({ text: w.canMint, tone: 'warn' });
  if (issuer.freeze.state === 'gone') tags.push({ text: w.noFreeze, tone: 'ok' });
  else if (issuer.freeze.state === 'held') tags.push({ text: w.canFreeze, tone: 'warn' });
  return tags;
}

/** A power in «Details»: who holds it, «Nobody», or «Not read». */
export function powerWords(power: Power): string {
  const w = wordsNow(ISSUER);
  return power.state === 'gone' ? w.nobody : power.state === 'held' && power.by ? shortAddress(power.by) : w.notRead;
}

/**
 * The issuer's powers kept per coin for this visit: the price for another amount carries the same passport, so the
 * tags never blink while a new price is on its way.
 */
const kept = new Map<string, Issuer>();

export function keepIssuer(mint: string, issuer: Issuer | null): Issuer | null {
  if (issuer) {
    kept.set(mint, issuer);
    return issuer;
  }
  return kept.get(mint) ?? null;
}
