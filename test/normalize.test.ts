import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeOrder,
  parseMoney,
  parsePromoAmount,
  parseQuantity,
  parseTimestamp,
  stripHtml,
} from '../src/core/normalize.js';
import type { RawOrderDetail } from '../src/core/types.js';

test('parseMoney handles Glovo money strings', () => {
  assert.deepEqual(parseMoney('12,00 €'), { value: 12, currency: 'EUR' });
  assert.deepEqual(parseMoney('8,34 EUR'), { value: 8.34, currency: 'EUR' });
  assert.deepEqual(parseMoney('1.234,50 €'), { value: 1234.5, currency: 'EUR' });
  assert.deepEqual(parseMoney('No cost'), { value: 0, currency: null });
  assert.equal(parseMoney('-2,00 €').value, -2);
});

test('parseMoney returns null rather than zero for non-money strings', () => {
  assert.equal(parseMoney('Cancelled').value, null);
  assert.equal(parseMoney('').value, null);
  assert.equal(parseMoney(null).value, null);
  assert.equal(parseMoney(undefined).value, null);
});

test('parseQuantity strips the trailing x', () => {
  assert.equal(parseQuantity('1x'), 1);
  assert.equal(parseQuantity('6x'), 6);
  assert.equal(parseQuantity('1,5x'), 1.5);
  assert.equal(parseQuantity(null), 1);
});

test('parseTimestamp converts epoch ms and rejects null', () => {
  assert.equal(parseTimestamp(1705782481000), '2024-01-20T20:28:01.000Z');
  assert.equal(parseTimestamp(null), null);
  assert.equal(parseTimestamp(0), null);
});

test('stripHtml removes markup from shortSummary', () => {
  assert.equal(stripHtml('20 products from <b>Sorli</b>'), '20 products from Sorli');
  assert.equal(stripHtml(null), null);
});

test('normalizes a full order the way a real one is shaped', () => {
  const raw: RawOrderDetail = {
    id: 123456789012,
    creationTime: null,
    currentStatus: { type: 'DeliveredStatus', creationTime: 1705782481000 },
    storeId: 1234,
    storeName: 'Test Store',
    shortSummary: '2 products from <b>Test Store</b>',
    boughtProducts: [
      { name: 'Item A', quantity: '1x', price: '15,00 €', displayStyle: 'DEFAULT' },
      { name: 'Item B', quantity: '3x', price: '9,00 €', displayStyle: 'DEFAULT' },
    ],
    pricingBreakdown: {
      lines: [
        { type: 'DELIVERY', label: 'Prime Delivery', amount: 'No cost' },
        { type: 'PRODUCTS', amount: '24,00 €' },
        { type: 'TOTAL', amount: '24,00 €' },
      ],
    },
  };

  const { order, warnings } = normalizeOrder(raw);

  assert.equal(order.date, '2024-01-20T20:28:01.000Z');
  assert.equal(order.items.length, 2);
  assert.equal(order.currency, 'EUR');
  assert.equal(order.totals.products, 24);
  assert.equal(order.totals.delivery, 0);
  assert.equal(order.totals.total, 24);
  assert.equal(order.validation.productsMatch, true);
  assert.equal(order.validation.delta, 0);
  assert.equal(order.store?.name, 'Test Store');
  assert.equal(order.summary, '2 products from Test Store');
  assert.equal(warnings.length, 0);
});

test('excludes STRIKETHROUGH lines from spend and reconciles to PRODUCTS', () => {
  const raw: RawOrderDetail = {
    id: 999999999999,
    creationTime: null,
    currentStatus: { type: 'DeliveredStatus', creationTime: 1756200000000 },
    storeId: 4242,
    storeName: 'Test Store',
    boughtProducts: [
      { name: 'Item A', quantity: '1x', price: '12,00 €', displayStyle: 'DEFAULT' },
      { name: 'Item B', quantity: '6x', price: '8,34 €', displayStyle: 'DEFAULT' },
      { name: 'Item C', quantity: '1x', price: '14,96 €', displayStyle: 'DEFAULT' },
      {
        name: 'Item D',
        quantity: '1x',
        price: '2,99 €',
        displayStyle: 'STRIKETHROUGH',
        notice: "Not available - you weren't charged",
      },
    ],
    pricingBreakdown: {
      lines: [
        { type: 'DELIVERY', label: 'Prime Delivery', amount: 'No cost' },
        { type: 'PRODUCTS', amount: '35,30 €' },
        { type: 'TOTAL', amount: '35,30 €' },
      ],
    },
  };

  const { order, warnings } = normalizeOrder(raw);

  const naive = order.items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
  const charged = order.items
    .filter((item) => item.charged)
    .reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);

  assert.equal(Math.round(naive * 100) / 100, 38.29);
  assert.equal(Math.round(charged * 100) / 100, 35.3);
  assert.equal(order.totals.products, 35.3);
  assert.equal(order.validation.productsMatch, true);
  assert.equal(order.validation.delta, 0);
  assert.equal(warnings.length, 0);
  assert.equal(order.items.length, 4);
  assert.equal(order.items[3]!.charged, false);
});

