import { PlanBuilderScreen } from '@/screens/plans/builder'

/** `/plans/new?mint=&symbol=` — a new plan for a stock; `?plan=<id>` — a new version of an existing one. */
export default function PlanBuilderRoute() {
  return <PlanBuilderScreen />
}
