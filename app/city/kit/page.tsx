import type { Metadata } from "next";
import { Hubot_Sans, Mona_Sans } from "next/font/google";
import { notFound } from "next/navigation";

import { GalleryEntry } from "@/city/components/quarter/kit/GalleryEntry";
import s from "@/city/styles/city.module.css";

/* Development only: the quarter's building kit, every kind at every level, in the city's light (`city/components/quarter/kit/`).
   Production answers 404. */
const display = Hubot_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
const ui = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = { title: "Quarter kit", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className={`${s.root} ${display.variable} ${ui.variable}`}>
      <GalleryEntry />
    </main>
  );
}
