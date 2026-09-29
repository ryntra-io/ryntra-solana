import { canKeepPersonalData, getSession } from "@/lib/session";
import { ProductSettings } from "./product-settings";
export const metadata={title:"Settings"};
export default async function SettingsPage(){const session=await getSession();return <ProductSettings signedIn={Boolean(session && canKeepPersonalData(session))} name={session?.state.user.first_name??session?.state.user.username??null} />;}
