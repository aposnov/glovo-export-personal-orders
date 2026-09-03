import type { Page } from 'playwright';
import { reloadApex } from '../browser.js';
import { API_BASE, STATIC_HEADERS } from '../core/api.js';
import type { RawResult, Transport } from '../core/transport.js';

export class BrowserTransport implements Transport {
  constructor(private readonly page: Page) {}

  async request(path: string): Promise<RawResult> {
    return this.page.evaluate(
      async ({ base, target, headers }) => {
        const prefix = 'glovo_auth_info=';
        const cookie = document.cookie.split('; ').find((part) => part.startsWith(prefix));
        if (!cookie) return { status: 0, ok: false, body: null, error: 'no_auth_cookie' };

        let token: string;
        try {
          token = JSON.parse(decodeURIComponent(cookie.slice(prefix.length))).accessToken;
        } catch {
          return { status: 0, ok: false, body: null, error: 'bad_auth_cookie' };
        }
        if (typeof token !== 'string' || token === '') {
          return { status: 0, ok: false, body: null, error: 'no_access_token' };
        }

        try {
          const response = await fetch(base + target, {
            method: 'GET',
            headers: { ...headers, authorization: token, 'glovo-request-id': crypto.randomUUID() },
          });
          const text = await response.text();
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
          return { status: response.status, ok: response.ok, body };
        } catch (error) {
          return { status: 0, ok: false, body: null, error: String(error) };
        }
      },
      { base: API_BASE, target: path, headers: STATIC_HEADERS },
    );
  }

  async recoverFromUnauthorized(): Promise<boolean> {
    await reloadApex(this.page);
    return true;
  }

  async sleep(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}
