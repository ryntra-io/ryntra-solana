import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { assistantApi, type Session, type TelegramChannelResponse } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'

/** One key for the wallet's Telegram channel — the same the autoinvest sheet reads, so every reader sees a change. */
export const telegramKey = (address: string) => [PRIVATE_QUERY_KEY, 'telegram', address] as const

/** The wallet's Telegram channel (1.11.0): connected or not, its handle — never the Telegram id. */
export function useTelegram(session: Session | null, enabled = true) {
  return useQuery({
    queryKey: telegramKey(session?.address ?? ''),
    queryFn: ({ signal }) => assistantApi.telegram(session!, signal),
    enabled: session !== null && enabled,
    staleTime: 60_000,
    retry: 1,
  })
}

/** The connect link's life: until `expiresAt`, a return to the app reads the channel again. */
type Pending = Readonly<{ link: string; until: number }>

/**
 * Connecting Telegram from the phone: `POST` makes a t.me link with a signed code for this wallet; the bot binds the
 * chat only when the person presses Start there. While the link lives, each return to the app reads the channel
 * again — connected ends the wait; an expired link ends it too and the person connects anew. «Відключити» lets the
 * channel go. Nothing here reads a key or a Telegram id.
 */
export function useTelegramConnect(session: Session | null, locale: Locale) {
  const queryClient = useQueryClient()
  const address = session?.address ?? ''
  const channel = useTelegram(session)
  const [pending, setPending] = useState<Pending | null>(null)
  const [expired, setExpired] = useState(false)

  const connected = channel.data?.telegram.connected === true

  const connect = useMutation({
    mutationFn: () => assistantApi.connectTelegram(session!, locale),
    onSuccess: (made) => {
      const until = Date.parse(made.expiresAt)
      setExpired(false)
      setPending({ link: made.link, until: Number.isNaN(until) ? Date.now() + 10 * 60_000 : until })
      openLink(made.link)
    },
  })

  const disconnect = useMutation({
    mutationFn: () => assistantApi.disconnectTelegram(session!),
    onSuccess: (next) => {
      setPending(null)
      queryClient.setQueryData<TelegramChannelResponse>(telegramKey(address), next)
    },
  })

  // Back from Telegram: read the channel again while the link lives; past its life, say so once. Connected ends the
  // wait by itself (`waiting` below), and a link that outlived its time is let go.
  useEffect(() => {
    if (!pending || connected) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      if (Date.now() > pending.until) {
        setPending(null)
        setExpired(true)
      }
      void queryClient.invalidateQueries({ queryKey: telegramKey(address) })
    })
    return () => subscription.remove()
  }, [pending, connected, queryClient, address])

  return {
    channel,
    connected,
    username: channel.data?.telegram.username ?? null,
    /** A link is open in Telegram and the bot waits for Start. */
    waiting: pending !== null && !connected,
    /** The last link outlived its time without a Start. */
    expired: expired && !connected,
    connect: () => connect.mutate(),
    /** The same link opened again while it lives. */
    reopen: () => {
      if (pending) openLink(pending.link)
    },
    connecting: connect.isPending,
    connectError: connect.error,
    /** «Відключити»; `onDone` once the channel is let go. */
    disconnect: (onDone?: () => void) => disconnect.mutate(undefined, { onSuccess: () => onDone?.() }),
    disconnecting: disconnect.isPending,
    disconnectError: disconnect.error,
  } as const
}
