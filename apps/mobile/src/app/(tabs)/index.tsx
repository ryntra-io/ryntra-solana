import { useLocalSearchParams, useRouter } from 'expo-router'

import { BudgetSheet } from '@/screens/autoinvest/budget-sheet'
import { InvestorHome } from '@/screens/home/investor'

/**
 * The first tab: the investor's Home for everyone — one version, no switch
 * (canon v5.3 В28); what changed and what needs a look is one tap deeper, at
 * «Що змінилося». `budget=edit` — where the note that the month's autoinvest
 * budget is spent, and its Telegram button, land (1.13.0) — opens the
 * budget's sheet over it; closing it drops the word, so it opens once.
 */
export default function HomeRoute() {
  const router = useRouter()
  const { budget } = useLocalSearchParams<{ budget?: string }>()
  return (
    <>
      <InvestorHome />
      <BudgetSheet visible={budget === 'edit'} onClose={() => router.setParams({ budget: '' })} />
    </>
  )
}
