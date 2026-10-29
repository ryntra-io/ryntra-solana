import type { Metadata } from "next";
import { Hubot_Sans, Mona_Sans } from "next/font/google";
import { notFound } from "next/navigation";

import { BridgeStandEntry } from "@/city/components/bridge/BridgeStandEntry";
import s from "@/city/styles/city.module.css";

/* Development only: the stand for the bridge between the city and the Ryntra app (CITY-6b, docs/city/APP-BRIDGE.md).
   With `?bridge=mock` a fake app answers every request, its wallet a throwaway key; each answer can be switched to a
   no, a failure, busy, unsupported or silence. Production answers 404. */
const display = Hubot_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
const ui = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = { title: "Bridge stand", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className={`${s.root} ${display.variable} ${ui.variable}`}>
      <BridgeStandEntry />
    </main>
  );
}
