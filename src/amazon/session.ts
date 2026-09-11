import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { evaluateInPage } from './evaluate.js';
import { detectChallenge } from './extract.js';
import type { ChallengeCheck } from './types.js';

export const AMAZON_PROFILE_DIR = join(homedir(), '.glovo-export', 'amazon-profile');

const POLL_MS = 2_000;

export function isAuthPath(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/ap/');
  } catch {
    return false;
  }
}

export async function hasOrdersUi(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(
      () =>
        document.querySelector('div.order-card') !== null ||
        document.querySelector('select[name="timeFilter"]') !== null,
    );
  } catch {
    return false;
  }
}

export async function isSignedIn(page: Page): Promise<boolean> {
  if (isAuthPath(page.url())) return false;
  return hasOrdersUi(page);
}

export async function checkChallenge(page: Page): Promise<ChallengeCheck> {
  try {
    return await evaluateInPage(page, detectChallenge);
  } catch {
    return { challenge: false, reason: null };
  }
}

export async function waitForLogin(page: Page, timeoutMs: number, ordersUrl: string): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let idlePolls = 0;

  while (Date.now() < deadline) {
    if (await isSignedIn(page)) return true;

    if (isAuthPath(page.url())) {
      idlePolls = 0;
    } else {
      idlePolls += 1;
      if (idlePolls >= 5) {
        idlePolls = 0;
        await page
          .goto(ordersUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
          .catch(() => undefined);
      }
    }
    await page.waitForTimeout(POLL_MS);
  }
  return false;
}
