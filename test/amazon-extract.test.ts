import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { evaluateInPage } from '../src/amazon/evaluate.js';
import { detectChallenge, extractDetailPage, extractListPage } from '../src/amazon/extract.js';
import { allListLabels } from '../src/amazon/locale.js';

const PII = [
  'Persona Inventada',
  'Inventada',
  'Calle Falsa',
  '28000',
  'Madrid',
  'España',
  'Visa',
  '••••',
  '4242',
  'Método de pago',
  'Dirección de envío',
  'Factura',
  'print.html',
  'pmts-widget',
  'Devolución hasta',
];

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
});

async function load(name: string): Promise<void> {
  const html = await readFile(new URL(`./fixtures/amazon/${name}`, import.meta.url), 'utf8');
  await page.setContent(html);
}

function assertNoPii(value: unknown): void {
  const text = JSON.stringify(value);
  for (const needle of PII) {
    assert.ok(!text.includes(needle), `extracted payload leaks "${needle}"`);
  }
}

test('list page (es): header fields by label, ids, titles, status, pagination', async () => {
  await load('list-es.html');
  const result = await evaluateInPage(page, extractListPage, allListLabels());

  assert.equal(result.lang, 'es-es');
  assert.equal(result.hasNext, true);
  assert.deepEqual(result.years, [2025, 2024]);
  assert.equal(result.cards.length, 2);

  const [first, second] = result.cards;
  assert.equal(first?.orderId, '123-4567890-1234567');
  assert.equal(first?.date, '12 de marzo de 2025');
  assert.equal(first?.total, '45,98 €');
  assert.ok(first?.detailHref?.includes('order-details?orderID=123-4567890-1234567'));
  assert.deepEqual(first?.titles, ['Cable USB-C ficticio 2 m', 'Funda de prueba para móvil']);
  assert.equal(first?.status, 'Entregado el 14 de marzo');
  assert.deepEqual(first?.unmatchedLabels, []);

  assert.equal(second?.orderId, '123-4567890-7654321');
  assert.equal(second?.date, '3 de enero de 2025');
  assert.equal(second?.total, '9,99 €');
  assert.equal(second?.status, 'Cancelado');

  assertNoPii(result);
});

test('list page (en): English labels, no next page', async () => {
  await load('list-en.html');
  const result = await evaluateInPage(page, extractListPage, allListLabels());

  assert.equal(result.lang, 'en-gb');
  assert.equal(result.hasNext, false);
  assert.deepEqual(result.years, [2025]);
  assert.equal(result.cards.length, 1);

  const card = result.cards[0];
  assert.equal(card?.orderId, '123-4567890-1234567');
  assert.equal(card?.date, 'March 12, 2025');
  assert.equal(card?.total, '£45.98');
  assert.equal(card?.status, 'Delivered 14 March');
  assert.deepEqual(card?.unmatchedLabels, []);

  assertNoPii(result);
});

test('list page: the recipient block never leaves the page', async () => {
  await load('list-es.html');
  const recipientInDom = await page.evaluate(() => document.querySelectorAll('.yohtmlc-recipient').length);
  assert.equal(recipientInDom, 2);
  const result = await evaluateInPage(page, extractListPage, allListLabels());
  assertNoPii(result);
});

test('detail page (es): items, sellers, quantity, unit price, charge rows', async () => {
  await load('detail-es.html');
  const result = await evaluateInPage(page, extractDetailPage);

  assert.equal(result.found, true);
  assert.equal(result.lang, 'es-es');
  assert.equal(result.orderId, '123-4567890-1234567');
  assert.equal(result.date, '12 de marzo de 2025');
  assert.deepEqual(result.statuses, ['Entregado el 14 de marzo']);

  assert.equal(result.items.length, 2);
  const [cable, funda] = result.items;
  assert.equal(cable?.title, 'Cable USB-C ficticio 2 m');
  assert.equal(cable?.asin, 'B0FAKE0001');
  assert.equal(cable?.unitPrice, '17,99€');
  assert.equal(cable?.quantity, '2');
  assert.equal(cable?.seller, 'Vendido por: Tienda Ficticia SL');
  assert.equal(cable?.sellerId, 'A1FAKESELLER');

  assert.equal(funda?.asin, 'B0FAKE0002');
  assert.equal(funda?.unitPrice, '10,00€');
  assert.equal(funda?.quantity, null);
  assert.equal(funda?.seller, 'Vendido por: Amazon.es');
  assert.equal(funda?.sellerId, null);

  assert.deepEqual(
    result.rows.map((row) => row.label),
    ['Subtotal de producto(s):', 'Envío:', 'Total sin IVA:', 'IVA estimado:', 'Total:', 'Importe total:'],
  );
  assert.equal(result.rows[5]?.amount, '45,98 €');
});

test('detail page: address, buyer, payment and invoice blocks never leave the page', async () => {
  await load('detail-es.html');
  const sensitiveInDom = await page.evaluate(
    () =>
      document.querySelectorAll(
        '[data-component="shippingAddress"], [data-component="sharedOrderBuyer"], [data-component="viewPaymentPlanSummaryWidget"], [data-component="orderInvoice"]',
      ).length,
  );
  assert.equal(sensitiveInDom, 4);
  const result = await evaluateInPage(page, extractDetailPage);
  assertNoPii(result);
});

test('detail page without #orderDetails reports found=false', async () => {
  await page.setContent('<html lang="es-es"><body><div class="a-box">Nada</div></body></html>');
  const result = await evaluateInPage(page, extractDetailPage);
  assert.equal(result.found, false);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.rows, []);
});

test('challenge detection: captcha form yes, order pages no', async () => {
  await load('challenge.html');
  const hit = await evaluateInPage(page, detectChallenge);
  assert.equal(hit.challenge, true);
  assert.equal(hit.reason, 'form[action$="validateCaptcha"]');

  await load('list-es.html');
  assert.equal((await evaluateInPage(page, detectChallenge)).challenge, false);
  await load('detail-es.html');
  assert.equal((await evaluateInPage(page, detectChallenge)).challenge, false);
});
