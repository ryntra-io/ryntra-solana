/**
 * Push delivery — FCM when RYNTRA_PUSH_SERVER_KEY is set.
 * Tokens and the key are never logged. A missing key is not a trigger.
 */

export type PushSend = "sent" | "failed" | "unregistered" | "skipped_no_provider";

export function pushProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RYNTRA_PUSH_SERVER_KEY?.trim());
}

type FetchLike = typeof fetch;

export async function sendPushNote(
  input: Readonly<{ token: string; title: string; body: string; href: string }>,
  env: NodeJS.ProcessEnv = process.env,
  post: FetchLike = fetch,
): Promise<PushSend> {
  const key = env.RYNTRA_PUSH_SERVER_KEY?.trim();
  if (!key) return "skipped_no_provider";
  const trimmed = input.token.trim();
  if (trimmed.length < 16) return "failed";
  if (key.startsWith("{")) {
    return sendFcmV1(key, input, post);
  }
  return sendFcmLegacy(key, input, post);
}

async function sendFcmLegacy(
  key: string,
  input: Readonly<{ token: string; title: string; body: string; href: string }>,
  post: FetchLike,
): Promise<PushSend> {
  try {
    const response = await post("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: { authorization: `key=${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        to: input.token,
        notification: { title: input.title, body: input.body },
        data: { link: input.href },
        android: { priority: "high" },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401 || response.status === 403) return "failed";
    const json = (await response.json().catch(() => null)) as { success?: number; failure?: number; results?: readonly { error?: string }[] } | null;
    const error = json?.results?.[0]?.error;
    if (error === "NotRegistered" || error === "InvalidRegistration") return "unregistered";
    if (json?.success === 1) return "sent";
    return response.ok ? "failed" : "failed";
  } catch {
    return "failed";
  }
}

async function sendFcmV1(
  raw: string,
  input: Readonly<{ token: string; title: string; body: string; href: string }>,
  post: FetchLike,
): Promise<PushSend> {
  let parsed: { project_id?: string; client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return "failed";
  }
  const projectId = parsed.project_id?.trim();
  const email = parsed.client_email?.trim();
  const privateKey = parsed.private_key?.replace(/\\n/g, "\n");
  if (!projectId || !email || !privateKey) return "failed";
  try {
    const { createSign } = await import("node:crypto");
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claim = Buffer.from(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })).toString("base64url");
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    const jwt = `${header}.${claim}.${signer.sign(privateKey, "base64url")}`;
    const tokenRes = await post("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
      signal: AbortSignal.timeout(8_000),
    });
    const tokenJson = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
    const access = tokenJson?.access_token;
    if (!access) return "failed";
    const response = await post(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token: input.token,
          notification: { title: input.title, body: input.body },
          data: { link: input.href },
          android: { priority: "HIGH" },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) return "unregistered";
    if (!response.ok) return "failed";
    return "sent";
  } catch {
    return "failed";
  }
}
