/**
 * The drive's two switches. `RYNTRA_AGENT_DRIVE=on` (server, `./drive.server.ts`) lets it tell the agent's moves and its
 * week; `NEXT_PUBLIC_RYNTRA_AGENT_DRIVE=open` shows the week and the person's notification settings in her bots. Anything
 * else keeps each shut. The agent's page and a card's page answer whenever the terminal does: a note or a post links
 * there only once the drive has told something.
 */

export const driveOpen = (value: string | undefined): boolean => value?.trim() === "open";

export const DRIVE_OPEN = driveOpen(process.env.NEXT_PUBLIC_RYNTRA_AGENT_DRIVE);
