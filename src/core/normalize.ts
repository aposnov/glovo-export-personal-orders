import type {
  NormalizedItem,
  NormalizedOrder,
  NormalizedTotalLine,
  NormalizeResult,
  RawBoughtProduct,
  RawOrderDetail,
  RawPricingLine,
  Warning,
} from './types.js';

const ZERO_SENTINELS = new Set(['no cost', 'free', 'gratis', 'gratuito', 'sin coste']);

export interface Money {
  value: number | null;
  currency: string | null;
}

export function parseMoney(raw: unknown): Money {
  if (raw == null) return { value: null, currency: null };
  if (typeof raw === 'number') return { value: Number.isFinite(raw) ? raw : null, currency: null };
  if (typeof raw !== 'string') return { value: null, currency: null };

  const text = raw.replace(/ /g, ' ').trim();
  if (text === '') return { value: null, currency: null };
  if (ZERO_SENTINELS.has(text.toLowerCase())) return { value: 0, currency: null };

  const currency = detectCurrency(text);
  if (!/\d/.test(text)) return { value: null, currency };

  const negative = /^-/.test(text) || /^\(.*\)$/.test(text);
  const digits = text.replace(/[^0-9.,]/g, '');
  if (digits === '') return { value: null, currency };

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  let canonical: string;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    const intPart = digits.slice(0, decimalAt).replace(/[.,]/g, '');
    const fracPart = digits.slice(decimalAt + 1);
    canonical = `${intPart}.${fracPart}`;
  } else if (lastComma >= 0) {
    canonical = splitSingleSeparator(digits, lastComma);
  } else if (lastDot >= 0) {
    canonical = splitSingleSeparator(digits, lastDot);
  } else {
    canonical = digits;
  }

  const value = Number.parseFloat(canonical);
  if (!Number.isFinite(value)) return { value: null, currency };
  return { value: negative ? -Math.abs(value) : value, currency };
}

function splitSingleSeparator(digits: string, at: number): string {
  const frac = digits.slice(at + 1);
  if (frac.length === 3 && digits.slice(0, at).length > 0) return digits.replace(/[.,]/g, '');
  return `${digits.slice(0, at).replace(/[.,]/g, '')}.${frac}`;
}

function detectCurrency(text: string): string | null {
  if (text.includes('€') || /\bEUR\b/i.test(text)) return 'EUR';
  if (text.includes('£') || /\bGBP\b/i.test(text)) return 'GBP';
  if (text.includes('$') || /\bUSD\b/i.test(text)) return 'USD';
  const code = text.match(/\b([A-Z]{3})\b/);
  return code?.[1] ?? null;
}

const PROMO_AMOUNT = /^-?\s*\d[\d.,]*\s*(?:€|EUR|£|GBP|\$|USD)$/i;

export function parsePromoAmount(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/ /g, ' ').trim();
  if (!PROMO_AMOUNT.test(text)) return null;
  return parseMoney(text).value;
}

