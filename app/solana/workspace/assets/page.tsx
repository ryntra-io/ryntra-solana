import Link from "next/link";
import { fetchRawMintAccount } from "@/lib/solana/mint";
import { buildPassport } from "@/lib/solana/passport";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";
import { fetchTokenCatalog } from "@/lib/solana/catalog";
import { scaleRawAmount } from "@/lib/solana/amounts";
import { explorerAddressUrl } from "@/lib/solana/explorer";
import { SharePassport } from "@/app/assets/[mint]/share";
import { solanaServerText } from "../i18n/server";
import { FEATURED_MINTS } from "./featured";
import styles from "./asset-view.module.css";

const MINT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const READ_ERRORS={ACCOUNT_NOT_FOUND:"No account was found at this address",NOT_A_MINT:"This address is not a token",DECODE_FAILED:"This token could not be read",RPC_FAILED:"Could not load this asset. Try again."} as const;
type Props={searchParams:Promise<{mint?:string}>};
export async function generateMetadata({searchParams}:Props){const {mint}=await searchParams;const {text}=await solanaServerText();const known=FEATURED_MINTS.find(x=>x.mint===mint);return {title:known?.code??(text("Asset"))};}

export default async function AssetPage({searchParams}:Props){
 const {mint}=await searchParams; const {locale,text,meaning}=await solanaServerText();
 const valid=typeof mint==="string"&&MINT.test(mint);
 const handle=createSolanaRpcHandle({network:"mainnet",timeoutMs:8000,retries:1});
 const [raw,catalog]=valid?await Promise.all([fetchRawMintAccount(handle,mint),fetchTokenCatalog([mint])]):[null,null];
 const built=raw&&!("ok" in raw)?buildPassport(raw):null;
 const passport=built?.ok?built.passport:null;
 const info=catalog?.ok&&mint?catalog.byMint[mint]:null;
 const symbol=info?.symbol??FEATURED_MINTS.find(x=>x.mint===mint)?.code??(mint?mint.slice(0,4)+"…"+mint.slice(-4):null);
 const error=mint&&!valid?text("Check the token address"):raw&&"ok" in raw?text(READ_ERRORS[raw.code]):built&&!built.ok?text("The token's transfer rules could not be read"):null;
 return <div className={styles.asset}>
   <header className={styles.header}><h1>{symbol??(text("Assets"))}</h1><Link className="rw-btn" href="/app/swap">{text("Back to Terminal")}</Link></header>
   <form className={styles.find} action="/app/assets" method="get"><label htmlFor="asset-mint">{text("Token address")}</label><div><input id="asset-mint" name="mint" defaultValue={mint??""} autoComplete="off" spellCheck={false} required aria-describedby={error?"asset-error":undefined}/><button className="rw-btn" type="submit">{text("Open")}</button></div></form>
   {error?<p id="asset-error" role="alert" className={styles.error}>{error}</p>:null}
   {!mint?<nav className={styles.featured} aria-label={text("Assets")}>{FEATURED_MINTS.map(x=><Link key={x.mint} href={"/app/assets?mint="+x.mint}>{x.code}</Link>)}</nav>:null}
   {passport&&mint?<>
    <div className={styles.summary}><div><p>{info?.name??symbol}</p><strong>{info?.usdPrice?"$"+Number(info.usdPrice).toLocaleString(locale,{maximumSignificantDigits:7}):"—"}</strong><span>{text("Current price")}</span></div><div className={styles.actions}>
      <Link className="rw-btn rw-btn--primary" href={"/app/swap?in="+mint+"&out="+(mint==="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"?"So11111111111111111111111111111111111111112":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")}>{text("Swap")}</Link>
      <SharePassport url={"https://ryntra.io/app/assets?mint="+mint} label={text("Share")} copied={text("Copied")}/>
    </div></div>
    <section className={styles.facts}><h2>{text("Asset details")}</h2><dl>
      <div><dt>{text("Network")}</dt><dd translate="no">Solana</dd></div>
      <div><dt>{text("Supply")}</dt><dd>{scaleRawAmount(passport.identity.supply.value,passport.identity.decimals.value)}</dd></div>
      <div><dt>{text("Additional issuance")}</dt><dd>{passport.identity.mintAuthority.value?(text("Possible")):(text("Disabled"))}</dd></div>
      <div><dt>{text("Balance freezing")}</dt><dd>{passport.identity.freezeAuthority.value?(text("Possible")):(text("Disabled"))}</dd></div>
      <div><dt>{text("Updated")}</dt><dd>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(passport.observedAt))} <span translate="no">UTC</span></dd></div>
    </dl></section>
    {passport.extensions.some(x=>x.affectsTransfers)?<section className={styles.rules}><h2>{text("Transfer rules")}</h2><ul>{passport.extensions.filter(x=>x.affectsTransfers).map(x=><li key={x.kind}>{meaning(x.meaning)}</li>)}</ul></section>:null}
    {passport.unsupportedKinds.length>0?<p role="status" className={styles.error}>{text("Some transfer rules could not be read")}</p>:null}
    <a className={styles.explorer} href={explorerAddressUrl("mainnet",mint)} target="_blank" rel="noreferrer noopener">{text("Open in Solana Explorer")}</a>
   </>:null}
 </div>;
}
