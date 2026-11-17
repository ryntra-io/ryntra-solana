import { useEffect } from 'react';
import { SPOT_OPEN } from '@/city/lib/trade/gates';
import { useSpot } from '@/city/lib/trade/spot-store';
import { stopsKey } from '@/city/lib/trade/stops';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';

/** The stops of this device are asked about this often while the page is in front, as the city's trade layer asks. */
const STOP_WATCH_MS = 20_000;

/**
 * The watch over the wallet's stops while a screen of the Market is open, on the trade logic's own rules
 * (`city/lib/trade/spot-store.ts`): read when the wallet connects, again when another tab changes them, and asked
 * about while the page is in front. A stop reached on the coin the screen stands on opens its sale on the ticket at
 * the market price — for the person to read and sign; nothing sells by itself. Any other reached stop waits under its
 * own coin's «Orders».
 */
export function useStopsWatch(mint: string | null): void {
  const address = useWallet((st) => st.connection?.address ?? null);
  useEffect(() => {
    if (!SPOT_OPEN) return;
    useSpot.getState().loadStops();
    if (!address) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === stopsKey(address)) useSpot.getState().loadStops();
    };
    let alive = true;
    const watch = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const reached = await useSpot.getState().watchStops();
      if (!alive) return;
      const here = reached.find((stop) => stop.base.mint === mint);
      const card = useTrade.getState();
      // Only a ticket at rest on the stop's own coin is given the sale.
      if (!here || !card.open || card.tower?.mint !== here.base.mint || card.phase !== 'idle' || card.held) return;
      useSpot.getState().openSale(here);
    };
    window.addEventListener('storage', onStorage);
    const timer = setInterval(() => void watch(), STOP_WATCH_MS);
    void watch();
    return () => {
      alive = false;
      window.removeEventListener('storage', onStorage);
      clearInterval(timer);
    };
  }, [address, mint]);
}
