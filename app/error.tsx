"use client";

import { useEffect } from "react";

import { Lost } from "@/city/components/open/Lost";

/* A page that breaks while it is drawn is the city's own 500 (CITY-159): one line and one way back — to the city's
   home, a full load, so whatever broke starts again clean. The error goes to the console for whoever is looking; the
   person sees nothing of it. The root layout breaking is `global-error.tsx`. */

export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <Lost kind="broken" />;
}
