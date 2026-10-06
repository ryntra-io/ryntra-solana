import { SeasonPage, seasonMetadata } from "@/app/solana/workspace/rewards/league-pages";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ season: string }> };

export function generateMetadata({ params }: Props) {
  return seasonMetadata({ params });
}

export default function SeasonByNumberPage({ params }: Props) {
  return SeasonPage({ params });
}
