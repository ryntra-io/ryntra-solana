'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTowerChart } from '@/city/lib/chart/store';
import { useCity } from '@/city/lib/city/store';
import { EXCHANGE_OPEN } from '@/city/lib/exchange/flag';
import { useExchange } from '@/city/lib/exchange/store';
import type { CitySnapshot } from '@/city/lib/market/types';
import { cameFromCity, DETACH_CHANNEL, OUT_MARK, parseDetachUrl, parseMessage, type Message, type Params } from '@/city/lib/window/detach';
import { standAlone, useWindows } from '@/city/lib/window/store';
import { ChartLayer } from '../chart/ChartLayer';
import { ExchangeLayer } from '../exchange/ExchangeLayer';
import { TradeLayer } from '../trade/TradeLayer';
import { OutWindow } from './OutWindow';
import s from './window.module.css';

type Kind = Readonly<{ layers: readonly ComponentType[]; open: (params: Params) => void }>;

/**
 * The windows that can live on a page of their own, each opened through its own store exactly as the city opens it, and
 * behind the same switches: the Exchange only where the city has it (`NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE`); the trade
 * card keeps its own (`TRADE`, `SPOT`) inside it.
 */
const KINDS: Readonly<Record<string, Kind>> = {
  chart: {
    // A tower's Buy opens the same trade card here, with the same wallet.
    layers: [ChartLayer, TradeLayer],
    open: (params) => {
      if (params.tower) useTowerChart.getState().open(params.tower);
    },
  },
  ...(EXCHANGE_OPEN ? { exchange: { layers: [ExchangeLayer], open: (params: Params) => useExchange.getState().show(params.symbol ?? null) } } : {}),
};

const READ_WAIT_MS = 4_000;
/** A window that does not stand up this long after the read (its tower left the market) is no window: the city instead. */
const SHOW_WAIT_MS = 6_000;

/** Whether this tab was opened by the city (or already was its window); the city's handle on this tab stays, this tab's on the city goes. */
function fromCity(): boolean {
  let openerOrigin: string | null = null;
  try {
    openerOrigin = window.opener && !window.opener.closed ? (window.opener as Window).location.origin : null;
  } catch {
    // Another site's window: its address cannot be read.
  }
  let marked = false;
  try {
    marked = sessionStorage.getItem(OUT_MARK) === '1';
  } catch {
    // No session storage: only the opener counts.
  }
  if (!cameFromCity({ openerOrigin, origin: location.origin, marked })) return false;
  try {
    sessionStorage.setItem(OUT_MARK, '1');
  } catch {
    // Its own reload goes to the city then.
  }
  try {
    window.opener = null;
  } catch {
    // Kept by the browser: nothing here reads it.
  }
  return true;
}

/**
 * One window of the city on a page of its own (CITY-75, `/window?id=chart&tower=<mint>`): the way out onto another
 * screen where the browser has no Document Picture-in-Picture (Firefox, Safari). No 3D city — only the window, through
 * the same store, the same wallet adapter and the same reads as in the city. It tells the city it is here and when it
 * closes, follows the city when another tower is picked, and closes when the city takes it back — over a
 * `BroadcastChannel`. «Back to the city» closes it; its contents come back where they stood.
 */
