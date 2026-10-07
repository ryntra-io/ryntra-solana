import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import type { LaunchWord } from '@/features/launch/copy'
import type { CreateOutcome } from '@/features/launch/launch-flow'
import { formatDate } from '@/features/launch/launch-format'
import { launchedView } from '@/features/launch/launch-model'
import type { Locale } from '@/lib/i18n'

import { ShareLink, TokenPicture } from './parts'

/**
 * The launch's end: «$SYM запущено» once the network confirmed it, «уже в
 * дорозі» while it has not — the token page settles it — the lock as the
 * token's read says it, the link to share, and the three ways on.
 */
export function LaunchSuccess({
  word,
  locale,
  result,
  onAnother,
}: {
  word: LaunchWord
  locale: Locale
  result: Extract<CreateOutcome, { ok: true }>
  onAnother: () => void
}) {
  const router = useRouter()
  const view = launchedView(result.submit, result.token)
  return (
    <Card className="items-center gap-3 py-6" accessibilityLiveRegion="polite">
      <View>
        <TokenPicture uri={result.image} size={96} />
        {view.pending ? null : (
          <View className="absolute -bottom-2 -right-2 rounded-pill bg-surface">
            <Icon name="checkmark-circle" size={28} color="successInk" />
          </View>
        )}
      </View>
      <Txt variant="headline" className="text-center" accessibilityRole="header">
        {word(view.pending ? 'pendingTitle' : 'successTitle', { symbol: result.symbol })}
      </Txt>
      {view.pending ? (
        <Txt variant="ui" tone="muted" className="text-center">
          {word('pendingLine')}
        </Txt>
      ) : result.token ? (
        <Txt variant="ui" tone="muted" className="text-center">
          {word('successLine')}
        </Txt>
      ) : null}
      {view.locked ? (
        <View className="flex-row items-start justify-center gap-2 px-2">
          <Icon name="lock-closed" size={16} color="brand" style={{ marginTop: 1 }} />
          <Txt variant="ui" className="shrink text-center">
            {word('successLocked', {
              date: formatDate(view.locked.cliffAt, locale),
              end: formatDate(view.locked.endsAt, locale),
            })}
          </Txt>
        </View>
      ) : null}
      {view.lockPending ? (
        <Txt variant="ui" tone="muted" className="text-center">
          {word('successLockPending')}
        </Txt>
      ) : null}
      {view.lockFailed ? (
        <Txt variant="ui" tone="warning" className="text-center" accessibilityRole="alert">
          {word('successLockFailed')}
        </Txt>
      ) : null}
      {result.token ? (
        <View className="w-full pt-1">
          <ShareLink word={word} link={result.token.shareLink} symbol={result.symbol} />
        </View>
      ) : null}
      <View className="w-full gap-2 pt-2">
        <Button
          title={word('openToken')}
          size="lg"
          onPress={() => router.push(`/launch/${result.submit.token}` as never)}
        />
        <Button title={word('mineTitle')} variant="secondary" onPress={() => router.replace('/launch/mine' as never)} />
        <Button title={word('launchAnother')} variant="ghost" onPress={onAnother} />
      </View>
    </Card>
  )
}