export function parseQuantity(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return 1;
  const cleaned = raw.trim().replace(/x$/i, '').replace(',', '.').trim();
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function parseTimestamp(raw: unknown): string | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function stripHtml(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? null : text;
}

const toCents = (value: number): number => Math.round(value * 100);

function normalizeItem(
  raw: RawBoughtProduct,
  orderId: string | null,
  warnings: Warning[],
): NormalizedItem {
  const quantity = parseQuantity(raw.quantity);
  const money = parseMoney(raw.price);
  const original = parseMoney(raw.originalPrice);
  const charged = (raw.displayStyle ?? '').toUpperCase() !== 'STRIKETHROUGH';

  if (money.value === null && raw.price != null && String(raw.price).trim() !== '') {
    warnings.push({
      orderId,
      kind: 'unparseable_item_price',
      detail: `item "${raw.name ?? '?'}" price ${JSON.stringify(raw.price)}`,
    });
  }

  const unitPrice =
    money.value !== null && quantity > 0 ? Math.round((money.value / quantity) * 100) / 100 : null;

  const stated = parsePromoAmount(raw.promotionDescription);
  const derived =
    original.value !== null && money.value !== null
      ? Math.round((money.value - original.value) * 100) / 100
      : null;
  const discount = stated !== null ? -Math.abs(stated) : derived !== null && derived < 0 ? derived : null;

  return {
    name: raw.name ?? null,
    quantity,
    lineTotal: money.value,
    originalLineTotal: original.value,
    discount,
    unitPrice,
    charged,
    notice: raw.notice ?? null,
    customizations: raw.customizationsDescription?.trim() || null,
    promotion: raw.promotionDescription ?? null,
    freeProduct: Boolean(raw.freeProduct),
  };
}

function normalizeTotalLine(
  raw: RawPricingLine,
  orderId: string | null,
  warnings: Warning[],
): NormalizedTotalLine {
  const source = raw.finalAmount ?? raw.amount ?? null;
  const money = parseMoney(source);

  if (money.value === null && source != null && String(source).trim() !== '') {
    warnings.push({
      orderId,
      kind: 'unparseable_breakdown_amount',
      detail: `line ${raw.type ?? '?'} amount ${JSON.stringify(source)}`,
    });
  }

  return {
    type: raw.type ?? null,
    label: raw.label ?? null,
    amount: money.value,
    raw: typeof source === 'string' ? source : null,
  };
}

export function normalizeOrder(raw: RawOrderDetail): NormalizeResult {
  const warnings: Warning[] = [];
  const orderId = raw.id != null ? String(raw.id) : null;

  if (orderId === null) {
    warnings.push({ orderId: null, kind: 'missing_order_id', detail: 'detail payload has no id' });
  }

  const date = parseTimestamp(raw.currentStatus?.creationTime);
  if (date === null) {
    warnings.push({
      orderId,
      kind: 'missing_date',
      detail: `currentStatus.creationTime=${JSON.stringify(raw.currentStatus?.creationTime)}`,
    });
  }

  const items = (raw.boughtProducts ?? []).map((item) => normalizeItem(item, orderId, warnings));
  const lines = (raw.pricingBreakdown?.lines ?? []).map((line) =>
    normalizeTotalLine(line, orderId, warnings),
  );

  const byType = (type: string): NormalizedTotalLine | undefined =>
    lines.find((line) => (line.type ?? '').toUpperCase() === type);

  const products = byType('PRODUCTS')?.amount ?? null;
  const delivery = byType('DELIVERY')?.amount ?? null;
  const total = byType('TOTAL')?.amount ?? null;

  const currency =
    (raw.boughtProducts ?? []).map((item) => parseMoney(item.price).currency).find(Boolean) ??
    (raw.pricingBreakdown?.lines ?? [])
      .map((line) => parseMoney(line.finalAmount ?? line.amount).currency)
      .find(Boolean) ??
    null;

  const chargedCents = items
    .filter((item) => item.charged && item.lineTotal !== null)
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
        detail: `charged items ${(chargedCents / 100).toFixed(2)} vs PRODUCTS ${products.toFixed(2)}`,
      });
    }
  }

  const handling =
    typeof raw.handlingStrategy === 'string'
      ? raw.handlingStrategy
      : (raw.handlingStrategy?.type ?? null);

  const status = raw.currentStatus?.type ?? null;
  const cancelled = /cancel/i.test(status ?? '') || Boolean(raw.recentlyCancelled);

  const order: NormalizedOrder = {
    id: orderId ?? '',
    date,
    store: {
      id: raw.storeId != null ? String(raw.storeId) : null,
      name: raw.storeName ?? null,
      slug: raw.storeSlug ?? null,
    },
    status,
    cancelled,
    refunded: Boolean(raw.refunded),
    excludedFromSpend: cancelled ? 'cancelled' : null,
    vertical: raw.vertical ?? null,
    handling,
    currency,
    summary: stripHtml(raw.shortSummary),
    items,
    totals: { products, delivery, total, lines },
    validation: { productsMatch, delta },
  };

  return { order, warnings };
}
