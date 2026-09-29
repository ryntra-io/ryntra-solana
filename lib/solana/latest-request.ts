/** Latest-request-wins gate for case-sensitive Solana identities. */

export type SolanaRequestTicket = Readonly<{
  id: number;
  identity: string;
  controller: AbortController;
  signal: AbortSignal;
}>;

export function createLatestSolanaRequestGate() {
  let sequence = 0;
  let current: SolanaRequestTicket | null = null;
  return {
    begin(identity: string): SolanaRequestTicket {
      current?.controller.abort();
      const controller = new AbortController();
      const ticket = {
        id: ++sequence,
        identity,
        controller,
        signal: controller.signal,
      };
      current = ticket;
      return ticket;
    },
    accepts(ticket: SolanaRequestTicket, currentIdentity: string): boolean {
      return (
        current?.id === ticket.id &&
        ticket.identity === currentIdentity &&
        !ticket.signal.aborted
      );
    },
    cancel(ticket?: SolanaRequestTicket): void {
      if (!current || (ticket && ticket.id !== current.id)) return;
      current.controller.abort();
      current = null;
    },
  };
}

/** Commit an async result only if its exact request is still current. */
export async function acceptLatestSolanaResult<T>(args: {
  gate: Readonly<{ accepts: (ticket: SolanaRequestTicket, identity: string) => boolean }>;
  ticket: SolanaRequestTicket;
  identity: string;
  produce: () => Promise<T>;
}): Promise<Readonly<{ accepted: true; value: T }> | Readonly<{ accepted: false }>> {
  const value = await args.produce();
  return args.gate.accepts(args.ticket, args.identity)
    ? { accepted: true, value }
    : { accepted: false };
}
