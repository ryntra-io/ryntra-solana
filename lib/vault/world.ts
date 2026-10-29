import type { Title, VaultId } from "./levels";

/**
 * A crack, as an event for the living world: points for the quarter and the title «Breaker» (Зломщик). Points belong
 * to the world (`lib/world`, the line «Світ · сервер»), which awards them only on the server, once per key, for a
 * reason from its list. Until that line adds the vault's reason and a way to award it, the event goes to the server
 * log and the vault shows the points it counted itself; the request is written in `docs/city/handoffs/world-server.md`.
 */

export type VaultWorldEvent = {
  kind: "vault_crack";
  vault: VaultId;
  /** The UTC day the vault was cracked on: the daily vault awards once a day, a practice level once ever. */
  day: string;
  points: number;
  /** Set when this crack earned the title. */
  title: Title | null;
  /** The world awards once per key. */
  idempotencyKey: string;
  at: string;
};

export interface WorldSink {
  /**
   * Hands the event to the world for the person behind this request — the world reads who it is from the request's
   * own session or guest key, as its routes do. "pending" while the world has no way to take it.
   */
  award(req: Request, event: VaultWorldEvent): Promise<"sent" | "pending">;
}

/** The sink until the world takes vault events: one JSON line in the server log, tagged [vault]. */
export const logWorldSink: WorldSink = {
  async award(_req, event) {
    console.info(`[vault] ${JSON.stringify(event)}`);
    return "pending";
  },
};