test('price is a line total, so unitPrice divides by quantity', () => {
  const raw: RawOrderDetail = {
    id: 1,
    currentStatus: { type: 'DeliveredStatus', creationTime: 1756200000000 },
    boughtProducts: [{ name: 'Six pack', quantity: '6x', price: '8,34 €', displayStyle: 'DEFAULT' }],
    pricingBreakdown: { lines: [{ type: 'PRODUCTS', amount: '8,34 €' }] },
  };

  const { order } = normalizeOrder(raw);
  assert.equal(order.items[0]!.lineTotal, 8.34);
  assert.equal(order.items[0]!.unitPrice, 1.39);
});

test('flags a mismatch instead of trusting either side', () => {
  const raw: RawOrderDetail = {
    id: 7,
    currentStatus: { type: 'DeliveredStatus', creationTime: 1756200000000 },
    boughtProducts: [{ name: 'X', quantity: '1x', price: '10,00 €', displayStyle: 'DEFAULT' }],
    pricingBreakdown: { lines: [{ type: 'PRODUCTS', amount: '12,00 €' }] },
  };

  const { order, warnings } = normalizeOrder(raw);
  assert.equal(order.validation.productsMatch, false);
  assert.equal(order.validation.delta, -2);
  assert.equal(warnings.some((warning) => warning.kind === 'products_total_mismatch'), true);
});

test('warns on an unparseable price rather than silently zeroing it', () => {
  const raw: RawOrderDetail = {
    id: 8,
    currentStatus: { type: 'DeliveredStatus', creationTime: 1756200000000 },
    boughtProducts: [{ name: 'Weird', quantity: '1x', price: 'Cancelled', displayStyle: 'DEFAULT' }],
    pricingBreakdown: { lines: [] },
  };

  const { order, warnings } = normalizeOrder(raw);
  assert.equal(order.items[0]!.lineTotal, null);
  assert.equal(warnings.some((warning) => warning.kind === 'unparseable_item_price'), true);
});

test('captures originalPrice and the promotion discount', () => {
  const raw: RawOrderDetail = {
    id: 9,
    currentStatus: { type: 'DeliveredStatus', creationTime: 1756200000000 },
    boughtProducts: [
      {
        name: 'Promo item',
        quantity: '4x',
        price: '2,76 €',
        originalPrice: '3,00 €',
        promotionDescription: '-0,24 €',
        displayStyle: 'DEFAULT',
      },
    ],
    pricingBreakdown: { lines: [{ type: 'PRODUCTS', amount: '2,76 €' }] },
  };

  const { order } = normalizeOrder(raw);
  const item = order.items[0]!;
  assert.equal(item.lineTotal, 2.76);
  assert.equal(item.originalLineTotal, 3);
  assert.equal(item.discount, -0.24);
  assert.equal(order.validation.productsMatch, true);
});

test('does not read a discount out of a non-money promotion label', () => {
  assert.equal(parsePromoAmount('2x1'), null);
  assert.equal(parsePromoAmount('Buy 2 get 1'), null);
  assert.equal(parsePromoAmount('-0,24 €'), -0.24);
  assert.equal(parsePromoAmount(null), null);
});

test('derives a discount from originalPrice when no promo label is present', () => {
  const raw: RawOrderDetail = {
    id: 10,
    currentStatus: { type: 'DeliveredStatus', creationTime: 1756200000000 },
    boughtProducts: [
      { name: 'Sale', quantity: '1x', price: '4,00 €', originalPrice: '5,00 €', displayStyle: 'DEFAULT' },
    ],
    pricingBreakdown: { lines: [] },
  };

  const { order } = normalizeOrder(raw);
  assert.equal(order.items[0]!.discount, -1);
});

test('reads cancellation from the status type, not just recentlyCancelled', () => {
  const raw: RawOrderDetail = {
    id: 11,
    currentStatus: { type: 'CanceledStatus', creationTime: 1756200000000 },
    recentlyCancelled: false,
    boughtProducts: [{ name: 'Y', quantity: '1x', price: '9,00 €', displayStyle: 'DEFAULT' }],
    pricingBreakdown: { lines: [] },
  };

  const { order } = normalizeOrder(raw);
  assert.equal(order.cancelled, true);
  assert.equal(order.excludedFromSpend, 'cancelled');
});

test('a refunded order keeps its total and stays in spend', () => {
  const raw: RawOrderDetail = {
    id: 12,
    currentStatus: { type: 'DeliveredStatus', creationTime: 1756200000000 },
    refunded: true,
    boughtProducts: [{ name: 'Z', quantity: '1x', price: '27,40 €', displayStyle: 'DEFAULT' }],
    pricingBreakdown: { lines: [{ type: 'TOTAL', amount: '27,40 €' }] },
  };

  const { order } = normalizeOrder(raw);
  assert.equal(order.refunded, true);
  assert.equal(order.cancelled, false);
  assert.equal(order.totals.total, 27.4);
  assert.equal(order.excludedFromSpend, null);
});
