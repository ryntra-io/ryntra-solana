import { createSessionApi } from '@/lib/api'
import { CLIENT_IDENTITY } from '@/lib/client-identity'

/** The app's one session API — contract 1.3.0 over the pinned client, for this build's identity. */
export const sessionApi = createSessionApi(CLIENT_IDENTITY)
