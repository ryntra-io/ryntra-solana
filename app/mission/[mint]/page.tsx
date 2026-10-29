import type { Metadata } from "next";
import { notFound } from "next/navigation";

import "@/lib/mission-control/engines/control-room.css";
import { MissionStage } from "@/app/components/mission-control/stage";
import { buildMissionControlMetadata } from "@/app/seo";
import { BASE58 } from "@/lib/api/v1/contract";
import { missionHref, postMoments, reachedMoments } from "@/lib/mission-control/scene";
import { readSceneMission } from "@/lib/mission-control/scene.server";
import { MISSION_CONTROL_WORDS as W } from "@/lib/mission-control/words";

import { MissionPost } from "./mission-post";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ mint: string }> };

/* A mission's own page — its Control Room (MC-0, decision 68): the room looking through its window at the mission, its
   flight and checks live from the chain (`lib/mission-control/engines/control-room.js`). The page reads the mission
   once on the server for its title and its card for X; the room then reads on its own. A post goes out through X's
   web intent — the person posts it, with the card of the newest moment the mission truly reached. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mint } = await params;
  if (!BASE58.test(mint)) return {};
  const mission = await readSceneMission(mint);
  if (!mission) return { ...buildMissionControlMetadata({ title: "Control Room · Ryntra", description: W.description }, missionHref(mint)), robots: { index: false, follow: true } };
  const moment = reachedMoments(mission).at(-1) ?? "launch";
  return buildMissionControlMetadata(
    { title: W.controlRoomTitle(mission.ticker), description: W.controlRoomDescription(mission.ticker, mission.name) },
    missionHref(mint),
    `/api/launch/mission-card?mint=${mint}&moment=${moment}`,
  );
}

export default async function Page({ params }: Props) {
  const { mint } = await params;
  if (!BASE58.test(mint)) notFound();
  const mission = await readSceneMission(mint);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang="en";document.documentElement.dir="ltr";` }} />
      <MissionStage scene="control-room" focus={mint} className="mc-control-room">
        <h1 className="mc-sr-only">{mission ? `${mission.ticker} — ${mission.name}` : "Control Room"}</h1>
        {/* The server's read gives the moments at once when it answers in time; otherwise the room's first live snapshot does. */}
        <MissionPost mint={mint} initial={mission ? postMoments(mission) : []} />
      </MissionStage>
    </>
  );
}
