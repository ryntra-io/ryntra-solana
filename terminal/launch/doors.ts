import type { Doors } from '../../city/lib/command/run.ts';

/**
 * The doors a sentence from the agent's line may knock on at the Launch screen (`city/lib/command/run.ts`): «launch me a
 * token», «запусти мені токен Kite $KITE» write the ticker and the name into the form — and, where the pool's door is
 * open, «… в пул о 20:00» its time and pair. No door here stores a picture, builds a launch, opens the wallet or sends
 * anything: the person reads the filled form and presses «Launch» there.
 */

const nothing = () => {};

/** The doors of the Launch screen: `fill` writes a sentence's launch into the form; every other door leads nowhere here. */
export function launchDoors(fill: Doors['openLaunch']): Doors {
  return {
    openLaunch: fill,
    // Sentences of other shelves never lead to the Launch screen.
    openTrade: nothing,
    fillPay: nothing,
    fillAmount: nothing,
    fillShare: nothing,
    fillPrice: nothing,
    openChart: nothing,
    openCoin: nothing,
    openMint: nothing,
    openMoney: nothing,
    fillSend: nothing,
    openEarn: nothing,
    askRyntra: nothing,
    openInstruction: nothing,
    openInstructions: nothing,
    openAutopilot: nothing,
    openLearn: nothing,
    openDollar: nothing,
    openPilot: nothing,
    openCrew: nothing,
    openLadder: nothing,
  };
}
