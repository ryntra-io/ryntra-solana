import type { SolanaWalletAction } from "../../lib/solana/action-ledger";
import { isSolanaActionLane, isSolanaActionOutcome } from "../../lib/solana/action-lanes.ts";

export type WalletHolding = Readonly<{
  kind?: "NATIVE_SOL" | "TOKEN";
  mint: string | null;
  amountRaw: string;
  decimals: number;
  symbol: string | null;
  name?: string | null;
  catalog?: Readonly<{symbol: string | null;name: string | null;usdPrice: string | null;isVerified?:boolean|null;icon?:string|null;category?:string|null;dayChangePct?:number|null}> | null;
  /** 1.15.0: the mint's Scaled UI Amount multiplier in force — the wallet shows `amountRaw × uiMultiplier` and the catalogue prices that unit; absent where the mint carries none or was not read. */
  uiMultiplier?: number | null;
}>;

/** A multiplier as an exact ratio of integers, nine decimals deep — enough for any the chain states (OpenAI's 1.4861347, SpaceX's 5). */
function multiplierParts(multiplier: number | null | undefined): Readonly<{ num: bigint; den: bigint }> | null {
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) return null;
  const den = 1_000_000_000n;
  return { num: BigInt(Math.round(multiplier * 1e9)), den };
}

/** The amount as the wallet shows it, in raw units of the shown unit: a scaled mint's raw amount times its multiplier. */
export function shownRaw(holding: Pick<WalletHolding, "amountRaw" | "uiMultiplier">): bigint {
  const raw = BigInt(holding.amountRaw);
  const parts = multiplierParts(holding.uiMultiplier);
  return parts ? (raw * parts.num) / parts.den : raw;
}

export function decodeWalletCollection(ok:boolean,payload:unknown,kind:"holdings"|"activity"):{data:readonly WalletHolding[]|readonly SolanaWalletAction[];complete:boolean} {
  if(!ok || typeof payload!=="object" || payload===null || !("data" in payload)) throw new Error("READ_FAILED");
  const body=payload.data;
  if(typeof body!=="object" || body===null) throw new Error("READ_FAILED");
  const key=kind==="holdings"?"holdings":"actions";
  const rows=(body as Record<string,unknown>)[key];
  if(!Array.isArray(rows)) throw new Error("READ_FAILED");
  /* A lane this build does not know costs one row, not the page: it is dropped
     and the read reports itself incomplete, which the surfaces already word as
     "Some activity could not be loaded".

     That sentence was written here on 2026-09-07, after the first `RECEIVE` row
     — a paid payment request — turned every Activity, Home and
     Portfolio read of that wallet into "could not be loaded". The fix at the
     time added one string to a list copied by hand from the ledger, because the
     ledger reaches the Guard store and a browser cannot import it. On
     2026-09-08 the first `CROSS_SWAP` row did exactly the same thing,
     minutes after the swap itself had settled correctly on both chains. The
     list now lives in `action-lanes.ts`, which imports nothing and is imported
     here rather than retyped. */
  const kept:unknown[]=[];
  let dropped=false;
  for(const row of rows) {
    if(typeof row!=="object" || row===null) throw new Error("READ_FAILED");
    if(kind==="holdings" && (typeof row.amountRaw!=="string" || !/^\d+$/.test(row.amountRaw) || !Number.isInteger(row.decimals) || row.decimals<0 || row.decimals>255)) throw new Error("READ_FAILED");
    if(kind==="activity") {
      const action=row as Record<string,unknown>;
      if(typeof action.actionId!=="string") throw new Error("READ_FAILED");
      if(!isSolanaActionLane(action.lane) || !isSolanaActionOutcome(action.outcome)) { dropped=true; continue; }
    }
    kept.push(row);
  }
  const source=body as Record<string,unknown>;
  return {data:kept as readonly WalletHolding[]|readonly SolanaWalletAction[],complete:kind==="activity"?source.complete===true&&!dropped:source.tokenRead==="COMPLETE"};
}

export function holdingValue(holding:WalletHolding):bigint|null {
  const price=holding.catalog?.usdPrice;
  const match=typeof price==="string" && price.length<=128 ? /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(price) : null;
  if(!match) return null;
  const decimals=(match[2]?.length??0)-Number(match[3]??0);
  const numerator=BigInt(match[1]+(match[2]??""));
  if(numerator===0n) return null;
  const scale=holding.decimals+decimals;
  /* The catalogue prices the unit the wallet shows: a scaled mint's raw amount is first multiplied (1.15.0; a PreStocks SPACEX is ×5). */
  const value=shownRaw(holding)*numerator*1_000_000n;
  return scale>=0 ? value/(10n**BigInt(scale)) : value*(10n**BigInt(-scale));
}

export function walletValue(holdings:readonly WalletHolding[]) {
  let total=0n,unpriced=0;
  for(const holding of holdings) {const value=holdingValue(holding);if(value===null)unpriced++;else total+=value;}
  return {total,unpriced,priced:holdings.length-unpriced};
}

export function usdValue(value:bigint):string {
  if(value>0n && value<10_000n) return "<$0.01";
  return `$${(value/1_000_000n).toLocaleString("en-US")}.${((value%1_000_000n)/10_000n).toString().padStart(2,"0")}`;
}

/** The same figure in the reader's language: «$1 234,56» in Ukrainian, «$1,234.56» in English — Home and Portfolio write a sum alike. */
export function usdValueIn(value:bigint,locale:"en"|"uk"):string {
  const english=usdValue(value);
  if(locale!=="uk") return english;
  const match=/^(<)?\$([\d,]+)\.(\d{2})$/.exec(english);
  return match?`${match[1]??""}$${match[2].replace(/,/g," ")},${match[3]}`:english;
}

export function holdingSymbol(holding:WalletHolding):string {
  if(holding.kind==="NATIVE_SOL") return "SOL";
  return holding.catalog?.symbol??holding.symbol??(holding.mint?`${holding.mint.slice(0,4)}…${holding.mint.slice(-4)}`:"SOL");
}

const EMPTY_WALLET_ROWS: readonly never[] = Object.freeze([]);

/** A balance belongs to the wallet that was read, including during an effect transition. */
export function walletRowsForOwner<T>(snapshot: { owner: string; rows: readonly T[] } | null, owner: string | null): readonly T[] {
  return owner !== null && snapshot?.owner === owner ? snapshot.rows : EMPTY_WALLET_ROWS;
}
