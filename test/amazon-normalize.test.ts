import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyRow,
  localeFromLang,
  parseAmazonDate,
  stripSoldBy,
} from '../src/amazon/locale.js';
import { normalizeAmazonOrder, parseAmazonQuantity } from '../src/amazon/normalize.js';
import type { RawAmazonCard, RawAmazonOrderDetail } from '../src/amazon/types.js';

test('parseAmazonDate handles Spanish and English forms', () => {
  assert.equal(parseAmazonDate('12 de marzo de 2025', 'es'), '2025-03-12');
  assert.equal(parseAmazonDate('3 de enero de 2025', 'es'), '2025-01-03');
  assert.equal(parseAmazonDate('1 de septiembre de 2024', 'es'), '2024-09-01');
  assert.equal(parseAmazonDate('March 12, 2025', 'en'), '2025-03-12');
  assert.equal(parseAmazonDate('12 March 2025', 'en'), '2025-03-12');
  assert.equal(parseAmazonDate('Mar 12, 2025', 'en'), '2025-03-12');
  assert.equal(parseAmazonDate('Sept 30, 2024', 'en'), '2024-09-30');
  assert.equal(parseAmazonDate('2025-03-12', null), '2025-03-12');
});

test('parseAmazonDate falls back across locale tables and rejects junk', () => {
  assert.equal(parseAmazonDate('12 de marzo de 2025', 'en'), '2025-03-12');
  assert.equal(parseAmazonDate('March 12, 2025', 'es'), '2025-03-12');
  assert.equal(parseAmazonDate('12 de marzo de 2025', null), '2025-03-12');
  assert.equal(parseAmazonDate('31 de febrero de 2025', 'es'), null);
  assert.equal(parseAmazonDate('12 de brumario de 2025', 'es'), null);
  assert.equal(parseAmazonDate('Entregado hoy', 'es'), null);
  assert.equal(parseAmazonDate('', 'es'), null);
  assert.equal(parseAmazonDate(null, 'es'), null);
});

test('localeFromLang maps page lang to a table', () => {
  assert.equal(localeFromLang('es-es'), 'es');
  assert.equal(localeFromLang('en-GB'), 'en');
  assert.equal(localeFromLang('en'), 'en');
  assert.equal(localeFromLang('de-de'), null);
  assert.equal(localeFromLang(null), null);
});

test('classifyRow reads Spanish and English charge summary labels', () => {
  assert.equal(classifyRow('Subtotal de producto(s):', 'es'), 'PRODUCTS');
  assert.equal(classifyRow('Envío:', 'es'), 'DELIVERY');
  assert.equal(classifyRow('IVA estimado:', 'es'), 'TAX');
  assert.equal(classifyRow('Total:', 'es'), 'TOTAL_FALLBACK');
  assert.equal(classifyRow('Importe total:', 'es'), 'TOTAL');
  assert.equal(classifyRow('Total sin IVA:', 'es'), 'OTHER');
  assert.equal(classifyRow('Items:', 'en'), 'PRODUCTS');
  assert.equal(classifyRow('Item(s) Subtotal:', 'en'), 'PRODUCTS');
  assert.equal(classifyRow('Postage & Packing:', 'en'), 'DELIVERY');
  assert.equal(classifyRow('Shipping & Handling:', 'en'), 'DELIVERY');
  assert.equal(classifyRow('Grand Total:', 'en'), 'TOTAL');
  assert.equal(classifyRow('Order Total:', 'en'), 'TOTAL');
  assert.equal(classifyRow('Promotion Applied:', 'en'), 'PROMOTION');
  assert.equal(classifyRow('Grand Total:', null), 'TOTAL');
});

test('stripSoldBy removes the prefix in both locales', () => {
  assert.equal(stripSoldBy('Vendido por: Tienda Ficticia SL'), 'Tienda Ficticia SL');
  assert.equal(stripSoldBy('Sold by: Example Shop Ltd'), 'Example Shop Ltd');
  assert.equal(stripSoldBy('Vendido por:  Amazon.es '), 'Amazon.es');
});

test('parseAmazonQuantity defaults to 1 and reads a bare or labelled number', () => {
  assert.equal(parseAmazonQuantity(null), 1);
  assert.equal(parseAmazonQuantity(''), 1);
  assert.equal(parseAmazonQuantity('2'), 2);
  assert.equal(parseAmazonQuantity('Cantidad: 3'), 3);
  assert.equal(parseAmazonQuantity('Qty: 4'), 4);
});

const card: RawAmazonCard = {
  orderId: '123-4567890-1234567',
  date: '12 de marzo de 2025',
  total: '45,98 €',
  detailHref: '/your-orders/order-details?orderID=123-4567890-1234567',
  titles: ['Cable USB-C ficticio 2 m', 'Funda de prueba para móvil'],
  status: 'Entregado el 14 de marzo',
  unmatchedLabels: [],
};

