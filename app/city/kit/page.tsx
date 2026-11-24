import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GalleryEntry } from "@/city/components/quarter/kit/GalleryEntry";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";

/* Development only: the quarter's building kit, every kind at every level, in the city's light (`city/components/quarter/kit/`).
   Production answers 404. */
export const metadata: Metadata = { title: "Quarter kit", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className={`${s.root} ${CITY_FONTS.className}`}>
      <GalleryEntry />
    </main>
  );
}
