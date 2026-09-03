import type { Page } from 'playwright';
import { claimsFromPayloadSegment, secondsRemaining } from './core/claims.js';

export interface AccountClaims {
  userId: string | null;
  grantType: string | null;
  role: string | null;
  expiresAt: string | null;
  secondsRemaining: number | null;
}

export async function hasAuthCookie(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.cookie.split('; ').some((part) => part.startsWith('glovo_auth_info=')),
  );
}

export async function readClaims(page: Page): Promise<AccountClaims | null> {
  const segment = await page.evaluate(() => {
    const prefix = 'glovo_auth_info=';
    const cookie = document.cookie.split('; ').find((part) => part.startsWith(prefix));
    if (!cookie) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(cookie.slice(prefix.length)));
      const token: unknown = parsed?.accessToken;
      if (typeof token !== 'string') return null;
      return token.split('.')[1] ?? null;
    } catch {
      return null;
    }
  });

  if (!segment) return null;
  const claims = claimsFromPayloadSegment(segment);
  if (!claims) return null;

  return {
    userId: claims.userId,
    grantType: claims.grantType,
    role: claims.role,
    expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    secondsRemaining: secondsRemaining(claims, Date.now()),
  };
}

export async function waitForLogin(page: Page, timeoutMs: number): Promise<AccountClaims | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasAuthCookie(page)) {
      const claims = await readClaims(page);
      if (claims) return claims;
    }
    await page.waitForTimeout(2_000);
  }
  return null;
}