const detail: RawAmazonOrderDetail = {
  lang: 'es-es',
  found: true,
  orderId: '123-4567890-1234567',
  date: '12 de marzo de 2025',
  statuses: ['Entregado el 14 de marzo'],
  items: [
    {
      title: 'Cable USB-C ficticio 2 m',
      asin: 'B0FAKE0001',
      unitPrice: '17,99€',
      quantity: '2',
      seller: 'Vendido por: Tienda Ficticia SL',
      sellerId: 'A1FAKESELLER',
    },
    {
      title: 'Funda de prueba para móvil',
      asin: 'B0FAKE0002',
      unitPrice: '10,00€',
      quantity: null,
      seller: 'Vendido por: Tienda Ficticia SL',
      sellerId: 'A1FAKESELLER',
    },
  ],
  rows: [
    { label: 'Subtotal de producto(s):', amount: '45,98 €' },
    { label: 'Envío:', amount: '0,00 €' },
    { label: 'Total sin IVA:', amount: '38,00 €' },
    { label: 'IVA estimado:', amount: '7,98 €' },
    { label: 'Total:', amount: '45,98 €' },
    { label: 'Importe total:', amount: '45,98 €' },
  ],
};

test('normalizeAmazonOrder maps a Spanish detail page onto the shared order shape', () => {
  const { order, warnings } = normalizeAmazonOrder(detail, card, 'es');

  assert.deepEqual(warnings, []);
  assert.equal(order.id, '123-4567890-1234567');
  assert.equal(order.date, '2025-03-12');
  assert.deepEqual(order.store, { id: 'A1FAKESELLER', name: 'Tienda Ficticia SL', slug: null });
  assert.equal(order.status, 'Entregado el 14 de marzo');
  assert.equal(order.cancelled, false);
  assert.equal(order.refunded, false);
  assert.equal(order.excludedFromSpend, null);
  assert.equal(order.vertical, null);
  assert.equal(order.currency, 'EUR');

  assert.equal(order.items.length, 2);
  assert.equal(order.items[0]?.quantity, 2);
  assert.equal(order.items[0]?.unitPrice, 17.99);
  assert.equal(order.items[0]?.lineTotal, 35.98);
  assert.equal(order.items[0]?.asin, 'B0FAKE0001');
  assert.equal(order.items[1]?.quantity, 1);
  assert.equal(order.items[1]?.lineTotal, 10);

  assert.equal(order.totals.products, 45.98);
  assert.equal(order.totals.delivery, 0);
  assert.equal(order.totals.total, 45.98);
  assert.equal(order.totals.lines.length, 6);
  assert.equal(order.totals.lines[5]?.type, 'TOTAL');
  assert.deepEqual(order.validation, { productsMatch: true, delta: 0 });
});

test('normalizeAmazonOrder: Amazon itself as seller collapses to the Amazon store', () => {
  const own: RawAmazonOrderDetail = {
    ...detail,
    items: detail.items.map((item) => ({ ...item, seller: 'Vendido por: Amazon.es', sellerId: null })),
  };
  const { order } = normalizeAmazonOrder(own, card, 'es');
  assert.deepEqual(order.store, { id: 'amazon', name: 'Amazon', slug: null });
});

test('normalizeAmazonOrder: mixed sellers keep the first and warn', () => {
  const mixed: RawAmazonOrderDetail = {
    ...detail,
    items: [detail.items[0]!, { ...detail.items[1]!, seller: 'Vendido por: Amazon.es', sellerId: null }],
  };
  const { order, warnings } = normalizeAmazonOrder(mixed, card, 'es');
  assert.equal(order.store.name, 'Tienda Ficticia SL');
  assert.deepEqual(warnings.map((warning) => warning.kind), ['mixed_sellers']);
});

test('normalizeAmazonOrder: English rows and dates', () => {
  const english: RawAmazonOrderDetail = {
    ...detail,
    lang: 'en-gb',
    date: '12 March 2025',
    statuses: ['Delivered 14 March'],
    items: [{ ...detail.items[0]!, unitPrice: '£17.99', seller: 'Sold by: Example Shop Ltd' }],
    rows: [
      { label: 'Item(s) Subtotal:', amount: '£35.98' },
      { label: 'Postage & Packing:', amount: '£2.99' },
      { label: 'Promotion Applied:', amount: '-£2.99' },
      { label: 'Total:', amount: '£35.98' },
      { label: 'Grand Total:', amount: '£35.98' },
    ],
  };
  const { order, warnings } = normalizeAmazonOrder(english, { ...card, total: '£35.98' }, 'en');
  assert.deepEqual(warnings, []);
  assert.equal(order.date, '2025-03-12');
  assert.equal(order.currency, 'GBP');
  assert.equal(order.store.name, 'Example Shop Ltd');
  assert.equal(order.totals.products, 35.98);
  assert.equal(order.totals.delivery, 2.99);
  assert.equal(order.totals.total, 35.98);
  assert.equal(order.totals.lines[2]?.type, 'PROMOTION');
  assert.equal(order.totals.lines[2]?.amount, -2.99);
  assert.equal(order.validation.productsMatch, true);
});

