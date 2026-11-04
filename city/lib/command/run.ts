import type { AgentAsk } from '../autopilot/read.ts';
import type { DollarAsk } from '../earn/dollar-read.ts';
import type { Instruction } from '../instruct/types.ts';
import type { Base, Coin, Command, MoneyPlace, Side, View } from './parse.ts';

/**
 * What a command may do in the city (CITY-85): open a window and write into its fields — nothing else. Every door
 * here opens or fills; none of them presses a window's button, builds an order, opens the wallet or sends anything.
 * The person reads the filled window and confirms it there, then signs in their own wallet (helm SPEC §8: «⌘K only
 * opens a filled window and never signs»). Ryntra's door only asks a question; Ryntra only advises.
 *
 * The doors are a plain object so the tests can hold every command up to them and see which doors it knocked on
 * (`command.test.mjs`): the city's own are `city/lib/command/doors.ts`.
 */
export type Doors = Readonly<{
  /** The coin's trade window, on this side and face; a limit or stop on its Spot face. */
  openTrade: (coin: Coin, side: Side, view: View, mode: 'market' | 'limit' | 'stop') => void;
  /** What the open trade window pays with (buying) or is paid in (selling). */
  fillPay: (asset: Base) => void;
  /** The amount field of the open trade window, as the person said it. */
  fillAmount: (text: string) => void;
  /** A share of what the wallet can spend, 1–100, written into the amount field by the window itself. */
  fillShare: (share: number) => void;
  /** The price of a limit or a stop, in dollars, once the window shows the field. */
  fillPrice: (text: string) => void;
  openChart: (coin: Coin) => void;
  /** The coin's own window, as a tap on its tower opens it. */
  openCoin: (coin: Coin) => void;
  /** A pasted address the city does not know: named by the engine first, then opened. */
  openMint: (mint: string) => void;
  openMoney: (place: MoneyPlace) => void;
  /** Send's recipient, amount and coin, as said; the window checks the address and asks for the review itself. */
  fillSend: (fill: Readonly<{ to: string | null; amount: string | null; asset: Coin | null }>) => void;
  openEarn: () => void;
  /** The launch sheet, with the ticker and the name when said; a launch under way is never touched. */
  openLaunch: (draft: Readonly<{ symbol: string | null; name: string | null }>) => void;
  /** Ryntra's panel, asking the question: advice only. */
  askRyntra: (question: string) => void;
  /** The agent's card with the instruction read (CITY-176): it shows what will be set; the person signs there. */
  openInstruction: (instruction: Instruction) => void;
  /** «My instructions»: what the agent set from sentences. */
  openInstructions: () => void;
  /** The agent on its word (CITY-175): the card with the budget or the launch it prepared; the person signs there. */
  openAutopilot: (ask: AgentAsk) => void;
  /** The Dollar Saver's card with the coin, the side and the amount said (CITY-192); the person signs there. */
  openDollar: (ask: DollarAsk) => void;
}>;

export type DoorName = keyof Doors;

/** Every door a command may knock on: each opens a window, fills a field, or asks Ryntra. */
export const DOORS: readonly DoorName[] = [
  'openTrade',
  'fillPay',
  'fillAmount',
  'fillShare',
  'fillPrice',
  'openChart',
  'openCoin',
  'openMint',
  'openMoney',
  'fillSend',
  'openEarn',
  'openLaunch',
  'askRyntra',
  'openInstruction',
  'openInstructions',
  'openAutopilot',
  'openDollar',
];

/** One command through the doors: the window first, then its fields, in the order a person would fill them. */
export function run(command: Command, doors: Doors): void {
  switch (command.kind) {
    case 'buy':
    case 'sell': {
      doors.openTrade(command.coin, command.kind, command.view, 'market');
      const asset = command.kind === 'buy' ? command.pay : command.into;
      if (asset) doors.fillPay(asset);
      if (command.amount) doors.fillAmount(command.amount);
      else if (command.share !== null) doors.fillShare(command.share);
      return;
    }
    case 'order':
      doors.openTrade(command.coin, command.side, 'spot', command.mode);
      // A price said aloud is dollars: the window prices the pair in what it pays with, so it pays in USDC. USDC's own
      // price cannot be said in dollars, so none is written for it.
      if (command.price && command.coin.symbol !== 'USDC') {
        doors.fillPay('USDC');
        doors.fillPrice(command.price);
      }
      return;
    case 'chart':
      return doors.openChart(command.coin);
    case 'coin':
      return doors.openCoin(command.coin);
    case 'mint':
      return doors.openMint(command.mint);
    case 'money':
      doors.openMoney(command.place);
      if (command.place === 'send' && command.send && (command.send.to || command.send.amount)) doors.fillSend(command.send);
      return;
    case 'earn':
      return doors.openEarn();
    case 'launch':
      return doors.openLaunch({ symbol: command.symbol, name: command.name });
    case 'ask':
      return doors.askRyntra(command.question);
    case 'instruct':
      return doors.openInstruction(command.instruction);
    case 'instructions':
      return doors.openInstructions();
    case 'autopilot':
      return doors.openAutopilot(command.ask);
    case 'dollar':
      return doors.openDollar(command.ask);
  }
}
