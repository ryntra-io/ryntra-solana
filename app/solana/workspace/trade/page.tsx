import { permanentRedirect } from "next/navigation";

/** Legacy deep links keep their exact pair and amount, then land on Swap. */
export default async function LegacyTradePage({
  searchParams,
}: {
  searchParams: Promise<{ in?: string; out?: string; amount?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.in) query.set("in", params.in);
  if (params.out) query.set("out", params.out);
  if (params.amount) query.set("amount", params.amount);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  permanentRedirect(`/app/swap${suffix}`);
}
