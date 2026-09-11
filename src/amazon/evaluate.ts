import type { Page } from 'playwright';

const SHIM = 'globalThis.__name ??= (fn) => fn;';

export async function evaluateInPage<R>(page: Page, fn: () => R): Promise<R>;
export async function evaluateInPage<A, R>(page: Page, fn: (arg: A) => R, arg: A): Promise<R>;
export async function evaluateInPage<A, R>(page: Page, fn: (arg: A) => R, arg?: A): Promise<R> {
  await page.evaluate(SHIM);
  return page.evaluate(fn as (arg: unknown) => R, arg);
}
