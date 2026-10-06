import { SeasonPage, seasonMetadata } from "@/app/solana/workspace/rewards/league-pages";

export const dynamic = "force-dynamic";

export const generateMetadata = () => seasonMetadata();
export default function CurrentSeasonPage() {
  return SeasonPage();
}