export function OutPage({ initial }: { initial: CitySnapshot }) {
  // The address is read in the browser: the server's page is the same for every window.
  const [route, setRoute] = useState<ReturnType<typeof parseDetachUrl> | undefined>(undefined);
  const [ready, setReady] = useState(false);

  // The page's window is never the city's layout; the window stands as on a computer, whatever this page's width.
  useEffect(() => {
    standAlone();
    setRoute(fromCity() ? parseDetachUrl(location.search, Object.keys(KINDS)) : null);
  }, []);

  // The towers: the live read first, so a chart opens on a tower the bundled city may not have; the bundled city if
  // the read is slow or fails. Then read again every minute, as the city does.
  useEffect(() => {
    let alive = true;
    useCity.getState().setSnapshot(initial);
    const read = async () => {
      try {
        const res = await fetch('/api/city', { cache: 'no-store' });
        if (!res.ok) return;
        const next = (await res.json()) as CitySnapshot;
        if (alive && Array.isArray(next.towers) && next.towers.length) useCity.getState().setSnapshot(next);
      } catch {
        // The last read stays.
      }
    };
    const wait = setTimeout(() => alive && setReady(true), READ_WAIT_MS);
    void read().finally(() => alive && setReady(true));
    const timer = setInterval(read, 60_000);
    return () => {
      alive = false;
      clearTimeout(wait);
      clearInterval(timer);
    };
  }, [initial]);

  useEffect(() => {
    if (ready && route) KINDS[route.id]!.open(route.params);
  }, [ready, route]);

  if (route === undefined) return <main className={s.outPage} />;
  if (!route) return <Gone />;
  const kind = KINDS[route.id]!;
  return (
    <>
      {kind.layers.map((Layer, i) => (
        <Layer key={i} />
      ))}
      <Alone id={route.id} params={route.params} open={kind.open} />
    </>
  );
}

/** The window itself, filling the page; and the channel to the city. */
function Alone({ id, params, open }: { id: string; params: Params; open: (params: Params) => void }) {
  const spec = useWindows((st) => st.specs[id]);
  const shown = useRef(false);
  const leaving = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const showing = useRef(params);
  // A signature out in the wallet holds the window here, as the frame's «Close» waits in the city: the city's «back»
  // waits for it.
  const held = useRef(false);
  const returnAsked = useRef(false);

  const say = (message: Message) => {
    try {
      channel.current?.postMessage(message);
    } catch {
      // No city to tell.
    }
  };

  /** Back to the city: the city takes the contents back; this page closes, or goes to the city if it cannot. */
  const back = () => {
    if (!leaving.current) say({ t: 'gone', id, size: { width: window.innerWidth, height: window.innerHeight } });
    leaving.current = true;
    window.close();
    setTimeout(() => location.assign('/'), 250);
  };

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(DETACH_CHANNEL);
    channel.current = ch;
    const here = () => ch.postMessage({ t: 'here', id, params: showing.current });
    ch.onmessage = (event) => {
      const message = parseMessage(event.data);
      if (!message) return;
      if (message.t === 'hello') return here();
      if (message.id !== id) return;
      if (message.t === 'return') {
        if (held.current) returnAsked.current = true;
        else back();
      } else if (message.t === 'follow') {
        showing.current = message.params;
        open(message.params);
      }
    };
    here();
    const bye = () => {
      if (leaving.current) return;
      leaving.current = true;
      ch.postMessage({ t: 'gone', id, size: { width: window.innerWidth, height: window.innerHeight } });
    };
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      ch.close();
      channel.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `back` reads only refs and the id
  }, [id, open]);

  useEffect(() => {
    if (spec) document.title = `${spec.title} · Ryntra`;
  }, [spec]);

  // The window's owner closed it (its tower left the market, a run): nothing left to show here, back to the city.
  useEffect(() => {
    if (spec) shown.current = true;
    else if (shown.current) back();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `back` is the same every draw
  }, [spec]);

  // The signature is done: a «back» the city asked for meanwhile happens now.
  const holding = Boolean(spec?.held);
  useEffect(() => {
    held.current = holding;
    if (!holding && returnAsked.current) back();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `back` is the same every draw
  }, [holding]);

  // A window that never stands up (its tower left the market): the city instead of a page that waits for good.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!shown.current) location.replace('/');
    }, READ_WAIT_MS + SHOW_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  return <main className={s.outPage}>{spec ? <OutWindow spec={spec} pip={false} onBack={back} /> : <div className={s.outWait} role="status" aria-label="Loading" />}</main>;
}

/** An address that is not a window: the city instead. */
function Gone() {
  useEffect(() => location.replace('/'), []);
  return <main className={s.outPage} />;
}
