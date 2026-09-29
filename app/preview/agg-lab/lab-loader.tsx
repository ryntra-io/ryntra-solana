"use client";

import dynamic from "next/dynamic";

import styles from "./lab.module.css";

/*
 * The lab is client-only. The aggregator's pages read `localStorage` for the
 * signed-in hint, open a WebSocket on mount and size their charts from the
 * viewport, none of which has a server-rendered form worth shipping — so the
 * shell is loaded in the browser and the server sends the gate and a frame.
 */
const AggLab = dynamic(() => import("./agg-lab").then((m) => m.AggLab), {
  ssr: false,
  loading: () => (
    <div className={styles.boot} aria-busy="true">
      <p className={styles.bootLine}>AGG Lab завантажується…</p>
    </div>
  ),
});

export function LabLoader({ appId }: { appId: string }) {
  return <AggLab appId={appId} />;
}
