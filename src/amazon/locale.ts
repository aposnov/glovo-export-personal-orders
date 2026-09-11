import type { ListLabels } from './extract.js';

export type AmazonLocale = 'es' | 'en';

export type RowType = 'PRODUCTS' | 'DELIVERY' | 'TAX' | 'PROMOTION' | 'TOTAL' | 'TOTAL_FALLBACK' | 'OTHER';

interface LocaleTable {
  months: Record<string, number>;
  list: ListLabels;
  rows: Record<Exclude<RowType, 'OTHER'>, string[]>;
  soldBy: RegExp;
}

const ES_MONTHS: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

const EN_MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

export const LOCALES: Record<AmazonLocale, LocaleTable> = {
  es: {
    months: ES_MONTHS,
    list: {
      date: ['pedido realizado'],
      total: ['total'],
      orderId: ['pedido n.º', 'pedido nº', 'pedido n.°', 'pedido n°', 'n.º de pedido', 'número de pedido', 'numero de pedido'],
    },
    rows: {
      PRODUCTS: ['subtotal de producto(s)', 'subtotal de productos', 'subtotal de producto', 'productos', 'artículos'],
      DELIVERY: ['envío', 'gastos de envío', 'envío y manipulación', 'entrega'],
      TAX: ['iva estimado', 'iva', 'impuestos'],
      PROMOTION: ['promoción aplicada', 'promoción', 'descuento', 'cupón', 'envío gratis'],
      TOTAL: ['importe total', 'total del pedido'],
      TOTAL_FALLBACK: ['total'],
    },
    soldBy: /^vendido por\s*:?\s*/i,
  },
  en: {
    months: EN_MONTHS,
    list: {
      date: ['order placed'],
      total: ['total'],
      orderId: ['order #', 'order number', 'order id', 'order no.'],
    },
    rows: {
      PRODUCTS: ['items', 'item(s) subtotal', 'item subtotal', 'items subtotal', 'subtotal'],
      DELIVERY: ['shipping', 'postage', 'postage & packing', 'shipping & handling', 'delivery', 'shipping & delivery'],
      TAX: ['estimated vat', 'vat', 'estimated tax', 'tax', 'estimated tax to be collected'],
      PROMOTION: ['promotion applied', 'promotion', 'discount', 'coupon', 'free shipping'],
      TOTAL: ['grand total', 'order total'],
      TOTAL_FALLBACK: ['total'],
    },
    soldBy: /^sold by\s*:?\s*/i,
  },
};

const LOCALE_ORDER: AmazonLocale[] = ['es', 'en'];

export const CANCELLED_WORDS = /cancelad|cancel|anulad/i;
export const REFUNDED_WORDS = /reembols|refund/i;
export const AMAZON_ITSELF = /^amazon(?:\.[a-z.]+)?$/i;

export function allListLabels(): ListLabels {
  const merge = (pick: (table: LocaleTable) => string[]): string[] => [
    ...new Set(LOCALE_ORDER.flatMap((locale) => pick(LOCALES[locale]))),
  ];
  return {
    date: merge((table) => table.list.date),
    total: merge((table) => table.list.total),
    orderId: merge((table) => table.list.orderId),
  };
}

export function localeFromLang(lang: string | null | undefined): AmazonLocale | null {
  const prefix = (lang ?? '').trim().toLowerCase().slice(0, 2);
  return prefix === 'es' || prefix === 'en' ? prefix : null;
}

function orderedLocales(preferred: AmazonLocale | null): AmazonLocale[] {
  if (preferred === null) return LOCALE_ORDER;
  return [preferred, ...LOCALE_ORDER.filter((locale) => locale !== preferred)];
}

export function cleanLabel(raw: string): string {
  return raw
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*:\s*$/, '')
    .toLowerCase();
}

const ROW_ORDER: Exclude<RowType, 'OTHER'>[] = ['TOTAL', 'PRODUCTS', 'DELIVERY', 'TAX', 'PROMOTION', 'TOTAL_FALLBACK'];

export function classifyRow(label: string, locale: AmazonLocale | null): RowType {
  const key = cleanLabel(label);
  for (const candidate of orderedLocales(locale)) {
    const rows = LOCALES[candidate].rows;
    for (const type of ROW_ORDER) {
      if (rows[type].includes(key)) return type;
    }
  }
  return 'OTHER';
}

export function stripSoldBy(raw: string): string {
  let text = raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  for (const locale of LOCALE_ORDER) {
    text = text.replace(LOCALES[locale].soldBy, '');
  }
  return text.trim();
}

function monthNumber(word: string, locale: AmazonLocale | null): number | null {
  const key = word.toLowerCase().replace(/\.$/, '');
  for (const candidate of orderedLocales(locale)) {
    const month = LOCALES[candidate].months[key];
    if (month !== undefined) return month;
  }
  return null;
}

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseAmazonDate(raw: string | null | undefined, locale: AmazonLocale | null): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (text === '') return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = text.match(/^(\d{1,2})\.?\s+(?:de\s+)?([^\d\s,.]+)\.?\s+(?:de\s+)?(\d{4})$/i);
  if (dayFirst) {
    const month = monthNumber(dayFirst[2]!, locale);
    return month === null ? null : ymd(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  const monthFirst = text.match(/^([^\d\s,.]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (monthFirst) {
    const month = monthNumber(monthFirst[1]!, locale);
    return month === null ? null : ymd(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }

  return null;
}
