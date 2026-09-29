export type AccountRequestTicket = Readonly<{
  id: number;
  address: string;
  controller: AbortController;
  signal: AbortSignal;
}>;

export type LatestAccountRequestGate = Readonly<{
  begin: (address: string) => AccountRequestTicket;
  accepts: (ticket: AccountRequestTicket, currentAddress: string) => boolean;
  cancel: (ticket?: AccountRequestTicket) => void;
}>;

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Keeps account reads latest-address-wins. Starting a newer read aborts the
 * older transport and invalidates its commit even if the old promise resolves
 * after abort. This prevents public data for wallet A rendering under wallet B.
 */
export function createLatestAccountRequestGate(): LatestAccountRequestGate {
  let sequence = 0;
  let current: AccountRequestTicket | null = null;

  return {
    begin(address) {
      current?.controller.abort();
      const controller = new AbortController();
      const ticket: AccountRequestTicket = {
        id: ++sequence,
        address: normalizeAddress(address),
        controller,
        signal: controller.signal,
      };
      current = ticket;
      return ticket;
    },
    accepts(ticket, currentAddress) {
      return (
        current?.id === ticket.id &&
        ticket.address === normalizeAddress(currentAddress) &&
        !ticket.signal.aborted
      );
    },
    cancel(ticket) {
      if (!current || (ticket && current.id !== ticket.id)) return;
      current.controller.abort();
      current = null;
    },
  };
}
