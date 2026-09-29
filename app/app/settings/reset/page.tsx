import { solanaServerText } from "@/app/solana/workspace/i18n/server";

import { ResetForm } from "./reset-form";

export const metadata = { title: "Password" };

/**
 * The page a recovery link continues to, and the page Settings sends a
 * signed-in person to for a password change. The identity session from the
 * link is what authorizes the change; the product session is minted after.
 */
export default async function ResetPasswordPage() {
  const { locale } = await solanaServerText();
  const uk = locale === "uk";
  return (
    <section className="ry-account-settings">
      <h1>{uk ? "Новий пароль" : "Set a new password"}</h1>
      <p className="ry-muted">{uk ? "Це посилання надіслано на вашу адресу. Інші сесії цього облікового запису буде завершено." : "This link was sent to your address. Other sessions of this account will be signed out."}</p>
      <ResetForm />
    </section>
  );
}
