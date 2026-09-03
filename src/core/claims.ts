export interface TokenClaims {
  userId: string | null;
  grantType: string | null;
  role: string | null;
  exp: number | null;
}

function decodeBase64Url(segment: string): string | null {
  try {
    return atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function claimsFromPayloadSegment(segment: string): TokenClaims | null {
  const json = decodeBase64Url(segment);
  if (json === null) return null;
  const claims = parseJson(json);
  if (claims === null) return null;

  let inner: Record<string, unknown> = {};
  const nested = claims.payload;
  if (typeof nested === 'string') {
    const decoded = decodeBase64Url(nested);
    inner = parseJson(nested) ?? (decoded === null ? null : parseJson(decoded)) ?? {};
  }

  let userId: unknown = null;
  for (const key of ['userId', 'user_id', 'sub', 'id']) {
    const value = claims[key] ?? inner[key];
    if (value != null) {
      userId = value;
      break;
    }
  }

  let grantType: unknown = null;
  for (const key of ['grantType', 'grant_type']) {
    const value = claims[key] ?? inner[key];
    if (value != null) {
      grantType = value;
      break;
    }
  }

  return {
    userId: userId != null ? String(userId) : null,
    grantType: grantType != null ? String(grantType) : null,
    role: typeof claims.role === 'string' ? claims.role : null,
    exp: typeof claims.exp === 'number' ? claims.exp : null,
  };
}

export function claimsFromToken(token: string): TokenClaims | null {
  const segment = token.split('.')[1];
  return segment ? claimsFromPayloadSegment(segment) : null;
}

export function secondsRemaining(claims: TokenClaims, nowMs: number): number | null {
  return claims.exp === null ? null : claims.exp - Math.floor(nowMs / 1000);
}
