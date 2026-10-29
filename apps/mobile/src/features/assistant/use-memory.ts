import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import {
  assistantApi,
  type AssistantMemoryNote,
  type AssistantMemoryResponse,
  type AssistantMemoryUpdate,
  type AssistantProfileResponse,
  type AssistantProfileUpdate,
  type Session,
} from '@/lib/api'

import { mergeMemory, newNotes } from './memory-model'

export const profileKey = (address: string) => [PRIVATE_QUERY_KEY, 'assistant-profile', address] as const
export const memoryKey = (address: string) => [PRIVATE_QUERY_KEY, 'assistant-memory', address] as const

/** «Знайомство» (1.58.0): the proven wallet's answers — `profile` null until answered or skipped — and where notes go. */
export function useProfile(session: Session | null, enabled = true) {
  return useQuery({
    queryKey: profileKey(session?.address ?? ''),
    queryFn: ({ signal }) => assistantApi.profile(session!, signal),
    enabled: session !== null && enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/** What Ryntra keeps about the person (1.59.0): «Про мене», the notes with their source, whether it notices. */
export function useMemory(session: Session | null, enabled = true) {
  return useQuery({
    queryKey: memoryKey(session?.address ?? ''),
    queryFn: ({ signal }) => assistantApi.memory(session!, signal),
    enabled: session !== null && enabled,
    staleTime: 60_000,
    retry: 1,
  })
}

/**
 * The answers as the server now holds them, written where every reader finds them: the profile's own read and the
 * memory's copy of the answers. Kept apart from the `PUT` so «Знайомство» can finish its «Готово» before the
 * conversation sees a profile and lets the card go.
 */
export function profileSaved(queryClient: QueryClient, address: string, next: AssistantProfileResponse) {
  queryClient.setQueryData<AssistantProfileResponse>(profileKey(address), next)
  queryClient.setQueryData<AssistantMemoryResponse>(memoryKey(address), (current) =>
    current ? { ...current, profile: next.profile } : current,
  )
}

/** `PUT` the four answers with `delivery`, or `{ skipped: true }`. The caller writes the answer with `profileSaved`. */
export function useSaveProfile(session: Session | null) {
  return useMutation({
    mutationFn: (update: AssistantProfileUpdate) => assistantApi.setProfile(session!, update),
  })
}

/** Every memory write's answer is the memory now; the wallet's picture already shown stays. */
function memoryWritten(queryClient: QueryClient, address: string, next: AssistantMemoryResponse) {
  queryClient.setQueryData<AssistantMemoryResponse>(memoryKey(address), (current) => mergeMemory(current, next))
  queryClient.setQueryData<AssistantProfileResponse>(profileKey(address), (current) =>
    current ? { ...current, profile: next.profile } : current,
  )
}

/** `PUT` «Про мене» (null clears it), «Помічати», or one typed note. A secret is `MEMORY_SECRET_REFUSED`. */
export function useWriteMemory(session: Session | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (update: AssistantMemoryUpdate) => assistantApi.setMemory(session!, update),
    onSuccess: (next) => memoryWritten(queryClient, session?.address ?? '', next),
  })
}

/** «Забути» one note. */
export function useForgetNote(session: Session | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string) => assistantApi.forget(session!, noteId),
    onSuccess: (next) => memoryWritten(queryClient, session?.address ?? '', next),
  })
}

/** «Забути все»: «Про мене» and every note. */
export function useForgetAll(session: Session | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => assistantApi.forgetAll(session!),
    onSuccess: (next) => memoryWritten(queryClient, session?.address ?? '', next),
  })
}

export type NewNotes = Readonly<{
  /** The ids of the notes known now, or null while the memory has not been read yet. */
  snapshot: () => Set<string> | null
  /** The memory read again; the notes whose id `before` did not hold. Never throws — a failed read is none. */
  since: (before: Set<string> | null) => Promise<AssistantMemoryNote[]>
}>

/**
 * What a message just left in the memory, so it is said under the conversation and nothing is kept unseen.
 *
 * The hook keeps the memory read while the conversation is open. Around each message:
 *
 *   const notes = useNewNotes(session)
 *   const before = notes.snapshot()          // before the message is sent
 *   … send the message, wait for the answer …
 *   const left = await notes.since(before)   // re-reads the memory, returns what is new
 *   if (left.length > 0) show <RememberedLine notes={left} … />
 *
 * `snapshot()` is null while the memory was never read (just opened, or the read failed); `since(null)` then reads
 * it and returns nothing — an old note is never said as just remembered. A guest (no session) has no memory: `since`
 * returns nothing.
 */
export function useNewNotes(session: Session | null): NewNotes {
  const queryClient = useQueryClient()
  const address = session?.address ?? ''
  useMemory(session)

  const snapshot = useCallback((): Set<string> | null => {
    if (!address) return null
    const read = queryClient.getQueryData<AssistantMemoryResponse>(memoryKey(address))
    return read ? new Set(read.notes.map((note) => note.id)) : null
  }, [queryClient, address])

  const since = useCallback(
    async (before: Set<string> | null): Promise<AssistantMemoryNote[]> => {
      if (!session) return []
      try {
        const shown = queryClient.getQueryData<AssistantMemoryResponse>(memoryKey(session.address))
        const read = await assistantApi.memory(session)
        queryClient.setQueryData<AssistantMemoryResponse>(memoryKey(session.address), mergeMemory(shown, read))
        return before ? newNotes(before, read.notes) : []
      } catch {
        return []
      }
    },
    [queryClient, session],
  )

  return { snapshot, since }
}
