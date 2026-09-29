/** Search behavior for the compact wallet-asset picker. */

export type SendAssetSearchFields = Readonly<{
  ticker: string;
  name: string | null;
  mint: string | null;
}>;

export function matchesSendAssetQuery(
  asset: SendAssetSearchFields,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase("en-US");
  if (needle === "") return true;
  return [asset.ticker, asset.name ?? "", asset.mint ?? ""].some((value) =>
    value.toLocaleLowerCase("en-US").includes(needle),
  );
}

export function showUnknownMatchesInline(query: string): boolean {
  return query.trim() !== "";
}
