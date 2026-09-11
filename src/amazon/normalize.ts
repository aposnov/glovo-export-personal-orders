import { parseMoney } from '../core/normalize.js';
import type {
  NormalizedItem,
  NormalizedOrder,
  NormalizedTotalLine,
  NormalizeResult,
  Warning,
} from '../core/types.js';
import {
  AMAZON_ITSELF,
  CANCELLED_WORDS,
  REFUNDED_WORDS,
  classifyRow,
  parseAmazonDate,
  stripSoldBy,
  type AmazonLocale,
} from './locale.js';
import type { RawAmazonCard, RawAmazonItem, RawAmazonOrderDetail, RawSubtotalRow } from './types.js';

const toCents = (value: number): number => Math.round(value * 100);
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function parseAmazonQuantity(raw: string | null | undefined): number {
  if (typeof raw !== 'string') return 1;
  const match = raw.match(/\d+(?:[.,]\d+)?/);
  if (!match) return 1;
  const value = Number.parseFloat(match[0].replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeItem(raw: RawAmazonItem, orderId: string | null, warnings: Warning[]): NormalizedItem {
  const quantity = parseAmazonQuantity(raw.quantity);
  const money = parseMoney(raw.unitPrice);

  if (money.value === null && raw.unitPrice !== null) {
    warnings.push({
      orderId,
      kind: 'unparseable_item_price',
      detail: `item "${raw.title ?? '?'}" price ${JSON.stringify(raw.unitPrice)}`,
    });
  }

  return {
    name: raw.title,
    quantity,
    lineTotal: money.value === null ? null : round2(money.value * quantity),
    originalLineTotal: null,
    discount: null,
    unitPrice: money.value,
    charged: true,
    notice: null,
    customizations: null,
    promotion: null,
    freeProduct: false,
    asin: raw.asin,
  };
}

function cardOnlyItem(title: string): NormalizedItem {
  return {
    name: title,
    quantity: 1,
    lineTotal: null,
    originalLineTotal: null,
    discount: null,
    unitPrice: null,
    charged: true,
    notice: null,
    customizations: null,
    promotion: null,
    freeProduct: false,
    asin: null,
  };
}

function normalizeRow(
  row: RawSubtotalRow,
  locale: AmazonLocale | null,
  orderId: string | null,
  warnings: Warning[],
): NormalizedTotalLine {
  const money = parseMoney(row.amount);
  if (money.value === null) {
    warnings.push({
      orderId,
      kind: 'unparseable_breakdown_amount',
      detail: `row "${row.label}" amount ${JSON.stringify(row.amount)}`,
    });
  }
  return { type: classifyRow(row.label, locale), label: row.label, amount: money.value, raw: row.amount };
}

function storeOf(items: RawAmazonItem[]): { store: NormalizedOrder['store']; mixed: boolean } {
  const named = items
    .map((item) => ({ name: item.seller === null ? '' : stripSoldBy(item.seller), id: item.sellerId }))
    .filter((seller) => seller.name !== '');
  const first = named[0];
  const distinct = new Set(named.map((seller) => seller.name.toLowerCase()));

  if (!first || AMAZON_ITSELF.test(first.name)) {
    return { store: { id: 'amazon', name: 'Amazon', slug: null }, mixed: distinct.size > 1 };
  }
  return { store: { id: first.id, name: first.name, slug: null }, mixed: distinct.size > 1 };
}

export function normalizeAmazonOrder(
  detail: RawAmazonOrderDetail | null,
  card: RawAmazonCard,
  locale: AmazonLocale | null,
): NormalizeResult {
  const warnings: Warning[] = [];
  const orderId = detail?.orderId ?? card.orderId;

  if (orderId === null) {
    warnings.push({ orderId: null, kind: 'missing_order_id', detail: 'neither the card nor the detail page carries an order id' });
  }
  if (detail === null) {
    warnings.push({
      orderId,
      kind: 'detail_unavailable',
      detail: 'order details page not readable (digital order or unknown layout); exported from the list card only',
    });
  }

  const rawDate = detail?.date ?? card.date;
  const date = parseAmazonDate(rawDate, locale);
  if (date === null) {
    warnings.push({ orderId, kind: 'unparseable_date', detail: `date ${JSON.stringify(rawDate)}` });
  }

  const items = detail
    ? detail.items.map((item) => normalizeItem(item, orderId, warnings))
    : card.titles.map(cardOnlyItem);
  const lines = (detail?.rows ?? []).map((row) => normalizeRow(row, locale, orderId, warnings));

  const byType = (type: string): NormalizedTotalLine | undefined => lines.find((line) => line.type === type);
  const products = byType('PRODUCTS')?.amount ?? null;
  const delivery = byType('DELIVERY')?.amount ?? null;
  const cardTotal = parseMoney(card.total);
  const totalLine = byType('TOTAL') ?? byType('TOTAL_FALLBACK');
  const total = totalLine?.amount ?? cardTotal.value;

  const currency =
    (totalLine ? parseMoney(totalLine.raw).currency : null) ??
    cardTotal.currency ??
    (detail?.items ?? []).map((item) => parseMoney(item.unitPrice).currency).find(Boolean) ??
    null;

  const chargedCents = items
    .filter((item) => item.lineTotal !== null)
    .reduce((sum, item) => sum + toCents(item.lineTotal as number), 0);

  let productsMatch: boolean | null = null;
  let delta: number | null = null;
  if (products !== null && items.length > 0) {
    const deltaCents = chargedCents - toCents(products);
    delta = Math.round(deltaCents) / 100;
    productsMatch = Math.abs(deltaCents) <= 1;
    if (!productsMatch) {
      warnings.push({
        orderId,
        kind: 'products_total_mismatch',
        detail: `items ${(chargedCents / 100).toFixed(2)} vs products subtotal ${products.toFixed(2)}`,
      });
    }
  }

  const statuses = detail && detail.statuses.length > 0 ? [...new Set(detail.statuses)] : card.status ? [card.status] : [];
  const cancelledCount = statuses.filter((status) => CANCELLED_WORDS.test(status)).length;
  const cancelled = statuses.length > 0 && cancelledCount === statuses.length;
  if (cancelledCount > 0 && !cancelled) {
    warnings.push({
      orderId,
      kind: 'partial_cancellation',
      detail: `${cancelledCount} of ${statuses.length} shipments cancelled; order kept in spend`,
    });
  }
  const refunded = statuses.some((status) => REFUNDED_WORDS.test(status));

  const { store, mixed } = storeOf(detail?.items ?? []);
  if (mixed) {
    warnings.push({ orderId, kind: 'mixed_sellers', detail: 'items from several sellers; store is the first one' });
  }

  const order: NormalizedOrder = {
    id: orderId ?? '',
    date,
    store,
    status: statuses.length > 0 ? statuses.join(' / ') : null,
    cancelled,
    refunded,
    excludedFromSpend: cancelled ? 'cancelled' : null,
    vertical: null,
    handling: null,
    currency,
    summary: null,
    items,
    totals: { products, delivery, total, lines },
    validation: { productsMatch, delta },
  };

  return { order, warnings };
}
