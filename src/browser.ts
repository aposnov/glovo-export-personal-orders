import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

export const APEX = 'https://glovoapp.com';
export const PROFILE_DIR = join(homedir(), '.glovo-export', 'profile');
const START_PATH = '/en/profile/past-orders';

export interface Session {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export interface SessionOptions {
  apex?: string;
  profileDir?: string;
  startPath?: string;
}

export async function openSession(headless: boolean, options: SessionOptions = {}): Promise<Session> {
  const apex = options.apex ?? APEX;
  const profileDir = options.profileDir ?? PROFILE_DIR;
  const startPath = options.startPath ?? START_PATH;

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'en-GB',
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${apex}${startPath}`, {
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
  await page.goto(`${APEX}${START_PATH}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForTimeout(2_000);
}
