"use client";
import Link from "next/link";
import { useWalletData } from "@/app/app/wallet-data";
import { useSolanaI18n } from "../i18n/provider";
export function MoneyContext(props:{span?:number;holdings?:readonly unknown[]|null}) {
 const {owner,activity}=useWalletData();const {locale}=useSolanaI18n();const uk=locale==="uk";
 if(!owner||activity.status!=="ready")return null;
 const rows=activity.data.filter(x=>x.lane!=="SWAP").slice(0,Math.min(3,props.span??3));
 if(rows.length===0)return null;
 return <section className="ry-money-recent"><header><h2>{uk?"Останні перекази":"Recent transfers"}</h2><Link href="/app/activity">{uk?"Усі":"View all"}</Link></header><ul>{rows.map(x=><li key={x.actionId}><Link href={"/app/activity?action="+encodeURIComponent(x.actionId)}><span>{x.lane==="BRIDGE"?(x.destination==="SOLANA"?(uk?"На Solana":"To Solana"):x.destination==="BASE"?"Solana → Base":x.destination==="ETHEREUM"?"Solana → Ethereum":uk?"Між мережами":"Between networks"):x.lane==="RECEIVE"?(uk?"Отримано":"Received"):(uk?"Переказ":"Transfer")}</span><time dateTime={x.updatedAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium"}).format(new Date(x.updatedAt))}</time></Link></li>)}</ul></section>;
}
