import { API_BASE, authHeaders } from '../core/api.js';
import type { RawResult, Transport } from '../core/transport.js';

export class NodeTransport implements Transport {
  constructor(private readonly token: string) {}

  async request(path: string): Promise<RawResult> {
    try {
      const response = await fetch(API_BASE + path, {
        method: 'GET',
        headers: authHeaders(this.token),
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
  }

  async recoverFromUnauthorized(): Promise<boolean> {
    return false;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
