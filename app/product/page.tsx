import { Homepage } from "@/app/(home)/homepage";
import { buildMetadata } from "@/app/seo";
import { publicServerLocale } from "@/lib/site/server-locale";

export const revalidate = 3600;

/* Keep the former public product entry on the same approved customer story.
   Its old screenshots advertised a retired cabinet and internal control text. */
export async function generateMetadata() {
  return buildMetadata(await publicServerLocale());
}

export default async function ProductPage() {
  return <Homepage locale={await publicServerLocale()} />;
}