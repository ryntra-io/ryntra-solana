import { buildAssetLinks } from "../../../lib/api/v1/assetlinks.ts";
import { publicCacheHeaders } from "../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Digital Asset Links — the statement wallets read to verify the native app's
 * identity at connect (Mobile Wallet Adapter, *Dapp identity verification*).
 *
 * The statement list comes from the deployment's configuration and is empty
 * until the package name and the release certificate's fingerprints are set;
 * an empty list is honest and grants nothing. The debug certificate is
 * honoured only off production (`VERCEL_ENV`), so a development build can be
 * verified on a preview deployment without ever entering production trust.
 * Served as JSON at the path the specification names, cacheable, CORS-open —
 * the file is public by definition.
 */
export function GET() {
  const isProduction = process.env.VERCEL_ENV === "production";
  const statements = buildAssetLinks(process.env, isProduction);
  return new Response(JSON.stringify(statements), {
    headers: {
      "content-type": "application/json",
      ...publicCacheHeaders(300, 3_600),
      "Access-Control-Allow-Origin": "*",
    },
  });
}
