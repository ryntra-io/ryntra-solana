import { notFound } from "next/navigation";

import { kitOpen } from "@/terminal/shell/flag";
import { Kit } from "@/terminal/shell/kit/Kit";
import { SHELF_IDS, isShelfId } from "@/terminal/shell/shelves";

/* One shelf's preview inside the kit page: the rail lights that shelf, the header's line hands its sentences here, and
   the browser's Back walks between the previews as it will between the screens. A stand only. */
export const dynamicParams = false;

export function generateStaticParams() {
  return SHELF_IDS.map((shelf) => ({ shelf }));
}

export default async function Page({ params }: { params: Promise<{ shelf: string }> }) {
  const { shelf } = await params;
  if (!kitOpen() || !isShelfId(shelf)) notFound();
  return <Kit shelf={shelf} />;
}
