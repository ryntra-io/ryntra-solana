/**
 * Did the identity verifier accept the request to send a mail?
 *
 * Enumeration safety says nothing about *this address* may leak, and nothing
 * here changes that: an unknown address and a known one both answer «check your
 * mail». It says nothing about the service. When SMTP is down, or the project's
 * send quota is spent, no mail exists to check for, and telling somebody to go
 * and look for it is a lie that costs them the account — they wait, then ask
 * for another link, and wait again.
 *
 * So a refusal that belongs to the *service* is reported as itself, and every
 * other refusal keeps the neutral answer. The two are told apart by what the
 * verifier says: a rate limit or a quota is `rate_limited`, a 5xx or a mailer
 * failure is `unavailable`, anything else is treated as accepted.
 *
 * No imports on purpose: this rule is the difference between an honest and a
 * dishonest screen, and it is tested on its own.
 */
export type DeliveryOutcome = "accepted" | "rate_limited" | "unavailable";

export type ProviderError = { status?: number; code?: string; message?: string } | null | undefined;

export function deliveryOutcome(error: ProviderError): DeliveryOutcome {
  if (!error) return "accepted";
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (error.status === 429 || /rate.?limit|too many|over_email_send|for security purposes/.test(text)) return "rate_limited";
  if ((typeof error.status === "number" && error.status >= 500) || /unexpected_failure|error sending|smtp|mailer|email.*(fail|error)/.test(text)) {
    return "unavailable";
  }
  return "accepted";
}
