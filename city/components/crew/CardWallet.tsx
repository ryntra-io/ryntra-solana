'use client';

import type { BudgetPresetId } from '@/lib/mandate/presets';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { funnelSay } from '@/city/lib/crew/funnel-watch';
import { fundsFor, shortOfFunds, solAbout } from '@/city/lib/crew/funds';
import { cardReturnUrl, keepPending } from '@/city/lib/crew/resume';
import { CREW_WORDS } from '@/city/lib/crew/words';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { MONEY_OPEN } from '@/city/lib/money/flag';
import { openMoney } from '@/city/lib/money/open';
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
