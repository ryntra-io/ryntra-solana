'use client';

import { budgetPreset, type BudgetPresetId } from '@/lib/mandate/presets';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { cityDoors } from '@/city/lib/command/doors';
import { funnelSay } from '@/city/lib/crew/funnel-watch';
import { fundsFor, shortOfFunds, solAbout } from '@/city/lib/crew/funds';
import { cardReturnUrl, keepPending } from '@/city/lib/crew/resume';
import { CREW_WORDS } from '@/city/lib/crew/words';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { MONEY_OPEN } from '@/city/lib/money/flag';
import { openMoney } from '@/city/lib/money/open';
import { TRADE_OPEN } from '@/city/lib/trade/gates';
import { NEW_ACCOUNT_RENT_LAMPORTS, SWAP_SOL_RESERVE_LAMPORTS } from '@/city/lib/trade/size';
import { useWallet } from '@/city/lib/trade/wallet';
import { useHoldingsWatch, WalletPicker } from '../trade/WalletParts';

/**
 * The wallet from the agent's card (CITY-222). With no wallet in this browser the person leaves to get one; the card
 * waits for them — kept in this browser for a computer's install, asked for by the link a phone's wallet app opens
 * (`/?open=agent`) — so the way back lands on the card, not on the plain city.
 */
export function CardWalletPicker({ said, onBack }: Readonly<{ said: string; onBack: () => void }>) {
  const coin = useMandate((st) => st.coin);
  return (
    <WalletPicker
      onBack={onBack}
      back={typeof window === 'undefined' ? undefined : cardReturnUrl(window.location.origin)}
      onLeave={(to) => {
        keepPending({ said, coin });
        funnelSay('agent_wallet_app', to);
      }}
    />
  );
}

/**
 * The connected wallet holds less SOL than the budget and the agent's fees: the card cannot be signed from it, so it
 * says what is needed in one line and offers «Add SOL» (Money's top-up) where «Sign» would stand. Unknown balances, and
 * any balance above the floor, leave the card as it is.
 */
export function useFundsShort(preset: BudgetPresetId | null): Readonly<{ short: boolean; about: string | null }> {
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  // An unread SOL row is unknown, never zero; the wallet's balances are mainnet's, so they say nothing of a devnet budget.
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  const short = MANDATE_NET === 'mainnet' && !!owner && !!preset && shortOfFunds(spendable, preset);
  // While the card asks for SOL, the balance is read again — on return to the page and every 15 s — so a top-up turns
  // «Add SOL» back into «Sign» without a reload.
  useHoldingsWatch(short);
  if (!short || !preset) return { short: false, about: null };
  return { short, about: digits(solAbout(fundsFor(preset).about), lang) };
}

/**
 * What a swap keeps back of the wallet's SOL before it may spend (the trade window's own reserve, `trade/store.ts`): the
 * network's fees and, for a coin the wallet holds none of yet, its account — about 0.0044 SOL. Read the same way here,
 * so the amount written in is one the window takes.
 */
const SWAP_KEEP = SWAP_SOL_RESERVE_LAMPORTS + NEW_ACCOUNT_RENT_LAMPORTS;

/** The least a buy now may be: 0.006 SOL, about Ryntra's $1 floor. */
const BUY_NOW_MIN = 6_000_000n;

/** SOL lamports as the trade window's field takes them, to 0.0001: «0.02». */
const solText = (lamports: bigint) => (Number((lamports / 100_000n) * 100_000n) / 1e9).toString();

/**
 * CITY-246: a wallet short of the agent's budget still holds SOL — the agent's first buy now, by hand, while the budget
 * waits for «Add SOL». The coin's own trade window opens on Buy, paid in SOL, with the plan's size per trade written in
 * (all the wallet can spend when that is less); the window shows the route and the fee, and the wallet signs as always.
 * Shown only when the card names a coin, trading is open here, and the wallet's SOL was read.
 */
export function BuyNow({ preset, className }: Readonly<{ preset: BudgetPresetId; className: string }>) {
  const w = useWords(CREW_WORDS);
  const coin = useMandate((st) => st.coin);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  if (!TRADE_OPEN || !coin || typeof spendable !== 'string' || !/^\d{1,20}$/u.test(spendable)) return null;
  const room = BigInt(spendable) - SWAP_KEEP;
  if (room < BUY_NOW_MIN) return null;
  const perTrade = budgetPreset(preset).perTrade;
  const buy = () => {
    cityDoors.openTrade({ mint: coin.mint, symbol: coin.symbol, name: coin.symbol, icon: coin.icon, tower: true }, 'buy', 'swap', 'market');
    // The window keeps the coin it paid with last: this buy is the agent's, in SOL.
    cityDoors.fillPay('SOL');
    // Written as text, so it lands before the window has read the balance.
    cityDoors.fillAmount(solText(room >= perTrade ? perTrade : room));
  };
  return (
    <button type="button" className={className} onClick={buy} data-agent-buy-now="">
      {w.buyNow(coin.symbol)}
    </button>
  );
}

/** «Add SOL» with the line of what the budget needs; the line alone when Money is shut on this deployment. */
export function AddSol({ about, className, lineClass }: Readonly<{ about: string; className: string; lineClass: string }>) {
  const w = useWords(CREW_WORDS);
  return (
    <>
      <p className={lineClass} data-agent-funds="">
        {w.needSol(about)}
      </p>
      {MONEY_OPEN ? (
        <button type="button" className={className} onClick={() => openMoney('topup')} data-agent-topup="">
          {w.addSol}
        </button>
      ) : null}
    </>
  );
}
