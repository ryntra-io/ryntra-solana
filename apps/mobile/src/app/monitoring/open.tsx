import { OpenNoteScreen } from '@/screens/monitoring/open'

/** `/monitoring/open?n=<note|monitor>` or `?href=<web path>` — the resolver every deep link into the monitoring lands on. */
export default function OpenNoteRoute() {
  return <OpenNoteScreen />
}
