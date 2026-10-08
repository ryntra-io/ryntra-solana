import { Redirect } from 'expo-router'

/** `/plans` — the plans live in «Боти → Мої боти» since the menu v6.2; a saved link lands there. */
export default function PlansRoute() {
  return <Redirect href="/bots" />
}
