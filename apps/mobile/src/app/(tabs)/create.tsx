import { Redirect } from 'expo-router'

/**
 * The bar's «+»: a press opens «Запустити токен» (`/launch`) over the bar and
 * this place is never drawn. Reached any other way — an old link — it leads
 * to the same form.
 */
export default function CreateRoute() {
  return <Redirect href="/launch" />
}
