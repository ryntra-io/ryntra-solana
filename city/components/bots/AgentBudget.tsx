'use client';

import { useEffect, useId, useState } from 'react';
import { syncAgents } from '@/city/lib/bots/agents';
import { MANDATE_NET, MANDATE_PRESETS, presetLimits, useMandate } from '@/city/lib/bots/mandate';
import { agentCoins, bookNow } from '@/city/lib/command/doors';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import { sol } from '@/city/lib/bots/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { CheckGlyph, ChevronGlyph, SparkGlyph } from './glyphs';
import { WalletList } from './Ladder';
import { useWords } from './hooks';
import s from './bots.module.css';

/**
 * «Your agent» on top of the bots window's Start (CITY-174): the budget in one tap, the limits in one line, «Sign».
 * The person's wallet signs once and the agent trades by itself inside limits the chain holds; while it works, the
 * budget left and «Stop» — one more signature, the rest back to her wallet. Behind `NEXT_PUBLIC_RYNTRA_CITY_MANDATE`
 * (devnet, or mainnet with 0.1 SOL a day and the coin she picks); the signing loads on the tap (`mandate-sign.ts`).
 */
export function AgentBudget() {
  const { w, lang } = useWords();
  const m = w.mandate;
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const preset = useMandate((st) => st.preset);
  const busy = useMandate((st) => st.busy);
  const note = useMandate((st) => st.note);
  const record = useMandate((st) => (owner ? st.records[owner] : undefined));
  const coin = useMandate((st) => st.coin);
  const status = useMandate((st) => (record ? st.status[record.policy] : undefined));
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const detailsId = useId();

  useEffect(() => {
    useMandate.getState().hydrate();
  }, []);

  // CITY-207: the engine's book over this browser's note — the agent hired on another device shows here too.
  useEffect(() => {
    if (owner && MANDATE_NET) void syncAgents(owner);
  }, [owner]);

  // The mandate's state on devnet, read when the wallet's mandate is known and now and then while the window is open.
  useEffect(() => {
    if (!record) return;
    let live = true;
    const read = async () => {
      const { readStatus } = await import('@/city/lib/bots/mandate-sign');
      const answer = await readStatus(record);
      if (live && answer) useMandate.getState().setStatus(record.policy, answer);
    };
    void read();
    const timer = setInterval(() => document.visibilityState === 'visible' && void read(), 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [record]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => {
      if (useMandate.getState().note === note) useMandate.getState().say(null);
    }, 8_000);
    return () => clearTimeout(timer);
  }, [note]);

  if (!MANDATE_NET) return null;
  const working = Boolean(record && status?.active);
  const limits = presetLimits(preset);
  const workingLimits = record ? { perTrade: Number(record.perTrade) / 1e9, perDay: Number(record.perDay) / 1e9 } : null;
  const left = status?.budgetLamports ? Number(status.budgetLamports) / 1e9 : null;
  const fee = agentFeeFigures(lang);
  const facts = [...m.facts, m.feeRates(fee.major, fee.stock, fee.trending, fee.meme), m.feeInside];
  const needsCoin = MANDATE_NET === 'mainnet';
  const coins = needsCoin ? agentCoins(bookNow()) : [];
  const picked = coin ?? null;

  const sign = async () => {
    if (!connection) {
      const { wallets, connect } = useWallet.getState();
      if (wallets.length === 1) void connect(wallets[0]!.name);
      else setPicking(true);
      return;
    }
    const { tapEnable } = await import('@/city/lib/bots/mandate-sign');
    await tapEnable({ wallet: connection.wallet, owner: connection.address });
  };
  const stop = async () => {
    if (!connection || !record) return;
    const { tapStop } = await import('@/city/lib/bots/mandate-sign');
    await tapStop({ wallet: connection.wallet, owner: connection.address }, record);
  };

  return (
    <section className={s.agentBudget} aria-label={m.title} data-mandate={working ? 'working' : 'start'}>
      <header className={s.agentBudgetHead}>
        <span className={s.ryntraName}>
          <SparkGlyph size={18} />
          {m.title}
        </span>
        {working ? <span className={s.agentLive}>{m.working}</span> : null}
      </header>

      {working && workingLimits ? (
        <>
          <p className={s.agentFigure}>{left !== null ? m.left(sol(left, lang)) : m.working}</p>
          <p className={s.cost} data-live="">
            <span>{m.limits(sol(workingLimits.perTrade, lang), sol(workingLimits.perDay, lang), Math.max(0, Math.ceil((Number(record!.expiresAt) * 1000 - Date.now()) / 86_400_000)))}</span>
          </p>
          <button type="button" className={s.primary} onClick={() => void stop()} disabled={busy !== null} aria-busy={busy === 'stop'} data-mandate-stop="">
            {busy === 'stop' ? m.stopping : m.stop}
          </button>
        </>
      ) : (
        <>
          {needsCoin ? (
            <div className={s.chips} role="radiogroup" aria-label={m.coin}>
              {(picked && !coins.some((c) => c.mint === picked.mint) ? [{ mint: picked.mint, symbol: picked.symbol, icon: picked.icon }, ...coins.slice(0, 3)] : coins).map((c) => (
                <button key={c.mint} type="button" role="radio" aria-checked={c.mint === picked?.mint} className={c.mint === picked?.mint ? s.chipOn : undefined} onClick={() => useMandate.getState().setCoin({ mint: c.mint, symbol: c.symbol, icon: c.icon })}>
                  {c.symbol}
                </button>
              ))}
            </div>
          ) : null}
          {MANDATE_PRESETS.length > 1 ? (
            <div className={s.chips} role="radiogroup" aria-label={m.budget}>
              {MANDATE_PRESETS.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={id === preset} className={id === preset ? s.chipOn : undefined} onClick={() => useMandate.getState().setPreset(id)}>
                  {m.amount(sol(presetLimits(id).budget, lang))}
                </button>
              ))}
            </div>
          ) : (
            <p className={s.agentFigure}>{m.amount(sol(limits.budget, lang))}</p>
          )}
          <p className={s.cost} data-live="">
            <span>{m.limits(sol(limits.perTrade, lang), sol(limits.perDay, lang), limits.days)}</span>
          </p>
          <p className={s.cost} data-mandate-fee="">
            <span>{m.fee(fee.low, fee.high)}</span>
          </p>
          {picking && !connection ? <WalletList /> : null}
          <button type="button" className={s.primary} onClick={() => void sign()} disabled={busy !== null || (needsCoin && !picked && Boolean(connection))} aria-busy={busy === 'enable'} data-mandate-sign="">
            {busy === 'enable' ? m.signing : connection ? m.sign : m.connect}
          </button>
        </>
      )}

      <button type="button" className={s.more} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)} data-open={open ? '' : undefined}>
        {m.details}
        <ChevronGlyph />
      </button>
      {open ? (
        <ul id={detailsId} className={s.reasons}>
          {facts.map((fact) => (
            <li key={fact}>
              <CheckGlyph />
              {fact}
            </li>
          ))}
        </ul>
      ) : null}

      {note ? (
        <p className={s.liveNote} data-kind={note.kind === 'on' || note.kind === 'stopped' ? 'placed' : note.kind} role="status">
          {m.note[note.kind]}
        </p>
      ) : null}
    </section>
  );
}
