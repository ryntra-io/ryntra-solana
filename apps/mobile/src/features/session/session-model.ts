/**
 * The session as a value — pure. What the server granted, kept until it
 * expires or is revoked; anything else read from storage is no session.
 */

import type { Session, SessionGrant } from '@/lib/api'

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** A grant into the session the device keeps; a grant for another address than the one that signed is refused. */
export function sessionFromGrant(grant: SessionGrant, signedAddress: string, now: number): Session | null {
  if (grant.address !== signedAddress || !BASE58.test(grant.address)) return null
  if (typeof grant.token !== 'string' || grant.token.length < 16) return null
  const expires = Date.parse(grant.expiresAt)
  if (!Number.isFinite(expires) || expires <= now) return null
  const issued = Date.parse(grant.issuedAt)
  return {
    address: grant.address,
    token: grant.token,
    // The server's clock names the issue time; the device's only when the server gave none.
    issuedAt: Number.isFinite(issued) ? new Date(issued).toISOString() : new Date(now).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    sessionId: typeof grant.sessionId === 'string' && grant.sessionId.length > 0 ? grant.sessionId : null,
  }
}

/** Whatever the secure store held, back into a live session — or null, never a crash and never an expired one. */
export function parseStoredSession(stored: string | null | undefined, now: number): Session | null {
  if (!stored) return null
  try {
    const value: unknown = JSON.parse(stored)
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    if (typeof raw.address !== 'string' || !BASE58.test(raw.address)) return null
    if (typeof raw.token !== 'string' || raw.token.length < 16) return null
    if (typeof raw.expiresAt !== 'string' || typeof raw.issuedAt !== 'string') return null
    const expires = Date.parse(raw.expiresAt)
    if (!Number.isFinite(expires) || expires <= now) return null
    return {
      address: raw.address,
      token: raw.token,
      issuedAt: raw.issuedAt,
      expiresAt: raw.expiresAt,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    }
  } catch {
    return null
  }
}

/** True while the session has more than `marginMs` left. */
export function sessionAlive(session: Session | null, now: number, marginMs = 0): session is Session {
  if (!session) return false
  const expires = Date.parse(session.expiresAt)
  return Number.isFinite(expires) && expires - marginMs > now
}

/** The session for exactly this wallet, or none: another wallet's session grants this one nothing. */
export function sessionFor(session: Session | null, address: string | null, now: number): Session | null {
  if (!address || !sessionAlive(session, now)) return null
  return session.address === address ? session : null
}

/** What a screen may say about the session — never the token. */
export function describeSession(
  session: Session,
): Readonly<{ address: string; expiresAt: string; sessionId: string | null }> {
  return { address: session.address, expiresAt: session.expiresAt, sessionId: session.sessionId }
}
