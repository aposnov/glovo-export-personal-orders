export const DEFAULT_MARKETPLACE = 'amazon.es';
export const MARKETPLACE_PATTERN = /^amazon\.[a-z]+(?:\.[a-z]+)?$/;
export const ORDERS_PATH = '/your-orders/orders';

export function apexOf(marketplace: string): string {
  if (!MARKETPLACE_PATTERN.test(marketplace)) {
    throw new Error(`invalid marketplace "${marketplace}" (expected e.g. amazon.es, amazon.co.uk)`);
  }
  return `https://www.${marketplace}`;
}

export function listPath(year: number, page: number): string {
  return `${ORDERS_PATH}?timeFilter=year-${year}&page=${page}`;
}

export function detailPath(orderId: string): string {
  return `/your-orders/order-details?orderID=${encodeURIComponent(orderId)}`;
}
