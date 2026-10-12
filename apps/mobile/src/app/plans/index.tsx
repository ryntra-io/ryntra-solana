import { Redirect } from 'expo-router'

/** `/plans` — the plans live in «Боти → Мої боти» since the current menu; a saved link lands there. */
export default function PlansRoute() {
  return <Redirect href="/bots" />
}
