import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback } from 'react'
import { Linking } from 'react-native'

import { rulePurchaseParams } from '@/features/autoinvest/rule-model'
import { RULES_KEY } from '@/features/autoinvest/use-rules'
import { recordJourney } from '@/features/journeys/journey-store'
import { useMonitoring, usePlans } from '@/features/plans/use-plans'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import {
  markMonitoringRead,
  updateMonitoringPreferences,
  type MonitoringPreferencesPatch,
  type MonitoringSurface,
  type RuleListResponse,
  type Session,
} from '@/lib/api'
import type { Locale } from '@/lib/i18n'

import { webHrefOf } from './deep-link'
import { parseNoteRef, resolveNote, type NoteRef, type NoteTarget, type Resolved } from './monitoring-model'

const MONITORING_KEY = [PRIVATE_QUERY_KEY, 'monitoring'] as const

/**
 * Mark a note read on the server. The cache is told first so the row and
 * the count answer at once; the server's answer replaces it — a note that
 * is not this wallet's is refused there and the cache is re-read.
 */
export function useMarkRead(session: Session | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string) => markMonitoringRead(session!, noteId),
    onMutate: async (noteId) => {
      await queryClient.cancelQueries({ queryKey: MONITORING_KEY })
      queryClient.setQueriesData<MonitoringSurface>({ queryKey: MONITORING_KEY }, (surface) => {
        if (!surface) return surface
        const note = surface.recent.find((row) => row.id === noteId)
        if (!note || !note.unread) return surface
        return {
          ...surface,
          recent: surface.recent.map((row) => (row.id === noteId ? { ...row, unread: false } : row)),
          unread: Math.max(0, surface.unread - 1),
        }
      })
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: MONITORING_KEY }),
  })
}

/** Change where notes go. The cache shows the change at once; a refusal puts the server's state back. */
export function useUpdatePreferences(session: Session | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: MonitoringPreferencesPatch) => updateMonitoringPreferences(session!, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: MONITORING_KEY })
      queryClient.setQueriesData<MonitoringSurface>({ queryKey: MONITORING_KEY }, (surface) =>
        surface
          ? {
              ...surface,
              preferences: {
                telegram: patch.telegram ?? surface.preferences.telegram,
                push: patch.push ?? surface.preferences.push,
                quietHours: patch.quietHours === undefined ? surface.preferences.quietHours : patch.quietHours,
              },
            }
          : surface,
      )
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: MONITORING_KEY }),
  })
}

/** Read the wallet's surface and plans and resolve one note or monitor against them; null while either is not read yet. */
export function useResolvedNote(session: Session | null, locale: Locale, ref: NoteRef | null) {
  const monitoring = useMonitoring(session, locale)
  const plans = usePlans(session)
  const surface = monitoring.data ?? null
  const resolved: Resolved | null = ref && surface && plans.data ? resolveNote(ref, surface, plans.data.plans) : null
  return {
    resolved,
    surface,
    plans,
    monitoring,
    reading: session !== null && (monitoring.isPending || plans.isPending),
    /** A fresh read is on its way — an answer that is not in the last read may still arrive. */
    settling: monitoring.isFetching || plans.isFetching,
  }
}

/**
 * The one way a note or a card is opened: the note it shows is marked read
 * (as the web's link does), then the exact plan opens with the monitoring
 * context — a reminder its company's purchase under the rule, the month's
 * budget spent its sheet on Home. A record the phone has no surface for
 * opens on ryntra.io; a record that needs a choice or is gone opens the
 * resolver, which says so. Nothing here carries a quote, a finding or a
 * prepared order to the plan.
 */
export function useOpenNote(session: Session | null, from: 'home' | 'plans' | 'inbox' | 'plan' | 'resolver' = 'inbox') {
  const router = useRouter()
  const queryClient = useQueryClient()
  const markRead = useMarkRead(session)
  const mark = markRead.mutate
  return useCallback(
    (target: NoteTarget, ref: NoteRef | null) => {
      recordJourney('note_open', { from, target: target.kind })
      if (ref?.kind === 'note') mark(ref.id)
      if (target.kind === 'rule') {
        // One tap to the company's purchase under the rule when the wallet's rules are already read; the page reads
        // the rule afresh either way. Otherwise the resolver reads it first.
        const cached = queryClient
          .getQueriesData<RuleListResponse>({ queryKey: [...RULES_KEY, 'list', session?.address ?? ''] })
          .flatMap(([, list]) => list?.rules ?? [])
          .find((rule) => rule.id === target.ruleId)
        if (cached) {
          router.push({
            pathname: '/asset/[mint]',
            params: rulePurchaseParams({
              mint: cached.asset.mint,
              symbol: cached.asset.symbol,
              ruleId: cached.id,
              dueAt: target.dueAt,
            }),
          })
          return
        }
        if (ref) router.push({ pathname: '/monitoring/open', params: { n: ref.id } })
        return
      }
      if (target.kind === 'plan') {
        router.push({
          pathname: '/plans/[id]',
          params: { id: target.planId, from: 'monitoring', ...(ref?.kind === 'note' ? { note: ref.id } : {}) },
        })
        return
      }
      if (target.kind === 'web') {
        const href = webHrefOf(target.href)
        if (href) void Linking.openURL(href)
        return
      }
      if (target.kind === 'budget') {
        // The month's autoinvest budget, spent: its one action, «Змінити бюджет», is the budget's sheet on Home.
        router.navigate({ pathname: '/(tabs)', params: { budget: 'edit' } })
        return
      }
      if (target.kind === 'issuer') {
        // An issuer's deadline on a held token: its page with the swap's sheet open — the note never swaps anything.
        router.push({ pathname: '/asset/[mint]', params: { mint: target.mint, category: 'stock', convert: '1' } })
        return
      }
      if (ref) router.push({ pathname: '/monitoring/open', params: { n: ref.id } })
    },
    [from, mark, queryClient, router, session?.address],
  )
}

export { parseNoteRef }
