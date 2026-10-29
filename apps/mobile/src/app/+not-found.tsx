import { Redirect } from 'expo-router'

/** An address the app does not know is the city (decision 75): there is no other place. */
export default function NotFound() {
  return <Redirect href="/" />
}
