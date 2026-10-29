import type { Metadata } from "next";

import "@/lib/mission-control/engines/launch-night.css";
import { MissionStage } from "@/app/components/mission-control/stage";
import { WindowClock } from "@/app/components/mission-control/window-clock";
import { buildMissionControlMetadata } from "@/app/seo";
import { MISSION_CONTROL_WORDS as W } from "@/lib/mission-control/words";

/* Launch Night — Mission Control's broadcast mode (MC-0, decision 68): the missions in flight, live from the chain,
   framed for streams and big screens (`lib/mission-control/engines/launch-night.js`). Duels, Crew Power and Flight
   Calls are MC-4's; until then the broadcast shows the real sky, and its demo duel says DEMO. `?clean=1` leaves the
   scene, the scoreboard and the lower third — an overlay for a streamer. */
export const metadata: Metadata = buildMissionControlMetadata({ title: W.launchNightTitle, description: W.launchNightDescription }, "/live");

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const clean = (await searchParams).clean === "1";
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang="en";document.documentElement.dir="ltr";` }} />
      <MissionStage scene="launch-night" className={clean ? "mc-launch-night is-clean" : "mc-launch-night"}>
        <h1 className="mc-sr-only">Launch Night — live from the chain</h1>
        {/* MC-2: the launch windows' clock — the broadcast counts down with the schedule. */}
        <WindowClock variant="night" />
      </MissionStage>
    </>
  );
}
