import { fetchTokenCatalog } from "@/lib/solana/catalog";
import { PageHead } from "../hub/parts";
import { FEATURED_MINTS } from "../assets/featured";
import { MarketList } from "./market-list";
export const metadata={title:"Markets"};
const USDC="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL="So11111111111111111111111111111111111111112";
function price(raw:string|null|undefined){if(!raw)return null;const n=Number(raw);if(!Number.isFinite(n)||n<=0)return null;return "$"+(n>=1?n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):n.toPrecision(3));}
export default async function MarketsPage(){const catalog=await fetchTokenCatalog(FEATURED_MINTS.map(x=>x.mint));return <><PageHead title="Markets"/><MarketList available={catalog.ok} rows={FEATURED_MINTS.map(x=>({mint:x.mint,symbol:x.code,name:catalog.ok?catalog.byMint[x.mint]?.name??null:null,price:price(catalog.ok?catalog.byMint[x.mint]?.usdPrice:null),swapHref:"/app/swap?in="+x.mint+"&out="+(x.mint===USDC?SOL:USDC)}))}/></>;}
