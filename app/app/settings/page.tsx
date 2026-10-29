import { canKeepPersonalData, getSession } from "@/lib/session";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { ProductSettings } from "./product-settings";
export async function generateMetadata(){const locale=await solanaServerLocale();return {title:locale==="uk"?"Акаунт":"Account"};}
export default async function SettingsPage(){const session=await getSession();return <ProductSettings signedIn={Boolean(session && canKeepPersonalData(session))} name={session?.state.user.first_name??session?.state.user.username??null} />;}
