import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { SearchInput } from '@/components/search-field'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { matchesQuery, type ReceiptDoc } from '@/features/receipts/receipt-doc'
import { sampleDocs } from '@/features/receipts/receipt-samples'
import { useCopy, useLocale } from '@/lib/i18n'

import { journalMarkWords, ReceiptDocSheet } from './doc-sheet'
import { ReceiptRow } from './index'
import { ShareReceiptSheet } from './share-receipt'

/** «Квитанції» on samples of every kind: the list with its search, each card, and the picture of a journal entry. */
export function ReceiptSamples() {
  const copy = useCopy(RECEIPTS_COPY)
  const locale = useLocale()
  const docs = useMemo(() => sampleDocs(locale), [locale])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<ReceiptDoc | null>(null)
  const shown = docs.filter((doc) => matchesQuery(doc, query))
  return (
    <View className="gap-2">
      <View className="flex-row">
        <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={copy.search} />
      </View>
      {shown.map((doc, index) => (
        <ReceiptRow key={doc.id} doc={doc} last={index === shown.length - 1} onPress={() => setPicked(doc)} />
      ))}
      {picked?.kind === 'journal' ? (
        <ShareReceiptSheet doc={picked} markWords={journalMarkWords(locale)} visible onClose={() => setPicked(null)} />
      ) : (
        <ReceiptDocSheet doc={picked} onClose={() => setPicked(null)} />
      )}
    </View>
  )
}
