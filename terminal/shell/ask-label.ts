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
    case 'order':
      return command.mode === 'stop' ? w.stop(sym(command.coin.symbol)) : w.limit(sym(command.coin.symbol), command.side === 'buy');
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
    case 'instruct':
      return w.instruct;
    case 'instructions':
      return w.instructions;
    case 'autopilot':
      return command.ask.kind === 'trade' ? w.agentTrade : w.agentLaunch;
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
