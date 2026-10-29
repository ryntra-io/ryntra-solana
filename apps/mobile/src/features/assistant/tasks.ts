import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { assistantApi, type AssistantTasksResponse, type Session } from '@/lib/api'
import type { AssistantTaskCreate, AssistantTaskUpdate } from '@/lib/api/v1/types'

import { readTasksAgainAfter, taskFailureOf } from './tasks-model'
import { creditsChanged } from './use-credits'

export const tasksKey = (address: string) => [PRIVATE_QUERY_KEY, 'assistant-tasks', address] as const

/**
 * «Доручення» (1.59.0): the wallet's scheduled questions, the price of a run now, each rhythm's price a day and
 * whether it fits the day's runs. Private to the bearer.
 */
export function useTasks(session: Session | null, enabled = true) {
  return useQuery({
    queryKey: tasksKey(session?.address ?? ''),
    queryFn: ({ signal }) => assistantApi.tasks(session!, signal),
    enabled: session !== null && enabled,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1_500,
  })
}

export type TaskWrite =
  | Readonly<{ kind: 'create'; body: AssistantTaskCreate }>
  | Readonly<{ kind: 'update'; id: string; body: AssistantTaskUpdate }>
  | Readonly<{ kind: 'remove'; id: string }>

/** Whether a write carries a price the person accepted — then the credits are read again after it. */
function paid(write: TaskWrite): boolean {
  return write.kind === 'create' || (write.kind === 'update' && write.body.acceptCredits !== undefined)
}

/**
 * A task turned on, paused, resumed or turned off. Every answer is the whole surface again and becomes the read; a
 * paid write reads the credits again; a refusal that means the price or the task moved reads the tasks again.
 */
export function useTaskWrite(session: Session | null) {
  const queryClient = useQueryClient()
  const address = session?.address ?? ''
  return useMutation({
    mutationFn: (write: TaskWrite): Promise<AssistantTasksResponse> => {
      if (write.kind === 'create') return assistantApi.createTask(session!, write.body)
      if (write.kind === 'update') return assistantApi.updateTask(session!, write.id, write.body)
      return assistantApi.removeTask(session!, write.id)
    },
    onSuccess: (read, write) => {
      queryClient.setQueryData(tasksKey(address), read)
      if (paid(write)) creditsChanged(queryClient, address, null)
    },
    onError: (error) => {
      if (readTasksAgainAfter(taskFailureOf(error))) void queryClient.invalidateQueries({ queryKey: tasksKey(address) })
    },
  })
}
