import type { Fetcher } from './fetcher.js';
import { normalizeOrder } from './normalize.js';
import type { NormalizedOrder, RawListResponse, RawOrderDetail, Warning } from './types.js';

const LIST_LIMIT = 50;
const LIST_DELAY_MS = 750;
const DETAIL_DELAY_MS = 1_000;
const OUT_OF_RANGE_STREAK = 3;

export interface ListOptions {
  startCursor?: string;
  onPage?: (pages: number, seen: number, nextCursor: string | null) => void | Promise<void>;
}

export async function listOrderIds(fetcher: Fetcher, options: ListOptions = {}): Promise<string[]> {
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor = options.startCursor ?? '0';
  let pages = 0;

  for (;;) {
    if (seenCursors.has(cursor)) break;
    seenCursors.add(cursor);

    const response = await fetcher.get<RawListResponse>(
      `/v3/customer/orders-list?offset=${encodeURIComponent(cursor)}&limit=${LIST_LIMIT}`,
      `orders-list p${pages + 1}`,
    );

    const entries = response?.orders ?? [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      const id = entry.orderId != null ? String(entry.orderId) : null;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      ids.push(id);
    }

    pages += 1;

    const next = response?.pagination?.next?.offset;
    const nextCursor = next == null || String(next) === cursor ? null : String(next);
    await options.onPage?.(pages, ids.length, nextCursor);

    if (nextCursor === null) break;
    cursor = nextCursor;

    await fetcher.sleep(LIST_DELAY_MS);
  }

  return ids;
}

export interface DetailRun {
  orders: NormalizedOrder[];
  warnings: Warning[];
  examined: number;
}

export interface DetailOptions {
  onOrder?: (order: NormalizedOrder, inRange: boolean) => void | Promise<void>;
  onProgress?: (examined: number, total: number, kept: number) => void | Promise<void>;
}

export async function fetchOrdersInRange(
  fetcher: Fetcher,
  ids: string[],
  from: string,
  to: string,
  options: DetailOptions = {},
): Promise<DetailRun> {
  const orders: NormalizedOrder[] = [];
  const warnings: Warning[] = [];
  let streak = 0;
  let examined = 0;

  for (const id of ids) {
    let detail: RawOrderDetail;
    try {
      detail = await fetcher.get<RawOrderDetail>(`/v3/customer/orders/${id}`, `order ${id}`);
    } catch (error) {
      warnings.push({ orderId: id, kind: 'detail_fetch_failed', detail: String(error) });
      await fetcher.sleep(DETAIL_DELAY_MS);
      continue;
    }

    examined += 1;
    const { order, warnings: orderWarnings } = normalizeOrder(detail);
    warnings.push(...orderWarnings);

    let inRange = true;
    if (order.date === null) {
      orders.push(order);
      streak = 0;
    } else if (order.date < from) {
      inRange = false;
      streak += 1;
    } else if (order.date > to) {
      inRange = false;
      streak = 0;
    } else {
      orders.push(order);
      streak = 0;
    }

    await options.onOrder?.(order, inRange);
    await options.onProgress?.(examined, ids.length, orders.length);

    if (streak >= OUT_OF_RANGE_STREAK) break;

    await fetcher.sleep(DETAIL_DELAY_MS);
  }

  return { orders, warnings, examined };
}
