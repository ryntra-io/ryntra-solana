import type { Command } from '../../city/lib/command/parse.ts';
import { digits, type Same } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import { shortAddress } from '../../city/lib/trade/format.ts';
import { ASK } from './words.ts';

type AskWords = Same<(typeof ASK)['en']>;

/** A ticker as the rows write it: no leading $. */
const sym = (symbol: string) => symbol.replace(/^\$+/u, '');

/** What a buy pays: «$50» when no coin was said (a bare number is dollars), else «0.5 SOL». */
function paid(amount: string | null, pay: 'SOL' | 'USDC' | null, share: number | null): string {
  if (amount) return pay ? `${amount} ${pay}` : `$${amount}`;
  return share !== null ? `${share}%` : '';
}

/** What a row under the agent's line says, in the language given: the action and its numbers, nothing technical. */
export function askLabel(command: Command, lang: Lang): string {
  const w: AskWords = ASK[lang];
  const n = (text: string) => digits(text, lang);
  switch (command.kind) {
    case 'buy':
      return w.buy(sym(command.coin.symbol), n(paid(command.amount, command.pay, command.share)));
    case 'sell':
      return w.sell(sym(command.coin.symbol), n(command.amount ? `${command.amount} ${sym(command.coin.symbol)}` : command.share !== null ? `${command.share}%` : ''));
    case 'order': {
      const coin = sym(command.coin.symbol);
      // A conditional order says its per cent: «Buy ANT 5% lower».
      if (command.off !== undefined) {
        const pct = n(String(Math.abs(command.off) / 100));
        return command.mode === 'stop' ? w.stopOff(coin, pct) : w.limitOff(coin, command.side === 'buy', pct);
      }
      return command.mode === 'stop' ? w.stop(coin) : w.limit(coin, command.side === 'buy');
    }
    case 'ladder':
      return w.ladder(sym(command.ask.coin.symbol), command.ask.action === 'buy');
    case 'chart':
    case 'coin':
      return w.coin(sym(command.coin.symbol));
    case 'mint':
      return w.mint(shortAddress(command.mint));
    case 'money':
      return command.place === 'portfolio' ? w.portfolio : command.place === 'activity' ? w.activity : command.place === 'topup' ? w.topup : command.place === 'send' ? w.send : command.place === 'bridge' ? w.bridge : w.topup;
    case 'earn':
      return w.earn;
    case 'dollar':
      return w.dollar;
    case 'launch':
      return w.launch(command.symbol ? `$${sym(command.symbol)}` : '');
    // A regular purchase opens Recurring buys: the row says the coin and the sum with its rhythm, as said.
    case 'instruct': {
      const order = command.instruction;
      if (order.kind !== 'recurring') return w.instruct;
      const every = order.cadence === 'daily' ? w.everyDay : order.cadence === 'weekly' ? w.everyWeek : order.cadence === 'monthly' ? w.everyMonth : '';
      const sum = order.usd ? `${n(`$${order.usd}`)}${every ? ` ${every}` : ''}` : every;
      return w.recurring([order.coin ? sym(order.coin.symbol) : '', sum].filter(Boolean).join(' · '));
    }
    case 'instructions':
      return w.instructions;
    // New launches bought early open the market's new coins (`targetOf`), not a budget: the row says where it leads.
    case 'autopilot':
      return command.ask.kind !== 'trade' ? w.agentLaunch : command.ask.plan?.id === 'early' ? w.newCoins : w.agentTrade;
    case 'pilot':
      return w.pilot;
    case 'hire':
      return w.hire;
    case 'learn':
      return w.learn;
    case 'ask':
      return w.ask(command.question);
  }
}
