import { Redirect } from 'expo-router'

export default function GalleryRoute() {
  if (!__DEV__) return <Redirect href="/" />

  // Keep sample modules outside the production route's execution path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GalleryScreen } = require('@/screens/gallery') as typeof import('@/screens/gallery')
  return <GalleryScreen />
}
