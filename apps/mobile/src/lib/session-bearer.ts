/**
 * The bearer a request carries (ST-2). A refresh replaces the session's token
 * and the server revokes the old one; a screen or a flow may still hold the
 * session it read before. Every private request therefore asks here: the
 * newest token issued for the same wallet in place of a replaced one, so a
 * read or a submit that started before the refresh never meets a revoked
 * bearer. Memory only — the secure store keeps the newest session itself.
 */

type Bearer = Readonly<{ address: string; token: string }>

const replaced = new Map<string, Bearer>()

/** A refresh: `previous` was replaced by `next` for the same wallet. Another wallet's token is never a replacement. */
export function noteReplaced(previous: Bearer, next: Bearer) {
  if (previous.address !== next.address || previous.token === next.token) return
  replaced.set(previous.token, next)
}

/** The token to send for this session: its own, or the newest one that replaced it. */
export function bearerOf(session: Bearer): string {
  let token = session.token
  // A chain of refreshes is followed to its end; a loop is impossible but bounded anyway.
  for (let step = 0; step < 32; step += 1) {
    const next = replaced.get(token)
    if (!next || next.address !== session.address) break
    token = next.token
  }
  return token
}

/** A sign-out or an end: nothing of the wallet's old tokens is kept. */
export function forgetBearers(address: string) {
  for (const [token, next] of replaced) if (next.address === address) replaced.delete(token)
}
