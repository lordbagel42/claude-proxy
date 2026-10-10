const encoder = new TextEncoder();

export function parseProxyKeys(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

/** Reads the client key from `x-api-key` or `Authorization: Bearer`. */
export function clientKey(headers: Headers): string | undefined {
  const apiKey = headers.get("x-api-key")?.trim();
  if (apiKey) return apiKey;
  const match = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
}

/**
 * Compares the presented key against every configured key without
 * short-circuiting, so timing does not reveal which key or prefix matched.
 */
export async function isAuthorized(
  presented: string,
  keys: string[],
): Promise<boolean> {
  const presentedDigest = await digest(presented);
  let authorized = false;
  for (const key of keys) {
    const keyDigest = await digest(key);
    let diff = 0;
    for (let i = 0; i < keyDigest.length; i++) {
      diff |= (keyDigest[i] ?? 0) ^ (presentedDigest[i] ?? 0);
    }
    authorized ||= diff === 0;
  }
  return authorized;
}
