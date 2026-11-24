import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StudioEntry } from "@/city/components/characters/dev/StudioEntry";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";

/* Development only: the characters' studio — the vault guardian in every state, moment and detail level, in the city's
   light (`city/components/characters/`). Production answers 404. */
export const metadata: Metadata = { title: "Characters", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className={`${s.root} ${CITY_FONTS.className}`}>
      <StudioEntry />
    </main>
  );
}
