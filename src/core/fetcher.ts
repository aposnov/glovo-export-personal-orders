import type { Transport } from './transport.js';

const MAX_ATTEMPTS = 5;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Notice = (message: string) => void;

export class Fetcher {
  requestCount = 0;

  constructor(
    private readonly transport: Transport,
    private readonly notice: Notice = (message) => console.error(message),
  ) {}

  sleep(ms: number): Promise<void> {
    return this.transport.sleep(ms);
  }

  async get<T>(path: string, label: string): Promise<T> {
    let lastError = '';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      this.requestCount += 1;
      const result = await this.transport.request(path);

      if (result.ok) return result.body as T;

      lastError = result.error ?? `HTTP ${result.status}`;

      if (result.status === 401 || result.error === 'no_auth_cookie') {
        const recovered = await this.transport.recoverFromUnauthorized();
        if (!recovered) throw new ApiError(`${label}: unauthorized`, 401);
        this.notice(`[${label}] session stale, recovered`);
        continue;
      }

      if (result.status === 404) {
        throw new ApiError(`${label}: not found`, 404);
      }

      if (result.status === 429) {
        const delay = Math.min(15_000 * 2 ** attempt, 120_000);
        this.notice(`[${label}] rate limited, waiting ${delay}ms`);
        await this.transport.sleep(delay);
        continue;
      }

      if (result.status >= 500 || result.status === 0) {
        const delay = Math.min(1_000 * 2 ** attempt, 30_000);
        this.notice(`[${label}] ${lastError}, retrying in ${delay}ms`);
        await this.transport.sleep(delay);
        continue;
      }

      throw new ApiError(`${label}: ${lastError}`, result.status);
    }

    throw new ApiError(`${label}: giving up after ${MAX_ATTEMPTS} attempts (${lastError})`, 0);
  }
}