test('normalizeAmazonOrder: plain Total row is the fallback grand total', () => {
  const noGrand: RawAmazonOrderDetail = { ...detail, rows: detail.rows.slice(0, 5) };
  const { order } = normalizeAmazonOrder(noGrand, { ...card, total: null }, 'es');
  assert.equal(order.totals.total, 45.98);
});

test('normalizeAmazonOrder: cancelled status excludes the order from spend', () => {
  const cancelled: RawAmazonOrderDetail = { ...detail, statuses: ['Cancelado'] };
  const { order } = normalizeAmazonOrder(cancelled, card, 'es');
  assert.equal(order.cancelled, true);
  assert.equal(order.excludedFromSpend, 'cancelled');

  const english: RawAmazonOrderDetail = { ...detail, statuses: ['Cancelled'] };
  assert.equal(normalizeAmazonOrder(english, card, 'en').order.cancelled, true);
});

test('normalizeAmazonOrder: partially cancelled orders stay in spend with a warning', () => {
  const partial: RawAmazonOrderDetail = { ...detail, statuses: ['Entregado el 14 de marzo', 'Cancelado'] };
  const { order, warnings } = normalizeAmazonOrder(partial, card, 'es');
  assert.equal(order.cancelled, false);
  assert.equal(order.excludedFromSpend, null);
  assert.equal(order.status, 'Entregado el 14 de marzo / Cancelado');
  assert.deepEqual(warnings.map((warning) => warning.kind), ['partial_cancellation']);
});

test('normalizeAmazonOrder: refund words set the flag without inventing an amount', () => {
  const refunded: RawAmazonOrderDetail = { ...detail, statuses: ['Reembolso emitido'] };
  const { order } = normalizeAmazonOrder(refunded, card, 'es');
  assert.equal(order.refunded, true);
  assert.equal(order.excludedFromSpend, null);
  assert.equal(order.totals.total, 45.98);
});

test('normalizeAmazonOrder: without a detail page the card alone is exported', () => {
  const { order, warnings } = normalizeAmazonOrder(null, card, 'es');
  assert.deepEqual(warnings.map((warning) => warning.kind), ['detail_unavailable']);
  assert.equal(order.id, '123-4567890-1234567');
  assert.equal(order.date, '2025-03-12');
  assert.equal(order.totals.total, 45.98);
  assert.equal(order.totals.products, null);
  assert.equal(order.currency, 'EUR');
  assert.deepEqual(order.store, { id: 'amazon', name: 'Amazon', slug: null });
  assert.deepEqual(
    order.items.map((item) => [item.name, item.quantity, item.lineTotal]),
    [['Cable USB-C ficticio 2 m', 1, null], ['Funda de prueba para móvil', 1, null]],
  );
  assert.equal(order.status, 'Entregado el 14 de marzo');
  assert.deepEqual(order.validation, { productsMatch: null, delta: null });
});

test('normalizeAmazonOrder: unparseable date and price produce warnings, order kept', () => {
  const broken: RawAmazonOrderDetail = {
    ...detail,
    date: 'ayer',
    items: [{ ...detail.items[0]!, unitPrice: 'n/d' }],
    rows: [{ label: 'Importe total:', amount: 'pendiente' }],
  };
  const { order, warnings } = normalizeAmazonOrder(broken, { ...card, date: 'ayer' }, 'es');
  assert.equal(order.date, null);
  assert.equal(order.totals.total, 45.98);
  assert.deepEqual(
    warnings.map((warning) => warning.kind).sort(),
    ['unparseable_breakdown_amount', 'unparseable_date', 'unparseable_item_price'],
  );
});

test('normalizeAmazonOrder: item sum disagreeing with the subtotal is flagged', () => {
  const off: RawAmazonOrderDetail = {
    ...detail,
    rows: [{ label: 'Subtotal de producto(s):', amount: '50,00 €' }, { label: 'Importe total:', amount: '50,00 €' }],
  };
  const { order, warnings } = normalizeAmazonOrder(off, card, 'es');
  assert.equal(order.validation.productsMatch, false);
  assert.equal(order.validation.delta, -4.02);
  assert.deepEqual(warnings.map((warning) => warning.kind), ['products_total_mismatch']);
});
