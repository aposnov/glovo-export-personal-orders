export const API_BASE = 'https://api.glovoapp.com';
export const APP_VERSION = 'v1.2614.1';

export const STATIC_HEADERS: Record<string, string> = {
  accept: 'application/json',
  'glovo-api-version': '14',
  'glovo-app-platform': 'web',
  'glovo-app-type': 'customer',
  'glovo-app-version': APP_VERSION,
  'glovo-language-code': 'en',
};

export function authHeaders(token: string): Record<string, string> {
  return {
    ...STATIC_HEADERS,
    authorization: token,
    'glovo-request-id': crypto.randomUUID(),
  };
}
