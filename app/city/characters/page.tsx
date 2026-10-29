import type { Metadata } from "next";
import { Hubot_Sans, Mona_Sans } from "next/font/google";
import { notFound } from "next/navigation";

import { StudioEntry } from "@/city/components/characters/dev/StudioEntry";
import s from "@/city/styles/city.module.css";

/* Development only: the characters' studio — the vault guardian in every state, moment and detail level, in the city's
   light (`city/components/characters/`). Production answers 404. */
const display = Hubot_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
const ui = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = { title: "Characters", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className={`${s.root} ${display.variable} ${ui.variable}`}>
      <StudioEntry />
    </main>
  );
}
