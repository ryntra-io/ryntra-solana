/**
 * Mission Control's one orange action, «Launch a mission» (decision 68): on production it leads to a launch only after
 * MC-1 — the eight blockers of the audits' reconciliation (decisions C14–C15). Until the operator opens it, the scene has
 * no call to launch at all. Opened by `RYNTRA_MISSION_LAUNCH=open` on the deployment; anything else keeps it closed.
 */
export function missionLaunchOpen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.RYNTRA_MISSION_LAUNCH?.trim() === "open";
}

/** Where the action leads once open: the Launch form that already exists. */
export const MISSION_LAUNCH_PATH = "/app/launch";
