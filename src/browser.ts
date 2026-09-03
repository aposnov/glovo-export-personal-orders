import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

export const APEX = 'https://glovoapp.com';
export const PROFILE_DIR = join(homedir(), '.glovo-export', 'profile');

export interface Session {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function openSession(headless: boolean): Promise<Session> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'en-GB',
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${APEX}/en/profile/past-orders`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  return {
    context,
    page,
    close: async () => {
      await context.close();
    },
  };
}

export async function reloadApex(page: Page): Promise<void> {
  await page.goto(`${APEX}/en/profile/past-orders`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForTimeout(2_000);
}
