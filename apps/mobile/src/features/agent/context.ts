/**
 * Where a conversation with Ryntra was opened from, written as one parameter —
 * the web app's own format (`lib/agent/context.ts`), so a link from the
 * site and a door in the app name the same thing: `asset:<mint>[:<symbol>]`,
 * `plan:<id>`, `portfolio`, `note:<id>` or `page:<name>`. The server reads a
 * context as context, never as authority; anything that is not one of these
 * is no context at all.
 */

import type { AgentContext, AgentPage } from '../../lib/api/v1/types.ts'

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const PLAN_ID = /^plan_[0-9a-f]{32}$/
const PAGES: readonly AgentPage[] = ['spot', 'stocks', 'swap', 'trends', 'strategies', 'results', 'activity', 'predictions']

/** The parameter back into a context, or null for anything that is not one. */
export function parseContextParam(raw: string | null | undefined): AgentContext | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 128) return null
  const [kind, ...rest] = raw.split(':')
  const head = rest[0] ?? ''
  if (kind === 'asset' && BASE58.test(head)) {
    const symbol = (rest[1] ?? '').trim().slice(0, 32)
    return symbol ? { kind: 'asset', mint: head, symbol } : { kind: 'asset', mint: head }
  }
  if (kind === 'plan' && PLAN_ID.test(head)) return { kind: 'plan', planId: head }
  if (kind === 'portfolio' && rest.length === 0) return { kind: 'portfolio' }
  if (kind === 'note' && head.length >= 4 && head.length <= 64 && /^[A-Za-z0-9_-]+$/.test(head)) {
    return { kind: 'note', inboxId: head }
  }
  if (kind === 'page' && (PAGES as readonly string[]).includes(head)) return { kind: 'page', page: head as AgentPage }
  return null
}

/** A context as the one parameter a route and a link carry. */
export function contextParam(context: AgentContext): string {
  switch (context.kind) {
    case 'asset':
      return `asset:${context.mint}${context.symbol ? `:${context.symbol}` : ''}`
    case 'plan':
      return `plan:${context.planId}`
    case 'portfolio':
      return 'portfolio'
    case 'note':
      return `note:${context.inboxId}`
    default:
      return `page:${context.page}`
  }
}

/** One key per conversation on the phone: the context's parameter, or `none` for the tab's own. */
export function contextKey(context: AgentContext | null): string {
  return context ? contextParam(context) : 'none'
}
