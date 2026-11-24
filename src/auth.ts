const encoder = new TextEncoder();

/** Prefix of per-client key secrets, e.g. `PROXY_KEY_LAPTOP`. */
export const NAMED_KEY_PREFIX = "PROXY_KEY_";

export interface ProxyKey {
  /** Non-secret label used in analytics, e.g. `laptop` or `legacy-1`. */
  name: string;
  key: string;
}

export function parseProxyKeys(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

/**
 * Collects every configured key: one `PROXY_KEY_<NAME>` secret per client,
 * plus the comma-separated `PROXY_API_KEYS` for older deployments.
 */
export function configuredKeys(env: object): ProxyKey[] {
  const keys: ProxyKey[] = [];
  for (const [binding, value] of Object.entries(env)) {
    if (!binding.startsWith(NAMED_KEY_PREFIX) || typeof value !== "string") {
      continue;
    }
    const name = binding.slice(NAMED_KEY_PREFIX.length).toLowerCase();
    const key = value.trim();
    if (name && key) keys.push({ name, key });
  }
  const legacy = (env as { PROXY_API_KEYS?: unknown }).PROXY_API_KEYS;
  parseProxyKeys(typeof legacy === "string" ? legacy : undefined).forEach(
    (key, i) => {
      keys.push({ name: `legacy-${i + 1}`, key });
    },
  );
  return keys;
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
 * Returns the name of the key matching `presented`, or undefined. Every key
 * is compared without short-circuiting, so timing does not reveal which key
 * or prefix matched.
 */
export async function matchKey(
  presented: string,
  keys: ProxyKey[],
): Promise<string | undefined> {
  const presentedDigest = await digest(presented);
  let matched: string | undefined;
  for (const { name, key } of keys) {
    const keyDigest = await digest(key);
    let diff = 0;
    for (let i = 0; i < keyDigest.length; i++) {
      diff |= (keyDigest[i] ?? 0) ^ (presentedDigest[i] ?? 0);
    }
    if (diff === 0 && matched === undefined) matched = name;
  }
  return matched;
}
